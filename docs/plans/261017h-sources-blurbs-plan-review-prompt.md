# Plan review: 261017h — Sources lands on a work and flashes it, a roomier list, a blurb per cited work

You are reviewing a plan, read-only. Repo: this worktree (branch from origin/dev, HEAD plus one untracked plan file).

Read, in order:
1. docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md (the plan; untracked)
2. docs/project/sources.md, and in docs/project/bibliography.md the sections "What we have read of the work", "Nothing about the work beyond the article's bibliography", "Dig deeper", "The one safety property"
3. Code: src/web/item-focus.ts (useLandOnItem), src/web/flash.ts (flashElement, scrollToAndFlash), src/web/BibliographyPanel.tsx (the focus effect ~L960-985 and the list ~L1040-1130), src/web/reader/Reader.tsx § openBibliographyWork, src/web/ProseHoverCard.tsx (Open in Sources), src/related-work.ts (OpenAlex client), src/web-search-subagent.ts, src/citation-find.ts header, src/citation-registry.ts.
4. docs/project/ai-gateway.md § "The four things that fail silently" (web search cost) and docs/investigations/261012b-web-search-subagent-spikes.md.

Questions:
- Stage 1: is centring + flashElement in the shared useLandOnItem right for all four callers (Glossary, Ideas, Claims, Bibliography)? Is there a scroller subtlety (the band's own scroller vs window; scrollIntoView block:"center" inside nested scrollers moving the page too; mobile band covering prose; the threshold-bar lowering re-render) that would make the flash land on the wrong element or before the row is placed? Anything in flash.ts's single `live` wash that a band flash would cancel (e.g. a prose block flash in flight)?
- Stage 2: is the spike designed to answer the real question (cost per article for "a decent enough job"; faithfulness)? What source of evidence is missing (Crossref abstracts, Semantic Scholar TLDR/abstract, arXiv API, Unpaywall)? Is the judge design sound?
- Stage 3: storage shape and keying vs re-made bibliographies; safety (prompt injection from abstracts/web extracts; identity of the work); whether this contradicts bibliography.md's "nothing beyond the bibliography" rule or is a legitimate, labelled exception; cost controls for web search (searches are billed per search, not per result).
- Anything simpler that gets most of the value.

Severity scale: P0 (wrong/harmful, blocks), P1 (should fix before building), P2 (worth doing), P3 (nit). Give each finding an ID (F1, F2…), the file/line, and the concrete failure scenario. End with a one-line verdict: "proceed", "proceed with changes", or "rethink".
