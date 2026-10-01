# Patterns: checks that need a spec author

The core checks look at a page as it is. These look at what happens when
something is done to it, so each takes an action you write. They live in
`ramp-check/patterns`, return `{ findings, ... }` like every check, and the
fixtures' `a11y.assert(label, findings)` applies the policy and allowlist and
fails the test on blocking ones.

```js
import { test, expect } from "ramp-check/test";
import { dialogAudit, expectAnnouncement, focusAfter, formErrorAudit } from "ramp-check/patterns";

test("checkout dialog", async ({ page, a11y }) => {
  await page.goto("/cart");
  const result = await dialogAudit(page, () => page.getByRole("button", { name: "Checkout" }).click());
  await a11y.assert("checkout dialog", result.findings);
});
```

## dialogAudit(page, open, options?)

Opens a dialog and checks the four things keyboard and screen reader users
need.

| Rule | Criterion | Fires when |
| --- | --- | --- |
| `dialog-focus-not-moved` | 2.4.3 A | focus is still outside the dialog after it opens |
| `dialog-focus-escapes` | 2.4.3 A | Tab or Shift+Tab moves focus out of the dialog |
| `dialog-escape-does-not-close` | best practice | Escape leaves it open (`expectEscape: false` to skip) |
| `dialog-does-not-close` | best practice | your `close` action left it open |
| `dialog-focus-not-returned` | 2.4.3 A | after closing, focus is not back on the element that opened it |

Options: `dialog` (selector or Locator; default the first visible
`dialog[open]`, `[role=dialog]` or `[role=alertdialog]`), `close` (an action
instead of Escape), `expectEscape`, `timeout`.

The trigger is the last element that had focus outside the dialog before it
opened, so clicking the opener with a Locator is enough. A native `<dialog>`
opened with `showModal()` and a `close` handler that refocuses the opener
passes; a `div` toggled with a class usually fails all four.

## focusAfter(page, action, expectation, options?)

After the action, focus must be where you say.

```js
await focusAfter(page, () => page.getByRole("button", { name: "Show details" }).click(), { on: "#details-title" });
await focusAfter(page, () => page.getByRole("button", { name: "Next" }).click(), { within: "main" });
await focusAfter(page, () => page.keyboard.press("Escape"), { returnsTo: "previous" });
```

Reports `focus-not-managed` (2.4.3 A) naming where focus actually is. Targets
may be hidden until the action runs. Use it for route changes, revealed
panels, deleted list items, and anything else that moves content.

## expectAnnouncement(page, action, pattern, options?)

The action must put text matching `pattern` (string or RegExp) into a live
region: `[aria-live]`, `role="status"`, `role="alert"`, `role="log"`, or
`<output>`.

| Rule | Criterion | Fires when |
| --- | --- | --- |
| `announcement-missing` | 4.1.3 AA | no live region received matching text within the timeout |
| `live-region-added-late` | best practice | the only match is in a live region created at the same time as its content |

Live regions are observed from before the action, which is also how screen
readers work: a region that is inserted together with its text is often not
announced. Render the region empty up front and fill it later.

## formErrorAudit(page, submit, options?)

Submit a form invalidly and check the errors are usable.

| Rule | Criterion | Fires when |
| --- | --- | --- |
| `form-error-not-identified` | 3.3.1 A | no field is marked invalid (`aria-invalid="true"` or `:user-invalid`) |
| `form-error-not-described` | 3.3.1 A | a field is marked invalid but no text describes the error (`aria-describedby`, `aria-errormessage`, or a native validation message) |
| `form-error-focus` | best practice | focus did not move to the first invalid field or an error summary |

Options: `form` (selector or Locator to scope the search), `timeout`. Native
browser validation passes: the field matches `:user-invalid` and carries a
validation message.

## What patterns do not do

They run the one action you give them and judge the result. They do not
discover dialogs, forms, or live regions on their own; the config runner has
no way to call them. That is the point: a spec author knows which button
opens the dialog, and the pattern knows what must be true afterwards.
