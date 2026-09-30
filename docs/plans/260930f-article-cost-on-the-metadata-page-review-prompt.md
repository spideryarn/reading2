# Plan review: 260930f — per-article AI cost on the metadata page (admin)

You are reviewing a PLAN before it is built, read-only. Repo root is the current directory.

Read: docs/plans/260930f-article-cost-on-the-metadata-page.md (the plan).
Then check its claims against the code: src/ai-spend.ts (collectSpend, withSpendAttribution, the
`write` function building AiCallRow), src/store/ai-calls-pg.ts (articleIdFor), src/store/ai-calls-spend-pg.ts,
src/cost-categories.ts (costCategoryOf), src/routes.ts (dispatchAuthRoute ~line 9284, PatternAuthRoute
type ~6883, AUTH_ROUTES, the /api/admin namespace gate ~9382, GET /api/link-summary ~7504, POST
/api/transcribe ~7278 and transcribeDictation ~5894, slugPart ~4750), src/jobs.ts runStep ~1071,
src/admin.ts, src/web/Metadata.tsx, docs/project/ai-gateway.md, docs/project/admin.md, docs/project/testing.md.

Questions I most want answered:
1. Is keying the article query on article_slug (not article_id) correct? Are slugs really globally unique and
   never reused or renamed, so every row for an article carries its current slug?
2. The required `article: "first-capture" | "none"` field on PatternAuthRoute, applied in dispatchAuthRoute
   with lenient decoding: is this the right seam? Could wrapping the handler in withSpendAttribution change
   any behaviour (errors, status codes, streaming, ordering), or misattribute (e.g. a route whose first
   capture is a slug of an article the requester does NOT own — is that desirable for the per-article view)?
   Is there a better way to make attribution automatic?
3. Does anything in the plan touch a security defence (docs/project/security-map.md)? It must not.
4. The paid check in evals/: is the assertion set right? Would scopeKind "eval" rows written to the dev
   ledger harm anything (npm run cost, /admin/users)? Anything that makes it silently pass?
5. Anything missing that makes the admin figure misleading (silent-success shapes)?

Write findings as a numbered list with severity P0-P3, each with file:line evidence and a concrete fix.
End with a one-line verdict: BUILD AS IS / BUILD WITH CHANGES / RETHINK.
