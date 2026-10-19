# Audit status — shipped, validated, planned

Ramp-check's checks are hardened on real sites before they ship: each run of
the [100-origin test corpus](test-corpus.md) produces findings, and every
finding class a check produces is manually adjudicated (true positive / false
positive / understood mechanism) before the check's behavior is described as
solid in the docs. The runner, the commands, and the standing validation
protocol are documented in [test-corpus.md](test-corpus.md). This page is the
work record: which audits exist, where they fired, what has been confirmed on
the corpus, and what is planned next.

Three corpus runs are behind this page:

| Run | Date | Engine | Checked URLs | Findings (axe / ramp-check) | Purpose |
| --- | --- | --- | --- | --- | --- |
| v1 | Oct 8 2026 | pre-fix | 74 | 3,678 / 944 | false-positive discovery |
| v2 | Oct 8 2026 | honesty gates + text-spacing rewrite | 70 | 3,538 / 681 | FP-delta measurement |
| probe | Oct 15 2026 | + text-resize check | 60 of 43 new origins | 5,610 / 1,594 | validate the 47 corpus additions |

Statuses used below:

- **TP** — a failure manually confirmed as a real defect (a person eyeballed
  it, or a live probe reproduced the mechanism).
- **FP** — a confirmed false positive; the engine change that removes it has
  shipped with a seeded fixture and spec.
- **pending** — recorded against the corpus, not yet manually adjudicated.
  The corpus's standing rule: every finding class gets adjudicated before the
  next full run, so "pending" means "in the review queue", not "known good".
- **(banner-open)** — measured honestly while the site's own first-visit
  overlay (consent banner, notice) is open. The measurement is real; whether
  the tool should defer while a *dismissible* overlay is up is an open product
  question.
- **(bot wall)** — the site's bot-detection interstitial produced the
  finding's target; not an accessibility defect of the page.
- **engine-gated** — the identified false-positive mechanism is gated in the
  engine (fixture + spec shipped); the rows left are the measured residual.

## Planned, not implemented

From a manual walkthrough audit of an authentication flow (26 findings,
deduped to 10 root causes) and verification that axe-core 4.13 catches 0 of
those 26 — the next wave of checks, each probe-verified axe-blind:

| Planned check | Rules | Addresses | Planned default |
| --- | --- | --- | --- |
| `initialFocus` | `load-focus-outside-main` (2.4.3 A) | C2 — on fresh page loads, keyboard/AT users land on the global header instead of the page's content (5/26 findings; the highest-yield automatic rule) | auto |
| `forms` | `visible-label-unassociated`, `hint-not-associated` (3.3.2 A); `required-indicator-missing` (3.3.2 A); `placeholder-as-hint`, `form-not-named`, `show-password-default-on` (best practice) | C4, C8's static half, the label sub-part of C6, C10's show-password default; required-indicator absence (8/26 — the widest static gap; axe's `label` rule is satisfied by the exact naming sources the audit rejected) | warn |
| `names` | `duplicate-control-name` (2.4.4 A); `generic-control-name` (best practice) | C5 — controls whose accessible names give no context ("Sign in", "Get a code", "Close") (2/26) | warn |
| `landmarks` | `duplicate-h1` (best practice); `nav-without-links` (1.3.1 A); `link-menu-without-nav` (best practice) | C9 — unnamed forms→`forms`, but heading/nav membership here (4/26; probe-verified that axe misses two `h1`s) | warn |
| `disclosure` | `haspopup-bare-value`, `haspopup-expanded-missing`, `toggle-expanded-missing` (4.1.2 A) | C10's static half — toggle state attributes (2/26; `aria-haspopup="true"` is a *valid* value in axe's ARIA lookup, so nothing fires) | warn |
| flow patterns | revealAudit: `reveal-focus-unmoved` (2.4.3 A), `reveal-tab-skipped` (2.4.3 A), `reveal-tab-order-inverted` (best practice); timed-flow support; recipe docs | C1 (revealed controls skipped by Tab), C6 (timed flow with hidden expiry), C7 (tab order mismatch) — the only path to the flow-shaped defects; also promotes the existing `focusAfter`/`expectAnnouncement`/`formErrorAudit` patterns (C2, C3) into a documented walkthrough recipe (4/26 + recipe) | per-pattern |

