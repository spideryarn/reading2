No runtime CSS defects found. The in-flow pill works in the mode band, fixed dialog, and Remember. Nothing scrolls `.chat-dialog-body` from JavaScript or depends on it for focus, keyboard inset, or scroll-into-view behavior.

Findings:

- Medium — [chat-latest-pill-in-flow.test.ts:20](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/tests/chat-latest-pill-in-flow.test.ts:20): declarations from different context-specific rules could collectively satisfy the test while neither context was fully fixed. Tightened assertions around the shared rules and exact declarations.
- Medium — [prose-long-words-wrap.test.ts:20](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/tests/prose-long-words-wrap.test.ts:20): `some(break-word)` stayed green if a later `.prose` rule restored `normal` or selected `anywhere`. It now requires the effective exact-selector declarations to be only `break-word`.
- Low — [prose.css:713](/home/greg/code/spideryarn2/.claude/worktrees/fix-url-wrap-and-chat-latest/src/web/styles/prose.css:713): the comment overstated that table cells “refuse to wrap.” Reworded it in terms of `break-word` preserving min-content width.

Verification: both requested test files pass, 5 tests total. Biome reported two pre-existing descending-specificity warnings in `prose.css`; neither concerns this patch.

Nothing wider needs a decision. No commit made.