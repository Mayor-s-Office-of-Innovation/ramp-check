// @ts-check
import { test, expect } from "@playwright/test";
import { axeTagsFor, resolvePolicy, severityFor, wcagFromAxeTags, POLICIES } from "../src/index.js";

test.describe("policy", () => {
  test("three named levels, AAA by default", () => {
    expect(Object.keys(POLICIES)).toEqual(["wcag-aaa", "wcag22-aa", "wcag21-aa"]);
    expect(resolvePolicy().name).toBe("wcag-aaa");
    expect(() => resolvePolicy("strict")).toThrow(/Unknown policy "strict"/);
  });

  test("severity: at or below the level and version blocks, above warns", () => {
    const aaa = resolvePolicy("wcag-aaa");
    const aa22 = resolvePolicy("wcag22-aa");
    const aa21 = resolvePolicy("wcag21-aa");
    const contrastEnhanced = /** @type {const} */ ({ criterion: "1.4.6", level: "AAA", version: "2.0" });
    const focusObscured = /** @type {const} */ ({ criterion: "2.4.11", level: "AA", version: "2.2" });
    const imageAlt = /** @type {const} */ ({ criterion: "1.1.1", level: "A", version: "2.0" });
    const motion = /** @type {const} */ ({ criterion: "2.3.3", level: "AAA", version: "2.1" });

    expect(severityFor(contrastEnhanced, aaa)).toBe("block");
    expect(severityFor(contrastEnhanced, aa22)).toBe("warn");
    expect(severityFor(focusObscured, aa22)).toBe("block");
    expect(severityFor(focusObscured, aa21)).toBe("warn");
    expect(severityFor(imageAlt, aa21)).toBe("block");
    expect(severityFor(motion, aaa)).toBe("block");
    expect(severityFor(motion, aa21)).toBe("warn");
  });

  test("best-practice and per-check overrides", () => {
    const aa = resolvePolicy("wcag22-aa");
    const bp = /** @type {const} */ ({ criterion: "", level: "best-practice", version: "2.0" });
    const motion = /** @type {const} */ ({ criterion: "2.3.3", level: "AAA", version: "2.1" });
    expect(severityFor(bp, aa)).toBe("block");
    expect(severityFor(bp, aa, { bestPractice: "warn" })).toBe("warn");
    expect(severityFor(bp, aa, { bestPractice: "off" })).toBe("off");
    expect(severityFor(motion, aa, { override: "block" })).toBe("block");
  });

  test("axe tags: always the full set; policy decides severity, not coverage", () => {
    expect(axeTagsFor()).toEqual([
      "wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice",
    ]);
    expect(axeTagsFor({ bestPractice: "off" })).not.toContain("best-practice");
    expect(axeTagsFor({ tags: ["wcag2a"] })).toEqual(["wcag2a"]);
  });

  test("WCAG reference derived from axe rule tags", () => {
    expect(wcagFromAxeTags(["cat.color", "wcag2aa", "wcag143", "TTv5", "ACT"])).toEqual({
      criterion: "1.4.3", level: "AA", version: "2.0",
    });
    expect(wcagFromAxeTags(["wcag2aaa", "wcag146"])).toEqual({ criterion: "1.4.6", level: "AAA", version: "2.0" });
    expect(wcagFromAxeTags(["wcag22aa", "wcag258"])).toEqual({ criterion: "2.5.8", level: "AA", version: "2.2" });
    expect(wcagFromAxeTags(["wcag21aa", "wcag1410"])).toEqual({ criterion: "1.4.10", level: "AA", version: "2.1" });
    expect(wcagFromAxeTags(["cat.structure", "best-practice"])).toEqual({ criterion: "", level: "best-practice", version: "2.0" });
  });
});
