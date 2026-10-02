You are the CODE reviewer for plan docs/plans/261002b-a-nicer-ai-typeface-and-the-voices-trawl.md, and you may FIX what you find inside this stage (sandbox workspace-write). Do not commit, push, stash, reset or checkout; do not run git commands that change state. Do not run the full test suite.

The work is the two commits `git diff 886812f5a..HEAD` (the plan, research and trawl docs ride along in the first; review the code and docs/project changes). Evidence: docs/plans/261002b-voices-trawl.md (file:line audit and provenance of each string), docs/plans/261002b-sol-plan-review.md (your plan review; its four findings were meant to be taken), docs/project/fonts.md (the rule).

Check:
1. Each new voices.css selector actually matches the element it is meant to, and only that element (mixed elements, fixed UI strings swept into the AI or reader face, inherited faces broken by a child that resets font-family, `tw:font-*` utilities on the same element beating the rule).
2. The Structure/Spine provenance: `startsAtHeading` in src/web/tree.ts and its use in structure.ts, Spine.tsx and StructurePanel.tsx — is a heading leaf's navLabel author, a paragraph leaf's AI, a title UI? Is the block-at-range[0] lookup right (ids, ranges — see docs/project/block-ids.md)?
3. tests/voices-css.test.ts: the VOICES_BY_MODE guard (does a missing mode fail typecheck? does a wrong class fail?), the relaxed token check and the 3→4 rule count — did any loosening let a real failure through? tests/nav-label-voice.test.ts: would it go red on a regression?
4. Unguarded CSS: the `.passage-whole` rule outside `:root[data-voices]`, and any other change that affects readers with the Experimental switch off.
5. Any component edit that changes text, layout or behaviour beyond adding a class/wrapper (e.g. Timeline, Diagram's evidence() now returning JSX, Debate title, chat thread list `lastSaid`).
6. fonts.md accuracy against the code.

Then run: npm run typecheck; npx vitest run tests/voices-css.test.ts tests/nav-label-voice.test.ts tests/use-voice-faces.test.tsx tests/doc-links.test.ts plus the test files for any component you change.

Output: verdict line, then numbered findings (P0-P3) with file:line, what you fixed (with the files), and anything wider you did NOT fix for me to decide. Check your own conclusion before you finish.
