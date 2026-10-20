# Changelog

## Unreleased

- Highlight screenshots. Every checked state with findings is captured once
  with each finding's element boxed and numbered: blocking findings first in
  red, warnings after in blue, a white halo under the stroke so the box reads
  on any theme, the rest of the page dimmed with the boxes cut out, one box
  per element however many rules it fails. The `[n]` that now starts a
  finding line (test failure, console, Markdown `#` column) is its box. The
  Playwright fixtures attach the PNG beside the JSON result; the CLI writes
  `<out>/screenshots/` and lists the files in the Markdown report. Findings
  that cannot be boxed (page-level targets, selectors that no longer resolve,
  elements with no rendered box) are reported under "Not in the screenshots"
  and as `a11y-not-in-screenshot` annotations, never dropped. The overlay is
  a popover, so it draws above open dialogs, and is removed before the check
  returns. Config: `screenshot: { mode, warnings, dim, fullPage, maxHeight }`;
  `highlightFindings(page, findings)` is exported for direct use. Fixture:
  fixtures/highlight-targets.html.
- axe findings keep the element's HTML snippet in `data.html`.
- New `readingLevel` check (`reading-level-advanced`, 3.1.5 AAA, warns by
  default): scores the page's main text with the Automated Readability Index
  and reports when it rounds above grade 9, the end of lower secondary
  education, which is the level the criterion names. Headings, navigation,
  banners, footers, asides, controls, code and hidden text are not counted,
  and capitalized words that do not open a sentence are dropped as the
  criterion's "proper names and titles". Pages whose `lang` is not English
  are not measured (the formula is English-calibrated), nor are pages under
  100 body words. Warns rather than blocks because a simpler supplemental
  version satisfies 3.1.5 and a formula cannot see one; promote with
  `checks: { readingLevel: "block" }`. Options: `maxGrade`, `minWords`,
  `selector`. `analyzeReadingLevel(text)` is exported for teams scoring
  their own extractions. Fixtures: fixtures/reading-level-advanced.html,
  fixtures/reading-level-plain.html. Doc: docs/reading-level.md.
- New `textResize` check (`text-resize-locked`, 1.4.4 AA, blocks by default):
  emulates a user doubling their browser's default font size (html font-size
  200%) and reports every text element whose computed font size does not
  change — px/pt-locked text ignores the font-size preference (full-page
  zoom still magnifies). One finding per outermost px owner; inherited
  descendants are not re-reported. The user-raised-font-size path is the
  scaling method low-vision users who do not zoom rely on. Fixture:
  fixtures/resize-text-locked.html.
