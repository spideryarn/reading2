# Review the built step 1 — the chat load as one operation

You reviewed the architecture of `src/web/useChat.ts` earlier today and recommended a staged path.
Your answer is at `docs/plans/chat-client-architecture-sol.md`. **This is the second review: the
code, not the plan.** Weight it accordingly — a plan-stage review reads prose, and the bugs are in
the half that did not exist when you read it.

Read-only. Please be adversarial.

## What was built, and how it differs from what you recommended

Your step 1 was "make arrival loading an explicit operation now", via a `LoadPhase` reducer with an
`opId` and one admission gate.

**What was built is simpler, and I need you to tell me whether it is weaker.** The reasoning came
from your own evidence: `useComments` has never had bugs 10 or 12, and its guard is a per-run `live`
flag **in the effect, where the writes are**. `useChat` needed two staleness concepts (`showing` and
the `load` generation) only because the arrival load lived in a `useCallback` that did its own
`setThreads`, so the effect's `live` could not reach the writes.

So instead of adding a reducer and an operation id, the load **moved to where the guard already
worked**:

1. `askForThreads(slug)` — module-level, returns `{ok:true,threads} | {ok:false,error}`. Writes
   nothing, does not throw. Body-`error`, non-2xx and dead network all collapse to one shape.
2. The arrival load now lives in the mount effect. One `settle` closure is the only thing that
   writes; `if (!live) return;` is the only gate. `.catch` *maps to an outcome* rather than handling
   one, so it joins the single path rather than being a second.
3. `refresh(only?)` split into `refreshThread(only)`. The `load` generation ref is deleted (11 refs
   → 10).
4. `loaded` + `loadFailed` collapsed into one `phase: "loading" | "ready" | "failed"`, with both old
   names derived at the `ChatApi` boundary so the panel is unchanged.

**The specific question:** is "one write path, one gate" as strong here as "an operation id and an
admission rule"? My claim is that for *this one operation* they are equivalent, because `live` is
per-run by construction and there is exactly one continuation. Yours is that the general fix needs
operation identity. I think both are true and step 1 does not need the general mechanism yet. Tell
me if that is wrong, or if this shape will fight step 2 when it arrives.

## Two bugs found and fixed while building it

- **`error` outlived the article.** The mount effect never cleared it, so a failure on one piece
  showed on the next piece the reader opened. True since chat was written. One line, plus a test.
- **`refreshThread`'s `showing.current !== mine` guard had no test** — deleting it left the whole
  repo green. It turns out its *write* suppression is unobservable (the id it would rewrite is not
  in the new article's list, so both `setThreads` branches are no-ops) and only its *error*
  suppression is reachable. That now has a test, and the comment says which half matters.
  **Please check that reasoning** — if there is an observable write case I have missed, the comment
  is now confidently wrong in the code, which is worse than absent.

## Evidence

- The scoped diff: `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/52042872-b017-4e78-b555-84bb8af0c436/scratchpad/step1.diff`
  (also just read the files).
- `src/web/useChat.ts` — the subject. `askForThreads` and the mount effect are the change.
- `tests/chat-error-scope.test.ts` — new, two tests, both watched failing first.
- `docs/plans/chat-client-architecture.md` — the write-up, including steps 2–4 as you gave them and
  the things deliberately not done. **Check it for claims that are false**; the last one of these I
  wrote contained a factual error about `Reader` being keyed on slug, which you caught.
- `src/web/ChatPanel.tsx` and `tests/chat-list-composer.test.tsx` — the stale comments you flagged,
  now corrected.

Every guard added or kept was watched failing against a probe copy with the guard removed:

- removing `if (!live) return;` → 3 tests red (`lets a superseded load write nothing…`, `says
  nothing when a superseded load fails…`, `ignores an earlier fetch failing after a later one
  succeeded`);
- removing `showing.current !== mine` in `refreshThread` → 1 test red (`cannot arrive from a repair
  the reader has already left behind`).

74 tests pass across the twelve chat suites. `npm run typecheck` is clean (one pre-existing orphan
file, `rename-preview.tsx`, belongs to another agent).

## What I want from you

1. **Anything actually broken.** Behaviour that changed and should not have. I claim the refactor is
   behaviour-preserving apart from the two named fixes — check that claim against the old code in
   the diff, especially: the `body.error` path, what `loaded`/`loadFailed` are on each path, the
   `running.current.get(only) > 1` early return, and the 409 call site now awaiting a `void`.
2. **Is `setError(null)` on article change right?** Everything that fails in this hook writes to that
   one string. Is there a failure worth carrying across an article change that I have just started
   throwing away?
3. **The `.catch` that maps to an outcome.** `askForThreads` cannot throw, so that line is
   unreachable today. Is unreachable-but-funnelled better than absent? It cannot be tested, which by
   this repo's rules makes it suspect.
4. **Does the `phase` collapse lose anything?** `loaded`/`loadFailed` are still exposed and the panel
   is untouched, but three states replace four combinations. Is there a legal state I have made
   unrepresentable that something wanted?
5. **Did I under-build step 1?** If a reader of this code in three months would be better served by
   the reducer you actually recommended, say so plainly and I will build it.
6. **The write-up.** Anything in `chat-client-architecture.md` that is wrong, overclaimed, or that
   misrepresents your answer.

Verdict at the end: **ship** or **do not ship**, and if the latter, the one thing that must change.
