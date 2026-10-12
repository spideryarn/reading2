# Code review (write-capable): 261012d stage 2, the @-mention picker and cross-article citations (client)

You are reviewing AND fixing. Repo root: the current directory, a git worktree. The stage is commit 0d20d315e (`git show 0d20d315e`). Stage 1 (server, f64a446cc + f22ad3fc5) is already reviewed; the server contract it consumes is in src/types.ts (MentionedArticleView, ChatThreadView) and the `mentions` field / `mentioned` begin frame in src/routes.ts streamChat. The plan: docs/plans/261012d-chat-at-mention-your-own-articles.md (Design §1 and §4, Stage 2). Your plan review: docs/plans/261012d-chat-at-mention-plan-review-sol.md (F1 and F7 land in this stage).

Rules for fixes: fix what is inside this stage, narrowly; failing test first where it is a guard. Report, do not fix, anything wider. No git commands that discard work (no stash, reset, checkout, restore, clean); do not commit. Read CLAUDE.md once. These tests are pure client (vitest + jsdom) and should run in your sandbox: tests/chat-mention-citations.test.ts, tests/chat-mention-picker.test.tsx, tests/chat-mentions-client.test.tsx, plus the existing chat client suites (tests/chat*, tests/one-escape*, tests/the-enter*, tests/what-the-enter*, tests/use-chat-recovery*). Run them.

The builder's notes:
- An `@` query with a space and no match is prose: the list closes and Enter sends. No match and no space shows "No article of yours has that in its title."; Enter there closes without sending.
- Tab picks only when there is a row. After a pick that `@` is marked done so the list does not reopen.
- Chips are not saved with the draft.
- KNOWN LIMIT it left for me: if the server refuses the FIRST question of a new conversation (a 400 for a mention: over cap, not processed, etc.), the chips are lost, because the panel switches to a new Composer for the failed thread. In an existing conversation they are kept. Is the draft text kept in that case? Principle: nothing silently dropped; the reader should be able to fix and resend. Fix it if it is narrow.
- ChatState.mentioned is keyed by server thread id; set from the begin frame (absent = delete), merged from a list load (never deletes).
- A router mock problem was fixed by calling readHref lazily.

What I most want checked:
- Security: can any href be built from model text rather than the server's slug? Is a colliding id (in the open article and a mentioned one, or two mentioned) plain text? Unavailable mentions give no link.
- Keyboard: Enter while the list is open never sends; Escape ladder order; IME composition untouched; the existing held-Enter / dictation / draft behaviours unchanged when no `@` is involved (kind other than chat: no combobox ARIA, no picker).
- Mentions sent only on a new send, never on edit/retry; cleared after acceptance (begin frame), kept on refusal.
- State: the "Also reading" line updates on the begin frame of the first answer (new thread id) and after reload (GET); switching threads shows the right list.
- Accessibility: role=combobox / listbox / aria-activedescendant correct; the listbox has an accessible name; touch picks work (pointerdown vs blur ordering).
- Styling: tokens only, dark mode, 390px.

Severity: P0 (security hole or data loss), P1 (reader-visible wrong behaviour, or contradicts the plan), P2, P3. Every finding: ID, severity, file:line, FIXED (with test) or REPORTING. End with one line: APPROVE, APPROVE WITH FIXES APPLIED, or CHANGES NEEDED.
