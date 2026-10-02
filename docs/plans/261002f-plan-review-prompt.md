You are reviewing a plan, read-only, before it is built. Repo: this worktree (Spideryarn, a reading app).

Read, in order:
1. docs/plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md — THE PLAN under review.
2. docs/project/fonts.md, src/web/styles/voices.css, tests/voices-css.test.ts, src/web/useVoiceFaces.ts — what exists now.
3. docs/plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md and docs/plans/261002b-voices-trawl.md (§ 5) — the previous work and its audit.
4. Whatever source the plan names that you need to check a claim: src/web/tree.ts (navLabelVoice), src/web/structure.ts, src/web/outline.ts, src/web/Spine.tsx (bandLabel), src/types.ts (TreeNode.sourceHeading, LibraryEntry), src/tree-invariants.ts (sameHeading), src/heading-tree.ts, src/structure-expand.ts / src/structure-cascade.ts (how titles and sourceHeading are written), src/supplement.ts, src/library-scalars.ts (rootGist fallback, describeArticle), src/store/pg.ts (library projection), src/store/public-library.ts, src/web/router.ts (Route), src/web/Metadata.tsx, src/web/ShelfEntry.tsx, src/web/library-columns.tsx, src/web/TitleEditor.tsx, src/web/Masthead.tsx.

Greg's instruction (2026-10-02): "Yes they should now be used throughout and always going forwards. Try and build this in a clean, general, robust way, which might require some cleaning up/refactoring." And on Structure: AI font for AI-generated headlines; ideally author font where the author's headline was preserved.

What I want from you:
- Is anything in the plan FALSE about the code? (Especially: that sourceHeading + sameHeading reliably tells a kept author heading from a model title, across heading-tree, cascade and expand trees, including whether the stored title can differ from sourceHeading for a kept heading — section-number stripping, heading-snap, truncation; that root_gist === excerpt is a sound provenance test for the shelf gist, including whether the excerpt column could have changed while root_gist did not, or the root gist/summary could equal the excerpt; that removing :root[data-voices] → :root keeps every voice winning the cascade.)
- What will silently go wrong? Elements that will land in the wrong face once the guard is gone on every page (the plan lists /design and the Feedback dialog — find others); places where the generic voice-* classes will be beaten by a tw:font-* utility or by an element's own font-family rule; places titles are drawn that the plan missed.
- Is the guard (VOICES_BY_SURFACE as Record over Route kinds + ArticleView) real, and is there a simpler or stronger one?
- Is there a simpler design that meets Greg's "clean, general, robust" ask? Is the voiceClass/named-class split sensible?
- Anything that touches a security defence (docs/project/security-map.md) besides the public shelf the plan already defers?

Answer with numbered findings, each with severity (P0 blocks, P1 should change the plan, P2 worth noting), file:line evidence, and the concrete change you recommend. Then a one-line verdict. Do not edit any file.
