# Reading level

WCAG 3.1.5 Reading Level (AAA): when text requires reading ability more
advanced than the lower secondary education level, after removal of proper
names and titles, supplemental content or a version that does not require
that reading ability is available.

The check scores a page's main text and warns when it reads above that level.

## What "lower secondary" means

WCAG defines it by the UNESCO ISCED scale: the two or three years of school
that begin after six years of primary education and end nine years after
primary education began. In grade terms that is grades 7 to 9. The default
ceiling is therefore grade 9: text that scores at 9 or below passes.

## How it is measured

The Automated Readability Index: `4.71 × (characters ÷ words) + 0.5 × (words
÷ sentences) − 21.43`, rounded to a school grade. It uses only letters and
digits per word and words per sentence, so it is stable across fonts,
markup and languages that use the Latin alphabet, and it has no syllable
counter to disagree with. WCAG names no formula; its guidance is to use a
measure suited to the language.

What goes into the score follows the criterion's wording:

- **Titles are removed.** Headings do not count.
- **Proper names are removed**, approximated as capitalized words that do not
  open a sentence. "Ask for Jordan at the desk on Main Street" scores the
  words "Ask for at the desk on". The approximation also drops acronyms and
  the odd capitalized common noun, which makes the score slightly kinder,
  never harsher.
- **Only body text counts.** Navigation, banners, footers, asides, search,
  buttons, form fields, code, figure captions, and anything `aria-hidden`,
  `hidden`, or not rendered are skipped. Text inside open shadow roots is
  included. The container is the first of `main`, `[role="main"]`,
  `article`, then `body`; set `selector` to name it.
- **A line break ends a sentence.** List items and paragraphs without a
  period do not run together into one long sentence.

Pages whose `lang` is not English are not measured. Readability formulas
are calibrated per language, and a score on Spanish or Chinese text with an
English formula would be noise. (A missing `lang` is axe's `html-has-lang`
finding, reported separately.) Pages with fewer than 100 body words are not
measured either; the formula is unreliable on short text and a short page
is rarely the one with the problem.

## Why it warns by default

Two reasons, both in the criterion itself.

The criterion is satisfied by a supplemental version: a summary readable at
lower secondary level (technique G86), the text made simpler (G153), a
spoken version (G79), illustrations (G103), or sign language (G160). A page
can score at grade 14 and conform because a plain-language summary sits
above it. A formula cannot see that.

And a formula measures sentence and word length, not whether a reader
understands. Short sentences of jargon score well; a long clear sentence
scores badly. The number is a prompt to read the page as a reader would,
not a verdict.

Sites whose own policy is that the main text itself must be plain, which is
most government content standards, should promote it:

```js
checks: { readingLevel: "block" }
```

Under the default `wcag-aaa` policy it then blocks like any other AAA
finding; under `wcag22-aa` it warns, because the criterion is AAA.

## Options

```js
readingLevel: {
  maxGrade: 9,       // highest grade that passes
  minWords: 100,     // shorter main text is not measured
  selector: "main",  // override the container
}
```

## Scoring your own text

```js
import { analyzeReadingLevel } from "ramp-check";
const { grade, ari, words, sentences, dropped } = analyzeReadingLevel(text);
```

Useful for content pipelines that want the same number before the page
exists, and for checking one block of a page rather than all of it.

## Relation to plain-language standards

Government plain-language guidance usually sets a target grade somewhere
between 6 and 8 for public-facing content. That is stricter than 3.1.5's
grade 9, and it is a content standard rather than an accessibility
criterion. Lower `maxGrade` to match a house standard; the check will still
report against 3.1.5 in the finding, because that is the criterion it
enforces.
