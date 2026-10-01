// @ts-check
/**
 * Run every enabled check against a page at its current state, apply the
 * policy and the allowlist, and return one result object. Both the Playwright
 * fixtures and the config-driven CLI runner call this.
 */
import { axeScan, settle } from "./checks/axe.js";
import { motionAudit } from "./checks/motion.js";
import { reflowCheck } from "./checks/reflow.js";
import { keyboardAudit } from "./checks/keyboard.js";
import { textSpacing } from "./checks/text-spacing.js";
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
 *   "warn" forces it; "off" skips the check. `textSpacing` defaults to "warn".
 * @property {import("./checks/motion.js").MotionAuditOptions} [motion]
 * @property {import("./checks/reflow.js").ReflowOptions} [reflow]
 * @property {import("./checks/keyboard.js").KeyboardAuditOptions} [keyboard]
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
 * @property {import("./checks/keyboard.js").KeyboardAuditResult} [keyboard]
 * @property {import("./checks/text-spacing.js").TextSpacingResult} [textSpacing]
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
  const modes = config.checks ?? {};
  /** @param {CheckName} name */
  const mode = (name) => modes[name] ?? (name === "textSpacing" ? "warn" : "auto");
  /** @type {CheckName[]} */
  const ran = [];
  /** @type {Finding[]} */
  const findings = [];
  /** @type {import("./checks/motion.js").MotionAuditResult | undefined} */
  let motion;
  /** @type {import("./checks/keyboard.js").KeyboardAuditResult | undefined} */
  let keyboard;
  /** @type {import("./checks/text-spacing.js").TextSpacingResult | undefined} */
  let spacing;

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
  if (mode("textSpacing") !== "off") {
    spacing = await textSpacing(page);
    findings.push(...spacing.findings);
    ran.push("textSpacing");
  }
  // Keyboard last: it moves focus (restored afterwards) and is the slowest.
  if (mode("keyboard") !== "off") {
    keyboard = await keyboardAudit(page, config.keyboard);
    findings.push(...keyboard.findings);
    ran.push("keyboard");
  }

  const classified = classify(findings, config, ctx);
  return { label: ctx.label ?? "", ran, ...classified, motion, keyboard, textSpacing: spacing };
}

/**
 * Apply the policy (severity) and the allowlist to any findings list. Used by
 * `runChecks` and by the fixtures' `a11y.assert` for pattern findings.
 * @param {Finding[]} findings
 * @param {RampCheckConfig} [config]
 * @param {{ now?: Date }} [ctx]
 */
export function classify(findings, config = {}, ctx = {}) {
  const policy = resolvePolicy(config.policy);
  const modes = config.checks ?? {};
  for (const f of findings) {
    const override = modes[f.check] ?? (f.check === "textSpacing" ? "warn" : "auto");
    const sev = severityFor(f.wcag, policy, {
      bestPractice: config.bestPractice,
      override: override === "auto" ? undefined : override,
    });
    f.severity = sev === "off" ? "warn" : sev;
  }
  const { expired, unused } = applyAllowlist(findings, loadAllowlist(config.allowlist), { now: ctx.now });
  return {
    policy: policy.name,
    findings,
    blocking: findings.filter((f) => f.severity === "block" && !f.allowlisted),
    warnings: findings.filter((f) => f.severity === "warn" && !f.allowlisted),
    allowlisted: findings.filter((f) => f.allowlisted),
    expired,
    unused,
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
