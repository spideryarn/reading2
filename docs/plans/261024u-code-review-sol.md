C1 — Medium — Fixed counter/render disagreement. Markdown, code, link, and command-token boundaries could wrongly merge citation runs and suppress a valid conversation count. Updated [citable.ts](/var/tmp/spideryarn-worktrees/fbt7cq2s-chat-link-previous/src/citable.ts:108) and added red-first coverage in [chat-markdown-render.test.tsx](/var/tmp/spideryarn-worktrees/fbt7cq2s-chat-link-previous/tests/chat-markdown-render.test.tsx:477).

C2 — Low — Fixed the new band test’s missing required `onScreen` prop, which failed typechecking, at [chat-thread-link-band.test.tsx](/var/tmp/spideryarn-worktrees/fbt7cq2s-chat-link-previous/tests/chat-thread-link-band.test.tsx:140).

C3 — Low — Closed two test gaps: floating-dialog push/Back/no-scroll navigation and mentioned-article block/thread collisions, in [chat-thread-link-band.test.tsx](/var/tmp/spideryarn-worktrees/fbt7cq2s-chat-link-previous/tests/chat-thread-link-band.test.tsx:215) and [chat-markdown-render.test.tsx](/var/tmp/spideryarn-worktrees/fbt7cq2s-chat-link-previous/tests/chat-markdown-render.test.tsx:519).

No further security, navigation, counter, or prompt findings. Destinations remain restricted to owner-scoped conversations for the current article; Guide/Learn targets and pushed `scroll: false` navigation are correct.

Checks:

- Requested Vitest gate: 227 passed.
- Typecheck: all five projects passed; all 3,988 sources covered.
- Related reader-notes tests: 88 passed.
- Lint and `git diff --check`: passed.
- `npm test` could not start its database lanes because this sandbox forbids Docker/Postgres access.
- `npm run typecheck`’s `tsx` wrapper hit a sandbox IPC restriction; the identical script passed via `node --import tsx`.

Unrelated existing plan/review artifact edits were left untouched. No commit or push performed.

VERDICT: ready