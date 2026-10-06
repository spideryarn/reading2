Read-only review complete. `tests/read-error-matrix.test.tsx` passed: **55 tests**. I changed no files.

**R1 — P1: the plan turns approval of a spike into approval of migration.**

Input: “What Greg approved” concludes that approval covers “the spike and, if it passes, the staged migration”. The instruction for this review establishes only **“a one-hook spike first, then decide”**. Passing Claude’s stop condition cannot substitute for that decision.

Smallest change: end stage 2 with evidence and a recommendation. Describe stages 3–5 as a possible follow-up, not an automatically authorised continuation. Attribute the shape, stages and stop condition to Claude.

**R2 — P2: the core state fits, but the companion-state exception is incorrectly stated.**

Against [useIdeas.ts](/var/tmp/spideryarn-worktrees/seventh-sweep-depth-umbrella/src/web/useIdeas.ts:155), one `Read<IdeasAnswer>` can carry the normal observable read states:

| Today | Proposed representation |
|---|---|
| Opening read or explicit retry without a list | `asking` |
| Failed read without an accepted answer | `failed(error)` |
| Accepted absence | `known(null, null)` |
| Accepted absence, subsequent read failed | `known(null, error)` |
| Accepted list | `known(answer, null)` |
| Accepted list, subsequent read failed | `known(answer, error)` |

The four profile/currency flags fit inside `IdeasAnswer`. An artefact whose `ideas` array is empty remains a **non-null answer**, distinct from absence.

What does not fit—and should remain outside—is request ordering, the opening effect, `FreshReads`’ start clock and last server observation, and the job/rewrite hold. Offline copies can produce accepted answers without advancing `fresh.latest`; that distinction remains essential. Skim’s prerequisite waiting and queued press also remain outside Ideas’ read.

But [useFreshReads](/var/tmp/spideryarn-worktrees/seventh-sweep-depth-umbrella/src/web/rewrite-hold.ts:142) contains **`useState`**, not just refs. Its update can matter even when the artefact identity is unchanged.

Smallest change: replace “no `useState` beside `Read`, except `FreshReads` refs” with **“no independently stored duplicate read facts; retain all existing `FreshReads` bookkeeping unchanged.”** Do not turn its state into a ref to satisfy the gate.

**R3 — P2: pin the transitions explicitly; their signatures do not establish equivalence.**

The equivalent implementation has these rules:

```ts
// Accepted null or validated IdeasAnswer:
setRead(readLanded(answer));

// Failure, after current() passes:
setRead(was => failedRead(was, message));

// Explicit Try again only:
setRead(retrying);
await reload();
```

`failedRead` must retain a known answer—including null—and replace its `recheck` with the latest error. Otherwise it returns `failed`. `retrying` must retain a non-null known answer and clear its recheck; every other input becomes `asking`. **Ordinary `reload` and `refresh` make no start transition.** Keep both post-await `current()` checks and the catch’s check. Alias the pure `landed` to distinguish it from freshness bookkeeping.

These sequences expose plausible wrong implementations:

- **404 → failed refresh → Try again → second failure.** Preserving known-null during retry retains *Find the ideas*, unlike today. Conversely, treating the first refresh failure as `failed` removes that button too early.
- **List → failed refresh → Try again held → another failure.** Moving to `asking` blanks the list; retaining the old `recheck` leaves the error visible during retry.
- **Opening failure → armed mode press → automatic reread held.** Today `useAutoRun` calls `reload`; the old error remains visible. Applying `retrying` at every request start replaces it with *Looking…*.
- **GET outstanding → job finishes → trailing GET.** Capturing `read` in `load` and adding it to the callback dependencies changes the identity that `useOrderedRead` uses to invalidate requests. A read-state update can then invalidate ordering or trigger another opening effect.
- **Slug A request held → slug B → late A reply.** Removing either `current()` check allows A’s answer or error to overwrite B. The type provides no protection.

Smallest change: put the transition rules and the “no state change on ordinary request start” rule directly in the plan. Require functional updates so `load` does not depend on `read`. With those rules, I found no unavoidable Ideas presentation regression in this representation.

**R4 — P1: the claimed prevention is stronger than the type provides.**

Input: the plan says 261004c and 261006g are prevented outright. The investigations do not agree with that attribution.

For 261004c, this remains legal:

```ts
if (read.kind === "known" && read.answer === null) {
  return emptyState; // silently ignores read.recheck
}
```

Neither exhaustive handling of `kind` nor shared transitions forces that branch to render the failure. For 261005i, `failed` provides an explicit discriminant, but retained-answer failures still use nullable `recheck`; a truthiness check can still suppress an empty message. For 261006g, passing only a derived nullable value to a child can recreate the original omission.

Smallest change: replace the “outright” count with conditional claims: atomic state prevents contradictory stored combinations; whole-read props preserve distinctions; rendering checks and transition tests establish the behaviour. Require `recheck !== null` for failure presence. Do not claim compiler enforcement of failure rendering.

**R5 — P2: `statusOf` is a reasonable adapter, but `useSkim` does not need it.**

