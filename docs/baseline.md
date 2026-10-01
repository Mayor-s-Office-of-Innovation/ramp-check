# The baseline workflow

The baseline is how a site with existing accessibility debt starts gating
today: adopt, never get worse, burn down.

## Writing it

```sh
npx ramp-check baseline
```

Every finding that would currently fail is recorded in the file named by
`baseline` in the config (the scaffold uses `a11y-baseline.json`). Each
entry is keyed by page, matrix cell, check, rule and target, and carries the
date it was added and the date it expires, 180 days later by default
(`baselineExpiryDays`). Commit the file.

## Running against it

`npx ramp-check` fails only on findings that are not in the baseline. The
report says how many baselined findings remain, how many expire within 30
days, and how many have been fixed since the baseline was written.

## Expiry

An expired entry stops suppressing and fails the run by name, exactly like an
expired allowlist entry. The team then either fixes the finding or rewrites
the baseline with `npx ramp-check baseline`, which keeps the original `added`
date on entries that survive and gives a fresh expiry only to entries that
are new. A rewrite is a conscious act that shows up in the diff.

## Rewriting

Rewrite the baseline when:

- Findings were fixed. Their entries are dropped; the report calls them
  "fixed since the baseline was written" until you do.
- A new axe release added rules and the new findings are not the team's
  immediate priority. The baseline absorbs the churn.

Do not rewrite the baseline to hide a regression. The pull-request diff of
`a11y-baseline.json` is the review point: new entries mean new debt.

## Baseline or allowlist?

| | Allowlist | Baseline |
| --- | --- | --- |
| Meaning | "this is acceptable, here is why" | "this is a known problem we have not fixed yet" |
| Written by | a person, with a reason | the tool |
| Expires | per entry, chosen | 180 days from when the entry appeared |
| Scope | any page, by rule and target | one page state, by rule and target |

Findings that are genuinely acceptable belong in the allowlist with a
reason. Everything else that blocks adoption goes in the baseline and is
expected to shrink.
