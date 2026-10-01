// @ts-check
/**
 * ESLint flat-config preset for the motion mistakes a runtime audit cannot
 * see until they run:
 *
 * - `behavior: "smooth"` in JavaScript scroll calls ignores the CSS
 *   `scroll-behavior: auto` override under prefers-reduced-motion, so the
 *   reduced-motion guard in CSS does not help.
 * - `document.startViewTransition()` does not skip under reduced motion and
 *   a `*` CSS rule cannot reach its pseudo-elements. Allow it only where the
 *   router guards it.
 *
 *   // eslint.config.js
 *   import { rampCheck } from "ramp-check/eslint";
 *   export default [...rampCheck({ viewTransitionsIn: ["src/router.js"] })];
 *
 * No dependency on ESLint; this exports plain config objects for ESLint 9.
 */

export const SMOOTH_SCROLL_SELECTOR = "Property[key.name='behavior'] > Literal[value='smooth']";
export const VIEW_TRANSITION_SELECTOR = "CallExpression[callee.property.name='startViewTransition']";

export const SMOOTH_SCROLL_MESSAGE =
  "JS smooth scrolling ignores the CSS reduced-motion override. Use CSS scroll-behavior, or check matchMedia(\"(prefers-reduced-motion: reduce)\") first.";
export const VIEW_TRANSITION_MESSAGE =
  "document.startViewTransition() does not skip under reduced motion and a `*` CSS rule cannot reach ::view-transition-* pseudo-elements. Keep it in the router behind a matchMedia check, and allow that file via rampCheck({ viewTransitionsIn }).";

/**
 * @param {{ viewTransitionsIn?: string[], files?: string[] }} [opts]
 *   `viewTransitionsIn`: glob(s) where startViewTransition is allowed.
 *   `files`: glob(s) the preset applies to (default: all JS/TS).
 * @returns {object[]} ESLint flat config entries
 */
export function rampCheck(opts = {}) {
  const files = opts.files ?? ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"];
  const smooth = { selector: SMOOTH_SCROLL_SELECTOR, message: SMOOTH_SCROLL_MESSAGE };
  const viewTransition = { selector: VIEW_TRANSITION_SELECTOR, message: VIEW_TRANSITION_MESSAGE };
  const config = [
    {
      name: "ramp-check/motion",
      files,
      rules: { "no-restricted-syntax": ["error", smooth, viewTransition] },
    },
  ];
  if (opts.viewTransitionsIn?.length) {
    config.push({
      name: "ramp-check/motion-view-transitions-allowed",
      files: opts.viewTransitionsIn,
      rules: { "no-restricted-syntax": ["error", smooth] },
    });
  }
  return config;
}
