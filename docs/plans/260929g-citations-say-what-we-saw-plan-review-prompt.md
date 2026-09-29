# Plan review (round 2, re-scoped): Citations says whether we saw the cited paper (260929g)

Read-only. Do not change any file.

## The candidate

`docs/plans/260929g-check-a-cited-paper-supports-the-claim.md` in the working tree (uncommitted
edits on top of commit 48c10568). It was re-scoped after the product owner clarified he wanted a
tweak to the existing Citations mode's prompt and UI, not a new pipeline. Your earlier review of the
first version is `docs/plans/260929g-check-a-cited-paper-plan-review-sol.md`; its findings P-1,
P-2, P-3 and P-8 are meant to carry over.

Start with: `src/citation-find.ts` (`FIND_SYSTEM`, `readFind`, `findWorkPage`, `makeFindCitation`),
`src/citations.ts` (`attachFinds`, `namesTitle`, `pageNamesTitle`, `linkFor`),
`src/openrouter-stream.ts` (`collectSearchEvidence`, `MAX_EVIDENCE_EXCERPT`),
`src/quote-match.ts` (`findQuote`, "spaced"), `src/debate.ts` (its quote-against-excerpt
attribution rule), `src/store/pg-citation-finds.ts`, `citationFinds` in `src/db/schema.ts`,
`src/web/CitationsPanel.tsx`, `src/web/ProseHoverCard.tsx` § CiteCard, `docs/project/citations.md`.
That list does not limit your scope.

## Questions

1. Is the safety property sound: nothing is attributed to the paper unless code found it in the
   search extract of a result whose own title names the work? Is the extract that
   `url_citation.content` carries really what the model saw, and does that matter given we verify
   against it?
2. Opening the lookup to rows the article already linked: does anything assume a `citation_finds`
   row exists only for `search` rows (attachFinds, the public DTO, the UI, export)? Could the found
   URL ever leak into the row's link?
3. Folding the judgement into the one Find-it call: does it weaken the URL pick (a longer answer, a
   harder prompt), or its cost bounds?
4. Is there a simpler version that gets most of the value? Is anything important missing?
5. Staleness: is hashing `why` plus the citing passage right and sufficient?

## Output

Findings with IDs (R-1, …), severity P0/P1/P2/P3, with evidence (file:line) and a recommended fix.
End with: build as is / build with changes / rethink.
