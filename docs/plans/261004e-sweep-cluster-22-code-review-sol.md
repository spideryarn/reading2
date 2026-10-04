**Refuse `e7873ccba` on F1, an established P1.** I fixed F1 and F2 uncommitted, with red-first tests. The wider F3 remains for your decision.

- **F1 — P1, established; fixed.** Done sends a commit → entry refusal restores hands-free → commit refusal leaves its pending flag and debt intact. After 13 seconds, it falsely reports `no-reply`; the next detector commit sends an unnecessary `response.create`. The fix settles the rejected manual turn while retaining hands-free and its microphone.
- **F2 — P2, established; fixed.** Entry refusal during Done’s tail → immediate tap retry offers Ready, but Talk does nothing. Entry recovery now cancels the abandoned tail independently of preserving a sent commit.
- **F3 — P1, established at the public-hook boundary; wider scope.** Late entry recovery → re-enter tap → Talk → old commit acknowledged → new clear refused → reply refused. The accepted turn becomes unanswered with **no reply debt**. This reproduces without provider-message reordering. The smallest complete fix is an explicit outstanding-manual-turn fact that keeps retries in Sending until reply start or commit rejection. The probe exercises the API directly; it does not establish an immediate retry button in today’s panel.
- **F4 — P2, reasoned.** Restored VAD and the manual acknowledgement handler can both request responses. Duplicate replies or charging were not established locally. Recovery should serialize those response owners; simply keeping a refusal in hands-free does not prove harmlessness. [Official OpenAI documentation](https://developers.openai.com/api/docs/guides/realtime-conversations#keep-vad-but-disable-automatic-responses).

The five-state table omitted hands-free with a pending manual commit; that case is now covered. I found no live false-submission path caused by the tail callback’s early-return guards.

Both permitted files pass: **131 tests**. Lint reports four complexity advisories, no errors. No commit, full suite, or typecheck.

Changed repository files:

- [tap.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/src/web/live/tap.ts)
- [useLiveConversation.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/src/web/live/useLiveConversation.ts)
- [live-talk-mode.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/tests/live-talk-mode.test.ts)
- [live-session-flow.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/tests/live-session-flow.test.tsx)
- [Review, including runnable F3 probe](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/docs/plans/261004e-sweep-cluster-22-code-review-sol.md)
- [Root-cause note](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/docs/postmortems/261004h-recovery-mode-is-not-the-lifetime-of-a-pending-command.md)