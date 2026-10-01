export default {
  baseURL: "http://127.0.0.1:8080",
  pages: ["/", "/about.html"],
  matrix: { colorScheme: ["light"], reducedMotion: ["reduce"], viewport: ["mobile", "desktop"] },
  policy: "wcag-aaa",
  allowlist: "./a11y-allowlist.json",
  baseline: "./a11y-baseline.json",
};
