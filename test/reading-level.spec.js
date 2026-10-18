// @ts-check
import { test, expect } from "@playwright/test";
import { readingLevel, analyzeReadingLevel, runChecks } from "../src/index.js";

const OTHERS = /** @type {const} */ ({ axe: "off", reflow: "off", keyboard: "off", textSpacing: "off", textResize: "off" });

test.describe("reading level", () => {
  test("scores text with the Automated Readability Index and drops proper-name candidates", () => {
    const plain = analyzeReadingLevel("The park is open all day. Dogs are welcome on a leash. Bring water on hot days.");
    expect(plain.sentences).toBe(3);
    expect(plain.words).toBe(17);
    expect(plain.grade).toBeLessThanOrEqual(4);
    const named = analyzeReadingLevel("Ask for Jordan Avery at the desk on Main Street.");
    expect(named.dropped).toBe(4);
    expect(named.words).toBe(6);
    // A line break ends a sentence even without punctuation.
    expect(analyzeReadingLevel("first item\nsecond item\nthird item").sentences).toBe(3);
    expect(analyzeReadingLevel("")).toEqual({ words: 0, sentences: 0, characters: 0, ari: 0, grade: 0, dropped: 0 });
  });

  test("reports dense main text, skipping navigation, headings, asides and hidden text", async ({ page }) => {
    await page.goto("/reading-level-advanced.html");
    const result = await readingLevel(page);
    expect(result.measured).toBe(true);
    expect(result.target).toBe("main#main");
    expect(result.stats?.grade).toBeGreaterThan(9);
    expect(result.stats?.words).toBeGreaterThanOrEqual(100);
    expect(result.findings.map((f) => `${f.rule} ${f.target}`)).toEqual(["reading-level-advanced main#main"]);
    expect(result.findings[0].wcag).toEqual({ criterion: "3.1.5", level: "AAA", version: "2.0" });
    expect(result.findings[0].message).toMatch(/grade \d+ .*supplemental/);
    // The easy sentences in the aside and the hidden paragraphs did not dilute the score.
    const loose = await readingLevel(page, { selector: "body" });
    expect(loose.stats?.grade).toBe(result.stats?.grade);
  });

  test("stays quiet on plain main text and on pages too short to measure", async ({ page }) => {
    await page.goto("/reading-level-plain.html");
    const plain = await readingLevel(page);
    expect(plain.measured).toBe(true);
    expect(plain.stats?.grade).toBeLessThanOrEqual(9);
    expect(plain.stats?.dropped).toBeGreaterThan(0);
    expect(plain.findings).toEqual([]);

    await page.goto("/clean.html");
    const short = await readingLevel(page);
    expect(short.measured).toBe(false);
    expect(short.skipped).toBe("too-short");
    expect(short.findings).toEqual([]);
  });

  test("does not measure pages in languages the formula is not calibrated for", async ({ page }) => {
    await page.setContent(
      '<html lang="es"><body><main><p>' + "Las determinaciones administrativas correspondientes permanecerán provisionales. ".repeat(30) + "</p></main></body></html>",
    );
    const result = await readingLevel(page);
    expect(result.measured).toBe(false);
    expect(result.skipped).toBe("lang-not-english");
    expect(result.findings).toEqual([]);
  });

  test("honours maxGrade and minWords", async ({ page }) => {
    await page.goto("/reading-level-plain.html");
    const plain = await readingLevel(page);
    const ceiling = (plain.stats?.grade ?? 0) - 1; // just below what the page measures
    expect((await readingLevel(page, { maxGrade: ceiling })).findings).toHaveLength(1);
    await page.goto("/reading-level-advanced.html");
    expect((await readingLevel(page, { minWords: 100000 })).skipped).toBe("too-short");
  });

  test("warns by default under every policy and blocks when promoted", async ({ page }) => {
    await page.goto("/reading-level-advanced.html");
    const def = await runChecks(page, { checks: { ...OTHERS } });
    expect(def.ran).toEqual(["readingLevel"]);
    expect(def.warnings.map((f) => f.rule)).toEqual(["reading-level-advanced"]);
    expect(def.blocking).toEqual([]);
    expect(def.readingLevel?.stats?.grade).toBeGreaterThan(9);
    const strict = await runChecks(page, { checks: { ...OTHERS, readingLevel: "block" } });
    expect(strict.blocking.map((f) => f.rule)).toEqual(["reading-level-advanced"]);
    const aa = await runChecks(page, { policy: "wcag22-aa", checks: { ...OTHERS, readingLevel: "auto" } });
    expect(aa.warnings.map((f) => f.rule)).toEqual(["reading-level-advanced"]);
    const aaa = await runChecks(page, { policy: "wcag-aaa", checks: { ...OTHERS, readingLevel: "auto" } });
    expect(aaa.blocking.map((f) => f.rule)).toEqual(["reading-level-advanced"]);
  });
});