- `text-spacing-clipped` is confirmed by a text-extent walk before it is
  reported. A box scroll surplus alone was too noisy (the multi-site sweep +
  manual review proved it): nextjs.org's hero surplus is aria-hidden 1px
  gradient decoration lines, a chip's surplus can be its own padding, and
  clipped sr-only strings are invisible by design. A hit now requires either
  a text node's actual glyph range crossing the clip boundary, or a rendered
  ellipsis (Chrome truncates when scrollWidth exceeds clientWidth even when
  glyphs fit — user-verified "Depl…" on nextjs.org's Deploy chip). Text hidden
  by design at rest (sr-only class, 1×1 clipped boxes, aria-hidden subtrees)
  is excluded; the finding message says which mechanism fired ("text extends
  past" vs "an ellipsis now hides the end of"). Fixture cases: the original
  fixed-height card, a nextjs-class ellipsis chip (now fails), an aria-hidden
  deco hero (quiet), an sr-only-in-clipped-box holder (quiet), the
  pre-truncated and fluid boxes (quiet).
- `keyboard-unreachable` exempts state-holder inputs: a visually-hidden
  checkbox/radio with `tabindex="-1"` toggled by a keyboard-reachable control
  is a state-holder, not a 2.1.1 defect — the techcrunch newsletter-card
  idiom (hidden checkbox + visible whole-card button; live-probed: Enter on
  the card flips the checkbox, so the function is operable). The audit
  discovers drivers two ways: a reachable `<label for>` pairing, or an
  activation probe with the real keyboard on reachable buttons/inputs inside
  the same form (dispatched events are untrusted and site handlers ignore
  them). The probe's state change is restored. Exemptions surface as one
  annotation finding with counts and the via-channel — never silent. An
  orphan hidden input (no reachable driver) stays a finding. Fixture:
  fixtures/keyboard-state-holder.html.
- Obscured focus (`focus-obscured`, `focus-partially-obscured`) no longer
  counts paint-transparent layers as occluders. The hit-test now walks
  `elementsFromPoint` to the top-most element that actually paints
  (background, border, shadow, non-1 opacity, text); a transparent
  stretched-link overlay — the whole-card click target of the nuxt.com
  homepage — wins the raw hit-test without rendering anything, so the CTA's
  focus ring stays fully visible and the finding was a false positive
  (disproven by manual review during the multi-site sweep). When nothing in
  the stack paints at a sample point, the point is not covered. Fixture:
  fixtures/keyboard-overlay-transparent.html (transparent card quiet, opaque
  card fires).
- `keyboard-unreachable` no longer floods reports when the traversal itself
  was cut short. Honesty gates, each disproven on real sites during the
  multi-site sweep (Oct 2026): (1) a Tab ring closed inside a consent
  banner, carousel or small widget no longer blames every element behind
  it — one finding names where the loop closed (GitLab: 79 findings → 1;
  the whole page was hidden behind its OneTrust banner ring); (2) candidates
  whose nodes were replaced or removed by a re-render mid-audit (SPA churn)
  are dropped with one annotation — "unreachable" would blame ghosts
  (Pinterest, craigslist-class nondeterminism); (3) an unselected
  `role=tab` with `tabindex="-1"` is exempt once its group's reachable
  member (tabindex=0 or selected) was reached — arrow-key navigation by
  design (MDN about page, Angular docs); (4) infinite-scroll carousel
  duplicates: a missed `tabindex="-1"` card matching (text+href) a reached
  tab-reachable twin, or a member of a track with the arrow-key pattern
  (roving tabindex=0 holder or prev/next controls), is a clone — exempt
  with one annotation (squarespace-class: 26 out-of-order carousel CTAs,
  originals all reached; user tabbed the row cleanly); (5) zero-box
  controls are not candidates at all — invisible (0×0) mobile-only
  navigation buttons with tabindex=-1 are deliberately out of tab order;
  a keyboard user cannot miss an invisible control (squarespace's
  global-navigation desktop-hidden controls). `keyboard-trap` no longer
  fires on carousel churn: a repeat on an uninventoried element (a
  scroll-in clone) triggers one re-inventory and a churn annotation
  instead of a trap verdict; a repeat on an element the auto-scroll keeps
  repositioning inside a carousel container is scroll churn, not 2.1.2
  (squarespace: deterministic trap → clean full traversal, 3/3 runs).
  A trap inside an open dialog still names the dialog and says a modal
  may hold focus — check the exit. Uninventoried stops carry a stable
  identity (with track-position for carousel clones) so same-tag siblings
  and successive clones never read as an early "cycle" or repeat.
- Retired the `skip-link-missing` keyboard rule (and the
  `keyboard.skipLinkThreshold` option). axe's `bypass` rule covers the
  criterion, and a first-Tab-stop-only heuristic misreads fresh profiles:
  consent banners and first-visit overlays occupy the early Tab stops, which
  read as a missing skip link. Disproven on gov.uk during the multi-site
  sweep (Oct 2026): with the banner handled, the skip link is the first Tab
  stop and the finding vanishes. `skip-link-broken` stays — it verifies
  activation behaviour, which axe does not.

- The contents of a closed `<details>` are no longer reported as
  `keyboard-unreachable`. Chromium keeps a layout box for them under
  `content-visibility`, so the rendered-box test passed; visibility now also
  asks `checkVisibility()` and walks up for a closed disclosure (the summary
  itself stays a candidate). Fixture: a closed disclosure with a link on
  fixtures/keyboard-clean.html.

- Obscured-focus sampling no longer counts the element's own ancestors as
  occluders (`elementFromPoint` at a link inside a paragraph hit the
  paragraph, which contains the link — reported as focus-obscured). An
  occluder is something other than the element, its descendants, or its
  ancestors. Obscured reads are re-verified once after a 300 ms settle
  before being reported; the persisted value ships in the finding's data.
- Focus visibility crosses shadow boundaries: the shadow hosts' computed
  styles join the diff (`:host(:focus)`, `:host(:focus-within)`) and the
  screenshot fallback covers the outermost host's box, so a delegated-focus
  widget's surrogate ring (OTP segments, a pill field) is a visible
  indicator; a proxy's never-rendered thin UA outline alone is reported as
  `focus-indicator-thin`. Fixture: fixtures/keyboard-delegated-focus.html.

## 0.1.0

First public release.

- axe-core scan with a settle wait, tags derived from the policy, findings
  tagged with WCAG criterion and level.
- Motion audit under reduced-motion emulation: shadow-root walk,
  view-transition recorder, infinite-animation and finite-motion findings.
- Reflow check at 320 px naming the overflowing elements.
- Keyboard audit: reachability, traps, visible focus, thin indicators,
  obscured focus, positive tabindex, navigation on focus, skip links.
  Limitations documented in docs/keyboard-limitations.md.
- Policy model: `wcag-aaa` (default), `wcag22-aa`, `wcag21-aa`; per-check
  overrides; best-practice mode.
- Allowlist with required reason and expiry; baseline ratchet with 180-day
  expiry.
- Playwright fixtures (`ramp-check/test`): `a11y.check`, `a11y.scan`,
  `a11yMatrix`.
- Config-driven CLI (`ramp-check`, `ramp-check baseline`, `ramp-check init`)
  with console, JSON and Markdown reports and cross-page consistency checks.
- Composite GitHub Action with artifact upload and a self-updating PR comment.
- Text spacing check (1.4.12), warn-level by default.
- Patterns module (`ramp-check/patterns`): `dialogAudit`, `focusAfter`,
  `expectAnnouncement`, `formErrorAudit`; `a11y.assert` on the fixture.
- ESLint preset (`ramp-check/eslint`) for smooth scroll and view transitions.
- Matrix axis validation; recipes doc.
- Adopter feedback: types build in `prepare` so git installs get types;
  warnings printed on passing runs (`reportWarnings`); `expectClean` and
  documented `failures()` for direct `runChecks` use; composition recipe with
  the "unknown parameter 'a11y'" callout; WCAG technique ids (F78, F44, F110,
  F52) on keyboard findings.
