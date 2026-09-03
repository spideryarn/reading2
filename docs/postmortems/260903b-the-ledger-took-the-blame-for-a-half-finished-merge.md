# The ledger took the blame for a half-finished merge

**2026-09-02 into 2026-09-03.** For several hours `npm run db:migrate` could not run in the shared
primary checkout, `spideryarn.ai_calls` stayed behind [`src/db/schema.ts`](../../src/db/schema.ts),
and **every paid model call anybody made on this box was recorded nowhere**. A cost eval spent
$0.0333 into a ledger that kept neither row.

The outage was cheap and the fix was one file. **The hour went on the diagnosis, and that is what
this write-up is about.**

## What actually happened

Somebody's merge stopped half-way and left conflict markers inside
[`drizzle/meta/_journal.json`](../../drizzle/meta/_journal.json). Every migration command in the
repo reads that file through `readJournal`, so all of them went blind at once, and what the reader
saw was:

```
SyntaxError: Expected ',' or '}' after property value in JSON at position 8151
```

A byte offset. Nothing about a merge, nothing about which file, nothing to act on.

Earlier, with the journal partly written, the same blockage wore a much more convincing costume:
`db:migrate` reported **three ledger rows belonging to no migration** and **two migrations that can
never be applied**. That is a real and frightening failure mode here — see
[database.md § A watermark is not a ledger](../project/database.md#a-watermark-is-not-a-ledger) —
and it sent the investigation into the ledger, which had been correct the entire time.

Clearing it took sha256ing **every `.sql` file across the main tree and all seven worktrees** and
matching each hash to each ledger row. All three "orphans" were real migrations
(`0052_per_article_job_queue`, `20260902161529_feedback_body_and_kind`,
`20260902161553_feedback_one_body`). That hour was not wasted — a wrong attribution here sends
somebody to delete the *right* ledger row — but it was spent answering a question that was never
the question.

## The root cause, and the class

The root cause is not the merge. Merges get interrupted; agents share this tree and are told to
expect exactly that. The root cause is that **`_journal.json` is uniquely exposed to this, and its
reader reported the damage in the parser's vocabulary rather than the reader's.**

Uniquely exposed, for two compounding reasons:

- **Nearly every change appends to the same last entry**, so this file conflicts more often than
  anything else in the repo.
- **Nothing but tooling ever opens it.** Markers in a `.ts` file are seen within minutes, by the
  editor and by the next person to read the function. Markers here sit unseen until a command dies.

The class: **a machine-read file that a human merge can corrupt, whose reader diagnoses the
corruption in its own terms instead of the reader's.** The tell is a low-level error — a parse
error, a byte offset, a schema mismatch — surfacing from a file no human reads, at a moment when a
merge has recently happened. Anywhere that shape exists, the first command should name the merge.

It is the same family as [silent-success.md](../reusable/silent-success.md), inverted: not a check
that passes while doing nothing, but a check that fails while pointing somewhere else. Both cost the
same thing, which is trust in what the tool says.

## Which commit introduced it

None, and that is worth stating plainly. `readJournal` has never checked for markers, so the gap is
as old as the file. What changed on 2026-09-02 was the traffic: several agents in one tree, all
appending journal entries, which turned a latent gap into an hourly hazard. **A bug can arrive
without a commit, by the surrounding conditions changing.**

## The fix, and why it is the right one long-term

`readJournal` refuses a journal containing a conflict marker and names the file, the line and the
marker in its first line — [`scripts/migration-ledger.ts`](../../scripts/migration-ledger.ts).

Three details are load-bearing, and all three came from the GPT Sol review rather than from the
first draft:

- **It points at [database.md § Repairing a fork](../project/database.md#repairing-a-fork-what-the-losing-migration-is-decides-everything)
  instead of restating the repair.** The first draft invented its own advice — "keep both sides,
  renumber `idx`" — which contradicted that runbook and was dangerous: git presents *ours* then
  *theirs*, not chronologically, so concatenating both sides can put `when: 300` above `when: 200`,
  and drizzle then skips the lower one **silently and for ever**. A guard that talks somebody into
  the repo's worst failure mode is worse than no guard.
- **It says that resolving the journal is not resolving the fork.** Git conflicts here because both
  sides appended a line; it says nothing about the snapshots, because each side wrote a *new* file
  and git merges two new files without a word. The visible half is the half that does not matter.
  So the message ends by sending the reader to `npm run db:chain`.
- **It reads real lines rather than regexing the file**, accepts markers longer than the default
  seven and diff3's `|||||||`. `conflict-marker-size` is configurable, and JSON permits a raw U+2028
  inside a string while JavaScript counts it as a line break — so a regex over the whole text could
  have called a legitimate `tag` a conflict.

[`scripts/db-generate.ts`](../../scripts/db-generate.ts) was also swallowing the diagnostic whole:
its `readFolder` caught *every* `readJournal` failure as the legitimate no-journal-yet state. Now
narrowed to `ENOENT`, with a test pinning that a missing journal really does report `ENOENT`,
because that narrowing is only sound while it does.

## What would have caught it

Ranked by value over effort.

1. **The guard above** — cheap, and it converts an hour into one line of output. Done.
2. **`npm run db:chain` after any merge that touches `drizzle/`.** Already written down in
   *Repairing a fork*, already the rule, and it would have caught the snapshot fork this same merge
   produced. It is not enforced by anything, which is the honest gap left here.
3. **A pre-commit or CI check for conflict markers in any tracked file.** `git diff --check` already
   does this for whitespace and markers in a diff; nothing runs it repo-wide. It would catch this
   class everywhere rather than in one file — the widest fix, and the one not yet done.

## The receipts

- The four new marker cases were **watched red against the old regex** before being called done.
- The first "leads with the marker" assertion was **vacuous** — it passed automatically whenever the
  message lacked the literal word `position` — and now asserts on the first line.
- The test fixture built its markers by hand and so **tripped `git diff --check` inside the very
  test file that guards against markers**. It builds them with `repeat()` now.
- `tests/migration-journal.test.ts`; the review is
  [260902g-…-journal-guard-review-sol.md](../plans/260902g-estimate-article-ingestion-and-mode-generation-costs-journal-guard-review-sol.md).
