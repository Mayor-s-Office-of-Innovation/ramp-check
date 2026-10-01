# Known limitations of the keyboard audit

The keyboard audit catches structural failures reliably: controls missing
from the tab order, dead ends, removed focus outlines, controls hidden under
sticky headers, and elements that navigate when they receive focus. It does
not verify that custom widgets behave. Read this page before treating a
clean run as evidence of keyboard accessibility, and read it again when the
audit reports something that looks wrong.

The tool stays small on purpose. Each limitation below says whether a fix is
cheap and reliable, possible but costly or brittle, or not possible, and the
[feasibility review](#feasibility-review) at the end collects that into one
table. Most items are acknowledged rather than fixed.

## 1. Click handlers attached in script are invisible

Only the `onclick` attribute is observable from the DOM. A `div` with
`addEventListener("click", ...)` and no role or `tabindex` is the most
common keyboard failure on modern sites, and neither this audit nor axe can
see it.

Why a fix is weaker than it sounds: enumerating listeners needs the Chrome
DevTools Protocol (`DOMDebugger.getEventListeners`), Chromium only. Worse,
React and similar frameworks attach one delegated listener at the root
container, so per-element enumeration finds nothing on the clickable `div`
anyway. A cheap heuristic exists instead: `cursor: pointer` on an element
that is neither interactive nor inside an interactive element is a strong
hint of a click target. It would be noisy and could only ever be a
best-practice warning.

What to do: review templates for `div` and `span` elements styled as
controls. Prefer `<button>` and `<a href>`.

## 2. Reaching a control is checked; operating it is not

The audit confirms focus arrives. It never presses Enter, Space, or arrow
keys, except to activate a skip link.

- A `div role="button" tabindex="0"` with only a click handler passes.
- Composite widgets (tablist, menu, listbox, radio group, tree, grid,
  toolbar) pass if any member is reached. Members with `tabindex="-1"` are
  exempted on the assumption that arrow keys move focus between them.

Enter and Space probing is deliberately not done in a generic audit: those
keys submit forms, follow links, and delete things. Arrow-key probing is
safer and feasible later. Both belong with a spec author who knows the page,
which is the planned patterns module.

## 3. Focus order is not evaluated

2.4.3 requires a focus order that preserves meaning. The audit records the
sequence but does not judge it. Positive `tabindex` values, CSS `order`,
grid placement, and absolute positioning can all put the Tab sequence out of
step with the visual order, and nothing is reported.

`positive-tabindex` now reports any `tabindex` greater than zero (2.4.3).
Comparing the sequence to visual order is not attempted: layouts
legitimately reorder.

## 4. Dialogs are only partly covered

When a native modal `<dialog>` is open, the audit scopes to its contents,
which keeps dialog states clean and confirms Tab cycles inside. It does not
open dialogs, press Escape, or check that focus returns to the element that
opened the dialog. A visible `role="dialog"` or `role="alertdialog"` with
`aria-modal="true"` is scoped the same way as a native modal. Whether such a
dialog actually keeps focus inside is not verified: if focus escapes to the
page behind it, the escaped stops are simply not inventoried.

Escape and focus return need a spec author.

## 5. Visible-focus detection is lenient and can miss

The check compares computed styles against the element's resting state, then
falls back to comparing screenshots of the element's box padded by 8 px.

False negatives (a real problem passes):

- Any pixel change counts, including a one-shade colour shift that a person
  could not perceive. Indicator contrast against its background is not
  measured.
- `focus-indicator-thin` only looks at outline width. A thin box-shadow or
  border ring passes. 2.4.13 also requires a minimum indicator area and 3:1
  contrast; neither is measured.
- An indicator that appears after a delay (`transition-delay`, or a
  JavaScript timer) is not seen. CSS transitions are fast-forwarded in the
  screenshot, but a timer is not.

False positives (a working indicator is reported as missing):

- Indicators drawn outside the 8 px padded box: a ring on a distant ancestor
  via `:focus-within`, or a pseudo-element positioned elsewhere.
- Text fields whose only indicator is the caret. Screenshots hide the caret.
  This is usually a real finding, since a caret is a weak indicator, but WCAG
  accepts it.

Measuring indicator contrast and area from the screenshot diff is possible
without new dependencies (a minimal PNG decoder over `node:zlib`) but fiddly,
and anti-aliasing makes the thresholds brittle.

## 6. Obscured-focus detection has hit-testing blind spots

The check uses `elementFromPoint` at five sample points.

- An overlay with `pointer-events: none` (a gradient fade, a decorative
  layer) is skipped by hit-testing even when it visually covers the control.
  Not detected.
- A focusable element that itself has `pointer-events: none` is skipped by
  the obscured check, since it can never hit-test to itself.
- Obscuring is viewport-dependent. A header that covers nothing at 1280 px
  may cover controls at 375 px. Run the matrix with a mobile viewport. Browser
  zoom at 400 %, where 2.4.11 bites hardest, is not emulated.
- A geometric check (intersect the focused rect with every `position: fixed`
  or `sticky` element) would catch `pointer-events: none` overlays and is
  cheap, at the cost of reporting translucent overlays the control is
  readable through.

## 7. Expected false positives that need the allowlist

The audit is right about what happened, but WCAG allows it or the design
intends it. The allowlist, with a reason and an expiry, is the answer.

- **Deliberate Tab consumption.** Code editors, rich text editors, and
  spreadsheet grids that use Tab for their own purposes are reported as
  `keyboard-trap`. 2.1.2 allows this when the user is told how to leave.
  Allowlist with the exit mechanism as the reason.
- **Focus-opened overlays.** A tooltip that opens on focus and covers part of
  the control registers as `focus-partially-obscured`. 2.4.11 exempts content
  the user opened.
- **Translucent layers** and **decorative pseudo-elements** that extend over
  a control hit-test as obscuring it.
- **`aria-disabled="true"` controls** are candidates, because ARIA says they
  remain focusable. A design that removes them from the tab order gets an
  unreachable finding.
- **Virtualised lists.** A list that renders more rows as focus advances can
  exhaust the Tab budget and is reported as `keyboard-trap` with reason
  "budget". Raise `keyboard: { maxSteps }` for such pages.

A team's first run on a rich application will have some of this noise. Work
through it once; the allowlist then documents each decision.

## 8. The audit is not side-effect free

Tab, blur, and refocus fire real events. A form that validates on blur shows
its error messages during the screenshot fallback, which can shift layout
for later stops and leaves the messages visible afterwards. Activating the
skip link fires `hashchange`, which a hash-routed single-page app may treat
as navigation. Focus, URL, and scroll position are restored afterwards; the
events that fired are not undone. This is inherent to driving a real browser.

## 9. Target paths are stable, not pretty

Targets are selector paths built from tag, id or classes, and
`:nth-of-type()` when siblings share a tag, joined with ` >>> ` across shadow
boundaries. They are unique within a page but not resilient: inserting a
sibling renumbers `a:nth-of-type(3)` and an allowlist entry for it stops
matching. Give elements ids where you intend to allowlist them, or use a
prefix pattern ending in `*`.

## 10. Blind spots by construction

- **No Shift+Tab.** Pages that break only backwards are rare but exist,
  typically a `keydown` handler that checks for Tab and ignores `shiftKey`.
  A reverse pass would double the traversal time.
- **Nothing inside iframes.** Tab moving through an iframe's controls is
  recorded as one stop on the iframe element and is not a trap. The frame's
  own focus indicators are not judged. Cross-origin frames cannot be
  inspected; same-origin frames could be, at some complexity. axe does scan
  frames.
- **Nothing inside closed shadow roots.**
- **Hover-revealed content.** Submenus that appear on hover are not rendered
  when the audit runs, so they are neither inventoried nor reported. Hovering
  every element to find them would be slow and have side effects.
- **Hidden-but-rendered elements.** `opacity: 0`, `clip-path`, and
  off-screen positioning count as visible. A closed popup rendered that way
  is reported as unreachable. Treating off-screen as hidden would wrongly
  exclude visually-hidden skip links, so this stays as is.
- **Skip link recognition.** Only the first Tab stop is considered. A first
  link to `#top` or `#search` is not treated as a skip link unless its text
  says "skip" or "jump". `skip-link-missing` fires at three or more focusable
  elements before `main`; tune with `keyboard: { skipLinkThreshold }`.
- **Focus moved by script.** Autofocus on reveal, a late widget stealing
  focus, or a `focusin` handler that moves focus can shorten or reorder the
  recorded sequence. The audit reports what happened, not why.
- **The navigating element is a race.** When focus arriving on an element
  navigates the page, the document is torn down before the audit can always
  record which element had focus. `focus-changes-context` names the last
  recorded stop and says the culprit is that element or the next one.
- **Timing.** The traversal is a snapshot. Controls that render after a later
  response are not seen. Call `a11y.check()` after the state has settled.
- **One state at a time.** Collapsed accordions, closed menus, and later
  steps of a flow are untested unless a spec reaches them. That is what the
  fixtures layer is for.

## 11. Engine assumptions

The audit assumes Chromium's Tab behaviour. WebKit skips links on Tab unless
the user enables "Press Tab to highlight each item", so a WebKit project
would report every link as unreachable. Firefox differs in smaller ways.
Run the audit in a Chromium project only.

## 12. Adjacent criteria that are out of scope

1.4.13 (content on hover or focus must be dismissible and persistent),
2.1.4 (single-character key shortcuts), 2.2.1 (timing adjustable), and
2.5.7 (dragging movements) are keyboard-adjacent and not checked.

## Feasibility review

| Limitation | Fix | Cost | Brittleness | Verdict |
| --- | --- | --- | --- | --- |
| Iframe contents read as a trap | collapse frame stops | done | | fixed |
| Navigation on focus crashed the audit | `focus-changes-context` finding | done | | fixed |
| Duplicate target paths (9) | `:nth-of-type()` in the shared path builder | done | | fixed |
| `pointer-events: none` on the control (6) | skip obscured check for it | done | | fixed |
| Scroll position not restored (8) | save and restore | done | | fixed |
| Positive `tabindex` (3) | `positive-tabindex` finding, 2.4.3 | done | | fixed |
| `aria-modal` dialogs not scoped (4) | treat as modal scope | done | | fixed |
| Arrow-key probing of composites (2) | press one arrow, confirm focus moved | medium | medium | maybe, later |
| Geometric overlap for `pointer-events: none` overlays (6) | intersect with fixed/sticky rects | small | medium | maybe, later |
| Shift+Tab pass (10) | reverse traversal, compare | medium | low | maybe, opt-in |
| `cursor: pointer` heuristic for script handlers (1) | best-practice warning | small | high | acknowledge |
| Listener enumeration via CDP (1) | Chromium only; blind to delegated listeners | large | high | acknowledge |
| Enter and Space probing (2) | real side effects | medium | high | patterns module |
| Indicator contrast and area (5) | PNG diff analysis | large | high | acknowledge |
| Delayed indicators (5) | wait per element | medium | medium | acknowledge |
| Hover-revealed content (10) | hover every element | large | high | acknowledge |
| Hidden-but-rendered (10) | treat off-screen as hidden | small | breaks skip links | acknowledge |
| Visual focus order (3) | compare to layout | large | high | acknowledge |
| Side effects of blur and hashchange (8) | | | inherent | acknowledge |
| Closed shadow roots, cross-origin frames | | | impossible | acknowledge |
| WebKit Tab behaviour (11) | | | engine setting | document |
| Adjacent criteria (12) | | | out of scope | document |

The seven fixed items were folded in during phase 1. Everything marked
"maybe" or "acknowledge" trades reliability or size for coverage that the
fixtures layer or a human reviewer provides better.
