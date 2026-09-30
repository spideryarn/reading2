# Plan review: check a cited paper supports the claim (260929g)

You are reviewing a **plan**, read-only. Do not change any file.

## The candidate

- The plan: `docs/plans/260929g-check-a-cited-paper-supports-the-claim.md` (untracked in the
  worktree at the time of writing; read it from the working tree).
- Already landed and relevant: commit `459d3c54` — `findWorkPage` extracted in
  `src/citation-find.ts` (`git show 459d3c54`).
- Start with: `docs/project/citations.md`, `src/citation-find.ts`, `src/citations.ts`
  (`linkFor`, `pageNamesTitle`, `attachFinds`), `src/chat-tools.ts` § `readWebPage`,
  `src/fetch.ts` (`fetchDocument`), `src/pdf.ts` (`pass0`), `src/quote-match.ts`
  (`quoteAppears`, `findQuote`), `src/store/pg-citation-finds.ts`,
  `docs/project/ai-gateway.md`, `docs/project/prompting-guide.md`, `docs/project/security-map.md`.
  That list does not limit your scope.

## What the feature must do

The reader's report is quoted at the top of the plan. The non-negotiable is: never attribute to the
paper anything code did not see in the paper, and always say plainly whether the paper was actually
retrieved and how much of it.

## What to do

An independent attack first. In particular:

1. Is the safety property actually enforced by the design, or could a reader still see a
   hallucinated claim about the paper's content (the `reason`, `paperDoes` and `claim` fields are
   model prose that no code checks — is that acceptable, and how should it be presented)?
2. Does `quoteAppears` / `findQuote` do what the plan needs on text from a PDF text layer
   (hyphenation, ligatures, line breaks, curly quotes)? Could it accept a quote that is not really
   there (too-fuzzy), or reject most real ones (too strict)?
3. Is the "is this the right paper" title check sound and sufficient?
4. Security: SSRF through `citation_pdf_url` redirects, untrusted paper text into a prompt, size
   and time bounds, cost bounds.
5. Is the non-streaming departure justified?
6. Is anything simpler that gets most of the value? Is anything important missing?
7. Is the storage design (new table vs something existing) the right one for this repo (see
   `docs/project/sql.md`, `docs/project/database.md`)?

## Suspicions of the author (read after your own pass)

- The pdf.js text layer might be too slow or too memory-hungry in a serverless request path.
- 60k characters head-first may miss the relevant section of a long paper; the claim might be
  supported in section 5.
- The downgrade rule for "does-not-support" without a quote may be too permissive.

## Output

Findings with IDs (P-1, P-2, …), each with severity **P0** (the plan would ship something unsafe
or broken), **P1** (important, fix before building), **P2** (worth doing), **P3** (nit). For each:
what is wrong, evidence (file:line), and the fix you recommend. End with an overall verdict: build
as is / build with changes / rethink.
