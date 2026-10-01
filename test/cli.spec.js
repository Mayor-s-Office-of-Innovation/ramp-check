// @ts-check
import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSite } from "../src/cli/run.js";
import { markdownReport, MARKDOWN_MARKER } from "../src/cli/report-markdown.js";
import { consoleReport } from "../src/cli/report-console.js";
import { main } from "../src/cli/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "src/cli/index.js");
const baseURL = "http://127.0.0.1:4173";
/** @param {import("../src/checks/baseline.js").LocatedFinding[]} ls */
const keys = (ls) => ls.map((l) => `${l.page}: ${l.finding.rule} ${l.finding.target}`).sort();

test.describe("config runner", () => {
  test("clean pages pass, including the motion cell", async () => {
    const report = await runSite({
      baseURL,
      pages: ["/clean.html", { path: "/motion-guarded.html", name: "guarded motion" }],
      matrix: { reducedMotion: ["reduce"] },
    });
    expect(report.ok).toBe(true);
    expect(report.states.map((s) => `${s.page} [${s.cell}]`)).toEqual([
      "/clean.html [reducedMotion: reduce]",
      "guarded motion [reducedMotion: reduce]",
    ]);
    expect(report.states[0].result?.ran).toEqual(["motion", "axe", "reflow", "textSpacing", "keyboard"]);
    expect(report.failing).toEqual([]);
    expect(report.consistency).toEqual([]);
  });

  test("seeded defects fail, including the cross-page consistency check", async () => {
    const report = await runSite({
      baseURL,
      pages: ["/axe-contrast.html", "/reflow-overflow.html", "/consistency-a.html", "/consistency-b.html"],
      checks: { keyboard: "off" },
    });
    expect(report.ok).toBe(false);
    expect(keys(report.failing)).toEqual([
      "/axe-contrast.html: color-contrast #fails-aa",
      "/axe-contrast.html: color-contrast-enhanced #aa-only",
      "/axe-contrast.html: image-alt #no-alt",
      "/consistency-a.html: duplicate-page-title /consistency-a.html",
      "/consistency-b.html: duplicate-page-title /consistency-b.html",
      "/consistency-b.html: inconsistent-navigation /consistency-b.html",
      "/reflow-overflow.html: reflow-horizontal-scroll div#wide",
    ]);
    const md = markdownReport(report);
    expect(md).toContain(MARKDOWN_MARKER);
    expect(md).toContain("❌ failed");
    expect(md).toContain("### Failing (7)");
    expect(md).toContain("`duplicate-page-title`");
    expect(consoleReport(report)).toContain("Failing (7):");
  });

  test("a page that fails to load is an error, not a pass", async () => {
    const report = await runSite({ baseURL, pages: ["/does-not-exist.html"], checks: { keyboard: "off" }, timeout: 5000 });
    // The fixture server returns 404 with a body, so the page loads; axe then reports the empty document.
    expect(report.states[0].error ?? report.failing.length > 0).toBeTruthy();
    expect(report.ok).toBe(false);
  });

  test("the baseline ratchet: write, then only new findings fail, then entries expire", async ({}, testInfo) => {
    const baseline = testInfo.outputPath("a11y-baseline.json");
    const config = { baseURL, pages: ["/axe-contrast.html"], checks: { keyboard: "off", reflow: "off" }, baseline, consistency: false };
    const day0 = new Date("2026-10-01T12:00:00Z");

    const written = await runSite(config, { writeBaseline: true, now: day0 });
    expect(written.baselineWritten).toBe(baseline);
    expect(written.ok).toBe(true);
    expect(written.baselined).toHaveLength(3);
    const file = JSON.parse(readFileSync(baseline, "utf8"));
    expect(file.entries.map((/** @type {any} */ e) => e.rule).sort()).toEqual(["color-contrast", "color-contrast-enhanced", "image-alt"]);
    expect(file.entries[0].expires).toBe("2027-03-30");

    const later = await runSite(config, { now: new Date("2026-12-01T12:00:00Z") });
    expect(later.ok).toBe(true);
    expect(later.failing).toEqual([]);
    expect(later.baselined).toHaveLength(3);
    expect(consoleReport(later)).toContain("3 known findings still outstanding");

    const expired = await runSite(config, { now: new Date("2027-05-01T12:00:00Z") });
    expect(expired.ok).toBe(false);
    expect(expired.expiredBaseline).toHaveLength(3);
    expect(keys(expired.failing)).toHaveLength(3);
    expect(markdownReport(expired)).toContain("### Expired exceptions (3)");
  });

  test("the allowlist applies across the site", async () => {
    const report = await runSite({
      baseURL,
      pages: ["/axe-contrast.html"],
      checks: { keyboard: "off", reflow: "off" },
      consistency: false,
      allowlist: [{ rule: "image-alt", target: "#no-alt", reason: "decorative, alt pending", expires: "2099-01-01" }],
    });
    expect(keys(report.allowlisted)).toEqual(["/axe-contrast.html: image-alt #no-alt"]);
    expect(keys(report.failing)).toEqual([
      "/axe-contrast.html: color-contrast #fails-aa",
      "/axe-contrast.html: color-contrast-enhanced #aa-only",
    ]);
    expect(markdownReport(report)).toContain("Allowlisted (1)");
  });
});

