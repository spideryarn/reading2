# Narrow check: the fixes for F5, F6 and F7, plus one refactor that was not in the last snapshot

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification`, branch
`worktree-stream-end-classification`. TypeScript + ESM, `tsx`, vitest.

**This is not a new review round and discovery is closed.** You reviewed this work at `6d813cd6` and
refused on F5 and F6 ([260901g-stages-def-code-review-sol.md](260901g-stages-def-code-review-sol.md)).
This is the narrowly scoped check of **the fixes themselves**, which by definition were not in that
snapshot — plus one refactor (`b043abe4`) that landed while you were reviewing and is therefore also
unreviewed. Please confine yourself to those. Do not re-open the parts you already passed.

## The candidate

```
git diff 6d813cd6..HEAD                # everything since your review
git diff --name-only 6d813cd6..HEAD
```

Two commits:

- **`b043abe4`** — a refactor of `src/converse.ts` only, from a postmortem written after your
  review. `roundLog`'s element became a named `RoundRecord` with `ended` (the round's
  `StreamOutcome["kind"]`) and `prose`; the two turn-scoped `let`s your F2 shaped are gone, and
  `truncated` and `finishReason` are now computed from the array. **Claimed behaviour-neutral.**
  Its motivation is `docs/postmortems/260905i-the-round-variable-read-as-the-turns-answer.md`.
- **`2fb66260`** — the F5, F6 and F7 fixes.

Changed paths across both:

```
src/ai-call.ts
src/converse.ts
src/types.ts
tests/ai-call.test.ts
tests/converse-stream-end.test.ts
tests/openrouter-stream.test.ts
docs/... (plan, postmortem, evidence, ai-gateway.md — read for claims, not for style)
```

## What I did with each of your findings

| ID | Disposition | The fix |
|----|-------------|---------|
| F5 | accepted, fixed | The three signal checks in `classifyEnd` are gated on `!end.terminated`. Reproduced independently first — deterministically, without your timing harness: the whole reply is one enqueued chunk, so `sseChunks` is suspended mid-line-buffer with `[DONE]` received and not yet seen, and the test (the consumer) sleeps 250 ms against `timeoutMs: 50` before resuming it. The pre-fix failure was `expected 'The AI service did not finish within …' to be null`. The existing test you flagged now supplies `terminated: false`; three new cases pin terminator-dominance for the deadline, the stall clock and the reader. |
| F6 | accepted in substance; fix split, half deliberately not done | Your reproduction is right and the flag stays anyway. Reverting the fold restores a silent success, which is the failure this whole plan exists to stop; an unnecessary retry costs a reader less than a truncated answer with no warning. So `src/types.ts` § `truncated` now says the observable thing — close to your wording — and records that `src/web/ChatPanel.tsx`'s sentence still overclaims. **The panel copy is not changed**: this job's brief is server-side only and forbids touching `src/web/`, and what a reader is shown is the product owner's call, not mine. |
| F7 | accepted, fixed | `options.end.terminated = false;` added to the reset, with a red-first test in `tests/ai-call.test.ts` driving two streams through one `StreamEnd`. |

## What to check, and nothing else

1. **Is the F5 fix correct and complete?** Specifically: is there any path on which
   `end.terminated === true` and the response was *not* in fact complete — anything other than a
   literal `data: [DONE]` frame setting it, any reuse or aliasing of the object that survives the F7
   reset, any caller that constructs `StreamEnd` with `terminated: true`. And does gating the three
   checks change behaviour for the three callers this job does not own — `quiz-mark`, `explain`,
   `search` — in a way that is wrong rather than merely different?
2. **Is `b043abe4` really behaviour-neutral?** The claim is that
   `lastRound?.ended === "truncated" || roundLog.some(r => r.ended === "truncated" && r.prose)`
   computes exactly what the two deleted `let`s computed, and that
   `roundLog.at(-1)?.finishReason` is exactly the old `end.finishReason` after the loop. Check the
   ordering that makes it work: `noteRound()` runs in the round's `finally` and sets `prose`;
   `record.ended` is set immediately after `classifyEnd` and therefore *after* `noteRound`; a round
   that throws leaves `ended: null`. Find an input where the two disagree.
3. **Is the F7 reset now complete**, and does adding it interact badly with anything — in
   particular, is there a caller for which clearing `terminated` at the top of a retry is wrong?
4. **F6: is leaving the panel copy alone defensible**, given the type contract now states the weaker
   claim? I am not asking you to relitigate the fold. If you think the mismatch between
   `src/types.ts` and `ChatPanel.tsx` is itself a P1 rather than a note, say so and I will put it to
   the product owner rather than decide it.

## What you can run

The tree is read-only; `/tmp` and the node_modules caches are writable, and vitest worked for you
last time. Useful:

```
npx vitest run tests/converse-stream-end.test.ts
npx vitest run tests/ai-call.test.ts
npx vitest run tests/openrouter-stream.test.ts
```

I have run the full suite (`712 passed | 1 skipped`, `12895 passed | 35 skipped`, exit 0) at
`b043abe4`, and am re-running it at `2fb66260`. `npm run typecheck` and `npm run check` are green.
All of it is in [260901g-stages-def-test-evidence.md](260901g-stages-def-test-evidence.md).

## Severity and format

Same scale as before (P0/P1/P2/P3, established vs reasoned), same requirement of an (a) and a (b).
**Number new findings from F8 upward** — F1–F7 are taken. Refuse only on an established P0 or P1 in
one of the four areas above.

Do not change any file.
