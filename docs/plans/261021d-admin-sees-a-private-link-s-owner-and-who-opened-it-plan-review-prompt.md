# Plan review: 261021d

You are reviewing a plan before it is built, read-only. The repo is Spideryarn (TypeScript, Postgres via Drizzle). Read:

1. docs/plans/261021d-admin-sees-a-private-link-s-owner-and-who-opened-it.md — the plan under review.
2. docs/user-feedback/questions/q-agbc89.md — the question Greg answered; his reply is quoted at the top of the plan. His reply is the authority for exactly options 1B and 2C and nothing wider.
3. docs/project/security-map.md (the defences table, § "a second way in, which is a key", the public namespace), docs/project/admin.md (§ What it deliberately does not show, § Whose article it is), docs/project/privacy.md § A private link.
4. The code: src/public/routes.ts, src/public/route-names.ts, src/store/public-access.ts, src/store/link-shared-slug.ts, src/store/public-slug.ts, src/store/owned-slug.ts, src/web/Ownership.tsx, src/web/PublicPages.tsx (PublicMetadataPage), src/web/article/ArticlePage.tsx (OwnedArticle's record-open, VisitorArticle), src/web/public-api.ts, src/web/lib/api.ts (apiFetch), the `/api/admin/articles` handler in src/routes.ts, tests/owner-isolation.test.ts, tests/public-imports.test.ts, tests/public-dispatch.test.ts, tests/visitor-gaps.test.ts.

Look hardest at:
- Whether anything here loosens publicSlug, linkSharedSlug, publicAccessWhere or the public DTO for a non-admin, or lets a non-admin learn anything new (an oracle on slug/key, an owner, a count).
- The admin route's `ownedSlug OR publicAccessWhere(slug, accessFor(key))` lookup: is it exactly "articles the administrator can already read"? Any way to reach someone else's private article without its key?
- The new POST in the public namespace (§ 4): is option B the right call over A, or is there a better third way that gets "a count of signed-out opens" without a stranger-reachable write? Is the handler shape (no req, 204, one counter) safe? Abuse bounds.
- The signed-in POST carrying ?key= through apiFetch: does that break the rule that the key never travels in an owner's request, or put the key somewhere it should not be (logs, Sentry, offline store)?
- The client trigger: once per slug per mount, signed-in vs signed-out vs unconfirmed — any case that records the wrong account (session switching mid-flight), or records the owner?
- Privacy page wording, and whether anything else in the repo claims nobody records opens.
- Simpler designs I missed.

Write findings as a numbered list, each with severity (P0 blocks, P1 should change, P2 nice), the file/section, the concrete failure, and the fix. End with a one-line verdict. Do not edit any file.
