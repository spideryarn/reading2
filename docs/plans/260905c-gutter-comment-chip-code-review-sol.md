Two P1s need addressing; one is pre-existing but confirmed.

## Findings

- **F-01 — P1 — `help:true` is shape-validated, but its meaning is not enforced.**  
  The contract says `help` means the paragraph “?” created the thread ([chat.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/chat.ts:259)). The route only rejects non-`true` values and retry/edit bodies ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/routes.ts:2193)); it then passes `help` to every ordinary `begin` ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/routes.ts:2417)). Consequently, `help:true` is accepted on a later turn in an existing thread, an unanchored thread, a selection chat, or even a Remember/Candidates thread. That stores false origin metadata and applies the teaching prompt to the wrong request. Require a new thread, a whole-block anchor, and effective kind `chat`. Add route tests for these refusals.

- **F-02 — P1 — the stored thread anchor still never reaches `converse`; the suspected pre-existing bug is real.**  
  `buildConverseMessages` promises the structural anchor on every turn ([converse.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/converse.ts:1103)), but the route’s call omits `thread.anchor` ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/routes.ts:2570)). The new test explicitly acknowledges that omission ([help-prompt.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/tests/help-prompt.test.ts:186)), while its builder-level placement assertion supplies an anchor directly. Initial help requests retain passage wording in their stored question, but later follow-ups—and conversations whose first turn leaves the 20-turn history window—violate the documented contract. Pass the stored anchor to `converse` and assert it through the route-level request capture.

- **F-03 — P2 — export/restore added two manual projections without a positive `help:true` test.**  
  Both rollback export ([export.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/store/export.ts:637)) and filesystem restore ([seed-reader-state.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/tests/helpers/seed-reader-state.ts:290)) correctly name the field today, but no export or round-trip fixture contains `help:true`; the plan’s requested positive export test was not added. This is precisely the silent-loss seam those projections’ comments warn about.

Everything else checked out:

- Retry and edit derive `help` from the stored user row; `false` is rejected; neither path can relabel an existing row.
- All production `send` calls preserve positional semantics, including `useProfile:false`. The only `useChat` module mock is the one already fixed.
- The cache test is sufficient alongside the existing explicit-breakpoint tests.
- The search encouragement survived intact, while `helpSection()` remains sourcing-neutral.
- The migration’s `NOT NULL DEFAULT false` and user-only CHECK are correct; no code assumes a semantic backfill occurred.
- The `explain.ts` tripwire fix is correct, and its test would fail under the previous implementation.
- `threadFor` and `helpThreadFor` are clearer as two small functions with different policies than as one boolean-configured helper.

Checks: 259 focused tests passed; all three TypeScript projects passed direct `tsc --noEmit`. The `npm run typecheck` wrapper itself hit the sandbox’s `tsx` IPC `EPERM`. I did not run the Postgres route/round-trip suites or a live network prompt check.

**Verdict: land it with these changes.**