# Code review: Recall takes Tutorial in

Commit reviewed: `5d5d9da91`, against its parent.

## Findings

### F1 — High — the dual-thread fold can silently delete a title the reader wrote

**Evidence.** A thread title is initially derived, but `renamed_at` records an explicit reader rename
([`src/db/schema.ts:4433`](../../src/db/schema.ts#L4433),
[`src/db/schema.ts:4439`](../../src/db/schema.ts#L4439)). For an article with both threads, the
migration changes only the kept Recall row's clock and gist, then deletes the Tutorial row
([`drizzle/20261020063618_fold_tutorial_into_recall.sql:120`](../../drizzle/20261020063618_fold_tutorial_into_recall.sql#L120),
[`drizzle/20261020063618_fold_tutorial_into_recall.sql:145`](../../drizzle/20261020063618_fold_tutorial_into_recall.sql#L145)).
That discards the Tutorial row's `title` and `renamed_at`, even when the title was typed by the
reader. The fixture-file fold makes the same keeper choice
([`src/chat.ts:125`](../../src/chat.ts#L125)). The migration test currently blesses “everything
else is the keeper's” ([`tests/tutorial-fold-migration.test.ts:276`](../../tests/tutorial-fold-migration.test.ts#L276)),
while the plan says nothing a reader wrote is deleted.

**Changed.** Not changed. If both titles were renamed, choosing Recall's, Tutorial's, or the most
recent is a product decision. The safe mechanical alternative is to make the migration refuse a
fold whose discarded Tutorial row has `renamed_at IS NOT NULL`, as it already refuses an in-flight
answer or a mention, then inspect the one known dual-thread article. This should be resolved before
the migration runs.

### F2 — Medium — the merged prompt both permits and forbids a reply with no question

**Evidence.** The stuck-reader rule permits filling the gap and ending with “none”
([`src/converse.ts:1174`](../../src/converse.ts#L1174)); the hint rule also names “a direct answer
with no question” ([`src/converse.ts:1152`](../../src/converse.ts#L1152)). Later, LENGTH requires exactly one interrogative sentence in every reply
([`src/converse.ts:1241`](../../src/converse.ts#L1241)). The eval specifically treats `lost`,
`justTellMe`, and `nudgeFailed` as cases that must be answered rather than met with another riddle
([`evals/learn-recall.ts:424`](../../evals/learn-recall.ts#L424)). The model cannot obey both prompt
rules on a no-question turn.

**Changed.** Not changed: this is prompt wording with a real behaviour choice, so I am reporting it
as requested. Either LENGTH should say “at most one” and explain when zero is right, or the earlier
“or none”/“no question” permissions should be removed.

### F3 — Medium — fixed: novel application was offered, then excluded by a hard limit

**Evidence.** The task ladder allows applying the article to a case it does not discuss and the
passage rule explains how to cite the starting point, but the hard limit said the *only two*
questions not answered by the article were the unread opener and the reader's own view. That left
the plan review's F2 internally contradictory.

**Changed.** `LEARN_SYSTEM` now names novel application as the third allowed question beyond the
article's claims ([`src/converse.ts:1097`](../../src/converse.ts#L1097)). A red-first regression test
pins the exception in the hard-limit section
([`tests/learn-prompt.test.ts:258`](../../tests/learn-prompt.test.ts#L258)), and the plan and Learn doc
now correctly list four no-hint cases.

### F4 — Medium — fixed: the no-gimmes rule also forbade the intended say-it-back

**Evidence.** The prompt reserves a say-it-back for an unread reader immediately after teaching a
small passage, but “a question whose answer is in the sentence you just wrote teaches nothing”
forbade exactly that task. This was the deliberate-paraphrase exception requested by the plan
review's F3, but it had not been stated.

**Changed.** The no-gimmes paragraph now states the narrow exception
([`src/converse.ts:1088`](../../src/converse.ts#L1088)), with a red-first regression test
([`tests/learn-prompt.test.ts:264`](../../tests/learn-prompt.test.ts#L264)).

### F5 — Low — the reading-view entry point still makes the old anti-avoidance claim

**Evidence.** The entry point calls Learn “the one mode that cannot be used to avoid reading”
([`docs/project/reading-view-overview.md:259`](../project/reading-view-overview.md)), but merged
Recall explicitly welcomes a reader who has not read the piece and starts from zero. `learn-mode.md`
already says the old structural guarantee is gone.

**Changed.** Not changed. `reading-view-overview.md` is one of the seven important entry points, and
CLAUDE.md requires an approved before/after set for changing rule-doc wording. The stale clause
should be replaced with wording that says Recall can start an unread reader from zero while sending
them into each cited passage.

### F6 — Low — fixed: F8's promised duplicate-message failure had no test

**Evidence.** The migration deliberately relies on the primary key to refuse the same message id in
both threads, but the real-database test matrix covered pending answers and mentions only. Thus that
part of plan-review F8 was asserted in a SQL comment but not demonstrated.

**Changed.** Added a rollback test that seeds a valid cross-thread duplicate id, expects the fold to
fail, and compares the whole snapshot before and after
([`tests/tutorial-fold-migration.test.ts:363`](../../tests/tutorial-fold-migration.test.ts#L363)).
The sandbox could not connect to the private Postgres lane, so this new database test still needs a
run where local Postgres is reachable.

### F7 — Low — fixed: nearby names and documentation still described the pre-merge shape

**Evidence.** The Learn doc and plan counted three no-hint cases although novel application was also
no-hint; the retired-kind comment named a nonexistent `foldRetiredThreads`; and the three-chip CSS
test still called its matcher `FOUR`.

**Changed.** Corrected the no-hint list
([`docs/project/learn-mode.md:598`](../project/learn-mode.md)), the function reference
([`src/types.ts:4413`](../../src/types.ts#L4413)), and the test matcher name
([`tests/learn-submode-four-chips.test.ts:15`](../../tests/learn-submode-four-chips.test.ts#L15)).

## Plan-review checklist

The earlier review's F1 and F4–F11 are implemented: mention-bearing messages refuse the SQL fold;
`chat.json` folds both threads; cached API bodies prefer Recall; old and remembered
`?learn=tutorial` addresses lift while preserving the rest of the address; only typed command search
keeps the Tutorial alias and the command live-door was not changed; keeper clock/gist behaviour and
the migration failure matrix are pinned; the permanent request alias reaches the normal 409 check
while retry/edit bodies carry no kind; the 20,000-character Learn cap includes the old wire alias;
the UI/evals use three chips and the merged prompt; and the plan gives the product reason for keeping
Recall's name. The earlier review's F2 and F3 were only partly implemented in the commit and are the
fixed F3/F4 above. F7 was deliberately declined in the amended plan because production held no
stored command token; the security live-door remains exact.

## Verification

- Red-first prompt run: 28 passed, 2 failed; after the fixes, the database-free relevant set passed:
  8 files, 136 tests.
- Documentation links passed: 18 tests.
- Full typecheck script: four projects passed; all 3,863 TypeScript source files were covered. The
  literal `npm run typecheck` wrapper could not create `tsx`'s IPC socket in this sandbox, so the
  same script was run as `node --import tsx scripts/typecheck.ts`.
- `tests/tutorial-fold-migration.test.ts` and the private route lane could not run because this
  sandbox is denied access to local Postgres (`EPERM 127.0.0.1:54362`).
- Biome reported only the existing informational complexity warning on `converse`.

**Verdict: revise before merge — resolve F1's reader-owned title loss and F2's prompt contradiction; the compatibility, router, wire-alias, length-cap, three-chip, and remaining plan-review work otherwise holds.**
