// @ts-check
import { test, expect } from "@playwright/test";
import { reflowCheck } from "../src/index.js";

test.describe("reflow", () => {
  test("names the fixed-width element and restores the viewport", async ({ page }) => {
    await page.goto("/reflow-overflow.html");
    const before = page.viewportSize();
    const result = await reflowCheck(page);
    expect(result.overflow).toBeGreaterThan(200);
    expect(result.findings.map((f) => `${f.rule} ${f.target}`)).toEqual([
      "reflow-horizontal-scroll div#wide",
    ]);
    expect(result.findings[0].wcag).toEqual({ criterion: "1.4.10", level: "AA", version: "2.1" });
    expect(page.viewportSize()).toEqual(before);
  });

  test("stays quiet on a fluid page", async ({ page }) => {
    await page.goto("/clean.html");
    const result = await reflowCheck(page);
    expect(result.findings).toEqual([]);
    expect(result.overflow).toBe(0);
  });
});
