# GPT Sol plan review: admin "view as" (read-only), plan 261019n § Part 3

You are reviewing a PLAN, read-only. Repo is the current directory, HEAD as checked out, plus the
uncommitted edit to docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md (read the
whole file; the new section is "## Part 3, built: view as (Greg chose A, 2026-10-20)" at the end).

Context: an admin (Greg) chose option A: a read-only "view as" tab showing the app exactly as another
reader sees it. This edits a security boundary (docs/project/security-map.md, docs/project/admin.md,
docs/project/auth.md). Key code: src/routes.ts (`serveAuthenticatedApi`, `AUTH_ROUTES`,
`dispatchAuthRoute`), src/owner.ts, src/auth.ts (`VerifiedUser`), src/ai-spend.ts (`beginSpend`),
src/email.ts (`sendEmail`), src/db/client.ts (`getDb`), src/web/lib/api.ts (`sendOwned`,
`leavingFetch`, offline cache), src/web/boot.tsx, src/web/main.tsx.

## What to attack, adversarially

1. Any WRITE path (DB, Storage, email, paid model call, outbound fetch, job enqueue/requeue,
   afterResponse work, voucher claims, background work drained later) that stays open while viewing
   as someone else, given the gate and allowlist as designed. Check the plan's allowlist against the
   code yourself; name any GET on it that writes.
2. SESSION LEAKAGE in both directions: subject data ending up in the admin's own browser storage /
   caches / in-memory stores / other tabs; the admin's identity or data leaking into the subject's
   view; the nonce leaking (fragment, history, Referer, logs, Sentry); a nonce usable by someone
   else; a session outliving Stop/expiry; the AsyncLocalStorage marker escaping to other requests
   (e.g. via a p-queue drained in another context — src/owner.ts explains that hazard) or being
   dropped.
3. The gate's ordering and fail-closed properties: unknown route, non-GET, HEAD, admin namespace,
   the three control routes, subject turned admin, actor no longer admin, expired/ended nonce.
4. The database-write backstop as a query-text check: bypassable? false positives that would break
   allowlisted reads? Is there a better way (note `SET TRANSACTION READ ONLY` per request does not
   fit the shared transaction pooler — see the plan's earlier "What our code says").
5. Anything simpler that gives the same safety.

## Severity scale

P0 = a write/spend/leak reachable as designed. P1 = likely bug or a missing check that would let one
slip. P2 = worth fixing, not dangerous. P3 = nit. Give every finding an ID (F1, F2…), the file:line
or plan paragraph, and a concrete fix.

## My own suspicions (spend most of the run elsewhere)

- The client tab's reader is still the admin; I rely on `owner = null` to keep the offline cache
  out. Is there a cache path that bypasses `owner`?
- `VerifiedUser` for the subject: does minting one weaken the type guarantee in src/auth.ts?
- Is refusing non-GET client-side before send actually complete (leavingFetch, raw fetch callers)?
