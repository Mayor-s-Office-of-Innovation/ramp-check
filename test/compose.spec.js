// @ts-check
// Mirrors an adopter with a login flow: a `page` override composed over
// ramp-check's test, driven through matrix(..., { test }) with file-level config.
import { test as base, expect, matrix, expectClean } from "ramp-check/test";
import { runChecks, formatFinding } from "ramp-check";

const test = base.extend({
  // Stand-in for a login/binding flow: navigate before the test body runs.
  page: async ({ page }, use) => {
    await page.goto("/keyboard-clean.html");
    await use(page);
  },
});

// One file-level call covers every matrix cell below; no per-cell config needed.
test.use({ a11yConfig: { policy: "wcag22-aa", checks: { textSpacing: "off" } } });

matrix({ colorScheme: ["light", "dark"] }, (cell) => {
  test(`composed page fixture passes a11y.check (${cell.name})`, async ({ page, a11y }) => {
    await expect(page).toHaveTitle("Keyboard: clean");
    const result = await a11y.check(`composed (${cell.name})`);
    expect(result.policy).toBe("wcag22-aa");
    expect(result.ran).toEqual(["axe", "reflow", "keyboard"]);
  });
}, { test });

test("warnings are printed on a passing run, and silenced with reportWarnings: quiet", async ({ page, a11y }) => {
  await page.goto("/axe-contrast.html");
  /** @type {string[]} */
  const lines = [];
  const original = console.warn;
  console.warn = (/** @type {unknown[]} */ ...args) => lines.push(args.join(" "));
  try {
    const result = await a11y.scan("contrast", { checks: { keyboard: "off", reflow: "off" } });
    // Under 2.2 AA the enhanced-contrast finding is a warning; the AA failures block.
    expect(result.warnings.map((f) => f.rule)).toEqual(["color-contrast-enhanced"]);
    await expect(a11y.check("contrast", { checks: { keyboard: "off", reflow: "off" } })).rejects.toThrow();
    expect(lines).toEqual([
      "[ramp-check] contrast: 1 warning above policy wcag22-aa",
      `[ramp-check] warn: ${formatFinding(result.warnings[0])}`,
    ]);
    lines.length = 0;
    await expect(a11y.check("contrast", { checks: { keyboard: "off", reflow: "off" }, reportWarnings: "quiet" })).rejects.toThrow();
    expect(lines).toEqual([]);
  } finally {
    console.warn = original;
  }
});

test("expectClean for specs that drive runChecks directly", async ({ page }) => {
  const clean = await runChecks(page, { checks: { textSpacing: "off" } }, { label: "clean" });
  expectClean(clean);
  await page.goto("/reflow-overflow.html");
  const dirty = await runChecks(page, { checks: { keyboard: "off", axe: "off" } }, { label: "reflow page" });
  expect(() => expectClean(dirty)).toThrow(/reflow-horizontal-scroll: div#wide/);
});

test("technique ids ride along on keyboard findings", async ({ page }) => {
  await page.goto("/keyboard-focus-invisible.html");
  const result = await runChecks(page, { checks: { axe: "off", reflow: "off", textSpacing: "off" } });
  const invisible = result.blocking.find((f) => f.rule === "focus-not-visible");
  expect(invisible?.technique).toBe("F78");
  expect(formatFinding(/** @type {any} */ (invisible))).toMatch(/\[2\.4\.7 AA, F78\]$/);
});
