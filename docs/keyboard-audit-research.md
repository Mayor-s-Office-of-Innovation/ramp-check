# Keyboard audit research — synthesis

*2026-10-01. Input research for the keyboard audit (phase 1). Claims below were
verified against live-fetched sources during a research session: vendor docs, GitHub
source (Testaro, Alfa, axe-core, IBM equal-access, QualWeb), npm registry data,
act-rules.github.io, W3C Understanding pages, and OpenAlex/Crossref/arXiv APIs. Where a
number or a "zero implementations" claim matters, it came from the cited source directly,
not from secondary coverage.*

## The question

How far can an automated keyboard audit go — reachability, visible focus, focus not
obscured, keyboard-trap detection, skip links — beyond what axe-core structurally cannot
check? The industry answer is three tiers; the honest answer is that the walk is
automatable, the judgment is not.

## Tier model (what existing tools actually do)

1. **Static focus-hygiene rules** (axe-core `cat.keyboard`, Siteimprove Alfa
   SIA-R84/R95, IBM accessibility-checker): tabindex misuse, scrollable-region
   tabbability, iframe exclusions, `aria-hidden-focus`. Fully automated, CI-friendly,
   shallow — this tier is largely already covered by axe scans inside ramp-check.
2. **Instrumented tab walk** — the dominant design: auto-tab or human-tab the page,
   record the focus sequence, flag suspects for human confirmation. Microsoft
   Accessibility Insights Tab Stops (human tabs, engine records, post-hoc heuristics);
   Deque axe DevTools Keyboard IGT (engine auto-tabs; an AI mode evaluates focus
   indicators and attempts trap escapes, with human review built into the workflow);
   Evinced Flow Analyzer (does not drive the keyboard — scans continuously during
   recorded flows, adds computer-vision focus-contrast measurement).
3. **The keyboard-flow engines ship as interactive/extension features, not CI** —
   across the tools surveyed, tab-stop recording and trap review live in browser
   extensions or guided sessions; CLI/SDK surface covers static scans only (Deque's
   CLI scripts scripted keypresses + per-step axe scans; MS Tab Stops has no programmatic
   API; TPGi ARC does static tab-order visualization; Level Access positions keyboard
   testing as manual-auditor work).

## Verified OSS prior art (code-level, not marketing)

