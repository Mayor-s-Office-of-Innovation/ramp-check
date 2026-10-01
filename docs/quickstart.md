# Quickstart: a site with no test harness

You have a URL, maybe a login, and no Playwright specs. Ten minutes from zero
to a passing (or honestly failing) run.

## 1. Install

In the repo that builds or deploys the site:

```sh
npm install --save-dev ramp-check @playwright/test
npx playwright install chromium
```

Node 22 or later.

## 2. Scaffold

```sh
npx ramp-check init
```

This writes `ramp-check.config.js` (or `.mjs` in a CommonJS package), an
empty `a11y-allowlist.json`, and two npm scripts: `a11y` and `a11y:baseline`.

## 3. Point it at your pages

Edit the config:

```js
export default {
  baseURL: "http://localhost:3000",
  pages: ["/", "/services", "/contact", { path: "/apply", waitFor: "form" }],
  matrix: {
    colorScheme: ["light", "dark"],
    reducedMotion: ["reduce"],
    viewport: ["mobile", "desktop"],
  },
  policy: "wcag-aaa",
  allowlist: "./a11y-allowlist.json",
  baseline: "./a11y-baseline.json",
};
```

Every page is visited once per matrix combination. The example above checks
four pages in eight cells, 32 states. Start smaller if the site is slow.

Need to log in? Add a `setup` hook; it runs once per matrix cell before the
pages:

```js
setup: async (page) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.A11Y_USER);
  await page.getByLabel("Password").fill(process.env.A11Y_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
},
```

## 4. Run

Start the site, then:

```sh
npm run a11y
```

The console lists every failing finding with the page, the rule, the target
element, and the WCAG criterion. `ramp-check-report/ramp-check.md` is the
same thing sized for a pull-request comment, and `ramp-check.json` has
everything.

Exit code 0 means clean. 1 means findings or an expired exception. 2 means
the config could not be loaded.

## 5. Existing findings? Set a baseline

A site that has never been checked will have findings on day one. You do not
have to fix them all before gating:

```sh
npm run a11y:baseline
```

This records every current failure in `a11y-baseline.json`. From now on,
`npm run a11y` fails only on findings that are not in the baseline, and
reports how many baselined findings remain. Each entry expires after 180
days, so the debt has to be paid or consciously renewed. Commit the baseline
file. See [baseline.md](baseline.md).

## 6. Gate in CI

See the [GitHub Action](../action/README.md) for a ten-line workflow that
runs the checks on every pull request and posts the Markdown report as a
comment. Any CI can run `npx ramp-check` and read the exit code.

## Stepping down from AAA

The default policy is WCAG AAA. If that is too strict for your site today,
one line in the config steps down:

```js
policy: "wcag22-aa",
```

Read [conformance-level.md](conformance-level.md) first; it explains what each
level adds and why the default is high.
