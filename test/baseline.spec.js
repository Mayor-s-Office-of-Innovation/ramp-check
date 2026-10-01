// @ts-check
import { test, expect } from "@playwright/test";
import { applyBaseline, buildBaseline, baselineKey } from "../src/index.js";

/** @returns {import("../src/index.js").Finding} */
const finding = (rule = "color-contrast", target = "#x") => ({
  check: "axe", rule, target, message: "", wcag: { criterion: "1.4.3", level: "AA", version: "2.0" }, severity: "block",
});

test.describe("baseline", () => {
  const day0 = new Date("2026-10-01T12:00:00Z");

  test("new entries expire 180 days out by default; existing entries keep their dates", () => {
    const first = buildBaseline([{ page: "/", cell: "", finding: finding() }], null, { now: day0 });
    expect(first.entries).toHaveLength(1);
    expect(first.entries[0]).toMatchObject({ page: "/", rule: "color-contrast", target: "#x", added: "2026-10-01", expires: "2027-03-30" });

    const later = new Date("2026-11-01T12:00:00Z");
    const second = buildBaseline(
      [{ page: "/", cell: "", finding: finding() }, { page: "/", cell: "", finding: finding("image-alt", "img") }],
      first,
      { now: later },
    );
    expect(second.entries.map((e) => [e.rule, e.added, e.expires])).toEqual([
      ["color-contrast", "2026-10-01", "2027-03-30"],
      ["image-alt", "2026-11-01", "2027-04-30"],
    ]);
  });

  test("fixed findings drop out when the baseline is rewritten", () => {
    const first = buildBaseline([{ page: "/", cell: "", finding: finding() }], null, { now: day0 });
    const second = buildBaseline([], first, { now: day0 });
    expect(second.entries).toEqual([]);
  });

  test("apply: live entries suppress, stale entries are reported, expired entries fail", () => {
    const baseline = buildBaseline(
      [{ page: "/", cell: "", finding: finding() }, { page: "/", cell: "", finding: finding("image-alt", "img") }],
      null,
      { now: day0, expiryDays: 30 },
    );
    const located = [{ page: "/", cell: "", finding: finding() }];
    const soon = applyBaseline(located, baseline, { now: new Date("2026-10-15T12:00:00Z") });
    expect(soon.baselined).toHaveLength(1);
    expect(located[0].finding.baselined?.key).toBe(baselineKey("/", "", finding()));
    expect(soon.stale.map((e) => e.rule)).toEqual(["image-alt"]);
    expect(soon.expiringSoon.map((e) => e.rule)).toEqual(["color-contrast"]);
    expect(soon.expired).toEqual([]);

    const fresh = [{ page: "/", cell: "", finding: finding() }];
    const late = applyBaseline(fresh, baseline, { now: new Date("2026-12-01T12:00:00Z") });
    expect(late.baselined).toEqual([]);
    expect(late.expired.map((e) => e.rule).sort()).toEqual(["color-contrast", "image-alt"]);
  });

  test("the cell is part of the key", () => {
    expect(baselineKey("/", "colorScheme: dark", finding())).not.toBe(baselineKey("/", "colorScheme: light", finding()));
  });
});
