No P0 findings.

1. **P1 — A title-level `\thanks` could make a later mark point to the wrong note.** LaTeXML uses `.ltx_pubnote`, which the counter omitted. Fixed the offset calculation and added both refusing and resolvable cases. [src/latexml.ts:874](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/src/latexml.ts:874), [test:92](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/tests/latexml-title-block.test.ts:92)

2. **P1 — The word multiset could approve deletion of author text.** Arbitrary words inside `ltx_contact_name` or `ltx_note_type` were excluded as “furniture”; non-text footnotemark content was also silently dropped. Fixed by validating exact measured labels and note furniture, and refusing unknown content. [src/latexml.ts:959](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/src/latexml.ts:959), [test:215](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/tests/latexml-title-block.test.ts:215)

3. **P1 — A moved descendant could still trigger Readability’s byline deletion.** A short nested element such as `class="author-email"` survived the rewrite and was subsequently removed. The rewrite now refuses output containing any valid Readability byline candidate. [src/latexml.ts:945](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/src/latexml.ts:945), [test:244](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/tests/latexml-title-block.test.ts:244)

4. **P2 — Accepted content could invalidate the promised `<p>` shape or disappear without words.** Block elements inside contacts/notes are now refused; image-only contacts are retained rather than escaping the text-only integrity check. [src/latexml.ts:804](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/src/latexml.ts:804), [test:142](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/tests/latexml-title-block.test.ts:142)

5. **P2 — Comments still described four rewrites and omitted the title block.** Corrected both stale comments. [src/latexml.ts:77](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/src/latexml.ts:77), [src/extract.ts:817](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-authors/src/extract.ts:817)

I found no defect in Rule 3, `trimmed`, or `metaAuthors`: trimming affects only the detached clone; linked targets survive or refuse; and the default parameter retains existing callers’ meaning. Stage 3 preserves `<sup>` without treating it as a canonical footnote.

Commands and results:

- Requested mixed Vitest command: could not initialize the private-Postgres lane because no local database is available.
- Unit portion: **4 files, 151 tests passed**.
- Title-block regression suite after red-first fixes: **38 passed**.
- `npm run typecheck`: sandbox blocked `tsx` IPC; the same script via Node completed successfully: **4 projects, all 3,564 source files covered**.
- Biome lint: exit 0; three informational complexity notices, including `tidyTitleBlock`.
- Twenty-page measurement: **16/20 rewritten**, matching the original measurement.
- No commit made.

ready to push