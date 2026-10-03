## Findings

- **P0 — None.**

- **P1 — Failed tap-mode entry could silently mute hands-free recovery.** If both `session.update` and its following `clear` were refused, the second error disabled the track after the first had restored hands-free. Fixed in [useLiveConversation.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/useLiveConversation.ts:1301).

- **P1 — Refused `response.create` reopened Talk behind a committed, unanswered turn.** That could confuse the provider context and block normal ledger harvesting. It now remains `tap-sending`, preserves the reply debt, and directs the reader to Reconnect; `no-reply` remains honest.

- **P2 — Any `spya-tap-…` error was treated as current tap traffic.** A stale previous-session or merely tap-shaped ID could swallow a real provider error. Recovery now requires an exact event ID issued by the current session.

- **P2 — Talk could synchronously open during a tool continuation.** The UI looked disabled, but `talk()` checked only active responses, not a continuation requested but awaiting `response.created`. It now uses the ref’s full `responding` state. Added an end-to-end test proving the tool call and continuation store as one correct exchange.

- **P3 — Tap Sending showed misleading microphone UI.** The meter and quiet-input warning appeared while the transmitted track was disabled, and a reconnecting tap session claimed it would hear the reader after loading. Fixed in [LiveStatus.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/src/web/live/LiveStatus.tsx:123).

Reconnect is now covered from Ready, Talking, and Sending. Commit refusal, lost reply, response refusal, hang-up, stale IDs, dual entry errors, and tool continuations are covered in [live-session-flow.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbkzdmhb-live-noisy-street/tests/live-session-flow.test.tsx:2263).

## Verification

- Focused Vitest command: **157 tests passed**
- Typecheck: all four projects and all 2,778 source files passed
- `git diff --check`: passed
- Lint: no errors; only the existing large-function complexity advisories
- Full suite not run, as requested
- No commit made

`npm run typecheck` itself could not start because the sandbox denied the `tsx` launcher’s Unix socket (`EPERM`). Running the same script as `node --import tsx scripts/typecheck.ts` passed.

**Verdict: approve with changes. No unresolved P0–P3 findings.**