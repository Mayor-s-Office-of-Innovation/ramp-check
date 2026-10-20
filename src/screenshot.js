// @ts-check
/**
 * Highlight screenshots: one capture of the checked state with every
 * finding's element boxed and numbered, so a report line such as
 * `[3] color-contrast-enhanced: p.muted (...)` points at box 3 in the image.
 * Built for the people who have to act on findings without reading
 * selectors: designers, content owners, product managers.
 *
 * How it draws:
 * - Boxes, not arrows. A box on the element's own bounding rect is
 *   unambiguous however many findings share a page; arrows need free space
 *   and overlap.
 * - A white halo under a coloured stroke, so the box reads on light and dark
 *   themes and over elements that are themselves red. Blocking findings and
 *   warnings use two colours a colourblind reader can still tell apart
 *   (red / blue), and the numbered badge carries the meaning on its own.
 * - The rest of the page is dimmed slightly, with the boxed elements cut
 *   out, so dozens of boxes stay legible without hiding the colours a
 *   designer is there to judge.
 * - One element that fails several rules gets one box; its findings share
 *   the number.
 *
 * How it stays honest:
 * - Targets that cannot be boxed (page-level findings such as `html` or a
 *   `::view-transition` pseudo, selectors that no longer resolve, elements
 *   with no rendered box) are returned as `unlocated` with a reason, never
 *   dropped.
 * - Targets are resolved in the page with `querySelector`, descending into
 *   open shadow roots at each ` >>> `, exactly as every check wrote them.
 * - The overlay is a `popover` so it sits in the top layer above open
 *   dialogs, and it is removed before the function returns, even if the
 *   screenshot throws.
 */

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("./types.js").Finding} Finding */

/**
 * @typedef {object} ScreenshotOptions
 * @property {"findings" | "always" | "off"} [mode]
 *   "findings" (default): capture only when a blocking finding or warning
 *   can be shown. "always": capture every checked state, boxes or not.
 *   "off": never.
 * @property {boolean} [warnings]   box warnings too, not only blocking findings (default true)
 * @property {boolean} [dim]        dim the rest of the page around the boxes (default true)
 * @property {boolean} [fullPage]   capture the whole document, not just the viewport (default true)
 * @property {number} [maxHeight]   CSS px; taller documents fall back to a viewport capture (default 15000)
 */

/**
 * One numbered box in the image.
 * @typedef {object} HighlightMarker
 * @property {number} n
 * @property {"block" | "warn"} severity   block if any finding on the element blocks
 * @property {{ x: number, y: number, width: number, height: number }} rect  image coordinates, CSS px
 * @property {Finding[]} findings
 */

/**
 * A finding that got no box, and why.
 * @typedef {object} UnlocatedFinding
 * @property {Finding} finding
 * @property {"page-level" | "not found" | "no box"} reason
 */

/**
 * @typedef {object} Highlight
 * @property {Buffer} png
 * @property {HighlightMarker[]} markers
 * @property {UnlocatedFinding[]} unlocated
 * @property {boolean} fullPage   false when the document was taller than `maxHeight`
 * @property {number} width       CSS px
 * @property {number} height
 */

/** Stroke and badge colours by severity. Red and blue stay distinct under the common colour-vision deficiencies. */
export const HIGHLIGHT_COLORS = /** @type {const} */ ({ block: "#c62828", warn: "#1565c0" });

/**
 * Box the findings on the page as it is now, capture, clean up, and number
 * them. Sets `marker` on every finding that got a box. Allowlisted and
 * baselined findings are never boxed. Returns null when there is nothing to
 * show under mode "findings", or when mode is "off".
 * @param {Page} page
 * @param {Finding[]} findings
 * @param {ScreenshotOptions} [opts]
 * @returns {Promise<Highlight | null>}
 */
