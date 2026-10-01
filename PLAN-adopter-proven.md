# Plan: adopter-proven improvements

Status: working plan, not a living reference. Written 2026-10-01 after the first real
adoption of phase-0 ramp-check (git-pinned, `#1971a49`) into a government field app
(web components + Web Awesome, Playwright 1.63, ESM JS + JSDoc + tsc checkJs — same
conventions as this repo). Each item names the adoption friction it removes. Work them in
any order; items are independent. When done, delete this file and fold the durable notes
into README/docs.

## 1. Publish to npm with bundled .d.ts (biggest friction)

**What adoption hit:** `prepack` (build:types) is skipped on git installs, so a git-pinned
consumer gets **no types**. The adopter wrote a 52-line hand-rolled
`declare module "ramp-check/test"` ambient `.d.ts` transcribing `A11y`, `A11yFixtures`,
`a11yMatrix`, `matrix`, `check/scan` signatures just to keep `checkJs` green. This is the
item that most slows "add to CI in minutes".

**Do:**

- [ ] Publish phase-0 to npm (even as `0.x`), and make the type build unconditional:
      commit `types/` or run `build:types` in a `prepare` script (npm runs `prepare` on git
      deps but not `prepack`) so git installs get types too.
- [ ] Verify a git dependency `npm i -D github:…/ramp-check#<sha>` resolves types without
      any consumer-side declaration (the adopter's `e2e/types/ramp-check.d.ts` is the
      regression test — it should become deletable).
- [ ] Export surface check: consumers need `.` (checks + run) and `/test` (fixtures +
      matrix). The `.d.ts` for `/test` must re-export `matrix` and `VIEWPORTS`/`cells` —
      adopters compose `matrix(axes, body, { test })` with their own fixture-extended test
      (see §5).

**Acceptance:** fresh consumer repo, `npm i -D ramp-check` AND `npm i -D
github:…#<sha>`; `tsc --noEmit checkJs` over a spec importing `ramp-check/test` passes
with zero consumer-side `.d.ts`.

## 2. Visible warnings in a passing run

**What adoption hit:** under `wcag22-aa`, AAA findings are test annotations only —
invisible in the CLI line output of a green run. The adopter had to run one full AAA
policy pass to discover the site's `color-contrast-enhanced` (7:1, 1.4.6) debt across
nearly every surface. The policy model already says "warnings are always reported" — but
only into the report attachment/traces, where nobody looks on green.

**Do:**

- [ ] Default: when `a11y.check()` finishes with warnings, print one line per warning to
      the step log (e.g. `[a11y] warn: color-contrast-enhanced: .lastlog__eyebrow
      [1.4.6 AAA]`), via `testInfo.attach` + `console.warn`. Cheap, zero config.
- [ ] Optional config: `a11yConfig: { reportWarnings: "log" | "quiet" }` if noise needs an
      escape hatch (default "log").
- [ ] `a11y.check()` returns the `CheckResult` (already does) — document the
      programmatic path (`result.warnings`) in fixtures.js's header.

**Acceptance:** a deliberately contrast-deficient page under `wcag22-aa` passes, and the
passing test's log shows the warning lines; warnings still appear as annotations in the
HTML report.

## 3. Exported assertion helper for custom runners

**What adoption hit:** the adopter composes their bound-page fixture over ramp-check's
`test` and drives checks through the `a11y` fixture — fine. But anything driving
`runChecks()` directly (their CLI-adjacent helpers, custom fixtures) re-derives the
failure assertion from `result.blocking` and the expired-allowlist lines by hand.

**Do:**

- [ ] Export a small `expectClean(result, label?)` from `ramp-check` root (or a
      `failures()` re-export next to `runChecks` — `failures()` already exists in run.js;
      just document + re-export from index.js so the root package surface covers it).
- [ ] Document the direct-drive pattern in README ("Using the checks directly"):
      `runChecks(page, { policy })` → `expect(failures(result)).toEqual([])`.

**Acceptance:** a spec written against `runChecks` + exported `failures` needs no
knowledge of the result's internal shape.

## 4. Per-cell config in matrix()

**What adoption hit:** adopters composing their own fixture-extended test with matrix
cells needed to put `a11yConfig` into the matrix body (a `test.use()` inside each
describe block). Works, but repeated config in every matrix body is boilerplate, and the
allowlist path is easy to forget on one cell.

**Do:**

- [ ] `matrix(axes, body, { test, config })` — one `test.use(config)` inside every cell's
      describe block. Same for `a11yMatrix`.
- [ ] Keep precedence straight: cell axes (emulation) remain their own `test.use`;
      `config` merges on top; per-`test.use()` calls in the body still win (they're
      closer).

**Acceptance:** the adopter's whole bound-app block reads
`matrix(axes, body, { test: boundA11y, config: { a11yConfig: { policy, allowlist } } })`
with the body's own `test.use()` gone; matrix's own fixture tests prove per-cell config
lands in every cell.

## 5. Document the composition pattern (docs, not code)

**What adoption hit:** every app with a login/binding flow has a `page` fixture
extension. Composing that with ramp-check's fixtures is one line
(`test.extend({ page: myBoundPage })`), but nothing in the README says it's supported or
that `matrix(..., { test })` exists for this. The adopter burned a cycle on composing
onto the wrong test object (their harness instead of ramp-check's), which surfaced as
"unknown parameter: a11y" at runtime.

**Do:**

- [ ] README section: "You already have fixtures / a login flow" —
      `myTest = test.extend({ page: myPage })`; import `matrix` and pass
      `{ test: myTest }`; keep `a11yMatrix` for the plain-page case.
- [ ] Name the failure mode ("Test has unknown parameter 'a11y'" = extended the wrong
      base test) so search engines/agents can pattern-match the error to the fix.
- [ ] Add a fixture-level test in this repo proving compose-with-extend +
      `matrix(…, { test })` works with app-supplied fixtures (mirrors the adopter shape).

## 6. Keyboard audit (phase 1, already planned)

The adopter's app is dialog- and menu-heavy (`wa-dialog`, dropdown menus, OTP input);
traversal/visibility-of-focus/no-trap/skip-link is the missing high-value coverage. No
change to this plan's shape — just the reminder that its spec has an adopter-shaped use
case ready: five fixed states scanned today, each an easy keyboard-audit target.

## Non-items (deliberately not planned)

- CLI/baseline ratchet (phase 2) — unaffected by this adoption; teams with specs don't
  need the CLI yet.
- GitHub Action (phase 3) — adoption ran inside an existing Playwright job.
- `check`-scoped allowlist matching, stricter regex targets — existing prefix matching
  was sufficient; no friction observed.

## Adopter context (for the implementer, then delete)

Adoption surface: a 5-state a11y spec — 5 states × (light/dark × reducedMotion
"reduce") = 10 tests via `a11yMatrix`/`matrix`, policy `wcag22-aa`, allowlist with 2
entries (`landmark-unique` on analysis-tray regions; `infinite-animation` on an OTP
input — Web Awesome caret blink lives in shadow root, unreachable by an app-level `*`
reduced-motion rule). Spec rewritten; the hand-rolled `settle`/`scan`/`assertClean`
machinery (~70 lines incl. a local animation-settle helper) was deleted. View
transitions: app's route swaps guard 2.3.3 correctly (already fixed in product). Real
catch the adoption produced: the OTP caret blink finding — a 2.2.2 A issue invisible to
the prior hand-rolled scans, in a Web Awesome shadow root.