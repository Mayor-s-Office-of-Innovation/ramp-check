// @ts-check
/**
 * Load and normalise `ramp-check.config.js`. The file is JavaScript, not JSON,
 * so a login hook is possible. It exports a default object:
 *
 *   export default {
 *     baseURL: "https://preview.example.gov",
 *     pages: ["/", "/services", { path: "/apply", setup: login, waitFor: "form" }],
 *     matrix: { colorScheme: ["light", "dark"], reducedMotion: ["reduce"], viewport: ["mobile", "desktop"] },
 *     policy: "wcag-aaa",
 *     allowlist: "./a11y-allowlist.json",
 *     baseline: "./a11y-baseline.json",
 *   };
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("../run.js").RampCheckConfig} RampCheckConfig */
/** @typedef {import("../test/matrix.js").MatrixAxes} MatrixAxes */

/**
 * @typedef {object} PageEntry
 * @property {string} path            path relative to baseURL, or an absolute URL
 * @property {string} [name]          label in reports (default: the path)
 * @property {(page: Page) => Promise<void> | void} [setup]  runs after navigation, before the checks
 * @property {string} [waitFor]       a selector to wait for before checking
 */

/**
 * @typedef {RampCheckConfig & {
 *   baseURL?: string,
 *   pages: (string | PageEntry)[],
 *   setup?: (page: Page) => Promise<void> | void,
 *   matrix?: MatrixAxes,
 *   baseline?: string,
 *   baselineExpiryDays?: number,
 *   consistency?: boolean | { nav?: string },
 *   out?: string,
 *   timeout?: number,
 *   headless?: boolean,
 * }} SiteConfig
 */

export const CONFIG_NAMES = ["ramp-check.config.js", "ramp-check.config.mjs", "ramp-check.config.cjs"];

/**
 * @param {string | undefined} explicit  path from --config
 * @param {string} cwd
 * @returns {string}
 */
export function findConfig(explicit, cwd) {
  if (explicit) {
    const p = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (!existsSync(p)) throw new Error(`Config not found: ${p}`);
    return p;
  }
  for (const name of CONFIG_NAMES) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  throw new Error(`No ${CONFIG_NAMES[0]} found in ${cwd}. Run \`npx ramp-check init\` to create one.`);
}

/**
 * @param {string} file  absolute path
 * @returns {Promise<SiteConfig & { configDir: string }>}
 */
export async function loadConfig(file) {
  const mod = await import(pathToFileURL(file).href);
  const config = /** @type {SiteConfig} */ (mod.default ?? mod);
  validate(config, file);
  const configDir = dirname(file);
  // Paths in the config are relative to the config file.
  const rel = (/** @type {string | undefined} */ p) => (p && !isAbsolute(p) ? resolve(configDir, p) : p);
  return {
    ...config,
    allowlist: typeof config.allowlist === "string" ? rel(config.allowlist) : config.allowlist,
    baseline: rel(config.baseline),
    out: rel(config.out ?? "ramp-check-report"),
    configDir,
  };
}

/**
 * @param {SiteConfig} config
 * @param {string} file
 */
function validate(config, file) {
  const problems = [];
  if (!config || typeof config !== "object") problems.push("default export must be an object");
  else {
    if (!Array.isArray(config.pages) || config.pages.length === 0) problems.push("`pages` must be a non-empty array");
    for (const [i, p] of (config.pages ?? []).entries()) {
      const path = typeof p === "string" ? p : p?.path;
      if (typeof path !== "string" || !path) problems.push(`pages[${i}] needs a path`);
      if (typeof path === "string" && !/^https?:\/\//.test(path) && !config.baseURL) {
        problems.push(`pages[${i}] "${path}" is relative but no baseURL is set`);
      }
    }
    if (config.baselineExpiryDays !== undefined && !(config.baselineExpiryDays > 0)) problems.push("`baselineExpiryDays` must be positive");
  }
  if (problems.length) throw new Error(`Invalid config ${file}:\n  ${problems.join("\n  ")}`);
}

/**
 * @param {string | PageEntry} entry
 * @returns {PageEntry}
 */
export function normalisePage(entry) {
  return typeof entry === "string" ? { path: entry } : entry;
}
