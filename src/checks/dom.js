// @ts-check
/**
 * Shared in-page helpers for the patterns module. Self-contained so it can be
 * installed with `page.evaluate(domRuntime)`; idempotent.
 */
export function domRuntime() {
  const w = /** @type {any} */ (window);
  if (w.__rampCheckDom) return;

  /** @param {Element} el */
  function selectorFor(el) {
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
  }
  /** @param {Element | null} el */
  function pathFor(el) {
    if (!el) return "";
    const parts = [];
    /** @type {Element | null} */
    let node = el;
    while (node) {
      parts.unshift(selectorFor(node));
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return parts.join(" >>> ");
  }
  function deepActive() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el && el !== document.body ? el : null;
  }
  /** Composed containment (crosses shadow boundaries). @param {Element} outer @param {Element | null} inner */
  function contains(outer, inner) {
    /** @type {Node | null} */
    let node = inner;
    while (node) {
      if (node === outer) return true;
      const parent = node.parentNode;
      node = parent instanceof ShadowRoot ? parent.host : parent;
    }
    return false;
  }
  /** @param {Element} el */
  function visible(el) {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  /** Every element in document order, descending into open shadow roots. @returns {Element[]} */
  function allElements() {
    /** @type {Element[]} */
    const out = [];
    /** @param {Document | ShadowRoot} root */
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return out;
  }
  /** Tabbable elements inside `root`. @param {Element} root */
  function tabbables(root) {
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]';
    return allElements().filter((el) => contains(root, el) && el.matches(sel) && !el.matches(":disabled") && visible(el) && Number(el.getAttribute("tabindex") ?? 0) >= 0);
  }

  /** @type {Element[]} */
  const focusLog = [];
  document.addEventListener("focusin", () => {
    const el = deepActive();
    if (el) focusLog.push(el);
  }, true);

  w.__rampCheckDom = {
    pathFor,
    deepActive,
    contains,
    visible,
    allElements,
    tabbables,
    focusLog,
    activePath: () => pathFor(deepActive()),
    /** Last focused element not inside `el` (the trigger of a dialog, say). @param {Element} el */
    lastFocusOutside(el) {
      for (let i = focusLog.length - 1; i >= 0; i--) if (!contains(el, focusLog[i])) return focusLog[i];
      return null;
    },
    /** @param {string} selector  first visible match, searching shadow roots too */
    find(selector) {
      return allElements().find((el) => el.matches(selector) && visible(el)) ?? null;
    },
  };
}
