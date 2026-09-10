Verdict: the original guarantee was not accurate, but no P0/P1 remains after the fixes. I would accept the revised Stage 3.

Findings:

- F50 — P1, established: an initial `unknown → verified` execution reading triggered a costly reread despite proving no replacement. Execution memory also crossed tmux worlds. Fixed with per-row, per-world execution epochs: first verification establishes epoch zero; only a later different token advances it.
- F51 — P1, established: `tmuxServerPid` going `42 → null → 42` caused a reread without a world change. The PID now travels beside the digest; only two different named PIDs trigger the immediate world path.
- F52 — P1, established: mounting, refreshing, or changing limits while hidden started requests. All read entry points now defer until visibility returns.
- F53 — P2, reasoned: render-time mutation of the verified-token ref could leak from a discarded React render. Memory is now committed only from an effect.
- F54 — P3, established: “never sooner than the floor” omitted the deliberate tmux-restart exception. Documentation now states that two different named PIDs reread immediately.
- F55 — P3, reasoned: “one read in flight” was literally impossible when an injected API ignored abort and never settled. The accurate guarantee is one live reader slot; abandoned promises are generation-discarded.

The floor’s start-time anchor is sound: a 15-second timeout permits an automatic evidence read at second 20. Anchoring to completion would extend that to 35 seconds without improving cancellation.

The button also keeps the pending-refresh promise. Although normally disabled while busy, two activations before React draws the disabled state coalesce into exactly one trailing read; this now has a UI-level test.

Verification:

- 108 focused tests passed.
- Isolated DOM-client and Stage 3 test TypeScript projects passed.
- Signal forwarding, timer cleanup, dialog evidence, and world-memory tests were mutation-checked and failed when their implementations were deliberately broken.
- Repository-wide typechecking currently fails in concurrent, out-of-scope edits to `MessageOverseerCard.tsx` and `BroadcastCard.tsx`. No Stage 3 type errors remain.
- No commit created.

Changed files:

- [FeedPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/FeedPanel.tsx:182)
- [feed-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tools/fleet/web/src/feed-client.ts:657)
- [fleet-feed-freshness.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/tests/fleet-feed-freshness.test.tsx:356)
- [fleet-recent-messages.md](/home/greg/code/spideryarn2/.claude/worktrees/session-continuity/docs/project/fleet-recent-messages.md:117)