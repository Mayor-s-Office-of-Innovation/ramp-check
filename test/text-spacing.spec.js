// @ts-check
import { test, expect } from "@playwright/test";
import { textSpacing, runChecks } from "../src/index.js";

test.describe("text spacing", () => {
  test("reports the fixed-height card, not the pre-truncated or fluid boxes, and cleans up", async ({ page }) => {
    await page.goto("/text-spacing-clipped.html");
    const result = await textSpacing(page);
    expect(result.findings.map((f) => `${f.rule} ${f.target}`)).toEqual(["text-spacing-clipped div#card"]);
    expect(result.findings[0].wcag).toEqual({ criterion: "1.4.12", level: "AA", version: "2.1" });
    expect(result.measured).toBe(3);
    expect(await page.locator("style[data-ramp-check]").count()).toBe(0);
    expect(await page.locator("#card").evaluate((el) => getComputedStyle(el).lineHeight)).not.toBe("normal");
  });

  test("warns by default and blocks when promoted", async ({ page }) => {
    await page.goto("/text-spacing-clipped.html");
    const def = await runChecks(page, { checks: { keyboard: "off", reflow: "off", axe: "off" } });
    expect(def.ran).toEqual(["textSpacing"]);
    expect(def.warnings.map((f) => f.rule)).toEqual(["text-spacing-clipped"]);
    expect(def.blocking).toEqual([]);
    const strict = await runChecks(page, { checks: { keyboard: "off", reflow: "off", axe: "off", textSpacing: "block" } });
    expect(strict.blocking.map((f) => f.rule)).toEqual(["text-spacing-clipped"]);
  });

  test("stays quiet on the clean page", async ({ page }) => {
    await page.goto("/clean.html");
    expect((await textSpacing(page)).findings).toEqual([]);
  });
});
