# Review: stage 2 of 261003l — Explore, a fourth sub-mode of Remember

Repo: the current directory (Spideryarn; TypeScript, ESM, Postgres through drizzle, React client).
You reviewed the plan (`docs/plans/261003l-reader-notes-plan-review-sol.md`, PR-1..PR-7) and stage 1
(`docs/plans/261003l-stage-1-code-review-sol.md`, CR-8..CR-10). Your stage 1 fixes (`df0b523fc`)
are code nobody else has reviewed. The plan is
`docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md`; Greg's words at
its top decide the product, its Reviews section says what was to be built, and "Stage 2, what
landed" is the implementer's account.

## The candidate

Committed: `34ca6137a` (the stage as built), then the merge `b4ecad4eb`, then `5f5ae98cd` (the
migration regenerated after the merge). For the stage's own changes:
`git diff 34ca6137a^..34ca6137a -- . ':!drizzle/meta'`, and for the migration
`git show 5f5ae98cd -- drizzle/20261003184359_explore_thread_kind.sql`. The first commit's
`drizzle/20261003182913_*` files no longer exist; `drizzle/20261003184359_explore_thread_kind.sql`
replaces them.

Start with `src/converse.ts` (`EXPLORE_SYSTEM`, `systemFor`, `readItFor`, `lengthLine`,
`notesSection`, `buildConverseMessages`, and the constants split out of `CITING_RULES` and
`SYSTEM`), `src/routes.ts` (`exploreNotes` and its callers in `streamChat`),
`src/web/modes/conversation/ConversationModes.tsx` (`OFFERS_LIVE`, the keyed band),
`src/web/ChatPanel.tsx`, `src/web/sub-modes.ts`, `src/web/params.ts`, `src/types.ts`,
`src/db/schema.ts`, `tests/explore-kind.test.ts`, `tests/explore-digest-route.test.ts`,
`docs/project/remember-mode.md`. Not the limit. The template this stage followed is Tutorial's
commit, `849cdcb50`.

## What it is meant to do

A fifth `ThreadKind`, `explore`, one thread per article. Statements to check for accuracy, each
against code:

1. Every place a thread's kind is read treats `explore` deliberately: nothing answers an Explore
   thread with Chat's, Recall's or Tutorial's prompt, cap, title, visibility or Live rule by
   falling through.
2. The notes digest rides in the final user message of every Explore turn (send, retry, edit,
   later turns, trimmed history), is built from the stored thread's id and kind and the owner's
   own rows, and is never sent for any other kind.
3. Everything above the cache breakpoint is byte-identical between two Explore turns of one
   conversation, and the four older kinds' message arrays are byte-identical to before this stage.
4. A failure to load the notes does not fail the turn, and logs no note text, title or thread id.
5. Explore has no Live control and no spoken turn can create or append to an Explore thread.
6. One Explore thread per article holds: the index, `targetOf`, the band, Start over, a stale tab.
7. The migration is additive and the chain is consistent (read it; do not run it).
8. `EXPLORE_SYSTEM` does what Greg's reframing asks (read his words in the plan): thinking and
   the reader's own ideas and cases, the wider world by search, less recall. Look for
   contradictions between its rules, and for anything that would make it invent a note or a case
   for the reader, grade the reader, or run long.
9. The docs changed in this stage match the code.

## What you may do

Your sandbox is workspace-write. Fix what you find **inside this stage**, narrowly and red-first.
**Do not edit the text of `EXPLORE_SYSTEM` or the Explore line in `lengthLine`**: an eval is
running against them at the same time, so report prompt findings with the wording you would use
instead. Another agent is adding files under `evals/` and `docs/investigations/`; leave those
alone, and make small targeted edits elsewhere, re-reading a file immediately before you edit it.
Report, do not fix, anything wider. Do not commit. Run no git command that discards work. Do not
run `npm test` in full, nor `db:generate`, `db:migrate`, `db:reset`. Run
`node --import tsx scripts/typecheck.ts` and the vitest files that need nothing outside the tree
(`tests/explore-kind.test.ts`, `tests/reader-notes-tool.test.ts`, `tests/remember-prompt.test.ts`,
`tests/remember-panel.test.tsx`, `tests/remember-url-rules.test.tsx`). You have no network or
database: say which Postgres-backed files you could not run and I will. My raw result at
`5f5ae98cd`: 18 files, 404 tests passed, including `explore-digest-route`, `remember-route`,
`remember-store`, `store-export-thread-kind`, `reader-notes-owner-isolation`, `db-schema-drift`.

Severity: P0 data loss, exploitable security, wrong charging, service unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design or maintainability risk; P3
prose. IDs continue the chain: start at `CR-11`. For each: file:line, established or reasoned,
fixed (and how) or left. End with a verdict: land, land with the fixes named, or do not land.

## My own suspicions (already mine; spend most of the run elsewhere)

- The digest's sentences were written for a tool answer ("To read one, call reader_notes…") and
  now also sit in a user message.
- Tutorial's prompt still sends an exploring reader to Chat, not to Explore.
- The per-kind words in `ChatPanel.tsx` are ternary chains four kinds deep, not a checked record.
- The route-level "no digest for other kinds" tests were not seen red.
