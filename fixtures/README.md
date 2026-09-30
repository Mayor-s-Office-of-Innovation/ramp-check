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

Serve them with `node test/serve.js` (port 4173).
