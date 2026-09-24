# Narrow plan review: stage 3b, HTML imports write maths as delimited TeX

Read-only. Repo spideryarn2; `CLAUDE.md` once for house rules. Stages 1–3 of this plan are committed
(`42cb3bf5`); review **only** the section `## Stage 3b: HTML imports` of
`docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md` (and the short reframing added to its
opening and to the top of `docs/project/maths.md`). Nothing is built yet. Other agents edit other
files in this tree; ignore them.

Code to read: `src/extract.ts` (`prepareDocument`, `readArticle`, `readArticleWithProvenance`,
`runExtract`, `unhideCollapsedSections`), `src/sanitize-policy.ts` (the `annotation` hook),
`src/maths-tex.ts`, `src/web/maths.ts`, `src/pdf-tex.ts` (the temml loader), `src/blocks.ts` or
wherever stage 3 recovers ids (see `docs/project/block-ids.md`), and the fixtures
`evals/extraction/fixtures/{ar5iv,wiki_transformer,distill_momentum}.html`.

Attack it: will the one seam really cover these three shapes; what could it convert wrongly (maths
inside `code`/`pre`, a `<math>` inside a heading or a link, an annotation whose TeX is not TeX); does
"never worse than today" hold; is the block-id account right; does anything downstream of the
source DOM (notes, callouts, protect, Readability's scoring, the provenance arm, the extraction
evals' hashes) change in a way the plan does not name; is the load order sound on the API's cold
start and in the bundle trace.

Severity: P0 data loss/security/charging; P1 user-visible wrong behaviour or contract violated; P2
design risk; P3 prose. Refuse only on an **established** P0/P1. IDs start at **K1**. For each:
severity, established/reasoned, evidence (file:line), the change to the plan. One-line verdict.

My suspicions (mine, worth less): the extraction eval's `hashes.json` will move for the three
fixtures; Readability may score a paragraph differently once its `<math>` becomes text.
