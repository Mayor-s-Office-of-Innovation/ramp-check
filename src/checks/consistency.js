// @ts-check
/**
 * Site consistency: checks that only a multi-page run can make.
 *
 * - duplicate-page-title (2.4.2 A): two pages share a <title>, so a user
 *   switching tabs or reading history cannot tell them apart.
 * - inconsistent-navigation (3.2.3 AA): the primary navigation's accessible
 *   structure differs between pages. Compared within one matrix cell, since
 *   viewport changes legitimately change navigation.
 *
 * Input is one record per visited page state; output is plain findings with
 * check "consistency".
 */

/** @typedef {import("../types.js").Finding} Finding */

/**
 * @typedef {object} PageSnapshot
 * @property {string} path     the page's path or URL as configured
 * @property {string} cell     matrix cell name ("" when no matrix)
 * @property {string} title    document.title
 * @property {string | null} nav  aria snapshot of the primary navigation, or null when none
 */

/**
 * @param {PageSnapshot[]} pages
 * @returns {Finding[]}
 */
export function siteConsistency(pages) {
  /** @type {Finding[]} */
  const findings = [];
  const byCell = Map.groupBy(pages, (p) => p.cell);
  for (const [cell, group] of byCell) {
    const byTitle = Map.groupBy(group, (p) => p.title.trim());
    for (const [title, same] of byTitle) {
      if (same.length < 2) continue;
      for (const p of same) {
        findings.push({
          check: "consistency",
          rule: "duplicate-page-title",
          target: p.path,
          message: `title "${title}" is shared with ${same.filter((o) => o !== p).map((o) => o.path).join(", ")}`,
          wcag: { criterion: "2.4.2", level: "A", version: "2.0" },
          help: "https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html",
          data: { cell, title, pages: same.map((o) => o.path) },
        });
      }
    }
    const withNav = group.filter((p) => p.nav !== null);
    if (withNav.length < 2) continue;
    // The most common snapshot is the reference; everything else is the outlier.
    const counts = Map.groupBy(withNav, (p) => /** @type {string} */ (p.nav));
    const [reference] = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    for (const p of withNav) {
      if (p.nav === reference) continue;
      findings.push({
        check: "consistency",
        rule: "inconsistent-navigation",
        target: p.path,
        message: `primary navigation differs from the ${counts.get(reference)?.length ?? 0} other page(s) in this cell`,
        wcag: { criterion: "3.2.3", level: "AA", version: "2.0" },
        help: "https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html",
        data: { cell, nav: p.nav, reference },
      });
    }
  }
  return findings;
}

/**
 * The selector the runner uses to find the primary navigation, first match wins.
 */
export const PRIMARY_NAV_SELECTOR = 'nav[aria-label*="primary" i], nav[aria-label*="main" i], header nav, nav, [role="navigation"]';
