No P0/P1 findings. Two **P2 findings, both fixed** (line numbers refer to the reviewed commit):

- **[GlossaryPanel.tsx:2248](/home/greg/code/spideryarn2/.claude/worktrees/fb-glossary-findmore-metadata-toggle/src/web/GlossaryPanel.tsx:2248): stalled warning lost.** Removing the stale banner left `stalled={false}` as the only progress surface. The row now forwards `owner.stalled`.
- **[GlossaryPanel.tsx:2260](/home/greg/code/spideryarn2/.claude/worktrees/fb-glossary-findmore-metadata-toggle/src/web/GlossaryPanel.tsx:2260): failure recovery lost.** The row replaced Retry with a fresh paid run, including after nonretryable failures. It now delegates failures to `JobProgress`, preserving Retry and button suppression.

The remaining traces agree: source checks use the same `articleFingerprint`; profile checks hash the same rendered string; `alsoFrom` cannot override the final `profileChanged`. Visitors, empty lists, starting jobs, and Metadata text-field guards behave correctly. I corrected related documentation inconsistencies.

The new regression tests failed before the fixes. Against the parent commit, glossary regression cases fail, and both Metadata return tests fail; the unchanged article-to-Metadata control test correctly passes.

**Validation:** 176 focused tests passed; typechecking passed through Node. Full `npm test` was blocked by sandbox access to Postgres. Nothing committed.

Wider, pre-existing **P2s left for your decision**:

- `src/web/router.ts:628`: encoded `%70anel=` survives `carriedSearch`, potentially reopening a drawer.
- `src/web/help/help-modes.tsx:192`: Help says Look up does not add terms, contradicting the current added-term behavior.