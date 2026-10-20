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
import { textResize } from "./checks/resize-text.js";
import { readingLevel } from "./checks/reading-level.js";
import { applyAllowlist, loadAllowlist } from "./checks/allowlist.js";
import { resolvePolicy, severityFor } from "./policy.js";

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("./types.js").Finding} Finding */

/**
 * Checks that warn unless promoted: their criterion can be satisfied by
 * something the check cannot see (legitimate fixed boxes; a supplemental
 * simpler version of the text).
 * @type {Set<string>}
 */
const WARN_BY_DEFAULT = new Set(["textSpacing", "readingLevel"]);
/** @typedef {import("./types.js").Mode} Mode */
/** @typedef {import("./types.js").CheckName} CheckName */
/** @typedef {import("./types.js").AllowlistEntry} AllowlistEntry */
/** @typedef {import("./policy.js").PolicyName} PolicyName */

/**
 * @typedef {object} RampCheckConfig
 * @property {PolicyName} [policy]   "wcag-aaa" (default) | "wcag22-aa" | "wcag21-aa"
 * @property {Mode} [bestPractice]   axe's non-WCAG rules: "block" (default) | "warn" | "off"
 * @property {Partial<Record<CheckName, Mode | "auto">>} [checks]
   * per-check override. "auto" (default) lets the policy decide; "block" or
   * "warn" forces it; "off" skips the check. `textSpacing` and `readingLevel`
   * default to "warn".
 * @property {import("./checks/motion.js").MotionAuditOptions} [motion]
 * @property {import("./checks/reflow.js").ReflowOptions} [reflow]
 * @property {import("./checks/keyboard.js").KeyboardAuditOptions} [keyboard]
 * @property {import("./checks/reading-level.js").ReadingLevelOptions} [readingLevel]
 * @property {string[]} [tags]       escape hatch: raw axe tags (see docs/config.md)
 * @property {string[]} [disableRules]  axe rule ids to skip entirely; prefer the allowlist
 * @property {string | AllowlistEntry[]} [allowlist]  path to JSON, or inline entries
 * @property {"log" | "quiet"} [reportWarnings]  fixtures only: print warnings to the test output (default "log")
 * @property {import("./screenshot.js").ScreenshotOptions} [screenshot]
 *   highlight screenshots of each checked state (fixtures attach them, the CLI writes them); `{ mode: "off" }` disables
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
 * @property {import("./checks/reading-level.js").ReadingLevelResult} [readingLevel]
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
  const mode = (name) => modes[name] ?? (WARN_BY_DEFAULT.has(name) ? "warn" : "auto");
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
  /** @type {import("./checks/reading-level.js").ReadingLevelResult | undefined} */
  let reading;

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
  if (mode("textResize") !== "off") {
    const resize = await textResize(page);
    findings.push(...resize.findings);
    ran.push("textResize");
  }
  if (mode("readingLevel") !== "off") {
    reading = await readingLevel(page, config.readingLevel);
    findings.push(...reading.findings);
    ran.push("readingLevel");
  }
  // Keyboard last: it moves focus (restored afterwards) and is the slowest.
  if (mode("keyboard") !== "off") {
    keyboard = await keyboardAudit(page, config.keyboard);
    findings.push(...keyboard.findings);
    ran.push("keyboard");
  }

  const classified = classify(findings, config, ctx);
  return { label: ctx.label ?? "", ran, ...classified, motion, keyboard, textSpacing: spacing, readingLevel: reading };
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
    const override = modes[f.check] ?? (WARN_BY_DEFAULT.has(f.check) ? "warn" : "auto");
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
 * One line per finding: `rule: target (message) [criterion level]`, led by
 * `[n]` when the finding is box n in the highlight screenshot.
 * @param {Finding} f
 */
export function formatFinding(f) {
  let ref = f.wcag.level === "best-practice" ? "best practice" : `${f.wcag.criterion} ${f.wcag.level}`;
  if (f.technique) ref += `, ${f.technique}`;
  const n = f.marker ? `[${f.marker}] ` : "";
  return `${n}${f.rule}: ${f.target} (${f.message}) [${ref}]`;
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
