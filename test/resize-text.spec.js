// @ts-check
import { test, expect } from "@playwright/test";
import { textResize, runChecks } from "../src/index.js";

test.describe("resize text", () => {
  test("reports the px-locked card, not the rem card, and dedupes inherited children", async ({ page }) => {
    await page.goto("/resize-text-locked.html");
    const result = await textResize(page);
    // The rem card is quiet. In the px card, the outermost px-locked owners
    // are div.title / p / small (each carries its own px declaration); the
    // nested case collapses to the one outer element (span#px-inherited is
    // not reported — it inherits).
    const targets = result.findings.map((f) => f.target);
    expect(targets).toContain("div.title");
    expect(targets).toContain("p");
    expect(targets).toContain("small");
    expect(targets).toContain("div#px-nested");
    expect(targets).not.toContain("span#px-inherited");
    expect(targets.every((t) => !t.includes("card-rem"))).toBe(true);
    expect(result.findings[0].wcag).toEqual({ criterion: "1.4.4", level: "AA", version: "2.0" });
    expect(result.findings[0].data).toEqual({ before: 24, after: 24 });
    expect(await page.locator("style[data-ramp-check]").count()).toBe(0);
  });

  test("blocks under every policy: 1.4.4 is AA, the ADA floor", async ({ page }) => {
    await page.goto("/resize-text-locked.html");
    for (const policy of ["wcag-aaa", "wcag22-aa", "wcag21-aa"]) {
      const result = await runChecks(page, { policy, checks: { axe: "off", reflow: "off", keyboard: "off", textSpacing: "off" } });
      expect(result.blocking.filter((f) => f.rule === "text-resize-locked").length).toBeGreaterThan(0);
    }
  });

  test("stays quiet on the clean page", async ({ page }) => {
    await page.goto("/clean.html");
    expect((await textResize(page)).findings).toEqual([]);
  });
});