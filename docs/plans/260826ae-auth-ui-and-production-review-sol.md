<!-- GPT Sol's review of 260826ae-auth-ui-and-production.md, 2026-08-26. Kept verbatim except
     that its absolute-path links were turned into plain `file:line` references —
     they pointed at this laptop, and a line-numbered link is not one anybody can
     follow. What was done about each finding is in
     260826ae-auth-ui-and-production.md § The cross-family review. -->

Verdict: **not safe to build as written.** I found no final-state bypass into an application handler if `requireUser` is placed exactly as planned, but the OAuth callback, production prerequisites, ownership model, tests, and checks still contain blockers.

1. **High — production will remain unusable, and the rollout can lock everybody out.**

The plan records that `DATABASE_URL` is unset (`260826ae-auth-ui-and-production.md:96`), but never adds it to the work. It even says “Nothing else” after the two auth dashboards (`260826ae-auth-ui-and-production.md:516`). The production checklist tolerates health remaining broken “once DATABASE_URL is set” (`260826ae-auth-ui-and-production.md:561`).

The deployment document says the remote database still needs schema, owner, connection string, and imported articles (`deployment.md:373`). Therefore the resulting site may authenticate successfully while every useful API request still fails.

The release order also needs an explicit fence. Missing `VITE_*` values deliberately throw during module loading (`260826ae-auth-ui-and-production.md:152`); deploying before those values, Google enablement, and the Google redirect registration produces a blank client or an API gate with no usable sign-in route. A push to `main` deploys automatically (`deployment.md:37`).

Do instead: make all remote configuration and database readiness prerequisites to promotion. Set Preview’s `NODE_OPTIONS` first, verify a preview, then promote the exact deployment. Do not push the gate to `main` until Google, Supabase redirects, Vercel variables, and the database are green.

2. **High — the callback route prevents the `/add/` leak, but does not yet implement a reliable callback.**

The proposed rewrite exemption is correctly ordered: it must precede `canonicalAddHref`. Vercel’s SPA rewrite will also serve `/auth/callback` correctly.

Two missing pieces remain:

- Local Supabase currently allows only the exact roots `http://localhost:5273` and `http://127.0.0.1:5273`, not `/auth/callback` (`config.toml:199`). The earlier review explicitly found this, but it was not carried into this plan. Once `redirectTo` changes, local OAuth may reject it or silently fall back to `/`, defeating the browser test.
- `onAuthStateChange` cannot populate the proposed callback `error` state by itself. In the installed SDK, callback initialization errors return internally (`GoTrueClient.ts:681`); subscribers receive only `INITIAL_SESSION, null`, while the error is logged (`GoTrueClient.ts:4346`). Failed callback parameters remain in the URL; only a successful code exchange deletes `code` (`GoTrueClient.ts:3887`).

The test at `260826ae-auth-ui-and-production.md:269` passes while `/auth/callback?code=X` remains forever on screen.

Do instead: add local `/**` redirect entries; have the callback component explicitly capture safe error codes, clear all auth parameters, wait for initialization, and then navigate. Test successful cleanup, exchange failure, access denial, and no verifier—not merely “code was not folded into `/add/`.”

`sessionStorage` is tab-scoped, so ordinary cross-tab confusion is limited. The unaddressed hole is stale reuse. Store `{path, createdAt}`, remove it before navigating, impose a short TTL, reject `/auth/callback` as a return destination, and validate with `new URL(value, location.origin).origin === location.origin`. A simple `startsWith("/")` accepts `//evil.example`.

3. **High — authentication does not identify whose data is being accessed.**

The gate admits every Google account, but its returned user ID is not used by the stores. `currentOwnerId()` still reads one process-wide `SPIDERYARN_OWNER_ID` (`owner.ts:71`), and its own documentation says Postgres reads do not filter by owner (`owner.ts:17`).

Consequently, once data is attached, every authenticated Google user reads and edits the same shelf, profile, chats, searches, and article state. The plan describes the accepted risk mainly as model spend; it is also a privacy and data-integrity decision.

Either restore an allowlist for this release, or wire `claims.sub` through every owner-scoped store before importing private data. If shared data is deliberate, state that plainly in the production and security docs.

4. **Medium — there is a third non-fetch API path: untrusted article HTML.**

The static scan is otherwise right: there is no service worker, `EventSource`, beacon, form action, preload, or API image in the authored client.

But articles are rendered as HTML, and the sanitiser deliberately preserves links and images. Tests even pin that `<img src="/d.png">` survives (`sanitize.test.ts:77`). Therefore an article can contain:

```html
<img src="/api/health">
<a href="/api/library">...</a>
```

