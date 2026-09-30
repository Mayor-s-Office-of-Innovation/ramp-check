// @ts-check
/**
 * Motion audit: does the page honor prefers-reduced-motion?
 *
 * Runs under `reducedMotion: "reduce"` emulation and reports every animation
 * that still moves. Two things a naive `document.getAnimations()` misses, both
 * verified in Chromium (Playwright 1.63, 2026-09-30):
 *
 * 1. Animations inside shadow roots. `element.getAnimations({ subtree: true })`
 *    does not descend into shadow trees, so the probe walks every open shadow
 *    root itself and queries the elements inside.
 * 2. View Transitions. `document.startViewTransition()` does NOT skip under
 *    reduced motion, and a `*` CSS rule never matches the
 *    `::view-transition-*` pseudo-elements it animates. The pseudo-elements
 *    are gone as soon as the transition ends, so the probe wraps
 *    `startViewTransition` from a page init script and records the
 *    pseudo-element animations while they exist.
 *
 * Enforces 2.3.3 Animation from Interactions (AAA, WCAG 2.1) for finite motion
 * and 2.2.2 Pause, Stop, Hide (A) for motion that never ends.
 */

/** @typedef {import("@playwright/test").Page} Page */
/** @typedef {import("../types.js").Finding} Finding */

/**
 * @typedef {object} ObservedAnimation
 * @property {string} target     path to the animated element; pseudo-element suffix when present
 * @property {string} name       animation name, transition property, or Animation id
 * @property {"animation" | "transition" | "web-animation"} kind
 * @property {number} duration   ms per iteration
 * @property {number} delay      ms
 * @property {number} iterations Infinity for looping animations
 * @property {string} playState
 */

/**
 * @typedef {object} ViewTransitionRecord
 * @property {number} at             performance.now() when startViewTransition was called
 * @property {ObservedAnimation[]} animations  the pseudo-element animations observed once ready
 * @property {string | null} error   set when the transition was skipped or failed
 */

/**
 * @typedef {object} MotionAuditResult
 * @property {Finding[]} findings
 * @property {ObservedAnimation[]} animations         everything moving at audit time
 * @property {ViewTransitionRecord[]} viewTransitions  every startViewTransition call since load
 * @property {boolean} reducedMotion                  what the page saw in matchMedia
 */

/**
 * The in-page runtime. Self-contained (no closures) so the same function
 * serves as a page init script and as an on-demand `page.evaluate` payload.
 * Installs `window.__rampCheck` once; later calls are no-ops.
 */
export function motionRuntime() {
  const w = /** @type {any} */ (window);
  if (w.__rampCheck?.installed) return;

  /** @param {Element} el */
  function selectorFor(el) {
    let s = el.localName;
    if (el.id) s += `#${el.id}`;
    const classes = Array.from(el.classList).slice(0, 2);
    if (classes.length) s += `.${classes.join(".")}`;
    return s;
  }

  /** @param {Element} el */
  function pathFor(el) {
    const parts = [];
    /** @type {Element | null} */
    let node = el;
    while (node) {
      parts.unshift(selectorFor(node));
      const root = node.getRootNode();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    return parts.join(" >>> ");
  }

  /** @param {Animation} anim @returns {ObservedAnimation} */
  function describe(anim) {
    const effect = /** @type {KeyframeEffect | null} */ (anim.effect);
    const timing = effect?.getComputedTiming?.();
    const target = effect?.target ?? null;
    const pseudo = effect?.pseudoElement || "";
    const a = /** @type {any} */ (anim);
    const kind =
      typeof a.animationName === "string"
        ? "animation"
        : typeof a.transitionProperty === "string"
          ? "transition"
          : "web-animation";
    return {
      target: (target ? pathFor(target) : "") + pseudo,
      name: a.animationName ?? a.transitionProperty ?? anim.id ?? "",
      kind,
      duration: Number(timing?.duration) || 0,
      delay: Number(timing?.delay) || 0,
      iterations: timing?.iterations ?? 1,
      playState: anim.playState,
    };
  }

  /**
   * Every animation in the document, including inside open shadow roots and
   * on pseudo-elements.
   * @returns {Animation[]}
   */
  function collectAll() {
    const set = new Set(document.getAnimations());
    /** @param {Document | ShadowRoot} root */
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (!el.shadowRoot) continue;
        for (const child of el.shadowRoot.children) {
          for (const anim of child.getAnimations({ subtree: true })) set.add(anim);
        }
        walk(el.shadowRoot);
      }
    };
    walk(document);
    return Array.from(set);
  }

  /** @type {ViewTransitionRecord[]} */
  const viewTransitions = [];
  /** `ready` promises of transitions whose animations have not been read yet. */
  /** @type {Promise<unknown>[]} */
  const pending = [];

  w.__rampCheck = {
    installed: true,
    viewTransitions,
    /** Records for every startViewTransition call, once their animations are known. */
    async viewTransitionRecords() {
      await Promise.allSettled(pending.splice(0));
      return viewTransitions;
    },
    collect: () => collectAll().map(describe),
    /** Wait for every finite animation to finish. Infinite ones are ignored so this cannot hang. */
    settle: () =>
      Promise.all(
        collectAll()
          .filter((a) => ["running", "finished", "pending"].includes(a.playState))
          .filter((a) => {
            const t = /** @type {KeyframeEffect | null} */ (a.effect)?.getComputedTiming?.();
            return t && t.iterations !== Infinity;
          })
          .map((a) => a.finished.catch(() => {})),
      ),
  };

  const original = /** @type {any} */ (document).startViewTransition;
  if (typeof original !== "function") return;
  /** @type {any} */ (document).startViewTransition = function (/** @type {unknown} */ arg) {
    const vt = original.call(document, arg);
    /** @type {ViewTransitionRecord} */
    const record = { at: performance.now(), animations: [], error: null };
    viewTransitions.push(record);
    const done = vt.ready
      .then(() => {
        record.animations = document.documentElement
          .getAnimations({ subtree: true })
          .filter((a) => /** @type {any} */ (a.effect)?.pseudoElement?.startsWith("::view-transition"))
          .map(describe);
      })
      .catch((/** @type {unknown} */ e) => {
        record.error = String(e);
      });
    pending.push(done);
    return vt;
  };
}

