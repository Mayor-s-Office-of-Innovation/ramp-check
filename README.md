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

Status: phase 0. The core checks and Playwright fixtures work; the
config-driven CLI, the keyboard audit, and the GitHub Action are next.
See [Roadmap](#roadmap).

## Is this a replacement for manual accessibility testing?

No. This helps increase automated coverage but you still need to test your applications with a screenreader and get feedback from real people that depend on assistive technologies.

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

`a11y.check(label)` waits for animations to settle, runs axe, and checks
reflow at 320 px. Under `reducedMotion: "reduce"` it also runs the motion
audit. Blocking findings fail the test with one line each; warnings are
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

Every check has a seeded defect page under [fixtures/](fixtures/) and a spec
under [test/](test/) proving it fires.

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
covers axe's share plus motion, reflow, and (soon) keyboard operation. It
does not test screen-reader output, content quality, timing, or whether a
flow makes sense. Most government accessibility standards require manual
testing and testing with people with disabilities as well; a green run here
is a prerequisite, not compliance.

## Roadmap

| Phase | Deliverable |
| --- | --- |
| 0 (now) | axe, motion, reflow, allowlist, policy, fixtures, `a11yMatrix` |
| 1 | keyboard audit: reachability, visible focus, not obscured, no trap, skip link |
| 2 | config-driven runner and CLI for teams without specs; JSON and Markdown reports; baseline ratchet; site consistency |
| 3 | GitHub Action with PR comment |
| 4 | 1.0 |

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
