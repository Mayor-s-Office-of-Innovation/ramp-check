// @ts-check
import { test, expect } from "@playwright/test";
import { motionAudit, motionRuntime } from "../src/index.js";

/** @param {import("../src/index.js").Finding[]} findings */
const keys = (findings) => findings.map((f) => `${f.rule} ${f.target}`).sort();

test.describe("motion audit under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(motionRuntime);
  });

  test("reports the entrance animation, the shadow-root spinner and the view transition", async ({ page }) => {
    await page.goto("/motion-unguarded.html");
    await page.getByRole("button", { name: "Go to page two" }).click();
    const result = await motionAudit(page);
    expect(result.reducedMotion).toBe(true);
    expect(keys(result.findings)).toEqual([
      "infinite-animation loading-spinner >>> div.ring",
      "reduced-motion-ignored h1.hero",
      "view-transition-animates ::view-transition(root)",
    ]);
    const vt = result.findings.find((f) => f.rule === "view-transition-animates");
    expect(vt?.message).toMatch(/::view-transition-old\(root\)/);
    const spinner = result.findings.find((f) => f.rule === "infinite-animation");
    expect(spinner?.wcag).toEqual({ criterion: "2.2.2", level: "A", version: "2.0" });
    const hero = result.findings.find((f) => f.rule === "reduced-motion-ignored");
    expect(hero?.wcag).toEqual({ criterion: "2.3.3", level: "AAA", version: "2.1" });
    expect(result.viewTransitions).toHaveLength(1);
  });

  test("stays quiet on the guarded page, including its view transition", async ({ page }) => {
    await page.goto("/motion-guarded.html");
    await page.getByRole("button", { name: "Go to page two" }).click();
    const result = await motionAudit(page);
    expect(keys(result.findings)).toEqual([]);
    expect(result.viewTransitions).toHaveLength(1);
    expect(result.viewTransitions[0].animations).toEqual([]);
  });

  test("the shadow-root walk finds what document-level getAnimations misses", async ({ page }) => {
    // The assumption the walk is built on, kept as a regression test.
    await page.goto("/motion-unguarded.html");
    const seen = await page.evaluate(() => ({
      documentElement: document.documentElement
        .getAnimations({ subtree: true })
        .map((a) => /** @type {any} */ (a).animationName),
      walked: /** @type {any} */ (window).__rampCheck.collect().map((/** @type {any} */ a) => a.name),
    }));
    expect(seen.documentElement).not.toContain("spin");
    expect(seen.walked).toContain("spin");
  });
});

test.describe("motion audit without reduced motion", () => {
  test("refuses to run unless told the emulation is intentional", async ({ page }) => {
    await page.goto("/motion-guarded.html");
    await expect(motionAudit(page)).rejects.toThrow(/reducedMotion: "reduce"/);
    const result = await motionAudit(page, { requireReducedMotion: false });
    expect(result.reducedMotion).toBe(false);
  });
});
