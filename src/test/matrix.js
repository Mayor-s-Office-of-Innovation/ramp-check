// @ts-check
/**
 * `matrix()` generates one correctly scoped describe block per combination of
 * emulation options. Each block owns its own `test.use()`, so the pitfall of
 * repeated file-scope `test.use()` calls (they all append to the same suite
 * and the last value wins for every test) cannot happen.
 */
import { test as base } from "@playwright/test";

/** @typedef {import("@playwright/test").TestType<any, any>} AnyTest */

export const VIEWPORTS = /** @type {const} */ ({
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
});

/**
 * @typedef {object} MatrixAxes
 * @property {("light" | "dark" | "no-preference")[]} [colorScheme]
 * @property {("reduce" | "no-preference")[]} [reducedMotion]
 * @property {("active" | "none")[]} [forcedColors]
 * @property {(keyof typeof VIEWPORTS | { width: number, height: number })[]} [viewport]
 */

/**
 * @typedef {object} MatrixCell
 * @property {"light" | "dark" | "no-preference"} [colorScheme]
 * @property {"reduce" | "no-preference"} [reducedMotion]
 * @property {"active" | "none"} [forcedColors]
 * @property {{ width: number, height: number }} [viewport]
 * @property {string} name  e.g. "colorScheme: dark, reducedMotion: reduce"
 */

/**
 * @param {MatrixAxes} axes
 * @param {(cell: MatrixCell) => void} body  declares tests; runs once per cell
 * @param {{ test?: AnyTest }} [opts]  the `test` to declare with (default: Playwright's)
 */
export function matrix(axes, body, opts = {}) {
  const t = opts.test ?? base;
  for (const cell of cells(axes)) {
    t.describe(cell.name, () => {
      const { name, ...use } = cell;
      t.use(use);
      body(cell);
    });
  }
}

/**
 * The cartesian product of the axes, as cells with resolved viewports and a
 * stable display name.
 * @param {MatrixAxes} axes
 * @returns {MatrixCell[]}
 */
export function cells(axes) {
  validateAxes(axes);
  const keys = /** @type {(keyof MatrixAxes)[]} */ (Object.keys(axes)).filter(
    (k) => Array.isArray(axes[k]) && /** @type {unknown[]} */ (axes[k]).length > 0,
  );
  /** @type {Record<string, unknown>[]} */
  let combos = [{}];
  for (const key of keys) {
    const values = /** @type {unknown[]} */ (axes[key]);
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [key]: v })));
  }
  return combos.map((c) => {
    const cell = /** @type {MatrixCell} */ ({ ...c, name: "" });
    const labels = [];
    for (const key of keys) {
      const v = c[key];
      if (key === "viewport") {
        if (typeof v === "string") {
          cell.viewport = VIEWPORTS[/** @type {keyof typeof VIEWPORTS} */ (v)];
          labels.push(`viewport: ${v}`);
        } else {
          const vp = /** @type {{ width: number, height: number }} */ (v);
          cell.viewport = vp;
          labels.push(`viewport: ${vp.width}x${vp.height}`);
        }
      } else {
        labels.push(`${key}: ${v}`);
      }
    }
    cell.name = labels.join(", ");
    return cell;
  });
}

const ALLOWED = /** @type {Record<string, string[] | null>} */ ({
  colorScheme: ["light", "dark", "no-preference"],
  reducedMotion: ["reduce", "no-preference"],
  forcedColors: ["active", "none"],
  viewport: null, // names from VIEWPORTS or { width, height }
});

/**
 * Fail loudly on a typo: a misspelled axis or value would otherwise silently
 * shrink coverage.
 * @param {MatrixAxes} axes
 */
export function validateAxes(axes) {
  const problems = [];
  for (const [key, values] of Object.entries(axes)) {
    if (!(key in ALLOWED)) {
      problems.push(`unknown axis "${key}" (allowed: ${Object.keys(ALLOWED).join(", ")})`);
      continue;
    }
    if (!Array.isArray(values)) {
      problems.push(`axis "${key}" must be an array`);
      continue;
    }
    for (const v of values) {
      if (key === "viewport") {
        const ok = (typeof v === "string" && v in VIEWPORTS) || (typeof v === "object" && v !== null && v.width > 0 && v.height > 0);
        if (!ok) problems.push(`viewport ${JSON.stringify(v)} is not one of ${Object.keys(VIEWPORTS).join(", ")} or { width, height }`);
      } else if (!ALLOWED[key]?.includes(/** @type {string} */ (v))) {
        problems.push(`${key} value ${JSON.stringify(v)} is not one of ${ALLOWED[key]?.join(", ")}`);
      }
    }
    if (new Set(values.map((v) => JSON.stringify(v))).size !== values.length) problems.push(`axis "${key}" has duplicate values`);
  }
  if (problems.length) throw new Error(`Invalid matrix:\n  ${problems.join("\n  ")}`);
}
