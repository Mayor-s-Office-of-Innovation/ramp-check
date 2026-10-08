# Example: a static site with no test harness

Two HTML pages, one config, one command. Shows the no-spec adoption path.

```sh
npm install
npx playwright install chromium
npm run serve &      # serves ./site on http://127.0.0.1:8080
npm run a11y
```

The run fails on purpose: `about.html` has low-contrast paragraphs (one that
passes AA but fails AAA, one that fails both). Fix them, or run
`npm run a11y:baseline` to see how a site adopts with existing debt, then
`npm run a11y` again.

`ramp-check.config.js` is the whole configuration. The GitHub workflow in
`.github/workflows/a11y.yml` runs the same thing on every pull request.
