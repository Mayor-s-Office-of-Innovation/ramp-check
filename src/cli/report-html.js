// @ts-check
import { resolve } from "node:path";
import { resolvePolicy } from "../policy.js";
import { HtmlReport } from "../report/html.js";

/** @param {import('./run.js').SiteReport} report */
export function htmlReport(report) {
  const html = new HtmlReport();
  for (const state of report.states) {
    /** @type {import('../report/html.js').ReportResult['attachments']} */
    const attachments = [];
    if (state.result)
      attachments.push({
        name: `ramp-check: ${state.page}`,
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(state.result)),
      });
    if (state.screenshot && report.screenshotDir)
      attachments.push({
        name: `ramp-check: ${state.page} (highlighted)`,
        contentType: "image/png",
        path: resolve(report.screenshotDir, state.screenshot.file),
      });
    const active =
      state.result?.findings.filter(
        (f) => f.severity === "block" && !f.allowlisted && !f.baselined,
      ) ?? [];
    const annotations = (state.result?.unused ?? []).map((e) => ({
      type: "a11y-allowlist-unused",
      description: `${e.rule} ${e.target} (expires ${e.expires})`,
    }));
    for (const item of state.screenshot?.unlocated ?? [])
      annotations.push({
        type: "a11y-not-in-screenshot",
        description: `${item.rule} ${item.target}: ${item.reason}`,
      });
    html.addResult(
      `${state.page}${state.cell ? ` (${state.cell})` : ""}`,
      {
        status:
          state.error || active.length || state.result?.expired.length
            ? "failed"
            : "passed",
        retry: 0,
        attachments,
        errors: state.error ? [{ message: state.error }] : [],
      },
      annotations,
    );
  }
  // Site-wide failures and exception expiry must remain visible even when
  // no individual page scan failed (for example an expired baseline).
  if (report.consistency.length) {
    const scan = {
      label: "Cross-page consistency",
      policy: resolvePolicy(report.policy).name,
      ran: ["consistency"],
      findings: report.consistency,
      expired: [],
      unused: [],
    };
    html.addResult("Cross-page consistency", {
      status: report.failing.some(
        (item) => item.finding.check === "consistency",
      )
        ? "failed"
        : "passed",
      retry: 0,
      attachments: [
        {
          name: "ramp-check: consistency",
          contentType: "application/json",
          body: Buffer.from(JSON.stringify(scan)),
        },
      ],
      errors: [],
    });
  }
  for (const item of report.unusedAllowlist ?? [])
    html.notes.add(`${item.rule} ${item.target} (expires ${item.expires})`);
  for (const item of [...report.expiredAllowlist, ...report.expiredBaseline])
    html.addError({
      message: `Expired exception: ${item.rule} ${item.target} (expired ${item.expires})`,
    });
  return html.render(report.ok ? "passed" : "failed");
}
