# Seeded defect pages

Each page shows one thing ramp-check catches, and a spec under `test/` proves
it still catches it. A check without a page here is not done.

| Page | Check | What is seeded |
| --- | --- | --- |
| `clean.html` | all | Nothing. The control every check must stay quiet on. |
| `motion-unguarded.html` | motion | A 4 s entrance animation, an infinite spinner inside a shadow root, and a view transition, none stopped under reduced motion. |
| `motion-guarded.html` | motion | The same page with a correct guard, including the shadow-root and `::view-transition-*` rules. Must stay quiet. |
| `axe-contrast.html` | axe | Text at 4.5:1 (AA passes, AAA fails), text at 2.5:1 (fails AA), an image with no alt. |
| `axe-fade-in.html` | axe | Text fading in. Not a defect: proves the settle wait prevents a bogus contrast failure. |
| `reflow-overflow.html` | reflow | A fixed 600 px element that forces horizontal scrolling at 320 px. |
| `keyboard-clean.html` | keyboard | Working skip link, roving-tabindex tablist and menu, radio group, shadow-root button, a closed `<details>` with a link inside (its summary is reached; the link is not a candidate until it is open). Must stay quiet. |
| `keyboard-unreachable.html` | keyboard | A div with onclick, a span with role="button" and no tabindex, a link with tabindex="-1", a button with tabindex="2". |
| `keyboard-trap.html` | keyboard | An input that swallows Tab. |
| `keyboard-focus-invisible.html` | keyboard | A button with no focus indicator, one with a 1 px outline, one with a proper box-shadow ring. |
| `keyboard-delegated-focus.html` | keyboard | OTP-style widgets whose visible ring is drawn on a surrogate segment while Tab lands on a 1×1 invisible proxy input (`delegatesFocus`). Must stay quiet. One ringless widget must still fail. |
| `keyboard-focus-obscured.html` | keyboard | Links fully and partly under an 80 px fixed banner. |
| `keyboard-skip-link.html` | keyboard | A skip link whose target id does not exist. |
| `keyboard-no-skip-link.html` | keyboard | Five nav links before main and no skip link. |
| `keyboard-iframe.html` | keyboard | An iframe with three buttons. Not a defect: Tab moving through it must not read as a trap. |
| `keyboard-focus-navigates.html` | keyboard | A select that navigates when it receives focus. |
| `text-spacing-clipped.html` | textSpacing | A fixed-height card that clips at line-height 1.5; a pre-truncated box and a fluid box that must not be reported. |
| `patterns-dialog.html` | patterns | A native modal done right, and a class-toggled div that moves no focus, leaks Tab, ignores Escape and returns nothing. |
| `patterns-live.html` | patterns | A status region that announces, a plain div that does not, and an alert created with its content. |
| `patterns-form.html` | patterns | Errors identified with text and focus; a red border alone; native browser validation. |
| `patterns-focus.html` | patterns | A reveal that moves focus to the new heading, and one that leaves it on the button. |
| `consistency-a.html`, `consistency-b.html` | consistency | Two pages with the same title and different primary navigation. Only the multi-page runner can see this. |

Serve them with `node test/serve.js` (port 4173).
