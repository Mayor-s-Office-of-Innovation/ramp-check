// @ts-check
// Exercises the public entry point exactly as an adopter would.
import { test, expect, a11yMatrix, cells } from "ramp-check/test";

a11yMatrix({ colorScheme: ["light", "dark"], reducedMotion: ["reduce"] }, (cell) => {
  test(`clean page passes a11y.check (${cell.name})`, async ({ page, a11y }) => {
    await page.goto("/clean.html");
    const result = await a11y.check("clean");
    expect(result.ran).toEqual(["motion", "axe", "reflow", "keyboard"]);
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
    expect(result.ran).toEqual(["axe", "reflow", "keyboard"]);
    expect(result.blocking).toEqual([]);
  });
});

test.describe("a11yConfig option", () => {
  test.use({ a11yConfig: { policy: "wcag22-aa", checks: { reflow: "off", keyboard: "off" } } });

  test("sets the policy for every check in the block", async ({ page, a11y }) => {
    await page.goto("/axe-contrast.html");
    const result = await a11y.scan("contrast at AA");
    expect(result.policy).toBe("wcag22-aa");
    expect(result.ran).toEqual(["axe"]);
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
