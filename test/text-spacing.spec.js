// @ts-check
import { test, expect } from "@playwright/test";
import { textSpacing, runChecks } from "../src/index.js";

test.describe("text spacing", () => {
  test("reports the fixed-height card, not the pre-truncated or fluid boxes, and cleans up", async ({ page }) => {
    await page.goto("/text-spacing-clipped.html");
    const result = await textSpacing(page);
    expect(result.findings.map((f) => `${f.rule} ${f.target}`)).toEqual([
      "text-spacing-clipped div#card",
      "text-spacing-clipped span#chip-span",
    ]);
    expect(result.findings.map((f) => f.data.via)).toEqual([
      expect.stringMatching(/^text-crossing-/),
      expect.stringMatching(/^text-crossing-right$|^ellipsis$/),
    ]);
    expect(result.findings[0].wcag).toEqual({ criterion: "1.4.12", level: "AA", version: "2.1" });
    expect(result.measured).toBe(7);
    expect(await page.locator("style[data-ramp-check]").count()).toBe(0);
    expect(await page.locator("#card").evaluate((el) => getComputedStyle(el).lineHeight)).not.toBe("normal");
  });

  test("the sweep cases: aria-hidden deco and sr-only text in clipped boxes stay quiet", async ({ page }) => {
    await page.goto("/text-spacing-clipped.html");
    const result = await textSpacing(page);
    const targets = result.findings.map((f) => f.target);
    expect(targets).not.toContain("div#deco-hero"); // only aria-hidden 1px gradient lines stick out
    expect(targets).not.toContain("div#sr-holder"); // sr-only string clipped by design, invisible text
    // and the chip's message names the user-observable mechanism
    const chip = result.findings.find((f) => f.target === "span#chip-span");
    expect(chip?.message).toMatch(/text extends past|ellipsis now hides/);
  });

  test("warns by default and blocks when promoted", async ({ page }) => {
    await page.goto("/text-spacing-clipped.html");
    const def = await runChecks(page, { checks: { keyboard: "off", reflow: "off", axe: "off" } });
    expect(def.ran).toEqual(["textSpacing"]);
    expect(def.warnings.map((f) => f.rule)).toEqual(["text-spacing-clipped", "text-spacing-clipped"]);
    expect(def.blocking).toEqual([]);
    const strict = await runChecks(page, { checks: { keyboard: "off", reflow: "off", axe: "off", textSpacing: "block" } });
    expect(strict.blocking.map((f) => f.rule)).toEqual(["text-spacing-clipped", "text-spacing-clipped"]);
  });

  test("stays quiet on the clean page", async ({ page }) => {
    await page.goto("/clean.html");
    expect((await textSpacing(page)).findings).toEqual([]);
  });
});
