# One type for a read, spiked on `useIdeas`

A cluster of the [seventh sweep](261006m-seventh-codebase-sweep-depth-umbrella.md) (its item C5),
and item 5 of the [sixth](261006j-sixth-codebase-sweep-umbrella.md): seven postmortems in three days
named the class "a read is a value plus booleans", and one of them named the fix.

**Status: the spike is complete (2026-10-07). Stage 1 (the characterisation tests) and stage 2a (one
answer object inside `useIdeasRead`) landed on `dev`. Stage 2b (the shared `Read<A>` union) was
built, measured and NOT landed; it is kept on branch `worktree-sweep7-read-type-spike` at
`781589b13`. Rolling a read type out further is not planned, and would be a new recommendation to
the owner. The evidence is [§ What the spike found](#what-the-spike-found) and the reasons are
[§ The decision](#the-decision); the text between here and there is the plan as it was written.**

## What Greg approved

The question the sixth sweep put to him was whether the class is worth its own plan. Greg,
2026-10-06: *"Yes re the separate on/off flags, as you see fit"*. The recommendation he accepted was
the Overseer's: a one-hook spike first, then decide. So what is approved is the spike and, if it
passes, the staged migration. If it does not pass, the work stops and this doc says why.

## The problem, in plain words

Each mode asks the server for its stored result (the Ideas list, the Glossary, and so on). At any
moment that read is in one of a few states: still asking, failed, or answered (and the answer may
be "none yet"). Today each hook keeps that as several separate variables: a status word, the value,
an error string, and two to five flags that arrived with the answer. Nothing stops them disagreeing,
and each panel has to remember which combinations can happen. Postmortems
[261004c](../postmortems/261004c-an-empty-artefact-state-can-still-carry-a-failed-read.md) and
[261006g](../postmortems/261006g-a-read-still-out-drawn-in-the-words-of-a-read-that-failed-and-one-failure-final.md)
are a panel forgetting one.

## What the two investigations found

Both families read the thirteen artefact hooks and both chose `useIdeas` for the spike
([GPT Sol § WC3](../investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-sol.md),
[Opus § WCO10](../investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-opus.md)).
The honest size of the win, which both state: **the type prevents two of the seven postmortems
outright (261004c, 261006g), two more only if the transitions are shared functions (261004f,
261005i), and three not at all** (261005q, 261005r, 261006b are about ordering and provenance, which
`useOrderedRead` and the rewrite hold own). And the sixth sweep's wording was off: the artefact
hooks are already a four-word status plus a nullable value plus an error string, not booleans; the
boolean form is the saved-list family (Claims, Criteria, Search, Comments) and the Metadata page,
which this plan does not touch.

They disagreed on the shape. Sol's had `asking` and `failed` each carry a `previous` answer; Opus's
had four states and three transition functions. The
[Opus review of Sol's doc](../investigations/261006d-seventh-sweep-depth-reader-client-review-opus-on-sol.md#the-recommended-spike-shape)
settled it from `useIdeas.ts`: nothing draws "asking again over a known answer", so that state would
be one nothing reads and one a hook could get stuck in.

## The shape

```ts
// src/web/read-state.ts — new, pure, no React.
export type Read<A> =
  | { kind: "asking" }                 // nothing known: the opening read, or Try again with nothing on screen
  | { kind: "failed"; error: string }  // nothing known, and the read failed
  | {
      kind: "known";
      answer: A | null;                // null: the server said "none yet"
      recheck: string | null;          // the last re-read failed; `answer` still stands
    };

export function landed<A>(answer: A | null): Read<A>;
export function failedRead<A>(was: Read<A>, error: string): Read<A>; // keeps a known answer
export function retrying<A>(was: Read<A>): Read<A>;                  // today's rule, pinned
export function statusOf(read: Read<unknown>): "loading" | "error" | "none" | "ready";
```

`useIdeasRead` holds **one** `useState<Read<IdeasAnswer>>`, where `IdeasAnswer` is the list together
with the four flags that arrive with it (`stale`, `outdated`, `profiled`, `profileChanged`). The
three functions are its only writers. `statusOf` exists for the two consumers that want the four
words (`useAutoRun`, `useSkim`) and for nobody else.

**It is a type for a result, not a shared hook.** Parsing, the 404 rule, the copy and the verbs stay
in `useIdeas`; ordering stays in `useOrderedRead`; a running job and a rewrite hold are not read
states and stay in `useStepJob` and `useRewriteHold`. That is the line between this and the "generic
artefact-read hook" the fifth sweep rejected, and the stop condition below is what checks the line
held.

## The simpler options passed over

- **Do nothing; rely on `tests/read-error-matrix.test.tsx`.** It exists and is the cheap half. It
  catches a hook that forgets a case only for the rows somebody wrote; its malformed-refresh rows
  cover four hooks. Kept, not replaced.
- **A union built at the return statement, over the old variables.** Cheaper, and worthless: the
  variables can still disagree. Sol's rule, adopted: the union is the hook's actual state.

## Stages

Each ends green and committable. Files: `src/web/read-state.ts` (new), `src/web/useIdeas.ts`,
`src/web/IdeasPanel.tsx`, `src/web/modes/ideas/IdeasMode.tsx`, `src/web/useSkim.ts`,
`src/web/modes/skim/SkimMode.tsx`, `src/web/marginalia/MarginaliaColumn.tsx`, and tests.

1. **Characterise.** The nine tests listed in the
   [review](../investigations/261006d-seventh-sweep-depth-reader-client-review-opus-on-sol.md#characterisation-tests-that-must-exist-before-the-first-edit),
   against today's code, each watched to fail under a deliberate one-line break. Its own commit. If
   a behaviour being pinned looks wrong, it is a finding, not a spec: test 2 (after a 404, a failed
   read and a failed *Try again*, the *Find the ideas* button is gone) is pinned as today's
   behaviour and is question Q-retry-button for Greg in the umbrella.
2. **The spike.** `read-state.ts` with its transition-table test; `useIdeasRead` on one `Read`;
   the consumers moved. No reader-visible change: no new sentence, spinner or button. Then measure
   against the stop condition, write the result here, and get GPT Sol's code review.
3. **Only if it passed — on paper first.** Write Quotes, Glossary and Sketch in the type. If
   Sketch's `faults` or Glossary's local patches need a `useState` beside the `Read`, the migration
   is the nine hooks that share Ideas' shape and the other four are left alone, with the reason
   written into each.
4. **Migrate in batches** of two or three hooks with disjoint consumers, each batch its own commit
   and review: add beside the old, move, delete the old. While both forms exist a fix lands in both.
5. **Delete the old shape** (`ArtefactStatus` as a stored state, if nothing but `statusOf` produces
   it), after a grep for readers rather than the batch list.

## Stop condition (decided before the spike, so it cannot be argued with afterwards)

Stop after stage 2, keep or revert the spike on its merits, and do not migrate, if any is true:

- `useIdeasRead` still needs a `useState` beside the `Read` (the `FreshReads` refs do not count).
- A consumer other than `useAutoRun` and `useSkim` needs `statusOf`: the consumers are still
  thinking in four words and the type is a wrapper.
- Non-comment lines across the six existing files did not go down (with `read-state.ts` allowed
  about forty), or `IdeasPanel` tests two facts together in more places than today.
- An existing test needed a change to **what it asserts**, not just to how it reads the state.
- Breaking one transition on purpose (`failedRead` returning `asking`) turns no test red.
- The hook is harder to read. This one is a judgement; the Sol code review is asked it directly,
  and so is an Opus reader who has not seen the old version.

## Done when

Stage 2: `npm run typecheck`, the Ideas, Skim, Marginalia, read-error-matrix, rewrite-hold and
artefact-read-race suites, `doc-links`, and a browser pass over Ideas (opening, none yet, a forced
failed read, Try again) at desktop and phone width showing nothing changed. `web-client.md` gains a
paragraph under § Shared code (client) only if the type stays.

## What the plan review changed

[GPT Sol's review](261006n-one-type-for-a-read-spiked-on-useideas-review-sol.md), read-only, verdict
**ready with these fixes, for the one-hook spike only**. Eight findings, all accepted. **Where this section and the text above differ, this section wins.** The shape,
stages and stop condition are the orchestrator's (Claude's), not Greg's.

- **R1 (accepted, after the umbrella's review raised it again as U5).** The authorised work ends at
  the spike and its written evidence. The session's brief does say to migrate the rest if the spike
  passes, but Greg's own words are "a one-hook spike first, then decide", and a change that touches
  every mode is worth a day's wait. So stage 2 ends with **a recommendation, with the evidence, in
  this doc**, sent to Greg through the Overseer. Stages 3 to 5 are what would follow a yes.
- **R2.** `useFreshReads` holds a `useState`, not only refs. The gate is **"no independently stored
  duplicate read fact"**; all `FreshReads` bookkeeping stays exactly as it is.
- **R3. The transitions, pinned:**
  - an accepted `null` or a validated answer: `setRead(landed(answer))`;
  - a failure, after `current()` passes: `setRead((was) => failedRead(was, message))`. It keeps a
    known answer, **including a known `null`**, replacing `recheck` with the newest error;
    otherwise `failed`;
  - *Try again* only: `setRead(retrying)`, then `reload()`. It keeps a known non-null answer and
    clears its `recheck`; every other input becomes `asking`;
  - **an ordinary `reload` or `refresh` makes no transition at its start**;
  - updates are functional, so `load` does not close over `read` and its identity (which
    `useOrderedRead` keys on) does not change; both post-`await` `current()` checks and the catch's
    stay.
- **R4. The claim is weaker than "prevents two outright".** One atomic value stops the stored facts
  contradicting each other; passing the whole read keeps the distinctions across a prop; but a
  consumer can still write `known && answer === null` and ignore `recheck`. The compiler does not
  force a failure to be drawn: the tests do. Failure presence is `recheck !== null`, never
  truthiness.
- **R5.** `statusOf` is for the `useAutoRun` boundary only (known-null is `none`, known-with-answer
  is `ready`, whatever `recheck` says, or a failed recheck would change what is spent). `useSkim`
  reads the union directly.
- **R6. More characterisation tests**, beyond the nine: a refresh and an automatic re-read each
  **held open** with the screen read while it is out; a second failed retry over a list, and over
  none; two failures with different messages; fixtures where every one of the four flags is
  non-default; `profileHash: ""`; a late **failure** for a previous slug, not only a late success;
  all six observable classes (asking, failed, known-none, known-none with a failed recheck,
  known-list, known-list with a failed recheck). The transition-table test does not prove the hook
  is wired to it: every mutation check must turn an **integrated** hook-or-panel assertion red.
- **R7. The stop condition, revised.** Total production lines including `read-state.ts` are
  evidence, not a threshold. Required: the duplicate read storage is deleted; visible behaviour,
  requests and spending are unchanged; an assertion about the removed interface may change, a
  behavioural one may not. The readability reviewer is given **both versions**.
- **R7 / verdict: compare with the smaller change first.** Before deciding to roll out, build (in
  the same worktree, as a separate commit or a scratch branch of the file) the smaller option Sol
  names — one nullable `IdeasAnswer` object holding the list and its four flags, with `status` and
  `error` kept — and compare. The full union stays only if hook and panel are clearer than that.
- **R8.** There is no "nine hooks that share Ideas' shape": that set, picked by `MalformedReply`,
  includes Glossary (pending hide writes), Citations (local investigations), Quiz (saved attempts)
  and Simple (a retained job preview), and Sketch's empty answer carries `faults` that
  `answer: null` cannot. **Stage 3 is a compatibility decision per hook**, written down; a migrated
  hook has one read store and may keep independent operation state.

## Review status

- Plan: GPT Sol, read-only, 2026-10-06, **ready with these fixes, for the spike**; applied above. No
  second round: the fixes narrow the work, and the code gets its own review.
- Code: [GPT Sol](261006n-one-type-for-a-read-spiked-on-useideas-code-review-sol.md), read-only,
  2026-10-07, verdict **"Land 1 + 2a"**
  ([the prompt](261006n-one-type-for-a-read-spiked-on-useideas-code-review-prompt.md)). It reviewed
  the spike branch, whose tree was at 2b; the landing was then put together as it said. Seven
  findings, none P1:
  - **R1 (P3).** The seven postmortems support a narrower benefit than either side claimed.
    *Done:* its table is in [§ The decision](#the-decision), as the case for 2b.
  - **R2 (P3).** The compiler experiment disproves "prevents outright" but does not measure
    maintainability; removing `answerOf` and `failureOf` still refuses neither mistake. *Done:*
    the decision describes it in Sol's words, as a limit on compiler guarantees.
  - **R3 (P3).** No reader-visible regression in 2a; one runtime normalisation (a missing or null
    flag in a reply now reads `false`, where the old setters could publish `undefined` or `null`).
    *Done:* checked again at landing. `load` depends on `[slug, begin, landed]`, the three
    `current()` checks and every `FreshReads` call are as they were, the failure's status update is
    functional, and no consumer compares any of the four flags with `undefined` or `null`.
  - **R4 (P3).** Stage 1 is useful characterisation, not exhaustive. *Done in part:* the held
    ordinary refresh over an existing recheck error is added, and watched red (a `setError(null)`
    at the start of `load`). *Not done:* the paired manual-button tests (unforced `ensure` against
    forced regeneration), which is a follow-up; 2a changes neither path.
  - **R5 (P3).** The first `current()` check is redundant for state commits but not dead: it stops
    an obsolete body being read, parsed and logged. *Done:* a test with a spy on the late reply's
    body, watched red with the check removed. The finding above that says it "cannot be observed
    on its own" is true of state and false of the body.
  - **R6 (P3).** Both picture-hook flag leaks confirmed. *Done:* not fixed here; named in the
    decision as what happens next.
  - **R7 (P2).** Carry the `fresh` fixture field and the two footer-test rows from 2b, keep stage
    1's `seen()` adapter, and make this doc's status and authority unambiguous. *Done,* all four.

## What the spike found

Built 2026-10-07 on branch `worktree-sweep7-read-type-spike`, not pushed. Three commits, each green:

| Commit | What |
|---|---|
| `f36f463c7` | Stage 1: `tests/ideas-read-states.test.tsx` (new) and three tests in `tests/skim-panel.test.tsx`, against the code as it was. No source change. |
| `751cab265` | Stage 2a, the smaller change: the list and its four flags as one `IdeasAnswer \| null` inside `useIdeasRead`; `status`, `error` and everything the hook returns unchanged. One file. |
| `781589b13` | Stage 2b, the full union on top: `src/web/read-state.ts`, `useIdeasRead` on one `Read<IdeasAnswer>`, five consumers moved, ten test files changed in how they read or pose the state. |

**The recommendation is at the end: land stages 1 and 2a, do not land 2b.** What follows is the
evidence, including the parts that point the other way.

### 2a against 2b, measured

Non-comment, non-blank production lines (block comments stripped, then blank and `//` lines dropped):

| File | Before | After 2a | After 2b |
|---|---|---|---|
| `src/web/read-state.ts` | – | – | 33 |
| `src/web/useIdeas.ts` | 150 | 162 | 126 |
| `src/web/IdeasPanel.tsx` | 276 | 276 | 280 |
| `src/web/modes/ideas/IdeasMode.tsx` | 141 | 141 | 143 |
| `src/web/useSkim.ts` | 159 | 159 | 161 |
| `src/web/modes/skim/SkimMode.tsx` | 485 | 485 | 485 |
| `src/web/marginalia/MarginaliaColumn.tsx` | 642 | 642 | 644 |
| **Total** | **1853** | **1865** | **1872** |
| The six existing files alone | 1853 | 1865 | 1839 |

| Measure | Before | After 2a | After 2b |
|---|---|---|---|
| `useState`s in `useIdeasRead` (`FreshReads` untouched, not counted) | 7 | 3 | 1 |
| Places a consumer tests two separately stored read facts together | 6 | 6 | 3 |
| – of those, in `IdeasPanel` | 3 | 3 | 3 |
| `statusOf` call sites in production | – | – | 1 (`useIdeas`, for `useAutoRun`) |
| `answerOf` / `failureOf` call sites in production (helpers the plan did not list) | – | – | 5 / 1 |
| Existing test files edited | 0 | 0 | 10 |
| `expect(…)` lines changed in an existing test | 0 | 0 | 0 |
| Biome's cognitive complexity for `IdeasPanel` (limit 25) | under | under | 27 |

How the "two facts" row was counted. Before: the panel's footer gate (`ideas`, `status`, `stale`,
`error`), its list gate (`ideas` with `status`) and its badge (`ideas` guarding `profiled`);
`useSkim`'s `status === "ready" && stale`; `SkimMode`'s `status === "ready" ? ideas`;
Marginalia's `status === "ready" && !stale ? ideas`. After 2b a test that narrows one value
(`kind === "known" && answer !== null`) is not counted, which is the review's R7 point; what is
left is the panel's same three, two of them because `IdeasAccess` hands the owner's list down a
second time beside the read.

2a's twelve extra lines are the `IdeasAnswer` declaration and a return statement that spells the
five old fields out of it. 2b's hook is 24 lines shorter than the original and 36 shorter than
2a's; the consumers grow by 10 between them, and the new module is 33.

### The stop condition, line by line (as revised by R7)

- **A `useState` beside the `Read`, or any independently stored duplicate read fact?** No. One
  `useState<Read<IdeasAnswer>>`; `useFreshReads` is called exactly as before.
- **A consumer other than the `useAutoRun` boundary needs `statusOf`?** No: one production caller.
  But two more readers were needed that the plan did not have: `answerOf` ("the answer if there is
  one", five callers) and `failureOf` ("the failure to say", one). And the test helper calls
  `statusOf`, because three tables walk Ideas beside sibling hooks that still publish four words.
- **Lines** (evidence, not a threshold): the six existing files went down by 14; with
  `read-state.ts` the total went up by 19. 2a went up by 12. **`IdeasPanel` tests two facts together
  in more places than today?** No, the same three; and it is the one file that got measurably harder
  for the linter to follow.
- **The duplicate read storage is deleted?** Yes.
- **Visible behaviour, requests and spending unchanged?** Yes by every test: the 51 in
  `tests/ideas-read-states.test.tsx` read the screen and count GETs and POSTs, and pass on all three
  commits without an assertion changing. **No browser pass was done**; the plan's "Done when" asks
  for one and it is outstanding if 2b is kept.
- **An existing test needed a change to what it asserts?** No. Zero `expect(…)` lines changed. Ten
  files changed how they read or pose the state: seven wrap the hook in
  `tests/helpers/ideas-read-fields.ts § flat`, three build a posed owner with its `ideasReadFrom`,
  and the stage-1 file changed its one adapter, `seen()`.
- **Breaking a transition turns an integrated test red?** Yes: 51 breaks of the 2b code, all red
  through the hook-and-panel suite rather than the transition table. They include the five the brief
  named (`failedRead` returning `asking`; `retrying` keeping a known null; a transition at the start
  of an ordinary reload; `statusOf` letting `recheck` change `none` or `ready`; each of the four
  flags dropped). One is red by hanging: `load` closing over the read re-reads for ever. One was
  green at first, removing the footer's `!stale` gate, and a test was added for it; that gap was in
  the original code too.
- **Harder to read?** Not answered by a reviewer: this stage ran without the Sol code review or the
  Opus reader, which the plan asks for and which should be given both versions. The builder's own
  reading: the hook is clearer, the panel is not.

### What 2b gives that 2a does not, compiled

Wrong consumer code was written twice in a scratch file, once against 2a's interface and once
against 2b's, and compiled with `tsc -p src/web/tsconfig.json`. The scratch file is deleted; these
are its results.

| Case | 2a | 2b |
|---|---|---|
| **A. Postmortem 261004c.** The empty state is drawn and the failed re-read is never looked at. | compiles | **compiles** |
| **B. Postmortem 261006g.** The page hands a child only "the list or null", so the child cannot tell asking from failed. | compiles | **compiles** (`answerOf(read)?.ideas ?? null`) |
| **C. 261006g, the other way.** The child takes the whole read, switches on it with a `never` default, and forgets "still asking". | refused | refused |
| **D.** A state that cannot happen, posed: ready, with no list, stale and profiled. | compiles | refused |
| **E.** A fact read where it does not exist: `stale` under "none yet"; the error of a read still out. | compiles | refused |
| **F.** The right code: draw the list when status says there is one. | refused (`ideas` is possibly null), so the consumer tests two facts | compiles |

```
C, 2a  (57,13): error TS2322: Type '"loading"' is not assignable to type 'never'.
C, 2b  (69,13): error TS2322: Type '{ kind: "asking"; }' is not assignable to type 'never'.
D, 2b  (86,82): error TS2353: Object literal may only specify known properties, and 'stale' does not exist in type '{ kind: "known"; answer: IdeasAnswer | null; recheck: string | null; }'.
E, 2b  (93,63): error TS18047: 'o.read.answer' is possibly 'null'.
E, 2b  (99,44): error TS2339: Property 'error' does not exist on type '{ kind: "asking"; }'.
F, 2a  (104,33): error TS18047: 'o.ideas' is possibly 'null'.
```

So the plan review's R4 is confirmed and is the central finding: **2b's types refuse neither of the
two postmortems the plan was written to prevent.** A consumer can still draw "none yet" and ignore
`recheck`, and can still pass a child less than the whole read; the helper that makes consumers
short, `answerOf`, is exactly the two-state door of 261006g. What stops both is the stage-1 tests,
which hold a read open and read the screen. What 2b's types do refuse is D and E: a contradictory
state, and a fact read where there is none. D is real (a fixture in
`tests/no-profile-row-beside-paid-buttons.test.tsx` posed exactly it: `status: "ready"` with
`ideas: null`), but no production code in `useIdeas` could reach it: the stage-1 adapter threw on any
such combination for as long as the flat fields existed and never fired outside a deliberate break.

2a alone already gives one compile-time gain: a flag left out of the answer object is a compile
error, where a forgotten `setStale` was a stale `false`.

### Three other hooks, on paper (R8)

- **`useQuotes`** (always mounted; a forced run that appends). **Fits, with nothing beside the
  read.** Its read state is `useIdeasRead`'s line for line: `Read<QuotesAnswer>` with the same four
  flags. Being always mounted is `useStepFinished` calling `refresh`, and the appending run is the
  rewrite hold keyed on `generatedAt`; neither is read state.
- **`useGlossary`** (local patches over the value; pending hide writes). **Fits one read store, but
  not the three writers.** `panelRun` goes inside the answer. `patchEntry` rewrites one entry of a
  known answer in place, which is a fourth writer the transition table does not have; the reset when
  the slug changes under an always-mounted read is a fifth (back to `asking`). The pending hides
  (`hiding` and its refs) and the look-up and ask-a-term state are operations, independent, and stay
  as they are.
- **`useSketch`** (an empty answer that carries `faults`). **Does not fit as the type stands.** A
  sketch can be read and have no usable scene: today that is `status: "none"` with `faults` set, a
  third thing between "none yet" and "a picture". `answer: null` cannot carry the faults, and an
  answer of `{ sketch: null, faults }` makes the shared `statusOf` say `ready`, which would stop
  `useAutoRun` drawing one. It needs its own answer shape (a picture, or the faults of one that
  could not be used) and its own four-word mapping. Writing it out also confirmed what Opus's
  investigation said: that branch sets `sketch`, `faults` and `drawn` and **leaves `stale`,
  `outdated`, `profiled` and `profileChanged` from the previous answer** (`useSketch.ts`, the
  `checked.scenes.length === 0` branch). `useIllustrated`'s second "none" branch does the same. That
  is the bug 2a's shape removes, live, in two hooks this spike was told not to touch.

So R8 holds: there is no set of hooks "that share Ideas' shape" to roll out to mechanically. Of
these three, one is a copy, one needs more writers than the table has, and one needs a different
type.

### What the plan and the investigations got wrong, or did not say

- **"The type prevents two of the seven postmortems outright"** (this plan, § What the two
  investigations found). False, as R4 already said and cases A and B now show by compiling.
- **The files list** named seven source files and "tests". The tests were the larger half: ten
  existing files. Two of them reach the hook through a cast (`as { status: string }` in
  `tests/artefact-read-hooks.test.tsx`, `SevenRead` in
  `tests/none-yet-is-not-a-404-hooks.test.tsx`), so the compiler did not report the removed fields
  there; they would have failed only at run time.
- **"`statusOf` … for the two consumers that want the four words"** undercounts what consumers
  want. One wanted four words. Five wanted the answer or null, and one the failure or null.
- **`outdated` is read by no production consumer of the Ideas read.** The panel's banner for it
  went in plan 260929c and `useSkim` ignores it on purpose. It is carried, typed and tested, and
  drawn nowhere.
- **The `current()` check straight after `apiFetch` cannot be observed on its own**: the check
  after the body is read catches every reply the first one does. Removing it alone turned nothing
  red, in the original code and in 2b. Kept, as R3 says.
- **Neither investigation priced the tables.** Three suites walk every artefact hook through one
  sequence by field name. While migrated and unmigrated hooks coexist, each migrated row needs an
  adapter back to the flat fields, which is what `flat` is.

### Recommendation

**Land stage 1 and stage 2a. Do not land 2b, and do not roll the union out.** Then give 2a's shape,
one nullable answer object, to the hooks that reset flags by hand, starting with `useSketch` and
`useIllustrated`, where a reset is already missing.

The reason, in the order it weighs:

1. **The stated purpose is not met.** The plan exists because of 261004c and 261006g, and 2b's
   compiler accepts both mistakes. What catches them is a test that holds the read open, and those
   tests now exist for Ideas and are independent of which shape the hook has.
2. **The review's own bar was "the full union stays only if hook and panel are clearer than 2a."**
   The hook is: three writers, a retry with no dependency on state, 36 fewer lines than 2a. The panel
   is not: the same three joint tests, four more lines, three derived locals at the top, and the
   linter's complexity over its limit for the first time.
3. **The cost of rolling out is mostly tests, and it repeats.** One hook took ten test files. Its
   siblings are rows in the same three tables, so each migration either grows the adapter or waits
   for a single switch at the end, with both forms in the tree for the whole of it.
4. **The paper exercise found one hook in three that is a copy.** Glossary needs writers the table
   does not have and Sketch needs a different type, so the "one type" would be one type with local
   exceptions from the second batch on.
5. **2a's benefit is the one with a live instance.** Flags outliving their list is the class with a
   bug in the tree today (Sketch), and 2a removes it in one file with no consumer or test touched.

What to land: **`f36f463c7` and `751cab265`**, plus one line from `781589b13` that stage 1 needs
since the rewrite-hold cluster landed on `dev`: the posed Quotes read in
`tests/ideas-read-states.test.tsx` needs `fresh` (and that commit's added footer test is worth
taking with it; under 2a its adapter stays as stage 1 wrote it). `781589b13` stays on the branch for
whoever wants to read the union in place.

**The strongest argument against this recommendation.** The hook is where all seven postmortems
were written, and 2b's hook is plainly the better one: every way the state can change is one of
three named functions with a table test, and a combination that means nothing cannot be stored.
"The tests catch it" is what was true, in principle, before each of the seven. The spike also
measured 2b at its worst: the first hook pays for `read-state.ts` alone, the panel's extra weight is
partly `IdeasAccess` carrying the list twice (fixable, and out of this spike's scope), and the
adapters in the tests exist only while the two forms coexist. Somebody who expects to touch these
thirteen hooks often over the next six months could reasonably pay the one-off churn for a shape in
which the next hook cannot forget a transition. If that is the view, the order would be Quotes,
then FAQ, Timeline and Debate (the read halves Marginalia uses), with Glossary and Sketch each
decided on their own and last.

## The decision

Made 2026-10-07 by the orchestrator (Claude), after the builder's recommendation above and GPT Sol's
[code review](261006n-one-type-for-a-read-spiked-on-useideas-code-review-sol.md), which reached the
same answer independently. What Greg approved was "a one-hook spike first, then decide", and nothing
more: what to keep from the spike is not his decision and is not attributed to him.

**Landed: stage 1 and stage 2a. Not landed: stage 2b.**

- **Stage 1** (`f36f463c7`) is `tests/ideas-read-states.test.tsx` and three cases in
  `tests/skim-panel.test.tsx`. They hold a read open and read the screen, which is what actually
  catches a panel that forgets a state. They do not depend on how the hook stores anything.
- **Stage 2a** (`751cab265`) keeps the Ideas list and the four flags that arrive with it as one
  object inside `useIdeasRead`, so the flags cannot outlive the list. One source file,
  `src/web/useIdeas.ts`; the hook returns exactly what it did; no consumer and no existing test
  changed.
- From 2b, three things in the stage-1 test file and nothing else: the `fresh` field on its posed
  Quotes read (without it the file does not typecheck on `dev`), and the two footer rows for the
  `!stale` gate no test covered. Two tests were added at landing, for the review's R4 and R5.

**Why not 2b**, in plain words. It was written to stop two mistakes a consumer can make: drawing
"none yet" while a failed re-read goes unsaid (261004c), and handing a child less than the whole
read (261006g). Both mistakes still compile against 2b's types, and Sol showed they still compile
with the two projection helpers taken away. Its panel is less clear than 2a's, where the plan
review's bar was that both hook and panel be clearer. And one hook cost ten test-file edits, a cost
that repeats for every hook after it.

**The case for 2b, which was weighed and not taken.** Sol's review (R1) went through the seven
postmortems asking which change would have made each less likely in practice:

| Postmortem | 2b | 2a |
|---|---|---|
| [261004f](../postmortems/261004f-a-previous-404-cannot-settle-the-next-failed-retry.md), a historical 404 leaves the retry loading | **materially**, if its transitions are adopted | no |
| [261004c](../postmortems/261004c-an-empty-artefact-state-can-still-carry-a-failed-read.md), an empty state hides a failed recheck | modestly: `recheck` sits beside the absence, though nothing forces a panel to draw it | little |
| [261006g](../postmortems/261006g-a-read-still-out-drawn-in-the-words-of-a-read-that-failed-and-one-failure-final.md), asking and failed collapse across a prop | modestly, if the child takes the whole read | no |
| [261005i](../postmortems/261005i-failure-presence-inferred-from-message-contents.md), failure inferred from a message's truthiness | modestly: an opening failure has its own `kind`; a recheck is still a nullable string | no |
| [261005q](../postmortems/261005q-a-refetch-cannot-tell-never-had-from-no-longer-has.md), [261005r](../postmortems/261005r-a-publication-404-does-not-establish-sharing-state.md), [261006b](../postmortems/261006b-a-read-completion-does-not-prove-it-followed-a-write.md) | no | no |

So 2b would have helped four of the seven, one of them a good deal, and 2a on its own helps with
almost none of them. Sol also says the builder undervalues the union's atomic transitions, and that
the compiler experiment is "a limit on compiler guarantees, not a complete verdict on the
abstraction" (R2). That is accepted. The decision does not rest on 2b being worthless. It rests on
the price (the panel, the ten test files, and one hook in three being a straight copy) being more
than a modest help is worth, when the tests that catch these mistakes now exist for Ideas whichever
shape the hook has.

**What happens next instead.**

- **`useSketch` and `useIllustrated` get 2a's grouping**, as its own small cluster, being built now.
  Each has the bug the grouping removes, live: when a read comes back with no usable picture, the
  branch clears the picture and leaves `stale`, `outdated`, `profiled` and `profileChanged` from the
  previous picture standing. The picture and its four flags become one object. `faults` stays
  separate, because a read with no usable picture still has faults to report.
- **`IdeasPanel`'s failure checks**, a follow-up and not landed here: 2b changed them from
  truthiness to an explicit `!== null`, which is sensible without the union (261005i is that
  mistake) and wants its own test.
- **The paired manual-button tests** from Sol's R4: that *Find the ideas* sends the unforced request
  and the button beside a current list sends the forced one.
- **Rolling a read type out to more hooks is not planned.** If somebody wants to reopen it, 2b is on
  its branch to read in place, the order the builder would take is at the end of the findings, and
  it goes to the owner as a new recommendation.
