# One type for a read, spiked on `useIdeas`

A cluster of the [seventh sweep](261006m-seventh-codebase-sweep-depth-umbrella.md) (its item C5),
and item 5 of the [sixth](261006j-sixth-codebase-sweep-umbrella.md): seven postmortems in three days
named the class "a read is a value plus booleans", and one of them named the fix.

**Status: plan, not built. Stage 1 and 2 are the spike; stages 3+ exist only if the spike passes its
stop condition.**

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
**ready with these fixes, for the one-hook spike only**. Eight findings; seven accepted, one
accepted in part. **Where this section and the text above differ, this section wins.** The shape,
stages and stop condition are the orchestrator's (Claude's), not Greg's.

- **R1 (in part).** Sol read "then decide" as needing a fresh decision from Greg before any
  migration. The session's brief, relayed by the Overseer with Greg's approval, is wider: *if the
  spike shows the type removes the class without making the hook harder to read, migrate the rest in
  stages; if not, stop and write down why.* So the decision after stage 2 is the orchestrator's to
  take, and it is **a written decision with the evidence, in this doc**, not an automatic
  continuation. Passing the stop condition is necessary, not sufficient.
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
