// @ts-check
/**
 * The allowlist is the only way to make a finding stop blocking. Every entry
 * names the rule and target, says why, and expires. An expired entry surfaces
 * as its own failure; it never quietly keeps suppressing.
 */
import { readFileSync } from "node:fs";

/** @typedef {import("../types.js").AllowlistEntry} AllowlistEntry */
/** @typedef {import("../types.js").Finding} Finding */

const REQUIRED = /** @type {const} */ (["rule", "target", "reason", "expires"]);

/**
 * Load and validate an allowlist. Accepts a path to a JSON file (an array of
 * entries, or `{ "entries": [...] }`) or an already-parsed array.
 * @param {string | AllowlistEntry[] | undefined} source
 * @returns {AllowlistEntry[]}
 */
export function loadAllowlist(source) {
  if (!source) return [];
  /** @type {unknown} */
  let parsed = source;
  if (typeof source === "string") {
    parsed = JSON.parse(readFileSync(source, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "entries" in parsed) {
      parsed = /** @type {{ entries: unknown }} */ (parsed).entries;
    }
  }
  if (!Array.isArray(parsed)) throw new Error("Allowlist must be an array of entries");
  /** @type {string[]} */
  const problems = [];
  parsed.forEach((entry, i) => {
    for (const key of REQUIRED) {
      if (typeof entry?.[key] !== "string" || !entry[key].trim()) {
        problems.push(`entry ${i}: "${key}" is required`);
      }
    }
    if (typeof entry?.expires === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      problems.push(`entry ${i}: "expires" must be an ISO date (YYYY-MM-DD), got "${entry.expires}"`);
    }
  });
  if (problems.length) throw new Error(`Invalid allowlist:\n  ${problems.join("\n  ")}`);
  return /** @type {AllowlistEntry[]} */ (parsed);
}

/**
 * @param {AllowlistEntry} entry
 * @param {Date} now
 */
export function isExpired(entry, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return entry.expires < today;
}

/**
 * @param {string} pattern  exact string, or a prefix ending in "*"
 * @param {string} target
 */
export function targetMatches(pattern, target) {
  if (pattern.endsWith("*")) return target.startsWith(pattern.slice(0, -1));
  return pattern === target;
}

/**
 * @param {AllowlistEntry} entry
 * @param {Finding} finding
 */
export function entryMatches(entry, finding) {
  if (entry.check && entry.check !== finding.check) return false;
  return entry.rule === finding.rule && targetMatches(entry.target, finding.target);
}

/**
 * @typedef {object} AllowlistOutcome
 * @property {AllowlistEntry[]} expired  entries past their date; they suppress nothing
 * @property {AllowlistEntry[]} unused   live entries that matched no finding this run
 */

/**
 * Mark findings covered by a live entry. Mutates `findings` (sets
 * `allowlisted`) and returns what a report needs to say about the list.
 * @param {Finding[]} findings
 * @param {AllowlistEntry[]} entries
 * @param {{ now?: Date }} [opts]
 * @returns {AllowlistOutcome}
 */
export function applyAllowlist(findings, entries, opts = {}) {
  const now = opts.now ?? new Date();
  const expired = entries.filter((e) => isExpired(e, now));
  const live = entries.filter((e) => !isExpired(e, now));
  const used = new Set();
  for (const f of findings) {
    const entry = live.find((e) => entryMatches(e, f));
    if (entry) {
      f.allowlisted = entry;
      used.add(entry);
    }
  }
  return { expired, unused: live.filter((e) => !used.has(e)) };
}