## Implemented: axe

The axe scan is the trusted baseline: it runs unmodified and its findings are
counted as real. Two uses in this research: (1) confirming what axe already
saturates, so new work stays on what axe structurally cannot reach; (2) a
calibration queue of rare findings on famous sites, eyeballed to keep the
trust in the baseline honest.

Saturations on the corpus (origins affected out of 100):

| Rule | v2 | probe | Example sites |
| --- | --- | --- | --- |
| `color-contrast-enhanced` | 43 | 44 | gov.uk, webaim.org, developer.mozilla.org; npr.org, aljazeera.net, booking.com |
| `region` | 30 | 32 | developer.mozilla.org, gov.uk, scangov.com |
| `color-contrast` (4.5:1) | 16 | 20 | scangov.org, debian.org, techcrunch.com |
| `landmark-unique` / `heading-order` | 14 | 21 / 13 | wikipedia.org, archive.org, vuejs.org |
| `target-size` | 11 | 13 | developer.mozilla.org, standards.scangov.org, www.debian.org |
| `link-name` | 4 | 12 | techcrunch.com, news.ycombinator.com, npr.org |
| `image-alt` | 1 | 12 | news.ycombinator.com; npr.org, aljazeera.net |

(`region`, `heading-order`, `landmark-one-main`, `landmark-unique` are
axe "best practice" rules that currently block under every policy — the
frequency here is part of a pending policy decision, see below.)

Calibration strays pending eyeball (rare axe findings on famous sites,
checked as much for the corpus's honesty as the sites'):

- gitlab.com `aria-required-parent`/`children` on the home nav menus
- debian.org / walgreens.com / pinterest.com `aria-hidden-focus`
- wikipedia.org `aria-allowed-role` (menu checkbox); guardian.com slide
  `role`/`listitem`/`image-redundant-alt`; techcrunch.com `legend`/`list`
- angular.dev `scrollable-region-focusable` (×4)
- target.com `frame-title` on the `px-captcha` interstitial (bot wall
  leaking into results — a runner-classification gap, not a site defect)

## Implemented: keyboard audit

Full Tab traversal per page: reachability, trap, visible focus, obscured
focus, skip links, tabindex hygiene. The largest custom check and the largest
adjudication effort on the corpus (FP mechanisms per rule are summarized in
each subsection).

### skip-link-broken (2.4.1 A)

Activation check unique to ramp-check: the skip link exists and axe's
`skip-link` target rule passes, but pressing it goes nowhere. Class verdict
from v1: 7/7 true positives (MDN 404 target, archive.org missing id,
nextjs.org gone target, vitepress.dev focus unmoved, target.com missing id) —
axe only covers targets-not-existing, not activation-not-moving-focus.

| Site | Findings | Run | Status |
| --- | --- | --- | --- |
| archive.org | 1 | v2 | TP (target id does not exist) |
| nextjs.org | 1 | v2 | TP (skip target gone) |
| vitepress.dev | 1 | v2 | TP (focus unmoved into content) |
| medlineplus.gov | 2 | probe | pending |
| developer.chrome.com | 2 | probe | pending |
| npr.org | 2 | probe | pending |
| lemonde.fr | 1 | probe | pending |
| telerik.com | 1 | probe | pending |

### focus-not-visible (2.4.7 AA)

Rule verified honestly on the corpus with the pixel-probe machinery:
computed-style diff at rest vs `:focus-visible` plus a screenshot diff
fallback. The first three adjudicated sites were user-confirmed real defects.

