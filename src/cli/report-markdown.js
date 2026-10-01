// @ts-check
/**
 * Markdown summary sized for a pull-request comment: what was checked, what
 * failed, what is allowlisted and when it expires, how much baseline debt
 * remains.
 */

/** @typedef {import("./run.js").SiteReport} SiteReport */
/** @typedef {import("../checks/baseline.js").LocatedFinding} LocatedFinding */

export const MARKDOWN_MARKER = "<!-- ramp-check-report -->";

/** @param {string} s */
const code = (s) => `\`${s.replace(/`/g, "'").replace(/\|/g, "\\|")}\``;

/**
 * @param {SiteReport} r
 * @returns {string}
 */
export function markdownReport(r) {
  const out = [MARKDOWN_MARKER];
  const pages = new Set(r.states.map((s) => s.page)).size;
  const cellsCount = new Set(r.states.map((s) => s.cell)).size;
  const status = r.ok ? "✅ passed" : "❌ failed";
  out.push(`## ramp-check: ${status}`);
  out.push("");
  out.push(`Policy ${code(r.policy)}. Checked ${pages} page${pages === 1 ? "" : "s"} × ${cellsCount} matrix cell${cellsCount === 1 ? "" : "s"} = ${r.states.length} state${r.states.length === 1 ? "" : "s"}.`);

  if (r.errors.length) {
    out.push("", `### Errors (${r.errors.length})`, "");
    for (const e of r.errors) out.push(`- ${e}`);
  }
  if (r.failing.length) {
    out.push("", `### Failing (${r.failing.length})`, "", "| Page | Rule | Target | Criterion | Detail |", "| --- | --- | --- | --- | --- |");
    for (const l of r.failing) out.push(row(l));
  }
  if (r.expiredAllowlist.length || r.expiredBaseline.length) {
    out.push("", `### Expired exceptions (${r.expiredAllowlist.length + r.expiredBaseline.length})`, "");
    for (const e of r.expiredAllowlist) out.push(`- allowlist: ${code(e.rule)} ${code(e.target)} expired ${e.expires} (${e.reason})`);
    for (const e of r.expiredBaseline) out.push(`- baseline: ${e.page}${e.cell ? ` (${e.cell})` : ""} ${code(e.rule)} ${code(e.target)} expired ${e.expires}`);
  }
  if (r.warnings.length) {
    out.push("", `<details><summary>Warnings (${r.warnings.length}, not blocking under ${code(r.policy)})</summary>`, "", "| Page | Rule | Target | Criterion | Detail |", "| --- | --- | --- | --- | --- |");
    for (const l of r.warnings) out.push(row(l));
    out.push("", "</details>");
  }
  if (r.allowlisted.length) {
    out.push("", `<details><summary>Allowlisted (${r.allowlisted.length})</summary>`, "", "| Page | Rule | Target | Expires | Reason |", "| --- | --- | --- | --- | --- |");
    for (const l of r.allowlisted) {
      const e = /** @type {import("../types.js").AllowlistEntry} */ (l.finding.allowlisted);
      out.push(`| ${where(l)} | ${code(l.finding.rule)} | ${code(l.finding.target)} | ${e.expires} | ${cell(e.reason)} |`);
    }
    out.push("", "</details>");
  }
  if (r.baselined.length || r.staleBaseline.length) {
    out.push("", "### Baseline");
    out.push("", `${r.baselined.length} known finding${r.baselined.length === 1 ? "" : "s"} still outstanding` +
      (r.expiringSoon.length ? `, **${r.expiringSoon.length} expiring within 30 days**` : "") +
      (r.staleBaseline.length ? `, ${r.staleBaseline.length} fixed since the baseline was written` : "") + ".");
  }
  if (r.baselineWritten) out.push("", `Baseline written with ${r.baselined.length} entries.`);
  out.push("");
  return out.join("\n");
}

/** @param {LocatedFinding} l */
function where(l) {
  return l.cell ? `${cell(l.page)} (${cell(l.cell)})` : cell(l.page);
}

/** @param {LocatedFinding} l */
function row(l) {
  const f = l.finding;
  const ref = f.wcag.level === "best-practice" ? "best practice" : `${f.wcag.criterion} ${f.wcag.level}`;
  const detail = f.help ? `[${cell(f.message)}](${f.help})` : cell(f.message);
  return `| ${where(l)} | ${code(f.rule)} | ${code(f.target)} | ${ref} | ${detail} |`;
}

/**
 * Escape for a table cell. Titles, selectors and messages come from the page
 * under test, and this text lands in a pull-request comment, so HTML is
 * neutralised too.
 * @param {string} s
 */
function cell(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
