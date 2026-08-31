# Re-check: the four findings from your review of step 1

You reviewed the built step 1 of the chat client refactor and returned **do not ship**, with one
required change and three corrections. Your review is at
`docs/plans/260828p-chat-client-architecture-review-sol.md`. This is a short, focused re-check — **only
whether your four findings are now correctly addressed**, plus anything the fixes themselves broke.

Read-only. Please do not re-review the whole refactor.

## What I did with each

**1 (required) — the `refreshThread` comment is wrong; thread ids are per-article.**
Verified: `chat_threads` is keyed `(article_id, id)` and the schema says ids are "not promised to be
globally unique". You were right and I was wrong.

- The comment on `showing` in `src/web/useChat.ts` is rewritten to say the guard stops **two**
  things, and that the write half is reachable precisely because ids are per-article.
- New test in `tests/chat-error-scope.test.ts`: *"cannot replace this article's conversation with the
  one it left behind"*. Article A holds thread `X`; a retry 409s and fires a repair; the reader moves
  to article B whose own thread is **also** `X`; A's copy arrives late. Watched failing against a
  probe with the guard deleted — it replaced B's conversation with A's:
  `expected [ 'An earlier conversation' ] to deeply equal [ 'A conversation about the other piece' ]`.

**2 — `setError(null)` is not a reader-visible fix, and is incomplete.**
Verified both halves. `Reader` is keyed on slug (App.tsx:413) and *both* mounts of `useChat` — the
band and `ChatDialog` — are under it, so the hook always remounts. The claim is corrected in the code
comment, the test docstring and the write-up, each saying plainly that no reader has hit this and
what the fix actually buys.

On the incompleteness: `askToStop`, `askToCancel` and `remove` do all write `error` from an unguarded
`catch`. I **did not** add slug guards to those three, on the grounds that hand-copying a guard to
three more call sites is the habit that produced the four staleness vocabularies in the first place,
and step 2's operation model closes them together. That reasoning is written into the comment and the
plan. **Tell me if that is the wrong call** — if you think three guards now beat one mechanism later,
say so and I will add them.

**3 — the phase collapse's safety claim is false.**
Agreed; `live` prevents bug 10 and `phase` only removes the meaningless combination. The write-up now
says exactly that and credits the correction.

**4 — the plan says three `setComments` sites; there are ten.**
Counted: ten. Fixed.

## What to check

1. Is the new test actually pinning the case you described, or does it pass for an incidental reason?
   In particular: it relies on `running.current` surviving the slug change so the `> 1` early return
   does not fire, and on the retry's `run` still being mid-flight. If either is accidental, the test
   is weaker than it looks.
2. Is the rewritten `showing` comment now **true**? It is the third version of this comment and the
   previous two were wrong.
3. Do the corrected claims in `docs/plans/260828p-chat-client-architecture.md` and the docstring of
   `tests/chat-error-scope.test.ts` still overstate anything?
4. Did the corrections break anything, or leave a claim in one file contradicting another?

Evidence: the scoped diff of `useChat.ts` is at
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/52042872-b017-4e78-b555-84bb8af0c436/scratchpad/step1-final.diff`,
and the two new/changed test files are `tests/chat-error-scope.test.ts` (3 tests) and
`tests/chat-list-composer.test.tsx` (comment only). 68 tests pass across the eleven chat suites;
`npm run typecheck` is clean on the web and tests projects.

Verdict: **ship** or **do not ship**, and if the latter, the one thing that must change.
