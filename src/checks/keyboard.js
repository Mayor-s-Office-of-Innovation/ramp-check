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
 *   arrow keys move focus inside those, and so are roving-tabindex tabs
 *   (`role=tab` minus the `tabindex=0` selected one) once any sibling tab is
 *   reached. Two honesty guards before blaming a candidate: candidates whose
 *   node left the document since the inventory (SPA re-render) are dropped,
 *   and when a traversal cycles inside a small ring — a consent banner, a
 *   carousel — or a fresh re-walk still misses over half the candidates, one
 *   annotated finding about the ring replaces per-element blame.
 * - positive-tabindex (2.4.3 A): a tabindex above zero overrides document order.
 * - keyboard-trap (2.1.2 A): Tab stopped moving focus, or the sequence never
 *   terminated or cycled within the step budget.
 * - focus-not-visible (2.4.7 AA): the focused element's computed outline,
 *   box-shadow, border, background, color and text-decoration all match its
 *   resting state, and a padded screenshot of it is byte-identical before
 *   and after focus. When focus crosses a shadow boundary, the shadow hosts'
 *   computed styles join the diff (a delegated-focus widget may draw its ring
 *   on a surrogate — segments, a field—rather than the proxy input) and the
 *   screenshot region covers the outermost host.
 * - focus-indicator-thin (2.4.13 AAA, heuristic): the only visible change is
 *   an outline under 2 CSS px.
 * - focus-obscured (2.4.11 AA, WCAG 2.2) and focus-partially-obscured
 *   (2.4.12 AAA): `elementsFromPoint` at the focused element's centre and
 *   corners, taking the top-most element that actually paints (a transparent
 *   stretched-link span wins the raw hit-test without rendering anything, so
 *   it cannot hide the element or its indicator) resolving to something other
 *   than the element, its descendants, or its ancestors (an own-paragraph or
 *   inner-span hit is the element's rendering, not an overlay), as under a
 *   sticky header or banner. Each obscured read is re-verified once after a
 *   300 ms settle before being reported.
 * - skip-link-broken (2.4.1 A): the first Tab stop is a skip link whose
 *   activation does not move focus into its target.
 * - focus-changes-context (3.2.1 A): receiving focus navigated the page.
 *   The audit stops there, since the document it was inspecting is gone.
 *   (There is no skip-link-missing rule: axe's `bypass` rule covers the
 *   criterion, and a first-Tab-stop-only heuristic reads fresh-profile
 *   consent banners as missing skip links — disproven on gov.uk, where the
 *   banner-free page makes the skip link the first stop. Multi-site sweep,
 *   Oct 2026.)
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
 * @property {boolean} hostStyleDiff  a shadow ancestor's computed styles changed on focus (delegated-focus surrogate ring)
 * @property {{ x: number, y: number, width: number, height: number } | null} hostRect  the outermost shadow host's rect, for the screenshot fallback
 * @property {"none" | "partial" | "full" | "unknown"} [obscuredRecheck]  persisted obscured value after a settle; absent when not re-checked, "none" demotes the step
 * @property {string} [identity]  stable identity for uninventoried steps (index < 0): tag + attributes + sibling position
 */

/**
 * @typedef {object} KeyboardAuditOptions
 * @property {number} [maxSteps]            Tab budget (default: 2 × candidates + 20, min 50)
 * @property {boolean} [screenshotFallback] pixel-compare when computed styles do not change (default true)
 */

/**
 * @typedef {object} KeyboardAuditResult
 * @property {Finding[]} findings
 * @property {Candidate[]} candidates
 * @property {FocusStep[]} sequence
 * @property {"end" | "cycle" | "trap" | "budget"} terminated
 * @property {string | null} modal   path of the open modal dialog that scoped the audit
 * @property {{ present: boolean, path?: string, works?: boolean }} skipLink
 * @property {{ path: string, size: number } | null} [ring]  when the traversal ended in a closed ring: the path where it closed and its stop count
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
  /**
   * Inside a closed <details>, other than in its own <summary>: the content is not rendered
   * (Chromium keeps a box under content-visibility, so it still has client rects) and cannot be
   * reached by design. Crosses shadow boundaries; the summary of a closed details stays visible.
   * @param {Element} el
   */
  function inClosedDetails(el) {
    /** @type {Node} */
    let child = el;
    /** @type {Node | null} */
    let node = el.parentNode;
    while (node) {
      if (node instanceof Element && node.localName === "details" && !node.hasAttribute("open")) {
        if (node.querySelector(":scope > summary") !== child) return true;
      }
      if (node instanceof Element) child = node;
      node = node instanceof ShadowRoot ? node.host : node.parentNode;
    }
    return false;
  }
  /** @param {Element} el */
  function visible(el) {
    if (!el.getClientRects().length) return false;
    // checkVisibility sees content-visibility: hidden ancestors (a closed details in Chromium)
    // that getComputedStyle does not; opacity and off-screen positioning still count as visible.
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true })) return false;
    if (inClosedDetails(el)) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  /**
   * Does the element paint anything at its box? A transparent stretched-link
   * overlay (whole-card click target) wins the hit-test without rendering —
   * the painted state of the focused element below stays visible, so such a
   * layer must not count as an occluder.
   * @param {Element} el
   */
  function paints(el) {
    const cs = getComputedStyle(el);
    if (cs.opacity !== "1") return true; // anything below 1 changes the pixels beneath
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if ((el.textContent ?? "").trim() !== "" || (el instanceof HTMLInputElement && el.type !== "hidden") || (el instanceof HTMLTextAreaElement) || (el instanceof HTMLSelectElement)) return true;
    const bg = cs.backgroundColor;
    if (bg && !/rgba\(\s*,\s*,\s*,\s*0\)|^transparent$/i.test(bg) && !/ 0\)$/.test(bg)) return true;
    if (cs.backgroundImage !== "none") return true;
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      if (Number.parseFloat(cs[`border-${side.toLowerCase()}-width`]) > 0 && !/^0|none$/.test(cs[`border-${side.toLowerCase()}-style`] ?? "none")) return true;
    }
    if (cs.boxShadow !== "none" && cs.boxShadow !== "") return true;
    if (cs.outlineStyle !== "none" && (Number.parseFloat(cs.outlineWidth) || 0) > 0) return true;
    // A replaced element (img, video, canvas, iframe, svg) always paints.
    if (["img", "video", "canvas", "iframe", "svg", "picture"].includes(el.localName)) return true;
    // Stretched-link overlays usually paint through a ::before/::after on an
    // otherwise paintless element; the pseudo wins the stacking order with
    // the element's own geometry.
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content === "none" || ps.content === "" || ps.display === "none") continue;
      if (ps.opacity !== "1") return true;
      const pbg = ps.backgroundColor;
      if (pbg && !/rgba\(\s*,\s*,\s*,\s*0\)|^transparent$/i.test(pbg) && !/ 0\)$/.test(pbg)) return true;
      if (ps.backgroundImage !== "none") return true;
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        if (Number.parseFloat(ps[`border-${side.toLowerCase()}-width`]) > 0 && !/^0|none$/.test(ps[`border-${side.toLowerCase()}-style`] ?? "none")) return true;
      }
      if (ps.boxShadow !== "none" && ps.boxShadow !== "") return true;
      if (ps.outlineStyle !== "none" && (Number.parseFloat(ps.outlineWidth) || 0) > 0) return true;
    }
    return false;
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
    // A zero-box control renders nothing (squarespace's mobile-only
    // navigation buttons are 0×0 at desktop): a keyboard user cannot miss
    // an invisible control, and with tabindex=-1 the author has already
    // taken it out of tab order. Not a reachability defect.
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return true;
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
  /** True when `other` is a strict descendant of `el` (el.contains(other) but not el itself). @param {Element} el @param {Element} other */
  function containsExcludingSelf(el, other) {
    return el !== other && el.contains(other);
  }
  /** The chain of shadow hosts from el's tree up to the document, outermost first. @param {Element} el */
  function hostChain(el) {
    /** @type {Element[]} */
    const out = [];
    let root = /** @type {Document | ShadowRoot} */ (el.getRootNode());
    while (root instanceof ShadowRoot) {
      out.unshift(root.host);
      root = /** @type {Document | ShadowRoot} */ (root.host.getRootNode());
    }
    return out;
  }

  /** @type {Element[]} */
  let elements = [];
  /** @type {Record<string, string>[]} */
  let resting = [];
  /** @type {Element[][]} */
  let restingHosts = [];
  /** @type {Record<string, string>[][]} */
  let restingHostStyles = [];
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
    const all = allElements().filter((el) => modal ? modal.contains(el) || el.getRootNode() !== document : true);
    elements = [];
    resting = [];
    /** @type {Candidate[]} */
    const candidates = [];
    for (const el of all) {
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
      const hosts = hostChain(el);
      restingHosts.push(hosts);
      restingHostStyles.push(hosts.map((h) => snapshot(h)));
      candidates.push({
        index: elements.length - 1,
        path: pathFor(el),
        reason,
        role: el.getAttribute("role"),
        tabindex: Number.isNaN(tabindex) ? null : tabindex,
        composite: composite ? pathFor(composite) : null,
        radioGroup: radio,
      });
    }
    void scope;
    return { candidates, modal: modal ? pathFor(modal) : null };
  }

  /** @returns {FocusStep} */
  function step() {
    const el = deepActive();
    if (!el || el === document.body || el === document.documentElement) {
      return { index: -1, path: "body", isBody: true, isFrame: false, styleDiff: [], outlineWidth: 0, obscured: "unknown", rect: null, screenshotChanged: false, hostStyleDiff: false, hostRect: null };
    }
    const index = elements.indexOf(el);
    // Uninventoried steps (re-rendered subtrees, script-added widgets) use a
    // stable identity tag so two visits to the same replacement node compare
    // equal by identity, not by colliding path: the generic "a" path made
    // distinct links look like a cycle and ended traversals early.
    const identity = index < 0 ? identityOf(el) : undefined;
    const styleDiff = [];
    let outlineWidth = 0;
    let hostStyleDiff = false;
    /** @type {{ x: number, y: number, width: number, height: number } | null} */
    let hostRect = null;
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
      // A delegated-focus widget shows focus on a surrogate inside its shadow
      // tree, not on the proxy element Tab lands on. The hosts' own computed
      // styles change via :host(:focus)/:host(:focus-within) rules.
      const hosts = restingHosts[index];
      for (let h = 0; h < hosts.length; h++) {
        const hostNow = snapshot(hosts[h]);
        const hostBefore = restingHostStyles[index][h];
        if (props.some((p) => hostNow[p] !== hostBefore[p])) {
          hostStyleDiff = true;
          break;
        }
      }
      if (hosts.length) {
        const hr = hosts[0].getBoundingClientRect();
        hostRect = { x: hr.x, y: hr.y, width: hr.width, height: hr.height };
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
        const hits = root.elementsFromPoint(x, y);
        // The top-most PAINTING layer alone decides coverage. Transparent
        // stretched-link overlays win the raw hit-test without rendering
        // (nuxt.com FP); when nothing in the stack paints at this point,
        // nothing visually covers the element — the point is not covered.
        let painted = null;
        for (const h of hits) {
          if (!paints(h)) continue;
          painted = h;
          break;
        }
        const hit = painted;
        // An occluder is something OTHER than the element, its descendants,
        // or its ancestors: a hit on the element's own paragraph/link chain
        // (parent/ancestor contains el) is the element's rendering, not
        // content stacked on top of it.
        if (!hit || (!containsExcludingSelf(el, hit) && !hit.contains(el))) covered++;
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
      hostStyleDiff,
      hostRect,
      identity,
    };
  }

  /**
   * Stable identity for an element the inventory missed: document position +
   * tag + salient attributes, stable across re-render swaps of unchanged
   * nodes and distinct for sibling links with identical selectors.
   * @param {Element} el
   */
  function identityOf(el) {
    const bits = [el.localName];
    if (el.id) bits.push(`#${el.id}`);
    const cls = Array.from(el.classList).slice(0, 2).join(".");
    if (cls) bits.push(`.${cls}`);
    for (const a of ["role", "type", "name", "tabindex", "aria-label"]) {
      const v = el.getAttribute(a);
      if (v !== null) bits.push(`[${a}=${v}]`);
    }
    // Position among same-selector siblings makes distinct same-tag links distinct.
    const rootNode = el.getRootNode();
    const parent = el.parentElement ?? (rootNode instanceof ShadowRoot ? rootNode.host : null);
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
      if (same.length > 1) bits.push(`:nth-of-type(${same.indexOf(el) + 1})`);
      // Distinct CAROUSEL CLONES share tag+classes+aria — discriminate by
      // position in the track so consecutive clone Tabs never read as a
      // repeat (squarespace-class: the trap was two clones with one identity).
      if (el.parentElement && el.parentElement.matches("[class*=carousel], [class*=track]")) {
        bits.push(`:track-of-type(${Array.from(el.parentElement.children).indexOf(el)})`);
      }
      // Sibling identity for parents without distinguishing selectors.
      const pBits = parent.id ? [`#${parent.id}`] : [];
      const pCls = Array.from(parent.classList).slice(0, 2).join(".");
      if (pCls) pBits.push(`.${pCls}`);
      if (pBits.length) bits.unshift(`parent=${pBits.join("")}`);
    }
    return bits.join("");
  }

  w.__rampCheckKeyboard = {
    inventory,
    step,
    /** Re-verify a missed candidate still exists before blaming it. @param {number} index */
    connected(index) {
      const el = elements[index];
      return el ? el.isConnected : false;
    },
    /** Roving-tabindex scan for one candidate: is its role=tab sibling group
     * (tablist or shared parent) holding reachability on the selected/tabindex=0
     * member? Returns the holder's candidate index so the audit can exempt the
     * unselected tabs only when their holder was actually reached.
     * @param {number} index */
    rovingGroup(index) {
      const el = elements[index];
      if (!el || (el.getAttribute("role") ?? "") !== "tab") return null;
      const scope = el.closest("[role=tablist]") ?? el.parentElement;
      if (!scope) return null;
      const tabs = Array.from(scope.querySelectorAll('[role="tab"]'));
      if (tabs.length < 2 || !tabs.includes(el)) return null;
      const selected = tabs.filter((t) => (t.getAttribute("aria-selected") ?? "") === "true");
      const ti0 = tabs.filter((t) => (parseInt(t.getAttribute("tabindex") ?? "1", 10) || 1) === 0);
      // A roving group has exactly one reachable member (tabindex=0 or the selected one).
      const holder = selected.length === 1 ? selected[0] : ti0.length === 1 ? ti0[0] : null;
      if (!holder) return null;
      const holderIndex = elements.indexOf(holder);
      if (holderIndex < 0) return null;
      return { holderPath: pathFor(holder), holderIndex, size: tabs.length };
    },
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
    /**
     * Re-run the obscured sampling of a recorded step: focus the element,
     * then — after a settle on a page-timer schedule — hit-test again.
     * Two Chromium realities make a re-check necessary: at the instant
     * focus arrives, a pending style/layout update can hit-test against a
     * half-updated tree, and a protocol-driven read between frames can see
     * a stale hit-test tree for up to about a second on an idle headless
     * page. Reads on the page's own timer schedule (setTimeout) see the
     * committed state; a real overlay (sticky header, banner) persists,
     * a stale-tree read does not. Returns the persisted obscured value,
     * or null if the element is gone (document replaced).
     * @param {number} index
     * @param {number} settleMs  time to wait after focus, timer-scheduled
     * @returns {Promise<FocusStep["obscured"] | null>}
     */
    async recheck(index, settleMs) {
      const el = /** @type {any} */ (elements[index]);
      if (!el || !el.isConnected) return null;
      el.focus();
      await new Promise((r) => setTimeout(r, settleMs));
      if (!el.isConnected) return null;
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const qx = r.width / 4;
      const qy = r.height / 4;
      const points = [
        [r.x + r.width / 2, r.y + r.height / 2],
        [r.x + qx, r.y + qy],
        [r.right - qx, r.y + qy],
        [r.x + qx, r.bottom - qy],
        [r.right - qx, r.bottom - qy],
      ].filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh);
      if (!points.length || r.width <= 0 || r.height <= 0) return "unknown";
      const root = /** @type {Document | ShadowRoot} */ (el.getRootNode());
      let covered = 0;
      for (const [x, y] of points) {
        const hits = root.elementsFromPoint(x, y);
        // The top-most PAINTING layer decides coverage; transparent stretched
        // overlays win the raw hit-test without rendering (nuxt.com FP).
        let painted = null;
        for (const h of hits) {
          if (!paints(h)) continue;
          painted = h;
          break;
        }
        const hit = painted ?? hits[0];
        if (!hit || (!containsExcludingSelf(el, hit) && !hit.contains(el))) covered++;
      }
      return covered === 0 ? "none" : covered === points.length ? "full" : "partial";
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
    /**
     * State-holder discovery, Playwright-orchestrated phase 1. For a
     * tabindex=-1 input the traversal missed, list the focusable buttons and
     * text-entry inputs inside the same <form> that could drive its state;
     * the audit driver probes them with the real keyboard (a dispatched
     * KeyboardEvent is untrusted and the techcrunch handler ignored it).
     * Also reports a <label for> pairing — a reachable label exempts
     * outright; a visually-hidden label defers to the keyboard probe.
     * @param {number} index
     */
    stateHolderDrivers(index) {
      const el = elements[index];
      if (!el || !el.isConnected || (parseInt(el.getAttribute("tabindex") ?? "1", 10) || 0) >= 0) return { drivers: [], labelPair: false };
      const form = el.closest("form");
      const id = el.getAttribute("id");
      let labelPair = false;
      if (id) {
        const root = el.getRootNode();
        for (const label of /** @type {Document | ShadowRoot} */ (root).querySelectorAll("label[for]")) {
          if ((label.getAttribute("for") ?? "").trim() === id) {
            labelPair = true;
            const li = label instanceof HTMLElement && elements.includes(label) ? elements.indexOf(label) : -1;
            if (li >= 0) return { drivers: [{ index: li, kind: "label" }], labelPair: true };
            break;
          }
        }
      }
      if (!form || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return { drivers: [], labelPair };
      const drivers = elements
        .map((c, i) => ({ c, i }))
        .filter(({ c }) =>
          form.contains(c) && c !== el &&
          (c instanceof HTMLButtonElement || (c instanceof HTMLInputElement && (c.type === "checkbox" || c.type === "radio"))));
      return { drivers: drivers.map(({ i }) => ({ index: i, kind: "button" })), labelPair };
    },
    /** Read an input's toggle state. @param {number} index */
    stateOf(index) {
      const el = /** @type {any} */ (elements[index]);
      if (!el || !el.isConnected) return null;
      return el.type === "checkbox" || el.type === "radio" ? el.checked : el.value;
    },
    /** Is the given candidate index inside a carousel-ish container? An
     * auto-scrolling track repositions clones under focus, so a repeat
     * there is scroll churn, not a 2.1.2 trap (squarespace-class; the user
     * tabbed the same row cleanly). @param {number} index */
    inCarousel(index) {
      const el = elements[index];
      if (!el) return el?.isConnected ? true : false;
      return !!el.closest("[class*=carousel], [class*=swiper], [class*=slider-track], [class*=track]") || !!el.closest("[aria-roledescription=carousel]");
    },
    /**
     * Clone-of-a-reached check for a missed tabindex=-1 candidate: carousels
     * duplicate their cards (infinite scroll). A missed `tabindex=-1` card
     * whose text and href match a REACHED candidate is a clone of content a
     * keyboard user has already been offered — no function is missing, so
     * "unreachable" would be a false positive. Returns the matched index or
     * null.
     * @param {number} index
     * @param {number[]} reachableIndexes
     */
    cloneOfReached(index, reachableIndexes) {
      const el = elements[index];
      if (!el || (parseInt(el.getAttribute("tabindex") ?? "1", 10) || 0) >= 0) return null;
      // Arrow-key carousel pattern (squarespace king-carousel): the whole
      // track marks cards tabindex=-1 except one roving holder, and the
      // prev/next buttons offer keyboard entry. A missed card inside such a
      // track — where the track holds a reachable control and its siblings
      // are its traversal targets — is arrow-key-reachable by design, like
      // the tablist exemption.
      const track = el.closest("[class*=carousel], [class*=swiper], [class*=track], [aria-roledescription=carousel]");
      if (track) {
        const trackBtns = [...track.querySelectorAll("button, [role=button], a[href]")];
        const trackTi0 = trackBtns.filter((b) => (parseInt(b.getAttribute("tabindex") ?? "1", 10) || 0) >= 0);
        const prevNext = trackBtns.filter((b) => /prev|next/i.test(b.className + " " + (b.getAttribute("aria-label") ?? "")));
        if (trackTi0.length && (trackTi0.length >= 2 || prevNext.length)) return index; // self-marker: arrow-key pattern, exempt in the audit
      }
      const text = (el.textContent ?? "").trim();
      const href = el.getAttribute("href") ?? "";
      if (!text) return null;
      for (const i of reachableIndexes) {
        const other = elements[i];
        if (!other || other === el || !other.isConnected) continue;
        if ((other.getAttribute("tabindex") ?? "0") === "-1") continue; // reached element must itself be tab-reachable
        if ((other.textContent ?? "").trim() === text && other.getAttribute("href") === href) {
          const inCar = !!el.closest("[class*=carousel], [class*=swiper], [class*=track]");
          const otherInCar = !!other.closest("[class*=carousel], [class*=swiper], [class*=track]");
          if (inCar && otherInCar) return i;
        }
      }
      return null;
    },
    /** Restore a state-holder probe's side effect. @param {number} index @param {boolean | string} value */
    setState(index, value) {
      const el = /** @type {any} */ (elements[index]);
      if (!el || !el.isConnected) return;
      if (el.type === "checkbox" || el.type === "radio") el.checked = value;
      else el.value = value;
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
  const { candidates, modal } = /** @type {{ candidates: Candidate[], modal: string | null }} */ (
    await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.inventory())
  );
  const maxSteps = opts.maxSteps ?? Math.max(50, candidates.length * 2 + 20);
  const useScreenshots = opts.screenshotFallback !== false;

  /** @type {FocusStep[]} */
  const sequence = [];
  /** @type {KeyboardAuditResult["terminated"]} */
  let terminated = "budget";
  let repeats = 0;
  // Count of carousel-churn repeat suppressions (each one is evidence the
  // page re-rendered focusable content mid-traversal).
  let carouselRepeats = 0;
  let wrapped = false;
  /** @type {KeyboardAuditResult["ring"]} */
  let ring = null;
  // One re-inventory is allowed when the traversal lands twice on an
  // uninventoried element (a carousel clone) — inventory churn, not a trap.
  let reInventoried = false;

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
        technique: "F52",
        target: culprit,
        message: `the page navigated to ${page.url()} when focus reached ${culprit} or the next Tab stop; receiving focus must not change context`,
        wcag: { criterion: "3.2.1", level: "A", version: "2.0" },
        help: "https://www.w3.org/WAI/WCAG22/Understanding/on-focus.html",
        data: { culprit, to: page.url() },
      };
      terminated = "end";
      break;
    }
    // Identity: candidate index when inventoried, else the stable identity tag
    // (two visits to the same re-rendered node are the same stop; two distinct
    // sibling links with a generic "a" path are not).
    const same = (/** @type {FocusStep} */ a, /** @type {FocusStep} */ b) =>
      a.index >= 0 || b.index >= 0 ? a.index === b.index : (a.identity ?? a.path) === (b.identity ?? b.path);
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
      // A repeat on an UNINVENTORIED element is not a trap: the node entered
      // the DOM after the inventory (a carousel clone the auto-scroll keeps
      // under focus — squarespace-class, user walked through cleanly).
      // Re-inventory once instead; if a fresh pass inventoried it, traversal
      // continues with the element as a known candidate (and its reachability
      // becomes a normal observed fact).
      if (step.index < 0 && prev.index < 0 && !reInventoried) {
        reInventoried = true;
        const fresh = /** @type {{ candidates: Candidate[], modal: string | null }} */ (
          await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.inventory())
        );
        const again = await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.step());
        if (again && again.index >= 0) {
          candidates.length = 0;
          candidates.push(...fresh.candidates);
          // The clone is now candidate idx N. Tab once more, read the next
          // stop WITHOUT trapping: if the same clone still holds focus
          // (scroll-into-view gluing) we record it as ONE observed stop and
          // let further repeats decide; most auto-scroll carousels release
          // it within two Tabs (user walked through cleanly).
        }
        repeats = 0;
        continue;
      }
      repeats += 1;
      if (repeats >= 2) {
        // A repeat inside an auto-scrolling carousel is churn, not a trap:
        // the track repositions focusable clones under focus while the audit
        // reads styles between Tabs (squarespace-class; a real user walks
        // through cleanly). Treat as an observed stuck stop, no verdict.
        const carouselStuck = step.index >= 0
          ? await page.evaluate((i) => /** @type {any} */ (window).__rampCheckKeyboard.inCarousel(i), step.index)
          : (step.identity ?? step.path).includes("carousel");
        if (carouselStuck) {
          repeats = 0;
          carouselRepeats += 1;
          continue;
        }
        terminated = "trap";
        break;
      }
      continue;
    }
    repeats = 0;
    const ringAt = sequence.findIndex((s) => same(s, step));
    if (ringAt >= 0) {
      // A closed ring. When the ring embraces most of the inventoried
      // candidates and the traversal already wrapped through body, this is
      // the page's real focus cycle (end). A small ring holding few of the
      // candidates is an overlay/carousel loop that ended the traversal
      // early — remembered so the unreachable gate can tell the truth.
      const ringSize = sequence.length - ringAt;
      const ringCandidates = new Set(sequence.slice(ringAt).map((s) => s.index).filter((i) => i >= 0));
      const smallRing = ringSize <= 6 && candidates.length > 0 && ringCandidates.size / candidates.length < 0.6;
      ring = smallRing ? { path: sequence[ringAt].path, size: ringSize } : null;
      terminated = wrapped ? "end" : "cycle";
      break;
    }
    if (step.index >= 0 && step.styleDiff.length === 0 && !step.hostStyleDiff && useScreenshots && !step.isFrame) {
      step.screenshotChanged = await screenshotChanges(page, step);
    } else if (
      step.index >= 0 &&
      step.hostRect &&
      step.styleDiff.length > 0 &&
      step.styleDiff.every((p) => p.startsWith("outline")) &&
      step.outlineWidth < 2 &&
      useScreenshots &&
      !step.isFrame
    ) {
      // A shadow-tree proxy can carry a UA thin outline it never renders
      // (1×1, opacity 0). The style layer says "thin indicator"; the pixel
      // layer over the host region sees the widget's real surrogate ring.
      // Pixels win: a changed region upgrades thin → visible.
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
    // The audit scoped INTO an open dialog (inventory was modal-scoped) and
    // focus then cycled inside it: a dialog is supposed to hold focus; the
    // 2.1.2 question is whether it has a working exit, not whether Tab wraps
    // inside. Reporting a trap here blames correct dialog behaviour, so the
    // verdict names the dialog honestly instead.
    if (terminated === "trap" && modal) {
      add({
        check: "keyboard",
        rule: "keyboard-trap",
        target: modal,
        message: `focus stayed inside the open dialog (${modal}); a modal may hold focus, but verify it has a working close action that returns focus`,
        wcag: { criterion: "2.1.2", ...A },
        help: `${understanding}no-keyboard-trap.html`,
        data: { terminated, loop, modal },
      });
    } else {
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
  }

  for (const c of candidates) {
    if (c.tabindex !== null && c.tabindex > 0) {
      add({
        check: "keyboard",
        rule: "positive-tabindex",
        technique: "F44",
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
  // Honesty gate 1 — overlay/carousel ring or a wrapped-short traversal. If
  // the traversal died in a small ring (consent banner, carousel nav) or
  // wrapped through body with most candidates untouched, the page behind the
  // overlay was never tested and "unreachable" would blame the page for the
  // overlay. One finding about where Tab got stuck replaces per-element
  // blame; ring members are still reported individually (a banner with no
  // exit IS a finding).
  const ringReached = ring
    ? new Set(
        sequence
          .slice(sequence.length - ring.size)
          .map((s) => s.index)
          .filter((i) => i >= 0),
      )
    : null;
  // The ring itself as a fraction of the inventoried candidates decides
  // whether the cycle is the page's real focus wrap (big) or an overlay loop
  // (small). When no ring was recorded, a body-wrap that still left over half
  // untouched is the banner-scope variant (gitlab): Tab entered the banner
  // ring again right after wrap, so termination saw body once and quit.
  const untouchedAll = candidates.filter((c) => !reachedIndex.has(c.index));
  const ringCandidateShare = candidates.length
    ? ringReached
      ? ringReached.size / candidates.length
      : 0
    : 0;
  // A cycle that closed without a body wrap (ring too large to record, or the
  // page cycled mid-document) still never offered focus to the candidates
  // after the close point — as untested as a budget stop. Any cycle counts as
  // a short traversal; per-element reporting continues only for a wrapped end
  // that reached most candidates.
  const shortTraversal =
    ring !== null ||
    terminated === "cycle" ||
    (terminated === "end" && sequenceSize() <= 8 && untouchedAll.length > candidates.length * 0.5);
  const traversalStalled =
    candidates.length > 4 &&
    (ring
      ? ringCandidateShare < 0.6
      : shortTraversal && untouchedAll.length > candidates.length * 0.5);
  function sequenceSize() { return sequence.length; }
  if (traversalStalled) {
    const lastStop = sequence.at(-1)?.path ?? "body";
    add({
      check: "keyboard",
      rule: "keyboard-unreachable",
      target: ring?.path ?? lastStop,
      message: ring
        ? `the Tab loop closed after ${ring.size} stops at ${ring.path} — an overlay or widget keeps focus circulating; elements outside the loop were not reached and are not individually reported`
        : `the Tab traversal ended early (${sequence.length} stops, ${untouchedAll.length} of ${candidates.length} controls never reached, cycle at ${lastStop}) — an overlay, carousel, or re-render is interfering; elements behind the stop point are not individually reported`,
      wcag: { criterion: "2.1.1", ...A },
      help: `${understanding}keyboard.html`,
      data: {
        ring: ring?.path,
        ringSize: ring?.size,
        stops: sequence.length,
        candidatesAffected: untouchedAll.length,
      },
    });
  }
  // Honesty gate 2 — inventory churn. Re-verify missed candidates still
  // exist before blaming them: a page that re-rendered (hydrated, swapped a
  // subtree) replaced those nodes, and "unreachable" would blame ghosts.
  // Runs whenever the traversal passed through churn signals (re-inventory
  // fired, carousel repeats) or when a substantial share was missed;
  // squarespace-class misses are few but real ghosts (25/173 = 14% — all
  // carousel clones replaced mid-flight).
  /** @type {Set<number>} */
  const gone = new Set();
  {
    const missed = candidates.filter((c) => !reachedIndex.has(c.index));
    const churnSignal = reInventoried || carouselRepeats > 0;
    if (churnSignal || missed.length > candidates.length * 0.4) {
      const states = await page.evaluate(
        (idx) => idx.map((i) => /** @type {any} */ (window).__rampCheckKeyboard.connected(i)),
        missed.map((c) => c.index),
      );
      missed.forEach((c, i) => { if (!states[i]) gone.add(c.index); });
      if (gone.size) {
        add({
          check: "keyboard",
          rule: "keyboard-unreachable",
          target: "html",
          message: `${gone.size} of the inventoried controls were replaced or removed while the audit ran (content re-rendered); they are not reported as unreachable`,
          wcag: { criterion: "2.1.1", ...A },
          help: `${understanding}keyboard.html`,
          data: { replaced: gone.size, candidates: candidates.length },
        });
      }
    }
  }
  // Honesty gate 3 — roving tabindex. An unselected role=tab is
  // arrow-key-reachable by design once its group's reachable member
  // (tabindex=0 or the selected one) was itself reached; until then the tabs
  // (holder included) are genuinely untested and stay reportable.
  /** @type {Set<number>} */
  const roving = new Set();
  const rovingCandidates = candidates.filter(
    (c) => !reachedIndex.has(c.index) && c.role === "tab" && !gone.has(c.index),
  );
  if (rovingCandidates.length && reachedIndex.size) {
    const groups = await page.evaluate(
      (idx) => idx.map((i) => /** @type {any} */ (window).__rampCheckKeyboard.rovingGroup(i)),
      rovingCandidates.map((c) => c.index),
    );
    rovingCandidates.forEach((c, i) => {
      const g = groups[i];
      // Exempt the sibling only when the holder was reached: an unreached
      // tablist is untested, not correct-by-pattern.
      if (g && reachedIndex.has(g.holderIndex)) roving.add(c.index);
    });
  }
  // Honesty gate 4 — state-holder inputs. A tabindex=-1 checkbox/radio whose
  // state is driven by a keyboard-reachable sibling — the newsletter-card
  // idiom: visually-hidden checkbox, visible whole-card button that toggles
  // it (techcrunch-class, live-probed: Enter on the card flips the checkbox).
  // The FUNCTION is operable via keyboard; the hidden input itself is a
  // state-holder, not the control. Exempted only when the driving control was
  // itself reached; anything discovered here is recorded in the finding data
  // of the note finding — never a silent filter.
  /** @type {Set<number>} */
  const stateHolder = new Set();
  /** @type {Map<number, string>} */
  const exemptViaByHolder = new Map();
  /** @type {Map<number, { drivers: { index: number, kind: string }[], labelPair: boolean, labelUnreachable: boolean }>} */
  const holderDrivers = new Map();
  const holderCandidates = candidates.filter(
    (c) =>
      !reachedIndex.has(c.index) &&
      c.tabindex !== null &&
      c.tabindex < 0 &&
      !gone.has(c.index),
  );
  if (holderCandidates.length && reachedIndex.size) {
    // Phase 1 (in page): list candidate driver controls per holder + label pairing.
    const discovered = await page.evaluate(
      (idx) => idx.map((i) => /** @type {any} */ (window).__rampCheckKeyboard.stateHolderDrivers(i)),
      holderCandidates.map((c) => c.index),
    );
    // Phase 2 (Playwright): press keys with the real keyboard on each driver;
    // a dispatched event is untrusted and site handlers ignore it.
    holderCandidates.forEach((c, i) => {
      const d = discovered[i];
      if (d && d.drivers.length) {
        holderDrivers.set(c.index, { drivers: d.drivers, labelPair: d.labelPair, labelUnreachable: d.labelPair && d.drivers.every((/** @type {{kind: string}} */ x) => x.kind !== "label") });
      }
    });
    const holdersWithDrivers = holderCandidates.filter((c) => holderDrivers.has(c.index));
    for (const c of holdersWithDrivers) {
      const info = /** @type {{ drivers: { index: number, kind: string }[], labelPair: boolean, labelUnreachable: boolean }} */ (holderDrivers.get(c.index));
      for (const d of info.drivers) {
        // A reachable <label for> exempts outright once reached.
        if (d.kind === "label") {
          if (reachedIndex.has(d.index)) { exemptViaByHolder.set(c.index, "label"); stateHolder.add(c.index); }
          continue;
        }
        if (!reachedIndex.has(d.index)) continue;
        const before = await page.evaluate((i) => /** @type {any} */ (window).__rampCheckKeyboard.stateOf(i), c.index);
        await page.evaluate((i) => /** @type {any} */ (window).__rampCheckKeyboard.focus(i), d.index);
        await page.keyboard.press("Enter");
        if (!(await page.evaluate((i) => /** @type {any} */ (window).__rampCheckKeyboard.stateOf(i), c.index))) {
          await page.keyboard.press(" ");
        }
        const after = await page.evaluate((i) => /** @type {any} */ (window).__rampCheckKeyboard.stateOf(i), c.index);
        if (before !== null && after !== before) {
          exemptViaByHolder.set(c.index, "card-button");
          stateHolder.add(c.index);
          // The probe toggled real page state; restore it so the audit
          // leaves the page as it found it (the stateHolder contract).
          await page.evaluate(
            ([i, v]) =>
              /** @type {any} */ (window).__rampCheckKeyboard.setState(i, v),
            [c.index, before],
          );
          break;
        }
      }
    }
    if (stateHolder.size) {
      add({
        check: "keyboard",
        rule: "keyboard-unreachable",
        target: "html",
        message: `${stateHolder.size} hidden state-holder input(s) are toggled by keyboard-reachable controls (label or card-button) and are not individually reported as unreachable`,
        wcag: { criterion: "2.1.1", ...A },
        help: `${understanding}keyboard.html`,
        data: {
          stateHolderExempt: stateHolder.size,
          via: [...exemptViaByHolder.values()],
        },
      });
    }
  }
  // Honesty gate 5 — clones of reached content. Infinite-scroll carousels
  // duplicate card markup; a missed `tabindex=-1` card whose text+href
  // matches a REACHED tab-reachable card is a clone — the function was
  // already offered via the original. "Unreachable" for the duplicate is a
  // false positive (squarespace-class: 26 ti=-1 carousel CTAs, originals
  // all reached). Summarized in one annotation, never silent.
  /** @type {Set<number>} */
  const cloneExempt = new Set();
  const missedTabMinus = candidates.filter(
    (c) => !reachedIndex.has(c.index) && c.tabindex !== null && c.tabindex < 0 && !gone.has(c.index) && !stateHolder.has(c.index),
  );
  if (missedTabMinus.length && reachedIndex.size) {
    const matches = await page.evaluate(
      ([missed, reached]) => missed.map((i) => /** @type {any} */ (window).__rampCheckKeyboard.cloneOfReached(i, reached)),
      [missedTabMinus.map((c) => c.index), [...reachedIndex]],
    );
    missedTabMinus.forEach((c, i) => {
      if (matches[i] !== null && matches[i] !== undefined) cloneExempt.add(c.index);
    });
    if (cloneExempt.size) {
      add({
        check: "keyboard",
        rule: "keyboard-unreachable",
        target: "html",
        message: `${cloneExempt.size} controls are duplicates (infinite-scroll carousel clones) of tab-reachable content and are not individually reported as unreachable`,
        wcag: { criterion: "2.1.1", ...A },
        help: `${understanding}keyboard.html`,
        data: { cloneExempt: cloneExempt.size },
      });
    }
  }
  for (const c of candidates) {
    if (reachedIndex.has(c.index)) continue;
    if (c.composite && reachedComposites.has(c.composite)) continue;
    if (c.radioGroup && reachedRadioGroups.has(c.radioGroup)) continue;
    if (gone.has(c.index)) continue;
    if (roving.has(c.index)) continue;
    if (stateHolder.has(c.index)) continue;
    if (cloneExempt.has(c.index)) continue;
    if (traversalStalled && !(ringReached && ringReached.has(c.index))) continue; // the stalled-traversal finding covers the page-behind-overlay
    if (terminated === "trap" || terminated === "budget") continue; // everything after a trap is unreachable for the same reason
    if (shortTraversal && terminated === "cycle") continue; // candidates past a mid-document cycle close were never offered focus; one finding above tells the story
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

  // Obscured steps get a persistence re-check: refocus, settle 300 ms on
  // the page's timer schedule, and hit-test again. A real overlay (sticky
  // header, banner, dialog sheet) persists; a one-frame layout/transition
  // race at the instant focus arrived does not. A demoted read stays
  // visible in the step's data — never dropped silently.
  const obscuredSteps = sequence.filter((s) => !s.isFrame && (s.obscured === "full" || s.obscured === "partial"));
  for (const s of obscuredSteps) {
    const persisted = /** @type {FocusStep["obscured"] | null} */ (
      await page.evaluate(
        ([i, ms]) => /** @type {any} */ (window).__rampCheckKeyboard.recheck(i, ms),
        [s.index, 300],
      )
    );
    if (persisted !== null) {
      s.obscuredRecheck = persisted === "none" ? "none" : persisted;
      if (persisted === "none") s.obscured = "none";
    }
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
        technique: "F110",
          target: s.path,
          message: "entirely hidden behind other content when focused (sticky header, banner, or overlay)",
          wcag: { criterion: "2.4.11", level: "AA", version: "2.2" },
          help: `${understanding}focus-not-obscured-minimum.html`,
          data: { rect: s.rect },
        });
      }
      continue;
    }
    const visibleChange = s.styleDiff.length > 0 || s.screenshotChanged || s.hostStyleDiff;
    if (!visibleChange) {
      add({
        check: "keyboard",
        rule: "focus-not-visible",
        technique: "F78",
        target: s.path,
        message: "no visible change when focused (computed styles unchanged and pixels identical)",
        wcag: { criterion: "2.4.7", level: "AA", version: "2.0" },
        help: `${understanding}focus-visible.html`,
        data: { styleDiff: s.styleDiff },
      });
    } else if (
      !s.hostStyleDiff &&
      !s.screenshotChanged &&
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
        technique: "F110",
        target: s.path,
        message: "entirely hidden behind other content when focused (sticky header, banner, or overlay)",
        wcag: { criterion: "2.4.11", level: "AA", version: "2.2" },
        help: `${understanding}focus-not-obscured-minimum.html`,
        data: { rect: s.rect, obscuredRecheck: s.obscuredRecheck },
      });
    } else if (s.obscured === "partial") {
      add({
        check: "keyboard",
        rule: "focus-partially-obscured",
        target: s.path,
        message: "partly hidden behind other content when focused",
        wcag: { criterion: "2.4.12", level: "AAA", version: "2.2" },
        help: `${understanding}focus-not-obscured-enhanced.html`,
        data: { rect: s.rect, obscuredRecheck: s.obscuredRecheck },
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
    // No skip link as the first Tab stop: not reported. axe's `bypass` rule
    // covers the no-bypass case, and a first-stop heuristic reads
    // fresh-profile consent banners as missing skip links. Multi-site sweep
    // FP, Oct 2026; see docs/keyboard-limitations.md.
  }

  await page.evaluate((state) => /** @type {any} */ (window).__rampCheckKeyboard.restore(state), saved);
  return { findings, candidates, sequence, terminated, modal, skipLink, ring };
}

/**
 * Pixel fallback for focus visibility: blur, shoot, refocus, shoot, compare.
 * When focus sits inside a shadow tree, the region is the outermost host's
 * rect — the widget's surrogate indicator lives there, not on the 1×1 proxy
 * input Tab lands on.
 * @param {Page} page
 * @param {FocusStep} step
 */
async function screenshotChanges(page, step) {
  const region = step.hostRect ?? step.rect;
  if (!region) return false;
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const pad = 8;
  const x = Math.max(0, region.x - pad);
  const y = Math.max(0, region.y - pad);
  const width = Math.min(viewport.width - x, region.width + pad * 2);
  const height = Math.min(viewport.height - y, region.height + pad * 2);
  if (width <= 0 || height <= 0) return false;
  const clip = { x, y, width, height };
  await page.evaluate(() => /** @type {any} */ (window).__rampCheckKeyboard.blur());
  const blurred = await page.screenshot({ clip, animations: "disabled" });
  await page.evaluate((i) => /** @type {any} */ (window).__rampCheckKeyboard.focus(i), step.index);
  const focused = await page.screenshot({ clip, animations: "disabled" });
  return !blurred.equals(focused);
}
