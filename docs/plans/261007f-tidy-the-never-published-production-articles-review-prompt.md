# Review (read-only): a production delete, before it runs

Read-only. Do not change any file; your reply is the review. **This plan, if approved, deletes rows
from the one production database, which holds real readers' data. It cannot be undone except from
the backup the plan describes. Review it at that standard.**

**The plan:** `docs/plans/261007f-tidy-the-never-published-production-articles.md` at commit
`f81253134` on branch `worktree-sweep7-never-published-tidy`. **The script:**
`scripts/never-published-tidy.ts`; its test `tests/never-published-tidy.test.ts`; its lane entry in
`tests/store-migration-registry.ts`. The precedent it is modelled on:
`scripts/draft-sweep-backlog.ts` and `docs/plans/261005j-draft-sweep-deletes-and-the-count-mode-goes.md`.
The store path it calls: `pgShelfStore.destroy` in `src/store/pg-shelf.ts`, under `runAsOwner`.
The schema: `src/db/schema.ts`, and `drizzle/` for every `ON DELETE` and trigger.

**Whose decision.** The product owner said "yes, tidy them" (2026-10-07, relayed by the Overseer),
to a recommendation of "its own small plan with those safeguards". The eligibility rule, the
threshold, the mechanism and the backup are the orchestrator's and the builder's choices, not his.

**What the plan claims (verify, do not trust):** 13 of 62 production articles never had a published
revision; the rule (never published, no job of any status, no reservation, nothing attached updated
in 7 days, no reader state) admits 12 today and the 13th from 2026-10-08 18:31 UTC; nothing a reader
can reach points at them (no route reuses a never-published row once its failed job is trimmed);
the delete cascades to 9,303 block identities and 196 PDF-chunk checkpoints, sets 332 `ai_calls`
rows' `article_id` to null (the ledger is kept), leaves 6 `uploads` rows pointing at a slug that no
longer exists, and touches no billing row and no Storage object. Without the `revision_blocks`
index (not yet in production) it would take about 75 s in total and up to about 20 s per article,
holding the owner's billing lock throughout.

You cannot reach any database (no network). Your review is of the plan, the SQL it shows with its
outputs, the script, and the code it relies on.

**Try to break it.**

1. **The predicate.** Is "never published" defined so that it cannot match an article a reader can
   see, share, or is in the middle of importing right now? Walk every way an `articles` row is
   created and every way `current_revision_id` is set and cleared (re-extraction, a draft that
   publishes after a long run, read-while-importing's stand-in tree, a successor job, an upload in
   progress, a public/shared view). Find a live article the predicate would match.
2. **The attachments.** For every table, the plan gives an `ON DELETE` and a count. Check the
   `ON DELETE` in the migrations (not only `schema.ts`, since some objects live only in
   migrations), and look for references that are NOT foreign keys: slugs or article ids inside JSON
   columns, storage paths, `ai_calls` metadata, feedback, logs, the export bundle, `uploads.slug`
   (the plan says six rows keep a stale slug: what reads `uploads.slug`, and does any reader-facing
   path follow it to a missing article and fail?). What does the `ai_calls` "set null" do to the
   cost dashboards (`/admin/costs`) and to per-article spend totals?
3. **The mechanism.** `destroy` is called per article under `runAsOwner`. Does `destroy` do exactly
   what the plan's table says for an article with NO revisions (it was written for shelf articles;
   does it assume a current revision anywhere, e.g. reading the title for a log line, or a
   visibility audit row)? Does it run any trigger the plan does not list
   (`ingest_events_freeze_article_price` is named)? Is "one transaction per article, stop at the
   first refusal" safe if a run is interrupted half-way (idempotent re-run)?
4. **The script's safety.** It must be impossible to delete in production without `--prod`,
   `--delete`, an `--ids` file equal to the eligible set both ways, the cap, and a written backup.
   Find any path where a typo, a stale ids file, a changed candidate set between the dry run and the
   delete, a `.env.local` vs `.env.prod` mix-up, or an exception after a partial delete leads to
   deleting something not reviewed. Does the dry run really run read-only (it says it checks
   `transaction_read_only` before reading)? Is the `Target:` line the real target?
5. **The backup.** One JSON file of every `articles`, `block_identities` and `checkpoints` row it
   will remove. Is that sufficient to restore what was deleted (are there cascaded rows in other
   tables it does not capture)? Is restoring from it actually possible (a restore path, or only a
   record)? It holds PDF transcriptions: is writing it 0600 outside the repo enough?
6. **Timing.** The plan recommends running after the deploy that adds the index, as one run taking
   all 13. Is waiting the right call, versus running the 12 now at about 75 s of per-owner lock
   time? Is there anything the owner (the administrator account) would be doing that the lock
   would block?
7. **The tests.** Could the script's tests pass against a version that deletes a published article,
   ignores the ids file, or skips the backup?

**Format.** Findings R1, R2, …; P0 (would delete or corrupt something that should survive) / P1 (the
safeguards could be bypassed by an ordinary mistake, or the plan misstates what is deleted) / P2 /
P3; the input or code path; the smallest change. End with a verdict: **safe to run as planned /
safe after these changes / not safe**, and say exactly which of the 13 you would allow.
