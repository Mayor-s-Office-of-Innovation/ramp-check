// @ts-check
/**
 * Run every enabled check against a page at its current state, apply the
 * policy and the allowlist, and return one result object. Both the Playwright
 * fixtures and the config-driven CLI runner call this.
 */
import { axeScan, settle } from "./checks/axe.js";
import { motionAudit } from "./checks/motion.js";
import { reflowCheck } from "./checks/reflow.js";
import { applyAllowlist, loadAllowlist } from "./checks/allowlist.js";
import { resolvePolicy, severityFor } from "./policy.js";

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("./types.js").Finding} Finding */
/** @typedef {import("./types.js").Mode} Mode */
/** @typedef {import("./types.js").CheckName} CheckName */
/** @typedef {import("./types.js").AllowlistEntry} AllowlistEntry */
/** @typedef {import("./policy.js").PolicyName} PolicyName */

/**
 * @typedef {object} RampCheckConfig
 * @property {PolicyName} [policy]   "wcag-aaa" (default) | "wcag22-aa" | "wcag21-aa"
 * @property {Mode} [bestPractice]   axe's non-WCAG rules: "block" (default) | "warn" | "off"
 * @property {Partial<Record<CheckName, Mode | "auto">>} [checks]
 *   per-check override. "auto" (default) lets the policy decide; "block" or
 *   "warn" forces it; "off" skips the check.
 * @property {import("./checks/motion.js").MotionAuditOptions} [motion]
 * @property {import("./checks/reflow.js").ReflowOptions} [reflow]
 * @property {string[]} [tags]       escape hatch: raw axe tags (see docs/config.md)
 * @property {string[]} [disableRules]  axe rule ids to skip entirely; prefer the allowlist
 * @property {string | AllowlistEntry[]} [allowlist]  path to JSON, or inline entries
 */

/**
 * @typedef {object} CheckResult
 * @property {string} label
 * @property {PolicyName} policy
 * @property {CheckName[]} ran
 * @property {Finding[]} findings     everything, with severity and allowlist marks
 * @property {Finding[]} blocking     severity "block", not allowlisted
 * @property {Finding[]} warnings     severity "warn", not allowlisted
 * @property {Finding[]} allowlisted
 * @property {AllowlistEntry[]} expired
 * @property {AllowlistEntry[]} unused
 * @property {import("./checks/motion.js").MotionAuditResult} [motion]
 */

/**
 * @typedef {object} RunContext
 * @property {string} [label]
 * @property {boolean} [reducedMotion]  true when the page is under reduced-motion emulation
 * @property {Date} [now]               for allowlist expiry; defaults to the wall clock
 */

/**
 * @param {Page} page
 * @param {RampCheckConfig} [config]
 * @param {RunContext} [ctx]
 * @returns {Promise<CheckResult>}
 */
export async function runChecks(page, config = {}, ctx = {}) {
  const policy = resolvePolicy(config.policy);
  const modes = config.checks ?? {};
  /** @param {CheckName} name */
  const mode = (name) => modes[name] ?? "auto";
  /** @type {CheckName[]} */
  const ran = [];
  /** @type {Finding[]} */
  const findings = [];
  /** @type {import("./checks/motion.js").MotionAuditResult | undefined} */
  let motion;

  // Motion first, before anything waits: only motion still running is visible.
  if (mode("motion") !== "off" && ctx.reducedMotion) {
    motion = await motionAudit(page, config.motion);
    findings.push(...motion.findings);
    ran.push("motion");
  }
  await settle(page);
  if (mode("axe") !== "off") {
    const axe = await axeScan(page, {
      bestPractice: config.bestPractice,
      tags: config.tags,
      disableRules: config.disableRules,
      settle: false,
    });
    findings.push(...axe.findings);
    ran.push("axe");
  }
  if (mode("reflow") !== "off") {
    const reflow = await reflowCheck(page, config.reflow);
    findings.push(...reflow.findings);
    ran.push("reflow");
  }

  for (const f of findings) {
    const override = mode(f.check);
    const sev = severityFor(f.wcag, policy, {
      bestPractice: config.bestPractice,
      override: override === "auto" ? undefined : override,
    });
    f.severity = sev === "off" ? "warn" : sev;
  }
  const { expired, unused } = applyAllowlist(findings, loadAllowlist(config.allowlist), {
    now: ctx.now,
  });

  return {
    label: ctx.label ?? "",
    policy: policy.name,
    ran,
    findings,
    blocking: findings.filter((f) => f.severity === "block" && !f.allowlisted),
    warnings: findings.filter((f) => f.severity === "warn" && !f.allowlisted),
    allowlisted: findings.filter((f) => f.allowlisted),
    expired,
    unused,
    motion,
  };
}

/**
 * One line per finding: `rule: target (message) [criterion level]`.
 * @param {Finding} f
 */
export function formatFinding(f) {
  const ref = f.wcag.level === "best-practice" ? "best practice" : `${f.wcag.criterion} ${f.wcag.level}`;
  return `${f.rule}: ${f.target} (${f.message}) [${ref}]`;
}

/**
 * The lines that should fail a test: blocking findings plus expired allowlist
 * entries. Empty means clean.
 * @param {CheckResult} result
 * @returns {string[]}
 */
export function failures(result) {
  return [
    ...result.blocking.map(formatFinding),
    ...result.expired.map(
      (e) => `allowlist entry expired ${e.expires}: ${e.rule} ${e.target} (${e.reason})`,
    ),
  ];
}
