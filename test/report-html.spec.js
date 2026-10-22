// @ts-check
import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import Reporter from "ramp-check/reporter";
import {
  HtmlReport,
  coverageSummary,
  findingContext,
} from "../src/report/html.js";
import { classify } from "../src/run.js";
import { htmlReport } from "../src/cli/report-html.js";
import { runSite } from "../src/cli/run.js";
import { main } from "../src/cli/index.js";

const finding = () => ({
  check: "axe",
  rule: "color-contrast-enhanced",
  target: "#label",
  message: "Improve contrast",
  wcag: { criterion: "1.4.6", level: "AAA", version: "2.0" },
});
const scan = () => ({
  label: "Example",
  ran: ["axe", "readingLevel"],
  ...classify([finding()], { policy: "wcag22-aa" }),
  readingLevel: { measured: false, skipped: "too-short", stats: { grade: 3 } },
});

test("explains actual severity including overrides rather than guessing from AAA", () => {
  const automatic = scan().findings[0];
  expect(findingContext(automatic, "wcag22-aa")).toContain("AAA is above");
  const configured = classify([finding()], {
    policy: "wcag-aaa",
    checks: { axe: "warn" },
  }).findings[0];
  expect(findingContext(configured, "wcag-aaa")).toContain(
    "configured as warn",
  );
  expect(findingContext(configured, "wcag-aaa")).not.toContain("above");
  const reading = classify([{ ...finding(), check: "readingLevel" }], {
    policy: "wcag-aaa",
  }).findings[0];
  expect(reading.severityReason).toContain("defaults to warn");
});

test("skipped readability never gets a green check or a grade", () => {
  for (const skipped of ["too-short", "no-text", "lang-not-english"]) {
    const report = scan();
    report.readingLevel.skipped = skipped;
    const html = coverageSummary(report);
    expect(html).toContain("Not measured");
    expect(html).not.toContain('class="check-indicator"');
    expect(html).not.toContain("Estimated reading grade");
  }
  const report = scan();
  report.readingLevel.measured = true;
  expect(coverageSummary(report)).toContain("Estimated reading grade: 3");
  expect(coverageSummary(report)).toContain('class="check-indicator"');
  report.findings[0].allowlisted = {
    reason: "reviewed",
    expires: "2099-01-01",
  };
  expect(coverageSummary(report)).toContain(
    "covered by exceptions or baseline",
  );
});

test("HTML escapes page content, puts images first and notes last, and is accessible", async ({
  page,
}) => {
  const report = new HtmlReport();
  const data = scan();
  data.findings[0].message = '<img src=x onerror="alert(1)">';
  const png = await page.screenshot();
  report.addResult(
    "<script>alert(1)</script>",
    {
      status: "passed",
      retry: 0,
      attachments: [
        {
          name: "ramp-check: Example",
          contentType: "application/json",
          body: Buffer.from(JSON.stringify(data)),
        },
        {
          name: "ramp-check: Example (highlighted)",
          contentType: "image/png",
          body: png,
        },
      ],
      errors: [],
    },
    [
      {
        type: "a11y-allowlist-unused",
        description: "label #period (expires 2099-01-01)",
      },
    ],
  );
  const html = report.render("passed");
  expect(html).not.toContain("<script>");
  expect(html.indexOf('id="screenshots"')).toBeLessThan(
    html.indexOf('id="findings"'),
  );
  expect(html.indexOf('id="findings"')).toBeLessThan(
    html.indexOf('id="exceptions"'),
  );
  await page.setContent(html);
  await expect(page.locator("img")).toHaveCount(1);
  await expect(
    page
      .locator(".coverage > p")
      .filter({ hasText: "Readability — Not measured — too little text" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByText("View check details", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".coverage details")).toHaveAttribute("open", "");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("public reporter handles file-backed attachments, retries, errors and missing screenshots", async ({}, info) => {
  const outputFolder = info.outputPath("report");
  const reporter = new Reporter({ outputFolder });
  const path = info.outputPath("scan.json");
  writeFileSync(path, JSON.stringify(scan()));
  reporter.onTestEnd(
    { titlePath: () => ["Test"], annotations: [] },
    {
      status: "failed",
      retry: 1,
      attachments: [
        { name: "ramp-check: Test", contentType: "application/json", path },
      ],
      errors: [{ message: "Test failed" }],
    },
  );
  reporter.onError({ message: "Server failed" });
  reporter.onEnd({ status: "failed" });
  const html = readFileSync(join(outputFolder, "index.html"), "utf8");
  expect(html).toContain("Attempt 2");
  expect(html).toContain("No highlighted screenshot");
  expect(html).toContain("Server failed");
  expect(html).toContain("Test failed");
});

test("CLI writes the shared HTML view with screenshots and correct failure status", async ({}, info) => {
  const out = info.outputPath("cli");
  const config = info.outputPath("config.mjs");
  writeFileSync(
    config,
    `export default ${JSON.stringify({ baseURL: "http://127.0.0.1:4173", pages: ["/axe-contrast.html"], policy: "wcag22-aa", consistency: false, out, checks: { keyboard: "off" } })}`,
  );
  expect(await main(["--config", config], { stdout: () => {} })).toBe(1);
  const html = readFileSync(join(out, "index.html"), "utf8");
  expect(html).toContain("data:image/png;base64,");
  expect(html).toContain("AAA is above");
  expect(html).toContain("Run status: <strong>failed");
});

test("site-wide consistency failures and unused exceptions remain visible", async () => {
  const report = await runSite({
    baseURL: "http://127.0.0.1:4173",
    pages: ["/consistency-a.html", "/consistency-b.html"],
    checks: { keyboard: "off" },
    allowlist: [
      {
        rule: "unused",
        target: "#unused",
        reason: "pending",
        expires: "2099-01-01",
      },
    ],
  });
  const html = htmlReport(report);
  expect(html).toContain("duplicate-page-title");
  expect(html).toContain("unused #unused (expires 2099-01-01)");
  expect(html).toContain("Run status: <strong>failed");
});

test("Playwright loads the public reporter entry point end to end", async ({}, info) => {
  const dir = info.outputPath("consumer");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(
    fileURLToPath(new URL("..", import.meta.url)),
    join(dir, "node_modules/ramp-check"),
    "dir",
  );
  // Put the temporary test inside this repo's dependency tree so the imports resolve.
  const spec = join(dir, "sample.spec.mjs");
  writeFileSync(
    spec,
    `import {test} from '@playwright/test'; test('attachment', async ({}, info) => { await info.attach('ramp-check: Example', {body: Buffer.from(${JSON.stringify(JSON.stringify(scan()))}), contentType:'application/json'}); });`,
  );
  const config = join(dir, "playwright.config.mjs");
  writeFileSync(
    config,
    `export default {testDir:'.', outputDir:${JSON.stringify(join(dir, 'results'))}, workers:1, reporter:[['ramp-check/reporter',{outputFolder:${JSON.stringify(join(dir, "report"))}}]]};`,
  );
  execFileSync(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", "--config", config],
    { cwd: process.cwd(), env: { ...process.env, CI: "" } },
  );
  expect(readFileSync(join(dir, "report/index.html"), "utf8")).toContain(
    "Not measured — too little text",
  );
});