export async function highlightFindings(page, findings, opts = {}) {
  const mode = opts.mode ?? "findings";
  if (mode === "off") return null;
  const shown = findings.filter(
    (f) => !f.allowlisted && !f.baselined && (f.severity !== "warn" || opts.warnings !== false),
  );
  // Blocking first so the lowest numbers are the ones that fail the run.
  const ordered = [...shown.filter((f) => f.severity !== "warn"), ...shown.filter((f) => f.severity === "warn")];
  if (!ordered.length && mode !== "always") return null;

  const drawn = await page.evaluate(highlightRuntime, {
    targets: ordered.map((f, id) => ({ id, target: f.target, severity: /** @type {"block" | "warn"} */ (f.severity === "warn" ? "warn" : "block") })),
    dim: opts.dim !== false,
    fullPage: opts.fullPage !== false,
    maxHeight: opts.maxHeight ?? 15000,
    colors: HIGHLIGHT_COLORS,
  });
  let png;
  try {
    png = await page.screenshot({ fullPage: drawn.fullPage, animations: "disabled", caret: "hide", scale: "css" });
  } finally {
    await page.evaluate(clearHighlightRuntime);
  }

  for (const f of ordered) delete f.marker;
  /** @type {HighlightMarker[]} */
  const markers = drawn.markers.map((m) => {
    const fs = m.ids.map((id) => ordered[id]);
    for (const f of fs) f.marker = m.n;
    return { n: m.n, severity: m.severity, rect: m.rect, findings: fs };
  });
  return {
    png,
    markers,
    unlocated: drawn.unlocated.map((u) => ({ finding: ordered[u.id], reason: u.reason })),
    fullPage: drawn.fullPage,
    width: drawn.width,
    height: drawn.height,
  };
}

/**
 * One line per finding that got no box, for reports. Empty when all did.
 * @param {Highlight} shot
 * @returns {string[]}
 */
export function describeUnlocated(shot) {
  return shot.unlocated.map((u) => `${u.finding.rule} ${u.finding.target} (${u.reason})`);
}

/**
 * @typedef {object} HighlightInput
 * @property {{ id: number, target: string, severity: "block" | "warn" }[]} targets
 * @property {boolean} dim
 * @property {boolean} fullPage
 * @property {number} maxHeight
 * @property {{ block: string, warn: string }} colors
 */

/**
 * @typedef {object} HighlightDrawn
 * @property {{ n: number, severity: "block" | "warn", rect: { x: number, y: number, width: number, height: number }, ids: number[] }[]} markers
 * @property {{ id: number, reason: "page-level" | "not found" | "no box" }[]} unlocated
 * @property {boolean} fullPage
 * @property {number} width
 * @property {number} height
 */

/**
 * In-page: resolve every target, group by element, draw the overlay. Must
 * stay self-contained (it is serialised into the page). Idempotent: a
 * previous overlay is removed first.
 * @param {HighlightInput} input
 * @returns {HighlightDrawn}
 */