| Tool | What it does | Status |
| --- | --- | --- |
| **Testaro** (`YRA-Tech/testaro`, npm 78.4.0) | Real Tab walks: `focAll` (focusable-vs-tabbed count diff), `focInd` (computed-style focus indicator), `focOp`/`focAndOp` (tabbable-but-not-operable), `focVis` (obscured links), `tabNav` (APG keystroke-by-keystroke tablist test — the only open-source one found) | Active, Node 22, Playwright 1.62+ |
| **Siteimprove Alfa** (`Siteimprove/alfa`, npm 0.119.0) | ACT-rules engine. SIA-R65 (ACT `oj04fd`, 2.4.7 visible focus — automated and assisted variants via a `Question` system), R84/R95 (2.1.1 static), R87 (skip link with `Question`s) | Active; no trap rules (empty procedureNames in their ACT submission data) |
| **axe-core** 4.13 | Keyboard rules: `frame-focusable-content` (ACT `akn7bn`), `scrollable-region-focusable` (`0ssw9k`), `aria-hidden-focus` (`6cfa84`), `bypass` (needs review), experimental `focus-order-semantics`. No focus-visibility rule, no trap rule | Active |
| **IBM equal-access** 4.0.34 | `element_tabbable_visible` + `style_focus_visible` (2.4.7 via `:focus` style diff), `element_tabbable_unobscured` (2.4.11 overlap math → emits `RulePotential`, i.e. needs-review), `script_focus_blur_review` (detects `blur()` hiding), static widget approximations | Very active (main-4.x pushed 2026-09-28) |
| **QualWeb** (`@qualweb/act-rules` 0.8.6) | ACT implementations incl. `oj04fd` (consistent/complete on act-rules.github.io), `0ssw9k`, `akn7bn`, skip-link cluster | Active |
| **@a11y-oracle/focus-analyzer** | CDP-based: `getFocusIndicator()` (computed styles + 3:1 contrast), `getTabOrder()` (DOM-computed, no shadow-DOM), `detectKeyboardTrap()` (capped tab walk; README notes it can't verify Escape-released modals) | Small but current (1.3.2, 2026-03-12) |
| **@a11y-skills/audit** | `runKeyboardReachabilityCheck` (Tab walk + arrow keys in composite widgets/`aria-activedescendant`), `runFocusIndicatorCheck` (2.4.7/2.4.12/3.2.1, with `interrupted` flags), capped tab walk with honest `tabWalkCapped`; violation-vs-incomplete classification; CLI + GitHub Action | Very active (0.8.0, 2026-09-29) |
| **a11y-gate** | Single-pass tab walk feeding three checks: focus-visibility (computed-style diff), hard trap (same element still focused → critical, distinguishes legitimate wrap-around), unreachable custom widgets | Active (1.3.2, 2026-09-28) |
| **tabbable** (focus-trap org, 6.5.0, ~111M dl/mo) | The canonical DOM-side tab-order computation — use as the diff baseline against a real walk | Active, mature |

## Academic research

- **Trewin, "Automating accessibility: the dynamic keyboard" (ASSETS 2003,
  DOI 10.1145/1028630.1028644)** — the ancestor: simulate keyboard traversal, observe
  focus.
- **Chiou, Alotaibi, Halfond, "Detecting and localizing keyboard accessibility failures
  in web applications" (ESEC/FSE 2021, DOI 10.1145/3468264.3468581)** — event-driven
  exploration with high precision/recall and element-level localization (map failure to
  the responsible DOM node, not just page-level flags). Follow-ups: **BAGEL** (CHI 2023
  LBW, navigation barriers) and **"Lost in Navigation" (ICST 2026)** — an active
  research line; cite-check before design.
- **Flow-A11y (arXiv 2607.03100, July 2026)** — the most directly relevant recent work:
  runtime flow → ordered trace → criterion-specific evidence packets → gate unsupported
  judgments → auditable findings. Numbers: evidence calibration raised fail-precision
  from 23.5% → 41.4% — even the best published approach leaves most "failed" trap
  verdicts imprecise. The evidence-packet + gating pattern is the borrowable core.
- **Agentic auditing framework (arXiv 2609.09379, Sept 2026)** — 250-page-criterion
  expert-audit dataset across 11 platforms. Vision-language agents reach 86% recall /
  56% precision on keyboard criteria vs 36% recall for axe-core; agents recovered 9 of
  10 "no keyboard trap" cases static tools miss — published confirmation that trap
  detection requires interaction, not static analysis. Dataset is a candidate benchmark
  (license not yet checked).
- **SATYA (W4A 2026, DOI 10.1145/3800424.3800426)** — FIDA (computer-vision
  focus-indicator detection) + KNA (keyboard-navigability algorithm combining visual
  verification, simulated navigation, structure analysis). New work; FIDA is the
  template for screenshot-based focus checking.
- **GenA11y (Proc. ACM Software Engineering 2025, DOI 10.1145/3729371)** — LLM-based
  semantic checks (94.5% precision / 87.6% recall, page-level), the current approach
  where DOM heuristics stall on intent/semantics; findings should stay "needs review",
  not hard failures.
- **AMBER (W4A 2013, DOI 10.1145/2461121.2461124)** — the benchmarking methodology
  (coverage/completeness/correctness; surveyed tools covered ≤50% of criteria,
  completeness 14–38%) — a model for measuring and publishing this tool's own
  precision/recall honestly.

## W3C grounding (spec-level facts that shape the design)

- **ACT `oj04fd` (2.4.7)**: the automated bar is "at least one device pixel differs
  focused vs unfocused"; its implementations table shows automated tools top out at
  "Partial" consistency — beyond the pixel test is semi-automated territory.
- **ACT `80af7b` (2.1.2 no keyboard trap)** = composite of `a1b64e` (standard
  navigation) + `ebe86a` (non-standard, requires user advice). No automated
  implementations exist for the trap rules; the example corpus is ready-made golden
  fixture material.
- **2.1.2 Understanding**: WAI states restricted focus inside a modal does not fail
  when users can untrap — designed containment is legitimate. "User is advised" of the
  exit method is part of the rule; what counts as a "standard exit method" is
  deliberately unspecified.
- **2.4.11 Understanding**: "A properly constructed modal dialog will always pass this
  SC" — the published formalization of intent witnesses: `<dialog>` (H102),
  `aria-modal="true"` + `role="dialog"`, `inert`/backdrop on the background, focus moved
  in on open, focus restored on close. Failures: F110 (sticky headers obscuring focus);
  C43 (`scroll-padding`) as the pass technique.
- **2.4.7 Understanding**: failure techniques F78 (outline removed via CSS) and F55
  (focus removed on focus) are cheap static checks — the negative-test suite.
- **2.4.3 Understanding**: F44 (positive tabindex destroys order) is purely static; F85
  (trigger not adjacent to target in tab order); `<dialog>` usage is a machine-detectable
  sufficient technique (H102).
- **Outcome model**: ACT uses passed / failed / inapplicable / **cantTell** (EARL
  incomplete) — our violation-vs-needs-review split should follow it, and ACT
  implementation submission (`akn7bn`, `0ssw9k`, `6cfa84` have few implementations) is a
  credibility win down the road.
- **Official automation limit**: the W3C test-evaluate page states no tool alone can
  determine standards conformance — the anchor for any semi-automation framing.

## Automation boundary — the bottom line

**Solidly automatable (published precedent):**
1. Reachability via a real Tab walk (`page.keyboard.press('Tab')` +
   `document.activeElement` loop — no CDP shortcut exists; every surveyed tool
   hand-rolls this), diffed against a DOM-computed tabbable set (the `tabbable`
   algorithm) — flag interactive-role/onclick elements never reached.
2. Hard keyboard traps: capped walk, same-element-forever → trap; distinguish
   legitimate focus wrap-around; localize the trapping element.
3. Visible focus existence: computed-style diff (outline/box-shadow/border) focused vs
   unfocused, optionally screenshot-pair pixel diff per `oj04fd`.
4. Focus-not-obscured geometry: focused-element bbox vs sticky/overlay-layer overlap
   math, with the 2.4.11 modal-dialog exemption; emit as needs-review, not failure
   (IBM's `RulePotential` model).
5. Skip-link structure: first-tabbable → internal/main target, activation visibility —
   emit as needs-review (axe's own `bypass` verdict).
6. Static hygiene: tabindex>0 (F44), aria-hidden-focus, scrollable-region, iframe
   exclusion — mostly already axe-covered.

**Heuristic (gate with evidence, emit needs-review):**
1. **Intended modal trap vs accidental trap** — the crux. Witnesses:
   `<dialog>`/`aria-modal`/`inert`/Esc-closes/focus-restore/exit advice text. Witness
   present → verify consistent behavior; no witness + observed containment → flag.
   Expect precision in the 40–60% band (Flow-A11y) — so gate, don't guess.
2. Focus indicator quality beyond existence — 2.4.13 formulas (2-px perimeter area,
   3:1 change-of-contrast) over state-pair screenshots, advisory only.
3. Focus-order meaningfulness — tab vs visual vs DOM order; flag only gross inversions
   (absolute positioning, float, tabindex>0 confounders).
4. 2.1.1 functional equivalence — LLM/classifier territory (GenA11y), "needs
   verification".

**Genuinely human (officially so):** trap-escape adequacy judgment ("user is
advised"), focus-order meaningfulness, bypass sufficiency beyond the static pattern,
focus-indicator perceptual adequacy in real rendering, overall conformance.

## Technique takeaways for the implementation

1. **One real-Tab walk per page state feeds reachability + trap + visible-focus +
   obscuration simultaneously** (the a11y-gate single-pass pattern) — fits ramp-check's
   architecture: each sub-check consumes the walk's recorded sequence.
2. **Keep a separate DOM-computed tab-order model** (`tabbable`-equivalent) and diff the
   observed walk against it — reachability gaps and order surprises fall out of the
   diff.
3. **Adopt the 5-outcome model** (passed/failed/inapplicable/cantTell) with an explicit
   needs-review class for every gated judgment — Alfa's `Question` system and IBM's
   `RulePotential` are the reference designs.
4. **Borrow evidence packets + judgment gating from Flow-A11y**: a trap finding must
   carry its witness evidence (modal markers present? Esc works? focus restored?) and is
   `cantTell` when the evidence is incomplete.
5. **Use ACT rule test corpora as fixtures** (`80af7b`, `a1b64e`, `ebe86a`, `oj04fd`
   example pages) — license-clean golden tests matching ramp-check's planted-defect
   convention (a check without a seeded defect page is not done).
6. **Name rules after WCAG failure techniques** (F78, F44, F85, F110) — instant doc
   grounding.
7. **Widget keyboard operation**: Testaro's `tabNav` is the only OSS APG keystroke test;
   a per-widget (tablist first) keystroke contract test is high-value and defensible.
8. **Benchmark honestly**: AMBER methodology (coverage/completeness/correctness) over a
   corpus of seeded defects + real pages; publish the numbers.