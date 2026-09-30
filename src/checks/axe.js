// @ts-check
/**
 * axe-core scan with two additions over a bare AxeBuilder call:
 *
 * - `settle()` first. axe samples computed styles, so an element mid-fade
 *   measures a blended, washed-out color and reports a bogus contrast
 *   violation. Finite animations are awaited; infinite ones (spinners) are
 *   ignored so the wait cannot hang.
 * - Tags derived from the policy model rather than a hand-maintained list,
 *   and each violation node turned into a `Finding` carrying the WCAG
 *   criterion and level so the policy can decide block vs. warn.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { axeTagsFor, wcagFromAxeTags } from "../policy.js";
import { motionRuntime } from "./motion.js";

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("../types.js").Finding} Finding */
/** @typedef {import("../types.js").Mode} Mode */

/**
 * Wait for finite animations and transitions, including those inside open
 * shadow roots, to finish.
 * @param {Page} page
 */
export async function settle(page) {
  await page.evaluate(motionRuntime);
  await page.evaluate(() => /** @type {any} */ (window).__rampCheck.settle());
}

/**
 * @typedef {object} AxeScanOptions
 * @property {Mode} [bestPractice]  include axe's non-WCAG rules (default: yes; "off" drops them)
 * @property {string[]} [tags]      escape hatch: raw axe tags, replaces the derived list
 * @property {string[]} [disableRules]  axe rule ids to skip entirely
 * @property {boolean} [settle]     wait for animations first (default true)
 */

/**
 * @typedef {object} AxeScanResult
 * @property {Finding[]} findings
 * @property {import("axe-core").AxeResults} raw
 */

/**
 * @param {Page} page
 * @param {AxeScanOptions} [opts]
 * @returns {Promise<AxeScanResult>}
 */
export async function axeScan(page, opts = {}) {
  if (opts.settle !== false) await settle(page);
  let builder = new AxeBuilder({ page }).withTags(axeTagsFor(opts));
  if (opts.disableRules?.length) builder = builder.disableRules(opts.disableRules);
  const raw = await builder.analyze();
  /** @type {Finding[]} */
  const findings = [];
  for (const v of raw.violations) {
    const wcag = wcagFromAxeTags(v.tags);
    for (const node of v.nodes) {
      findings.push({
        check: "axe",
        rule: v.id,
        target: formatTarget(node.target),
        message: v.help,
        wcag,
        help: v.helpUrl,
        data: { impact: v.impact, summary: node.failureSummary },
      });
    }
  }
  return { findings, raw };
}

/**
 * axe targets are one selector per frame; a shadow-DOM target is itself an
 * array of selectors, one per shadow boundary.
 * @param {import("axe-core").UnlabelledFrameSelector} target
 */
export function formatTarget(target) {
  return target
    .map((t) => (Array.isArray(t) ? t.join(" >>> ") : String(t)))
    .join(" > ");
}
