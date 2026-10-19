#!/usr/bin/env node
// @ts-check
/**
 * Sweeps the test corpus: many origins, one record per URL, findings aggregated
 * for per-rule triage. This is how a check earns real-web validation before it
 * earns adopter-facing trust (see docs/test-corpus.md for the corpus and the
 * standing validation protocol, docs/audit-status.md for the record).
 *
 *   node tools/sweep.js discover sweep/seeds.txt sweep/urls.txt [--per-site 5] [--max 400]
 *   node tools/sweep.js run sweep/urls.txt --out sweep/ [--concurrency 4] [--limit 50]
 *   node tools/sweep.js report sweep/sites.jsonl --out sweep/
 *
 * The record dir (`sweep/` by convention) is gitignored: seeds, urls, records
 * and reports stay out of the repo. This runner is committed.
 *
 * Stages:
 *  - discover: seed homepages -> robots.txt -> sitemap(s) -> N URLs per site.
 *  - run: visit each URL, run every check, append one record per URL to
 *    sites.jsonl (checkpoint: reruns skip completed URLs).
 *  - report: aggregate JSONL into sweep.md for false-positive triage, with a
 *    rule-frequency table, a rule x stack rollup, and consent annotation.
 */
import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { chromium } from "@playwright/test";
import { runChecks } from "../src/run.js";
import { motionRuntime } from "../src/checks/motion.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const HELP = `ramp-check corpus sweep: run the checks across many sites.

Usage:
  node tools/sweep.js discover <seeds.txt> <urls.txt> [--per-site 5] [--max 400]
  node tools/sweep.js run <urls.txt> --out <dir> [--concurrency 4] [--limit N]
  node tools/sweep.js report <sites.jsonl> --out <dir>
