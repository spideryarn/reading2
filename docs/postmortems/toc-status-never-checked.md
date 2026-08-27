# The publish guard that read the hash and never the status

**2026-08-27.** Found by GPT Sol, reviewing [delete-the-importer.md](../plans/delete-the-importer.md),
not by hand and not by any test that existed before this fix. Fixed the same day in `e18ac5f`.

## What the code did

`publishRevision` in [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) is the last check
before a draft revision becomes the article a reader sees. One of its jobs is to prove the table of
contents was built from *these* blocks, not an earlier draft's. Before the fix it did this:

```ts
const runs = await tx.select().from(revisionStepRuns)
  .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, "toc")));
const toc = runs[0];
if (!toc) {
  reasons.push("there is no record of the toc step running, so nothing can say the tree describes these blocks");
} else if (toc.inputHash !== blocksHash) {
  reasons.push(`the tree was built from different blocks … — re-run toc`);
}
```

It never read `toc.status`. `revision_step_runs.status` is one of `running`, `done` or `error`
([`src/db/schema.ts:417-419`](../../src/db/schema.ts)), and a step writes its row — including
`input_hash` — **when it starts**, not when it finishes. So a `toc` run that crashed halfway through,
or one still going right now in another process, leaves a row whose hash matches the blocks exactly,
because nothing has touched the blocks since. The one case the hash check exists to catch — a stale
tree — was the only case it could ever refuse. The two cases it was silently waving through — a
broken tree and a tree still being built — passed with the same row that a healthy run would have
left.

Reproduced in [`tests/store-publish-guards.test.ts`](../../tests/store-publish-guards.test.ts):
insert a `toc` row with `status: "error"` and a correct `input_hash`, call `publishRevision`, and
before the fix it went through, exactly as if the run had succeeded.

## Root cause

Two different questions were being answered by one comparison. "Is the tree *current*" (does this row
describe the blocks in front of us) and "did the step *succeed*" (is this row's output trustworthy at
all) are separate, and the hash only answers the first one — it says nothing about whether the run
that produced it finished, or finished well. The code treated a `toc` row's mere presence-with-a-
matching-hash as proof of both.

**This was not a case of the column not existing yet.** `revision_step_runs.status` was in
`src/db/schema.ts` from the very first commit that created it,
[`bf96f6c`](../../src/db/schema.ts), 2026-08-25, a day before `publishRevision` was written. The
`in ('running', 'done', 'error')` check constraint was there the whole time. Nobody had to add a
column to fix this; they had to add a read of one that already existed.

**Introducing commit: [`2ae372c`](../../src/store/pg-revisions.ts)**, "Put two migrations back in
git, which the journal already said were there," 2026-08-26 20:41. Its message says the 870-line
`pg-revisions.ts` it added — `beginRevision`, `publishRevision`, `failRevision`, all of it — was
"written this evening, orphaned when the session that wrote it stopped mid-flight," and simply
committed hours later once the missing migrations were found and restored alongside it. The guard's
shape, hash-only, was already fixed by the time this commit landed; `git log -S` on `toc` in this
file shows exactly two hits, `2ae372c` and the fix, `e18ac5f` — nothing touched the check in between.

