You are reviewing BUILT CODE in this worktree (Spideryarn, a reading app), and since 2026-09-09 the house rule is that the code reviewer FIXES what it finds inside the stage, then reports. You may edit files. Do NOT run any git command that commits, stashes, resets, checks out, restores or cleans; do not commit. Do not touch .env*, infra/, or any database.

Read first:
1. docs/plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md — the plan, already revised after your plan review (docs/plans/261002f-plan-review-sol.md). § Progress says which of your P1s were taken and why one was not.
2. The whole change, `git diff 03d0cad95 9b4b7a933` (the patch file this named was deleted after the review) (commit 9b4b7a933 against 03d0cad95). origin/dev has since been merged in on top; review the change, not the merge.
3. docs/project/fonts.md (the rule) and src/web/voice.ts, src/web/styles/voices.css, src/web/tree.ts (§ titleVoice, nodeLabel), tests/voices-css.test.ts.

Greg's instruction (2026-10-02): "Yes they should now be used throughout and always going forwards. Try and build this in a clean, general, robust way, which might require some cleaning up/refactoring." And (spya-rp8cr4): AI font for AI-generated Structure headlines, author font where the author's headline was preserved.

Hunt for, in this order:
- Text that will now render in the WRONG face for real readers: a voice-* class on an element whose own class is in a voices.css list or that carries a tw:font-* utility (the voice loses); a voice class on an element that also holds our own fixed words; an inherited voice leaking into our chrome (e.g. a .prose / author ancestor now reaching UI text on a page outside the reading view, /design, the Feedback dialog, the command bar); a title voiced "author" where it could be the reader's rename.
- Correctness of titleVoice / nodeLabel / gistVoiceOf and of every new `voice`/`titleVoice` field the subagent threaded through Quiz (src/web/position.ts), Diagram (graph.ts, diagram.ts, scatter.ts, diagram-d3.ts), Skim (SkimPanel.tsx, SkimMode.tsx), Marginalia (notes.ts, MarginaliaColumn.tsx) and the Where card (where.ts, WhereCard.tsx): a fallback string ("Untitled section", "This paragraph", "Section 2 of 4") must be "ui"; a navLabel must use navLabelVoice; the voice must come from the same node as the text.
- Layout regressions: wrapping text in a new <span> where CSS targets a direct child, :first-child, text-overflow/ellipsis on the parent, or a measured width (Outline measures candidate rows; Skim compares place text).
- The cached shelf decoder (src/web/lib/cached-shelf.ts) and anything else that reads LibraryEntry from an old body.
- Tests that cannot fail (a check you would expect to be red if the code were wrong but that passes either way).
- Docs that now say something false (fonts.md, experimental-features.md, typography.md, the plan).

Fix what you find, minimally, in the surrounding style. Then run `npm run typecheck` and `npx vitest run` on the test files covering what you touched (and tests/voices-css.test.ts, tests/nav-label-voice.test.ts). Report: numbered findings with severity (P0/P1/P2), file:line, what you changed for each (or why you left it), anything wider you did not fix for me to decide, and the gate results. End with a one-line verdict.
