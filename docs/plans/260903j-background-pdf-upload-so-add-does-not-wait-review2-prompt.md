# Review prompt — background PDF upload (code stage)

This is the **second** review of this work and it matters more than the first. You reviewed the
plan; this is the code built from it, where the bugs actually are. A plan-stage review reads prose
and cannot find a handler that writes one field and then rejects the request.

## Where things are

Work in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload`.

- **The plan, as revised after your review:**
  `docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md`
  — read § *What the review changed* and § *Watched red* first; they say what your findings turned
  into and which mutations were actually run.
- **Your previous findings:**
  `docs/plans/260903j-background-pdf-upload-so-add-does-not-wait-review-sol.md`.
  **Treat their fixes as unreviewed code written by somebody else**, and spend most of this run on
  what has changed since. All eleven were confirmed; three of them were claims of mine that were
  simply false.
- **The scoped diff:** `docs/plans/260903j-background-pdf-upload-so-add-does-not-wait-code.diff`
  (`git diff origin/dev...HEAD -- src/ tests/`). The docs half of the diff is excluded on purpose.

The tree is read-only to you, but you **can** run one test file or a script:
`npx vitest run tests/<one>.test.ts` and `node --import tsx <script>`. Not `npm test`, not
`npm run typecheck`.

Two things that will otherwise cost you a run, both learned the hard way:

- **`VERCEL=1` switches off upload *minting*** as well as the job worker
  (`recordsSurviveTheRequest` in `src/upload-records.ts`), so a grant asked for with it set answers
  503 *"Uploading isn't switched on here"*. That is what made three of eighteen fail for you last
  time in `tests/uploads-api.test.ts`; the same file is 18/18 here.
- The new server test needs the **local Supabase stack up** (`blobStore()` follows the credentials
  `.env.local` supplies, so it writes real objects to the local `sources` bucket).

## What was built

**The transfer moved out of the component and into a tab-level singleton.**
`src/web/uploadEngine.ts` now owns hashing, the grant, the PUT and the `POST /api/jobs` that
follows it. The shelf mints the grant, navigates to `/add/upload/<id>` with **zero bytes sent**, and
unmounts. `UploadPicker`'s abort-on-unmount is deleted.

**The readiness gate.** `POST /api/jobs { uploadId }` HEADs the staging object before it claims
anything, and answers `UPLOAD_STILL_ARRIVING` (409) when it is absent — no claim, no job, no quota
slot. This is your finding 1, and I chose the object's existence over your suggested durable
`ready` column, because a column needs a writer and the only candidate is the browser. Measured:
a PUT aborted at 320 KB of 5 MB leaves no object at all.

**`resolveExistingUpload` runs before `withIngestSlot`** (your finding 2), so a repeat claim cannot
be refused 402 for a slot nobody needed.

**Retry is phase-specific** (finding 4): re-POST after a `queueing` failure, re-PUT after a
`sending` one, and a `409` at our own staging key is read as *the bytes landed* rather than as a
refusal.

**The engine is bound to `user.id` in `useJobSession`** (finding 6) and reports its queue POST
through `jobEngine.epoch()` / `actionSucceeded` / `actionFailed`, never `start()` (finding 7).

**Add is one button for both ways in**, taking whichever of URL and file was touched last, with the
label saying which (finding 8).

## What I deliberately did NOT do, and want you to push back on if I am wrong

1. **I did not let a present object override an expired grant.** Your finding 2 said the bytes
   should stay claimable past the two-hour grant. `claimUpload` still refuses an expired grant, so a
   reader 402'd on quota who upgrades more than two hours later must choose the file again. I judged
   the extra `bytesArrived` flag through both store adapters not worth it for a >2h window. Tell me
   the sequence where that costs more than one re-upload.
2. **I did not fix the unrecoverable 409** (your finding 3 — `enqueue` throwing between
   `claimUpload` and `noteSlug`). It is pre-existing and reachable on `origin/dev` today. It is a
   stage at the end of the plan, flagged for Greg. Confirm it is genuinely pre-existing rather than
   newly reachable, and say whether the readiness gate widened its window.
3. **I did not write the sweep** (finding 11). `sweepable()` still has no production caller; the
   leak is now written down in `docs/project/ingest-queue.md` instead. Cancelling did get easier, so
   say if you think the rate now matters.

## What I want from you

For **each finding**: **(a) the mutation** — a concrete input, sequence or edit under which this
code fails its own claim, something I can run or click — and **(b) the smallest change** that
closes it. Rank by (a); a finding with no (a) is an opinion and goes last. Do not hand me a patch to
apply.

End with a one-line verdict: **ready to land**, **ready with the changes below**, or **not ready**.

## Specific things I suspect, and want broken rather than confirmed

Turn each into a mutation if it is real, and say plainly if it is not.

1. **The fence in `uploadEngine`.** One counter, bumped by `stop`, `send`, `cancel` and `retry`; a
   reply writes only when its captured token still equals it. Find the interleaving that gets a
   write through — or that fences a write that *should* have landed. Look hard at `retry` during an
   in-flight `sendBytes`, and at `send` called while the previous transfer's PUT is still resolving.
2. **`forget()` and the terminal states.** Your finding 9. `forget` refuses to clear a live transfer
   and clears any terminal one; the `x` on the shelf cancels a live one and forgets a stopped one.
   Find the state where the shelf and `/add/upload/<id>` disagree about what the `x` or Stop means,
   or where a transfer becomes unreachable but un-forgettable.
3. **Two writers of `/api/jobs`, still.** `AddPage` skips its own POST when
   `engineRef.current` is true. Find the render ordering where that ref is stale — a StrictMode
   double mount, an address changed without a remount, the engine finishing between render and
   effect — and both post. Then say whether the readiness gate plus `queueAnUpload`'s `taken` branch
   actually makes that harmless, or only usually harmless.
4. **The arrival poll in `AddPage`.** `setInterval` on a `GET /api/uploads/:id`, started when the
   failure reason string equals `UPLOAD_STILL_ARRIVING.message`, bumping `attempt` when `arrived`.
   Comparing a *sentence* to decide behaviour is exactly the kind of thing that rots. Find where it
   loops for ever, where it never starts, or where it fires twice for one arrival.
5. **The disclosure sentence changed tense.** `/add/upload/<id>` now says the present-tense
   `ADDING_SENDS_TEXT_AWAY` while the file is still going up, and the past-tense
   `DIRECT_ADD_SENT_TEXT_AWAY` afterwards, on the grounds that nothing has reached a model provider
   until the ingest is queued and there is a Stop button on screen. Is `stillSending` true in every
   state where that claim holds, and false in every state where it does not? This one is about a
   reader's manuscript, so I want it broken hard.
6. **`beforeunload`.** Registered on entering `hashing`, removed on every terminal state, plus
   `guard(true)` again in `retry`. Find the path that leaves it registered with nothing running, or
   that removes it while the PUT is still going.
7. **`uploadHasArrived` on `GET /api/uploads/:id`.** A Storage `head` per poll, after the ownership
   check. Is there an ordering where an id belonging to somebody else gets a yes/no about their
   object? And is `head` throwing on a 503 (rather than answering absent) actually true of both
   adapters?
8. **The tests.** Four new files and three edited. Which of my new assertions would still pass
   against the *old* code — i.e. which of them is not testing what its comment claims? Name them
   specifically. `tests/upload-engine.test.ts` poses the transport under a real engine; say if that
   seam lets something meaningful through untested.

## What I do not want

- Style notes, naming preferences, or opinions about test counts.
- A rewrite into a server-side wait; the plan names and rejects that with reasons.
- Praise.
