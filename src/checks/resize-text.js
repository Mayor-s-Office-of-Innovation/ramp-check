// @ts-check
/**
 * Resize text (1.4.4, AA, WCAG 2.0): when a user raises their browser's
 * default font size, text must follow. The check emulates the raised
 * preference exactly the way Chromium applies it — doubling the document's
 * default font size — and then re-measures every text-bearing element:
 * the user's decision is "raise font size, then find any which didn't
 * increase". A computed font-size that stays identical (px, pt, or any
 * fixed unit) means the preference is ignored for that text: rem/±em-based
 * text grows, px-locked text does not — the "set exactly so it doesn't
 * grow" pattern.
 *
 * Findings blame the OUTERMOST px-locked text element only (descendants
 * inherit the size), so one root cause is one finding. The message is
 * honest about the gray zone: full-page zoom still magnifies px text;
 * what is lost is the font-size preference — the scaling low-vision users
 * who don't zoom rely on. Blocking by default (mode defaults like every
 * AA-level check, "auto"); the config can soften:
 * `checks: { textResize: "warn" }`.
 */

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("../types.js").Finding} Finding */

/**
 * @typedef {object} TextResizeResult
 * @property {Finding[]} findings
 * @property {number} measured  text-bearing elements measured
 * @property {number} [hidden]  findings beyond the 10-finding report cap
 */

/** CSS emulating a user doubling their browser's default font size. */
export const TEXT_RESIZE_CSS = `
html, :root { font-size: 200% !important; }
`;

/**
 * @param {Page} page
 * @param {{ [k: string]: any }} [opts]  reserved
 * @returns {Promise<TextResizeResult>}
 */
export async function textResize(page, opts = {}) {
  void opts;
  const result = await page.evaluate(() => {
    /**
     * Selector for one element, shadow-agnostic.
     * @param {Element} el
     */
    const selectorFor = (el) => {
      let s = el.localName;
      if (el.id) return `${s}#${el.id}`;
      const classes = Array.from(el.classList).slice(0, 2);
      if (classes.length) s += `.${classes.join(".")}`;
      const root = el.getRootNode();
      const parent = el.parentElement ?? (root instanceof ShadowRoot ? root : null);
      if (parent && parent.querySelectorAll) {
        const same = Array.from(parent.querySelectorAll(":scope > " + el.localName));
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
    /** All elements, open shadow roots included. @returns {Element[]} */
    const allElements = () => {
      /** @type {Element[]} */
      const out = [];
      /** @param {Document | ShadowRoot | Element} root */
      const walk = (root) => {
        for (const el of root.querySelectorAll("*")) {
          out.push(el);
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document);
      return out;
    };
    const px = (/** @type {string} */ v) => parseFloat(v) || 0;
    // Text-bearing: owns text directly (not via descendants), so a wrapper
    // whose size is inherited is not re-reported for its children's copy.
    /** @type {Element[]} */
    const textEls = [];
    for (const el of allElements()) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
      if (!own) continue;
      if (px(getComputedStyle(el).fontSize) <= 0) continue;
      if (!el.getClientRects().length) continue;
      textEls.push(el);
    }
    const before = textEls.map((el) => px(getComputedStyle(el).fontSize));
    const style = document.createElement("style");
    style.setAttribute("data-ramp-check", "text-resize");
    style.textContent = "html, :root { font-size: 200% !important; }";
    document.head.append(style);
    void document.body.offsetHeight;
    /** @type {{ el: Element, before: number, after: number }[]} */
    const locked = [];
    for (let i = 0; i < textEls.length; i++) {
      const after = px(getComputedStyle(textEls[i]).fontSize);
      // Unchanged (or shrunk) after the default doubled: the preference
      // does not scale this text. Epsilon for layout rounding.
      if (after <= before[i] + 0.5) locked.push({ el: textEls[i], before: before[i], after });
    }
    style.remove();
    // Blame outermost causes: drop any locked element inside another.
    const outer = locked.filter(({ el }) => !locked.some(({ el: other }) => other !== el && other.contains(el)));
    const capped = outer.slice(0, 10);
    const hits = capped.map(({ el, before: b, after: a }) => ({
      target: pathFor(el),
      before: b,
      after: a,
      text: (el.textContent ?? "").trim().slice(0, 60),
    }));
    return { hits, measured: textEls.length, hidden: outer.length - capped.length };
  });

  /** @type {Finding[]} */
  const findings = result.hits.map((h) => ({
    check: "textResize",
    rule: "text-resize-locked",
    target: h.target,
    message: `computed font size stays ${h.before}px when the default font size doubles; the font-size preference is ignored for this text (${h.before}px → ${h.after}px) — size text in rem/em/percent ("${h.text}")`,
    wcag: { criterion: "1.4.4", level: "AA", version: "2.0" },
    help: "https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html",
    data: { before: h.before, after: h.after },
  }));
  return { findings, measured: result.measured, hidden: result.hidden };
}