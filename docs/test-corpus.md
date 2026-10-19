# Test corpus — 100 origins used to validate the checks

Every check runs against real sites before it earns adopter-facing trust: a
corpus of 100 origins, checked page by page, with every finding class the
checks produce manually adjudicated before an audit's behavior is claimed as
solid. The corpus exists to find false positives in the tool's own heuristics
and to discover sites where each rule is useful, so the checks that ship are
honest on the whole web, not just on the fixture pages.

The operative input to the sweep runner is a gitignored seed file
(`sweep/seeds-v3.txt`); this committed list is the transparency record of the
corpus as assembled in October 2026. How to run it (commands) and what the
validation gate means: [Running the corpus](#running-the-corpus).

## Selection criteria (locked when the corpus was first assembled)

- Maximize technology-stack diversity. Commercial, non-government sites are
  included deliberately: government sites must not be the FP discovery farm.
- A few large government portals stay in the set as anchors, to keep the
  runner honest against known-good results.
- When audits for forms, control names, landmarks, and disclosure state were
  planned (see [audit-status.md](audit-status.md)), gaps were filled with
  server-rendered stacks, CMS platforms, UI-kit sites, RTL/non-English
  sources, and form-heavy portals where those heuristics will be exercised.
- Every origin is probe-verified working before it enters the corpus.

## The corpus, 53 origins (first assembled; carried through runs v1–v2)

| Origin | | | |
| --- | --- | --- | --- |
| `angular.dev` | `archive.org` | `astro.build` | `canada.ca` |
| `carbondesignsystem.com` | `craigslist.org` | `developer.mozilla.org` | `docs.aws.amazon.com` |
| `docs.python.org` | `docs.scangov.org` | `docusaurus.io` | `en.wikipedia.org` |
| `getbootstrap.com` | `gitlab.com` | `lit.dev` | `news.ycombinator.com` |
| `nextjs.org` | `nuxt.com` | `react.dev` | `scangov.com` |
| `scangov.org` | `stackoverflow.com` | `standards.scangov.org` | `svelte.dev` |
| `usa.gov` | `vercel.com` | `vitepress.dev` | `vuejs.org` |
| `webaim.org` | `webflow.com` | `wordpress.org/news` | `wptavern.com` |
| `www.airbnb.com` | `www.bbc.com` | `www.debian.org` | `www.drupal.org` |
| `www.etsy.com` | `www.gov.uk` | `www.intel.com` | `www.mastercard.com` |
| `www.nasa.gov` | `www.paypal.com` | `www.pinterest.com` | `www.reuters.com` |
| `www.shopify.com` | `www.spotify.com` | `www.squarespace.com` | `www.target.com` |
| `www.techcrunch.com` | `www.theguardian.com` | `www.walgreens.com` | `www.wikipedia.org` |
| `www.wix.com` | | | |

## Corpus additions, 47 origins (probe-verified October 2026)

Server-rendered stacks, CMS platforms, design systems, docs sites, commerce,
non-English/RTL media, and government portals. Chosen ahead of the planned
`initialFocus`, `forms`, `names`, `landmarks`, and `disclosure` audits, whose
heuristics need these stacks under them.

| Origin | | | |
| --- | --- | --- | --- |
| `ant.design` | `chakra-ui.com` | `developer.chrome.com` | `developer.wordpress.org` |
| `docs.github.com` | `dotnet.microsoft.com` | `ghost.org/docs` | `go.dev` |
| `kernel.org` | `kubernetes.io/docs` | `laravel.com` | `learn.microsoft.com` |
| `m3.material.io` | `mainichi.jp` | `medlineplus.gov` | `mui.com` |
| `perl.org` | `react-spectrum.adobe.com` | `rubyonrails.org` | `spring.io` |
| `tailwindcss.com` | `www.aljazeera.net` | `apnews.com` | `www.bestbuy.com` |
| `www.booking.com` | `www.ca.gov` | `www.cdc.gov` | `www.contentful.com` |
| `www.costco.com` | `www.dell.com` | `www.djangoproject.com` | `www.gutenberg.org` |
| `www.ikea.com` | `www.irs.gov` | `www.joomla.org` | `www.lemonde.fr` |
| `www.npr.org` | `www.openstack.org` | `www.python.org` | `www.radix-ui.com` |
| `www.rfc-editor.org` | `www.rust-lang.org` | `www.sanity.io` | `www.sciencedaily.com` |
| `www.scmp.com` | `www.telerik.com/devcraft` | `www.usgs.gov` | |

## Rejected from the corpus

| Origin | Reason |
| --- | --- |
| readthedocs.org | HTTP 429 behind a Cloudflare turnstile on every fetch |
| www.expedia.com | HTTP 429 bot wall on the homepage itself |
| www.w3.org | HTTP 403 + turnstile on the homepage (runner UA fingerprinted there) |
| designsystem.gov.au | host retired (`ERR_NAME_NOT_RESOLVED`) |

## Known runner caveats on corpus origins

- lemonde.fr and cdc.gov: one fetched URL each was actually a
  client-challenge/interstitial page the bot-wall detector did not catch
  (silent contamination). Detection patterns are being extended in the
  internal sweep tooling before the next full-corpus run.
- dell.com: the sitemap serves `da-dk`-locale product URLs (one got HTTP 403;
  homepage valid).
- booking.com: sitemap discovery hangs (entered by hand); a fetch timeout is
  planned in the internal tooling.
- djangoproject.com: one weblog page exceeded the 45 s navigation budget;
  homepage valid.

## Running the corpus

The sweep runner is committed ([tools/sweep.js](../tools/sweep.js), plus the
AA-policy report [tools/report-aa.mjs](../tools/report-aa.mjs)); the run's
data is not. Seeds, URL lists, records, and reports live under a gitignored
directory by convention (`sweep/`); nothing but the runner itself is in the
repo. Requirements are the tool's own (Node 22+, Playwright 1.50+ with
Chromium installed).

