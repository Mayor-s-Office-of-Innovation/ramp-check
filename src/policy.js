// @ts-check
/**
 * The policy model: one setting named by the standard decides which findings
 * block and which only warn. There is no separate "strict" switch.
 *
 * A finding blocks when its criterion is at or below the policy's level AND
 * was introduced at or before the policy's WCAG version. Everything else is
 * still reported as a warning; nothing is silently dropped.
 */

/** @typedef {import("./types.js").WcagLevel} WcagLevel */
/** @typedef {import("./types.js").WcagVersion} WcagVersion */
/** @typedef {import("./types.js").WcagRef} WcagRef */
/** @typedef {import("./types.js").Severity} Severity */
/** @typedef {import("./types.js").Mode} Mode */

/** @typedef {"wcag-aaa" | "wcag22-aa" | "wcag21-aa"} PolicyName */

/**
 * @typedef {object} Policy
 * @property {PolicyName} name
 * @property {WcagLevel} level
 * @property {WcagVersion} version
 * @property {string} summary
 */

/** @type {Record<PolicyName, Policy>} */
export const POLICIES = {
  "wcag-aaa": {
    name: "wcag-aaa",
    level: "AAA",
    version: "2.2",
    summary:
      "WCAG 2.2, all levels. Everything blocks. The default; a stretch target you may legitimately lower.",
  },
  "wcag22-aa": {
    name: "wcag22-aa",
    level: "AA",
    version: "2.2",
    summary: "WCAG 2.2 A + AA blocks; AAA findings warn.",
  },
  "wcag21-aa": {
    name: "wcag21-aa",
    level: "AA",
    version: "2.1",
    summary:
      "WCAG 2.1 A + AA blocks (the ADA Title II floor); 2.2 and AAA findings warn.",
  },
};

export const DEFAULT_POLICY = /** @type {PolicyName} */ ("wcag-aaa");

/** @type {Record<WcagLevel, number>} */
const LEVEL_RANK = { A: 1, AA: 2, AAA: 3, "best-practice": 0 };
const VERSION_RANK = { "2.0": 0, "2.1": 1, "2.2": 2 };

/**
 * @param {string} name
 * @returns {Policy}
 */
export function resolvePolicy(name = DEFAULT_POLICY) {
  const policy = POLICIES[/** @type {PolicyName} */ (name)];
  if (!policy) {
    throw new Error(
      `Unknown policy "${name}". Choose one of: ${Object.keys(POLICIES).join(", ")}`,
    );
  }
  return policy;
}

/**
 * Decide whether a finding blocks or warns.
 * @param {WcagRef} wcag        what the finding enforces
 * @param {Policy} policy
 * @param {{ bestPractice?: Mode, override?: Mode }} [opts]
 *   `bestPractice` covers axe's non-WCAG rules (default "block").
 *   `override` is a per-check setting that wins over the policy.
 * @returns {Severity | "off"}
 */
export function severityFor(wcag, policy, opts = {}) {
  if (opts.override) return opts.override;
  if (wcag.level === "best-practice") return opts.bestPractice ?? "block";
  const levelOk = LEVEL_RANK[wcag.level] <= LEVEL_RANK[policy.level];
  const versionOk = VERSION_RANK[wcag.version] <= VERSION_RANK[policy.version];
  return levelOk && versionOk ? "block" : "warn";
}

/**
 * The axe tags to run. Always the full set: the policy decides severity, not
 * coverage, so a team at 2.1 AA still sees 2.2 and AAA findings as warnings.
 * @param {{ bestPractice?: Mode, tags?: string[] }} [opts]
 *   `tags` is the escape hatch for teams that know axe; it replaces the list.
 * @returns {string[]}
 */
export function axeTagsFor(opts = {}) {
  if (opts.tags) return opts.tags;
  const tags = [
    "wcag2a",
    "wcag2aa",
    "wcag2aaa",
    "wcag21a",
    "wcag21aa",
    "wcag22a",
    "wcag22aa",
  ];
  if (opts.bestPractice !== "off") tags.push("best-practice");
  return tags;
}

/**
 * Derive the criterion, level and version an axe rule enforces from its tags.
 * Tags look like "wcag2aa" (level), "wcag143" (criterion 1.4.3), "wcag22aa"
 * (level, introduced in 2.2). Rules with no WCAG level tag are best-practice.
 * @param {string[]} tags
 * @returns {WcagRef}
 */
export function wcagFromAxeTags(tags) {
  /** @type {WcagLevel} */
  let level = "best-practice";
  /** @type {WcagVersion} */
  let version = "2.0";
  let criterion = "";
  for (const tag of tags) {
    const m = /^wcag(2|21|22)(a|aa|aaa)$/.exec(tag);
    if (m) {
      const lv = /** @type {WcagLevel} */ (m[2].toUpperCase());
      if (level === "best-practice" || LEVEL_RANK[lv] > LEVEL_RANK[level]) level = lv;
      const ver = /** @type {WcagVersion} */ (m[1] === "2" ? "2.0" : `${m[1][0]}.${m[1][1]}`);
      if (VERSION_RANK[ver] > VERSION_RANK[version]) version = ver;
      continue;
    }
    const c = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (c && !criterion) criterion = `${c[1]}.${c[2]}.${c[3]}`;
  }
  return { criterion, level, version };
}
