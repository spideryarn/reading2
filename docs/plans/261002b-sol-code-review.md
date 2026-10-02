VERDICT: APPROVE WITH FIXES — four in-stage issues fixed; no remaining P0–P2 findings.

1. **P1 — Candidates’ fixed hedge inherited the AI face.** [CandidatesPanel.tsx:657](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-voices-trawl/src/web/CandidatesPanel.tsx:657) used `.cnd-name` around both generated content and “said to be at.” Fixed by adding `.cnd-person-name` and narrowing selectors in [voices.css:120](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/src/web/styles/voices.css:120). Added regression assertions in [voices-css.test.ts:317](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/tests/voices-css.test.ts:317).

2. **P2 — Three UI corrections escaped the Experimental guard.** `.chat-stance-tag` and both `.passage-whole` rules affected switch-off readers. Fixed in [mode-band.css:1076](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/src/web/styles/mode-band.css:1076), [annotations.css:994](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/src/web/styles/annotations.css:994), and [dock.css:854](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/src/web/styles/dock.css:854). Added exact guard tests at [voices-css.test.ts:231](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/tests/voices-css.test.ts:231).

3. **P2 — The nav-label test did not exercise Spine’s actual label projection.** A Spine-only voice regression could remain green. Exported `childLabel` at [Spine.tsx:1359](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/src/web/Spine.tsx:1359) and tested heading/paragraph leaves directly at [nav-label-voice.test.ts:84](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/tests/nav-label-voice.test.ts:84).

4. **P3 — Documentation overstated self-hosting and model authorship.** Fixed [fonts.md:34](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/docs/project/fonts.md:34), [experimental-features.md:214](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/docs/project/experimental-features.md:214), and [mode.md:215](/home/greg/code/spideryarn2/.claude/worktrees/fb7n-81-ai-typeface-and-the-voices-trawl/docs/project/mode.md:215). Arial is now correctly described as a system face, and copied/transcribed text retains its writer’s voice.

5. **P3 — Wider, not fixed:** Biome still reports pre-existing `DesignPage.tsx` findings for `dangerouslySetInnerHTML` at line 1126 and the `take` effect dependency at line 1196. Neither relates to this stage’s one-line specimen-label edit.

The Structure/Spine provenance is correct: ranges are resolved through block-ID maps using `range[0]`; heading-leaf labels are author, paragraph-leaf labels AI, and title slots UI. No unintended text, layout, or behavioural changes were found in the component edits.

Verification:

- Focused Vitest run passed: **8 files, 88 tests**.
- `VOICES_BY_MODE` is exhaustive over `Mode`; wrong selectors and the exact four-rule structure fail the tests.
- `npm run typecheck` was attempted but its `tsx` IPC socket hit sandbox `EPERM`; running the same driver via `node --import tsx scripts/typecheck.ts` passed all **2,648 files**.
- Focused Biome lint passed for the fixed TS/TSX files.
- `git diff --check` passed.
- A final docs-only test rerun was refused by the repository’s memory admission guard; the same doc-links test had passed in the earlier 88-test run.