export function highlightRuntime(input) {
  const ATTR = "data-ramp-check-highlight";
  for (const old of document.querySelectorAll(`[${ATTR}]`)) old.remove();

  const doc = document.documentElement;
  const docWidth = Math.max(doc.scrollWidth, doc.clientWidth);
  const docHeight = Math.max(doc.scrollHeight, doc.clientHeight);
  const fullPage = input.fullPage && docHeight <= input.maxHeight;
  const width = fullPage ? docWidth : doc.clientWidth;
  const height = fullPage ? docHeight : doc.clientHeight;
  const offsetX = fullPage ? window.scrollX : 0;
  const offsetY = fullPage ? window.scrollY : 0;

  /**
   * @param {string} target
   * @returns {{ el: Element } | { reason: "page-level" | "not found" }}
   */
  function resolve(target) {
    let t = target.trim();
    if (!t) return { reason: "page-level" };
    const pseudo = t.indexOf("::");
    if (pseudo === 0) return { reason: "page-level" };
    if (pseudo > 0) t = t.slice(0, pseudo).trim();
    if (t === "html" || t === "body") return { reason: "page-level" };
    /** @type {Document | ShadowRoot | Element} */
    let root = document;
    /** @type {Element | null} */
    let el = null;
    for (const piece of t.split(/\s*>>>\s*/)) {
      let found = null;
      try {
        found = root.querySelector(piece);
      } catch {
        return { reason: "not found" };
      }
      if (!found) return { reason: "not found" };
      el = found;
      root = found.shadowRoot ?? found;
    }
    return el ? { el } : { reason: "not found" };
  }

  /** @type {Map<Element, { n: number, severity: "block" | "warn", rect: { x: number, y: number, width: number, height: number }, ids: number[] }>} */
  const byElement = new Map();
  /** @type {HighlightDrawn["unlocated"]} */
  const unlocated = [];
  for (const t of input.targets) {
    const r = resolve(t.target);
    if ("reason" in r) {
      unlocated.push({ id: t.id, reason: r.reason });
      continue;
    }
    const existing = byElement.get(r.el);
    if (existing) {
      existing.ids.push(t.id);
      if (t.severity === "block") existing.severity = "block";
      continue;
    }
    const b = r.el.getBoundingClientRect();
    if (!r.el.getClientRects().length || (b.width === 0 && b.height === 0)) {
      unlocated.push({ id: t.id, reason: "no box" });
      continue;
    }
    const x = Math.max(0, b.left + offsetX);
    const y = Math.max(0, b.top + offsetY);
    byElement.set(r.el, {
      n: byElement.size + 1,
      severity: t.severity,
      rect: {
        x,
        y,
        width: Math.max(1, Math.min(b.right + offsetX, width) - x),
        height: Math.max(1, Math.min(b.bottom + offsetY, height) - y),
      },
      ids: [t.id],
    });
  }
  const markers = [...byElement.values()];

  // The overlay: a popover (top layer, above open dialogs) holding one SVG in
  // a shadow root so page CSS cannot restyle it. Absolute positioning inside
  // the top layer is relative to the initial containing block, so with
  // fullPage the overlay scrolls with the document and document coordinates
  // line up with the captured image.
  const host = document.createElement("div");
  host.setAttribute(ATTR, "");
  host.setAttribute("popover", "manual");
  host.style.cssText = [
    `position:${fullPage ? "absolute" : "fixed"}`, "inset:auto", "top:0", "left:0", "margin:0", "padding:0", "border:0",
    "background:transparent", "color:inherit", `width:${width}px`, `height:${height}px`, "max-width:none", "max-height:none",
    "overflow:visible", "pointer-events:none", "z-index:2147483647",
  ].join(";");
  const shadow = host.attachShadow({ mode: "open" });
  const NS = "http://www.w3.org/2000/svg";
  /**
   * @param {string} name
   * @param {Record<string, string | number>} attrs
   */
  const svgEl = (name, attrs) => {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  const svg = svgEl("svg", { xmlns: NS, width, height, viewBox: `0 0 ${width} ${height}` });
  svg.setAttribute("style", "display:block;position:absolute;top:0;left:0;overflow:visible");
  const PAD = 2;
  const padded = markers.map((m) => ({
    x: Math.max(0, m.rect.x - PAD),
    y: Math.max(0, m.rect.y - PAD),
    width: m.rect.width + PAD * 2,
    height: m.rect.height + PAD * 2,
  }));

  if (input.dim) {
    const defs = svgEl("defs", {});
    const mask = svgEl("mask", { id: "cut" });
    mask.appendChild(svgEl("rect", { x: 0, y: 0, width, height, fill: "#fff" }));
    for (const p of padded) mask.appendChild(svgEl("rect", { ...p, rx: 4, fill: "#000" }));
    defs.appendChild(mask);
    svg.appendChild(defs);
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width, height, fill: "rgba(0,0,0,0.25)", mask: "url(#cut)" }));
  }

  // Every box first, then every badge, so a neighbour's stroke never covers a number.
  markers.forEach((m, i) => {
    const p = padded[i];
    svg.appendChild(svgEl("rect", { ...p, rx: 3, fill: "none", stroke: "#fff", "stroke-width": 5 }));
    svg.appendChild(svgEl("rect", { ...p, rx: 3, fill: "none", stroke: input.colors[m.severity], "stroke-width": 3 }));
  });
  markers.forEach((m, i) => {
    const p = padded[i];
    const color = input.colors[m.severity];
    const label = String(m.n);
    const bw = 10 + label.length * 8;
    const bh = 18;
    // Badge sits just above the box's top-left corner; flipped inside when
    // the box touches the top edge, and kept inside the image on the right.
    const bx = Math.min(Math.max(0, p.x - 1), width - bw);
    const by = p.y >= bh + 2 ? p.y - bh - 2 : p.y + 2;
    svg.appendChild(svgEl("rect", { x: bx, y: by, width: bw, height: bh, rx: 4, fill: color, stroke: "#fff", "stroke-width": 1.5 }));
    const text = svgEl("text", {
      x: bx + bw / 2, y: by + bh / 2 + 4.5, fill: "#fff", "text-anchor": "middle",
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", "font-size": 12, "font-weight": 700,
    });
    text.textContent = label;
    svg.appendChild(text);
  });

  shadow.appendChild(svg);
  document.body.appendChild(host);
  try {
    host.showPopover();
  } catch {
    // Older engines without popover: the z-index keeps it on top of
    // everything but the top layer.
  }
  return { markers, unlocated, fullPage, width, height };
}

/** In-page: remove any overlay. */
export function clearHighlightRuntime() {
  for (const el of document.querySelectorAll("[data-ramp-check-highlight]")) {
    try {
      /** @type {HTMLElement} */ (el).hidePopover();
    } catch {
      // not shown, or no popover support
    }
    el.remove();
  }
}
