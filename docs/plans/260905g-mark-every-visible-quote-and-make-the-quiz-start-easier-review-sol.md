# GPT Sol's review of the built change — 260905g

`gpt-5.6-sol`, high effort, 2026-09-05, against the scoped diff and the tree. The prompt it was given
is [260905g-…-review-prompt.md](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier-review-prompt.md);
what was done with each finding is in
[the plan § What the review changed](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md#what-the-review-changed).
All four were taken.

Up: [260905g](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md)

---

## Findings

1. **[P2] “Every visible quote is marked” fails for stale artefacts.**  
   [`resolveQuotes`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/web/search-hits.ts:686) drops a quote when its block no longer exists, but [`QuotesPanel`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/web/QuotesPanel.tsx:646) still renders that row from `markedQuotes`. The row remains selectable, has no wash or ring, and `onJump` targets a missing block. This also makes the absolute claims in [`quotes.md`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/docs/project/quotes.md:3) and [`App.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/web/App.tsx:4793) false. Either filter/disable rows that did not resolve, or explicitly define stale rows as an exception and soften “exactly the same set.”

2. **[P2] Asking for only two hard questions reduces the gate’s post-validation safety margin.**  
   [`QUIZ_SYSTEM`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/quiz.ts:962) now asks for two hard questions, but [`missingBandEnds`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/quiz.ts:342) runs after malformed or unanchored questions have been dropped. Losing both hard questions now throws away the paid batch; previously three had to be lost. The new eval’s three rejected evidence quotes show that validation loss is real, although no whole question was lost there. The mechanism is definite; how often it will fail is a guess. The smallest prompt-only correction is five easy and three hard, which still leads materially easier while retaining the previous hard-end redundancy.

3. **[P3] The new cleanup behavior is not exercised by a component test.**  
   [`passage-mode-cleanup.test.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/tests/passage-mode-cleanup.test.tsx:5) claims to cover Quotes, but `BandName` and the harness include only Ideas, Timeline, and Referee at [line 229](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/tests/passage-mode-cleanup.test.tsx:229). The new source-regex test checks the layout-effect calls, not the unmount cleanup. Add Quotes to that harness and assert multiple initial marks, a pressed open key, then `found=[]` and `openKey=null` after unmount. A runtime test for preserving `?quote=` while a prioritised artefact is loading would also protect the deliberate guard.

4. **[P3] Several source comments still describe selected-only marking.**

   - [`quoteParam`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/web/params.ts:373) says selection determines which passage is marked and painted down the rail.
   - [`QuoteRow.onSelect`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/web/QuotesPanel.tsx:658) says deselecting takes the mark out of the prose; it now removes only the ring.
   - [`artifacts-fs.ts`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/store/artifacts-fs.ts:280) still says at most sixteen quotes.
   - [`QuotesBand`](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/web/App.tsx:4718) and `useQuotesMode` at [line 4783](/home/greg/code/spideryarn2/.claude/worktrees/socratic-summaries-and-gating/src/web/App.tsx:4783) still describe one resolved passage.

## Checked and sound

- The `hiddenSelection` reasoning is right. Loading with `rank=prioritised` falls back to document order and preserves `?quote=`; once data arrives, a threshold-hidden selection becomes `null` immediately and its URL is cleared afterward. I found no bar-hidden selection that remains visibly selected.
- The combined layout effect and unmount cleanup are correctly ordered. The two parent state updates happen before paint, and quote state is isolated from the other mutually exclusive passage modes.
- The shared `runId` does not break the named consumers. `hitMarks` uses `Found.key`; `blockMatches` deliberately collapses quotes to one source per block while retaining the occurrence count; `blockHues` and `spineMarks` consequently draw one hue/lane; `orderFound` ignores `runId`; `SearchPanel` never receives quote passages.
- I found no 32-quote cliff. The maximum answer estimate is 7,540 tokens, producing a 47,540-token budget with reasoning headroom; annotation remains limited to marked blocks, same-slot overlaps collapse to one stripe, and the paragraph/rail counts retain individual occurrences.
- The VALUE addition does not logically collapse band and value. It does create a preference for their easy/high-value intersection; the possibility that some articles lack five such questions and induce score inflation is a guess, not established by the single eval.

Validation: 8 relevant test files passed, 265 tests total. The complete typecheck passed via `node --import tsx scripts/typecheck.ts`, covering all 1,368 source files.