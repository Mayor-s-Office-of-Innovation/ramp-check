# The keyboard audit

`keyboardAudit(page)` presses Tab from the top of the page and records where
focus lands, following it into open shadow roots. It needs no knowledge of
the app, so it runs on any page at any state, and `a11y.check()` runs it by
default. Turn it off with `checks: { keyboard: "off" }`.

## What it reports

| Rule | Criterion | Level | Fires when |
| --- | --- | --- | --- |
| `keyboard-unreachable` | 2.1.1 | A | an interactive element never received focus during a full traversal |
| `keyboard-trap` | 2.1.2 | A | Tab stopped moving focus, or the traversal neither ended nor cycled within its step budget. When the audit is scoped to an open dialog, the finding names the dialog and says a modal may hold focus — verify the exit |
| `positive-tabindex` | 2.4.3 | A | an interactive element has `tabindex` greater than zero |
| `focus-not-visible` | 2.4.7 | AA | no computed style changed on focus (including shadow hosts'), and a padded screenshot is byte-identical before and after |
| `focus-indicator-thin` | 2.4.13 | AAA | the only visible change is an outline under 2 CSS px (heuristic) |
| `focus-obscured` | 2.4.11 | AA (2.2) | every sampled point of the focused element hit-tests to something else |
| `focus-partially-obscured` | 2.4.12 | AAA (2.2) | some sampled points hit-test to something else |
| `focus-changes-context` | 3.2.1 | A | an element navigated the page when it received focus; the audit stops there |
| `skip-link-broken` | 2.4.1 | A | the first Tab stop is a skip link whose activation does not move focus into its target |

There is deliberately no "skip link missing" rule: axe's `bypass` rule covers
the criterion (a page with a heading, a main landmark and an internal link
passes), and a first-Tab-stop-only heuristic misreads fresh profiles —
consent banners and other first-visit overlays occupy the early Tab stops,
which read as a missing skip link. Sighted on gov.uk during the multi-site
sweep; the banner-free page makes the skip link the first stop and passes.

## How it decides

**Interactive elements** are native controls (`a[href]`, `button`, inputs,
`select`, `textarea`, `summary`, `iframe`, `[contenteditable]`, media with
controls), elements with a widget `role`, elements with an `onclick`
attribute, and elements with `tabindex` of 0 or more. Disabled elements,
elements inside `inert` or `aria-hidden="true"` subtrees, **zero-box
controls** (0×0 — squarespace's mobile-only navigation buttons are invisible
at desktop and deliberately out of tab order; a keyboard user cannot miss an
invisible control), and the contents of a closed `<details>` (its `summary`
still counts) are skipped. When a modal is open, a native `dialog:modal`
or a visible `aria-modal="true"` dialog, only its contents count.

**Composite widgets** manage focus with arrow keys, so their members are
exempt from reachability once any member is reached: `tablist`, `menu`,
`menubar`, `listbox`, `radiogroup`, `tree`, `treegrid`, `grid`, `toolbar`,
and native radio groups. Roving-tabindex tabs are exempt the same way even
without a `[role=tablist]` wrapper: once a tab group's reachable member (the
`tabindex=0` or `aria-selected=true` tab) is reached, its `tabindex="-1"`
siblings are arrow-key-reachable by design. A tab group whose holder was
never reached stays reportable — an untested tablist is not a correct one.

**Reachability honesty gates.** Reporting an element as unreachable claims
the traversal offered it focus. Three conditions invalidate that claim, each
proven on real sites during the multi-site sweep:

- **Overlay ring.** If Tab closed a small ring (≤6 stops holding under 60% of
  the candidates) — a consent banner cycling back into itself, a carousel's
  prev/next pair — the page behind it was never offered focus, so one finding
  names where the loop closed instead of blaming every element behind it.
  Ring members are still reported individually. The same collapse applies
  when the traversal wrapped through `body` after only a handful of stops
  with most candidates untouched: an overlay is intercepting Tab before the
  content (GitLab-class, where a CMP banner ring ended the audit after 5 of
  127 candidates).
- **Mid-document cycle.** A cycle that closed without wrapping (59 stops on
  walgreens-class pages) leaves every candidate after the close point
  untested; they are summarized in one finding, not reported element by
  element.
- **Re-rendered candidates.** Before blaming a missed candidate the audit
  re-checks it is still connected. Nodes that a hydration pass or SPA
  navigation replaced are dropped with one annotation rather than reported
  as unreachable ghosts (Pinterest-class churn: the Google sign-in iframe
  gets a new id every load).
- **Carousel clones.** Infinite-scroll carousels duplicate card markup. A
  missed `tabindex="-1"` card is exempt when it is (a) a duplicate — its
  text and href match a reached tab-reachable twin — or (b) a member of a
  track that shows the arrow-key pattern: a roving `tabindex=0` holder or
  reachable prev/next controls, so the track's other cards are
  arrow-key-reachable by design. Exempted duplicates are summarized in one
  annotation (squarespace-class: 26 out-of-order carousel CTAs whose
  originals were all reached; a real keyboard user walks the row cleanly).

Uninventoried focus stops (re-rendered subtrees, script-added widgets) carry
a stable identity — tag, attributes, sibling position, and track position
for carousel clones — so two visits to the same replacement node compare
equal without distinct same-tag siblings or successive clones colliding
into a premature "cycle" or repeat.

**`keyboard-trap` and carousels.** A repeat on an uninventoried element
(the traversal landing twice on a newly cloned card) triggers one
re-inventory and a churn annotation instead of a trap verdict. A further
repeat on an element inside a carousel-like container (`[class*=carousel]`,
`[class*=swiper]`, `[aria-roledescription=carousel]`) is scroll churn: the
auto-advancing track repositions focusable content under focus while the
audit reads styles between Tabs, so the same element can hold focus twice
without any trap a real user would feel (squarespace-class — user-verified
clean traversal). Trap verdicts remain for repeats elsewhere.

**State-holder inputs.** A `tabindex="-1"` checkbox or radio can still be a
working part of the form: the newsletter-card idiom hides the real checkbox
(`visually-hidden`, `tabindex="-1"`) and drives it from a visible whole-card
button — the techcrunch newsletter form, live-probed (Enter on the card flips
the hidden checkbox, so the function is keyboard-operable and 2.1.1 is
satisfied). Before reporting such an input as unreachable, the audit looks
for the driver two ways: a `<label for>` pairing (a reachable label exempts)
and an activation probe — focus each reachable button/input inside the same
form, press Enter/Space with the real keyboard (dispatched events are
untrusted; site handlers ignored synthetic clicks), and check whether the
hidden input's state toggled. The probe restores whatever it changed. Exempt
inputs are summarized in one annotation finding with the counts and
via-channels — never silently dropped. A hidden input with no working driver
(an orphan visually-hidden checkbox) stays a finding.

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
from each corner, using `elementsFromPoint` on the element's own root and
taking the top-most element that actually paints — background, border,
shadow, non-1 opacity, or own text (also through `::before`/`::after`, the
stretched-link pattern). A layer that wins the raw hit-test but paints
nothing (a transparent whole-card click-target span) cannot hide the element
or its indicator and is skipped; when nothing in the stack paints at a point,
the point is not covered. A hit counts as an occluder only when the painted
element is something other than the focused element, its descendants, or its
ancestors — a link's own paragraph or a button's inner span is the element's
rendering, not content stacked on top of it. Obscured reads are re-verified
once after a 300 ms settle before they are reported: a real overlay persists,
a one-frame layout race does not (a demoted read stays in the step's data).

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
