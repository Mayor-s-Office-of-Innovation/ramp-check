// @ts-check
/**
 * Baseline (ratchet): adopt today, never get worse, burn down.
 *
 * `ramp-check baseline` records every finding that would currently fail as a
 * baseline entry. Later runs fail only on findings not in the baseline and
 * report how much debt remains. Every entry carries an `expires` date
 * (default 180 days from when it was added) so debt cannot be parked forever:
 * an expired entry stops suppressing and fails the run by name, exactly like
 * an expired allowlist entry.
 *
 * Entries are keyed by page, matrix cell, check, rule and target.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** @typedef {import("../types.js").Finding} Finding */

/**
 * @typedef {object} BaselineEntry
 * @property {string} key
 * @property {string} page
 * @property {string} cell
 * @property {string} check
 * @property {string} rule
 * @property {string} target
 * @property {string} added    ISO date
 * @property {string} expires  ISO date
 */

/**
 * @typedef {object} Baseline
 * @property {1} version
 * @property {string} updated     ISO date of the last write
 * @property {number} expiryDays
 * @property {BaselineEntry[]} entries
 */

/**
 * A finding located on a page state.
 * @typedef {object} LocatedFinding
 * @property {string} page
 * @property {string} cell
 * @property {Finding} finding
 */

export const DEFAULT_EXPIRY_DAYS = 180;

/**
 * @param {string} page
 * @param {string} cell
 * @param {Finding} f
 */
export function baselineKey(page, cell, f) {
  return [page, cell, f.check, f.rule, f.target].join("|");
}

/** @param {Date} d */
const iso = (d) => d.toISOString().slice(0, 10);

/**
 * @param {string | undefined} path
 * @returns {Baseline | null}
 */
export function loadBaseline(path) {
  if (!path) return null;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(text);
  if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`Baseline ${path} is not a ramp-check baseline (expected version 1 with entries)`);
  }
  return parsed;
}

/**
 * Mark located findings that a live baseline entry covers.
 * @param {LocatedFinding[]} located
 * @param {Baseline | null} baseline
 * @param {{ now?: Date }} [opts]
 * @returns {{ baselined: LocatedFinding[], expired: BaselineEntry[], stale: BaselineEntry[], expiringSoon: BaselineEntry[] }}
 *   `stale` entries matched nothing (the debt was paid); `expiringSoon` is within 30 days.
 */
export function applyBaseline(located, baseline, opts = {}) {
  if (!baseline) return { baselined: [], expired: [], stale: [], expiringSoon: [] };
  const now = opts.now ?? new Date();
  const today = iso(now);
  const soon = iso(new Date(now.getTime() + 30 * 86_400_000));
  const live = new Map(baseline.entries.filter((e) => e.expires >= today).map((e) => [e.key, e]));
  const expired = baseline.entries.filter((e) => e.expires < today);
  const used = new Set();
  /** @type {LocatedFinding[]} */
  const baselined = [];
  for (const l of located) {
    const entry = live.get(baselineKey(l.page, l.cell, l.finding));
    if (!entry) continue;
    l.finding.baselined = entry;
    used.add(entry.key);
    baselined.push(l);
  }
  const stale = [...live.values()].filter((e) => !used.has(e.key));
  const expiringSoon = [...live.values()].filter((e) => used.has(e.key) && e.expires <= soon);
  return { baselined, expired, stale, expiringSoon };
}

/**
 * Build a baseline from the findings that would fail now. Entries already in
 * the previous baseline keep their dates; new ones get today + expiryDays.
 * Entries whose finding is gone are dropped (debt paid).
 * @param {LocatedFinding[]} failing
 * @param {Baseline | null} previous
 * @param {{ now?: Date, expiryDays?: number }} [opts]
 * @returns {Baseline}
 */
export function buildBaseline(failing, previous, opts = {}) {
  const now = opts.now ?? new Date();
  const expiryDays = opts.expiryDays ?? previous?.expiryDays ?? DEFAULT_EXPIRY_DAYS;
  const prev = new Map((previous?.entries ?? []).map((e) => [e.key, e]));
  const expires = iso(new Date(now.getTime() + expiryDays * 86_400_000));
  /** @type {Map<string, BaselineEntry>} */
  const entries = new Map();
  for (const l of failing) {
    const key = baselineKey(l.page, l.cell, l.finding);
    if (entries.has(key)) continue;
    const old = prev.get(key);
    entries.set(key, old ?? {
      key,
      page: l.page,
      cell: l.cell,
      check: l.finding.check,
      rule: l.finding.rule,
      target: l.finding.target,
      added: iso(now),
      expires,
    });
  }
  return { version: 1, updated: iso(now), expiryDays, entries: [...entries.values()] };
}

/**
 * @param {string} path
 * @param {Baseline} baseline
 */
export function writeBaseline(path, baseline) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n");
}
