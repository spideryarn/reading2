# Postmortems

`docs/postmortems/` holds **one file per bug worth understanding** — not every bug, but every one
whose cause was more interesting than the line that broke. The point is never the incident. It is the
**class**: the shape of mistake that will happen again somewhere else in the tree.

**How to write one is [write-postmortem.md](../reusable/write-postmortem.md)** — the five things one
has to say, the structure, and how to find the class rather than the symptom. This doc is only what
is true here in particular.

## Naming

`yyMMdd<letter>-kebab-description.md`, from
`npx tsx scripts/plan-name.ts --dir=postmortems "<what went wrong>"`. Its own letter sequence, so
`260906a` can legitimately exist here and in `docs/plans/` both.

## What is true here in particular

- **The commonest class in this directory is [silent success](../reusable/silent-success.md)** —
  something reporting success while doing nothing, with the obvious check agreeing because it shares
  an assumption with the code. If you are hunting for a pattern worth fixing, start there. Roughly a
  third of the 86 files here are that shape
  ([260906a](../postmortems/260906a-a-red-first-test-defends-the-change-not-the-code.md#and-it-is-the-most-common-shape-in-this-directory),
  counted 2026-09-06).
- **Root-cause it in a subagent**, so the digging stays out of the main context and the write-up is
  what comes back.
- **A rule that comes out of one moves into the `docs/project/` doc that owns it**, and links back.
  The postmortem keeps the incident and the reasoning; the doc keeps the rule.

## See also

- [plans.md](plans.md) — where the fix gets planned.
- [debugging.md](debugging.md) — start there when something is broken now.
- [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) — prose cannot fail,
  so nobody checks it.

---

Up: [vision.md](vision.md)
