#!/usr/bin/env node
// @ts-check
/**
 * AA-view report from a sweep's records: blocking findings only, as the two
 * AA policies would count them (the corpus default run is wcag-aaa, which
 * hides nothing).
 *
 *   node tools/report-aa.mjs [records.jsonl] [out.md]
 *   defaults: sweep/sites.jsonl -> sweep/sweep-aa.md
 *
 * The sweep's compacted records keep criterion + level but not the WCAG
 * version, so this carries a static rule->version map (sourced from
 * src/checks/*.js for custom rules; 2.1/2.2 criterion lists for axe rules).
 * Views mirror src/policy.js severityFor(): blocks iff level A/AA and
 * version <= policy version; best-practice never blocks in either view.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const LEVEL_RANK = { A: 1, AA: 2, AAA: 3, "best-practice": 0 };

// version 2.1 criteria (A/AA): 1.3.5 1.4.10 1.4.11 2.1.4 2.5.1 2.5.2 2.5.3 2.5.4 4.1.3
// version 2.2 criteria (A/AA): 2.4.11 2.5.7 2.5.8 3.2.6 3.3.7 3.3.8
const V21 = new Set(["1.3.5", "1.4.10", "1.4.11", "2.1.4", "2.5.1", "2.5.2", "2.5.3", "2.5.4", "4.1.3"]);
const V22 = new Set(["2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"]);
const CUSTOM_VERSION = {
  "keyboard-unreachable": "2.0",
  "keyboard-trap": "2.0",
  "skip-link-broken": "2.0",
  "focus-not-visible": "2.0",
  "focus-obscured": "2.2",
  "focus-partially-obscured": "2.2",
  "focus-indicator-thin": "2.2",
  "reflow-horizontal-scroll": "2.1",
  "text-spacing-clipped": "2.2",
  "infinite-animation": "2.0",
  "reduced-motion-ignored": "2.2",
  "focus-changes-context": "2.0",
};

/** @param {{level:string, criterion:string, rule:string}} f */
function versionOf(f) {
  if (f.level === "best-practice") return "2.0";
  if (CUSTOM_VERSION[f.rule]) return CUSTOM_VERSION[f.rule];
  if (V22.has(f.criterion)) return "2.2";
  if (V21.has(f.criterion)) return "2.1";
  return "2.0";
}

/** @param {{level:string, criterion:string, rule:string}} f @param {number} maxVersion */
const blocks = (f, maxVersion) => {
  if (f.level === "best-practice") return false;
  const v = versionOf(f);
  return (
    LEVEL_RANK[f.level] <= 2 &&
    { "2.0": 0, "2.1": 1, "2.2": 2 }[v] <= maxVersion
  );
};

const [recordsPath, outPath] = process.argv.slice(2);
const IN = recordsPath || "sweep/sites.jsonl";
const OUT = outPath || "sweep/sweep-aa.md";

const rows = readFileSync(IN, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const checked = rows.filter((r) => !r.blocked && !r.error);

const VIEWS = /** @type {[string, number, string][]} */ ([
  ["wcag22-aa", 2, "Blocks: level A/AA, WCAG ≤2.2. (2.2-only criteria marked *2.2*)"],
  ["wcag21-aa", 1, "Blocks: level A/AA, WCAG ≤2.1 — the ADA Title II floor. 2.2-only criteria warn here."],
]);

/** @type {Record<string, Record<string, {urls:Set<string>, examples:{url:string,msg:string,is21:boolean,is22Only:boolean}[]}>>} */
const byCheck = {};
for (const r of checked) {
  for (const f of r.result?.findings || []) {
    const is22 = blocks(f, 2);
    const is21 = blocks(f, 1);
    if (!is22) continue;
    const c = f.check || "axe";
    byCheck[c] = byCheck[c] || {};
    const key = `${f.rule}@${versionOf(f)}`;
    byCheck[c][key] = byCheck[c][key] || { urls: new Set(), examples: [] };
    const e = byCheck[c][key];
    e.urls.add(r.url);
    if (e.examples.length < 4 && !e.examples.some((x) => x.url === r.url))
      e.examples.push({ url: r.url, msg: f.message, is21, is22Only: is22 && !is21 });
  }
}

const lines = ["# Sweep report — AA policy views (blocking findings only)", ""];
lines.push(`Source: ${IN} · ${checked.length} checked URLs · generated ${new Date().toISOString()}`, "");

let total22 = 0, total21 = 0;
for (const c of Object.keys(byCheck)) for (const [, e] of Object.entries(byCheck[c])) {
  total22 += e.urls.size;
}
for (const [, e] of Object.entries(byCheck)) void e;

for (const [name, maxV, blurb] of VIEWS) {
  lines.push(`## Policy ${name}`, "", blurb, "");
  /** @type {{check:string,rule:string,v:string,urls:number,ex:any[]}[]} */
  const rules = [];
  for (const [check, rs] of Object.entries(byCheck)) {
    for (const [key, e] of Object.entries(rs)) {
      const [rule, v] = key.split("@");
      if (maxV === 1 && v !== "2.0" && v !== "2.1") continue;
      rules.push({ check, rule, v, urls: e.urls.size, ex: e.examples });
    }
  }
  rules.sort((a, b) => b.urls - a.urls);
  const tot = rules.reduce((a, r) => a + r.urls, 0);
  if (name === "wcag22-aa") total22 = tot; else total21 = tot;
  lines.push(`**${rules.length} rules, ${tot} rule-URL pairs** (${checked.length} URLs max).`, "");
  lines.push("| Check | Rule | Ver | URLs | Example URL | Example message |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const R of rules) {
    const o = new URL(R.ex[0].url).origin.replace("https://", "");
    lines.push(
      `| ${R.check} | \`${R.rule}\` | ${R.v === "2.2" ? "*2.2*" : R.v} | ${R.urls} | ${o} | ${R.ex[0].msg.slice(0, 95)} |`,
    );
  }
  lines.push("");
  lines.push("### Example URLs per rule (≤4)", "");
  for (const R of rules) {
    lines.push(`- **${R.rule}** (${R.urls} URLs):`);
    for (const ex of R.ex) lines.push(`  - ${ex.url} — ${ex.msg.slice(0, 120)}`);
  }
  lines.push("");
}

lines.push(`Totals: wcag22-aa blocking rule-URL pairs = ${total22}; wcag21-aa = ${total21}.`, "");
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`wrote ${OUT}`);
for (const [c, rs] of Object.entries(byCheck))
  console.log(`${c}: ${Object.keys(rs).length} A/AA rules, ${Object.values(rs).reduce((a, e) => a + e.urls.size, 0)} rule-URL pairs`);