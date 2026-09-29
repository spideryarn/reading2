# Plan review prompt: shelf topics chosen by a model (260929c)

Read-only. Do not change any file. Be decisive and brief.

**Candidate (live, untracked)**: docs/plans/260929c-shelf-topics-chosen-by-a-model.md, and the spike evals/shelf-topics/spike-jev.ts. Base: `git log -1`. Context: docs/project/shelf-terms.md, docs/project/ai-gateway.md (the wires, `AiJob`, the boundary tests, spend recording, the eval seam `withLedger("eval")`), docs/project/prompting-guide.md § Measuring a prompt change, src/shelf-terms/choose.ts, src/store/pg-shelf-terms.ts, the terms route in src/routes.ts, src/web/useShelfTerms.ts, docs/project/security-map.md, docs/project/billing.md (does this spend belong to a reader's quota?).

## Please
1. Is the eval design sound enough to pick an arm (sample size, the judge's question, the control, the shuffle, the synthetic shelf)? What would make the result misleading?
2. The Jev arm: score-per-candidate then our greedy — is that a fair use of a decisions model, and is there a better question shape (e.g. noul per candidate; choice among candidates)? Any risk in calling an **alpha** endpoint from production?
3. Stage 2: storage key and refresh trigger (what shelf changes should and should not refresh), background refresh on Vercel serverless (is there a safe primitive here, or must it be inline or client-triggered?), cost attribution (whose spend, which ledger scope, any per-reader rate limit), the fallback, privacy (sending a reader's article titles/gists to a third-party model — covered by the existing notice?).
4. Anything simpler that meets Greg's ask.

## Output
Findings R1… with severity (P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design risk; P3 prose), established or reasoned, evidence, recommendation. One-line verdict.