`;

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "per-site": { type: "string", default: "5" },
        max: { type: "string" },
        out: { type: "string", default: "sweep" },
        concurrency: { type: "string", default: "4" },
        limit: { type: "string" },
      },
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error(HELP);
    return 2;
  }
  const [command, ...rest] = parsed.positionals;
  if (command === "discover") {
    if (rest.length < 2) return usage();
    await discover(rest[0], rest[1], {
      perSite: Number(parsed.values["per-site"]),
      max: parsed.values.max ? Number(parsed.values.max) : undefined,
    });
    return 0;
  }
  if (command === "run") {
    if (!rest[0]) return usage();
    await runSweep(rest[0], {
      out: resolve(parsed.values.out),
      concurrency: Math.max(1, Number(parsed.values.concurrency)),
      limit: parsed.values.limit ? Number(parsed.values.limit) : undefined,
    });
    return 0;
  }
  if (command === "report") {
    if (!rest[0]) return usage();
    await report(rest[0], { out: resolve(parsed.values.out) });
    return 0;
  }
  return usage();
}

/** @returns {number} */
function usage() {
  console.error(HELP);
  return 2;
}

// ---------------------------------------------------------------------------
// discover
// ---------------------------------------------------------------------------

/**
 * @param {string} seedsPath
 * @param {string} outPath
 * @param {{ perSite: number, max?: number }} opts
 */
async function discover(seedsPath, outPath, opts) {
  const seeds = readFileSync(seedsPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
  if (!seeds.length) throw new Error(`no seeds in ${seedsPath}`);
  /** @type {string[]} */
  const urls = [];
  for (const seed of seeds) {
    const origin = new URL(seed).origin;
    try {
      const found = await discoverSite(seed, opts.perSite);
      for (const u of found) pushUnique(urls, u);
      console.log(`${origin}: ${found.length} urls`);
    } catch (e) {
      console.log(`${origin}: discovery failed (${errText(e)}); using homepage`);
      pushUnique(urls, seed);
    }
  }
  const capped = typeof opts.max === "number" ? urls.slice(0, opts.max) : urls;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, capped.join("\n") + "\n");
  console.log(`\n${capped.length} urls -> ${outPath} (${seeds.length} seeds)`);
}

/**
 * Sitemap discovery for one site. Homepage first, then sitemap URLs.
 * @param {string} seed
 * @param {number} perSite
 * @returns {Promise<string[]>}
 */
async function discoverSite(seed, perSite) {
  const origin = new URL(seed).origin;
  const sitemaps = await findSitemaps(origin);
  /** @type {string[]} */
  const picked = [seed];
  // Round-robin across sibling sitemaps so one giant blog sitemap does not
  // crowd out the rest of the site.
  for (let i = 0; picked.length < perSite && i < 200; i++) {
    const before = picked.length;
    for (const sm of sitemaps) {
      if (picked.length >= perSite) break;
      const locs = (await fetchSitemapLocs(sm)).filter((l) => isSameOrigin(l, origin) && isHtmlish(l));
      // Skip locs already picked; take the next new one from this sitemap.
      for (const loc of locs) {
        if (!picked.includes(loc)) {
          picked.push(loc);
          break;
        }
      }
    }
    if (picked.length === before) break;
  }
  return picked;
}

/** @param {string} origin @returns {Promise<string[]>} */
async function findSitemaps(origin) {
  const paths = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": UA } });
    if (res.ok) {
      const robots = await res.text();
      for (const line of robots.split("\n")) {
        const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
        if (m) paths.push(m[1]);
      }
    }
  } catch {
    // offline / blocked; fall through to conventional paths
  }
  if (!paths.length) paths.push(`/sitemap.xml`, `/sitemap_index.xml`);
  return paths.map((p) => (p.startsWith("http") ? p : origin + p));
}

/**
 * Fetch one sitemap, resolving one level of <sitemapindex>, and return page URLs.
 * @param {string} url
 * @returns {Promise<string[]>}
 */
async function fetchSitemapLocs(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return [];
    const xml = await res.text();
    if (!/<sitemap|<urlset/i.test(xml)) return [];
    if (/<sitemapindex/i.test(xml)) {
      const children = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      /** @type {string[]} */
      let out = [];
      for (const child of children.slice(0, 4)) {
        out = out.concat(await fetchSitemapLocs(child));
        if (out.length > 200) break;
      }
      return out;
    }
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/** @param {string} url */
function isHtmlish(url) {
  if (!/^https?:\/\//.test(url)) return false;
  return !/\.(pdf|jpg|jpeg|png|gif|svg|webp|xml|json|zip|mp4|m4a|mp3|ics|rss?|docx?|xlsx?|pptx?)$/i.test(
    new URL(url).pathname,
  );
}

/** @param {string} a @param {string} b  same origin, or b is an origin */
function isSameOrigin(a, b) {
  const originB = b.startsWith("http") ? new URL(b).origin : b;
  return new URL(a).origin === originB;
}

/** @param {string[]} arr @param {string} v */
function pushUnique(arr, v) {
  const key = normaliseUrl(v);
  if (!arr.some((u) => normaliseUrl(u) === key)) arr.push(v);
}

/**
 * Normalize a URL for comparison: drop the trailing slash on the root path and
 * lowercase the origin so `https://x.gov/` and `https://x.gov` dedupe.
 * @param {string} url
 */
function normaliseUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${u.origin}${path}${u.search}`;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

const NAV_TIMEOUT = 45_000;
const URL_BUDGET = 90_000;

/**
 * @param {string} urlsPath
 * @param {{ out: string, concurrency: number, limit?: number }} opts
 */
async function runSweep(urlsPath, opts) {
  let urls = readFileSync(urlsPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
  if (opts.limit) urls = urls.slice(0, opts.limit);

  mkdirSync(opts.out, { recursive: true });
  const jsonl = resolve(opts.out, "sites.jsonl");
  const done = new Set(readJsonl(jsonl).map((r) => r.url));
  const pending = urls.filter((u) => !done.has(u));
  console.error(`${urls.length} urls, ${done.size} already done, ${pending.length} to go`);

  const browser = await chromium.launch({ headless: true });
  try {
    // N workers pull from a shared queue; per-origin chains serialize access
    // so we never have two pages open against the same host at once.
    const queue = [...pending];
    /** @type {Map<string, Promise<void>>} */
    const perOrigin = new Map();
    let processed = 0;

    /**
     * @param {string} url
     * @param {number} worker
     */
    async function doUrl(url, worker) {
      const origin = new URL(url).origin;
      const prev = perOrigin.get(origin);
      const task = (async () => {
        if (prev) await prev.catch(() => {});
        const record = await checkUrl(browser, url, worker);
        appendFileSync(jsonl, JSON.stringify(record) + "\n");
        const mark = record.blocked ? "b" : record.error ? "!" : record.result?.findings?.length ? "✘" : "✓";
        processed++;
        const n = record.result?.findings?.length ?? 0;
        console.log(
          `${mark} [w${worker}] (${processed}/${pending.length}) ${url}` +
            (record.error ? ` — ${record.error}` : ` — ${n} finding${n === 1 ? "" : "s"}`),
        );
      })();
      perOrigin.set(origin, task);
      await task;
    }

    /**
     * @param {number} worker
     */
    async function workerLoop(worker) {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        await doUrl(url, worker).catch(() => {});
      }
    }

    await Promise.all(Array.from({ length: opts.concurrency }, (_, i) => workerLoop(i)));
  } finally {
    await browser.close();
  }

  const tally = tallyRecords(readJsonl(jsonl));
  console.error(`\ndone: ${JSON.stringify(tally)}`);
}

/**
 * @typedef {import("../src/types.js").Finding} Finding
 */

/**
 * Visit one URL and run the checks. Never throws; always returns a record.
 * The caller enforces the per-origin chain, this enforces the per-URL budget.
 * @param {import("@playwright/test").Browser} browser
 * @param {string} url
 * @param {number} worker
 * @returns {Promise<Record<string, any>>}
 */
async function checkUrl(browser, url, worker) {
  /** @type {Record<string, any>} */
  const record = { url, worker, generated: new Date().toISOString() };
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(motionRuntime);
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    const status = resp?.status() ?? 0;
    if (status >= 400) throw httpError(status, page.url());
    await hydrationSettle(page);
    const blockedBy = await looksBlocked(page);
    if (blockedBy) throw new Error(`blocked: ${blockedBy}`);
    record.finalUrl = page.url();
    record.title = await page.title();
    record.origin = new URL(record.finalUrl).origin;
    record.fingerprint = await fingerprint(page, resp);
    record.consent = await detectConsent(page);
    const result = await withBudget(
      runChecks(page, { policy: "wcag-aaa" }, { label: record.finalUrl, reducedMotion: true }),
      URL_BUDGET - NAV_TIMEOUT,
    );
    record.result = { ran: result.ran, findings: compactFindings(result.findings) };
  } catch (e) {
    record.error = errText(e);
    record.blocked = /^blocked:/.test(record.error) || undefined;
    record.finalUrl = record.finalUrl ?? url;
    record.origin = record.origin ?? new URL(url).origin;
  } finally {
    await context.close();
  }
  return record;
}

/**
 * Reject if the promise outlives `ms`. The sweep must not hang on one page.
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @returns {Promise<T>}
 */
async function withBudget(p, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`budget exceeded (${Math.round(ms / 1000)}s)`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded settle window for SPA hydration: resolve once page load is complete
 * and no new resource entries have landed for ~1.5s, or after 5s.
 * @param {import("@playwright/test").Page} page
 */
async function hydrationSettle(page) {
  try {
    await page.evaluate(
      () =>
        new Promise((done) => {
          const w = /** @type {any} */ (window);
          let seen = w.performance.getEntriesByType("resource").length;
          let quiet = 0;
          const t0 = Date.now();
          const iv = setInterval(() => {
            const now = w.performance.getEntriesByType("resource").length;
            if (now > seen) {
              seen = now;
              quiet = 0;
            } else {
              quiet++;
            }
            const complete = document.readyState === "complete";
            if ((complete && quiet >= 3) || Date.now() - t0 > 5000) {
              clearInterval(iv);
              done(undefined);
            }
          }, 500);
        }),
    );
  } catch {
    // evaluation raced with navigation; fine — checks follow regardless
  }
}

/**
 * Best-effort bot-wall detection: interstitial titles and known CDN markers.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string | null>} the framework name, or null when the page looks like real content
 */
async function looksBlocked(page) {
  return page
    .evaluate(() => {
      const title = document.title;
      if (/Just a moment/i.test(title)) return "cloudflare";
      if (/Attention Required|Access denied|Access to this page has been denied/i.test(title)) return "cdn";
      const head = document.documentElement.outerHTML.slice(0, 50_000);
      if (/DDoS protection by|PerimeterX|DataDome|captcha-delivery|cdn-cgi\/challenge/i.test(head)) return "cdn";
      const text = document.body?.innerText?.slice(0, 2000) ?? "";
      if (/checking your browser|verify you are a human|are you a robot/i.test(text)) return "captcha";
      return null;
    })
    .catch(() => null);
}

const STACK_SIGNATURES = /** @type {const} */ ([
  ["next", /\/_next\//],
  ["nuxt", /\/_nuxt\//],
  ["gatsby", /\/gatsby-|\/_gatsby\//i],
  ["astro", /\/_astro\//],
  ["sveltekit", /\/_app\/immutable\//],
  ["wordpress", /wp-content|wp-includes/i],
  ["drupal", /\/sites\/[a-z0-9._-]+\/files|\/core\/assets|drupal\.js/i],
  ["aem", /\/etc\.clientlibs\//i],
  ["wix", /static\.parastorage|wixstatic/i],
  ["shopify", /cdn\.shopify/i],
  ["webflow", /assets\.website-files|webflow/i],
  ["squarespace", /static1\.squarespace/i],
  ["sitecore", /sitecore/i],
  ["contentful", /ctfassets/i],
  ["react", /react(-dom|\.production)?[\.\-]|_next\/static\/chunks.*react/i],
  ["vue", /vue(\.runtime|\.global)?\.|__NUXT_HTML__/i],
  ["angular", /angular|zone\.js/i],
  ["lit", /lit-element|\/lit\/|@lit/i],
  ["jquery", /jquery/i],
  ["bootstrap", /bootstrap(\.min)?\.(js|css)/i],
  ["tailwind", /tailwind/i],
  ["font-awesome", /font-?awesome/i],
  ["gsap", /gsap|greensock/i],
]);

/**
 * Origin-level fingerprint from page signals: generator meta plus script/link
 * source signatures. First-match per family, everything reported.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Response | null} [resp]  the navigation response, for header fingerprints
 * @returns {Promise<string[]>}
 */
async function fingerprint(page, resp) {
  /** @type {string[]} */
  const headerTags = [];
  if (resp) {
    const h = resp.headers();
    // Server-side fingerprints catch self-hosted frameworks the DOM can't reveal.
    if (h["x-generator"]) headerTags.push(h["x-generator"].toLowerCase().split(/\s+/).slice(0, 3).join(" "));
    if (h["x-powered-by"] && !/php$|plesk/i.test(h["x-powered-by"])) headerTags.push(h["x-powered-by"].toLowerCase());
    if (/govuk|rails/i.test(h["server"] ?? "")) headerTags.push("rails");
    if (/nginx|apache|cloudflare|varnish|fastly|akamai|azure/i.test(h["server"] ?? "")) headerTags.push(h["server"].toLowerCase().split(/\s+/)[0]);
  }
  const domTags = await page.evaluate((sigs) => {
    /** @type {string[]} */
    const out = [];
    const gen = document.querySelector('meta[name="generator"]')?.getAttribute("content") ?? "";
    if (gen) out.push(gen.toLowerCase().split(/\s+/).slice(0, 3).join(" "));
    const srcs = [
      ...[...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src") ?? ""),
      ...[...document.querySelectorAll("link[href]")].map((l) => l.getAttribute("href") ?? ""),
    ].join(" ");
    for (const [name, re] of sigs) {
      if ((re.test(srcs) || re.test(gen)) && !out.includes(name)) out.push(name);
    }
    return out;
  }, STACK_SIGNATURES);
  return [...new Set([...headerTags, ...domTags])];
}

const CONSENT_MARKS = /** @type {const} */ ([
  ["onetrust", /onetrust|ot-sdk/i],
  ["cookiebot", /cookiebot|CybotCookiebot/i],
  ["iubenda", /iubenda/i],
  ["didomi", /didomi/i],
  ["usercentrics", /usercentrics/i],
  ["ketch", /ketch/i],
  ["trustarc", /trustarc/i],
  ["osano", /osano/i],
  ["cookieyes", /cookieyes/i],
  ["borlabs", /borlabs/i],
  ["complianz", /complianz/i],
  ["termly", /termly/i],
  ["cookiepro", /cookiepro/i],
  ["tcf-plugin", /quantcast|sourcepoint|sp_message/i],
]);

/**
 * Consent framework detection, DOM + script signals. No clicking ever.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string | undefined>}
 */
async function detectConsent(page) {
  return page
    .evaluate((marks) => {
      const html = document.documentElement.outerHTML.slice(0, 200_000);
      /** @type {string[]} */
      const found = [];
      for (const [name, re] of marks) if (re.test(html)) found.push(name);
      return found.length ? found.join("+") : undefined;
    }, CONSENT_MARKS)
    .catch(() => undefined);
}

/**
 * Findings as stored: everything the triage report needs, minus the bulky
 * per-rule help URL.
 * @param {Finding[]} findings
 */
function compactFindings(findings) {
  return findings.map((f) => ({
    check: f.check,
    rule: f.rule,
    target: f.target,
    message: f.message,
    severity: f.severity,
    criterion: f.wcag.criterion || null,
    level: f.wcag.level,
  }));
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, any>[]} records
 */
function tallyRecords(records) {
  const tally = { attempted: records.length, checked: 0, blocked: 0, error: 0 };
  for (const r of records) {
    if (r.blocked) tally.blocked++;
    else if (r.error) tally.error++;
    else tally.checked++;
  }
  return tally;
}

/**
 * @param {string} jsonlPath
 * @param {{ out: string }} opts
 */
async function report(jsonlPath, opts) {
  const records = readJsonl(jsonlPath);
  const tally = tallyRecords(records);
  const checked = records.filter((r) => !r.error && !r.blocked);
  const lines = ["# Sweep report", ""];

  lines.push(
    `Attempted ${tally.attempted}: ${tally.checked} checked, ${tally.blocked} blocked (bot walls), ` +
      `${tally.error} errored.`,
  );
  lines.push("");

  // Per-origin inventory: fingerprint, consent, findings.
  const byOrigin = new Map();
  for (const r of records) {
    const o =
      byOrigin.get(r.origin) ??
      { urls: 0, checked: 0, blocked: 0, error: 0, findings: 0, fingerprint: [], consent: [] };
    o.urls++;
    if (r.blocked) o.blocked++;
    else if (r.error) o.error++;
    else o.checked++;
    if (r.result?.findings?.length) o.findings += r.result.findings.length;
    for (const f of r.fingerprint ?? []) if (!o.fingerprint.includes(f)) o.fingerprint.push(f);
    if (r.consent) for (const c of r.consent.split("+")) if (!o.consent.includes(c)) o.consent.push(c);
    byOrigin.set(r.origin, o);
  }
  lines.push(`## Origins (${byOrigin.size})`, "");
  lines.push("| Origin | URLs | Checked | Blocked | Err | Findings | Fingerprint | Consent |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [origin, o] of [...byOrigin.entries()].sort((a, b) => b[1].findings - a[1].findings)) {
    lines.push(
      `| ${origin} | ${o.urls} | ${o.checked} | ${o.blocked} | ${o.error} | ${o.findings} | ` +
        `${o.fingerprint.join(", ") || "—"} | ${o.consent.join(", ") || "—"} |`,
    );
  }

  // Rule frequency, split by check, over checked records only.
  /** @type {Map<string, Map<string, { urls: Set<string>, messages: string[], consent: Set<string> }>>} */
  const byCheck = new Map();
  for (const r of checked) {
    for (const f of r.result?.findings ?? []) {
      const byRule = byCheck.get(f.check) ?? new Map();
      const e = byRule.get(f.rule) ?? { urls: new Set(), messages: [], consent: new Set() };
      e.urls.add(r.url);
      if (f.message) e.messages.push(f.message);
      if (r.consent) for (const c of r.consent.split("+")) e.consent.add(c);
      byRule.set(f.rule, e);
      byCheck.set(f.check, byRule);
    }
  }

  // Stack rollup: rule x stack tag.
  const withStack = checked.filter((r) => (r.fingerprint ?? []).length);
  /** @type {Map<string, Set<string>>} tag -> urls carrying it */
  const tagUrls = new Map();
  for (const r of withStack) {
    for (const tag of r.fingerprint) {
      const s = tagUrls.get(tag) ?? new Set();
      s.add(r.url);
      tagUrls.set(tag, s);
    }
  }
  const stackTally = (/** @type {{ urls: Set<string> }} */ e) => {
    const parts = [];
    for (const [tag, urls] of [...tagUrls.entries()].sort((a, b) => b[1].size - a[1].size)) {
      if (urls.size < 3) continue;
      const hit = [...e.urls].filter((u) => urls.has(u)).length;
      parts.push(`${tag} ${hit}/${urls.size}`);
    }
    return parts.join(", ");
  };

  const consentN = checked.filter((r) => r.consent).length;
  for (const [check, byRule] of [...byCheck.entries()].sort()) {
    const total = [...new Set([...byRule.values()].flatMap((e) => [...e.urls]))].length;
    const checkConsent = checked.filter((r) => r.consent && (r.result?.findings ?? []).some((f) => (f.check || "axe") === check)).length;
    lines.push(
      `## ${check} — ${total}/${checked.length} checked URLs affected` +
        (consentN ? ` (sweep-wide consent banners: ${consentN}; URLs here with findings + banner: ${checkConsent})` : ""),
      "",
    );
    lines.push("| Rule | URLs | % | Consent | Stack | Example message | Example URL |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    const rules = [...byRule.entries()].sort((a, b) => b[1].urls.size - a[1].urls.size);
    for (const [rule, e] of rules) {
      const onConsent = [...e.urls].filter((u) => {
        const r = checked.find((c) => c.url === u);
        return r?.consent && true;
      }).length;
      const pct = Math.round((e.urls.size / Math.max(1, checked.length)) * 100);
      const msg = (e.messages.sort((a, b) => a.length - b.length)[0] ?? "").replace(/\|/g, "\\|");
      lines.push(
        `| \`${rule}\` | ${e.urls.size} | ${pct}% | ${onConsent}/${e.urls.size} | ${stackTally(e)} | ` +
          `${msg.slice(0, 140) || "—"} | ${e.urls.values().next().value ?? ""} |`,
      );
    }
    lines.push("");
  }

  // Errored / blocked inventory so dead URLs are visible.
  const dead = records.filter((r) => r.error);
  if (dead.length) {
    lines.push(`## Errored or blocked (${dead.length})`, "");
    for (const r of dead) lines.push(`- ${r.url} — ${r.error}`);
    lines.push("");
  }

  mkdirSync(opts.out, { recursive: true });
  const outPath = resolve(opts.out, "sweep.md");
  writeFileSync(outPath, lines.join("\n") + "\n");
  writeFileSync(resolve(opts.out, "sweep.json"), JSON.stringify({ tally, origins: Object.fromEntries(byOrigin) }, null, 2) + "\n");
  console.error(`report -> ${outPath}`);
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} path
 * @returns {Record<string, any>[]}
 */
function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** @param {unknown} e */
function errText(e) {
  return e instanceof Error ? e.message.split("\n")[0] : String(e);
}

/**
 * HTTP failures as errors with a stable prefix; 403/429/503 look like bot walls.
 * @param {number} status
 * @param {string} finalUrl
 */
function httpError(status, finalUrl) {
  const wall = status === 403 || status === 429 || status === 503;
  return new Error(wall ? `blocked: http ${status} (${finalUrl})` : `http ${status} (${finalUrl})`);
}