/**
 * @typedef {object} MotionAuditOptions
 * @property {number} [threshold]  ms; motion at or below this is treated as instant (default 5)
 * @property {boolean} [requireReducedMotion]  throw unless the page is under reduced-motion emulation (default true)
 */

/**
 * Audit the page for motion that ignores prefers-reduced-motion.
 *
 * Call it right after the action you want to audit, before waiting for
 * anything else: finished animations leave `getAnimations()`, so only motion
 * still running is observed. View transitions are the exception; they are
 * recorded from the init script regardless of timing.
 *
 * @param {Page} page
 * @param {MotionAuditOptions} [opts]
 * @returns {Promise<MotionAuditResult>}
 */
export async function motionAudit(page, opts = {}) {
  const threshold = opts.threshold ?? 5;
  await page.evaluate(motionRuntime);
  const snapshot = await page.evaluate(async () => {
    const s = /** @type {any} */ (window).__rampCheck;
    return {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      animations: /** @type {ObservedAnimation[]} */ (s.collect()),
      viewTransitions: /** @type {ViewTransitionRecord[]} */ (await s.viewTransitionRecords()),
    };
  });
  if (!snapshot.reducedMotion && opts.requireReducedMotion !== false) {
    throw new Error(
      "motionAudit runs under reduced-motion emulation. Set reducedMotion: \"reduce\" via test.use() or the browser context, or pass { requireReducedMotion: false }.",
    );
  }

  /** @type {Finding[]} */
  const findings = [];
  const seen = new Set();
  /** @param {Finding} f */
  const add = (f) => {
    const key = `${f.rule}|${f.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  /** @type {ObservedAnimation[][]} */
  const viewTransitionGroups = snapshot.viewTransitions.map((vt) => vt.animations);
  /** @type {ObservedAnimation[]} */
  const liveViewTransition = [];

  for (const a of snapshot.animations) {
    if (!["running", "finished", "pending"].includes(a.playState)) continue;
    if (a.target.includes("::view-transition")) {
      // Still mid-transition: report it with the recorded ones below.
      liveViewTransition.push(a);
      continue;
    }
    const label = `${a.kind} "${a.name}"`;
    if (a.iterations === Infinity || a.iterations === null) {
      if (a.duration <= threshold) continue;
      add({
        check: "motion",
        rule: "infinite-animation",
        target: a.target,
        message: `${label} loops forever (${round(a.duration)}ms per cycle) under reduced motion`,
        wcag: { criterion: "2.2.2", level: "A", version: "2.0" },
        help: "https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html",
        data: { ...a },
      });
      continue;
    }
    const total = a.duration * a.iterations;
    if (total <= threshold) continue;
    add({
      check: "motion",
      rule: "reduced-motion-ignored",
      target: a.target,
      message: `${label} still runs for ${round(total)}ms under reduced motion`,
      wcag: { criterion: "2.3.3", level: "AAA", version: "2.1" },
      help: "https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html",
      data: { ...a },
    });
  }
  if (liveViewTransition.length) viewTransitionGroups.push(liveViewTransition);

  // One finding per view transition, naming the pseudo-elements that moved.
  for (const group of viewTransitionGroups) {
    const moving = group.filter((a) => {
      const total = a.iterations === Infinity ? Infinity : a.duration * a.iterations;
      return total > threshold;
    });
    if (!moving.length) continue;
    const names = [...new Set(moving.map((a) => /\((.*?)\)$/.exec(a.target)?.[1] ?? "root"))];
    const longest = Math.max(...moving.map((a) => a.duration * (a.iterations === Infinity ? 1 : a.iterations)));
    const pseudos = moving.map((a) => a.target.slice(a.target.indexOf("::")));
    add({
      check: "motion",
      rule: "view-transition-animates",
      target: `::view-transition(${names.join(", ")})`,
      message: `document.startViewTransition() animated ${[...new Set(pseudos)].join(", ")} for ${round(longest)}ms under reduced motion; add a ::view-transition-* rule or skip the call`,
      wcag: { criterion: "2.3.3", level: "AAA", version: "2.1" },
      help: "https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html",
      data: { animations: moving },
    });
  }

  return { findings, ...snapshot };
}

/** @param {number} n */
function round(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}
