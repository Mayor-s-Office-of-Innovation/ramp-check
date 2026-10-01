# ramp-check

<!-- Decorative: the H1 above carries the name, so assistive tech skips this. -->
<pre aria-hidden="true">
  ____      _    __  __ ____     ____ _   _ _____ ____ _  __
 |  _ \    / \  |  \/  |  _ \   / ___| | | | ____/ ___| |/ /
 | |_) |  / _ \ | |\/| | |_) | | |   | |_| |  _|| |   | ' /
 |  _ <  / ___ \| |  | |  __/  | |___|  _  | |__| |___| . \
 |_| \_\/_/   \_\_|  |_|_|      \____|_| |_|_____\____|_|\_\
</pre>

Automated accessibility checks for Playwright, easy to add to CI.

Everything axe checks, plus the things axe structurally cannot: motion
(does the page honor reduced motion?), keyboard (can you reach everything?),
reflow (does it fit a narrow screen?).

Status: phase 1. The core checks, the keyboard audit, and the Playwright
fixtures work; the config-driven CLI and the GitHub Action are next.
See [Roadmap](#roadmap).

## Is this a replacement for manual accessibility testing?

No. This helps increase automated coverage but you still need to test your applications with a screenreader and get feedback from real people that depend on assistive technologies.

### In CI

```yaml
      - uses: Mayor-s-Office-of-Innovation/ramp-check/action@main
        with:
          config: ramp-check.config.js   # or base-url: ${{ steps.deploy.outputs.url }}
```

Uploads the JSON report, writes the summary to the job, and posts one
pull-request comment that later runs update in place. See
[action/README.md](action/README.md) and the
[example site](examples/minimal-static-site/).

## Quickstart (teams with Playwright specs)

```sh
npm install --save-dev ramp-check
```

```js
import { test, expect } from "ramp-check/test";

test("checkout dialog", async ({ page, a11y }) => {
  await page.goto("/cart");
  await page.getByRole("button", { name: "Checkout" }).click();
  await a11y.check("checkout dialog");
});
```

`a11y.check(label)` waits for animations to settle, runs axe, checks
reflow at 320 px, and runs the keyboard audit (a full Tab traversal; see
[docs/keyboard.md](docs/keyboard.md) for how it decides and
[docs/keyboard-limitations.md](docs/keyboard-limitations.md) for what it
cannot catch).
Under `reducedMotion: "reduce"` it also runs the motion audit. Blocking findings fail the test with one line each; warnings are
recorded as test annotations; the full result is attached as JSON.

To cover both color schemes and reduced motion in one file, let `a11yMatrix`
generate the describe blocks. Each cell gets its own correctly scoped
`test.use()`, so the last-value-wins pitfall of repeated file-level
`test.use()` calls cannot happen.

```js
import { test, a11yMatrix } from "ramp-check/test";

a11yMatrix(
  { colorScheme: ["light", "dark"], reducedMotion: ["reduce"], viewport: ["mobile", "desktop"] },
  (cell) => {
    test(`home (${cell.name})`, async ({ page, a11y }) => {
      await page.goto("/");
      await a11y.check("home");
    });
  },
);
```

## Patterns: dialogs, focus, announcements, form errors

Some checks need an action only a spec author knows. `ramp-check/patterns`
has four:

```js
import { dialogAudit, focusAfter, expectAnnouncement, formErrorAudit } from "ramp-check/patterns";

test("checkout dialog", async ({ page, a11y }) => {
  await page.goto("/cart");
  const result = await dialogAudit(page, () => page.getByRole("button", { name: "Checkout" }).click());
  await a11y.assert("checkout dialog", result.findings);
});
```

`dialogAudit` checks focus moves in, Tab stays in, Escape closes, focus
returns. `focusAfter` checks where focus lands after any action.
`expectAnnouncement` checks a live region received the text. `formErrorAudit`
checks errors are identified, described, and focused. See
[docs/patterns.md](docs/patterns.md), and [docs/recipes.md](docs/recipes.md)
for composing with a login harness and other common setups.

## Lint rules

```js
// eslint.config.js
import { rampCheck } from "ramp-check/eslint";
export default [...rampCheck({ viewTransitionsIn: ["src/router.js"] })];
```

Catches `behavior: "smooth"` and stray `startViewTransition()` calls, the two
motion mistakes CSS reduced-motion guards cannot fix.

## Choosing your conformance level

The default policy is WCAG AAA. Stepping down is one line:

```js
test.use({ a11yConfig: { policy: "wcag22-aa" } });
```

| Policy | Blocks | Warns |
| --- | --- | --- |
| `wcag-aaa` (default) | every WCAG 2.2 A, AA and AAA finding, and this tool's own checks | nothing |
| `wcag22-aa` | WCAG 2.2 A and AA | AAA findings, including the motion audit (2.3.3) |
| `wcag21-aa` | WCAG 2.1 A and AA | everything WCAG 2.2 added, and AAA |

Warnings are always reported. Per-check
overrides let you keep one thing stricter than the policy, for example
`checks: { motion: "block" }` under an AA policy.

In
practice, AAA with axe-core 4.13 means the 7:1 enhanced contrast rule, two
rarely-triggered rules, and this tool's motion audit becoming blocking.

Legal context: the DOJ's ADA Title II rule holds state and local governments
to WCAG 2.1 AA, with compliance dates in April 2026 for large entities and
April 2027 for the rest.

Details and the ADA references: [docs/conformance-level.md](docs/conformance-level.md).

## What each check enforces

| Check | Criterion | Level | What it catches |
| --- | --- | --- | --- |
| axe | per rule | per rule | everything axe-core 4.13 checks, tagged by criterion and level |
| motion: `reduced-motion-ignored` | 2.3.3 | AAA | finite animations and transitions still running under `prefers-reduced-motion: reduce`, including inside shadow roots |
| motion: `infinite-animation` | 2.2.2 | A | looping animations (spinners) not stopped under reduced motion |
| motion: `view-transition-animates` | 2.3.3 | AAA | `document.startViewTransition()` cross-fades, which the API does not skip under reduced motion and a `*` CSS rule cannot reach |
| reflow: `reflow-horizontal-scroll` | 1.4.10 | AA | horizontal scrolling at 320 px, naming the elements that stick out |
| keyboard: `keyboard-unreachable` | 2.1.1 | A | interactive elements (controls, `[role]` widgets, `[onclick]`) a full Tab traversal never reaches, following focus into shadow roots |
| keyboard: `keyboard-trap` | 2.1.2 | A | Tab stops moving focus |
| keyboard: `positive-tabindex` | 2.4.3 | A | `tabindex` above zero overrides document order |
| keyboard: `focus-not-visible` | 2.4.7 | AA | no computed-style or pixel change when an element takes focus |
| keyboard: `focus-indicator-thin` | 2.4.13 | AAA | the only indicator is an outline under 2 px (heuristic) |
| keyboard: `focus-obscured`, `focus-partially-obscured` | 2.4.11, 2.4.12 | AA, AAA | the focused element is behind a sticky header, banner or overlay |
| keyboard: `focus-changes-context` | 3.2.1 | A | receiving focus navigates the page |
| keyboard: `skip-link-broken`, `skip-link-missing` | 2.4.1 | A, best practice | a skip link that goes nowhere, or a long nav with no way past it |
| textSpacing: `text-spacing-clipped` | 1.4.12 | AA | text clipped once line height, letter, word and paragraph spacing are raised to the WCAG values (warns by default) |
| consistency: `duplicate-page-title`, `inconsistent-navigation` | 2.4.2, 3.2.3 | A, AA | runner only: titles shared across pages, primary navigation that differs between pages |

Every check has a seeded defect page under [fixtures/](fixtures/) and a spec
under [test/](test/) proving it fires.

## Adopting with existing debt: the baseline

`npx ramp-check baseline` records every current failure with a 180-day
expiry. Later runs fail only on new findings and report how much debt
remains. Expired entries fail by name until fixed or consciously renewed.
See [docs/baseline.md](docs/baseline.md).

## Consistency across pages

The runner also checks what single-page tools cannot: every page title is
distinct (2.4.2), and the primary navigation's accessible structure is the
same on every page within a matrix cell (3.2.3).

## Exceptions: the allowlist

Every exception is an entry with a rule, a
target, a reason, and an expiry date. An expired entry fails the run by
name until removed.

```json
[
  {
    "rule": "color-contrast-enhanced",
    "target": "p.muted",
    "reason": "Secondary text tokens are being raised to 7:1 in the design system refresh.",
    "expires": "2027-03-31"
  }
]
```

```js
test.use({ a11yConfig: { allowlist: "./a11y-allowlist.json" } });
```

See [docs/allowlist.md](docs/allowlist.md).

## Using the checks directly

Every check is a plain function that takes a Playwright `page` at the state
to test and returns findings.

```js
import { axeScan, motionAudit, reflowCheck, runChecks } from "ramp-check";

const { findings } = await motionAudit(page);          // needs reducedMotion: "reduce"
const result = await runChecks(page, { policy: "wcag22-aa" }, { reducedMotion: true });
```

The motion audit only sees animations still running when it is called, so
call it right after the action you want to audit. View transitions are the
exception: the fixtures install a page init script that records every
`startViewTransition` call regardless of timing.

## What this does not catch

Automated tools find a fraction accessibility problems. This tool
covers axe's share plus motion, reflow, and keyboard reachability and focus
visibility. It does not test screen-reader output, content quality, timing,
arrow-key or Enter/Space operation of custom widgets, or whether a flow makes
sense. The keyboard audit's blind spots are listed in
[docs/keyboard-limitations.md](docs/keyboard-limitations.md). Most government accessibility standards require manual
testing and testing with people with disabilities as well; a green run here
is a prerequisite, not compliance.

## Roadmap

| Phase | Deliverable |
| --- | --- |
| 0 | axe, motion, reflow, allowlist, policy, fixtures, `a11yMatrix` |
| 1 | keyboard audit: reachability, visible focus, not obscured, no trap, skip link |
| 2 | config-driven runner and CLI for teams without specs; JSON and Markdown reports; baseline ratchet; site consistency |
| 3 | GitHub Action with PR comment |
| 4 (now) | 0.1.0 published; 1.0 after the Action is seen on a real PR and an outside team adopts in under ten minutes |
| 5 | text spacing check; patterns module; ESLint preset; recipes (built; shipping with 0.1.0) |
| later | opt-in keyboard extensions listed in [docs/keyboard-limitations.md](docs/keyboard-limitations.md) |

## Requirements

Node 22+, Playwright 1.50+, Chromium. Runtime dependencies are
`@playwright/test` (peer) and `@axe-core/playwright` only.

## Contributing

```sh
npm install
npx playwright install chromium
npm test
npm run typecheck
```

A check without a seeded defect page in `fixtures/` and a spec in `test/` is
not done.

## License

MIT
