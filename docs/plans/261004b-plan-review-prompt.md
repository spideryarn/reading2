You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, React client). You are in the worktree the plan will be built in.

Plan: docs/plans/261004b-citation-hover-card-offers-dig-deeper.md

Read it, then read the code it touches and check its claims against the code:
- src/web/useCitations.ts (useCitationsRead, useCitations, investigate and its slug cleanup)
- src/web/modes/citations/CitationsMode.tsx, src/web/CitationsPanel.tsx (orderWorks, visibleWorks, priorityOf, BarSlider, WorkRow), src/web/CitationInvestigation.tsx (InvestigateButton, investigationViewOf)
- src/web/ProseHoverCard.tsx (CiteCard, and TermCard's dig as the precedent), src/web/reader/Reader.tsx (works, openTermInGlossary, the ProseHoverCard call, band()), src/web/article/ArticlePage.tsx (useCitationsRead), src/web/reader-capability.ts
- src/web/useGlossary.ts (how 261002c lifted `look` onto the read), src/web/GlossaryPanel.tsx gateToReveal, src/web/threshold.ts
- tests/citations-investigate-client.test.tsx, tests/citations-find-late-reply.test.tsx, tests/citation-hover-card.test.tsx
- docs/project/citations.md, docs/project/debate.md

Questions I most want answered, Part 1 (to be built):
1. Is lifting the investigate state into useCitationsRead sound? What did the band's unmount give that is lost (abort, clearing the draft/failure/findNote, admission), and does anything rely on it? Races between the read's own load/refresh ordering and the investigate patches now they share a hook?
2. The one-shot focus (Reader state -> CitationsBand -> panel scrolls, lowers ?citebar= if hidden, reports taken): races (list still loading, stale list, a visitor, the row unscored, order not prioritised, the nuqs write landing a render later), and is there a simpler way that is as correct?
3. The card button: should it be refused or disabled in any state the row's own button is (stale list, list not ready)? Touch: the row's button uses useTapReveal so a finger's first tap does not spend money; the glossary card's button does not. Which should this one copy?
4. Anything that makes a visitor able to see or press it.
5. Anything simpler that gets the same result.

Part 2 is a proposal for the product owner, not to be built. Say only whether its description of what exists today is accurate against the code (in particular the C1 claim that a Debate claim knows its passage and a cited work knows where it is cited, so they could be joined without a model call), and whether an option is missing.

Report findings ranked by severity, each with file:line evidence and a concrete fix. Do not edit files.
