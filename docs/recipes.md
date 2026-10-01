# Recipes

Short, copyable patterns for common situations.

## Compose with your own login harness

Most apps already override `page` to log in. Extend ramp-check's `test`, not
Playwright's, so `a11y` is available, and keep your override:

```js
// e2e/helpers/harness.js
import { test as base } from "ramp-check/test";
import { login } from "./app.js";

export const test = base.extend({
  page: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});
export { expect } from "ramp-check/test";
```

The motion runtime is installed on the browser context, so it is in place
even though your `page` override navigates before the test body runs.

Set config once at file level; it applies to every matrix cell in the file:

```js
test.use({ a11yConfig: { policy: "wcag22-aa", allowlist: "./a11y-allowlist.json" } });
```

If a test fails with "Test has unknown parameter 'a11y'", the spec extended
Playwright's `test` instead of ramp-check's.

## Themes and reduced motion in one file

```js
import { test, a11yMatrix } from "ramp-check/test";

a11yMatrix({ colorScheme: ["light", "dark"], reducedMotion: ["reduce"] }, (cell) => {
  test(`home (${cell.name})`, async ({ page, a11y }) => {
    await page.goto("/");
    await a11y.check("home");
  });
});
```

Each cell is its own describe block with its own `test.use()`, so the
last-value-wins pitfall of repeated file-level `test.use()` cannot happen.

## Check a state the config runner cannot reach

```js
test("error state", async ({ page, a11y }) => {
  await page.goto("/apply");
  await page.getByRole("button", { name: "Submit" }).click();
  await a11y.check("application form with errors");
});
```

## Back-button flow under reduced motion

The route swap is where motion hides. Audit after going forward and after
going back, before waiting for anything else, since finished animations leave
`getAnimations()`:

```js
test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("route swap and back", async ({ page, a11y }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Details" }).click();
    await a11y.check("details after forward navigation");
    await page.goBack();
    await a11y.check("home after back");
  });
});
```

View transitions are recorded from an init script regardless of timing.

## Navigation consistency inside a spec

The runner compares the primary navigation across pages. In a spec, pin the
structure with Playwright's aria snapshot and let the diff show the drift:

```js
test("primary nav structure", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toMatchAriaSnapshot(`
    - navigation "Primary":
      - link "Home"
      - link "Services"
      - link "Contact"
  `);
});
```

## Allow one thing, loudly

```json
[
  {
    "rule": "keyboard-trap",
    "target": "code-editor >>> textarea",
    "reason": "The editor consumes Tab for indentation; Escape then Tab leaves it, and the hint text says so.",
    "expires": "2027-04-01"
  }
]
```

Use a trailing `*` to match a prefix when selector paths are unstable:
`"target": "wa-spinner >>> *"`.

## Promote one check above the policy

```js
test.use({ a11yConfig: { policy: "wcag22-aa", checks: { motion: "block", textSpacing: "block" } } });
```

## Lint for the motion mistakes a runtime check cannot see

```js
// eslint.config.js
import { rampCheck } from "ramp-check/eslint";
export default [...rampCheck({ viewTransitionsIn: ["src/router.js"] })];
```

Flags `behavior: "smooth"` in scroll calls (JS smooth scrolling ignores the
CSS reduced-motion override) and `startViewTransition()` outside the files you
name.