**The near miss, in the file next door.** Forty-six minutes before `2ae372c` was committed,
[`f31ad63`](../../src/store/pg.ts) ("Tell the model who is reading, and let it change only the
emphasis," 2026-08-26 19:54) landed the *correct* version of this same idea, in the same codebase, in
`articleMetadata`'s `isCurrent` check:

```ts
// src/store/pg.ts:659
done: run?.status === "done" && isCurrent(step),
```

That line has its own doc comment right above it
([`src/store/pg.ts:553-567`](../../src/store/pg.ts)) describing the *mirror-image* bug this function
used to have: it used to be `status === 'done'` and nothing else, which is present-but-possibly-stale
rather than current-but-possibly-broken — the same two questions, conflated the other way round, and
already caught once here before this postmortem existed. The fix that commit made was to require
**both** — status done *and* hash current — and the doc comment even says, of the `toc` case
specifically:

> `toc` is checked the way `publishRevision` checks it, so the metadata page and the publication
> guard cannot disagree.

That sentence was written 46 minutes before `publishRevision`'s version of the check was committed,
and it was never true of the status half. Both places check the hash the same way. Only one of them
checked status. The comment asserts a parity that nothing enforced — not a shared function, not a
test that runs both and compares — so it stayed plausible right up until GPT Sol read the code instead
of the comment. Whether the `toc` branch in `pg-revisions.ts` was actually written before or after
those 46 minutes isn't recoverable — `2ae372c`'s own message says the file was orphaned mid-session
and committed later by whoever found the missing migrations — but the order it landed in git is not
the point. The point is that the right pattern already existed in this codebase, spelled out in a
comment that name-checked the very function that lacked it, and nothing made the two agree.

## What would have caught the whole class

Grepping every reader of `revision_step_runs` for the `toc` row turns up exactly two, before the fix:

- [`src/store/pg.ts:614-617`](../../src/store/pg.ts) (`isCurrent`, called from `articleMetadata`) —
  checks the hash, and is combined with `run?.status === "done"` by its one caller at
  [`src/store/pg.ts:659`](../../src/store/pg.ts). Correct.
- [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) (`publishRevision`, now
  `reasonsNotToPublish`) — checked the hash, never combined it with status. Wrong, until `e18ac5f`.

Two call sites, one correct and one not, both reading the same row for the same purpose, phrased in
two different pieces of code that never called each other and had nothing to cross-check them. That
is the general shape worth naming: **when "is this row good" is answered by an inline expression at
each call site rather than one function both sites call, the question can be answered two different
ways and nothing will say so.** A single `isTocCurrent(run, blocksHash)` — status and hash together,
one place — would have made `pg-revisions.ts` either call it and get the status check for free, or
visibly *not* call it, which is a much easier thing for a reviewer or a future GPT Sol to notice than
a missing `else if` three lines from a hash comparison that looks complete on its own.

The pipeline's own abstraction for this already gets the split right and is worth pointing at as the
model to follow. [`stepIsDone`](../../src/pipeline.ts) (`src/pipeline.ts:497-510`) asks
`store.interrupted()` — the liveness question — before it ever asks about a stamp — the currency
question — and never conflates them. `ArtifactStore.interrupted`
([`src/store/artifacts.ts:327`](../../src/store/artifacts.ts)) is implemented for the filesystem in
[`src/store/artifacts-fs.ts:525`](../../src/store/artifacts-fs.ts). There is no Postgres
implementation of `ArtifactStore` yet — `pg.ts` and `pg-revisions.ts` answer the same questions by
hand, against `revision_step_runs` directly, rather than through that interface — which is exactly how
two independent, differently-complete answers to "is this row good" were free to exist side by side.
The querying-of-`revision_step_runs`-directly readers checked, so this list is complete as of this
writing: `src/store/import.ts` only *writes* the table (always with `status: "done"`, marked
`implementation_version: "imported"` so a real run can supersede it), and no other file in `src/`
reads `inputHash` off a `revisionStepRuns` row.

## The fix, and the one still to land

`e18ac5f` adds the status branch **before** the hash branch, not beside it, and says why in the code:
once a run has errored or is still going, its hash cannot mean anything, and "the tree was built from
different blocks — re-run toc" would send someone to re-run the very thing that just told them it
failed. The guards were pulled out of the transaction callback into `reasonsNotToPublish`
(`src/store/pg-revisions.ts:829`) — not tidying on its own; the callback was already over the
cognitive-complexity limit before this change and further over it after, and the plan below already
needs a second guard added to the same place.

[delete-the-importer.md § The publication gate, as a truth table](../plans/delete-the-importer.md)
proposes exactly the shape this bug was in — a `fetch` step run and a raw-source reference, checked by
presence and a lineage rule — as the next guard in `reasonsNotToPublish`. That plan calls this bug out
by name as "the same hole," found in passing while writing the truth table for the new one, and fixes
this one first and on its own so the new guard is not built on top of it. Whoever writes that guard
should also decide whether `isTocCurrent`-style extraction is worth doing now that there are two
guards of the same shape in the one function, rather than leaving the parity between `pg.ts` and
`pg-revisions.ts` to a comment again.

## See also

- [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) — `reasonsNotToPublish` and
  `publishRevision`
- [`src/store/pg.ts`](../../src/store/pg.ts) — `articleMetadata`, the correct version of the same
  check, and the doc comment describing its own earlier, mirror-image bug
- [`tests/store-publish-guards.test.ts`](../../tests/store-publish-guards.test.ts) — the guard's test
  suite, written first and watched red before the fix
- [delete-the-importer.md](../plans/delete-the-importer.md) — the plan whose review found this, and
  where the next guard of the same shape goes
- [silent-success.md](../reusable/silent-success.md) — the check that shares an assumption with the
  code it's checking is not a check
