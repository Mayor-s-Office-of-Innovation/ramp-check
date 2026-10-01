// @ts-check
/**
 * `ramp-check init`: scaffold a config, an empty allowlist, and npm scripts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_TEMPLATE = `// ramp-check configuration. Docs: https://github.com/Mayor-s-Office-of-Innovation/ramp-check#readme
export default {
  // The site to check. Pages below are relative to it.
  baseURL: "http://localhost:3000",

  // Pages to visit. A string is a path; an object can add a name, a selector
  // to wait for, and a setup hook that runs after navigation (log in, open a
  // dialog) before the checks:
  //   { path: "/apply", waitFor: "form", setup: async (page) => { ... } }
  pages: ["/"],

  // Every page is checked once per combination. Add "dark" to colorScheme or
  // "mobile" to viewport to widen coverage. The "reduce" cell runs the motion
  // audit.
  matrix: {
    colorScheme: ["light"],
    reducedMotion: ["reduce"],
    viewport: ["desktop"],
  },

  // Conformance level. See docs/conformance-level.md before changing it.
  policy: "wcag-aaa",
  // policy: "wcag22-aa", // WCAG 2.2 A + AA block; AAA findings warn
  // policy: "wcag21-aa", // the ADA Title II floor; 2.2 and AAA findings warn

  // Exceptions: every entry has a rule, target, reason, and expiry date.
  allowlist: "./a11y-allowlist.json",

  // Adopting on a site with existing findings? Run \`npx ramp-check baseline\`
  // once; later runs fail only on new findings. Entries expire in 180 days.
  baseline: "./a11y-baseline.json",

  // Reports (JSON and Markdown) are written here.
  out: "ramp-check-report",
};
`;

/**
 * @param {string} cwd
 * @param {{ log?: (line: string) => void, force?: boolean }} [opts]
 * @returns {string[]} files written
 */
export function init(cwd, opts = {}) {
  const log = opts.log ?? (() => {});
  const written = [];
  const pkgPath = resolve(cwd, "package.json");
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf8")) : null;
  const configName = pkg && pkg.type !== "module" ? "ramp-check.config.mjs" : "ramp-check.config.js";

  const configPath = resolve(cwd, configName);
  if (existsSync(configPath) && !opts.force) {
    log(`${configName} already exists, leaving it alone`);
  } else {
    writeFileSync(configPath, CONFIG_TEMPLATE);
    written.push(configName);
  }

  const allowPath = resolve(cwd, "a11y-allowlist.json");
  if (!existsSync(allowPath)) {
    writeFileSync(allowPath, "[]\n");
    written.push("a11y-allowlist.json");
  }

  if (pkg) {
    pkg.scripts ??= {};
    let changed = false;
    for (const [name, cmd] of [["a11y", "ramp-check"], ["a11y:baseline", "ramp-check baseline"]]) {
      if (!pkg.scripts[name]) {
        pkg.scripts[name] = cmd;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      written.push("package.json (scripts a11y, a11y:baseline)");
    }
  }

  for (const f of written) log(`wrote ${f}`);
  log("");
  log("Next:");
  log(`  1. Edit ${configName}: set baseURL and list your pages.`);
  log("  2. npx playwright install chromium");
  log("  3. npx ramp-check");
  log("  Existing findings? npx ramp-check baseline, then fix them over time.");
  return written;
}
