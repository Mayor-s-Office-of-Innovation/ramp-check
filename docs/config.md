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
| `setup` | `(page) => Promise<void>` | | Runs once per matrix cell before the pages. Log in here, or install route stubs. |
| `storageState` | string or object | | A Playwright storage state (cookies, localStorage, and IndexedDB when saved with `indexedDB: true`) every cell's context starts from. Save it once from a logged-in context with `context.storageState({ path, indexedDB: true })`; cheaper than logging in per cell when codes or devices are rationed. |
| `matrix` | object | `{}` (one cell) | Emulation axes, see below. |
| `consistency` | `boolean \| { nav }` | `true` | Cross-page checks. `nav` is a selector for the primary navigation. |
| `out` | string | `ramp-check-report` | Directory for `ramp-check.json`, `ramp-check.md` and `screenshots/`. |
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
| `checks` | object | all `"auto"`; `textSpacing` and `readingLevel` `"warn"` | Per-check mode: `auto`, `block`, `warn`, `off`. Keys: `axe`, `motion`, `reflow`, `keyboard`, `textSpacing`, `textResize`, `readingLevel`. |
| `tags` | string[] | | Escape hatch: raw axe tags, replaces the derived list. |
| `disableRules` | string[] | | axe rule ids to skip entirely. Prefer the allowlist. |
| `reportWarnings` | `"log" \| "quiet"` | `"log"` | Fixtures only: print warnings to the test output on passing runs. |
| `screenshot` | object | see below | Highlight screenshots of each checked state. |

## Screenshots

Every checked state with something to show is captured once, with each
finding's element boxed and numbered. The `[n]` at the start of a finding
line (console, test failure, Markdown `#` column) is its box in the image.
Blocking findings are numbered first and drawn in red; warnings follow in
blue; the badge number carries the meaning on its own. One element that
fails several rules gets one box. The rest of the page is dimmed slightly so
the boxes stand out while the boxed colours stay true. Findings that cannot
be boxed (page-level targets such as `html` or a view transition, a
selector that no longer resolves, an element with no rendered box) are
listed under "Not in the screenshots" rather than dropped.

The Playwright fixtures attach the image beside the JSON result, so it shows
inline in Playwright's HTML report. The CLI writes
`<out>/screenshots/NN-<page>-<cell>.png` and lists them at the end of the
Markdown report; the Action uploads them with the rest of the report
directory.

```js
screenshot: {
  mode: "findings",   // "findings" (default: only states with a boxable finding) | "always" | "off"
  warnings: true,     // box warnings too, not only blocking findings
  dim: true,          // dim the page around the boxes
  fullPage: true,     // capture the whole document rather than the viewport
  maxHeight: 15000,   // CSS px; taller documents fall back to a viewport capture
},
```

## Check options

```js
motion: { threshold: 5 },              // ms; motion at or below is treated as instant
reflow: { width: 320 },                // CSS px
keyboard: {
  maxSteps: 500,                       // Tab budget (default 2 × controls + 20)
  screenshotFallback: true,            // pixel-compare when styles do not change
},
readingLevel: {
  maxGrade: 9,                         // highest ARI grade that passes (lower secondary ends at 9)
  minWords: 100,                       // shorter main text is not measured
  selector: "main",                    // where the body text lives (default: main, [role=main], article, body)
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
Pass `{ screenshotDir }` to get highlight screenshots; each state then
carries `screenshot: { file, markers, unlocated }`.

```js
import { highlightFindings } from "ramp-check";
const shot = await highlightFindings(page, result.findings); // { png, markers, unlocated } or null
```
