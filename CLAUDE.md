# ramp-check

Automated accessibility checks for Playwright, built so any government
team can add them to CI in minutes. MIT. Node 22+, Playwright 1.50+.

Pitch: everything axe checks, plus the things axe structurally cannot: motion
(reduced-motion audit), keyboard (traversal audit), reflow, and consistency
across pages.

## Conventions

- Plain JavaScript (ESM) with JSDoc types; `tsc` checkJs for typechecking and
  generated `.d.ts`. No TypeScript source, no build step for consumers.
- Runtime dependencies: `@playwright/test` and `@axe-core/playwright` only.
- Every check declares the WCAG criterion and level it enforces. The policy
  (`wcag-aaa` default, `wcag22-aa`, `wcag21-aa`) decides block vs. warn.
- Every check has a seeded defect page under `fixtures/` and a spec under
  `test/` proving it fires. A check without a fixture page is not done.
- Exceptions go through the allowlist (rule, target, reason, expires). No
  silent filters anywhere in the codebase.
- Never run `git add` or `git commit`; the maintainer stages and commits.
- Docs, code, and fixtures never name a specific city, agency, or adopter
  project. The tool is for any government team; the ADA Title II rule is the
  only legal reference cited.
- The README wordmark is decorative: keep it in `<pre aria-hidden="true">`.

## Layout (target)

```
src/checks/   axe.js motion.js keyboard.js reflow.js consistency.js allowlist.js baseline.js
src/policy.js
src/test/     fixtures.js matrix.js
src/cli/      index.js run.js init.js report-*.js
action/       action.yml
fixtures/     seeded defect pages
test/         the tool's own Playwright specs
docs/         quickstart, conformance-level, config, allowlist, baseline, manual checklist
examples/
```
