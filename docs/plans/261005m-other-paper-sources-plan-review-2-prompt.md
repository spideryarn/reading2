# Plan review, round 2: a landing-page link imports the paper (the other paper sources)

Read-only. Change no file. This is the second and last discovery round on this plan.

## The candidate

The plan and research as they stand in this worktree's working tree at the commit named in the
last line of this file (`/var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources`):

- `docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md` — revised after your round 1. Its § Reviews table says what was done with each of G1–G10.
- `docs/research/261005e-where-a-reader-s-paper-link-points-the-other-sources-measured-and-ranked.md`
- your round-1 answer: `docs/plans/261005m-other-paper-sources-plan-review-sol.md`
- the measurement: `evals/results/paper-sources-261005/summary.md`, `results.json`, `evals/paper-sources/cases.json`

The mechanism it builds on is still part 1's commit `0f63486a2` (not in this tree; `git show 0f63486a2:src/paper-sources.ts`, `:src/pipeline.ts`, `:src/cited-in-spideryarn.ts`, `:src/paper-text.ts`, `:src/ingest.ts`).

## What I want

1. **For each of G1–G10: is it closed by the revised plan?** Say closed / still open / closed but the fix opened something, with the trace.
2. **Attack the revised design afresh**, especially what is new since round 1:
   - "The arXiv mirrors are arXiv": Hugging Face and alphaXiv as extra shapes inside part 1's `arxivIdIn`, so `arxivIdOf`, `identityOf` and `arxivPdfUrl` learn them. Trace every caller of `arxivIdOf` / `resolvePaperSource` / `urlKey` at `0f63486a2` and say where treating `huggingface.co/papers/<id>` as the arXiv paper is wrong or surprising (for instance a place that shows or stores the address, or assumes the host is arXiv's).
   - "Every candidate is the paper; a missing PDF fails": which failure sentence does the reader actually get from `fetchFirstCandidate` when the only (or last) candidate answers 404, and is it acceptable? Is there any path by which that failure charges the reader?
   - "The address the fetch ends on resolves to the same paper": is the rule sufficient to prevent the repeat-charge of G1 for the seven sources kept? Anything else in identity (`slugFromUrl` with a cut slug, two CVF papers whose names share 60 characters, `slugWithShortId`) that breaks?
   - NeurIPS: the PDF's ending read off the abstract address. PMLR: two candidates, both PDFs.
3. **Is the cut now right** (seven built; DOI/redirect look, NBER, OSF, bioRxiv/medRxiv, `citation_pdf_url`, OpenReview, HAL deferred; PubMed/PMC for Greg)?
4. Anything in the plan that cannot be built as written against `0f63486a2`.

Same severity scale as round 1 (P0 data loss / security / wrong charging; P1 user-visible wrong behaviour or a contract violated; P2 design risk; P3 prose). New findings continue the numbering from G11, each *established* or *suspected*, with the concrete sequence and the smallest credible fix. No network.

End with one line: `VERDICT: build it` / `VERDICT: build it after fixing G…` / `VERDICT: do not build`.
