# Choosing your conformance level

One setting, named by the standard, decides which findings block and which
only warn. There is no separate "strict" switch.

```js
// Playwright fixtures
test.use({ a11yConfig: { policy: "wcag22-aa" } });

// Direct calls
await runChecks(page, { policy: "wcag22-aa" });
```

| Policy | Blocks | Warns |
| --- | --- | --- |
| `wcag-aaa` (default) | every WCAG 2.2 A, AA and AAA finding, and this tool's own checks | nothing |
| `wcag22-aa` | WCAG 2.2 A and AA | AAA findings, including the motion audit (2.3.3) |
| `wcag21-aa` | WCAG 2.1 A and AA | everything WCAG 2.2 added (2.4.11, 2.5.8, 3.3.8 and friends), and AAA |

## How the decision is made

Every finding carries the success criterion it enforces, the criterion's
level (A, AA, AAA), and the WCAG version that introduced it. A finding blocks
when its level is at or below the policy's level and its version is at or
before the policy's version. Everything else is reported as a warning.

axe rules get their criterion and level from axe's own tags, so a new axe
release that adds rules slots into the right severity without any change
here. axe's best-practice rules have no WCAG level; `bestPractice: "block" |
"warn" | "off"` (default `block`) covers them.

Coverage never changes with the policy. A team at `wcag21-aa` still sees
2.2 and AAA findings; they just do not fail the run.

## Per-check overrides

```js
test.use({
  a11yConfig: {
    policy: "wcag22-aa",
    checks: { motion: "block" }, // keep the motion audit blocking under AA
  },
});
```

Values: `"auto"` (the policy decides), `"block"`, `"warn"`, `"off"`.

## Why AAA by default

A team that starts at the top and consciously steps down knows what it gave
up. A team that starts at the floor rarely climbs.

The practical cost is small. With axe-core 4.13, the `wcag2aaa` tag carries
three rules: `color-contrast-enhanced` (7:1 text contrast, 1.4.6),
`identical-links-same-purpose` (2.4.9), and `meta-refresh-no-exceptions`
(2.2.4 and 3.2.5). There is no 2.1 or 2.2 AAA tag. On top of those, this
tool's motion audit anchors to 2.3.3, an AAA criterion, so it blocks by
default and warns under the AA policies.

W3C's own guidance: "It is not recommended that Level AAA conformance be
required as a general policy for entire sites because it is not possible to
satisfy all Level AAA Success Criteria for some content." Treat the default
as a stretch target you may legitimately lower. The step-down is one line and
this page exists so the choice is documented.

## The legal floor

- The DOJ's ADA Title II rule (28 CFR Part 35, subpart H) requires state and
  local government web content and mobile apps to conform to WCAG 2.1 AA.
  Entities serving 50,000 or more people had until April 24, 2026; smaller
  entities and special district governments have until April 26, 2027.
- Many state and local governments have their own digital accessibility
  standards that name WCAG 2.1 AA and also require manual testing and
  testing with people with disabilities, ongoing and after updates. Check
  yours; this tool covers only the automated part.

So `wcag21-aa` is the floor and should be treated as a temporary landing spot
while a site burns down its 2.2 and AAA warnings.

## The escape hatch

Teams that know axe can pass raw tags. This bypasses the level model, so the
severity of every axe finding still comes from its own tags, but coverage is
whatever you list.

```js
test.use({ a11yConfig: { tags: ["wcag2a", "wcag2aa", "best-practice"] } });
```
