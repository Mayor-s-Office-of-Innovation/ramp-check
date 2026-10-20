// @ts-check
/**
 * The config-driven runner: boots Chromium, visits every configured page under
 * every matrix cell, runs the checks, applies the allowlist and the baseline,
 * and returns one report object the reporters format.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { motionRuntime } from "../checks/motion.js";
import { highlightFindings } from "../screenshot.js";
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
 * @property {StateScreenshot | null} screenshot  highlight screenshot, when one was written
 */

/**
 * @typedef {object} StateScreenshot
 * @property {string} file      file name inside `SiteReport.screenshotDir`
 * @property {number} markers   boxes drawn
 * @property {{ rule: string, target: string, reason: string }[]} unlocated  findings the image could not box
 */

/**
 * @typedef {object} SiteReport
 * @property {string} generated   ISO timestamp
 * @property {string} policy
 * @property {string | undefined} baseURL
 * @property {string | null} screenshotDir  where highlight screenshots were written, if anywhere
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
 * @param {{ writeBaseline?: boolean, now?: Date, log?: (line: string) => void, screenshotDir?: string }} [opts]
 *   `screenshotDir`: write one highlight screenshot per state here (unless
 *   `config.screenshot.mode` is "off"); without it none are taken.
 * @returns {Promise<SiteReport>}
 */
export async function runSite(config, opts = {}) {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const policy = resolvePolicy(config.policy);
  const allowEntries = loadAllowlist(config.allowlist);
  const previous = loadBaseline(config.baseline);
  const screenshotDir = opts.screenshotDir && config.screenshot?.mode !== "off" ? opts.screenshotDir : null;
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
  let shots = 0;
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
      // storageState lets a logged-in session (saved once with
      // context.storageState()) start every cell, instead of a setup hook
      // logging in once per cell: fewer code redemptions, no per-cell devices.
      const context = await browser.newContext({
        ...use,
        baseURL: config.baseURL,
        reducedMotion: use.reducedMotion,
        storageState: config.storageState,
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
          const state = { page: name, url: entry.path, cell: cellName, title: "", result: null, error: null, screenshot: null };
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
            if (screenshotDir) {
              // The allowlist and baseline are applied site-wide below; mark
              // this page's findings now so exceptions get no box and the
              // numbers match the final report.
              const findings = state.result.findings;
              applyAllowlist(findings, allowEntries, { now });
              applyBaseline(
                findings.filter((f) => f.severity === "block" && !f.allowlisted).map((f) => ({ page: name, cell: cellName, finding: f })),
                previous,
                { now },
              );
              const shot = await highlightFindings(page, findings, config.screenshot);
              if (shot) {
                const file = `${String(++shots).padStart(2, "0")}-${slug(label)}.png`;
                writeFileSync(join(screenshotDir, file), shot.png);
                state.screenshot = {
                  file,
                  markers: shot.markers.length,
                  unlocated: shot.unlocated.map((u) => ({ rule: u.finding.rule, target: u.finding.target, reason: u.reason })),
                };
              }
            }
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

  const allowlistOutcome = applyAllowlist(located.map((l) => l.finding), allowEntries, { now });
  const blocking = located.filter((l) => l.finding.severity === "block" && !l.finding.allowlisted);

  let baselineWritten = null;
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
    screenshotDir: shots ? screenshotDir : null,
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

/** File-name-safe version of a state label. @param {string} s */
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page";
}

/** @param {LocatedFinding} l */
export function formatLocated(l) {
  const where = l.cell ? `${l.page} (${l.cell})` : l.page;
  return `${where}: ${formatFinding(l.finding)}`;
}