1. Write seeds: one seed URL per line (`sweep/seeds.txt`). To rebuild the
   standing corpus from the committed record, list the origins from the two
   tables above, one per line, in the seed format the origins already use.
2. Discover URLs per origin (robots.txt `Sitemap:` lines, then conventional
   sitemap paths; same-origin HTML pages only; round-robin across sibling
   sitemaps; the homepage is always first):

   ```sh
   node tools/sweep.js discover sweep/seeds.txt sweep/urls.txt --per-site 2 --max 240
   ```

3. Run every check on every URL, under `wcag-aaa` with reduced-motion
   emulation, one record per URL (checkpointed: a re-run skips URLs already
   recorded):

   ```sh
   node tools/sweep.js run sweep/urls.txt --out sweep/ --concurrency 4
   ```

4. Aggregate for triage:

   ```sh
   node tools/sweep.js report sweep/sites.jsonl --out sweep/   # sweep.md
   node tools/report-aa.mjs                                    # sweep/sweep-aa.md
   ```

5. Start a fresh record file per run version (`sites-v1.jsonl`,
   `sites-v2.jsonl`, …). Nothing is reused across engine versions — delta
   measurement between versions is the whole point.

Shape of a run, by design: workers share a queue but each origin is
serialized (never two pages open against one host at once); navigation is
45 s / a URL budget of 90 s; consent frameworks and bot walls are detected
and annotated, never clicked — the sweep measures the first-visit state a
real user's fresh profile would get; SPA hydration gets a bounded settle
window. The report carries a consent column per rule so per-check noise can
be read next to overlay presence.

## The validation protocol (standing)

Fixtures prove a check fires; the corpus proves it is honest. No audit is
described as solid in the docs until this protocol has completed for every
finding class it produces:

1. Engine work lands first: check + seeded fixture + spec, typechecking
   clean (the repo's usual conventions).
2. Corpus run, per "Running the corpus" above, with the new check on in the
   same pass as everything else — per-check noise is visible in the same
   report as its surroundings.
3. Manual review rounds, per rule: every finding class a rule produces gets
   a verdict (true positive / false positive / mechanism-annotated false
   positive), not spot checks. When a compacted record cannot explain why a
   rule fired, the verdict is decided by a live re-probe of the URL.
4. Each verdict becomes an engine change with its own fixture + spec; the
   change's effect is measured by re-running the same URL file on the fixed
   engine, old records preserved.
5. The gate: an audit is validated when its rules have (a) at least one live
   true positive observed on the corpus, (b) FP mechanisms understood and
   either gated in the engine or documented as known noise, (c) verdicts
   logged. Only then do docs, the conformance-levels page, and adopter
   messaging describe the audit.
6. The standing record lands in
   [audit-status.md](audit-status.md): per-check site tables and validation
   status.