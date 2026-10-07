# Code review (write-capable): small server request-path defects and dead branches

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** on branch `worktree-sweep7-server-small`: `906f95363` (1, SVO2), `d7efdead8` (2,
SVO3), `e20744320` (3, SVO6), `4912e4de5` (4, SVO5), `a9dc7c9b4` (5, SVO12), `c75a49bd6` (6,
SVO14), `c36767a18` (7, half, and SVO7), `1c4dbf902` (8, SVO8, comments only), plus plan commits
and a merge of `origin/dev`. Read each with `git show`. The plan:
`docs/plans/261007d-seventh-sweep-small-server-request-path-defects-and-dead-branches.md`. The
umbrella: `docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, cluster C6. The findings:
`docs/investigations/261006d-seventh-sweep-depth-server-request-path-opus.md` and your family's
review of it, `…server-review-sol-on-opus.md`.

**Try to break each item.**

1. **SVO2.** `find` in `src/store/realtime-sessions-pg.ts` returns `null` for a non-UUID. Does any
   caller treat `null` as something other than "no such session" (create-if-missing, a usage write
   attributed elsewhere)? The builder says no other URL-supplied id reaches a `uuid` column
   unguarded, and did not check ids arriving in a request BODY: check those
   (`grep -n "uuid(" src/db/schema.ts`, then each column's readers).
2. **SVO3.** `serveApi`'s catch now returns without writing JSON when `res.headersSent`, ending the
   response only if unfinished and not destroyed, after capturing the original failure once.
   Consequence the builder notes: the request line for a fault after headers is now logged at
   `info` with the error attached, because the level follows the status the reader received (200),
   and Sentry carries the report. **Is that right?** A fault after a stream started is a real
   failure an operator scanning logs at `warn`+ would now not see. Read `docs/project/logging.md`
   for the house rule; if the rule says such a line should be `warn` or `error`, fix it; if it is a
   judgement, say which way you would go and why, and leave it. Also: can the guard swallow a fault
   where headers are out but the client is still waiting for a terminal SSE frame, leaving a stream
   that never ends (the handlers' own catches are supposed to send that frame: find one that does
   not)?
3. **SVO6, SVO5, SVO14: deletions licensed by a characterisation test.** For each, could the
   characterisation pass while the deleted code and its replacement differ on some input? SVO5's
   one observable change: search and referee-criterion 409 bodies now carry a `paper` field, as
   chat's does. Does any client code branch on the presence of that field for those two routes
   (`grep -rn "paper" src/web` around 409 handling)?
4. **Item 7, half built.** Six loaders (`loadTweets`, `loadRelations`, `loadSkim`, `loadSketch`,
   `loadIllustrated`, `loadArc`) now throw `ArtefactNotMadeYet` instead of a plain 404 error; the
   builder says status, sentence and every response are unchanged, and pinned all six as 404 with
   and without the opt-in header. **Verify nothing observable changed**: every `catch` or
   `instanceof`/`status === 404` check downstream of those six loaders (routes, the public reader,
   the pipeline, export) — does any now take a different branch because the error's class changed
   (in particular anything that treats `ArtefactNotMadeYet` as "fine, skip" where a plain 404 used
   to propagate, or the reverse)? The route opt-in itself was NOT built (it needs a matching edit
   in `src/web/lib/api.ts`, which was out of the builder's scope): do not build it; it is recorded
   as left.
5. **A defect the builder found and pinned instead of fixing:** a Stop that lands between the
   upload route's look and the claim is answered 409 "That upload is already being turned into an
   article." because `claimUploadIn` in `src/store/pg-uploads.ts` reads every status but `pending`
   as `taken`, where `resolveExistingUpload` answers the same row 410. **You may fix this one**, if
   you agree it is a defect and the fix is the one line the builder describes plus flipping the
   pinned test ("is a 409 when a Stop got in between") to expect the 410 and its existing sentence:
   say whether a stopped upload should be 410 on that path by reading how the rest of the upload
   code treats `stopped`/`expired`. It needs Postgres to prove, so write it and mark it unrun.
6. **Comments (commit 8, and those moved in others):** every rewritten comment is a claim; check
   each against the code. The builder lists four more present-tense comments about deleted code it
   found late and did not verify (`pg.ts` § `loadSketch` and § `loadIllustrated`; `pg-comments.ts`
   "`sameMark` in src/comments.ts"; `src/public-types.ts` "the public read filters to finished
   rows"): verify each and correct the false ones.

Postgres-backed tests cannot run in your sandbox (no network, not even loopback): do not report
them as failing; say which could pass against a plausible wrong implementation. Pure tests you can
run: `npx vitest run tests/<file>`. No `npm test`.

**Fix what is inside this stage**, narrowly, red-first where a red is possible. **Report, do not
fix, anything wider.** Do not touch any file under `src/web/`, `src/jobs.ts`, `src/store/pg-jobs.ts`,
`src/store/pg-session.ts`, `src/db/schema.ts`, `drizzle/`. No new reader-facing sentence. Do not
commit. Do not attribute any decision to the product owner in docs: these choices were the
orchestrator's (Claude's) and the builder's.

**Reply format.** Findings C1, C2, …; P0 (data loss) / P1 (a reader sees wrong behaviour, or an
operator loses a signal) / P2 / P3; the input; reproduced or reasoned; fixed or not (and the test,
run or unrun). Then files changed, what you ran with raw counts, a verdict (ship / ship with these
fixes applied / do not ship), and wider notes.
