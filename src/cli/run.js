// @ts-check
/**
 * The config-driven runner: boots Chromium, visits every configured page under
 * every matrix cell, runs the checks, applies the allowlist and the baseline,
 * and returns one report object the reporters format.
 */
import { chromium } from "@playwright/test";
import { motionRuntime } from "../checks/motion.js";
import { runChecks, formatFinding } from "../run.js";
import { cells } from "../test/matrix.js";
import { siteConsistency, PRIMARY_NAV_SELECTOR } from "../checks/consistency.js";
import { applyBaseline, buildBaseline, loadBaseline, writeBaseline } from "../checks/baseline.js";
import { resolvePolicy, severityFor } from "../policy.js";
import { applyAllowlist, loadAllowlist } from "../checks/allowlist.js";
import { normalisePage } from "./config.js";

/** @typedef {import("./config.js").SiteConfig} SiteConfig */
/** @typedef {import("../types.js").Finding} Finding */
/** @typedef {import("../run.js").CheckResult} CheckResult */
/** @typedef {import("../checks/baseline.js").LocatedFinding} LocatedFinding */

/**
 * One visited page state.
 * @typedef {object} StateReport
 * @property {string} page      page name (path by default)
 * @property {string} url
 * @property {string} cell      matrix cell name, "" without a matrix
 * @property {string} title
 * @property {CheckResult | null} result
 * @property {string | null} error  navigation or setup failure
 */

/**
 * @typedef {object} SiteReport
 * @property {string} generated   ISO timestamp
 * @property {string} policy
 * @property {string | undefined} baseURL
 * @property {StateReport[]} states
 * @property {Finding[]} consistency
 * @property {LocatedFinding[]} failing     blocking, not allowlisted, not baselined
 * @property {LocatedFinding[]} warnings
 * @property {LocatedFinding[]} allowlisted
 * @property {LocatedFinding[]} baselined
 * @property {import("../types.js").AllowlistEntry[]} expiredAllowlist
 * @property {import("../checks/baseline.js").BaselineEntry[]} expiredBaseline
 * @property {import("../checks/baseline.js").BaselineEntry[]} staleBaseline
 * @property {import("../checks/baseline.js").BaselineEntry[]} expiringSoon
 * @property {string[]} errors
 * @property {boolean} ok
 * @property {string | null} baselineWritten
 */

/**
 * @param {SiteConfig} config
 * @param {{ writeBaseline?: boolean, now?: Date, log?: (line: string) => void }} [opts]
 * @returns {Promise<SiteReport>}
 */
export async function runSite(config, opts = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const policy = resolvePolicy(config.policy);
  const matrix = cells(config.matrix ?? {});
  const browser = await chromium.launch({ headless: config.headless ?? true });
  /** @type {StateReport[]} */
  const states = [];
  /** @type {import("../checks/consistency.js").PageSnapshot[]} */
  const snapshots = [];
  const navSelector = typeof config.consistency === "object" && config.consistency.nav ? config.consistency.nav : PRIMARY_NAV_SELECTOR;
  // The allowlist and baseline are applied once over the whole site below.
  const perPage = { ...config, allowlist: undefined };

  try {
    for (const cell of matrix) {
      const { name: cellName, ...use } = cell;
      const context = await browser.newContext({
        ...use,
        baseURL: config.baseURL,
        reducedMotion: use.reducedMotion,
      });
      await context.addInitScript(motionRuntime);
      const page = await context.newPage();
      page.setDefaultTimeout(config.timeout ?? 30_000);
      try {
        if (config.setup) await config.setup(page);
        for (const raw of config.pages) {
          const entry = normalisePage(raw);
          const name = entry.name ?? entry.path;
          const label = cellName ? `${name} (${cellName})` : name;
          /** @type {StateReport} */
          const state = { page: name, url: entry.path, cell: cellName, title: "", result: null, error: null };
          try {
            await page.goto(entry.path, { waitUntil: "load" });
            if (entry.waitFor) await page.locator(entry.waitFor).first().waitFor();
            if (entry.setup) await entry.setup(page);
            state.url = page.url();
            state.title = await page.title();
            state.result = await runChecks(page, perPage, {
              label,
              reducedMotion: use.reducedMotion === "reduce",
              now,
            });
            if (config.consistency !== false) {
              const nav = page.locator(navSelector).first();
              snapshots.push({
                path: name,
                cell: cellName,
                title: state.title,
                nav: (await nav.count()) ? await nav.ariaSnapshot() : null,
              });
            }
            log(`${state.result.blocking.length ? "✘" : "✓"} ${label}`);
          } catch (err) {
            state.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
            log(`! ${label}: ${state.error}`);
          }
          states.push(state);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Site-wide checks, then severity for them (they carry no per-check override).
  const consistency = config.consistency === false ? [] : siteConsistency(snapshots);
  for (const f of consistency) {
    const sev = severityFor(f.wcag, policy, { bestPractice: config.bestPractice });
    f.severity = sev === "off" ? "warn" : sev;
  }

  /** @type {LocatedFinding[]} */
  const located = [];
  for (const s of states) {
    for (const f of s.result?.findings ?? []) located.push({ page: s.page, cell: s.cell, finding: f });
  }
  for (const f of consistency) located.push({ page: f.target, cell: String(f.data?.cell ?? ""), finding: f });

  const allowlistOutcome = applyAllowlist(located.map((l) => l.finding), loadAllowlist(config.allowlist), { now });
  const blocking = located.filter((l) => l.finding.severity === "block" && !l.finding.allowlisted);

  let baselineWritten = null;
  const previous = loadBaseline(config.baseline);
  let baselineOutcome = { baselined: /** @type {LocatedFinding[]} */ ([]), expired: /** @type {import("../checks/baseline.js").BaselineEntry[]} */ ([]), stale: /** @type {import("../checks/baseline.js").BaselineEntry[]} */ ([]), expiringSoon: /** @type {import("../checks/baseline.js").BaselineEntry[]} */ ([]) };
  if (opts.writeBaseline) {
    if (!config.baseline) throw new Error("Set `baseline: \"./a11y-baseline.json\"` in the config to use the baseline command");
    const next = buildBaseline(blocking, previous, { now, expiryDays: config.baselineExpiryDays });
    writeBaseline(config.baseline, next);
    baselineWritten = config.baseline;
    baselineOutcome = applyBaseline(blocking, next, { now });
  } else {
    baselineOutcome = applyBaseline(blocking, previous, { now });
  }

  const failing = blocking.filter((l) => !l.finding.baselined);
  const errors = states.filter((s) => s.error).map((s) => `${s.page}${s.cell ? ` (${s.cell})` : ""}: ${s.error}`);
  return {
    generated: now.toISOString(),
    policy: policy.name,
    baseURL: config.baseURL,
    states,
    consistency,
    failing,
    warnings: located.filter((l) => l.finding.severity === "warn" && !l.finding.allowlisted),
    allowlisted: located.filter((l) => l.finding.allowlisted),
    baselined: baselineOutcome.baselined,
    expiredAllowlist: allowlistOutcome.expired,
    expiredBaseline: baselineOutcome.expired,
    staleBaseline: baselineOutcome.stale,
    expiringSoon: baselineOutcome.expiringSoon,
    errors,
    ok: failing.length === 0 && allowlistOutcome.expired.length === 0 && baselineOutcome.expired.length === 0 && errors.length === 0,
    baselineWritten,
  };
}

/** @param {LocatedFinding} l */
export function formatLocated(l) {
  const where = l.cell ? `${l.page} (${l.cell})` : l.page;
  return `${where}: ${formatFinding(l.finding)}`;
}
