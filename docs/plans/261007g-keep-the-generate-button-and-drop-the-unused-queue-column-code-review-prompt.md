# Code review (write-capable): keep the Generate button; drop an unused column

You are reviewing, and may fix, two committed changes on branch
`worktree-sweep7-generate-button-and-queue-column`: `9676afee2` (keep the Generate button after a
failed *Try again*) and `6a62359d6` (drop `queue_state.running_job_id`); `064dc2fe5` is a merge and
`ddfa7a768` renumbers the plan. Read each with `git show`. The plan:
`docs/plans/261007g-keep-the-generate-button-and-drop-the-unused-queue-column.md`.

**The owner's decisions** (relayed verbatim by the Overseer, 2026-10-07): to "keep the Generate
button everywhere" — *"ok, i'll go along with you on this. I don't quite follow"* — and to drop
the column — *"yes"*. Everything else is the orchestrator's and the builder's.

**Commit 1.** Twelve artefact hooks each gained `saidNoneFor = useRef<string | null>(null)`, set
to the slug in each "none yet" branch (two in Sketch and Illustrated), and their catch became
`was !== "loading" ? was : saidNoneFor.current === slug ? "none" : "error"`. `IllustratedView` now
draws the failure above the empty state when the status is `none`. One cost stated: a mode press
over "none yet" plus a failure is read by `useAutoRun` as `none` and spends once, where before it
re-read. Break it:
- can `saidNoneFor` say "none" when the server's latest answer was a LIST (none-yet, then a list,
  then the list is deleted or a refresh fails: is the ref ever cleared on a later list answer)?
  A stale "none" would show Generate over an article that has a result — a second paid run;
- slug changes, offline copies, the rewrite hold, a job finishing, StrictMode remounts;
- is the `useAutoRun` cost acceptable, or does it spend on an armed press while the app does not
  know whether a result exists, which is exactly what the owner was told the cost would be (it
  was: "a possible duplicate run is cheaper than a dead end") — confirm the spend happens once,
  not in a loop;
- twelve copies of three lines: is a shared helper clearly simpler (deletion test), or are the
  copies honest?

**Commit 2.** A migration dropping the foreign key and the column; `ARTICLE_TABLE_COVERAGE` loses
`queue_state`; the production pre-flight
(`docs/plans/261007c-seventh-sweep-schema-production-preflight.sql`) now expects eight pending
migrations and checks the column exists, is empty and its key is as `0000` made it. The migration
was NOT applied to the shared local database (`db:migrate` refused over two other worktrees'
unlanded migrations); the chain was proved on a private empty database. Check: the SQL drops exactly
those two objects; nothing reads or writes the column (re-run the grep yourself, including string
forms and `tools/`, `evals/`); the singleton, its CHECK, its seed, its no-delete trigger and the
missing-row refusal in `claim` survive; the export manifest change is only the omitted-tables list;
the pre-flight's new block can fail (the builder notes its third arm, "holds a value", has never
been seen to fail). Is the migration safe to apply inside the same transaction as the other seven
(lock taken on `queue_state` blocks job claims: for how long, and do claims retry rather than fail)?

Postgres-backed tests cannot run in your sandbox: say which could pass against a plausible wrong
implementation. jsdom tests you can run: `npx vitest run tests/read-error-matrix.test.tsx
tests/ideas-read-states.test.tsx`. No `npm test`.

**Fix what is inside these changes**, narrowly, red-first. **Report, do not fix, anything wider.**
No new reader-facing sentence. Do not commit. Do not attribute any further decision to the owner.

**Reply format.** Findings C1, C2, …; P0 (data loss, or a migration that fails half-applied) / P1 (a
reader sees wrong behaviour or pays twice) / P2 / P3; the input; reproduced or reasoned; fixed or
not (and the test). Then files changed, what you ran, and a verdict (ship / ship with these fixes
applied / do not ship).
