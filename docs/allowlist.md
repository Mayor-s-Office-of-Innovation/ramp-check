# The allowlist

The allowlist is the only way to stop a finding from blocking. It is a JSON
file, one per project, and every entry has four required fields:

```json
[
  {
    "rule": "color-contrast-enhanced",
    "target": "p.muted",
    "reason": "Secondary text tokens are being raised to 7:1 in the design system refresh.",
    "expires": "2027-03-31"
  },
  {
    "rule": "infinite-animation",
    "target": "wa-spinner >>> *",
    "reason": "Loading spinner: essential status motion, under review for a static fallback.",
    "expires": "2027-01-15"
  }
]
```

| Field | Meaning |
| --- | --- |
| `rule` | the rule id from the finding: an axe rule id, or one of this tool's (`reduced-motion-ignored`, `infinite-animation`, `view-transition-animates`, `reflow-horizontal-scroll`, and the keyboard rules in [keyboard.md](keyboard.md)) |
| `target` | the finding's target string exactly, or a prefix ending in `*`. Shadow boundaries are written ` >>> `. View transitions are `::view-transition(<names>)`. |
| `reason` | why this is acceptable for now; shows up in reports |
| `expires` | ISO date. On the day after, the entry stops suppressing and the run fails naming it. |
| `check` (optional) | `axe`, `motion`, `reflow`, `keyboard`, `textSpacing`, `consistency`, or `pattern`, when a rule id could be ambiguous |

Point the config at it:

```js
test.use({ a11yConfig: { allowlist: "./a11y-allowlist.json" } });
```

Inline entries work too, for a single spec that needs one exception.

## What a run reports

- Allowlisted findings stay in the JSON attachment, marked with the entry
  that covers them. They are never deleted from the output.
- Live entries that matched nothing are reported as unused, so the file does
  not accumulate stale exceptions.
- Expired entries fail the run with a line naming the rule, target and
  reason. Renew the date with a fresh reason, or remove the entry.

## Why no silent filters

A filter in code is invisible to the next person and never gets revisited. An
allowlist entry is visible in the repo, explains itself, shows up in every
report, and has to be renewed on purpose. Leniency is always visible and
time-boxed.

If a rule is wrong for your whole site (rare), `disableRules: ["rule-id"]`
skips it entirely. Prefer the allowlist; disabling a rule is a decision the
report cannot show.