Code path: `useAutoRun` has a real four-word API. Its adapter must map known-null to `none` and known-with-answer to `ready`, **regardless of `recheck`**. Otherwise a failed recheck changes spending policy.

By contrast, [useSkim](/var/tmp/spideryarn-worktrees/seventh-sweep-depth-umbrella/src/web/useSkim.ts:192) can directly express:

- Ideas go first when failed, or known with no answer, or known with a stale answer.
- Ideas are still pending when `kind === "asking"`.

No shared interface there requires four words.

Smallest change: permit the adapter at the `useAutoRun` boundary, called from `useIdeas`; let `useSkim` consume the union directly. Count actual adapter uses, including aliases, rather than treating “two permitted callers” as proof of value. The adapter itself is not a design hole; continuing to expose reconstructed status/value/error props throughout panels would be.

**R6 — P2: the nine tests leave credible wrong implementations green.**

The numbered cases refer to the linked Opus review:

| Cases | Wrong implementation that can survive |
|---|---|
| 1, 2, 7 | Changes to `asking` during an ordinary refresh, then restores the correct final state. These cases do not explicitly hold that refresh and inspect the screen. |
| 1 | Handles retry success correctly but blanks the list after a **second failed** retry. |
| 3, 4 | Loses one metadata flag if the fixture never gives that flag a non-default value. The existing malformed-refresh fixture has all four false. |
| 5 | Clears the visible error during automatic reread while preserving GET/POST counts. |
| 6 | Incorrectly treats `outdated` or `profileChanged` as grounds for regenerating Ideas; the stated cases do not isolate them. |
| 8 | Mishandles offline or pre-job provenance while passing the ordinary failed-read/server-success sequence. Existing rewrite-hold tests help here and must remain intact. |
| 9 | Correct pure functions, wrongly wired hook. A helper-table test cannot prove the catch calls its helper or preserves request ordering. |

Also, case 6’s “`prerequisitesLoading` is true only while asking” needs qualification: **Quotes can still be loading after Ideas answers**. Case 9’s “four states × three events” omits distinctions within known states.

Smallest change: add held refreshes and automatic rereads, repeated failures with different messages, retry-success and retry-failure over both absence and a list, and non-default flag fixtures. Test all six observable classes in R2, including successful null versus successful value. Add `profileHash: ""` to preserve today’s `!= null` rule. Keep the existing offline, hold and race suites; add a late obsolete **failure**, not just a late success.

**R7 — P2: the stop condition can both falsely pass and falsely fail.**

Input: the six-file line count excludes the new module’s actual cost. Saving five lines while adding forty passes, despite increasing total machinery. A pure transition-table test can also turn red for `failedRead → asking` even if the real hook never uses `failedRead`.

Conversely, legitimate freshness or mutation state can fail the state-count gate. Counting “two facts together” penalises necessary checks such as `kind === "known" && answer !== null`. A test’s assertion about the removed hook interface must change even when its behavioural assertion remains identical. An Opus reader who has not seen the old version cannot establish comparative readability.

Smallest change:

- Treat total production lines, including helpers, as evidence rather than a hard threshold.
- Require deletion of duplicate read storage and preservation of visible behaviour, requests and spending.
- Require a mutation to fail an **integrated hook/consumer assertion**, not merely the helper table.
- Distinguish interface assertions from behavioural assertions.
- Give the comparative reviewer both versions.
- Compare the spike with the smaller answer-object change before deciding on rollout.

**R8 — P1: the nine-hook fallback is not derived from compatibility.**

Input: stage 3 says that if Glossary’s local patches require companion state, migrate “the nine hooks that share Ideas’ shape”. That set—identified by `new MalformedReply`—includes **Glossary itself**, plus Citations, Quiz and Simple.

Those hooks have real additional responsibilities: Glossary’s pending hide writes, Citations’ local investigations, Quiz’s saved attempts, and Simple’s retained job preview. Their validators establish acceptance checks, not lifecycle compatibility. Sketch’s known-empty result can also carry `faults`, which `answer: null` cannot carry under this shape.

Smallest change: replace the nine/four split with an explicit compatibility decision per hook after the spike. Permit independent operation state; require only read facts to be atomic. Clarify that old and new hooks may coexist during rollout, but a migrated hook must have one actual read store.

This **does not inherently become the rejected generic artefact-read hook**. Pure value transitions leave URLs, parsing, absence interpretation, ordering and job orchestration local. Preserve that boundary; do not add loader options or universal retry policy to accommodate incompatible siblings.

**Verdict: ready with these fixes, for the one-hook spike only.**

The abstraction is worth evaluating, but broad migration is not yet justified. The strongest benefit is putting an answer and its metadata into one atomic value; the claimed two-of-seven prevention is conditional and partly belongs to tests and consumer discipline. The plan should explicitly compare a smaller change—one nullable `IdeasAnswer` object, retaining status/error and strengthening the transition matrix—which removes much of the flag-reset machinery without migrating every consumer. Keep the full union only if the spike demonstrates clearer hook and panel code beyond that smaller option. Passing the revised checks should produce a decision, not automatic rollout.