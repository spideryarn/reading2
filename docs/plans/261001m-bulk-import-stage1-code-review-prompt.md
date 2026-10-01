# Code review: bulk import, Stage 1 — the paper-metadata extractor and its model (261001m)

You are reviewing, and you may fix what you find, **only in these Stage 1 files**:
`src/paper-metadata.ts`, `tests/paper-metadata.test.ts`, `src/pdf.ts` (§ `firstPagesText`),
`evals/pdf/minimal-metadata/{score.mts,expected.json}`, `evals/results/paper-metadata-2026-10-01.md`,
and the Stage 1 hunks in `src/ai-call.ts`, `src/models.ts`, `src/cost-categories.ts`,
`src/plain-words.ts`, `src/web/PrivacyPage.tsx`, `docs/project/setup-dev.md`.
Another agent is editing billing files (`src/billing/*`, `src/store/pg-billing.ts`, drizzle/,
tests/billing-*) in this same tree right now: **do not touch those**, and ignore typecheck noise
from them. No git commands that change the index or discard work; no commits.

The plan: `docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md`, § Greg's answers
(point 5, the model), § The build → "The metadata step", § Stages item 1. The scoped diff is
`docs/plans/261001m-bulk-import-stage1.diff`. House rules for prompts:
`docs/project/prompting-guide.md`; for the gateway: `docs/project/ai-gateway.md`; security:
`docs/project/security-map.md` (a PDF is a stranger's document; model output is untrusted).

Check above all:
1. **ZDR**: does every call the `paper-metadata` job can make go only to ZDR endpoints? Read the
   route (`AI_JOB_ROUTE["paper-metadata"]`) and `outgoing()` in `src/ai-call.ts`: can a caller's
   body override the provider block? Is `zdr: true` + `only` + `order` + `allow_fallbacks: true`
   correct per OpenRouter's semantics (the comment cites the docs)?
2. **Prompt injection / fencing**: the PDF text is wrapped in `<pdf_text>…</pdf_text>`. Can text
   inside the PDF close the fence? Is the answer validated so that nothing the model writes can be
   more than a bounded string in title/authors/abstract/doi? Is the DOI validated before it could
   become a link?
3. **Silent success**: a malformed answer, an empty answer, a provider refusal, a timeout, a PDF
   that pdf.js cannot open, a password-protected PDF — what does each return or throw? The plan
   says no text layer → filename title, no call; model failure → the job fails. Is any failure
   turned into a plausible-looking empty metadata?
4. **Cost**: the spend reaches the ledger (`docs/project/cost-tracking.md`); `cost-categories.ts`
   classification right; max tokens bounded.
5. **The eval**: are the scores honest (expected.json right? the scorer's matching fair to both
   models)? Is the verdict in the results file supported by the numbers?
6. Tests: do they test behaviour, and would they go red on the obvious mistakes?

Fix what you find inside the Stage 1 files, run `npm run typecheck` and
`npx vitest run tests/paper-metadata.test.ts tests/models.test.ts tests/privacy-page.test.ts tests/ai-call.test.ts tests/cost-categories.test.ts`
and report: numbered findings (P0/P1/P2) with file:line, what you changed for each, test results,
and anything wider that you did not fix. End with a one-line verdict.
