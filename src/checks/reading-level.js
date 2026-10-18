// @ts-check
/**
 * Reading level (3.1.5, AAA, WCAG 2.0): when text requires reading ability
 * more advanced than the lower secondary education level, after removal of
 * proper names and titles, a version that does not is available.
 *
 * The check measures the page's main text with the Automated Readability
 * Index, a formula over characters per word and words per sentence, and
 * reports when the grade it yields is above the lower secondary band. Lower
 * secondary education (ISCED level 2) ends after nine years of schooling, so
 * the default ceiling is grade 9.
 *
 * What is measured follows the criterion's own wording. Headings ("titles")
 * are dropped, and so are capitalized words that do not start a sentence,
 * the cheapest honest stand-in for "proper names". Navigation, banners,
 * footers, asides, controls, code and anything aria-hidden or not rendered
 * are not body text and are skipped. Text inside open shadow roots counts.
 *
 * Two things keep this a warning by default. The criterion is satisfied by a
 * supplemental simpler version, a summary, or an illustrated version, none
 * of which a formula can see; and readability formulas are calibrated for
 * English, so pages whose `lang` is another language are not measured at
 * all. Promote it with `checks: { readingLevel: "block" }` on sites whose
 * policy is that the main text itself must be plain.
 */

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("../types.js").Finding} Finding */

/**
 * @typedef {object} ReadingLevelOptions
 * @property {number} [maxGrade]   highest ARI grade that passes (default 9, the end of lower secondary)
 * @property {number} [minWords]   fewer body words than this and the page is not measured (default 100)
 * @property {string} [selector]   where the main text lives (default: main, [role=main], article, then body)
 */

/**
 * @typedef {object} ReadingLevelStats
 * @property {number} words       words counted, after dropping proper-name candidates
 * @property {number} sentences
 * @property {number} characters  letters and digits in the counted words
 * @property {number} ari         Automated Readability Index, one decimal
 * @property {number} grade       ari rounded to a school grade
 * @property {number} dropped     capitalized mid-sentence words left out as proper names
 */

/**
 * @typedef {object} ReadingLevelResult
 * @property {Finding[]} findings
 * @property {boolean} measured   false when skipped or too short
 * @property {string} [skipped]   why nothing was measured: "lang-not-english" | "too-short" | "no-text"
 * @property {string} target      the container the text came from
 * @property {string} lang
 * @property {ReadingLevelStats} [stats]
 */

export const DEFAULT_MAX_GRADE = 9;
export const DEFAULT_MIN_WORDS = 100;

/** Elements whose text is not body text for this purpose. */
const EXCLUDE = [
  "nav", "header", "footer", "aside", "script", "style", "noscript", "template", "svg", "iframe",
  "[aria-hidden=\"true\"]", "[hidden]", "[role=\"navigation\"]", "[role=\"banner\"]", "[role=\"contentinfo\"]",
  "[role=\"complementary\"]", "[role=\"search\"]", "h1", "h2", "h3", "h4", "h5", "h6", "button", "select",
  "textarea", "input", "label", "figcaption", "code", "pre", "kbd", "samp", "time", "address",
].join(",");

/** Elements whose end is a sentence boundary even without punctuation. */
const BLOCKS = new Set(["p", "li", "div", "td", "th", "dd", "dt", "blockquote", "section", "article", "summary", "caption"]);

/**
 * Score a text. Pure; exported for tests and for teams measuring their own
 * extractions. Sentences end at . ! ? or a line break. Words are runs of
 * non-space with surrounding punctuation stripped; characters are the
 * letters and digits in them. Capitalized words that do not open a sentence
 * are dropped as proper-name candidates.
 * @param {string} text
 * @returns {ReadingLevelStats}
 */
export function analyzeReadingLevel(text) {
  let words = 0;
  let characters = 0;
  let sentences = 0;
  let dropped = 0;
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const tokens = raw
      .split(/\s+/)
      .map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
      .filter(Boolean);
    if (tokens.length === 0) continue;
    sentences++;
    tokens.forEach((w, i) => {
      if (i > 0 && /^[A-Z]/.test(w)) {
        dropped++;
        return;
      }
      words++;
      characters += w.replace(/[^A-Za-z0-9]/g, "").length;
    });
  }
  const ari = words === 0 || sentences === 0
    ? 0
    : Math.round((4.71 * (characters / words) + 0.5 * (words / sentences) - 21.43) * 10) / 10;
  return { words, sentences, characters, ari, grade: Math.max(0, Math.round(ari)), dropped };
}

/**
 * @param {Page} page
 * @param {ReadingLevelOptions} [opts]
 * @returns {Promise<ReadingLevelResult>}
 */
export async function readingLevel(page, opts = {}) {
  const maxGrade = opts.maxGrade ?? DEFAULT_MAX_GRADE;
  const minWords = opts.minWords ?? DEFAULT_MIN_WORDS;
  const extracted = await page.evaluate(
    ({ selector, exclude, blocks }) => {
      const lang = (document.documentElement.lang || "").trim().toLowerCase().split("-")[0];
      const container =
        (selector && document.querySelector(selector)) ||
        document.querySelector("main, [role=\"main\"]") ||
        document.querySelector("article") ||
        document.body;
      /** @param {Element} el */
      const label = (el) => {
        let s = el.localName;
        if (el.id) s += `#${el.id}`;
        else if (el.getAttribute("role")) s += `[role="${el.getAttribute("role")}"]`;
        return s;
      };
      /** @param {Element} el */
      const rendered = (el) => {
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      };
      /** @type {string[]} */
      const parts = [];
      /** @param {Node} node */
      const collect = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const t = (child.textContent ?? "").replace(/\s+/g, " ").trim();
            if (t) parts.push(t + " ");
            continue;
          }
          if (!(child instanceof Element)) continue;
          if (child.matches(exclude) || !rendered(child)) continue;
          if (child.shadowRoot) collect(child.shadowRoot);
          collect(child);
          if (blocks.includes(child.localName)) parts.push("\n");
        }
      };
      if (!container.matches(exclude)) collect(container);
      return { lang, target: label(container), text: parts.join("") };
    },
    { selector: opts.selector ?? "", exclude: EXCLUDE, blocks: [...BLOCKS] },
  );

  const base = { findings: /** @type {Finding[]} */ ([]), target: extracted.target, lang: extracted.lang };
  if (extracted.lang && extracted.lang !== "en") {
    return { ...base, measured: false, skipped: "lang-not-english" };
  }
  const stats = analyzeReadingLevel(extracted.text);
  if (stats.words === 0) return { ...base, measured: false, skipped: "no-text", stats };
  if (stats.words < minWords) return { ...base, measured: false, skipped: "too-short", stats };
  if (stats.grade <= maxGrade) return { ...base, measured: true, stats };
  return {
    ...base,
    measured: true,
    stats,
    findings: [
      {
        check: "readingLevel",
        rule: "reading-level-advanced",
        target: extracted.target,
        message: `main text reads at grade ${stats.grade} (ARI ${stats.ari}: ${stats.words} words in ${stats.sentences} sentences); 3.1.5 expects lower secondary level (grade ${maxGrade} or below) or a simpler supplemental version of the content`,
        wcag: { criterion: "3.1.5", level: "AAA", version: "2.0" },
        help: "https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html",
        data: { ...stats, maxGrade, lang: extracted.lang },
      },
    ],
  };
}
