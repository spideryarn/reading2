You are doing a security review of Spideryarn, a small TypeScript web app (one server process,
Postgres via Supabase, deployed on Vercel, real paying readers since 2026-09-03). READ-ONLY: do not
edit any file, do not send any request to production or any remote service, do not run anything that
writes to a database, and never print the value of a secret (naming an env var is fine).

Your ground: the app and its server. Routes and the sign-in gate (src/routes.ts, src/auth.ts,
src/vercel.ts, src/serve*.ts), the unauthenticated /api/public/ namespace and private links
(src/public/, src/store/public-*.ts, src/store/link-shared-slug.ts, src/share-key.ts), owner
isolation (src/owner.ts, src/store/owned-slug.ts, src/store/pg*.ts), the admin routes (src/admin*,
docs/project/admin.md), fetching and SSRF (src/fetch.ts, src/ingest.ts, src/link-previews.ts,
src/chat-tools.ts), sanitising and model output reaching the DOM (src/sanitize*.ts, src/urls.ts,
src/web/), uploads and PDFs, asset delivery (src/asset-delivery.ts), billing and quotas (src/billing*,
Stripe webhook), the remote MCP endpoint (src/mcp/), email (Resend), rate limits and spend caps,
logging and Sentry (what could leak), headers/CSP/CORS, and dependencies (package.json; you may run
`npm audit --omit=dev --json` if it works offline, otherwise skip).

Read first: docs/project/security-map.md (the map of defences), docs/project/security.md (the deep
dive; its § Known gaps lists what is already known), docs/project/auth.md, docs/project/admin.md,
docs/project/billing.md. Do not re-report a known gap as new; you may say a known gap deserves a
higher level, with the reason.

Look for real, concrete problems, verified in the code: authorization holes (a route that reads or
writes another reader's data, an admin check that can be bypassed), IDOR, SSRF bypasses, XSS sinks,
an endpoint that spends money without a cap, secrets that could reach the browser, logs or Sentry,
missing CSRF protection on a cookie-authenticated write, open redirects, unsafe deserialisation,
path traversal, race conditions on quotas, and anything else you find. Prefer five verified
findings to twenty speculative ones; mark anything you could not verify as UNVERIFIED.

Output, for each finding:
- Title (one line, plain words)
- Where: file:line (and the route, if any)
- What could happen: a concrete scenario — who does what, and what they get
- Level: High / Medium / Low, where High = a stranger or another reader can read or change a
  reader's data, take money, or run up real spend with little effort; Medium = needs an unusual
  position (a signed-in reader acting maliciously, a hostile article, a compromised third party) or
  the damage is bounded; Low = defence in depth, hard to exploit, or small damage
- Proposed fix, and roughly what it costs to build
- Confidence: VERIFIED (you read the code path end to end) or UNVERIFIED
End with a short list of things you checked and found sound, so the reader knows what was covered.
