# The last six artefact reads answer "none yet" as `200 null`

Queue item `qi-s6x55kam`, handed over by the Overseer on 2026-10-07 (Greg, 2026-10-04: *"If you're
confident, address all of the Q-queue-yeses"*). One stage, one commit. Owner: the session in
worktree `261007-not-made-yet-reads-and-quote-delay`. Indexed under
[plans.md](../project/plans.md) by file name.

It finishes [261006h](261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md), which
moved ten reads to "`200 null` when the request carries `x-spideryarn-none-yet-as-null`" and left
these as a plain 404 for "not made yet": **tweets, relations, skim, sketch, illustrated, arc**. The
queue item named five; Illustrated is the sixth, found missing from every list on 2026-10-07
(`src/store/artefact-not-made-yet.ts` is now the one list), and the Overseer asked the same
question independently. Its 404 is the same fact as the others', so it belongs here.

The loader half is already done: since plan 261007d all six loaders throw `ArtefactNotMadeYet`, and
`tests/none-yet-is-not-a-404-route.test.ts` § `STILL_404` pins them. The Tweets and Skim hooks
already read a `200 null` as "none" (plan 261007e) but do not send the header.

## What changes

The same edits 261006h made, nothing new invented.

- **Route** (`src/routes.ts`, the six `GET /api/<name>/:slug` handlers). Each wraps its store read
  in `orNullWhenNotMadeYet({ req, res }, …)` and returns when that answers `null`. Where the read is
  inside `withProfileChanged` (tweets, sketch, illustrated), the helper goes around the outside, as
  glossary has it. **Skim** reads `loadSkim` and `resolveProfile` in parallel, and the helper
  *writes the response* when it answers, so it cannot sit inside that `Promise.all`: a profile read
  failing after the `null` went would try to write a second response (Sol F1). Both reads still
  start together; the profile is awaited first, then the helper is handed the already-started
  `loadSkim` promise (its rejection observed so it is never unhandled meanwhile). A profile failure
  stays an error, never "none yet".
  The plate route `/api/illustrated/:slug/:hash.:ext` is not touched: it serves bytes, and a
  missing artefact there is a missing plate.
- **Client reads** — every fetch of the six URLs sends the header, and "none" is `res.status ===
  404` **or** a body that is exactly `null` (`=== null`, never truthiness). A reply that is neither
  and lacks its artefact throws `MalformedReply` before publishing anything, and what is on screen
  stays. Where the hook reports read failures the reader gets `PAGE_FAULT`; three do not, and keep
  their own failure handling (Sol F3): `useRelations` swallows a failed read, `useSketchReadiness`
  maps it to `unknown` (never `ready`), and the caption stays silent. Eight call sites:
  - `useTweets.ts`, `useSkim.ts` — the null branch and the check exist; add the header.
  - `useRelations.ts`, `useArc.ts` — add header, null branch, artefact check.
  - `useSketch.ts` (the read, and `useSketchCaption`) and `useIllustrated.ts` (the read, and
    `useSketchReadiness`, which reads `/api/sketch/`) — the same. `useSketchReadiness` maps `null` to
    `absent`, as it does a 404; the caption hook does nothing, as for a 404.
- **Offline cache** (`src/web/lib/api.ts` § `NONE_YET_AS_NULL`). The six names join the pattern, so a
  `null` is never saved and replayed to an old tab.
- **Words.** `artefact-not-made-yet.ts`'s list becomes "all sixteen", `NONE_YET_AS_NULL_HEADER`
  (`src/types.ts`) and `orNullWhenNotMadeYet`'s comment say every artefact read, and
  `docs/project/web-client.md` where it describes the convention.

## What does not change

- Without the header, all six still answer 404 for "not made yet" (the old-tab reason 261006g
  gave). "No such article" is a 404 either way.
- Nothing a reader sees: every band shows what it showed. Tweets and Skim are not mounted unless
  their modes are open; relations and sketch are, which is where the red lines came from.

## The simpler option passed over

Answering `200 null` to everyone with no header, for the old-tab reason. And a table-driven route
list, for 261006h's reason: the inventory test already fails when a route and the offline pattern
disagree.

## Done looks like

- **Red first.** `STILL_404` in the route test becomes part of `ROUTES` (the same four cases: 200
  null with the header and `private, no-store`; 404 without; unknown slug 404 with; an existing
  artefact unchanged where the scratch article has one). `tests/api-fetch-offline.test.ts`:
  `NONE_YET_READS` grows to sixteen and the "routes not moved" expectation goes. The hooks test
  (`tests/none-yet-is-not-a-404-hooks.test.tsx`) grows the six hooks: header sent, `null` is none,
  404 is none, `false`/`0`/`""` are not none, a malformed reply keeps what is on screen. Plus
  `useSketchReadiness` and `useSketchCaption` send the header and treat `null` as absent.
- `npm test` on the touched files, `npm run typecheck`, lint on touched files.
- `tests/none-yet-catch-boundary.test.ts`: Skim with "none yet" and a profile read that fails,
  in both orders, writes one response.
- Browser, by a Sonnet subagent, at 1440 / 820 / 390: an owner's article with none of the six made,
  each view opened by URL; **all six URLs seen requested** before "no 4xx" counts, each answering
  `200 null`. Tweets, Arc and visible Relations **start a job on arrival** when there is none (Sol
  F2), so for those the check is the initial `null` and the job starting, not a lasting "nothing
  yet"; Skim, Sketch and Illustrated show their button. An article with some made still shows them.

## Reviews

GPT Sol on this plan (read-only) and on the code (write-capable).

**Plan review, 2026-10-07** — [the answer](261007n-plan-review-sol.md). Verdict: build with changes.
F1 (P1, Skim's helper inside `Promise.all` could write twice), F2 (P2, three of the six start a job
on arrival, so the browser check cannot expect a lasting empty state) and F3 (P3, three readers do
not report a `PAGE_FAULT`) all accepted and folded in above. It confirmed no reader of the six URLs
is missing (public reading uses payloads; MCP, prefetch and `tools/` fetch none of them), that
Illustrated belongs, and that its plate route stays as it is.

## What landed — 2026-10-07

Built as planned, uncommitted, awaiting the code review.

- **Routes** (`src/routes.ts`): the six `GET /api/<name>/:slug` handlers call
  `orNullWhenNotMadeYet`, outside `withProfileChanged` for tweets, sketch and illustrated. Skim
  starts `loadSkim` and `resolveProfile` together, marks the route read's rejection observed with
  an empty `catch`, awaits the profile, then hands the in-flight route read to the helper — so a
  profile failure is a 500 in either order, never "none yet", and exactly one response is written.
  The plate route and `sendPlate` are untouched.
- **Offline cache**: the six names joined `NONE_YET_AS_NULL` (`src/web/lib/api.ts`).
- **Eight client reads** send the header and read "none" as a 404 or a body exactly `null`;
  a reply without its artefact throws `MalformedReply` before anything is published. Relations
  swallows that as before (no words, no job, the arrival rule's one re-read); readiness maps
  `null` to `absent` and a malformed reply to `unknown`; the caption stays silent.
- **Words**: `artefact-not-made-yet.ts` (one list, all sixteen; the "six do not" section
  deleted), `NONE_YET_AS_NULL_HEADER`, `orNullWhenNotMadeYet`, `NONE_YET_AS_NULL`'s comment,
  the hooks' comments, and `docs/project/web-client.md`.

**Red first: 83.** 30 in the route, offline and catch-boundary tests against the unchanged server
and cache pattern; 53 in the hooks test against the unchanged hooks (run against copies of the
`HEAD` hooks, because five hooks had been edited before their test was written).

**Gates.** `npm run typecheck` clean. `npx vitest run` on the four touched none-yet tests,
`doc-links`, and every test naming one of the six URLs: 39 files, 2478 passed, 18 skipped, 0
failed. A further 21 files that use these hooks without naming a URL: 580 passed. `biome lint` on
the touched files: 0 errors, 7 infos (cognitive complexity; one new, on `useSketchReadiness`'s
effect).

**Two fixtures changed with the contract.**
`tests/a-broken-mode-leaves-the-article-readable.test.tsx` answered these URLs with the
fall-through `{}`, which is now a reported fault; five join its 404 list, and Arc answers a made
arc (a missing one starts a job, which the file counts). `tests/illustrated-reasks-the-sketch-after-a-refusal.test.tsx`
answered "Sketch ready" with flags and no Sketch, which readiness now calls `unknown`; it answers
as the route does.

**Behaviour change on malformed replies only.** A Sketch reply with `sketch: null` used to fall
through `readSketch` to "none"; it is now a failed read, as for the other fourteen. The server
never sends one.
