# The keyboard audit

`keyboardAudit(page)` presses Tab from the top of the page and records where
focus lands, following it into open shadow roots. It needs no knowledge of
the app, so it runs on any page at any state, and `a11y.check()` runs it by
default. Turn it off with `checks: { keyboard: "off" }`.

## What it reports

| Rule | Criterion | Level | Fires when |
| --- | --- | --- | --- |
| `keyboard-unreachable` | 2.1.1 | A | an interactive element never received focus during a full traversal |
| `keyboard-trap` | 2.1.2 | A | Tab stopped moving focus, or the traversal neither ended nor cycled within its step budget |
| `positive-tabindex` | 2.4.3 | A | an interactive element has `tabindex` greater than zero |
| `focus-not-visible` | 2.4.7 | AA | no computed style changed on focus (including shadow hosts'), and a padded screenshot is byte-identical before and after |
| `focus-indicator-thin` | 2.4.13 | AAA | the only visible change is an outline under 2 CSS px (heuristic) |
| `focus-obscured` | 2.4.11 | AA (2.2) | every sampled point of the focused element hit-tests to something else |
| `focus-partially-obscured` | 2.4.12 | AAA (2.2) | some sampled points hit-test to something else |
| `focus-changes-context` | 3.2.1 | A | an element navigated the page when it received focus; the audit stops there |
| `skip-link-broken` | 2.4.1 | A | the first Tab stop is a skip link whose activation does not move focus into its target |
| `skip-link-missing` | 2.4.1 | best practice | three or more focusable elements precede the main landmark and no skip link bypasses them |

## How it decides

**Interactive elements** are native controls (`a[href]`, `button`, inputs,
`select`, `textarea`, `summary`, `iframe`, `[contenteditable]`, media with
controls), elements with a widget `role`, elements with an `onclick`
attribute, and elements with `tabindex` of 0 or more. Disabled elements,
elements inside `inert` or `aria-hidden="true"` subtrees, elements with
no rendered box, and the contents of a closed `<details>` (its `summary`
still counts) are skipped. When a modal is open, a native `dialog:modal`
or a visible `aria-modal="true"` dialog, only its contents count.

**Composite widgets** manage focus with arrow keys, so their members are
exempt from reachability once any member is reached: `tablist`, `menu`,
`menubar`, `listbox`, `radiogroup`, `tree`, `treegrid`, `grid`, `toolbar`,
and native radio groups.

**Visible focus** compares outline, box-shadow, border colour and width,
background, text colour, text decoration, filter and transform against the
element's resting values. Outline properties count only when an outline
actually renders. When nothing changed, the fallback blurs the element,
screenshots its padded box, refocuses it, screenshots again, and compares
bytes. The caret is hidden in screenshots, so a text field whose only
indicator is the caret is reported.

When focus crosses a shadow boundary, the hosts' computed styles join the
comparison (`:host(:focus)` and `:host(:focus-within)` rules) and the
screenshot region becomes the outermost host's box. This is the
delegated-focus pattern: Tab lands on a 1×1 invisible proxy input while the
widget draws its ring on a visible surrogate (OTP segments, a pill field),
so a real indicator away from the proxy passes. When the style layer sees
only the proxy's own thin UA outline, the pixel layer is authoritative: a
byte-different host region (a real surrogate ring) means visible; an
identical one reports `focus-indicator-thin`, not `focus-not-visible`.

**Obscured focus** samples the centre and four points a quarter of the way in
from each corner, using `elementFromPoint` on the element's own root, so
rounded corners and shadow roots do not produce false hits. A hit counts as
an occluder only when it is something other than the element, its
descendants, or its ancestors — a link's own paragraph or a button's inner
span is the element's rendering, not content stacked on top of it. Obscured
reads are re-verified once after a 300 ms settle before they are reported: a
real overlay persists, a one-frame layout race does not (a demoted read
stays in the step's data).

**Skip link** means a first Tab stop that is a fragment link whose text
contains "skip" or "jump", or whose target is or sits inside the main
landmark. It is activated with Enter; if focus is not inside the target
afterwards, one more Tab is pressed and checked, since Chromium moves the
sequential focus starting point without focusing a non-focusable target.

**Iframes** are one Tab stop. Tab moving through a frame's own controls is
collapsed into that stop, is not a trap, and the frame's focus indicators are
not judged from outside.

**Traversal** starts from `body` (or the open modal), presses Tab until
focus leaves the page, then wraps once, since Chromium visits
positive-tabindex elements only after the document-order pass. It stops when
it meets an element it has already recorded.

The audit saves the focused element, the URL, and the scroll position before
it starts and restores them before it returns.

## Known limits

The audit catches structural keyboard failures and does not verify that
custom widgets behave. Script-attached click handlers, arrow-key operation,
Enter and Space, dialog focus return, and Shift+Tab are all outside it, and
a few patterns are expected to need allowlist entries. Read
[keyboard-limitations.md](keyboard-limitations.md) before treating a clean
run as proof of keyboard accessibility.

## Cost

Each Tab press is one round trip plus one evaluate; the screenshot fallback
adds two screenshots per element whose styles did not change. A page with a
hundred focusable elements and good focus styles audits in about two
seconds. Pages that remove outlines everywhere take longer because every
element hits the fallback.
