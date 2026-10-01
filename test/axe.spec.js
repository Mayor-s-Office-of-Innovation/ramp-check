// @ts-check
import { test, expect } from "@playwright/test";
import { axeScan, runChecks } from "../src/index.js";

/** @param {import("../src/index.js").Finding[]} findings */
const keys = (findings) => findings.map((f) => `${f.rule} ${f.target}`).sort();

test.describe("axe scan", () => {
  test("clean page has no findings at AAA", async ({ page }) => {
    await page.goto("/clean.html");
    const result = await runChecks(page, { policy: "wcag-aaa" });
    expect(keys(result.blocking)).toEqual([]);
    expect(keys(result.warnings)).toEqual([]);
    expect(result.ran).toEqual(["axe", "reflow", "textSpacing", "keyboard"]);
  });

  test("AAA blocks enhanced contrast; 2.2 AA reports it as a warning", async ({ page }) => {
    await page.goto("/axe-contrast.html");
    const aaa = await runChecks(page, { policy: "wcag-aaa", checks: { reflow: "off" } });
    // axe reports the enhanced rule only for text that already passes AA.
    expect(keys(aaa.blocking)).toEqual([
      "color-contrast #fails-aa",
      "color-contrast-enhanced #aa-only",
      "image-alt #no-alt",
    ]);
    expect(aaa.warnings).toEqual([]);

    const aa = await runChecks(page, { policy: "wcag22-aa", checks: { reflow: "off" } });
    expect(keys(aa.blocking)).toEqual(["color-contrast #fails-aa", "image-alt #no-alt"]);
    expect(keys(aa.warnings)).toEqual(["color-contrast-enhanced #aa-only"]);
    const alt = aa.blocking.find((f) => f.rule === "image-alt");
    expect(alt?.wcag).toEqual({ criterion: "1.1.1", level: "A", version: "2.0" });
    expect(alt?.help).toMatch(/dequeuniversity/);
  });

  test("settle waits for the fade so contrast is measured at rest", async ({ page }) => {
    await page.goto("/axe-fade-in.html");
    const settled = await axeScan(page);
    expect(keys(settled.findings)).toEqual([]);
  });

  test("without settle, a mid-fade element reports a bogus contrast violation", async ({ page }) => {
    await page.goto("/axe-fade-in.html");
    const hot = await axeScan(page, { settle: false });
    expect(keys(hot.findings)).toEqual(["color-contrast #fading"]);
  });
});
