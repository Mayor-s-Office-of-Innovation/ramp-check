// @ts-check
// Exercises the public entry point exactly as an adopter would.
import { test, expect, a11yMatrix, cells } from "ramp-check/test";

a11yMatrix({ colorScheme: ["light", "dark"], reducedMotion: ["reduce"] }, (cell) => {
  test(`clean page passes a11y.check (${cell.name})`, async ({ page, a11y }) => {
    await page.goto("/clean.html");
    const result = await a11y.check("clean");
    expect(result.ran).toEqual(["motion", "axe", "reflow", "textSpacing", "textResize", "readingLevel", "keyboard"]);
    expect(result.policy).toBe("wcag-aaa");
  });
});

test.describe("a11y.check under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("fails with every blocking finding named in the message", async ({ page, a11y }) => {
    await page.goto("/motion-unguarded.html");
    await expect(a11y.check("unguarded")).rejects.toThrow(
      /infinite-animation: loading-spinner >>> div\.ring/,
    );
  });

  test("records view transitions even though the page loaded before the fixture ran", async ({ page, a11y }) => {
    await page.goto("/motion-unguarded.html");
    await page.getByRole("button", { name: "Go to page two" }).click();
    const result = await a11y.scan("after view transition");
    expect(result.blocking.map((f) => f.rule)).toContain("view-transition-animates");
  });

  test("per-call overrides turn a check off", async ({ page, a11y }) => {
    await page.goto("/motion-unguarded.html");
    const result = await a11y.scan("no motion", { checks: { motion: "off" } });
    expect(result.ran).toEqual(["axe", "reflow", "textSpacing", "textResize", "readingLevel", "keyboard"]);
    expect(result.blocking).toEqual([]);
  });
});

test.describe("highlight screenshot attachment", () => {
  test.use({ a11yConfig: { policy: "wcag22-aa", checks: { reflow: "off", keyboard: "off", readingLevel: "off" } } });

  test("a failing check attaches the boxed page and numbers the failure lines", async ({ page, a11y }, testInfo) => {
    await page.goto("/axe-contrast.html");
    await expect(a11y.check("contrast")).rejects.toThrow(/\[1\] color-contrast: #fails-aa/);
    const names = testInfo.attachments.map((a) => `${a.name} ${a.contentType}`);
    expect(names).toContain("ramp-check: contrast application/json");
    expect(names).toContain("ramp-check: contrast (highlighted) image/png");
    const json = JSON.parse(String(testInfo.attachments.find((a) => a.contentType === "application/json")?.body));
    expect(json.findings.map((/** @type {any} */ f) => [f.rule, f.marker]).sort((/** @type {any} */ a, /** @type {any} */ b) => a[1] - b[1])).toEqual([
      ["color-contrast", 1],
      ["image-alt", 2],
      ["color-contrast-enhanced", 3], // the warning, numbered after the blocking ones
    ]);
    expect(testInfo.annotations.filter((a) => a.type === "a11y-not-in-screenshot")).toEqual([]);
  });

  test("screenshot: { mode: \"off\" } attaches only the JSON", async ({ page, a11y }, testInfo) => {
    await page.goto("/axe-contrast.html");
    await expect(a11y.check("contrast", { screenshot: { mode: "off" } })).rejects.toThrow(/^(?!.*\[\d+\] )/s);
    expect(testInfo.attachments.map((a) => a.contentType)).toEqual(["application/json"]);
  });
});

test.describe("a11yConfig option", () => {
  test.use({ a11yConfig: { policy: "wcag22-aa", checks: { reflow: "off", keyboard: "off" } } });

  test("sets the policy for every check in the block", async ({ page, a11y }) => {
    await page.goto("/axe-contrast.html");
    const result = await a11y.scan("contrast at AA");
    expect(result.policy).toBe("wcag22-aa");
    expect(result.ran).toEqual(["axe", "textSpacing", "textResize", "readingLevel"]);
    expect(result.warnings.map((f) => `${f.rule} ${f.target}`)).toContain("color-contrast-enhanced #aa-only");
  });
});

test("matrix cells: cartesian product, named viewports resolved, stable names", () => {
  const out = cells({ colorScheme: ["light", "dark"], viewport: ["mobile", { width: 1024, height: 700 }] });
  expect(out.map((c) => c.name)).toEqual([
    "colorScheme: light, viewport: mobile",
    "colorScheme: light, viewport: 1024x700",
    "colorScheme: dark, viewport: mobile",
    "colorScheme: dark, viewport: 1024x700",
  ]);
  expect(out[0].viewport).toEqual({ width: 375, height: 812 });
  expect(cells({})).toEqual([{ name: "" }]);
});

test("matrix validation rejects typos instead of silently shrinking coverage", () => {
  expect(() => cells(/** @type {any} */ ({ colourScheme: ["dark"] }))).toThrow(/unknown axis "colourScheme"/);
  expect(() => cells(/** @type {any} */ ({ colorScheme: ["drak"] }))).toThrow(/"drak" is not one of light, dark, no-preference/);
  expect(() => cells(/** @type {any} */ ({ viewport: ["phone"] }))).toThrow(/not one of mobile, tablet, desktop/);
  expect(() => cells({ reducedMotion: ["reduce", "reduce"] })).toThrow(/duplicate/);
  expect(cells({ viewport: [{ width: 1024, height: 700 }] })).toHaveLength(1);
});
