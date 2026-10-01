# Configuration reference

`ramp-check.config.js` exports one object. Paths are relative to the config
file. The same options minus the site-level ones (`pages`, `matrix`,
`setup`, `baseline`, `consistency`, `out`) are accepted by the Playwright
fixtures as `a11yConfig`.

## Site

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `baseURL` | string | | Pages are resolved against it. Override with `--base-url`. |
| `pages` | `(string \| PageEntry)[]` | required | What to visit. |
| `setup` | `(page) => Promise<void>` | | Runs once per matrix cell before the pages. Log in here. |
| `matrix` | object | `{}` (one cell) | Emulation axes, see below. |
| `consistency` | `boolean \| { nav }` | `true` | Cross-page checks. `nav` is a selector for the primary navigation. |
| `out` | string | `ramp-check-report` | Directory for `ramp-check.json` and `ramp-check.md`. |
| `timeout` | number | `30000` | Per-action timeout in ms. |
| `headless` | boolean | `true` | Set false to watch the run. |

A `PageEntry`:

```js
{
  path: "/apply",              // relative to baseURL, or an absolute URL
  name: "application form",    // label in reports (default: the path)
  waitFor: "form",             // selector to wait for before checking
  setup: async (page) => {},   // runs after navigation, before the checks
}
```

## Matrix

```js
matrix: {
  colorScheme: ["light", "dark"],          // "light" | "dark" | "no-preference"
  reducedMotion: ["reduce"],               // "reduce" | "no-preference"
  forcedColors: ["none", "active"],        // Windows high contrast
  viewport: ["mobile", "desktop"],         // or { width, height }
}
```

Named viewports: `mobile` 375×812, `tablet` 768×1024, `desktop` 1280×800.
Every page runs once per combination. The motion audit runs only in cells
with `reducedMotion: "reduce"`.

## Policy

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `policy` | `"wcag-aaa" \| "wcag22-aa" \| "wcag21-aa"` | `"wcag-aaa"` | Which findings block. See [conformance-level.md](conformance-level.md). |
| `bestPractice` | `"block" \| "warn" \| "off"` | `"block"` | axe's non-WCAG rules, and this tool's best-practice rules. |
| `checks` | object | all `"auto"`, `textSpacing: "warn"` | Per-check mode: `auto`, `block`, `warn`, `off`. Keys: `axe`, `motion`, `reflow`, `keyboard`, `textSpacing`. |
| `tags` | string[] | | Escape hatch: raw axe tags, replaces the derived list. |
| `disableRules` | string[] | | axe rule ids to skip entirely. Prefer the allowlist. |
| `reportWarnings` | `"log" \| "quiet"` | `"log"` | Fixtures only: print warnings to the test output on passing runs. |

## Check options

```js
motion: { threshold: 5 },              // ms; motion at or below is treated as instant
reflow: { width: 320 },                // CSS px
keyboard: {
  maxSteps: 500,                       // Tab budget (default 2 × controls + 20)
  screenshotFallback: true,            // pixel-compare when styles do not change
  skipLinkThreshold: 3,                // focusable elements before main that warrant a skip link
},
```

## Exceptions

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowlist` | string or entries | | JSON file of `{ rule, target, reason, expires }`. See [allowlist.md](allowlist.md). |
| `baseline` | string | | JSON file written by `ramp-check baseline`. See [baseline.md](baseline.md). |
| `baselineExpiryDays` | number | `180` | How long a baseline entry suppresses. |

## CLI

```
ramp-check [run] [--config path] [--base-url url] [--policy name] [--out dir] [--no-report] [--quiet]
ramp-check baseline [same options]
ramp-check init
```

Exit codes: 0 clean, 1 findings or expired exceptions or page errors, 2
usage or config error.

## Programmatic use

```js
import { runSite } from "ramp-check/cli";
const report = await runSite(config, { writeBaseline: false });
```

`report.failing`, `report.warnings`, `report.allowlisted`, `report.baselined`
are arrays of `{ page, cell, finding }`. `report.ok` is the exit status.
