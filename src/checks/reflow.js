// @ts-check
/**
 * Reflow (1.4.10, AA, WCAG 2.1): content must present without horizontal
 * scrolling at a viewport 320 CSS px wide. The check narrows the viewport,
 * measures, names the outermost elements that stick out, and restores the
 * viewport before returning.
 */

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("../types.js").Finding} Finding */

/**
 * @typedef {object} ReflowOptions
 * @property {number} [width]  CSS px (default 320)
 */

/**
 * @typedef {object} ReflowResult
 * @property {Finding[]} findings
 * @property {number} overflow  px of horizontal overflow at the test width
 */

/**
 * @param {Page} page
 * @param {ReflowOptions} [opts]
 * @returns {Promise<ReflowResult>}
 */
export async function reflowCheck(page, opts = {}) {
  const width = opts.width ?? 320;
  const original = page.viewportSize();
  await page.setViewportSize({ width, height: original?.height ?? 800 });
  try {
    const result = await page.evaluate(() => {
      const de = document.documentElement;
      const viewport = de.clientWidth;
      const overflow = Math.max(de.scrollWidth, document.body?.scrollWidth ?? 0) - viewport;
      if (overflow <= 1) return { overflow: 0, offenders: [] };
      /** @param {Element} el */
      const selectorFor = (el) => {
        let s = el.localName;
        if (el.id) s += `#${el.id}`;
        const classes = Array.from(el.classList).slice(0, 2);
        if (classes.length) s += `.${classes.join(".")}`;
        return s;
      };
      const sticking = new Set();
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > viewport + 1) sticking.add(el);
      }
      const offenders = [];
      for (const el of sticking) {
        if (el.parentElement && sticking.has(el.parentElement)) continue;
        const r = el.getBoundingClientRect();
        offenders.push({
          target: selectorFor(el),
          width: Math.round(r.width),
          right: Math.round(r.right),
        });
      }
      return { overflow, offenders: offenders.slice(0, 10) };
    });
    /** @type {Finding[]} */
    const findings = [];
    const wcag = /** @type {const} */ ({ criterion: "1.4.10", level: "AA", version: "2.1" });
    const help = "https://www.w3.org/WAI/WCAG22/Understanding/reflow.html";
    if (result.overflow > 0 && result.offenders.length === 0) {
      findings.push({
        check: "reflow",
        rule: "reflow-horizontal-scroll",
        target: "html",
        message: `page scrolls horizontally by ${result.overflow}px at ${width}px wide`,
        wcag,
        help,
        data: { overflow: result.overflow, width },
      });
    }
    for (const o of result.offenders) {
      findings.push({
        check: "reflow",
        rule: "reflow-horizontal-scroll",
        target: o.target,
        message: `${o.width}px wide, extends ${o.right - width}px past a ${width}px viewport`,
        wcag,
        help,
        data: { ...o, overflow: result.overflow, width },
      });
    }
    return { findings, overflow: result.overflow };
  } finally {
    if (original) await page.setViewportSize(original);
  }
}
