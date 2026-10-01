// @ts-check
/**
 * Shared types. Every check returns plain `Finding` objects so the fixtures
 * layer and the CLI runner can consume them the same way.
 */

/** @typedef {"A" | "AA" | "AAA" | "best-practice"} WcagLevel */
/** @typedef {"2.0" | "2.1" | "2.2"} WcagVersion */
/** @typedef {"block" | "warn"} Severity */
/** @typedef {"block" | "warn" | "off"} Mode */
/** @typedef {"axe" | "motion" | "reflow" | "keyboard" | "textSpacing" | "consistency" | "pattern"} CheckName */

/**
 * The WCAG success criterion a finding enforces.
 * @typedef {object} WcagRef
 * @property {string} criterion  e.g. "1.4.3", or "" for best-practice rules
 * @property {WcagLevel} level
 * @property {WcagVersion} version  the WCAG version that introduced the criterion
 */

/**
 * One problem found on one target.
 * @typedef {object} Finding
 * @property {CheckName} check   which check produced it
 * @property {string} rule       rule id, unique within the check (axe rule ids are reused as-is)
 * @property {string} target     selector-like locator; shadow boundaries are written " >>> "
 * @property {string} message    one line a person can act on
 * @property {WcagRef} wcag
 * @property {string} [help]     URL with more detail
 * @property {Severity} [severity]  set by the policy, not by the check
 * @property {AllowlistEntry} [allowlisted]  set when an allowlist entry covers it
 * @property {import("./checks/baseline.js").BaselineEntry} [baselined]  set when a baseline entry covers it
 * @property {Record<string, unknown>} [data]  check-specific detail kept for reports
 */

/**
 * A time-boxed, explained exception. Every field is required.
 * @typedef {object} AllowlistEntry
 * @property {string} rule     rule id, e.g. "color-contrast-enhanced" or "infinite-animation"
 * @property {string} target   exact target string, or a prefix ending in "*"
 * @property {string} reason   why this is acceptable for now
 * @property {string} expires  ISO date (YYYY-MM-DD); the run fails once it passes
 * @property {CheckName} [check]  restrict to one check when rule ids could collide
 */

export {};
