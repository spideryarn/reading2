You are reviewing a short implementation plan in this repo (Spideryarn, an AI-assisted reading app). Read-only review.

Plan: docs/plans/261009e-citation-card-jumps-back-to-every-passage-that-cites-the-work.md
Context docs: docs/project/citations.md (§ Marked in the prose, § Which citation, and whose entry), docs/project/marginalia.md, docs/project/cross-references.md.
Code: src/web/ProseHoverCard.tsx (CiteCard, HoverCard's onJump and how `shown.el` is used), src/web/BlockRef.tsx, src/web/BlockLinkCard.tsx (will a BlockRef inside the portaled hover card open its own card, and does that fight the hover card's pointer-leave close?), src/web/rows.ts (citePassageKey, passageMarks), src/web/flash.ts, src/web/reader/Reader.tsx (jumpTo, ProseHoverCard props), src/types.ts (CitedWork.citedAt).

Questions:
1. Is the plan correct about the data (citedAt is complete and in document order; the reference entry already opens CiteCard)?
2. Any trap in nesting BlockRef (with its delegated BlockLinkCard) inside ProseHoverCard, touch included (first tap opens the card; does a tap on a link inside then work)?
3. Is jumpTo(id, citePassageKey(work.id)) the right aim, including when the block has no mark for the work?
4. Anything simpler, or anything missing (a11y, the "current block" detection, visitors)?

Give findings ranked by severity, each with file:line evidence, and end with a one-line verdict: GO, GO WITH CHANGES, or NO GO.
