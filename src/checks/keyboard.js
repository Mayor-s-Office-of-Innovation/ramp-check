// @ts-check
/**
 * Keyboard audit: can a keyboard user reach, see, and leave every control?
 *
 * Presses Tab from the top of the document and records where focus lands,
 * following it into open shadow roots. Needs no knowledge of the app, so it
 * works on any page at any state. Reports:
 *
 * - keyboard-unreachable (2.1.1 A): an interactive element (native control,
 *   `[role]` widget, `[onclick]` element, or `[tabindex]`) never received
 *   focus. Members of a composite widget (tablist, menu, listbox, radio
 *   group, tree, grid, toolbar) are exempt once any member is reached, since
 *   arrow keys move focus inside those.
 * - positive-tabindex (2.4.3 A): a tabindex above zero overrides document order.
 * - keyboard-trap (2.1.2 A): Tab stopped moving focus, or the sequence never
 *   terminated or cycled within the step budget.
 * - focus-not-visible (2.4.7 AA): the focused element's computed outline,
 *   box-shadow, border, background, color and text-decoration all match its
 *   resting state, and a padded screenshot of it is byte-identical before
 *   and after focus.
 * - focus-indicator-thin (2.4.13 AAA, heuristic): the only visible change is
 *   an outline under 2 CSS px.
 * - focus-obscured (2.4.11 AA, WCAG 2.2) and focus-partially-obscured
 *   (2.4.12 AAA): `elementFromPoint` at the focused element's centre and
 *   corners resolves to something else, as under a sticky header or banner.
 * - skip-link-broken (2.4.1 A): the first Tab stop is a skip link whose
 *   activation does not move focus into its target.
 * - focus-changes-context (3.2.1 A): receiving focus navigated the page.
 *   The audit stops there, since the document it was inspecting is gone.
 * - skip-link-missing (best practice): three or more focusable elements
 *   precede the main landmark and no skip link bypasses them. axe's `bypass`
 *   rule covers the criterion itself, which landmarks also satisfy.
 *
 * Verified in Chromium (Playwright 1.63, 2026-10-01): focusing `body` resets
 * the sequential focus starting point; `el.focus()` after a keyboard event
 * keeps `:focus-visible`; screenshots of an unchanged state are
 * byte-identical; `shadowRoot.elementFromPoint` resolves inner elements;
 * Tab past the last element lands on `body` before wrapping.
 *
 * The audit moves focus and may change the URL fragment; both are restored
 * before it returns. Content inside iframes and closed shadow roots is not
 * inventoried.
 */

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("../types.js").Finding} Finding */

/**
 * @typedef {object} Candidate
 * @property {number} index
 * @property {string} path            selector path, " >>> " across shadow boundaries
 * @property {"native" | "role" | "onclick" | "tabindex"} reason
 * @property {string | null} role
 * @property {number | null} tabindex
 * @property {string | null} composite  path of the composite container, if any
 * @property {string | null} radioGroup
 * @property {boolean} beforeMain       precedes the main landmark in document order
 */

/**
 * @typedef {object} FocusStep
 * @property {number} index        candidate index, or -1 for body / an uninventoried element
 * @property {string} path
 * @property {boolean} isBody
 * @property {boolean} isFrame     focus is inside an iframe; its contents are not inventoried
 * @property {string[]} styleDiff  computed properties that changed on focus
 * @property {number} outlineWidth px, when the outline changed
 * @property {"none" | "partial" | "full" | "unknown"} obscured
 * @property {{ x: number, y: number, width: number, height: number } | null} rect  viewport-relative
 * @property {boolean} screenshotChanged  set by the fallback when styles did not change
 */

/**
 * @typedef {object} KeyboardAuditOptions
 * @property {number} [maxSteps]            Tab budget (default: 2 × candidates + 20, min 50)
 * @property {boolean} [screenshotFallback] pixel-compare when computed styles do not change (default true)
 * @property {number} [skipLinkThreshold]   focusable elements before main that warrant a skip link (default 3)
 */

/**
 * @typedef {object} KeyboardAuditResult
 * @property {Finding[]} findings
 * @property {Candidate[]} candidates
 * @property {FocusStep[]} sequence
 * @property {"end" | "cycle" | "trap" | "budget"} terminated
 * @property {string | null} modal   path of the open modal dialog that scoped the audit
 * @property {{ present: boolean, path?: string, works?: boolean }} skipLink
 */

