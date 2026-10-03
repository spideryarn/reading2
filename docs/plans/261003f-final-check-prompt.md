# Narrow final check: 261003f (F18's fix, and the docs against the code)

You are a reviewer who also fixes. General discovery on this plan is closed (two code rounds done:
docs/plans/261003f-stage-1-code-review-sol.md, docs/plans/261003f-stage-2-code-review-sol.md). This
is the scoped check of what neither round saw. HEAD is 10679db2b in this worktree; the tree is clean.

1. **F18's fix**, which was not in your stage-2 snapshot (you reported it; I fixed it): in commit
   1e2bba89c, `withoutCommandLines` at the end of src/citable.ts, its use in src/web/ChatPanel.tsx
   (`CopyAnswer`), and tests/copy-answer-leaves-out-command-tokens.test.ts. Does the copy now match
   what the reader was shown (a button line left out; a token in code, mid-sentence or in a
   blockquote kept as text; an answer with no button unchanged byte for byte)? Any input where it
   drops prose, or disagrees with what src/web/Cited.tsx draws (list items, nested structure, CRLF,
   a token line during streaming, an invalid token on its own line)? Run the test file; mutate.
2. **The docs written for this plan, checked against the code** (commit 1e2bba89c's doc changes;
   `git show --stat 1e2bba89c -- docs evals src/web/help`): docs/project/chat-tools.md § Command
   buttons and its Security and Not-built edits, reading-view-overview.md § The command bar,
   chat-llm-help-commands-vision.md, dictation.md, library.md, glossary.md,
   experimental-features.md, web-client.md, evals/README.md, and the two reader-facing Help edits
   (src/web/help/help-topics.tsx, help-modes.tsx). Is any sentence false against the code at HEAD,
   or promising a reader something the app does not do? Also
   docs/user-feedback/260929_1748-commands-with-arguments-and-the-same-actions-in-chat.md.

Fix narrowly, red-first for code; for docs just correct the sentence. Report anything wider without
fixing. No network or loopback; do not commit. Severity scale P0–P3 as before; IDs continue at F19.
End with a verdict: land / land with these fixes / do not land.
