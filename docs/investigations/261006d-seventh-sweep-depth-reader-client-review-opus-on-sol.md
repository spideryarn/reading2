# Seventh sweep, depth: reader client — Opus's review of GPT Sol's investigation (read-only, 2026-10-06)

Reviewing [Sol's document](261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-sol.md)
against the code, with [Opus's](261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-opus.md)
for comparison, under [the cross-review brief](261006d-seventh-sweep-depth-prompt-cross-review.md).
Checkout `bf78e90c7`. No tracked file changed. One throwaway probe test was written, run and deleted
(`tests/zz-probe-wc1.test.tsx`); nothing else was run. No browser, no database, no model call.

Evidence states: **R** reproduced, **C** proved from the code, **H** hypothesis.

## Verdicts at a glance

| ID | Verdict | Evidence now | Tier | Build |
|---|---|---|---|---|
| WC1 | confirmed (value overstated) | **R** (was C) | 0 | safe to build, as one cluster with the server doc's SV2 |
| WC2 | confirmed | C | 0 | safe to build |
| WC3 | confirmed as a description; the proposed shape is overstated by one state | C | 2 | spike is safe to build; one behaviour inside it (WCO6) is the owner's |
| WC4 | confirmed | C | 1 | safe to build, with WC2 |

## WC1 — Comment answer frames overwrite newer reader edits on screen

**Confirmed, and now reproduced.** Traced: `useComments.ts` § `send` captures `pending` once, before
the POST. The `delta` branch does `const { replacing: _held, ...rest } = pending; put({ ...rest, id,
status: "pending", answer: text })`, the failure branch does `put({ ...pending, … })`, and `done` does
`put(done)` with the server's frame. `routes.ts` § `answer` → `settle` frames
`{ ...comment, ...patch }`, where `comment` is `claimed.comment` from `beginAnswer`; the list
`commentStore.patch` returns (`kept`) is used only as a truthy test. `pg-comments.ts` § `patchBody`
writes `body` and `updated_at` only, and `edit` is not queued behind `send` (the comment on
`patching` says so on purpose). `CommentDialog.tsx` mounts `CommentBody` for the owner with no
`status` gate.

The probe drove the real hook with a held SSE body and a fake server that applies a body PATCH to
its own column:

```
PROBE-A {"storedBody":"new","afterPatch":"new","afterDelta":"old","afterDoneOldServer":"old"}
PROBE-B {"storedBody":"new","afterDelta":"old","afterDoneFixedServer":"new"}
PROBE-C {"answerBeforePatch":"hello","answerAfterPatch":null,"statusAfterPatch":"pending"}
PROBE-D {"storedBody":"new","shownBody":"old","status":"error"}
```

- **A** is Sol's sequence with today's terminal frame: the screen says `old` after the delta and
  still says `old` after `done`, while the store holds `new`. That is WC1 and SV2 together.
- **B** is the same sequence with the terminal frame built from the stored row (SV2 fixed, client
  untouched): the end state heals, but the note still reads `old` for the length of the stream.
- **D** is the stream dropping with no `done`: the client's own failure branch leaves `old` on
  screen under an error, and no server change can reach it.
- **C** is the reverse interleaving Sol asked to be checked: a PATCH answer landing mid-stream
  replaces the whole row, so the streamed text (and `replacing`) vanish until the next delta.

**Corrections.** Value 4 is high. Only a legacy explanation row can be re-answered (`beginAnswer`
refuses anything else), the edit has to land inside a 15–25 second stream, the database is right
throughout, and a reload heals it. Value 2–3. It stays Tier 0 because of what the wrong screen
invites (H, not driven): `CommentBody` is seeded from `comment.body`, so a reader who edits the
stale `old` text and blurs saves over the `new` they wrote a moment before. That would be their own
words lost, not just a display fault.

**The fix, as a separate claim.** Sound, and it duplicates nothing: neither the PATCH queue nor
`readEvents` owns this. Three notes.

1. *Smallest change.* Client: in `begin`, `delta`, `done` and the failure branch, write through a
   functional `setComments` that takes the answer-owned fields (`status`, `answer`, `citations`,
   `searches`, `model`, `error`, the client's `replacing`) from the frame or the stream, and
   everything else from the row currently in state. Keep `put`'s append-when-absent for the
   re-minted id. Removal has to be explicit per field, as Sol says; a spread cannot clear `error`
   or `replacing`. Server: `frame("done", kept.find((c) => c.id === comment.id) ?? { ...comment,
   ...patch })`. No new query; no new store signature.
2. *Neither half alone closes it.* Server only: probes B and D. Client only: the screen is right,
   but `settle`'s comment still claims the frame carries *"what the store actually holds"*, and the
   next client to trust it inherits the bug.
3. *The reverse interleaving is real and Sol's fix does not cover it* (C). `edit`, `place` and
   `recolour` each replace the whole row with the PATCH's answer. A PATCH that commits before the
   answer finishes carries `status: "pending"`; if its response reaches the tab after the `done`
   frame (two connections, no ordering between them), the row goes back to a spinner that never
   stops. Mid-stream it is probe C. Closing the class means the three PATCH handlers keep the
   current row's answer-owned fields whenever an answer began on that id after the PATCH was sent.
   A per-id counter bumped in `send` is enough. This belongs in the same cluster.

It adds no refusal. It breaks nothing a reader relies on; a test that asserts the `done` frame
equals the begin snapshot spread would need updating (I did not find one, and did not run the two
database suites Sol names).

Sol's own dropped claim is right: `pg-comments.ts` § `patch` is an `UPDATE`, which cannot recreate a
deleted row, so the two comments in `send` that say *"the comment comes back on the next reload"* are
stale. `DELETE` on a missing id answers 200, so the re-sent `forget` is harmless. Correct the
comments in this cluster.

### Is WC1 one build cluster with SV2? Yes.

They are the client and server halves of one rule, *an answer stream owns the answer fields and
nothing else*, and each half's test needs the other half's behaviour pinned (probe B is only
meaningful once the server frames the stored row). Split, the second cluster re-derives the first
one's field list.

File set:

- `src/web/useComments.ts` — `send` (four branches), `edit` / `place` / `recolour` (note 3), the two
  stale comments.
- `src/routes.ts` — `answer` § `settle` only, and the last-resort `frame("done", …)` in the
  store-failure catch, which has no stored row to read and should say so.
- New, service-free: a hook test in the shape of `tests/recolour-write-order.test.tsx` with a held
  stream. Cases: edit then delta then `done`; body cleared; terminal-only (no delta); stream drops
  (probe D); PATCH answer after a delta (probe C); PATCH answer after `done`.
- Needs Postgres: one case in `tests/comment-answer-stream-lifetime.test.ts` (or beside it) for a
  body or colour PATCH landing between `beginAnswer` and `settle`, on both the `done` and the
  `error` ending.

Overlap: `src/routes.ts` is shared with the server zone's other findings (SV1, SV3 in `streamChat`).
Different functions, same 10,000-line file; put them in one worktree or land them in sequence.

## WC2 — A late bookmark can open over a newly selected Debate sub-mode

**Confirmed, C.** `Reader.tsx` § `subNav` subscribes eight keys including `debate: debateParam`;
`surface.current` and its dependency list name five sub-mode values (`learn`, `diagram`, `referee`,
`summary`, `structure`). `bookmarkBlock` and the held selection create both compare against that
snapshot. Reception → Claims changes none of the thirteen recorded values, so `unchanged` is true.
`git show --stat 4b502174a` (2026-10-03) touches `Reader.tsx` (15 lines) and not the snapshot. Not
reproduced: the existing test's harness is heavy and the omission is plain.

Value is low as Sol says: the window is one create round trip.

**The fix, as a separate claim.** Adding `subNav.debate` to both lists is the smallest change, costs
no render (the subscription exists), adds no refusal and breaks nothing. The other Debate parameters
(`debateby`, `bears`, `debatethread`) are filters written with `replace` and are rightly left out.
It does not close the class; see *Missed by both*, 1.

## WC3 — The read-result type and the Ideas spike

**The description is confirmed.** `useIdeasRead` holds seven `useState`s; the catch preserves
`status` unless it was `loading`; `IdeasPanel` gates on `owner.error`, `owner.status` and `ideas`
independently. Sol's consumer table is right (`IdeasMode`, `IdeasPanel`, `useSkim` § `ideasFirst`,
`SkimMode`, `MarginaliaColumn`; `Reader`, `Metadata` and `Dock` read no Ideas state). `PublicRead<T>`
is a different job; both documents say so and the code agrees. The count of `useOrderedRead` callers
among the twenty named hooks is 15, as Sol says (`grep -ln` → 15); across `src/web` it is 19 files
plus the module itself, which is Opus's figure. Both are right about different sets.

**The proposed shape is overstated in one place and under-specified in two.**

- `asking { previous }` is a state nothing draws. Today `reload` and `refresh` do not touch
  `status`; no Ideas consumer shows a refresh in flight, and the one mechanism that needs "a read
  that started after X landed" is the rewrite hold, which keeps sequence numbers in `FreshReads`.
  Adding it means a new transition at the start of every `load`, a re-render per refresh, and a new
  way to fail: a `load` that returns at `if (!current()) return` leaves the value in `asking` unless
  something else settles it. That is postmortem 261004f's class, added by the type meant to remove
  it. It also turns every consumer's `kind === "known"` test into a flicker during refresh
  (`MarginaliaColumn` and `SkimMode` both gate on "ready").
- `previous: null` (no answer) against `previous: { value: null }` (an accepted absence) is two
  nulls at two depths meaning different things. `read.previous?.value ?? null` conflates them
  silently.
- `failure: ReadFailure` names a type that does not exist (`grep -rn ReadFailure src/web` → nothing).
  `describeFetchFailure` returns a string and `ReadError` takes one.

Sol's rule that the union must be the hook's actual state, not something assembled at `return`, is
right and is adopted below. So is "the job and the hold stay beside the read, not inside it".

Sol's postmortem table and Opus's agree cell for cell once the wording is lined up: two prevented
(261006g's first half, 261005i), two only by a shared transition function rather than by the type
(261004c, 261004f), three not at all (261005q, 261005r, 261006b).

### The recommended spike shape

Opus's shape, less one field, with the transitions it names made concrete:

```ts
// src/web/read-state.ts — new, pure, no React.

/** What a component knows about one stored artefact. `A` is everything that arrived with it. */
export type Read<A> =
  | { kind: "asking" }                    // nothing known: the opening read, or Try again with nothing on screen
  | { kind: "failed"; error: string }     // nothing known, and the read failed
  | {
      kind: "known";
      answer: A | null;                   // null: the server said "none yet"
      recheck: string | null;             // the last re-read failed; `answer` still stands
    };

/** A read answered. */
export function landed<A>(answer: A | null): Read<A>;
/** A read threw. Keeps a known answer and says so; otherwise there is nothing to keep. */
export function failedRead<A>(was: Read<A>, error: string): Read<A>;
/** Try again was pressed. Today's rule: a value stays on screen, anything else goes back to asking. */
export function retrying<A>(was: Read<A>): Read<A>;

/** For the two seams that still take the four words: `useAutoRun`, and `useSkim`'s gate. */
export function statusOf(read: Read<unknown>): "loading" | "error" | "none" | "ready";

// src/web/useIdeas.ts
export type IdeasAnswer = {
  ideas: Ideas;
  stale: boolean;
  outdated: boolean;
  profiled: boolean;
  profileChanged: boolean;
};
// useIdeasRead: const [read, setRead] = useState<Read<IdeasAnswer>>({ kind: "asking" });
// IdeasRead and UseIdeas expose `read` and lose status / ideas / stale / outdated /
// profiled / profileChanged / error.
```

Why this one:

1. **It is exactly the states `useIdeasRead` can be in today, and no others.** (`loading`, null,
   null) → `asking`; (`error`, null, msg) → `failed`; (`none`, null, null|msg) → `known` with
   `answer: null`; (`ready`, V, null|msg) → `known` with a value. The 261004c combination (`none`
   with a failed read) is a field a consumer has to look past rather than a second variable it has
   to remember. `ready` with a null value cannot be written.
2. **The five facts that arrive with the answer are inside it.** Each branch of `load` resets them
   by hand today; Opus found Sketch's and Illustrated's empty branches not doing so. One `setRead`
   replaces seven setters.
3. **The three transitions are the only writers.** `load` calls `landed` or `failedRead`;
   `retryRead` calls `setRead(retrying)` and loses its `[ideas]` dependency. This is what makes
   261004c and 261004f structural rather than remembered, and it is a pure table a test can walk.
4. **`retrying` is where WCO6 lives, in one line.** Today a retry over *none yet* goes back to
   `loading` and a second failure ends at `error`, with the Generate button gone; Tweets keeps it.
   The spike encodes today's rule (`known` with a value stays; everything else → `asking`) and pins
   it. Whichever way Greg answers, the change is that line.
5. **`from: "server" | "copy"` is left out.** No Ideas consumer reads it; the hold gets provenance
   from `landed(started, res, identity)` in `FreshReads`, which stays. A field nothing reads fails
   the deletion test. Add it when Metadata or Search adopts the type and brings a reader for it.
6. **Three kinds, the words Greg approved**, rather than splitting `known` into `none` and `ready`.
   Narrowing on `read.answer !== null` is enough for the compiler, and `statusOf` covers the two
   seams that want four words.

Not in the spike: any shared hook, any shared fetch, the saved-list family (`loaded` / `loadError`,
which has no retry on purpose), and any new sentence or spinner on screen.

### Characterisation tests that must exist before the first edit

Already there, and to be kept green with mechanical edits only: `tests/read-error-matrix.test.tsx`
(Ideas is a row in the failed-opening-read table, in the malformed-success table at
`{ kind: "ideas", … }`, and in *Try again answered by a 404*), the Ideas row of
`tests/rewrite-hold.test.tsx`, `tests/artefact-read-race.test.tsx`,
`tests/a-broken-mode-leaves-the-article-readable.test.tsx`,
`tests/the-ideas-extraction-changed-no-requests.test.tsx`.

To add first, against today's code, each watched to fail under a deliberate one-line break:

1. **A list, then a failed refresh.** The list and `ReadError` are both drawn; the footer is as it
   was. Try again: the list stays through the retry, with no *Looking for the ideas…*, and the
   error is gone from the press.
2. **None yet, then a failed refresh.** `ReadError` and the empty state with *Find the ideas* are
   both drawn. Try again: *Looking…*, no button. A second failure: the error alone, no button.
   Label this test as today's behaviour and as the owner's open question (Opus's WCO6).
3. **A stale, profiled, profile-changed list, then a refresh that answers `null`.** `none`, with all
   four flags false; then a fresh list, with its own flags.
4. **A malformed 200 over a list** keeps the list and its flags (the existing row checks the
   artefact; add the flags).
5. **`useAutoRun` across the seam.** An armed press over `known` / null with a failed recheck spends
   once (it is `none` to `useAutoRun` today). An armed press over `failed` re-reads once and spends
   nothing.
6. **Skim's gate.** `ideasFirst` is true for none, for a failed opening read, and for a stale list;
   false for a current list with a failed recheck. `prerequisitesLoading` is true only while asking.
7. **The two read-only consumers.** `MarginaliaColumn` and `SkimMode` still draw a current list
   after a failed refresh, and draw nothing from a stale one.
8. **The hold across a failed re-read.** `rewriting` stays up, the identity is unchanged, and Try
   again releases it only on a read the server answered.
9. **The transition table itself**, once `read-state.ts` exists: every (state × event) cell, four
   states by three events.

### Stop condition

Stop, and do not migrate the other twelve, if any of these is true at the end of the spike:

- `useIdeasRead` still needs a `useState` beside the `Read` (the `FreshReads` refs do not count).
- A consumer other than `useAutoRun` and `useSkim` needs `statusOf`. It means the consumers are
  still thinking in the four words and the type is a wrapper.
- Non-comment lines across `useIdeas.ts`, `IdeasPanel.tsx`, `IdeasMode.tsx`, `useSkim.ts`,
  `SkimMode.tsx` and `MarginaliaColumn.tsx` did not go down, with `read-state.ts` allowed about
  forty; or `IdeasPanel` has more places that test two facts together than the three it has now.
- Any existing test needed a change to what it asserts, rather than to how it reads the state.
- Breaking one transition on purpose (say `failedRead` returning `asking`) turns no test red.
- It took more than two days.

And a second check before the rest, on paper: write Quotes (always mounted, forced run appends),
Glossary (local patches over the value) and Sketch (an empty answer that carries `faults`) in the
type. If Sketch's faults or Glossary's patches need a `useState` beside the `Read`, migrate only the
nine hooks that share Ideas' shape (the nine with `new MalformedReply`) and leave the other four
alone.

## WC4 — Debate sub-mode changes do not reset a failed band

**Confirmed, C.** `ModeBoundary.tsx` subscribes five parameters (no `debateParam`), and `subMode`
falls through to `""` for Debate, so `resetKey` is the same string for Reception and Claims on both
arms. `FeatureBoundary` clears `broken` only when `resetKey` changes. `DebateMode.tsx` reads
`debateParam` in both `DebateBand` and `VisitorDebateBand`, so the view selects a band for either
reader. `bandTarget` needs no change: activation gives Debate one fixed target for both views.

Tier 1 is right: it needs a throw in a Debate band, and none is shown.

**The fix, as a separate claim.** Smallest, passes the deletion test, no refusal. One caution: put
Debate with Summary and Structure (both arms), not inside the `owner ?` branch. The file's header
comment lists the sub-modes by name and needs the same line.

## Agreements

| Sol | Opus | What |
|---|---|---|
| WC3 | WCO10 and *The five questions* | Spike on `useIdeas`; `PublicRead<T>` is a different job; job and hold stay outside the type; never-had against no-longer-has is not this type; the same seven postmortem verdicts. |
| matrix rows Tweets, Skim | WCO4 | A 200 without its artefact commits `ready` in `useTweets` and `useSkim`. Both rate it unreachable from today's server. |
| matrix row Tweets | WCO6 | After 404 → fail → retry → fail, Tweets ends at `none` and the rest at `error`. Sol records it as written policy; Opus raises the other twelve as the owner's question. |
| matrix, column K | sibling table preamble | Article and reader changes reset the hooks only by remount (`key={slug}`, `useArticleAccess`). |
| *Considered* | *Considered* | No generic artefact-read hook, no `Reader.tsx` split, no mode registry, no passage reducer. |

## Disagreements, settled from the code

1. **Does the type need a refresh in flight over a known answer?** Sol yes, Opus no. **Opus.**
   Nothing draws it, and the hold has its own clock. See WC3.
2. **Crossrefs clearing its links on a failed read.** Sol's matrix calls it a written, deliberate
   quiet enhancement; Opus's WCO2 calls it a Tier 0 defect and reproduced it. **Opus.** The catch's
   comment (*"Nothing to say in the prose, and nothing to retry from"*) gives a reason for silence,
   not for discarding links already drawn, and it predates the hook refreshing on every finished
   `crossrefs` job (`useJobs("quiet", onFinished)`). Sol is right that it should stay silent.
3. **Where the answer came from, inside the type?** Opus yes (`from`), Sol keeps it outside.
   **Sol, for the spike.** No Ideas consumer reads it.
4. **Size of the "considered" list.** Sol set aside Criteria's stream lacking Search's slug token
   as unreachable under `key={slug}`; Opus did not look. No contradiction; nothing to settle.

Each document missed the other's live defects outright: Opus has nothing on WC1, WC2 or WC4, and Sol
has nothing on WCO1 (the quiz's always-mounted read not hearing its step finish, R) or WCO3 (the
rewrite hold absent from seven hooks). I did not re-trace Opus's findings here.

## Missed by both

1. **WC2 and WC4 are one class with a compiler-checkable fix** (P3). `sub-modes.ts` exports
   `ModeWithSubModes`, a union of six. `Reader.tsx` § `surface` and `ModeBoundary.tsx` § `subMode`
   are the only two hand lists of five (`grep -rl structureParam src/web`, then `grep -c
   debateParam`: `ModeBoundary.tsx` 0). A `Record<ModeWithSubModes, …>` or an exhaustive `switch`
   in `ModeBoundary`, and `surface` built from `subNav`'s sub-mode values, makes a seventh sub-mode
   a compile error in both instead of a third sweep finding. Small; same cluster.
2. **A comment PATCH answer arriving after the `done` frame leaves a spinner that never stops**
   (P1, C; mid-stream form reproduced as probe C). Detailed under WC1, note 3.
3. **A stale note on screen invites a save over the newer one** (P0 if it happens, H). Under WC1.

## Build order

Tier 0 first, then ease × value. File-set overlaps are marked.

1. **Cluster A — comment rows under an answer stream.** WC1 + SV2 + the reverse interleaving + the
   two stale comments. `src/web/useComments.ts`, `src/routes.ts` § `answer`, one new service-free
   hook test, one Postgres case. *Overlap:* `src/routes.ts` with the server zone's SV1 and SV3.
2. **Cluster B — Debate's sub-mode in the two lists.** WC2 + WC4 + the derived check.
   `src/web/reader/Reader.tsx` § `surface`, `src/web/reader/ModeBoundary.tsx`, optionally
   `src/web/sub-modes.ts`, and the two tests Sol names. *Overlap:* `Reader.tsx` with any other
   cluster that touches it; none of Sol's or Opus's other code findings do.
3. **Opus's two reproduced defects**, not reviewed here, listed so the worktrees do not collide:
   WCO1 (`useQuiz.ts`, `tests/always-mounted-reads-refresh.test.tsx`) and WCO2 (`useCrossrefs.ts`).
   Disjoint from A, B and each other.
4. **Opus's WCO4** (`useTweets.ts`, `useSkim.ts`, `tests/read-error-matrix.test.tsx`). *Overlap with
   5* on `useSkim.ts` and the matrix test: land it first, or in the same worktree.
5. **Cluster C — the Ideas spike (WC3).** Characterisation tests first, as their own commit.
   `src/web/read-state.ts` (new), `useIdeas.ts`, `IdeasPanel.tsx`, `modes/ideas/IdeasMode.tsx`,
   `useSkim.ts`, `modes/skim/SkimMode.tsx`, `marginalia/MarginaliaColumn.tsx`. Ends at the stop
   condition, not at a migration.

For the owner, from this review: only WCO6's question (should *Generate* survive a failed *Try
again* over an empty mode), which the spike isolates to one line and does not answer.
