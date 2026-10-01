# Releasing

Maintainer checklist. Every step is manual on purpose.

1. `npm run typecheck && npm test`
2. `npm run smoke` packs the tarball, installs it into a copy of the example
   site as a real dependency, runs the bin, and checks the documented
   findings appear.
3. Update `CHANGELOG.md`: move "Unreleased" into a version heading.
4. Bump `version` in `package.json`.
5. Commit, tag `vX.Y.Z`, push the tag. The Release workflow re-runs the
   tests, checks the tag matches the version, and publishes with provenance.
   Publishing needs either npm trusted publishing configured for this repo
   on npmjs.com, or an automation token in the `NPM_TOKEN` secret.
6. Verify: `npx ramp-check@X.Y.Z --help` from an empty directory.
7. Pin the Action references in `action/README.md`, the README, and the
   example workflow from `@main` to the tag once `v1` exists.

Before 1.0.0, two things the plan requires:

- The GitHub Action has run on a real pull request and the comment appeared
  and updated in place.
- Someone other than the author has taken a fresh static site to a green CI
  run in under ten minutes following only the README.
