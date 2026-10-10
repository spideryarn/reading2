Four stage-1 findings fixed red-first; one wider finding reported.

- **F10 — P1, established, fixed-by-me:** All-unknown `?citeby=influence` silently reordered rows while offering no selected influence button. It now falls back to first cited. Both owner and visitor regressions failed before the fix. [Evidence](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/tests/bibliography-panel.test.tsx:148).
- **F11 — P1, established, fixed-by-me:** UI/chat invented model uncertainty as the cause of every absent influence. Missing, rejected and explicit unknown scores share the same stored shape. Copy now says “no usable score”; Help and comments distinguish newer scores from older retained numbers. [Corrected explanation](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/web/BibliographyPanel.tsx:548).
- **F12 — P3, established, fixed-by-me:** Tooltip advice implied a threshold applied in every order. It now explicitly names prioritised order. The regression was observed red. [Evidence](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/tests/bibliography-panel.test.tsx:166).
- **F13 — P1, established, fixed-by-me:** Tapping the unfocusable unknown label opened no persistent explanation. It now uses a button and the existing touch hook; the tap/scroll regression failed before the fix. [Evidence](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/tests/bibliography-panel.test.tsx:770).
- **F14 — P1, established, reported:** The pre-existing sibling remains for `?citeby=relevance` when no row has relevance: `effectiveOrder` retains it while the menu omits it. Outside this influence stage. [Selection](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/web/BibliographyPanel.tsx:371), [availability](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/web/BibliographyPanel.tsx:930).

The prompt consistently permits number-or-null influence and requires numeric relevance. Its schema matches the Messages wire and local strict validators. Public DTO/export preserve absence; marginalia and prose hover cards draw no scores. All-unknown prioritisation is intentional. Defaults, counts, track bounds and flat-list fallback passed.

I ran `tests/citations.test.ts`, `tests/citations-panel.test.tsx` and `tests/chat-citations-tool.test.ts`. Final raw result:

```text
 Test Files  3 passed (3)
      Tests  221 passed (221)
```

Four additional relevant suites passed in the broader run: `Tests 336 passed (336)`. Doc-link checks passed. Typechecking passed via `node --import tsx scripts/typecheck.ts`; the npm launcher hit a sandbox pipe restriction. Lint reported three informational findings.

Both deliberate mutations were noticed and undone:

- Store null influence as zero: `Tests 1 failed | 3 passed | 87 skipped (91)`.
- Treat unknown influence as unscored: `Tests 2 failed | 95 skipped (97)`.

Please run full `npm test` with Postgres and check tap/scroll dismissal on a physical iPad. No commits, migrations, model calls or edits to `evals/results/`.

Files changed:

- [citations.md](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/docs/project/bibliography.md)
- [src/citations.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/bibliography.ts)
- [src/chat-tools.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/chat-tools.ts)
- [src/types.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/types.ts)
- [CitationsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/web/BibliographyPanel.tsx)
- [help-faq.tsx](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/web/help/help-faq.tsx)
- [help-modes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/web/help/help-modes.tsx)
- [params.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/web/params.ts)
- [citations.css](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/src/web/styles/bibliography.css)
- [chat-citations-tool.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/tests/chat-citations-tool.test.ts)
- [citations-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/tests/bibliography-panel.test.tsx)
- [Root-cause write-up](/home/greg/code/spideryarn2/.claude/worktrees/citations-influence-unknown/docs/postmortems/261003f-citation-influence-review-provenance-and-order-capability.md)

land after fixes