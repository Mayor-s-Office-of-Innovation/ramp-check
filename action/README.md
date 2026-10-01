# ramp-check GitHub Action

Runs `ramp-check` against a site in CI, writes the Markdown report to the job
summary, uploads the JSON report as an artifact, and posts (or updates) one
pull-request comment with the results.

## Usage

The site must be reachable from the runner: either start it in an earlier
step, or pass a preview deployment URL as `base-url`.

```yaml
name: Accessibility
on: pull_request

permissions:
  contents: read
  pull-requests: write   # for the PR comment; drop it and set comment: "false" otherwise

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: (npm run serve &) && sleep 2          # or point base-url at a preview deployment
      - uses: Mayor-s-Office-of-Innovation/ramp-check/action@main
        with:
          config: ramp-check.config.js
```

With a preview deployment:

```yaml
      - uses: Mayor-s-Office-of-Innovation/ramp-check/action@main
        with:
          base-url: ${{ steps.deploy.outputs.url }}
```

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `config` | `ramp-check.config.js` | Config path, relative to `working-directory`. |
| `base-url` | | Override the config's `baseURL`. |
| `policy` | | Override the config's policy. |
| `working-directory` | `.` | Where `package.json` and the config live. |
| `version` | `latest` | ramp-check version to install if the repo does not already depend on it. |
| `comment` | `"true"` | Post or update a PR comment. Needs `pull-requests: write`. |
| `artifact-name` | `ramp-check-report` | Name of the uploaded report. |
| `node-version` | `22` | Node.js version. |

## Outputs

| Output | Meaning |
| --- | --- |
| `exit-code` | 0 clean, 1 findings or expired exceptions, 2 config error. |
| `report-dir` | Directory with `ramp-check.json` and `ramp-check.md`. |

## What happens

1. Node is set up and dependencies installed. If the repo does not depend on
   `ramp-check`, the requested version is installed for the run. Chromium is
   installed with its system dependencies.
2. `npx ramp-check` runs. The Markdown report is appended to the job summary.
3. The report directory is uploaded as an artifact, pass or fail.
4. On pull requests, the Markdown report is posted as a comment. A later run
   updates the same comment rather than adding another; the report starts
   with an HTML marker the action looks for.
5. The job fails if the exit code was not zero.

## Adopting with existing findings

Run `npx ramp-check baseline` locally, commit `a11y-baseline.json`, and the
action fails only on new findings. See [docs/baseline.md](../docs/baseline.md).

## Pinning

`@main` tracks the development branch. Once releases are tagged, pin to a tag
(`@v1`) or a commit SHA.