test.describe("cli", () => {
  test("run with a config file writes both reports and exits 0 on a clean site", async ({}, testInfo) => {
    const out = testInfo.outputPath("report");
    /** @type {string[]} */
    const lines = [];
    const code = await main(["--config", join(root, "test/cli/clean.config.js"), "--out", out, "--quiet"], {
      cwd: root, stdout: (s) => lines.push(s), stderr: (s) => lines.push(s),
    });
    expect(code).toBe(0);
    expect(existsSync(join(out, "ramp-check.json"))).toBe(true);
    expect(readFileSync(join(out, "ramp-check.md"), "utf8")).toContain("✅ passed");
    expect(lines.join("\n")).toContain("ramp-check: passed");
  });

  test("exits 1 on findings and 2 on a bad config or command", async ({}, testInfo) => {
    const quiet = { cwd: root, stdout: () => {}, stderr: () => {} };
    expect(await main(["--config", join(root, "test/cli/defects.config.js"), "--out", testInfo.outputPath("r"), "--quiet"], quiet)).toBe(1);
    expect(await main(["--config", "nope.config.js"], quiet)).toBe(2);
    expect(await main(["frobnicate"], quiet)).toBe(2);
    expect(await main(["--help"], quiet)).toBe(0);
  });

  test("--policy and --base-url override the config", async ({}, testInfo) => {
    /** @type {string[]} */
    const lines = [];
    const code = await main(
      ["--config", join(root, "test/cli/defects.config.js"), "--policy", "wcag22-aa", "--out", testInfo.outputPath("r"), "--quiet"],
      { cwd: root, stdout: (s) => lines.push(s), stderr: (s) => lines.push(s) },
    );
    expect(code).toBe(1);
    const text = lines.join("\n");
    expect(text).toContain("policy wcag22-aa");
    expect(text).toMatch(/Warnings \(\d+, not blocking under wcag22-aa\)/);
    expect(text).toContain("color-contrast-enhanced");
  });

  test("init scaffolds a config, an allowlist and npm scripts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ramp-init-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "site", version: "0.0.0" }) + "\n");
    /** @type {string[]} */
    const lines = [];
    expect(await main(["init"], { cwd: dir, stdout: (s) => lines.push(s), stderr: (s) => lines.push(s) })).toBe(0);
    // A CommonJS package gets an .mjs config so `export default` works.
    expect(existsSync(join(dir, "ramp-check.config.mjs"))).toBe(true);
    expect(readFileSync(join(dir, "a11y-allowlist.json"), "utf8")).toBe("[]\n");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.scripts).toEqual({ a11y: "ramp-check", "a11y:baseline": "ramp-check baseline" });
    expect(lines.join("\n")).toContain("npx ramp-check");
    // Idempotent.
    expect(await main(["init"], { cwd: dir, stdout: () => {}, stderr: () => {} })).toBe(0);
  });

  test("the bin runs directly", async () => {
    const { stdout } = await promisify(execFile)("node", [bin, "--help"]);
    expect(stdout).toContain("Usage:");
  });
});