const FOCUS_PROPS = [
  "outline-style",
  "outline-width",
  "outline-color",
  "outline-offset",
  "box-shadow",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-width",
  "background-color",
  "color",
  "text-decoration-line",
  "filter",
  "transform",
];

/**
 * In-page runtime. Self-contained; installs `window.__rampCheckKeyboard`.
 * @param {{ props: string[] }} args
 */
function keyboardRuntime({ props }) {
  const w = /** @type {any} */ (window);
  const NATIVE =
    'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable]:not([contenteditable="false"]), audio[controls], video[controls]';
  const ROLES = [
    "button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox",
    "menuitemradio", "option", "slider", "spinbutton", "textbox", "combobox", "searchbox",
    "treeitem", "gridcell", "scrollbar",
  ];
  const COMPOSITE = "[role=tablist], [role=menu], [role=menubar], [role=listbox], [role=radiogroup], [role=tree], [role=treegrid], [role=grid], [role=toolbar]";

  /** @param {Element} el */
  function selectorFor(el) {
    let s = el.localName;
    if (el.id) return `${s}#${el.id}`;
    const classes = Array.from(el.classList).slice(0, 2);
    if (classes.length) s += `.${classes.join(".")}`;
    // Siblings of the same tag share a path otherwise (five nav links are all "a").
    const root = el.getRootNode();
    const parent = el.parentElement ?? (root instanceof ShadowRoot ? root : null);
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return s;
  }
  /** @param {Element} el */
  function pathFor(el) {
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
  /** Every element in document order, descending into open shadow roots. @returns {Element[]} */
  function allElements() {
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
  }
  /** @param {Element} el */
  function visible(el) {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  /** Light-DOM-then-host ancestor walk for closest(). @param {Element} el @param {string} sel */
  function closestComposed(el, sel) {
    /** @type {Element | null} */
    let node = el;
    while (node) {
      const hit = node.closest(sel);
      if (hit) return hit;
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return null;
  }
  /** @param {Element} el */
  function excluded(el) {
    if (el.matches(":disabled")) return true;
    if (closestComposed(el, "[inert], [aria-hidden=true]")) return true;
    if (el.localName === "option" || el.closest("select")) return true;
    if (!visible(el)) return true;
    return false;
  }
  /** The deepest focused element. */
  function deepActive() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  /** @param {Element} el */
  function snapshot(el) {
    const cs = getComputedStyle(el);
    /** @type {Record<string, string>} */
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p);
    return out;
  }

  /** @type {Element[]} */
  let elements = [];
  /** @type {Record<string, string>[]} */
  let resting = [];
  /** @type {Element | null} */
  let savedActive = null;

  /** The open modal: a native `dialog:modal`, or a visible `aria-modal="true"` dialog. */
  function openModal() {
    const native = document.querySelector("dialog:modal");
    if (native) return native;
    for (const el of document.querySelectorAll('[role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]')) {
      if (visible(el)) return el;
    }
    return null;
  }

  function inventory() {
    const modal = openModal();
    const scope = modal ?? document;
    const main = document.querySelector("main, [role=main]");
    const all = allElements().filter((el) => modal ? modal.contains(el) || el.getRootNode() !== document : true);
    elements = [];
    resting = [];
    /** @type {Candidate[]} */
    const candidates = [];
    let seenMain = false;
    for (const el of all) {
      if (el === main) seenMain = true;
      if (main && main.contains(el)) seenMain = true;
      const tabindexAttr = el.getAttribute("tabindex");
      const tabindex = tabindexAttr === null ? null : Number.parseInt(tabindexAttr, 10);
      /** @type {Candidate["reason"] | null} */
      let reason = null;
      if (el.matches(NATIVE)) reason = "native";
      else if (ROLES.includes(el.getAttribute("role") ?? "")) reason = "role";
      else if (el.hasAttribute("onclick")) reason = "onclick";
      else if (tabindex !== null && tabindex >= 0) reason = "tabindex";
      if (!reason) continue;
      if (modal && !modal.contains(el) && !closestComposed(el, "dialog:modal, [aria-modal=true]")) continue;
      if (excluded(el)) continue;
      const composite = closestComposed(el, COMPOSITE);
      const radio = el instanceof HTMLInputElement && el.type === "radio" && el.name ? `${pathFor(el.form ?? document.body)}|${el.name}` : null;
      elements.push(el);
      resting.push(snapshot(el));
      candidates.push({
        index: elements.length - 1,
        path: pathFor(el),
        reason,
        role: el.getAttribute("role"),
        tabindex: Number.isNaN(tabindex) ? null : tabindex,
        composite: composite ? pathFor(composite) : null,
        radioGroup: radio,
        beforeMain: !!main && !seenMain,
      });
    }
    void scope;
    return { candidates, modal: modal ? pathFor(modal) : null, hasMain: !!main };
  }

  /** @returns {FocusStep} */
  function step() {
    const el = deepActive();
    if (!el || el === document.body || el === document.documentElement) {
      return { index: -1, path: "body", isBody: true, isFrame: false, styleDiff: [], outlineWidth: 0, obscured: "unknown", rect: null, screenshotChanged: false };
    }
    const index = elements.indexOf(el);
    const styleDiff = [];
    let outlineWidth = 0;
    if (index >= 0) {
      const now = snapshot(el);
      const before = resting[index];
      /** @param {Record<string, string>} st */
      const outlineVisible = (st) => st["outline-style"] !== "none" && (Number.parseFloat(st["outline-width"]) || 0) > 0;
      for (const p of props) {
        if (now[p] === before[p]) continue;
        // outline-offset or outline-color changing under `outline: none` draws nothing.
        if (p.startsWith("outline") && !outlineVisible(now) && !outlineVisible(before)) continue;
        styleDiff.push(p);
      }
      if (outlineVisible(now) && styleDiff.some((p) => p.startsWith("outline"))) {
        outlineWidth = Number.parseFloat(now["outline-width"]) || 0;
      }
    }
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    // Centre plus four points a quarter of the way in from each corner:
    // the corners themselves miss on rounded buttons.
    const qx = r.width / 4;
    const qy = r.height / 4;
    const points = [
      [r.x + r.width / 2, r.y + r.height / 2],
      [r.x + qx, r.y + qy],
      [r.right - qx, r.y + qy],
      [r.x + qx, r.bottom - qy],
      [r.right - qx, r.bottom - qy],
    ].filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh);
    /** @type {FocusStep["obscured"]} */
    let obscured = "unknown";
    if (points.length && r.width > 0 && r.height > 0 && getComputedStyle(el).pointerEvents !== "none") {
      const root = /** @type {Document | ShadowRoot} */ (el.getRootNode());
      let covered = 0;
      for (const [x, y] of points) {
        const hit = root.elementFromPoint(x, y);
        if (!hit || (hit !== el && !el.contains(hit))) covered++;
      }
      obscured = covered === 0 ? "none" : covered === points.length ? "full" : "partial";
    }
    return {
      index,
      path: pathFor(el),
      isBody: false,
      isFrame: el.localName === "iframe",
      styleDiff,
      outlineWidth,
      obscured,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      screenshotChanged: false,
    };
  }

  w.__rampCheckKeyboard = {
    inventory,
    step,
    /** Put the sequential focus starting point at the top of the document. */
    reset() {
      const anchor = openModal() ?? document.body;
      const had = anchor.hasAttribute("tabindex");
      if (!had) anchor.setAttribute("tabindex", "-1");
      /** @type {HTMLElement} */ (anchor).focus();
      if (!had) anchor.removeAttribute("tabindex");
    },
    blur() {
      /** @type {any} */ (deepActive())?.blur?.();
    },
    /** @param {number} index */
    focus(index) {
      /** @type {any} */ (elements[index])?.focus?.();
    },
    /** Describe the first Tab stop as a potential skip link. */
    skipLinkInfo() {
      const el = deepActive();
      if (!(el instanceof HTMLAnchorElement)) return null;
      const href = el.getAttribute("href") ?? "";
      if (!href.startsWith("#") || href.length < 2) return null;
      const text = (el.textContent ?? "").trim();
      const target = document.getElementById(decodeURIComponent(href.slice(1)));
      const isSkip = /skip|jump/i.test(text) || (target !== null && (target.matches("main, [role=main]") || !!target.closest("main, [role=main]")));
      if (!isSkip) return null;
      return { path: pathFor(el), text, href, hasTarget: target !== null };
    },
    /** Is focus now inside the skip link's target? @param {string} href */
    focusWithin(href) {
      const target = document.getElementById(decodeURIComponent(href.slice(1)));
      const el = deepActive();
      return !!target && !!el && (el === target || target.contains(el));
    },
    saveState() {
      const el = deepActive();
      savedActive = el && el !== document.body ? el : null;
      return { href: location.href, activePath: savedActive ? pathFor(savedActive) : null, scrollX: window.scrollX, scrollY: window.scrollY };
    },
    /** @param {{ href: string, scrollX: number, scrollY: number }} state */
    restore(state) {
      if (location.href !== state.href) history.replaceState(history.state, "", state.href);
      window.scrollTo(state.scrollX, state.scrollY);
      if (savedActive) /** @type {any} */ (savedActive).focus?.();
      else /** @type {any} */ (deepActive())?.blur?.();
    },
  };
}

/**
 * @param {Page} page
 * @param {KeyboardAuditOptions} [opts]
 * @returns {Promise<KeyboardAuditResult>}
 */
export async function keyboardAudit(page, opts = {}) {
  await page.evaluate(keyboardRuntime, { props: FOCUS_PROPS });
  const saved = await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.saveState());
  const { candidates, modal, hasMain } = /** @type {{ candidates: Candidate[], modal: string | null, hasMain: boolean }} */ (
    await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.inventory())
  );
  const maxSteps = opts.maxSteps ?? Math.max(50, candidates.length * 2 + 20);
  const useScreenshots = opts.screenshotFallback !== false;

  /** @type {FocusStep[]} */
  const sequence = [];
  /** @type {KeyboardAuditResult["terminated"]} */
  let terminated = "budget";
  let repeats = 0;
  let wrapped = false;

  /** @type {Finding | null} */
  let contextChange = null;
  const startUrl = page.url();
  await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.reset());
  for (let i = 0; i < maxSteps; i++) {
    await page.keyboard.press("Tab");
    /** @type {FocusStep} */
    let step;
    try {
      step = await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.step());
    } catch (err) {
      // The runtime is gone: the document was most likely replaced because the
      // element that just received focus navigated (3.2.1). Let the navigation
      // settle, then confirm by URL before reporting.
      const base = (/** @type {string} */ u) => u.split("#")[0];
      await page
        .waitForURL((u) => base(u.href) !== base(startUrl), { timeout: 3000 })
        .catch(() => {});
      if (base(page.url()) === base(startUrl)) throw err;
      // Whether the navigating element was recorded before the document went
      // away is a race, so the target is the last stop seen and the message
      // says so.
      const culprit = sequence.at(-1)?.path ?? "the first Tab stop";
      contextChange = {
        check: "keyboard",
        rule: "focus-changes-context",
        target: culprit,
        message: `the page navigated to ${page.url()} when focus reached ${culprit} or the next Tab stop; receiving focus must not change context`,
        wcag: { criterion: "3.2.1", level: "A", version: "2.0" },
        help: "https://www.w3.org/WAI/WCAG22/Understanding/on-focus.html",
        data: { culprit, to: page.url() },
      };
      terminated = "end";
      break;
    }
    // Identity: candidate index when inventoried, else the path.
    const same = (/** @type {FocusStep} */ a, /** @type {FocusStep} */ b) =>
      a.index >= 0 || b.index >= 0 ? a.index === b.index : a.path === b.path;
    if (step.isBody) {
      // Past the last element. Starting from body walks the tabindex-0
      // elements in document order; positive-tabindex elements only come up
      // after wrapping, so wrap once before calling it the end.
      if (wrapped) {
        terminated = "end";
        break;
      }
      wrapped = true;
      continue;
    }
    const prev = sequence.at(-1);
    if (prev && same(prev, step)) {
      if (step.isFrame) continue; // Tab is moving through the iframe's contents
      repeats += 1;
      if (repeats >= 2) {
        terminated = "trap";
        break;
      }
      continue;
    }
    repeats = 0;
    if (sequence.some((s) => same(s, step))) {
      terminated = wrapped ? "end" : "cycle";
      break;
    }
    if (step.index >= 0 && step.styleDiff.length === 0 && useScreenshots && !step.isFrame) {
      step.screenshotChanged = await screenshotChanges(page, step);
    }
    sequence.push(step);
  }

  /** @type {Finding[]} */
  const findings = [];
  const seen = new Set();
  /** @param {Finding} f */
  const add = (f) => {
    const key = `${f.rule}|${f.target}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };
  const A = /** @type {const} */ ({ level: "A", version: "2.0" });
  const understanding = "https://www.w3.org/WAI/WCAG22/Understanding/";

  if (contextChange) {
    add(contextChange);
    return { findings, candidates, sequence, terminated, modal, skipLink: { present: false } };
  }

  if (terminated === "trap" || terminated === "budget") {
    const last = sequence.at(-1);
    const loop = terminated === "trap" ? [last?.path ?? "unknown"] : [...new Set(sequence.slice(-10).map((s) => s.path))];
    add({
      check: "keyboard",
      rule: "keyboard-trap",
      target: loop[0],
      message:
        terminated === "trap"
          ? "Tab no longer moves focus away from this element"
          : `focus never left the page or returned to the start within ${maxSteps} Tab presses (last stops: ${loop.join(", ")})`,
      wcag: { criterion: "2.1.2", ...A },
      help: `${understanding}no-keyboard-trap.html`,
      data: { terminated, loop },
    });
  }

  for (const c of candidates) {
    if (c.tabindex !== null && c.tabindex > 0) {
      add({
        check: "keyboard",
        rule: "positive-tabindex",
        target: c.path,
        message: `tabindex="${c.tabindex}" pulls this element out of document order; use tabindex="0" and reorder the markup instead`,
        wcag: { criterion: "2.4.3", ...A },
        help: `${understanding}focus-order.html`,
        data: { tabindex: c.tabindex },
      });
    }
  }

  const reachedIndex = new Set(sequence.map((s) => s.index).filter((i) => i >= 0));
  const reachedComposites = new Set(
    candidates.filter((c) => reachedIndex.has(c.index) && c.composite).map((c) => c.composite),
  );
  const reachedRadioGroups = new Set(
    candidates.filter((c) => reachedIndex.has(c.index) && c.radioGroup).map((c) => c.radioGroup),
  );
  for (const c of candidates) {
    if (reachedIndex.has(c.index)) continue;
    if (c.composite && reachedComposites.has(c.composite)) continue;
    if (c.radioGroup && reachedRadioGroups.has(c.radioGroup)) continue;
    if (terminated === "trap" || terminated === "budget") continue; // everything after a trap is unreachable for the same reason
    const why =
      c.reason === "onclick"
        ? "has an onclick handler but is not focusable; add tabindex=\"0\" and a role, or use a <button>"
        : c.reason === "role"
          ? `has role="${c.role}" but never receives focus; add tabindex="0"`
          : c.tabindex !== null && c.tabindex < 0
            ? "is a control with tabindex=\"-1\"; it can only be reached programmatically"
            : "never received focus during a full Tab traversal";
    add({
      check: "keyboard",
      rule: "keyboard-unreachable",
      target: c.path,
      message: why,
      wcag: { criterion: "2.1.1", ...A },
      help: `${understanding}keyboard.html`,
      data: { reason: c.reason, tabindex: c.tabindex },
    });
  }

  for (const s of sequence) {
    if (s.index < 0) continue;
    // Focus inside an iframe belongs to the frame's own document; its
    // indicator cannot be judged from outside, so only obscuring is checked.
    if (s.isFrame) {
      if (s.obscured === "full") {
        add({
          check: "keyboard",
          rule: "focus-obscured",
          target: s.path,
          message: "entirely hidden behind other content when focused (sticky header, banner, or overlay)",
          wcag: { criterion: "2.4.11", level: "AA", version: "2.2" },
          help: `${understanding}focus-not-obscured-minimum.html`,
          data: { rect: s.rect },
        });
      }
      continue;
    }
    const visibleChange = s.styleDiff.length > 0 || s.screenshotChanged;
    if (!visibleChange) {
      add({
        check: "keyboard",
        rule: "focus-not-visible",
        target: s.path,
        message: "no visible change when focused (computed styles unchanged and pixels identical)",
        wcag: { criterion: "2.4.7", level: "AA", version: "2.0" },
        help: `${understanding}focus-visible.html`,
        data: { styleDiff: s.styleDiff },
      });
    } else if (
      s.styleDiff.length &&
      s.styleDiff.every((p) => p.startsWith("outline")) &&
      s.outlineWidth > 0 &&
      s.outlineWidth < 2
    ) {
      add({
        check: "keyboard",
        rule: "focus-indicator-thin",
        target: s.path,
        message: `focus indicator is a ${s.outlineWidth}px outline; 2.4.13 expects at least a 2px perimeter`,
        wcag: { criterion: "2.4.13", level: "AAA", version: "2.2" },
        help: `${understanding}focus-appearance.html`,
        data: { outlineWidth: s.outlineWidth, styleDiff: s.styleDiff },
      });
    }
    if (s.obscured === "full") {
      add({
        check: "keyboard",
        rule: "focus-obscured",
        target: s.path,
        message: "entirely hidden behind other content when focused (sticky header, banner, or overlay)",
        wcag: { criterion: "2.4.11", level: "AA", version: "2.2" },
        help: `${understanding}focus-not-obscured-minimum.html`,
        data: { rect: s.rect },
      });
    } else if (s.obscured === "partial") {
      add({
        check: "keyboard",
        rule: "focus-partially-obscured",
        target: s.path,
        message: "partly hidden behind other content when focused",
        wcag: { criterion: "2.4.12", level: "AAA", version: "2.2" },
        help: `${understanding}focus-not-obscured-enhanced.html`,
        data: { rect: s.rect },
      });
    }
  }

  // Skip link: the first Tab stop, activated.
  /** @type {KeyboardAuditResult["skipLink"]} */
  let skipLink = { present: false };
  await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.reset());
  await page.keyboard.press("Tab");
  const info = /** @type {{ path: string, text: string, href: string, hasTarget: boolean } | null} */ (
    await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.skipLinkInfo())
  );
  if (info) {
    let works = false;
    if (info.hasTarget) {
      await page.keyboard.press("Enter");
      works = await page.evaluate((href) => /** @type {any} */ (window).__rampCheckKeyboard.focusWithin(href), info.href);
      if (!works) {
        await page.keyboard.press("Tab");
        works = await page.evaluate((href) => /** @type {any} */ (window).__rampCheckKeyboard.focusWithin(href), info.href);
      }
    }
    skipLink = { present: true, path: info.path, works };
    if (!works) {
      add({
        check: "keyboard",
        rule: "skip-link-broken",
        target: info.path,
        message: info.hasTarget
          ? `activating "${info.text}" does not move focus into ${info.href}; give the target tabindex="-1" or make sure it contains the next focusable element`
          : `"${info.text}" points at ${info.href} but no element has that id`,
        wcag: { criterion: "2.4.1", ...A },
        help: `${understanding}bypass-blocks.html`,
        data: info,
      });
    }
  } else {
    const before = candidates.filter((c) => c.beforeMain && reachedIndex.has(c.index)).length;
    const threshold = opts.skipLinkThreshold ?? 3;
    if (hasMain && before >= threshold && !modal) {
      add({
        check: "keyboard",
        rule: "skip-link-missing",
        target: sequence[0]?.path ?? "body",
        message: `${before} focusable elements precede the main landmark and the first Tab stop is not a skip link`,
        wcag: { criterion: "2.4.1", level: "best-practice", version: "2.0" },
        help: `${understanding}bypass-blocks.html`,
        data: { focusableBeforeMain: before },
      });
    }
  }

  await page.evaluate((state) => /** @type {any} */ (window).__rampCheckKeyboard.restore(state), saved);
  return { findings, candidates, sequence, terminated, modal, skipLink };
}

/**
 * Pixel fallback for focus visibility: blur, shoot, refocus, shoot, compare.
 * @param {Page} page
 * @param {FocusStep} step
 */
async function screenshotChanges(page, step) {
  if (!step.rect) return false;
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const pad = 8;
  const x = Math.max(0, step.rect.x - pad);
  const y = Math.max(0, step.rect.y - pad);
  const width = Math.min(viewport.width - x, step.rect.width + pad * 2);
  const height = Math.min(viewport.height - y, step.rect.height + pad * 2);
  if (width <= 0 || height <= 0) return false;
  const clip = { x, y, width, height };
  await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.blur());
  const blurred = await page.screenshot({ clip, animations: "disabled" });
  await page.evaluate((i) => /** @type {any} */ (window).__rampCheckKeyboard.focus(i), step.index);
  const focused = await page.screenshot({ clip, animations: "disabled" });
  return !blurred.equals(focused);
}
