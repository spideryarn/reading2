# A signpost committed before the thing it points at

`dev` went red on [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) for about thirteen
minutes on 2026-09-06, and the interesting part is not that it did. It is that **the same defect
happened twice in the same hour, and only one of the two was visible to anything.**

## What happened

`4a402663` added a line to [architecture.md](../project/architecture.md) pointing at
`docs/tutorials/architecture.html`. The tutorial itself landed in `1ae2e710`, thirteen minutes
later, because it was still going through a browser check on its diagrams. In between, the link
resolved to nothing:

```
FAIL  tests/doc-links.test.ts > documentation links > point at files that exist
  + "docs/project/architecture.md → ../tutorials/architecture.html"
```

Found by another session, which pulled `dev` and ran the suite. Closed by pushing the tutorial.

**This is explicitly tolerated here** and the write-up is not an argument against it —
[AGENTS.md](../../AGENTS.md) says a migration that lands before the code matching it *"and breaks
production for the minutes in between, is fine"*, and this was a doc link on the trunk rather than
production. It is worth a file for what it exposed rather than for what it cost.

## The class, named

**A reference committed before its referent.** Two halves of one change, split across two commits
because they lived in different directories and one half was ready first. Under time pressure — a
peer session was blocked waiting on the other files in that commit — the ready half went out alone.

The root cause is not forgetfulness. It is that **a reference is not finished when it is written; it
is finished when its target exists**, and nothing in the commit recipe encodes that. The two files
looked like two changes because they were in `docs/project/` and `docs/tutorials/`.

## What makes it worth writing down

The identical defect occurred twice within the hour, in opposite directions of visibility:

| The reference | The referent | What happened |
|---|---|---|
| `docs/project/architecture.md` → the tutorial | committed 13 min later | **Red.** `docs/**/*.md` is in `DOC_FILES`, so the gate saw it |
| `README.md` → the tutorial (another session) | the same file, same gap | **Nothing.** The root `README.md` is not in `DOC_FILES`, so the link was quietly unresolvable and no check anywhere had an opinion |

Same class, same target, same hour. One was caught within a test run; the other was caught only
because a person read it and thought to check. That asymmetry is the finding —
[silent-success.md](../reusable/silent-success.md) is the shape of it, and here the silence was not
in the code but in **what the check was pointed at.**

`DOC_FILES` in `tests/doc-links.test.ts` covers `docs/**/*.md`, `AGENTS.md` and
`infra/hetzner/README.md`. The two most-read files in a repo about to be public — the root
`README.md` and `CONTRIBUTING.md` — were in none of them.

## The fix that is right for the long term

**Put the root files in the link-checking set.** Taken by the tidy-the-repo-root session, with
`README.md` and `CONTRIBUTING.md` added to `DOC_FILES`, each proved by deliberately breaking a link
and watching it go red first. Note that the file holds a **second** list further down, keyed on
`docs/project/**`, which enforces the one-parent doc-ownership rule — the root files must stay out
of that one, having no entry-point doc above them.

That does not prevent the class. It converts the silent half into the loud half, which is the whole
of what was wrong.

## What would have caught it, ranked by ease against value

1. **`DOC_FILES` covering the root files** — one edit, and it turns an invisible failure into a
   thirteen-minute one. Being done.
2. **Commit a reference and its referent in one commit**, and when they genuinely cannot go
   together, push the *referent* first. A link is cheap to add later; a dangling one is a gate
   nobody can distinguish from a real break. Costs nothing and would have prevented both instances.
3. A pre-push hook running the link check — rejected. The suite already covers this in seconds once
   (1) is done, and the gap was never that the check did not run.

## The thing I would tell myself

Both halves of this were mine to see. I split the commit because the tutorial was still being
checked and a peer was waiting on the rest — a real reason, and still the wrong call, because
**the signpost had no value at all until the file existed** and holding it back would have cost
nothing. When a change is a pointer and a target, the pointer is the part with no independent
value, and it is therefore the part that waits.
