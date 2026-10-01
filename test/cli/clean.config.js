// Used by test/cli.spec.js: pages that pass everything, including the motion cell.
export default {
  baseURL: "http://127.0.0.1:4173",
  pages: ["/clean.html", { path: "/motion-guarded.html", name: "guarded motion" }],
  matrix: { reducedMotion: ["reduce"] },
  policy: "wcag-aaa",
};
