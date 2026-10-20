// @ts-check
import { test, expect } from "@playwright/test";
import { highlightFindings, describeUnlocated } from "../src/index.js";

/**
 * @param {string} rule
 * @param {string} target
 * @param {"block" | "warn"} [severity]
 * @returns {import("../src/index.js").Finding}
 */
const finding = (rule, target, severity = "block") => ({
  check: "axe",
  rule,
  target,
  message: rule,
  wcag: { criterion: "1.4.3", level: "AA", version: "2.0" },
  severity,
});

/** PNG header: 8-byte signature, then the IHDR chunk with width and height. @param {Buffer} png */
function pngSize(png) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test.describe("highlight screenshots", () => {
  test("boxes each element once, numbers blocking first, and names what it could not box", async ({ page }) => {
    await page.goto("/highlight-targets.html");
    const findings = [
      finding("color-contrast-enhanced", "#muted", "warn"),
      finding("text-resize-locked", "p#muted", "block"), // same element, different selector: one box, blocking colour
      finding("tiny", "#dot", "warn"),
      finding("shadow", "x-card#card >>> button.cta"),
      finding("deep", "#deep", "warn"),
      finding("dialog", "#dlg-button"),
      finding("hidden", "#hidden"),
      finding("gone", "#does-not-exist"),
      finding("page", "html"),
      finding("transition", "::view-transition(root)"),
      finding("pseudo", "#title::before", "warn"),
    ];
    const shot = await highlightFindings(page, findings);
    if (!shot) throw new Error("expected a screenshot");

    // Blocking findings are numbered before warnings; shared elements share a number.
    expect(shot.markers.map((m) => [m.n, m.severity, m.findings.map((f) => f.rule)])).toEqual([
      [1, "block", ["text-resize-locked", "color-contrast-enhanced"]],
      [2, "block", ["shadow"]],
      [3, "block", ["dialog"]],
      [4, "warn", ["tiny"]],
      [5, "warn", ["deep"]],
      [6, "warn", ["pseudo"]],
    ]);
    expect(findings.map((f) => f.marker)).toEqual([1, 1, 4, 2, 5, 3, undefined, undefined, undefined, undefined, 6]);
    expect(describeUnlocated(shot)).toEqual([
      "hidden #hidden (no box)",
      "gone #does-not-exist (not found)",
      "page html (page-level)",
      "transition ::view-transition(root) (page-level)",
    ]);

    // Boxes sit on the elements, in document coordinates; the full page was captured.
    const muted = await page.locator("#muted").boundingBox();
    const deep = await page.locator("#deep").boundingBox();
    expect(shot.markers[0].rect).toEqual({ x: muted?.x, y: muted?.y, width: muted?.width, height: muted?.height });
    expect(shot.markers[4].rect.y).toBeGreaterThan(2000);
    expect(deep?.y).toBeGreaterThan(2000);
    expect(shot.fullPage).toBe(true);
    const size = pngSize(shot.png);
    expect(size.width).toBe(shot.width);
    expect(size.height).toBe(shot.height);
    expect(shot.height).toBeGreaterThan(2600);

    // The page is left as it was found.
    expect(await page.locator("[data-ramp-check-highlight]").count()).toBe(0);
    expect(await page.locator("#dlg").evaluate((d) => /** @type {HTMLDialogElement} */ (d).open)).toBe(true);
  });

  test("skips allowlisted and baselined findings, and warnings when asked", async ({ page }) => {
    await page.goto("/highlight-targets.html");
    const allow = finding("a", "#muted");
    allow.allowlisted = { rule: "a", target: "#muted", reason: "r", expires: "2099-01-01" };
    const base = finding("b", "#dot");
    base.baselined = { key: "k", page: "", cell: "", check: "axe", rule: "b", target: "#dot", added: "", expires: "2099-01-01" };
    const warn = finding("w", "#deep", "warn");
    const block = finding("c", "#dlg-button");

    expect(await highlightFindings(page, [allow, base])).toBeNull();
    const shot = await highlightFindings(page, [allow, base, warn, block], { warnings: false });
    expect(shot?.markers.map((m) => m.findings[0].rule)).toEqual(["c"]);
    expect(warn.marker).toBeUndefined();
  });

  test("mode: findings captures nothing on a clean result, always captures regardless, off never", async ({ page }) => {
    await page.goto("/clean.html");
    expect(await highlightFindings(page, [])).toBeNull();
    const always = await highlightFindings(page, [], { mode: "always", dim: false });
    expect(always?.markers).toEqual([]);
    expect(pngSize(/** @type {Buffer} */ (always?.png)).width).toBe(always?.width);
    expect(await highlightFindings(page, [finding("x", "h1")], { mode: "off" })).toBeNull();
  });

  test("falls back to the viewport when the document is taller than maxHeight", async ({ page }) => {
    await page.goto("/highlight-targets.html");
    const shot = await highlightFindings(page, [finding("x", "#muted")], { maxHeight: 1000 });
    expect(shot?.fullPage).toBe(false);
    const viewport = page.viewportSize();
    expect(pngSize(/** @type {Buffer} */ (shot?.png))).toEqual({ width: viewport?.width, height: viewport?.height });
  });
});
