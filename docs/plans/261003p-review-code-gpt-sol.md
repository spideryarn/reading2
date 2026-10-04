- **F6 — P1, established, fixed:** A whitespace-only streamed chunk removed the spinner before any visible answer arrived. `Turn` now uses one visible-text check for waiting, answer rendering and the cursor. The regression test failed before the fix and passes afterwards.
- **F7 — P3, established, fixed:** Marginalia’s documented 256px threshold omitted the inset and gutter. Corrected the wording.
- **F8 — P3, reasoned, fixed:** The claim that model waits never last under 600ms was unsupported. Replaced it with the reason for immediate feedback.
- **F9 — P2, reasoned, wider:** Recovery with a stale running tool can show both tool and reconnect spinners. This predates the candidate; left unchanged.

Validation: **59 targeted/doc-link tests passed**, all projects typechecked, and lint reported only existing complexity notices. Full `npm test` was blocked by sandbox access to Docker/the database. Browser evidence was not independently verified.

**Verdict: land after fixes — applied here, uncommitted.**

Files changed:

- [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/src/web/ChatPanel.tsx)
- [chat-turn-waiting-spinner.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/tests/chat-turn-waiting-spinner.test.tsx)
- [marginalia.md](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/docs/project/marginalia.md)
- [loading-spinner.md](/home/greg/code/spideryarn2/.claude/worktrees/fbnseuz2-block-chat-margin/docs/project/loading-spinner.md)