# A preview spans two lifetimes but only ordinary endings were tested

Stage 2 of [261004f](../plans/261004f-stop-writing-the-simple-summary-level.md) showed Brief
before Fuller finished. Review found four gaps: a pause or expiry retained Brief on a settled job
step; Fuller went empty while the completed summary's read was pending; retrying that read hid
the remembered Brief; and a new attempt of the same job kept the previous attempt's Brief.
The candidate was `3817d276b6b04ac20159d06c7fb9e1551650674f`. This review did not establish
whether these gaps reached readers.

The class is **one preview crossing two lifetimes, with only ordinary endings tested**. The
persisted preview belongs to a running step attempt. The browser's remembered preview belongs
to the handoff from that attempt to a stored summary, or to the failure the reader has seen.
Introducing both together made ordinary success and failure look like a complete lifecycle.
Pause, expiry, read retry and same-id requeue were different transitions, with different owners.

The introducing commit added `stepPreviews`, `keptPreview` and `EarlyBrief`; `git log -S` and
the parent diff identify it. The older SQL settlement already copied arbitrary step fields.
Adding the preview without updating that transformation made the omission a retention bug.
The runner deleted its local field, but deadline pause derived its new steps from the persisted
row. The client could remember a preview correctly while a panel condition still hid it.
Remembering only the job id also conflated two attempts whose id intentionally stays the same.

Existing tests covered normal success, failure, delayed preview writes, and starting a row with
an old preview. That last case established cleanup at start; it said nothing about what a
paused or expired row retained before start. The deferred completion test stayed on Brief, so
Fuller's empty branch remained untested. Failed-read tests stopped before the retry entered
`loading`. The successor test changed job id, so it never exercised same-id requeue.

The narrow fix is also the long-term fix: remove preview in the shared SQL settlement,
including its non-running arm for old pending rows; retain visible text across read-only
loading; give Fuller a read-recovery state after completion; and key remembered previews by
the existing attempt counter as well as article and job. A pause after `simple` is already done
keeps Brief: only the later unfinished step will run again, and the summary awaits publication.
Artifact publication still commits both levels together.

Countermeasures, ranked by cost against value:

1. **Exercise the omitted transitions through the existing boundaries.** Added three SQL
   generation cases in [job-preview-settlement-sql.test.ts](../../tests/job-preview-settlement-sql.test.ts)
   and six row cases in [store-jobs-parity.test.ts](../../tests/store-jobs-parity.test.ts): pause,
   requeue, expiry, expired Stop, Stop followed by expiry, and queued Stop with an old pending
   preview. The SQL cases drove the real lifecycle methods through a mocked database boundary:
   **3 failed on the candidate, then 3 passed** after removal was added. The row cases were
   added but not run: this reviewer had no Postgres. They require the implementer's rerun.
   [simple-panel.test.tsx](../../tests/simple-panel.test.tsx) now also drives Fuller during the
   deferred read, Brief during read retry, and same-id requeue through the real hook. The primary
   reviewer observed all three red first: Fuller had only `BriefFullerThread` on screen; the
   retry had `[]` paragraphs; and requeue still showed the old two paragraphs. All three went
   green after their fixes. The combined local run of the three required Simple suites and the
   SQL suite passed **189 tests in four files**; typecheck passed. A preservation test then
   exposed an overly broad requeue clear in the review fix: a finished `simple` step lost Brief
   when a later step paused. It failed first and passed after clearing was limited to attempts
   that will rerun `simple`. The final local run, including doc links, passed **206 tests in five
   files**; typecheck passed again.
2. **List every owner of a transient field before declaring its lifecycle covered.** For a
   field held both on the server and in browser memory, verify ordinary completion, interrupted
   completion, restart and read recovery independently. This costs a short transition inventory
   and would have exposed both the SQL copy and panel's separate display condition.
3. **A new partial-summary artifact and publication model was rejected.** It would require a
   second storage/read contract and a decision about failed Brief persistence. These defects
   were missing transitions in the chosen job-preview model, which already had the required
   ownership and publication boundaries.

No Postgres result is claimed here. Re-run the row suite and the candidate's jobs-walk,
stage-stamp-agreement and freshness-deciders-agree suites before treating database behavior as
verified. The SQL test checks the generated removal expression; it does not execute that
expression in Postgres.

Up: [Postmortems](../project/postmortems.md)
