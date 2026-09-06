You reviewed the PLAN for this change and would not approve it. This is the BUILT CODE. Weigh this
review higher than the plan one: a plan-stage review cannot find a handler that arms the wrong thing
or a hook whose status mapping is subtly off.

Read, in this order:

1. `docs/plans/260906a-opening-a-mode-starts-it-generating.md` — especially the **As built** section,
   which records what your plan review changed. Your findings 1, 2, 3, 4, 9, 10 and the `useClaims`
   ordering point were all acted on; check that each fix is real and not cosmetic.
2. `docs/plans/260906a-opening-a-mode-starts-it-generating-plan-review-sol.md` — your own plan review.
3. The scoped diff at `/tmp/claude-1000/-home-greg-code-spideryarn2/d809fe00-8eb1-4b23-a332-b174b22d7f11/scratchpad/code.diff`
   (tracked-file diff, with the two new files appended in full at the end).
4. The files themselves in the repo where you need more context than the diff gives —
   `src/web/activation.ts`, `useAutoRun.ts`, `auto-run-targets.ts`, `useClaims.ts`, `useQuiz.ts`,
   `QuizPanel.tsx`, `CandidatesPanel.tsx`, `Tweets.tsx`, `Link.tsx`, `Dock.tsx`, `App.tsx`,
   `useChat.ts`, and the two test files.

Context: the user asked for "each mode automatically starts generating when I open it … by opening
the mode, the user is implicitly indicating that they want what's already generated, or to generate
it if needed", and chose the widest scope (mode buttons plus the sub-mode chips inside Remember and
Referee, plus the Tweets page).

What I want, in order of how much I care:

1. **Did the four blockers actually get fixed?**
   - Diagram: `armActivationForDiagram` now reads `?diagram=` from the bar's `location.search` and
     arms `sketch`/`illustrated`/nothing. Is the Back-step sequence you described really closed? Are
     there OTHER unclaimed-token paths this change opens — for Tweets, Quiz, Claims or Candidates —
     where a token is minted for a band that does not mount?
   - Quiz: `run(label, verb)` in QuizPanel, `ensure` under the empty state, `write` under the two
     rewrites. Any remaining forced/unforced mismatch?
   - Quiz chip: arming moved above the `value !== view` check inside `RememberSubModeToggle`.
   - Candidates: `REFEREE_CANDIDATES_REACHES_SEARCH` drawn above the chips, outside the collapse.
     Is that genuinely "visible before the authorizing click" given where `.ref-notice` sits, or have
     I just moved the problem?

2. **New bugs I have introduced.** Especially:
   - `useClaims` now routes its read through `useOrderedRead` and returns `discard` from the slug
     effect. Is the interaction with the in-flight SSE stream (`running` ref, `current` ref) still
     correct? Does `discard` on unmount break anything `pull` depends on?
   - `useChat.reload` dispatches a second `load.started` from a `useCallback` whose dep is
     `controller`, and the mount effect now depends on `startLoad`. Can that loop, or drop the
     initial load?
   - The `asking` ref in `CandidatesBand` and the effect that releases it. Can it deadlock the
     button, or fail to latch?
   - `Link.onNavigate` firing before `navigate()`. Correct ordering?
   - `Tweets.tsx` calls `useAutoRun` with an inline arrow and drops the return value.

3. **Is the status mapping right in each of the two stream hooks?** `useClaims` maps
   `!loaded → loading, loadFailed → error, run !== null → ready, else none`; `CandidatesBand` maps
   the same shape over `thread`. Any state where those lie to `useAutoRun`?

4. **The tests.** `tests/pressing-a-chip-arms-it.test.tsx` asserts `pendingActivation` rather than
   counting POSTs — is that a real measurement or is it testing the mock? The Diagram Back-step case
   in `tests/modes-that-start-themselves.test.tsx` was watched going red on the buggy version. What
   is still untested that could break silently?

5. **Anything stale.** A comment, a doc sentence, or a test name that this change made false and I
   did not update.

Be concrete and skeptical. Give me findings I can check one by one. Say plainly whether you would
approve this now.
