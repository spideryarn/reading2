# Admin impersonation / "view as user": research for Spideryarn

Up: [research.md](../project/research.md)

Web research for Greg's request of 2026-10-19 (`spya-k06kam`): browse as another user from
`/admin/users`, to reproduce their problems. A Sonnet subagent did it the same day. It feeds the
plan [261019n](../plans/261019n-admin-sees-other-users-articles-and-views-as-them.md).

Provenance: [fetched] = page read this session; [search] = from search snippets; [memory] = my prior knowledge, not re-verified (Stripe, GitLab, django-hijack, Laravel, pretender pages were not retrieved).

## 1. How others do it

**Clerk, actor tokens** [search]. Backend API call creates an actor token with `user_id` (subject) and `actor: {sub: <admin id>}`, plus an expiry (docs example 600s). Visiting the returned URL signs the browser into an *impersonated session* whose JWT carries the standard RFC 8693 `act` claim naming the admin. Tokens can be revoked before expiry. Docs expose an `actor` object so app code can detect impersonation. The Next.js example gates creation on an `org:admin:impersonate` permission. https://clerk.com/docs/guides/users/impersonation . One Convex thread reports `sub` confusion in a downstream backend (unresolved): https://discord-questions.convex.dev/m/1174786697377095710
RFC 8693 (`act` claim): https://datatracker.ietf.org/doc/html/rfc8693 [memory].

**WorkOS** [fetched]. Impersonator's email goes in an `act` claim on the access token, with a required reason shown in a banner. Their blog is the best checklist of side effects: transactional/lifecycle email, in-app chat widgets sending as the user, analytics `identify`, session replay, last-login timestamps, error tracking, rate limits / billable usage, feature-flag evaluation, and background jobs enqueued during the session that run later without context. Advice: derive one boolean from the session, available before analytics SDK init, fail toward over-logging; put the impersonator in job payloads; record both identities on events (`createdBy` / `createdOnBehalfOf`); log start and end; make it visible to the customer; compute suppression from the token, not an operator toggle. https://workos.com/blog/user-impersonation-side-effects (vendor marketing, but practical).

**Auth0** [search]. Staff say impersonation was deprecated and removed for new tenants because it conflicts with OAuth/OIDC; no replacement. Users suggest a read-only claim in the token. https://community.auth0.com/t/recommended-alternatives-to-impersonation/101118 , https://community.auth0.com/t/how-to-impersonate-user-in-read-only-mode/6193

**Pigment** (engineering write-up) [fetched]. Closest to our needs. Read-only by default ("for observing, not acting"); UI unchanged but backend returns 403 on any write, driven by a read-only flag in a *separate* JWT that carries the impersonated user as primary identity plus a separate claim for the real impersonator; a build-time check fails if any endpoint isn't explicitly tagged allowed/denied; 30-minute sessions; frontend stores the impersonation token apart from the admin's, so exit just restores the original; dark border round the screen plus exit widget; each start audited; they tried blocking writes at the DB layer and dropped it because some writes (token revocation, cache, audit log) are legitimate. https://engineering.pigment.com/2026/04/08/safe-user-impersonation/

**Other SaaS** [search]: Files.com (read-only, banner, logged under admin identity), Lattice (hides some private data from admins, sessions up to 1h, audit page). https://www.files.com/docs/user-accounts/users/impersonate-user , https://help.lattice.com/en-us/articles/16542062-admin-impersonation