| Site | Findings | Run | Status |
| --- | --- | --- | --- |
| scangov.org | 1 | v2 | TP (user-verified: the nav-pill chip's own `.active:focus` rule overrides the focus ring; pixels byte-identical) |
| standards.scangov.org | 2 | v2 | TP (same design family, docs page) |
| techcrunch.com | 1 | v2 | pending ("Do Not Sell" footer button; live probe suggests honest — no visible indicator) |
| debian.org | 1 | v2 | pending |
| craigslist.org | 4 | v2 | pending |
| angular.dev | 5 | v2 | pending |
| intel.com (www) | 5 | v2 | pending |
| nuxt.com | 3 | v2 | pending |
| docusaurus.io | 2 | v2 | pending |
| gitlab.com | 1 | v2 | pending |
| airbnb.com | 1 | v2 | pending |
| pinterest.com | 1 | v2 | pending |
| ikea.com (www) | 5 | probe | pending |
| radix-ui.com (www) | 7 | probe | pending |
| lemonde.fr | 4 | probe | pending |
| developer.chrome.com | 3 | probe | pending |
| ghost.org, telerik.com | 2 each | probe | pending |
| ant.design, go.dev, kubernetes.io, laravel.com, joomla.org, react-spectrum.adobe.com, sanity.io, scmp.com | 1 each | probe | pending |
| mainichi.jp | 2 | probe | pending |

### focus-obscured / focus-partially-obscured (2.4.11 AA / 2.4.12 AAA)

Measurements verified honest; the open product question is whether to defer
while a dismissible overlay is open (the banner-open mechanism). One class of
FP was proven and fixed: paint-transparent occluders (the stretched-link card
pattern) no longer count as coverage — nuxt.com's finding cleared after the
fix.

| Site | focus-obscured | focus-partially | Run | Status |
| --- | --- | --- | --- | --- |
| wikipedia.org (www) | 7 | 2 | v2 | TP (site's own fundraising notice covers language links/search; user re-verified; banner-open) |
| scangov.com | 2 | — | v2 | TP (skip links under the site's own consent banner; banner-open) |
| scangov.org | — | 1 | v2 | pending (banner-open class) |
| en.wikipedia.org | — | 5 | v2 | pending (same centralNotice overlay class) |
| wix.com (www) | 8 | 7 | v2 | pending |
| svelte.dev | 3 | 2 | v2 | pending |
| angular.dev | 3 | 3 | v2 | pending |
| lit.dev | 3 | — | v2 | pending |
| paypal.com (www) | 1 | 4 | v2 | pending |
| nextjs.org | — | 2 | v2 | pending |
| webflow.com | 1 | 1 | v2 | pending |
| airbnb.com (www) | — | 1 | v2 | pending |
| intel.com, pinterest.com | 1 | — | v2 | pending |
| sanity.io | 17 | 2 | probe | pending |
| ikea.com (www) | 13 | 4 | probe | pending |
| lemonde.fr | 13 | — | probe | pending |
| mui.com | 9 | 1 | probe | pending |
| spring.io | 7 | 2 | probe | pending |
| react-spectrum.adobe.com | — | 9 | probe | pending |
| radix-ui.com (www) | 6 | — | probe | pending |
| scmp.com | 1 | 3 | probe | pending |
| mainichi.jp | 2 | 2 | probe | pending |
| laravel.com | 1 | 3 | probe | pending |
| chakra-ui.com, python.org, rfc-editor.org | 1 | — | probe | pending |
| costco.com | — | 2 | probe | pending |
| docs.github.com, usgs.gov | — | 1 | probe | pending |

### keyboard-unreachable (2.1.1 A)

The corpus's biggest FP school, now the engine's honesty gates. v1
adjudication: ~65% false positives by three mechanisms — (1) consent-overlay
rings cycle the traversal (gitlab.com 79 findings, walgreens 25: the banner's
tab ring *is* the whole page to the audit); (2) SPA re-render between
inventory and traversal (pinterest, craigslist: inventoried nodes replaced);
(3) legitimate widget patterns misread as unreachable (roving-tab
`role=tab tabindex=-1` on MDN, angular.dev; label-anchored visually-hidden
inputs on techcrunch). All three gates shipped with fixtures and measured
live deltas: gitlab 79→1, walgreens 25→1, craigslist 41→0, pinterest 13→2,
MDN about 4→0. v2's residuals are the ones below; probe numbers are
unadjudicated.

| Site | Findings | Run | Status |
| --- | --- | --- | --- |
| squarespace.com | 5 | v2 | user-validated: traversal clean; 3–5 residual `tabindex=-1` carousel controls named honestly, judged defensible |
| techcrunch.com | 1 | v2 | TP (state-holder annotation: the hidden checkbox input and its reachable card button, correctly split) |
| craigslist.org | 2 | v2 | engine-gated (traversal-ended-early churn annotation, live-verified) |
| gitlab.com, about.gitlab.com | 2 / 1 | v2 | engine-gated (banner ring); residual pending |
| walgreens.com, angular.dev, pinterest.com, debian.org, en.wikipedia.org, nuxt.com, webflow.com, intel.com, spotify.com, docs.aws.amazon.com | 1–3 each | v2 | residual, pending spot-check |
| ikea.com | 113 | probe | pending — mass-fire candidate, overlay-ring class (round-5 queue) |
| aljazeera.net | 18 | probe | pending |
| cdc.gov | 6 | probe | pending |
| ant.design, react-spectrum.adobe.com | 5 / 6 | probe | pending |
| chakra-ui.com | 3 | probe | pending |
| npr.org, usgs.gov | 2 each | probe | pending |
| m3.material.io, mainichi.jp, dell.com, openstack.org, telerik.com | 1 each | probe | pending |

### keyboard-trap (2.1.2 A)

Trap-in-modal relabel shipped (a dialog holding Tab is dialog behavior, not
2.1.2); repeat-on-carousel-clone now re-inventories instead of reporting a
trap.

| Site | Findings | Run | Status |
| --- | --- | --- | --- |
| theguardian.com | 2 | v2 | relabeled (traversal scoped into the Sourcepoint CMP modal by design; message honest) |
| target.com | 2 | v2 | bot wall (`px-captcha` interstitial; runner-classification gap being fixed sweep-side) |
| webflow.com | 1 | v2 | pending (transcend consent manager; the audit did not see `aria-modal` — relabel-fallback candidate) |
| 8 probe origins (ant.design, go.dev, laravel.com, rubyonrails.org, contentful.com, ikea.com, joomla.org, sanity.io) | 1 each | probe | pending |

### focus-indicator-thin (2.4.13 AAA)

Summarized rather than tabulated: 406 findings on 28 origins (v2) and 533 on
35 more (probe) — the corpus's noisiest custom rule. Known FP mechanism: the
Chrome default ring is `outline: auto 1px` — computed 1 px but painted as a
2 px+ halo, so style math sees "thin" where pixels see a ring. The v1
records compacted away the style data that would prove it either way; the
uncompacted-record fix has since landed in the runner, unblocking
adjudication. Next review round, seeded shortlist: news.ycombinator.com
(expected TP: plain 1 px), vuejs.org / docusaurus.io / MDN (expected FP:
halo/box-shadow). Everything pending.

### positive-tabindex (2.4.3 A)

Unobserved on the v1/v2 web corpus — its first live fire is from the probe:
bestbuy.com (1), cdc.gov (3), python.org (2). First real-world evidence that
the rule catches something; pending adjudication.

## Implemented: motion audit

### infinite-animation (2.2.2 A)

| Site | Findings | Run | Status |
| --- | --- | --- | --- |
| wix.com | 23 | v2 | TP (marketing-page ambient loops never stop under reduced motion) |
| angular.dev | 7 | v2 | TP (gradient blobs rotate under reduced motion) |
| docs.aws.amazon.com | 2 | v2 | TP (60 s ambient cycle — borderline "effectively static", honest in the rule's meaning of "loops forever") |
| nextjs.org | 1 | v2 | TP (logo shine loop) |
| ghost.org | 10 | probe | pending |
| ant.design, aljazeera.net | 8 each | probe | pending |
| tailwindcss.com, ikea.com, scmp.com | 1 each | probe | pending |

### reduced-motion-ignored (2.3.3 AAA)

20 findings on 8 origins (v2: nextjs.org 8, target.com 4, bbc.com 2 …) and
43 on 12 more (probe: spring.io 12, npr.org 10 …). All pending: this rule
has not yet had a dedicated adjudication round on the corpus.

## Implemented: reflow check (1.4.10 AA)

Live probe of bbc.com/audio closed the rule-class question: real page-level
overflow (scrollWidth 333 vs 320) with honest naming of the outermost
offenders; large bleeds on debian.org (1369 px) and astro.build (1017 px)
read as the same honest shape.

| Site | Findings | Run | Status |
| --- | --- | --- | --- |
| docs.aws.amazon.com | 14 | v2 | pending (rule family probe-verified via bbc.com; per-site spot-check open) |
| target.com | 11 | v2 | pending |
| bbc.com | 10 | v2 | TP (live probe: 13 px bleed is real page scroll) |
| techcrunch.com | 10 | v2 | pending (12/21 px bleeds; probe-verified honest shape) |
| lit.dev, astro.build, pinterest.com | 10 each | v2 | pending |
| walgreens.com | 6 | v2 | pending |
| debian.org | 2 | v2 | pending |
| getbootstrap.com | 2 | v2 | pending |
| archive.org, nextjs.org | 1 each | v2 | pending |
| docs.scangov.org | 1 | v2 | pending (35 px page scroll at 320 px; round-4 queue) |
| costco.com | 16 | probe | pending |
| scmp.com | 13 | probe | pending |
| ant.design | 17 | probe | pending |
| apnews.com, bestbuy.com, gutenberg.org, npr.org, mui.com | 10 each | probe | pending |
| mainichi.jp | 9 | probe | pending |
| contentful.com, openstack.org, spring.io | 6, 5, 4 | probe | pending |
| developer.chrome.com | 1 | probe | pending |

## Implemented: text-spacing check (1.4.12 AA, warns by default)

Engine sharpened mid-adjudication: a box-level trigger confirmed by a
text-extent walk (a real glyph range crossing the clip boundary) or a
rendered ellipsis; decoration, padding-in-scrollWidth, and by-design-hidden
text no longer count. The v1 rows this removed were confirmed FPs.

| Site | Findings | Run | Status |
| --- | --- | --- | --- |
| nextjs.org | 2 | v2 | TP (user-verified: the "Deploy" chip truncates to "Depl…" once spacing is raised — an ellipsis is clipping) |
| nasa.gov | 2 | v2 | TP (story-card title/desc genuinely cross the card bottom; text-extent probe) |
| debian.org | 5 | v2 | pending (`time.date-as-calendar` 6 px chip clips, round-4 queue) |
| nuxt.com, vitepress.dev, walgreens.com | 2 / 2 / 1 | v2 | pending |
| scmp.com | 8 | probe | pending |
| bestbuy.com, developer.chrome.com | 6 each | probe | pending |
| gutenberg.org | 4 | probe | pending |
| tailwindcss.com | 3 | probe | pending |
| react-spectrum.adobe.com | 2 | probe | pending |
| ant.design, npr.org | 1 each | probe | pending |

## Implemented: text-resize check (1.4.4 AA)

`text-resize-locked` — text whose computed font size does not change when the
user's default font size doubles. Implemented after the v2 corpus run, so it
has never been adjudicated: its only corpus contact is the probe run, where
it fired on **41 of 43 origins (518 findings)** — everything from plain
markup (kernel.org, perl.org, gutenberg.org) to design systems (ant.design
20, mui.com 10). Px-locked text is that common on the web. Before this rule
can be treated as honest signal it needs the same cycle the others got: is
"the font-size preference is ignored" the right complaint, is the finding
granularity right (does one px-locked element per site drown the signal), and
does AA-policy blocking make sense for something nearly universal. Awaiting
the round-5 review queue; meanwhile treat every count as raw.

## Implemented: consistency checks (runner-only)

`duplicate-page-title` (2.4.2 A) and `inconsistent-navigation` (3.2.3 AA) are
multi-page checks by nature: they compare pages within a run, so the per-URL
sweep pipeline cannot exercise them. Validated so far by seeded fixtures and
specs; corpus-scale validation (duplicate titles, drifting navs across
the 100 origins) is a planned step once the sweep runner gains a
multi-page pass.

## Open product decisions surfaced by the corpus

- **Obscured focus while a dismissible overlay is open** — measurements are
  honest; defer/downgrade while the banner is up, or annotate? (banner-open
  rows above)
- **Best-practice axe rules block under every policy** — `region` (30
  origins), `heading-order`, `landmark-unique` are blocking today; flipping
  them to warn under AA policies is a deliberate softening with large blast
  radius, pending.
- **`text-resize-locked` mode** — pending first adjudication (above).