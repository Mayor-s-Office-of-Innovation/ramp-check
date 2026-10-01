# Changelog

## Unreleased

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
