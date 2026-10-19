# Test corpus — 100 origins used to validate the checks

Every check runs against real sites before it earns adopter-facing trust: 100
origins, every finding class the checks produce manually adjudicated, so the
shipped audits are honest on the whole web, not just on the fixture pages. The
corpus exists to find false positives in the tool's own heuristics and to
discover where each rule is useful. The operative seed file is gitignored
(`sweep/seeds-v3.txt`); these tables are the transparency record — 50 origins
carried through runs v1–v2, and 50 probe-verified additions from October
2026.

## Selection criteria

- Maximize technology-stack diversity. Commercial, non-government sites are
  included deliberately: government sites are not the false-positive
  discovery farm.
- A few large government portals stay as anchors, keeping the runner honest
  against known-good results.
- October 2026 additions targeted stack gaps the planned `initialFocus`,
  `forms`, `names`, `landmarks`, and `disclosure` audits need
  ([audit-status.md](audit-status.md)): server-rendered stacks, CMS
  platforms, UI-kit sites, RTL/non-English sources, form-heavy portals.
- Every origin is probe-verified working before it enters the corpus.

## Corpus — 50 origins (runs v1–v2)

| Origin | | | |
| --- | --- | --- | --- |
| `angular.dev` | `archive.org` | `astro.build` | `canada.ca` |
| `carbondesignsystem.com` | `craigslist.org` | `developer.mozilla.org` | `docs.aws.amazon.com` |
| `docs.python.org` | `docusaurus.io` | `en.wikipedia.org` | `getbootstrap.com` |
| `gitlab.com` | `lit.dev` | `news.ycombinator.com` | `nextjs.org` |
| `nuxt.com` | `react.dev` | `scangov.org` | `stackoverflow.com` |
| `svelte.dev` | `usa.gov` | `vercel.com` | `vitepress.dev` |
| `vuejs.org` | `webaim.org` | `webflow.com` | `wordpress.org/news` |
| `wptavern.com` | `www.airbnb.com` | `www.bbc.com` | `www.debian.org` |
| `www.drupal.org` | `www.etsy.com` | `www.gov.uk` | `www.intel.com` |
| `www.mastercard.com` | `www.nasa.gov` | `www.paypal.com` | `www.pinterest.com` |
| `www.reuters.com` | `www.shopify.com` | `www.spotify.com` | `www.squarespace.com` |
| `www.target.com` | `www.techcrunch.com` | `www.theguardian.com` | `www.walgreens.com` |
| `www.wikipedia.org` | `www.wix.com` | | |

## Corpus additions — 47 origins (probe-verified, October 2026)

| Origin | | | |
| --- | --- | --- | --- |
| `ant.design` | `chakra-ui.com` | `developer.chrome.com` | `developer.wordpress.org` |
| `docs.github.com` | `dotnet.microsoft.com` | `ghost.org/docs` | `go.dev` |
| `kernel.org` | `kubernetes.io/docs` | `laravel.com` | `learn.microsoft.com` |
| `m3.material.io` | `mainichi.jp` | `medlineplus.gov` | `mui.com` |
| `perl.org` | `react-spectrum.adobe.com` | `rubyonrails.org` | `spring.io` |
| `tailwindcss.com` | `www.aljazeera.net` | `www.apnews.com` | `www.bestbuy.com` |
| `www.booking.com` | `www.ca.gov` | `www.cdc.gov` | `www.contentful.com` |
| `www.costco.com` | `www.dell.com` | `www.djangoproject.com` | `www.gutenberg.org` |
| `www.ikea.com` | `www.irs.gov` | `www.joomla.org` | `www.lemonde.fr` |
| `www.npr.org` | `www.openstack.org` | `www.python.org` | `www.radix-ui.com` |
| `www.rfc-editor.org` | `www.rust-lang.org` | `www.sanity.io` | `www.sciencedaily.com` |
| `www.scmp.com` | `www.telerik.com/devcraft` | `www.usgs.gov` | |

## Recent additions — 3 origins (probe-verified, October 2026)

- `www.tsa.gov` — federal agency portal (forms + status pages)
- `www.colorado.edu` — public university portal (forms, SSO login flow)
- `www.mbta.com` — transit agency (forms, service status)

## Rejected during assembly

| Origin | Reason |
| --- | --- |
| `readthedocs.org` | HTTP 429 behind a Cloudflare turnstile |
| `www.expedia.com` | HTTP 429 bot wall on the homepage |
| `www.w3.org` | HTTP 403 + turnstile (runner UA fingerprinted) |
| `designsystem.gov.au` | host retired |

## Runner caveats

Two URLs (lemonde.fr, cdc.gov) fetched challenge interstitials the bot-wall
detector did not catch; internal tooling gains interstitial-title signatures
and an empty-title guard before the next full run, plus a sitemap-fetch
timeout (booking.com discovery hangs). dell.com and colorado.edu sitemaps
serve some non-homepage URLs (a locale product page; a `/homepage/` 404).

## Running the corpus

The runner is committed ([tools/sweep.js](../tools/sweep.js),
[tools/report-aa.mjs](../tools/report-aa.mjs)); run data is gitignored under
`sweep/` by convention. Requirements are the tool's own (Node 22+,
Playwright 1.50+, Chromium installed).

```sh
node tools/sweep.js discover sweep/seeds.txt sweep/urls.txt --per-site 2 --max 240
node tools/sweep.js run sweep/urls.txt --out sweep/ --concurrency 4
node tools/sweep.js report sweep/sites.jsonl --out sweep/   # sweep.md
node tools/report-aa.mjs                                     # sweep/sweep-aa.md
```

Discovery reads robots.txt `Sitemap:` lines (conventional sitemap paths as
fallback), same-origin HTML only, round-robin across sibling sitemaps,
homepage first; rebuild the standing seeds by listing the origins above, one
per line. Runs checkpoint into `sites.jsonl` (a re-run skips recorded URLs);
start a fresh record file per engine version (`sites-v1.jsonl`,
`sites-v2.jsonl`, …) and keep the old ones — delta measurement between
versions is the whole point.

A run's shape by design: workers share a queue but only one page per host is
open at a time; 45 s navigation / 90 s per-URL budget; SPA hydration gets a
bounded
settle; consent frameworks and bot walls are annotated, never clicked — the
sweep measures the first-visit state a fresh profile gets. The report's
consent column reads per-check noise next to overlay presence.

## The validation protocol (standing)

Fixtures prove a check fires; the corpus proves it is honest. Per audit,
before the docs describe it as solid:

1. Engine work lands first: check + seeded fixture + spec (repo conventions).
2. Corpus run per "Running the corpus", the new check on alongside
   everything else.
3. Verdicts per finding class (true positive / false positive /
   mechanism-annotated false positive), not spot checks; a compacted record
   that cannot explain a fire is decided by a live re-probe.
4. Each verdict's engine change gets its own fixture + spec; its effect is
   measured by re-running the same URL file on the fixed engine, old records
   preserved.
5. Gate: at least one live true positive on the corpus, false-positive
   mechanisms gated or documented, verdicts logged — only then do docs, the
   conformance-levels page, and adopter messaging describe the audit.
6. The standing record lands in [audit-status.md](audit-status.md): per-check
   site tables and validation status.