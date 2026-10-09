Verdict: **ready to push after the two fixes below**. No P0 or unresolved findings.

1. **P1 — malformed note furniture could manufacture an affiliation phrase.**  
   [src/latexml.ts:913](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/latexml.ts:913) previously removed every `NOTE_FURNITURE` match without validating its structure. A hostile page printing `Department INJECTED WORDS University` was projected as `Department University`, which the model could store.

   Fixed by removing note furniture only when the existing `noteContent` validator proves the measured LaTeXML shape. Malformed content remains as evidence. The test at [tests/arxiv-affiliations.test.ts:113](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/tests/arxiv-affiliations.test.ts:113) was red first, accepting `Department University`.

2. **P1 — the glued-marker allowance could drop a real institution prefix.**  
   [src/pdf-authors.ts:365](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/pdf-authors.ts:365) allowed the per-author ownership check to treat any leading letter or up to three digits as a marker. Thus a model could turn the printed `3M Company` into stored `M Company`.

   Fixed by retaining the allowance for PDF page verification but requiring an exact word run for the HTML per-author ownership check at [src/pdf-authors.ts:391](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/src/pdf-authors.ts:391). The test at [tests/arxiv-affiliations.test.ts:103](/var/tmp/spideryarn-worktrees/fbxg4jyr-arxiv-affiliations/tests/arxiv-affiliations.test.ts:103) was red first.

No findings on placement, degradation, logging, cost attribution, or downstream `meta.authors` consumers. The affiliation call occurs once after all refusals, aborts propagate, ordinary failures retain names only, and cost inherits the extract step’s collector.

Verification:

- Requested five-file suite: **239 tests passed**
- `npm run typecheck`: its `tsx` CLI could not create its IPC socket under this sandbox (`EPERM`); the equivalent `node --import tsx scripts/typecheck.ts` passed all projects and covered all 3,593 source files
- Touched-file lint: no errors; four pre-existing complexity notices
- `git diff --check`: clean
- No database, network/model, eval, commit, or Git-state operation performed