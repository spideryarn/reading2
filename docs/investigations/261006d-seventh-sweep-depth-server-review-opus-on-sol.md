# Seventh sweep, depth: server request path — Opus reviews GPT Sol's investigation (2026-10-06)

Reviewed: [the Sol document](261006d-seventh-sweep-depth-server-request-path-sol.md) (SV1–SV4),
against [the Opus document](261006d-seventh-sweep-depth-server-request-path-opus.md) (SVO1–SVO15)
and the schema reader's DB1
([schema, Sol](261006d-seventh-sweep-depth-database-schema-sol.md)). Brief:
[cross-review](261006d-seventh-sweep-depth-prompt-cross-review.md). Tree: `bf78e90c7`.

## How this was checked

Sol had no database, so its three Tier 0s were shown only with mocked leaves. Here each one was
run **through `handleApi` and the real Postgres stores**, in the private-postgres lane, with only
the model faked (a `fetch` that hangs until aborted for chat; `explainStream` and
`runCriterionStream` mocked exactly as `tests/comment-answer-stream-lifetime.test.ts` and
`tests/referee-routes-postgres.test.ts` already do).

**How a new file got a database without touching `TEST_LANES`.** Two untracked throwaway files: a
config `vitest.svprobe.config.ts` with one project that reuses the private lane's own
`globalSetup` (`tests/setup/private-db-global.ts`) and setup files (`no-provider-calls.ts`,
`private-db.ts`), and a probe `tests/zz-svprobe-server.test.ts`; run with
`npx vitest run --config vitest.svprobe.config.ts tests/zz-svprobe-server.test.ts`. The lane
minted and dropped its own database (`spideryarn_test_261006224634_…`). Both files are deleted.
So the Opus document's "a new test file gets a database only if it is entered in `TEST_LANES`" is
true of the tracked config and **overstated as a limit on reproduction**.

Every `expect` in the probe stated the correct behaviour, so each red line below is the defect.
Result of the one full run: `Tests 8 failed (8)` — eight for eight, all intended.

Tree afterwards: `git status --short` lists only untracked files under `docs/investigations/` and
`docs/plans/`. (Two other untracked probe files that were present when I started,
`tests/zz-probe-walk.test.ts` and `vitest.probe.config.ts`, belonged to another reviewer and were
removed by somebody else during this run; I did not touch them.)

## Sol's findings, in its order

### SV1 — A stale edit stops the live answer before the store refuses it

**Verdict: confirmed, now R end to end. Tier 0, P1. Safe to build.**

Traced: `routes.ts` § `streamChat`, inside `inTurnOrder`: `withEdit(snapshot, …)` then
`settleThread`, then `chatStore.edit(…, { expectedTailId })`. `chat.ts` § `withEdit` checks the
thread exists, the message is in it and it is the reader's; it never looks at the tail.
`requireTail` runs only inside `pg-chat.ts` § `edit`. The route comment above the gate says
*"Whatever they would refuse, they refuse here"*, which is false for the tail.

