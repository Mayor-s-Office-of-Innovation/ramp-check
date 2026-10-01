# Changelog

## Unreleased

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
