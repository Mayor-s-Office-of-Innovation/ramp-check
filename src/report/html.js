// @ts-check
// A screenshot-first view of the same attachments used by Playwright's report.
import { readFileSync } from "node:fs";
import { resolvePolicy, severityFor } from "../policy.js";

const escape = (/** @type {unknown} */ value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

/**
 * Results contain the actual severity, but not per-check configuration.
 * Explain policy-level warnings precisely; don't guess which override was used.
 * @param {import('../types.js').Finding} finding
 * @param {import('../policy.js').PolicyName} policyName
 */
export function findingContext(finding, policyName) {
  const policy = resolvePolicy(policyName);
  if (finding.severityReason) {
    const ref =
      finding.wcag.level === "best-practice"
        ? "Best-practice check"
        : `WCAG ${finding.wcag.criterion} · Level ${finding.wcag.level}`;
    return `${ref}. ${finding.severityReason}`;
  }
  const ref =
    finding.wcag.level === "best-practice"
      ? "Best-practice check"
      : `WCAG ${finding.wcag.criterion} · Level ${finding.wcag.level}`;
  if (finding.severity !== "warn")
    return `${ref}. Blocking under the current scan settings.`;
  if (
    finding.wcag.level !== "best-practice" &&
    severityFor(finding.wcag, policy) === "warn"
  ) {
    const reasons = [];
    if (finding.wcag.level === "AAA" && policy.level === "AA") {
      reasons.push(`Level AAA is above this scan’s Level AA target`);
    }
    if (finding.wcag.version > policy.version) {
      reasons.push(
        `this criterion was introduced in WCAG ${finding.wcag.version}, after this scan’s WCAG ${policy.version} target`,
      );
    }
    return `${ref}. Warning because ${reasons.join(" and ")}. It does not fail this scan.`;
  }
  return `${ref}. Reported as a warning by the check’s default or configured severity, rather than the WCAG target level. It does not fail this scan.`;
}

const checkLabels = {
  axe: "axe accessibility checks",
  motion: "Reduced motion",
  reflow: "Reflow",
  keyboard: "Keyboard",
  textSpacing: "Text spacing",
  textResize: "Text resizing",
  readingLevel: "Readability",
  consistency: "Cross-page consistency",
  pattern: "Interaction patterns",
};

/** @param {import('../run.js').CheckResult} scan */
export function coverageSummary(scan) {
  const checks = [...new Set(scan.ran)];
  if (!checks.length)
    return "<p>No check categories were recorded for this scan.</p>";
  const rows = checks.map((check) => {
    const findings = scan.findings.filter((finding) => finding.check === check);
    const active = findings.filter(
      (finding) => !finding.allowlisted && !finding.baselined,
    );
    const blocking = active.filter(
      (finding) => finding.severity === "block",
    ).length;
    const warnings = active.filter(
      (finding) => finding.severity === "warn",
    ).length;
    const aaa = active.filter(
      (finding) => finding.severity === "warn" && finding.wcag.level === "AAA",
    ).length;
    const excepted = findings.length - active.length;
    const counts = [];
    if (blocking) counts.push(`${blocking} blocking`);
    if (warnings)
      counts.push(
        `${warnings} ${aaa === warnings ? "AAA " : ""}warning${warnings === 1 ? "" : "s"}${aaa && aaa !== warnings ? ` (${aaa} AAA)` : ""}`,
      );
    if (excepted) counts.push(`${excepted} covered by exceptions or baseline`);
    const reading = check === "readingLevel" ? scan.readingLevel : undefined;
    const notMeasured = reading?.measured === false;
    let detail = "";
    if (notMeasured) {
      const reasons = {
        "too-short": "too little text",
        "no-text": "no eligible text",
        "lang-not-english": "analysis supports English text only",
      };
      const reason =
        reasons[/** @type {keyof typeof reasons} */ (reading.skipped)] ??
        "measurement skipped";
      detail = `Not measured — ${reason}`;
    } else if (reading?.measured && reading.stats) {
      detail = `Estimated reading grade: ${reading.stats.grade} (Automated Readability Index)`;
    }
    return {
      label: checkLabels[check] ?? check,
      found: findings.length > 0,
      notMeasured,
      status: notMeasured
        ? detail
        : [counts.join("; ") || "No findings", detail]
            .filter(Boolean)
            .join(". "),
    };
  });
  const clean = rows.filter((row) => !row.found && !row.notMeasured);
  const found = rows.filter((row) => row.found);
  const skipped = rows.filter((row) => row.notMeasured && !row.found);
  return `<div class="coverage"><h4>Check coverage · ${escape(scan.label)}</h4>
<p><strong>Check categories run: ${rows.length} · With findings: ${found.length}${skipped.length ? ` · Not measured: ${skipped.length}` : ""}</strong></p>
${clean.length ? `<p class="coverage-clean-label">No findings</p><ul class="coverage-clean" role="list">${clean.map((row) => `<li><span class="check-indicator" aria-hidden="true">✓</span>${escape(row.label)}</li>`).join("")}</ul>` : ""}
${found.map((row) => `<p class="coverage-finding"><span aria-hidden="true">⚠</span> ${escape(row.label)} — ${escape(row.status)}</p>`).join("")}
${skipped.map((row) => `<p><span aria-hidden="true">—</span> ${escape(row.label)} — ${escape(row.status)}</p>`).join("")}
${checks.includes("axe") ? `<p class="coverage-description"><strong>What axe looks for:</strong> common accessibility issues in the rendered page, including text contrast, form labels, button and link names, image alternatives, ARIA markup, headings, landmarks, and page language.</p>` : ""}
<details><summary>View check details</summary><p>These are check categories, not individual axe rules. “No findings” means this automated scan reported no issues in that category.</p>${checks.includes("axe") ? `<p>axe applies automated WCAG and best-practice rules to relevant page elements. The topics above describe its coverage; this report does not retain a rule-by-rule list of passes or rules needing manual review. Keyboard, motion, and layout checks are listed separately.</p>` : ""}<ul>${rows.map((row) => `<li>${escape(row.label)} — ${escape(row.status)}</li>`).join("")}</ul></details></div>`;
}

/**
 * @typedef {object} ReportResult
 * @property {string} status
 * @property {number} retry
 * @property {{name: string, contentType: string, body?: Buffer, path?: string}[]} attachments
 * @property {{message?: string}[]} errors
 */
export class HtmlReport {
  /** @type {string[]} */
  screens = [];
  /** @type {string[]} */
  details = [];
  /** @type {Set<string>} */
  notes = new Set();
  /** @type {string[]} */
  errors = [];

  /** @param {{message?: string}} error */
  addError(error) {
    this.errors.push(`<pre>${escape(error.message)}</pre>`);
  }

  /**
   * @param {string} name
   * @param {ReportResult} result
   * @param {{type: string, description?: string}[]} [annotations]
   */
  addResult(name, result, annotations = []) {
    const title = escape(name);
    const heading = `<h3>${title}</h3><p>Status: ${escape(result.status)} · Attempt ${result.retry + 1}</p>`;
    const images = [];
    const findings = [];
    const coverage = [];
    const policies = new Set();
    for (const attachment of result.attachments) {
      if (!attachment.name.startsWith("ramp-check:")) continue;
      const body =
        attachment.body ??
        (attachment.path ? readFileSync(attachment.path) : null);
      if (!body) continue;
      if (attachment.contentType === "image/png") {
        images.push(
          `<figure><img src="data:image/png;base64,${body.toString("base64")}" alt="${escape(attachment.name)} — ${title}"><figcaption>${escape(attachment.name)}</figcaption></figure>`,
        );
      } else if (attachment.contentType === "application/json") {
        /** @type {import('../run.js').CheckResult} */
        const scan = JSON.parse(body.toString());
        coverage.push(coverageSummary(scan));
        const policy = resolvePolicy(scan.policy);
        policies.add(
          `Target: WCAG ${policy.version} Level ${policy.level}. ${policy.level === "AA" ? "AAA findings are warnings because they exceed the AA target." : "AAA findings are within this target."} Individual checks can also be configured to warn.`,
        );
        findings.push(
          `<h4>${escape(scan.label)} · ${escape(scan.policy)}</h4>`,
        );
        const active = scan.findings.filter(
          (finding) => !finding.allowlisted && !finding.baselined,
        );
        findings.push(
          active.length
            ? `<ul>${active.map((finding) => `<li><strong>${finding.marker ? `[${finding.marker}] ` : ""}${finding.severity === "warn" ? "Warning" : "Blocking"}: ${escape(finding.rule)}</strong><br><code>${escape(finding.target)}</code><p>${escape(finding.message)}</p><p>${escape(findingContext(finding, scan.policy))}</p></li>`).join("")}</ul>`
            : "<p>No active findings.</p>",
        );
        for (const entry of scan.expired) {
          findings.push(
            `<p><strong>Expired exception:</strong> ${escape(entry.rule)} ${escape(entry.target)} (expired ${escape(entry.expires)})</p>`,
          );
        }
        findings.push(
          `<details><summary>Full scan results (JSON)</summary><pre>${escape(JSON.stringify(scan, null, 2))}</pre></details>`,
        );
      }
    }
    this.screens.push(
      `<article>${heading}${[...policies].map((policy) => `<p>${escape(policy)}</p>`).join("")}${images.join("") || "<p>No highlighted screenshot was attached. See the findings and test errors below.</p>"}${coverage.join("")}</article>`,
    );
    const renderedAnnotations = [];
    for (const note of annotations) {
      if (note.type === "a11y-allowlist-unused") {
        this.notes.add(note.description ?? "");
      } else {
        renderedAnnotations.push(
          `<li>${escape(note.type)}: ${escape(note.description)}</li>`,
        );
      }
    }
    this.details.push(
      `<article>${heading}${findings.join("")}${renderedAnnotations.length ? `<ul>${renderedAnnotations.join("")}</ul>` : ""}${result.errors.map((error) => `<pre>${escape(error.message)}</pre>`).join("")}</article>`,
    );
  }

  /** @param {string} status */
  render(status) {
    return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ramp-check accessibility report</title>
<style>
  :root { font: 1rem/1.5 system-ui, sans-serif; color: #17212b; background: #f5f7f9; }
  body { margin: 0; } main { max-width: 75rem; margin: auto; padding: 1.5rem; }
  article { background: white; border: 1px solid #b6c0ca; padding: 1rem; margin-block: 1rem; border-radius: .5rem; }
  h3, li, code, figcaption { overflow-wrap: anywhere; }
  figure { margin: 1rem 0; } img { display: block; max-width: 100%; height: auto; }
  figcaption { margin-block: .5rem; } li { margin-block: 1rem; }
  .coverage { border-block-start: 1px solid #b6c0ca; margin-block-start: 1rem; }
  .coverage h4 { margin-block-end: .5rem; } .coverage p { margin-block: .5rem; }
  .coverage .coverage-clean-label { color: #166534; font-weight: 600; }
  .coverage-clean { display: flex; flex-wrap: wrap; gap: .5rem 1rem; list-style: none; padding: 0; margin-block: .5rem 1rem; }
  .coverage-clean li { display: flex; align-items: center; gap: .4rem; margin: 0; }
  .check-indicator { display: inline-grid; place-items: center; flex: 0 0 1.25rem; height: 1.25rem; border-radius: .2rem; color: white; background: #166534; font-weight: 700; }
  .coverage-finding { color: #854d0e; }
  .coverage-description { max-width: 65ch; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  summary { cursor: pointer; } summary:focus-visible { outline: 3px solid #185abc; outline-offset: 4px; }
</style>
<main><h1>ramp-check accessibility report</h1><p>Run status: <strong>${escape(status)}</strong></p>
<section aria-labelledby="screenshots"><h2 id="screenshots">Screenshots</h2><p>Numbered boxes match the findings below. Red: blocking findings. Blue: warnings.</p>${this.screens.join("") || "<p>No tests completed.</p>"}</section>
<section aria-labelledby="findings"><h2 id="findings">Findings and test details</h2>${this.errors.join("")}${this.details.join("")}</section>
<section aria-labelledby="exceptions"><h2 id="exceptions">Unused exception notes</h2><p>These exceptions matched no finding in at least one scanned state. A shared exception can be unused simply because its control is on another screen.</p>${this.notes.size ? `<ul>${[...this.notes].map((note) => `<li>${escape(note)}</li>`).join("")}</ul>` : "<p>None.</p>"}</section>
</main></html>`;
  }
}
