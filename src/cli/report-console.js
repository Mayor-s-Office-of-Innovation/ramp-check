// @ts-check
import { formatLocated } from "./run.js";

/** @typedef {import("./run.js").SiteReport} SiteReport */

/**
 * @param {SiteReport} r
 * @returns {string}
 */
export function consoleReport(r) {
  const lines = [];
  const states = r.states.length;
  lines.push("");
  lines.push(`ramp-check: ${r.ok ? "passed" : "failed"} (policy ${r.policy}, ${states} page state${states === 1 ? "" : "s"})`);
  if (r.errors.length) {
    lines.push("", `Errors (${r.errors.length}):`);
    for (const e of r.errors) lines.push(`  ! ${e}`);
  }
  if (r.failing.length) {
    lines.push("", `Failing (${r.failing.length}):`);
    for (const l of r.failing) lines.push(`  ✘ ${formatLocated(l)}`);
  }
  if (r.expiredAllowlist.length) {
    lines.push("", `Expired allowlist entries (${r.expiredAllowlist.length}):`);
    for (const e of r.expiredAllowlist) lines.push(`  ✘ ${e.rule} ${e.target} expired ${e.expires} (${e.reason})`);
  }
  if (r.expiredBaseline.length) {
    lines.push("", `Expired baseline entries (${r.expiredBaseline.length}), fix or renew:`);
    for (const e of r.expiredBaseline) lines.push(`  ✘ ${e.page}${e.cell ? ` (${e.cell})` : ""}: ${e.rule} ${e.target} expired ${e.expires}`);
  }
  if (r.warnings.length) {
    lines.push("", `Warnings (${r.warnings.length}, not blocking under ${r.policy}):`);
    for (const l of r.warnings) lines.push(`  ⚠ ${formatLocated(l)}`);
  }
  if (r.allowlisted.length) {
    lines.push("", `Allowlisted (${r.allowlisted.length}):`);
    for (const l of r.allowlisted) {
      const e = /** @type {import("../types.js").AllowlistEntry} */ (l.finding.allowlisted);
      lines.push(`  · ${formatLocated(l)} until ${e.expires}`);
    }
  }
  if (r.baselined.length || r.staleBaseline.length) {
    lines.push("", `Baseline: ${r.baselined.length} known finding${r.baselined.length === 1 ? "" : "s"} still outstanding` +
      (r.expiringSoon.length ? `, ${r.expiringSoon.length} expiring within 30 days` : "") +
      (r.staleBaseline.length ? `, ${r.staleBaseline.length} fixed (rerun \`ramp-check baseline\` to drop them)` : ""));
  }
  if (r.baselineWritten) lines.push("", `Baseline written: ${r.baselineWritten} (${r.baselined.length} entries)`);
  lines.push("");
  return lines.join("\n");
}
