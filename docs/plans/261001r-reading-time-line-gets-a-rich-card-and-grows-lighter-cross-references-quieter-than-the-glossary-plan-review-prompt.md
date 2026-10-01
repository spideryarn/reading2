You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only.

Plan: docs/plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md

Read it, then the code it touches: src/web/BlockLinkCard.tsx, src/web/BlockGutter.tsx (the .blk-read span near the end), src/web/styles/gutter.css § reading time, src/web/reading-time.ts (readLevel, gutterCss), src/web/ReadingTimeStyle.tsx, src/web/styles/annotations.css (mark.term, mark.cite, mark.xref, mark.cmt), src/web/styles/prose.css (.prose a), docs/project/tooltips.md, docs/project/reading-time.md, docs/project/cross-references.md, styles/tokens.css header.

Check, with evidence from the code:
1. Is reusing BlockLinkCard's delegated card for span.blk-read sound? Hit-testing (gutter is pointer-events:none, the strip auto; data-open makes it inert), the aria-describedby effect on an aria-hidden span, the detach observer, the virtual reference at pointer height with autoUpdate, and whether getComputedStyle(...).getPropertyValue('--read') on the span reliably yields the level the row's generated rule sets.
2. Any place that mounts the gutter without a BlockLinkProvider (so the line would lose its only explanation once the title goes)?
3. Is the proposed card wording true to the code (counts only while on screen and active; only the owner sees it)?
4. The CSS change for glossary vs cross-reference: will each of comment, glossary term, citation, cross-reference, author link, and their overlaps (mark.cmt.term, a cite and xref over one phrase, term + xref) still be distinguishable and correct? Any rule elsewhere (narrow-window.css, glossary.css, print, tests) that pins the old values?
5. Anything simpler I missed.

Answer with numbered findings, each with severity (P0-P3), file:line evidence, and a concrete fix. Say plainly if a point checks out.
