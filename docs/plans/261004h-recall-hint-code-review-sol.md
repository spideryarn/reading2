## Findings

- **F12 — P1 — established — fixed.** [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/web/ChatPanel.tsx:1679) withheld Hint until streaming finished, contrary to Round 2. It now appears once the complete marker and hint text arrive and remains open as further deltas arrive. Red first: [recall-hint-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/tests/recall-hint-panel.test.tsx:278).

- **F13 — P1 — established — fixed.** [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/web/ChatPanel.tsx:1558) permanently suppressed another persistence request after the first failed. Reopening now retries until `hintOpenedAt` returns; concurrent and already-stored writes remain suppressed by the reducer. Red first: [recall-hint-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/tests/recall-hint-panel.test.tsx:158).

- **F14 — P1 — established — fixed.** [recall-hint.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/recall-hint.ts:39) exposed valid hints when the terminal question used Markdown emphasis, a Markdown link, or `？`. The shared predicate now accepts those closers. Red first: [recall-hint.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/tests/recall-hint.test.ts:46).

- **F15 — P2 — established — fixed.** [remember-recall-checks.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/evals/remember-recall-checks.ts:75) could report a hint as valid without its own known block ID, despite `REMEMBER_SYSTEM` requiring one. It now checks absent and unknown IDs and shares the production question-ending predicate. Red first: [remember-recall-checks.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/tests/remember-recall-checks.test.ts:102).

- **F16 — P2 — reasoned — reported.** The retry fence remains hint text rather than attempt identity. If retry reproduces exactly the same hint, a delayed old POST passes [pg-chat.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/store/pg-chat.ts:742) and stamps the replacement open, contradicting [remember-mode.md](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/docs/project/remember-mode.md:479). A durable server generation needs adding to the stream/request protocol; I did not change the untestable PostgreSQL path speculatively.

- **F17 — P1 — reasoned — reported.** A streaming press is held only in the mounted `Turn` ref and sent after the answer settles ([ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/web/ChatPanel.tsx:1555)). Leaving the conversation before settlement destroys that ref, so the required timestamp is never written. Correct ownership belongs in the controller or needs a durable server attempt generation.

The toggle itself is a defensible disclosure interaction. The route’s 400/404/409 split is coherent; owner scoping is in the store, the write is limited to the timestamp, and logs omit hint text.

Validation:

- Focused suite: 5 files, 89 tests passed.
- Four new regression cases were observed failing before their fixes.
- Direct typecheck passed all four projects, covering 2,998 files.
- Touched-file lint passed with only existing complexity notices.
- PostgreSQL assertions could not be rerun: owner-scoped route/status behavior, transactional fencing, retry/edit clearing, schema/migration constraints, event time, export, and fixture round-trip in the named PostgreSQL-backed suites remain reasoned.
- The peer’s eval result and two untracked eval/review artifacts were left untouched.

Changed files:

- `docs/project/remember-mode.md`
- `evals/remember-recall-checks.ts`
- `evals/remember-recall.ts`
- `src/recall-hint.ts`
- `src/web/ChatPanel.tsx`
- `src/web/chat/reduce.ts`
- `src/web/help/help-modes.tsx`
- `tests/recall-hint-panel.test.tsx`
- `tests/recall-hint.test.ts`
- `tests/remember-recall-checks.test.ts`

VERDICT: rework