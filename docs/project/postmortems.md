# Postmortems

`docs/postmortems/` holds **one file per bug worth understanding** — not every bug, but every one
whose cause was more interesting than the line that broke. The point is never the incident. It is the
**class**: the shape of mistake that will happen again somewhere else in the tree.

## Naming

The same convention as a planning doc — `yyMMdd<letter>-kebab-description.md`, from
`npx tsx scripts/plan-name.ts --dir=postmortems "<what went wrong>"`. **Name it after the lesson, not
the symptom**: `a-signpost-committed-before-the-thing-it-points-at` is findable a month later and
`toc-bug` is not.

## What one has to say

Five things, and a postmortem missing any of them is not finished
([AGENTS.md § Before you call it finished](../../AGENTS.md#before-you-call-it-finished)):

1. **The real root cause** — not the line that broke.
2. **The class it belongs to, named.** Give it a name somebody can use in a sentence.
3. **Which commit introduced it.**
4. **The fix that is right for the long term**, which is often not the one that was shipped.
5. **What would have caught the whole class** — ranked by ease and value where there is more than one.

## A few principles

- **Root-cause it in a subagent**, so the digging stays out of the main context and the write-up is
  what comes back.
- **Reproduce it with a failing test before you fix it.** A test that was never red proves nothing.
- **The commonest class here is [silent success](../reusable/silent-success.md)** — something
  reporting success while doing nothing, with the obvious check agreeing because it shares an
  assumption with the code. If you are hunting for a pattern worth fixing, start there.
- **No blame, and no softening either.** Several of these describe a check that was written, read and
  believed, and still did nothing. That is the useful part.

## See also

- [plans.md](plans.md) — where the fix gets planned.
- [debugging.md](debugging.md) — start there when something is broken now.
- [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) — prose cannot fail,
  so nobody checks it.

---

Up: [vision.md](vision.md)
