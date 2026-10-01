// Used by test/cli.spec.js: seeded defects across checks, plus a cross-page consistency defect.
export default {
  baseURL: "http://127.0.0.1:4173",
  pages: ["/axe-contrast.html", "/reflow-overflow.html", "/consistency-a.html", "/consistency-b.html"],
  policy: "wcag-aaa",
  checks: { keyboard: "off" },
};
