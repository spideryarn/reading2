I found three actionable risks. None is a wholly new authorization, IDOR, SSRF, or XSS hole; each extends or raises the severity of an already documented gap.

### 1. Unlimited GPT-Live session creation can run up direct OpenAI spend

**Known gap — severity raised**

**Where:** [src/routes.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/routes.ts:4561), route `POST /api/chat/:slug/:threadId/live-session`; registered at [src/routes.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/routes.ts:12054); direct paid request at [src/live.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/live.ts:793). The 15-second creation charge is declared at [src/live.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/live.ts:137).

**What could happen:** Anyone who creates an account and owns one article can repeatedly submit valid SDP offers. Each successful request creates a billable OpenAI session and charges 15 seconds even if the caller never connects. There is no per-owner rate limit, daily allowance, concurrency limit, or global fuse before the paid call. The browser’s idle and 20-minute limits never execute on this request path, and the accepted OpenRouter monthly cap does not cover the separate `OPENAI_API_KEY` account.

**Level:** High. This meets the supplied “run up real spend with little effort” definition. The gap is acknowledged in [billing.md](/var/tmp/spideryarn-worktrees/security-risks-register/docs/project/billing.md:33), but the immediately billable, scriptable creation path warrants High.

**Proposed fix:** Atomically reserve admission before creating either kind of live session: a short-window per-owner rate, daily allowance, global daily fuse, and cap on concurrently open sessions. Settle or release the reservation on creation failure and close. Existing Postgres limiter and reservation patterns can be reused. Roughly 1–3 days; a creation-only rate limit and global fuse would take about half to one day.

**Confidence:** VERIFIED.

### 2. One account can accumulate unlimited staging uploads

**Known gap — aggregate abuse made concrete**

**Where:** [src/routes.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/routes.ts:7083), route `POST /api/uploads`, registered at [src/routes.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/routes.ts:12494). The route only checks quota and reserves nothing at [src/routes.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/routes.ts:7118). Each object may be 50 MiB ([src/uploads.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/uploads.ts:28)), while the defined sweep predicate has no production caller ([src/source.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/source.ts:243), [ingest-queue.md](/var/tmp/spideryarn-worktrees/security-risks-register/docs/project/ingest-queue.md:284)).

**What could happen:** A signed-in reader with room for one ingest can repeatedly request grants using fresh claimed hashes, upload up to 50 MiB under each server-minted staging key, and never submit an ingest job. Minting does not consume a slot or cap outstanding bytes. Expired rows and objects are not swept, so storage and database usage continue accumulating. The documented per-object cap does not bound the aggregate.

**Level:** Medium. It requires a malicious signed-in reader, but the continuing storage cost is not bounded by the application.

**Proposed fix:** Atomically limit outstanding upload count and bytes per owner when minting, add a per-owner mint rate limit, and run a scheduled race-safe cleanup after the grant TTL plus grace period. Roughly 1–3 days including schema, worker, and concurrency tests.

**Confidence:** VERIFIED.

### 3. The signed-in interface can be framed and clickjacked

**Concrete consequence of the known missing-CSP gap**

**Where:** The site-wide headers in [vercel.json](/var/tmp/spideryarn-worktrees/security-risks-register/vercel.json:23) include only `X-Robots-Tag` and `Referrer-Policy`; there is no `frame-ancestors` policy or `X-Frame-Options`. One concrete target is publishing an article: [src/web/AccessSharing.tsx](/var/tmp/spideryarn-worktrees/security-risks-register/src/web/AccessSharing.tsx:428) calls `PUT /api/article/:slug/visibility`, handled at [src/routes.ts](/var/tmp/spideryarn-worktrees/security-risks-register/src/routes.ts:10624).

**What could happen:** A hostile site can embed Spideryarn and position misleading controls over its UI. If the victim is authenticated in that framed storage context, induced clicks can send genuine bearer-authenticated writes—for example, publishing a private article. Server authorization correctly sees the victim as the owner, so it cannot distinguish the coerced action.

Modern storage partitioning prevents reuse of an existing top-level login in many browser configurations, and publishing is a multi-step action, so exploitation is conditional rather than universal.

**Level:** Low. It is hard to exploit reliably, though the possible consequence includes exposing an article.

**Proposed fix:** Add `Content-Security-Policy: frame-ancestors 'none'` and, for older clients, `X-Frame-Options: DENY`. This can ship independently of the harder full CSP work. A few hours including header regression tests.

**Confidence:** VERIFIED for the response headers and write path; browser exploitability is conditional as described.

### Checked and found sound

- The normal API gate, request-scoped owner isolation, namespace-wide admin check, and owner-scoped article/child/job/upload/live-session lookups.
- The closed, GET/HEAD-only public namespace; repeated public/private-link predicates; key validation; `no-store`; and query-key exclusion from logs and referrers.
- Remote MCP client-id, JWT, administrator, method and body-size gates; OAuth-token stripping and re-entry through normal authorization.
- SSRF protection: scheme and credential checks, DNS resolution, mixed/private-address refusal, pinned connections, and revalidation at every redirect.
- Client-ingress sanitization, model text rendering, embed policy, asset-manifest membership, media sniffing, and `nosniff`; no verified XSS or path traversal.
- Stripe webhook signatures, Checkout owner/customer binding, atomic ingest reservation, Resend handling, and billing settlement.
- Sentry event reconstruction, logging redaction, fixed 5xx responses, bearer-token authentication, and absence of permissive CORS. Cookie-based CSRF does not apply to authenticated API writes.
- No server secret was found in the client build boundary.

I skipped `npm audit`: no offline advisory source was available, and the review prohibited network access. No files were changed, and no remote-service or database requests were made.