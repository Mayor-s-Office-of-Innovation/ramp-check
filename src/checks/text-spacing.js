// @ts-check
/**
 * Text spacing (1.4.12, AA, WCAG 2.1): content must survive the user raising
 * line height to 1.5, paragraph spacing to 2em, letter spacing to 0.12em and
 * word spacing to 0.16em. The check injects exactly those overrides (into the
 * document and every open shadow root), finds text that became clipped by an
 * `overflow: hidden` or `clip` box, removes the overrides, and reports.
 *
 * Only elements that were NOT clipped before the overrides are reported, so
 * deliberate truncation is not mistaken for a spacing failure. Warn-level by
 * default in `runChecks`, because fixed-height boxes are common and some are
 * legitimate; promote it with `checks: { textSpacing: "block" }`.
 */

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("../types.js").Finding} Finding */

/**
 * @typedef {object} TextSpacingResult
 * @property {Finding[]} findings
 * @property {number} measured  elements with text and a clipping overflow that were measured
 */

export const TEXT_SPACING_CSS = `
* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }
`;

/**
 * @param {Page} page
 * @returns {Promise<TextSpacingResult>}
 */
export async function textSpacing(page) {
  const result = await page.evaluate((css) => {
    /** @param {Element} el */
    const selectorFor = (el) => {
      let s = el.localName;
      if (el.id) return `${s}#${el.id}`;
      const classes = Array.from(el.classList).slice(0, 2);
      if (classes.length) s += `.${classes.join(".")}`;
      const root = el.getRootNode();
      const parent = el.parentElement ?? (root instanceof ShadowRoot ? root : null);
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
      }
      return s;
    };
    /** @param {Element} el */
    const pathFor = (el) => {
      const parts = [];
      /** @type {Element | null} */
      let node = el;
      while (node) {
        parts.unshift(selectorFor(node));
        const root = node.getRootNode();
        node = root instanceof ShadowRoot ? root.host : null;
      }
      return parts.join(" >>> ");
    };
    /** @type {(Document | ShadowRoot)[]} */
    const roots = [document];
    /** @type {Element[]} */
    const all = [];
    /** @param {Document | ShadowRoot} root */
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        all.push(el);
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);

    /** Elements that clip and contain text. */
    const clippers = all.filter((el) => {
      const cs = getComputedStyle(el);
      const clips = (/** @type {string} */ v) => v === "hidden" || v === "clip";
      if (!clips(cs.overflowX) && !clips(cs.overflowY)) return false;
      if (!(el.textContent ?? "").trim()) return false;
      return el.getClientRects().length > 0;
    });
    /** @param {Element} el */
    const clipped = (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    const before = new Map(clippers.map((el) => [el, clipped(el)]));

    const styles = roots.map((root) => {
      const style = document.createElement("style");
      style.setAttribute("data-ramp-check", "text-spacing");
      style.textContent = css;
      (root instanceof Document ? root.head : root).append(style);
      return style;
    });
    // Force layout, measure, clean up.
    void document.body.offsetHeight;
    const hits = clippers
      .filter((el) => !before.get(el) && clipped(el))
      .map((el) => ({
        target: pathFor(el),
        overflowY: el.scrollHeight - el.clientHeight,
        overflowX: el.scrollWidth - el.clientWidth,
        text: (el.textContent ?? "").trim().slice(0, 60),
      }));
    for (const s of styles) s.remove();
    return { hits, measured: clippers.length };
  }, TEXT_SPACING_CSS);

  /** @type {Finding[]} */
  const findings = result.hits.map((h) => ({
    check: "textSpacing",
    rule: "text-spacing-clipped",
    target: h.target,
    message: `clips ${h.overflowY > 0 ? `${h.overflowY}px vertically` : `${h.overflowX}px horizontally`} once line height is 1.5 and letter, word and paragraph spacing are raised; let the box grow or scroll ("${h.text}")`,
    wcag: { criterion: "1.4.12", level: "AA", version: "2.1" },
    help: "https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html",
    data: { ...h },
  }));
  return { findings, measured: result.measured };
}
