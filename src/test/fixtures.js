// @ts-check
/**
 * Playwright fixtures. Import `test` from "ramp-check/test" and call
 * `a11y.check(label)` at every state worth checking:
 *
 *   import { test, expect } from "ramp-check/test";
 *   test("checkout dialog", async ({ page, a11y }) => {
 *     await page.getByRole("button", { name: "Checkout" }).click();
 *     await a11y.check("checkout dialog");
 *   });
 *
 * Configure once with `test.use({ a11yConfig: { policy: "wcag22-aa" } })` or
 * per call with the second argument. Under `reducedMotion: "reduce"` the
 * motion audit runs too, so a `matrix()` with a reduce cell covers it.
 *
 * Warnings (findings above the policy level) never fail a test, but they are
 * printed to the test's output as `[ramp-check] warn: ...` lines so a green
 * run still shows them; set `a11yConfig: { reportWarnings: "quiet" }` to keep
 * them in the attachment and annotations only. `check()` also returns the
 * full result, so `result.warnings` is there for programmatic use.
 *
 * When a check finds anything, a screenshot of the state with every finding
 * boxed and numbered is attached beside the JSON; the `[n]` at the start of
 * each failure line is the box number. `a11yConfig: { screenshot: { mode:
 * "off" } }` turns it off; see docs/config.md for the other options.
 *
 * Already have a `page` fixture that logs in? Extend THIS `test`, not
 * Playwright's: `const myTest = test.extend({ page: async ({ page }, use) => { await login(page); await use(page); } })`.
 * Extending the wrong base shows up at runtime as
 * "Test has unknown parameter 'a11y'".
 */
import { test as base, expect } from "@playwright/test";
import { motionRuntime } from "../checks/motion.js";
import { classify, failures, formatFinding, runChecks } from "../run.js";
import { describeUnlocated, highlightFindings } from "../screenshot.js";
import { matrix } from "./matrix.js";

/** @typedef {import("../run.js").RampCheckConfig} RampCheckConfig */
/** @typedef {import("../run.js").CheckResult} CheckResult */

/**
 * @typedef {object} A11y
 * @property {(label: string, overrides?: RampCheckConfig) => Promise<CheckResult>} check
 *   run the checks and fail the test on blocking findings; warnings are
 *   annotated, the full result is attached as JSON, and a highlight
 *   screenshot is attached when there is anything to show
 * @property {(label: string, overrides?: RampCheckConfig) => Promise<CheckResult>} scan
 *   run the checks and return the result without asserting
 * @property {(label: string, findings: import("../types.js").Finding[], overrides?: RampCheckConfig) => Promise<void>} assert
 *   apply the policy and allowlist to findings from a pattern (or any check
 *   called directly) and fail the test on blocking ones
 */

/**
 * @typedef {object} A11yFixtures
 * @property {RampCheckConfig} a11yConfig
 * @property {A11y} a11y
 */

export const test = base.extend(
  /** @type {import("@playwright/test").Fixtures<A11yFixtures, {}, import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions>} */ ({
    a11yConfig: [{}, { option: true }],

    // The motion runtime must be in place before the app's first script runs,
    // and the page fixture may already have navigated by the time a test-level
    // fixture sets up (adopters often override `page` to log in), so install
    // it on the context.
    context: async ({ context }, use) => {
      await context.addInitScript(motionRuntime);
      await use(context);
    },

    a11y: async ({ page, a11yConfig, reducedMotion }, use, testInfo) => {
      /** @type {A11y} */
      const api = {
        scan: (label, overrides) =>
          runChecks(page, merge(a11yConfig, overrides), {
            label,
            reducedMotion: reducedMotion === "reduce",
          }),
        check: async (label, overrides) => {
          const config = merge(a11yConfig, overrides);
          const result = await api.scan(label, overrides);
          // Before the JSON attach, so the findings carry their box numbers.
          const shot = await highlightFindings(page, result.findings, config.screenshot);
          await testInfo.attach(`ramp-check: ${label}`, {
            body: JSON.stringify(result, null, 2),
            contentType: "application/json",
          });
          await attachShot(label, shot);
          reportWarnings(label, result, config);
          for (const e of result.unused) {
            testInfo.annotations.push({
              type: "a11y-allowlist-unused",
              description: `${e.rule} ${e.target} (expires ${e.expires})`,
            });
          }
          expect(failures(result), `${label}: accessibility findings (policy ${result.policy})`).toEqual([]);
          return result;
        },
        assert: async (label, findings, overrides) => {
          const config = merge(a11yConfig, overrides);
          const classified = classify(findings, config);
          const result = { label, ran: [], ...classified };
          const shot = await highlightFindings(page, result.findings, config.screenshot);
          await testInfo.attach(`ramp-check: ${label}`, {
            body: JSON.stringify(result, null, 2),
            contentType: "application/json",
          });
          await attachShot(label, shot);
          reportWarnings(label, result, config);
          expect(failures(result), `${label}: accessibility findings (policy ${result.policy})`).toEqual([]);
        },
      };

      /**
       * Attach the highlight screenshot and say which findings it could not
       * box, so nothing goes missing silently.
       * @param {string} label
       * @param {import("../screenshot.js").Highlight | null} shot
       */
      async function attachShot(label, shot) {
        if (!shot) return;
        await testInfo.attach(`ramp-check: ${label} (highlighted)`, { body: shot.png, contentType: "image/png" });
        for (const line of describeUnlocated(shot)) {
          testInfo.annotations.push({ type: "a11y-not-in-screenshot", description: `${label}: ${line}` });
        }
      }

      /**
       * Annotate every warning and, unless quiet, print it so a passing run
       * still shows what is above the policy level.
       * @param {string} label
       * @param {{ warnings: import("../types.js").Finding[], policy: string }} result
       * @param {RampCheckConfig} config
       */
      function reportWarnings(label, result, config) {
        for (const w of result.warnings) {
          testInfo.annotations.push({ type: "a11y-warning", description: `${label}: ${w.rule}: ${w.target}` });
        }
        if (config.reportWarnings === "quiet" || !result.warnings.length) return;
        console.warn(`[ramp-check] ${label}: ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"} above policy ${result.policy}`);
        for (const w of result.warnings) console.warn(`[ramp-check] warn: ${formatFinding(w)}`);
      }
      await use(api);
    },
  }),
);

/**
 * @param {RampCheckConfig} base
 * @param {RampCheckConfig} [overrides]
 * @returns {RampCheckConfig}
 */
function merge(base, overrides) {
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    checks: { ...base.checks, ...overrides.checks },
    motion: { ...base.motion, ...overrides.motion },
    reflow: { ...base.reflow, ...overrides.reflow },
    screenshot: { ...base.screenshot, ...overrides.screenshot },
  };
}

/**
 * Assert a `runChecks()` result is clean, for specs that drive the checks
 * directly instead of through the `a11y` fixture. Fails with one line per
 * blocking finding and per expired allowlist entry.
 * @param {CheckResult} result
 * @param {string} [label]
 */
export function expectClean(result, label = result.label || "page") {
  expect(failures(result), `${label}: accessibility findings (policy ${result.policy})`).toEqual([]);
}

/**
 * `matrix()` bound to this `test`, so cells declare with the a11y fixtures.
 * @param {import("./matrix.js").MatrixAxes} axes
 * @param {(cell: import("./matrix.js").MatrixCell) => void} body
 */
export function a11yMatrix(axes, body) {
  matrix(axes, body, { test });
}

export { expect, matrix };
export { VIEWPORTS, cells } from "./matrix.js";
