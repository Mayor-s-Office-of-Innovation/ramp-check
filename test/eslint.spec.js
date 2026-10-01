// @ts-check
import { test, expect } from "@playwright/test";
import { rampCheck, SMOOTH_SCROLL_SELECTOR, VIEW_TRANSITION_SELECTOR } from "../src/eslint.js";

test.describe("eslint preset", () => {
  test("restricts smooth scroll and view transitions everywhere by default", () => {
    const [motion] = /** @type {any[]} */ (rampCheck());
    expect(motion.name).toBe("ramp-check/motion");
    const [level, ...restrictions] = motion.rules["no-restricted-syntax"];
    expect(level).toBe("error");
    expect(restrictions.map((/** @type {any} */ r) => r.selector)).toEqual([SMOOTH_SCROLL_SELECTOR, VIEW_TRANSITION_SELECTOR]);
    expect(restrictions.every((/** @type {any} */ r) => r.message.length > 40)).toBe(true);
  });

  test("the router may use view transitions; smooth scroll stays restricted there", () => {
    const config = /** @type {any[]} */ (rampCheck({ viewTransitionsIn: ["src/router.js"] }));
    expect(config).toHaveLength(2);
    expect(config[1].files).toEqual(["src/router.js"]);
    expect(config[1].rules["no-restricted-syntax"].map((/** @type {any} */ r) => r.selector ?? r)).toEqual(["error", SMOOTH_SCROLL_SELECTOR]);
  });
});