**Libraries** [memory, unverified]: django-hijack (https://github.com/django-hijack/django-hijack), Rails pretender (https://github.com/ankane/pretender), Laravel impersonate (https://github.com/404labfr/laravel-impersonate). All swap the session user server-side, remember the original id to "release", and advise restricting who may impersonate and not impersonating superusers/staff.

**Supabase** [search]. No built-in impersonation found. Community pattern: server verifies caller is admin, calls `supabase.auth.admin.generateLink({type:'magiclink', email})` with the service-role key, then verifies the OTP (server-side) or hands `hashed_token` to the client for `verifyOtp({token_hash, type})`; the frontend swaps the session and stashes the admin's token as `original_token`. Example (sketchy; no refresh-token handling, localStorage flag, no audit code shown): https://jjacky.substack.com/p/building-user-impersonation-using . Pitfalls:
- It mints a *real*, full-power session for the user, indistinguishable from their own: no `act` claim, no read-only flag, refresh token long-lived. Downstream can't tell it's impersonation.
- Side effects on the user: new session row, `last_sign_in_at` updated, possibly other sessions affected depending on config [memory, verify].
- Swapping the browser's Supabase session overwrites the admin's own refresh token (refresh tokens rotate), so "get back" needs careful stashing; multi-tab behaviour is poor.
- Alternative: mint your own JWT signed with the project secret. Works with PostgREST/RLS but bypasses GoTrue's session table (unrevocable) and Supabase is moving to asymmetric signing keys [memory]. Custom Access Token Hook only fires on normal token issue, so there's no first-class way to add `act`.
- Service-role key bypasses RLS: keep server-only.
Verify against current docs before relying on any of this (not fetched): https://supabase.com/docs/guides/auth/jwts , https://supabase.com/docs/reference/javascript/auth-admin-generatelink

## 2. Design choices and defaults

| Choice | Default | Why |
|---|---|---|
| Read-only vs write | Read-only | Support's job is to see/reproduce. Writes as the user cause harm, side effects, and account-takeover optics. |
| Session separation | Do not swap the admin's own session; add a separate short-lived impersonation marker | "Return" is just dropping the marker. (Pigment) |
| Lifetime | 30 min (Pigment), 10 min (Clerk example), 1h max (Lattice); absolute, no sliding refresh | Limits forgotten tabs |
| Banner | Persistent, coloured, shows whom + Exit; rendered from server state, not a localStorage flag | Tamper-proof, multi-tab-safe |
| Audit | Row at start and end: admin, subject, reason, time, IP/UA; request logs carry both ids | WorkOS; GDPR art. 5/30/32 |
| Notify/consent | Disclose in privacy policy at minimum; optionally email after the fact | See section 3 |
| Block while impersonating | All writes; explicitly billing, email/password change, delete account, outgoing email, AI calls that cost money, exports, analytics identify, last-seen/reading-position writes | WorkOS side-effect list |
| Impersonating admins | Refuse | django-hijack-style default; prevents privilege laundering |
| CSRF / fixation | Start is a POST with CSRF protection and a fresh DB admin check on every request; state bound to the admin's session; HttpOnly+Secure+SameSite cookie; cleared on exit and admin logout; never a GET param that sets state | Confused-deputy risks |
| Actor vs subject | `sub`/subject = user, `act`/actor = admin (RFC 8693); audit and logs record the actor; analytics excludes or tags impersonated events | Clerk, WorkOS |

Pigment's key lesson: enforce read-only in application code on the server, deny by default, with a test that fails if a route lacks a classification. Watch "read-like" endpoints with side effects: GETs that mark read or save position, ingest-on-view, and AI streaming endpoints (often POST/SSE) that spend money.

## 3. Privacy / GDPR

I found no authoritative source on lawful basis [search returned only vendor pages]. General understanding [memory; not legal advice]:
- An admin viewing private content is processing personal data. Consent is awkward for internal staff access (must be freely given and withdrawable); usual bases are contract (providing the support the user asked for) or legitimate interests, with minimisation and need-to-know access (art. 5(1)(c), 25, 32).
- Expected controls: restricted, logged (who, which account, when, why), logs protected from tampering, periodically audited, and the privacy policy says staff may access content to give support and that access is logged. Example wording from a vendor: only staff with "an immediate need to access profiles to provide technical support" can impersonate, and it is logged by who/when: https://privacy.moment.team/master/impersonation
- For a one-admin beta where the founder can already read the DB, impersonation adds little new access. The real obligations: a policy sentence, an audit trail, purpose limitation (use it for a reported problem), and a recorded reason.

## 4. Recommendation: simplest safe v1

**Read-only "view as user", not login-as.**
1. `POST /admin/impersonate {userId, reason}`: admin-only, CSRF-protected, refuses admin targets. Writes an audit row (admin, subject, reason, started_at, expires_at) and sets a signed HttpOnly cookie referencing it, ~30 min absolute expiry. The admin's Supabase session is untouched.
2. Auth middleware: if the caller is a valid admin *and* the cookie is valid, `req.user` = subject, `req.actor` = admin; otherwise ignore the cookie. Re-check admin-ness every request. No Supabase token minting, so none of the Supabase pitfalls apply.
3. Deny-by-default: refuse every non-GET with 403 while impersonating, plus an explicit deny list of cost-incurring or side-effecting GET/stream endpoints (AI/chat, ingest, billing, email, export, read-state/position writes). A test enumerates routes and fails on unclassified ones.
4. Persistent coloured bar from server state: "Viewing as X (read-only) · expires in N min · Exit". Exit = POST clearing cookie and setting `ended_at`. Server logs include `actor`.
5. Suppress analytics/Sentry user identification and last-seen updates when `req.actor` is set.
6. One sentence in the privacy policy.

**Why not login-as:** write-blocking (for AI spend) is required anyway; then you'd have built read-only plus token/session machinery. Most reproduction needs only to *see* what the user sees. For interactive bugs, reproduce in the admin's own account on a copy of the article.

**Defer:** per-page-view audit; emailing the user afterwards; user-visible access log; consent flow; session extension; write-enabled impersonation (if ever: explicit per-session flag with `act` claim); signed tokens for non-browser consumers; MFA re-prompt before start; alerting on impersonation.