Those requests carry no bearer token and are invisible to the proposed source-code grep. The image can automatically hit the public health endpoint; API links fail as unexplained 401 navigations.

Audit URL-bearing attributes in sanitised article HTML and remove or rewrite anything resolving to this origin under `/api/`. Add behavioural tests for `img`, `audio/video/source`, SVG URL attributes, and anchors.

5. **Medium — `apiFetch` makes the page-hide save less reliable.**

The 31-call count and 14-file list now match the working tree. All ordinary bodies are strings or absent, so one retry is replay-safe; streaming, current `AbortSignal`s, and the chat opening timeout remain sound if `RequestInit` is preserved.

The exception is `useProfile.ts:76`. Its `pagehide` handler calls `flush()`. After conversion, `apiFetch` awaits `getSession()` before it even starts the network request. During page teardown, the browser can terminate the page during that await. The current best-effort request becomes a request that often never starts.

Save earlier on blur/visibility change, and keep a narrowly specified page-hide path that starts immediately with a current token and `keepalive: true`. Test it with a deliberately delayed session lookup.

6. **Medium — several findings from the first review remain contradictory or dropped.**

- The old specification still maps every `getClaims` failure to 401 (`260826w-auth-supabase.md:490`), despite the earlier review requiring 503 for JWKS/network unavailability. Otherwise clients refresh valid sessions pointlessly and report infrastructure failure as bad credentials.
- The tests still require a “wrong email → 403” (`260826w-auth-supabase.md:782`), while `isAllowed` deliberately accepts every authenticated email. That test cannot coexist with the decision.
- `tests/routes.test.ts` is not the only affected harness. `chat-anchor-route.test.ts`, `chat-live-turn.test.ts`, `chat-route.test.ts`, and `store-wiring.test.ts` also construct fake requests without headers and call `handleApi`.
- Sign-out was brought into v1, but the earlier requirement to abort active streams and clear app-owned state was dropped. The new plan specifies only where the button appears.

Resolve the 401/503 contract, replace the impossible wrong-email test, and give every route harness an explicit injected authenticated verifier. Add direct `apiFetch` tests for header merging, one retry only, preserved body/signal, refresh failure, and same-origin refusal.

7. **Medium — the public pre-handler surface remains broader than “health.”**

With the planned hardening, I found no application-handler fail-open:

- `/api/*` reaches `handleApi`;
- `OPTIONS` and `HEAD` do not bypass a gate placed first inside its `try`;
- duplicate `__spy_path` is refused;
- the SPA fallback cannot reach application data;
- `/api` without the slash may return the SPA, but reaches no handler.

The intentional exception still performs a database read and returns environment-presence flags, Node version, region, commit SHA, article count, and raw diagnostic errors (`vercel-health.ts:176`). Thus unauthenticated GET/HEAD does reach data and database work. If that is acceptable, rate-limit or cache it and keep the response minimal.

Also ensure the “generic import failure” work explicitly edits `api/index.js:43`. Calling the scaffolding merely “health hardening” makes it easy to leave the public stack trace unchanged.

8. **Medium — the redirect probe and production checklist can still report success while broken.**

The redirect script has no shown `uri=$1`, no `set -euo pipefail`, no curl failure handling, and no default `case`. In Bash, a `case` with no matching arm exits 0. Its text says the known-bad control runs every time, but the shown invocation probes only the target URI.

The production checks are also observations, not assertions:

- root `200` also describes the current “Deployment has failed” page;
- the library and jobs curls do not print status, so 200, 401, and 500 bodies can look alike;
- health explicitly permits `ok:false`;
- DELETE does not print status;
- only one hostname is assigned despite saying “both”;
- local `dist/` is not the deployed bundle;
- `grep -rc` prints one count per file and exits 1 for the desired no-match result;
- searching for literal `service_role` will miss a legacy service-role JWT whose payload is encoded.

Make the scripts fail closed: `curl -fSs`, capture and assert exact statuses, use `jq -e`, verify the deployed commit SHA, scan downloaded deployed assets, run both aliases explicitly, and include an `UNKNOWN` redirect-probe branch that exits nonzero. Decode JWT-like bundle strings when checking for legacy service-role keys.

9. **Lower — the PDF replacement needs failure and opener semantics.**

The synchronous blank-tab approach avoids popup blocking, but `window.open()` no longer inherits the anchor’s `rel="noopener"`. Null `opener` before loading the untrusted PDF, close the blank tab on fetch failure, and show the error. Also note that `sendSource` still reads the PDF from the local filesystem, so this link remains broken on Vercel until source storage lands.

Overall: the server-gate placement is now sound, and the `/add/` rewrite exemption addresses the original leakage mechanism. The plan still needs the callback, production, ownership, and test corrections above before implementation.