// @ts-check
/**
 * Text spacing (1.4.12, AA, WCAG 2.1): content must survive the user raising
 * line height to 1.5, paragraph spacing to 2em, letter spacing to 0.12em and
 * word spacing to 0.16em. The check injects exactly those overrides (into the
 * document and every open shadow root), finds text that became clipped by an
 * `overflow: hidden` or `clip` box, removes the overrides, and reports.
 *
 * A box-level scroll surplus alone is not enough to report: nextjs.org's hero
 * "clips" 61px that turn out to be aria-hidden 1px gradient decoration lines,
 * and a truncate chip's 5px surplus is its own padding (the visible ellipsis
 * there is reported because `text-overflow: ellipsis` really does cut the
 * word — user-verified "Depl…"). So a hit is confirmed by a text-extent walk
 * (a text node's range rect crossing its clipping ancestor's boundary) or by
 * an ellipsize. Text that is by-design hidden (sr-only, visually-hidden
 * 1x1 boxes, inside aria-hidden subtrees) at rest is excluded: clipping
 * screen-reader-only strings is not a visual 1.4.12 failure. Validated
 * against nextjs/target/nasa/shopify during the multi-site sweep (Oct 2026).
 *
 * Only elements that were NOT clipped before the overrides are reported, so
 * deliberate truncation is not mistaken for a spacing failure (an ellipsis
 * firing only after the spacing change IS a failure — it became clipping).
 * Warn-level by default in `runChecks`, because fixed-height boxes are
 * common and some are legitimate; promote it with
 * `checks: { textSpacing: "block" }`.
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
    /**
     * Is this text's visual rendering suppressed by design (sr-only class,
     * visually-hidden one-pixel box, inside an aria-hidden subtree)? Clipping
     * by-design hidden strings is not a visual 1.4.12 failure.
     * @param {Text} node
     */
    const byDesignHidden = (node) => {
      let anc = node.parentElement;
      while (anc) {
        if (anc.getAttribute("aria-hidden") === "true") return true;
        const cs = getComputedStyle(anc);
        if (cs.position === "absolute" && (cs.width === "1px" || cs.height === "1px") && /clip|hidden/.test(`${cs.overflow}${cs.clip}`)) return true;
        if (anc instanceof SVGElement) return false;
        if (/\bsr-only\b|\bvisually-hidden\b|\bscreen-reader\b/.test(anc.className)) return true;
        anc = anc.parentElement;
      }
      return false;
    };
    /**
     * Confirm the clip cuts real, by-design-visible text: walk text nodes,
     * compare their range rects against clipping ancestors.
     * @param {Element} clipper
     */
    const cutsText = (clipper) => {
      const cr = clipper.getBoundingClientRect();
      const clipsX = getComputedStyle(clipper).overflowX === "hidden" || getComputedStyle(clipper).overflowX === "clip";
      const clipsY = getComputedStyle(clipper).overflowY === "hidden" || getComputedStyle(clipper).overflowY === "clip";
      const walker = document.createTreeWalker(clipper, NodeFilter.SHOW_TEXT);
      /** @type {Text | null} */
      let node;
      let best = /** @type {{ past: number, direction: "bottom" | "right" | "none" }} */ ({ past: 0, direction: "none" });
      while ((node = /** @type {Text | null} */ (walker.nextNode()))) {
        if (!(node.textContent ?? "").trim() || byDesignHidden(node)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rr = range.getBoundingClientRect();
        if (rr.width === 0 && rr.height === 0) continue;
        const pastY = clipsY ? rr.bottom - cr.bottom : 0;
        const pastX = clipsX ? rr.right - cr.right : 0;
        if (pastY > best.past) best = { past: pastY, direction: "bottom" };
        else if (pastX > best.past) best = { past: pastX, direction: "right" };
      }
      return best;
    };
    /**
     * Does this box visually truncate its text (ellipsis rendered) after the
     * change? Chrome ellipsizes when scroll overflow exists, even when the
     * range-glyph extent would fit (padding counts into scrollWidth).
     * @param {Element} el @param {boolean} wasClippedBefore
     */
    const ellipsizes = (el, wasClippedBefore) => {
      if (wasClippedBefore) return false; // truncated by design before any change
      const cs = getComputedStyle(el);
      return cs.textOverflow === "ellipsis" && (el.scrollWidth > el.clientWidth + 1);
    };

    const styles = roots.map((root) => {
      const style = document.createElement("style");
      style.setAttribute("data-ramp-check", "text-spacing");
      style.textContent = css;
      (root instanceof Document ? root.head : root).append(style);
      return style;
    });
    // Force layout, measure, clean up.
    void document.body.offsetHeight;
    const hits = [];
    for (const el of clippers) {
      if (before.get(el) || !clipped(el)) continue; // not newly clipped by the change
      const textCut = cutsText(el);
      const viaEllipsis = ellipsizes(el, false);
      if (textCut.past <= 0.5 && !viaEllipsis) continue; // box surplus without a text crossing: deco/padding artifact
      hits.push({
        target: pathFor(el),
        overflowY: el.scrollHeight - el.clientHeight,
        overflowX: el.scrollWidth - el.clientWidth,
        text: (el.textContent ?? "").trim().slice(0, 60),
        via: textCut.past > 0.5 ? `text-crossing-${textCut.direction}` : "ellipsis",
      });
    }
    for (const s of styles) s.remove();
    return { hits, measured: clippers.length };
  }, TEXT_SPACING_CSS);

  /** @type {Finding[]} */
  const findings = result.hits.map((h) => ({
    check: "textSpacing",
    rule: "text-spacing-clipped",
    target: h.target,
    message: `clips ${h.overflowY > 0 ? `${h.overflowY}px vertically` : `${h.overflowX}px horizontally`} once line height is 1.5 and letter, word and paragraph spacing are raised; let the box grow or scroll (${h.via === "ellipsis" ? "an ellipsis now hides the end of" : "text extends past"} "${h.text}")`,
    wcag: { criterion: "1.4.12", level: "AA", version: "2.1" },
    help: "https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html",
    data: { ...h },
  }));
  return { findings, measured: result.measured };
}