Reproduced (real store, one process, Q2's model call hanging):

```text
[SV1] after Q1: [ 'user:done', 'assistant:error' ]
[SV1] while A2 streams: [ 'user:done', 'assistant:error', 'user:done', 'assistant:pending' ] | Q2 request settled: false
[SV1] stale edit answered: 409 { error: 'This conversation has moved on since you opened it. Reload before editing.' }
[SV1] after the refused edit: [ 'user:done', 'assistant:error', 'user:done', 'assistant:done' ] | Q2 request settled: true | its last frames: [
  'begin {"threadId":"spya-anchr2","title":"q1","messageId":"spya-z9u4ch",…}',
  'done {"text":"","status":"done","citations":[],"searches":0,"model":"anthropic/claude-sonnet-5","stopped":true}'
]
 × a stale edit leaves the other tab's live answer running
AssertionError: the live Q2 request was ended by a request that was refused: expected true to be false
```

One thing Sol's trace could not show: what the first tab is left with. The answer is stored as
**`done`, `stopped: true`, empty text** — a finished blank answer the reader is told they stopped.

**The fix, separately.** `requireTail(snapshot, threadId, expectedTailId)` before `settleThread`
when the edit carries a string tail. It duplicates nothing (the helper is exported from `chat.ts`;
`routes.ts` already imports `withEdit` and `withRetry` from there), it is one line plus an import,
and the refusal it adds is the one the store gives a moment later anyway, so no request that
succeeds today can meet it. Correct the comment's "whatever they would refuse" in the same change.
Limits, both already true and both stated by Sol: it only protects a stream in *this* process, and
an edit that sends no `expectedTailId` is unguarded by design. Red test: the probe's shape, added
to `tests/chat-route.test.ts` (already in the private lane).

### SV2 — An explanation's `done` frame carries the comment as it was when the answer began

**Verdict: confirmed, now R end to end. Tier 0, P1 (nothing is lost; the tab shows the old note
until a reload). Safe to build.**

Traced: `routes.ts` § `answer` § `settle`: `const kept = await commentStore.patch(…)`, then
`frame("done", { ...comment, ...patch })`, where `comment` is `beginAnswer`'s snapshot.
`pg-comments.ts` § `patch` returns `Comment[] | undefined`, the stored list.
`src/web/useComments.ts`, the `done` branch: `put(done)` replaces the row.

Reproduced (real store; body and colour patched through the real store while the mocked
explanation was held open):

```text
[SV2] seeded: an explained comment with body 'old note', no colour
[SV2] stored row : { status: 'done', body: 'new note', colour: 'blue', answer: 'the whole explanation' }
[SV2] done frame : { status: 'done', body: 'old note', colour: undefined, answer: 'the whole explanation' }
 × an explanation's done frame carries the comment as stored, not as it was at begin
AssertionError: expected { body: 'old note', colour: undefined } to deeply equal { body: 'new note', colour: 'blue' }
```

**The fix, separately.** `frame("done", kept.find((c) => c.id === comment.id) ?? { ...comment, ...patch })`.
No new query, no signature change, nothing duplicated. The fallback is the same one the refused
branch already uses for a comment deleted mid-answer. It adds no refusal. The catch block's last
`frame("done", { ...comment, ...patch })` (the store could not be told at all) has nothing better
to send and should stay.

**Sol's scope limit is right and matters for how the fix is described.** While deltas arrive the
client rebuilds the row from its own captured `pending` (`useComments.ts`:
`put({ ...rest, id, status: "pending", answer: text })`), so an edit made mid-stream still flickers
back to the old note until `done`. After the server fix `done` puts it right; before it, `done`
makes it stick. The client half belongs to the client zone.

### SV3 — Anchor and help rules stop at the process-local check

**Verdict: confirmed; R at the store transaction, C for the two-process schedule. Re-tiered to
Tier 1 (sibling drift), P2. Safe to build.**

Traced: `chat.ts` § `withTurn` refuses a different `kind` and a different `origin` on an existing
thread and nothing else; an offered `anchor` is used only on the branch that builds a new thread,
and `help` is spread onto the user row unconditionally. The route's two checks live inside
`inTurnOrder`, a per-process `Map`.

Reproduced against Postgres by doing what a second server would do after its own route check saw
no thread — calling `chatStore.begin` on a thread that now exists. The route controls and the
origin control are in the same run:

```text
[SV3] route controls: 409 That conversation is already about a different passage | 400 A "?" press starts a conversation; a later question in one is not one
[SV3] [ 'anchor B ACCEPTED; thread anchor stays {"blockId":"spya-tphbr6"}',
        'late help ACCEPTED; user row help=true' ]
  | origin control: refused: That conversation was not started from that item
  | messages now: 6 | help flags on user rows: [ false, false, true ] | A = spya-tphbr6 B = spya-vp6ghy
 × the store transaction refuses a different anchor and a late help flag on an existing thread
AssertionError: expected { anchored: 'accepted', helped: 'accepted' } to deeply equal { anchored: 'refused', helped: 'refused' }
```

**Why Tier 1 and not Tier 0.** It needs two server instances *and* two first sends naming the same
new `threadId` with different anchors (or the second with `help`). The client mints one id per
conversation, so no client produces that pair; it takes a hand-made or duplicated request. I
looked for a one-process route in through `targetOf` (a Learn, Tutorial or Explore send with a
fresh id is redirected onto the existing thread, which would dodge an id-based route check): it is
closed, because the route refuses an anchor on any non-chat kind and `help` on any non-chat kind
before the lock. So this is the drift Sol and Opus both describe, with no reader path today.

**The fix, separately.** Two refusals in `withTurn` beside the origin one. An ordinary request
cannot reach either: the route refuses first in-process, an identical anchor resent passes
`sameAnchor`, and a follow-up with no anchor is untouched. `sameAnchor` moves out of `routes.ts`
to **`src/types.ts`**, beside `sameOrigin` and `ChatAnchor` (the Opus doc says `sameOrigin` is
already in `chat.ts`; it is imported there from `types.ts`). Fix the two route comments that still
claim the guarantee (*"Read under `inTurnOrder`, so the thread cannot be created between the look
and the write"*; *"this one is the guarantee"*). Tests: pure cases in
`tests/chat-origin-transaction.test.ts`, and the probe's `begin` case in
`tests/store-chat-pg.test.ts`.

### SV4 — Glossary comments describe behaviour that changed

**Verdict: confirmed, C. Tier 1, P3. Safe to build** (a stale comment; no approval needed).

All three statements are there and false today:

- `routes.ts`, the `…/ask` row: *"The glossary's second POST, and it writes nothing."* —
  `term-lookup.ts` calls `deps.lookups.addTerm(slug, …)` once the answer finishes.
- Same row: *"No rate limit, and there is none to reuse. The sibling `lookup` POST has none
  either"* — `streamTermLookup`'s own header says *"the allowance's 429/503 are decided by
  `lookUpTerm`"*.
- `streamTermLookup`'s header: *"The asked term cancels, because nothing it produces outlives the
  page."* — it cancels, but a finished one is stored.

Sol's count of `orNullWhenNotMadeYet` call sites, re-run: `grep -c "orNullWhenNotMadeYet(" src/routes.ts`
→ 10. Correct, and it matches the Opus table.

The fix is the wording only. Whether Ask should take an allowance stays the owner's (Sol § For
the owner; Opus § For the owner 4).

## The two Opus findings asked about

### SVO1 = DB1 — Deleting or trimming a referee criterion that has a note on it is a 500

**Verdict: reproduced at the route, both paths. Tier 0, P1. The 409 and the trim skip are safe to
build; what Delete should do with the notes is the owner's.**

```text
[SVO1] criterion POST ended: done | note POST: 201 {"comment":{"id":"spya-e7fwaj",…,"criterionId":"spya-rtp234","status":"none"}}
[SVO1] DELETE answered: 500 { error: 'This app asked its database for something it would not do, … It has been recorded. [db-failed]' }
[SVO1] criteria after: [ 'spya-rtp234' ]
[DB1] seeded: 20 criteria; filler outcomes: [ 'done' ]
[DB1] 21st POST answered: 500 { error: '… [db-failed]' } | retry: 500 | criteria after: 20
 × deleting a criterion with a note placed on it is not a 500
 × adding the 21st criterion when the oldest has a note is not a 500
```

The second is the wedge both documents predicted: the retry is also a 500, and the referee can
neither add a criterion nor delete the one in the way.

**Smallest fix that is not a product decision** (two parts, one file each plus a helper):

1. *Trim.* In `pg-referee-criteria.ts` § `begin`, do not trim a criterion a comment references,
   the way a `pending` one is already skipped. Take Sol's DB1 form: lock the candidates
   `FOR UPDATE`, then check for references in a following statement, then delete. A single
   `DELETE … AND NOT EXISTS (…)` is one statement fewer but leaves a window where a note placed
   between its snapshot and its row lock still raises 23503 once. No schema change. The visible
   effect is that the list can stand at twenty plus those with notes; the alternative is the wedge
   above, so I would build it and tell the owner rather than ask.
2. *Delete.* In § `remove`, turn the violation of `comments_criterion_fk` into a 409 with fixed
   words. The refusal already happens; this changes only its status and sentence. It needs the
   third sibling Opus names in `db-errors.ts` (23503 by constraint name over the cause chain,
   beside `violatesConstraint` and `violatesCheckConstraint`). `src/web/useCriteria.ts` § `remove`
   removes the row optimistically; it should put it back on a refusal, or the 409 will read as a
   delete that worked until the next reload. That last line is in the client zone.

**The product decision.** What pressing Delete on a criterion with notes should *do*: keep
refusing (now with a sentence that says how many notes and what to do), or detach the notes (they
stay, and lose `criterion_id` and `valence` together, since `comments_valence_needs_criterion`
ties them), or offer both. Deleting the notes is already ruled out by the schema comment. Part 2
above is "refuse and say why", which is the first option and loses nothing whichever is chosen.

### SVO2 — `POST /api/live/<not-a-uuid>/…` is a 500

**Verdict: reproduced at the route, all three. Tier 0 by the letter, P2 (hand-made request only;
each one files a "bug here" report). Safe to build.**

```text
[SVO2] connected: 500 { error: '… [db-failed]' }      control (well-formed, unknown): 404 { error: 'No such live session.' }
[SVO2] usage:     500 { error: '… [db-failed]' }      control: 404 { error: 'No such live session.' }
[SVO2] close:     500 { error: '… [db-failed]' }      control: 404 { error: 'No such live session.' }
 × POST /api/live/not-a-uuid/connected is a 404   (and /usage, /close)
AssertionError: expected 500 to be 404
```

Fix as Opus says: `realtime-sessions-pg.ts` § `find` returns `null` for a non-UUID. `isUuid`
already exists in `src/ids.ts`; nothing to add. Each of the three handlers calls `find` first and
already answers `null` with the 404.

## Agreements (independent, so worth most)

| Sol | Opus | Schema | What |
|---|---|---|---|
| SV3 | SVO4 | — | anchor and `help` are not checked in `withTurn`; same fix, same postmortem (261005h) cited by both |
| — | SVO1 | DB1 | the criterion FK refuses and nothing translates it; DB1 found the trim path, SVO1 both paths |
| siblings table | siblings table | — | which streams stop on disconnect and which take an allowance: the two tables agree row for row where they overlap |
| "validation placement" table | § One level up | — | the same diagnosis: a refusal that exists at one layer and was not carried to the next |

## Disagreements, settled from the code

- **Tier of SV3/SVO4.** Sol: Tier 0. Opus: Tier 1. **Tier 1** — no client request reaches it (above).
- **Where `sameAnchor` goes.** Opus: `chat.ts`, "where `sameOrigin` already is". Sol: "an existing
  pure module". `sameOrigin` is in `src/types.ts`. **`types.ts`.**
- **Whether a route-level reproduction was possible.** Opus: no, without editing `TEST_LANES`.
  It was, with an untracked config (§ How this was checked).
- **Coverage.** Sol read `routes.ts` in part and found three defects in two handlers; Opus read
  all of its code and found none of SV1 or SV2. Neither document found the other's Tier 0s apart
  from SV3/SVO4. Read the two as complementary, not as one confirming the other.

## Missed by both

- **SV1 leaves a blank `done` answer, not a `stopped` one with text** (P1, part of SV1; output
  above). Worth an assertion in SV1's test so the fix is judged on what the reader sees.
- **The route comment that licenses SV1** (*"Whatever they would refuse, they refuse here"*) is the
  same kind of false guarantee SV3's two comments are. Three comments in one function claim a
  guarantee the code does not give; fix them with their findings.
- Nothing else new. I did not re-audit the rest of the zone.

## Build order

Tier 0 first, then ease × value. `routes.ts` overlaps are marked; everything touching it should go
in one worktree, in this order, or be merged with care.

| # | Item | Files | `routes.ts`? |
|---|---|---|---|
| 1 | **SVO1 / DB1** trim skip + 409 on delete | `src/store/pg-referee-criteria.ts`, `src/store/db-errors.ts`, `tests/store-parity-referee.test.ts`, `tests/referee-routes-postgres.test.ts`; client follow-on `src/web/useCriteria.ts` | no |
| 2 | **SV1** tail check before the abort | `src/routes.ts` § `streamChat`, `tests/chat-route.test.ts` | **yes — `streamChat`** |
| 3 | **SV2** frame the stored row | `src/routes.ts` § `answer`, `tests/comment-answer-stream-lifetime.test.ts` | **yes — `answer`** |
| 4 | **SVO2** non-UUID is `null` | `src/store/realtime-sessions-pg.ts`, `tests/live-session-routes.test.ts` | no |
| 5 | **SV3 / SVO4** anchor and help in `withTurn` | `src/chat.ts`, `src/types.ts`, `src/routes.ts` (drop the private `sameAnchor`, two comments), `tests/chat-origin-transaction.test.ts`, `tests/store-chat-pg.test.ts` | **yes — `streamChat`, same block as 2** |
| 6 | **SV4** three glossary comments | `src/routes.ts` | **yes — comments only** |

Clusters: **A** = 1 (no overlap with anything). **B** = 4 (no overlap). **C** = 2, 5, 3, 6 in one
worktree; 2 and 5 edit the same `inTurnOrder` callback and must be one change set, and Opus's SVO9
(one thread read instead of four in that callback) belongs with them if it is built. For the
owner: only the Delete question under SVO1.
