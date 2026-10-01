// @ts-check
import { test, expect } from "@playwright/test";
import { siteConsistency } from "../src/index.js";

test.describe("site consistency", () => {
  test("duplicate titles and a navigation outlier, within a cell", () => {
    const findings = siteConsistency([
      { path: "/", cell: "light", title: "Home", nav: "- link Home\n- link Services" },
      { path: "/services", cell: "light", title: "Services", nav: "- link Home\n- link Services" },
      { path: "/contact", cell: "light", title: "Services", nav: "- link Home\n- link Contact" },
      { path: "/", cell: "dark", title: "Home", nav: "- link Home\n- link Services" },
    ]);
    expect(findings.map((f) => `${f.rule} ${f.target}`).sort()).toEqual([
      "duplicate-page-title /contact",
      "duplicate-page-title /services",
      "inconsistent-navigation /contact",
    ]);
    expect(findings.find((f) => f.rule === "duplicate-page-title")?.wcag).toEqual({ criterion: "2.4.2", level: "A", version: "2.0" });
    expect(findings.find((f) => f.rule === "inconsistent-navigation")?.wcag).toEqual({ criterion: "3.2.3", level: "AA", version: "2.0" });
  });

  test("pages without navigation are left out of the comparison", () => {
    expect(siteConsistency([
      { path: "/a", cell: "", title: "A", nav: null },
      { path: "/b", cell: "", title: "B", nav: "- link Home" },
    ])).toEqual([]);
  });
});
