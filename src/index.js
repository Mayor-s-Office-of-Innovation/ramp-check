// @ts-check
/**
 * ramp-check core: checks that take a Playwright `page` at the state to test
 * and return plain findings. Import "ramp-check/test" for the fixtures.
 */
export { axeScan, settle, formatTarget } from "./checks/axe.js";
export { motionAudit, motionRuntime } from "./checks/motion.js";
export { reflowCheck } from "./checks/reflow.js";
export {
  loadAllowlist,
  applyAllowlist,
  isExpired,
  entryMatches,
  targetMatches,
} from "./checks/allowlist.js";
export {
  POLICIES,
  DEFAULT_POLICY,
  resolvePolicy,
  severityFor,
  axeTagsFor,
  wcagFromAxeTags,
} from "./policy.js";
export { runChecks, formatFinding, failures } from "./run.js";

/** @typedef {import("./types.js").Finding} Finding */
/** @typedef {import("./types.js").AllowlistEntry} AllowlistEntry */
/** @typedef {import("./types.js").WcagRef} WcagRef */
/** @typedef {import("./types.js").WcagLevel} WcagLevel */
/** @typedef {import("./types.js").Severity} Severity */
/** @typedef {import("./types.js").Mode} Mode */
/** @typedef {import("./types.js").CheckName} CheckName */
/** @typedef {import("./run.js").RampCheckConfig} RampCheckConfig */
/** @typedef {import("./run.js").CheckResult} CheckResult */
/** @typedef {import("./policy.js").PolicyName} PolicyName */
/** @typedef {import("./policy.js").Policy} Policy */
