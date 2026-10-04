**Refuse `677a2e1f6` on F5, an established P1.** I fixed it narrowly, uncommitted.

| Finding | Round-two result |
|---|---|
| F1 | Closed: rejected commit clears debt; later detector commits request no manual reply. |
| F2 | Closed: entry recovery cancels Done’s tail. |
| F3 | Original response-request sequence dissolved; debt-loss residue remains as F5. |
| F4 | Closed: entry recovery clears the manual acknowledgement flag. |

**F5 — P1, established; fixed red-first.** Event sequence:

1. Done sends a commit.
2. Late entry refusal restores hands-free.
3. Commit acknowledgement arrives; no manual reply is requested.
4. Another `speech_started` lasts 30 seconds, offering Tap to talk again.
5. Re-enter → Talk → fresh clear refused.
6. Ready erases the earlier accepted turn’s debt: `stall` becomes `null` instead of `no-reply`.

Leaving this under “Known and left” would leave demonstrated wrong behaviour. It can also happen on **first entry**, after an unanswered hands-free turn, with only one clear refusal.

**Yes, `enterTapToTalk` should consult `owedSince`.** It now enters Sending while a reply is owed, blocking Talk and preserving debt without requesting another response. A later response releases the wait.

Both reproductions failed before the fix. Both permitted files now pass: **128 tests**. No other regression found in the requested scope. The wider stale-event ownership gap remains.

Changed files:

- [useLiveConversation.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/src/web/live/useLiveConversation.ts:2331)
- [tap.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/src/web/live/tap.ts)
- [live-session-flow.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/tests/live-session-flow.test.tsx:2414)
- [live-talk-mode.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/tests/live-talk-mode.test.ts)
- [Plan](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/docs/plans/261004e-sweep-cluster-22-live-tap-policy-as-a-pure-function.md)
- [Root-cause note](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/docs/postmortems/261004h-recovery-mode-is-not-the-lifetime-of-a-pending-command.md:54)

No commit, full-suite run, or typecheck.