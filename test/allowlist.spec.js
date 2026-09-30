// @ts-check
import { test, expect } from "@playwright/test";
import { applyAllowlist, loadAllowlist, failures, runChecks } from "../src/index.js";

/** @type {import("../src/index.js").Finding} */
const finding = {
  check: "axe",
  rule: "color-contrast-enhanced",
  target: "#aa-only",
  message: "",
  wcag: { criterion: "1.4.6", level: "AAA", version: "2.0" },
};

test.describe("allowlist", () => {
  test("every entry needs rule, target, reason and an ISO expiry", () => {
    expect(() => loadAllowlist([{ rule: "x", target: "y" }])).toThrow(/"reason" is required/);
    expect(() => loadAllowlist([{ rule: "x", target: "y", reason: "z", expires: "soon" }])).toThrow(/ISO date/);
    expect(loadAllowlist(undefined)).toEqual([]);
    expect(loadAllowlist([{ rule: "x", target: "y", reason: "z", expires: "2099-01-01" }])).toHaveLength(1);
  });

  test("a live entry marks the finding; unused and expired entries are reported", () => {
    const entries = loadAllowlist([
      { rule: "color-contrast-enhanced", target: "#aa-only", reason: "design tokens under review", expires: "2099-01-01" },
      { rule: "color-contrast-enhanced", target: ".chip*", reason: "prefix match, matches nothing here", expires: "2099-01-01" },
      { rule: "image-alt", target: "#hero", reason: "past its date", expires: "2020-01-01" },
    ]);
    const f = { ...finding };
    const outcome = applyAllowlist([f], entries, { now: new Date("2026-09-30") });
    expect(f.allowlisted).toBe(entries[0]);
    expect(outcome.unused).toEqual([entries[1]]);
    expect(outcome.expired).toEqual([entries[2]]);
  });

  test("an expired entry suppresses nothing and fails the run by name", () => {
    const entries = loadAllowlist([
      { rule: "color-contrast-enhanced", target: "#aa-only", reason: "was fine", expires: "2026-01-01" },
    ]);
    const f = { ...finding, severity: /** @type {const} */ ("block") };
    const { expired } = applyAllowlist([f], entries, { now: new Date("2026-09-30") });
    expect(f.allowlisted).toBeUndefined();
    const lines = failures({
      label: "", policy: "wcag-aaa", ran: [], findings: [f], blocking: [f], warnings: [], allowlisted: [], expired, unused: [],
    });
    expect(lines).toEqual([
      "color-contrast-enhanced: #aa-only () [1.4.6 AAA]",
      "allowlist entry expired 2026-01-01: color-contrast-enhanced #aa-only (was fine)",
    ]);
  });

  test("through runChecks: the allowlisted finding stops blocking but stays in the report", async ({ page }) => {
    await page.goto("/axe-contrast.html");
    const result = await runChecks(page, {
      checks: { reflow: "off" },
      allowlist: [
        { rule: "color-contrast-enhanced", target: "#aa-only", reason: "muted token pending", expires: "2099-01-01" },
      ],
    });
    const keys = (/** @type {import("../src/index.js").Finding[]} */ fs) => fs.map((f) => `${f.rule} ${f.target}`);
    expect(keys(result.allowlisted)).toEqual(["color-contrast-enhanced #aa-only"]);
    expect(keys(result.blocking)).not.toContain("color-contrast-enhanced #aa-only");
    expect(keys(result.blocking)).toContain("color-contrast #fails-aa");
    expect(result.expired).toEqual([]);
  });
});
