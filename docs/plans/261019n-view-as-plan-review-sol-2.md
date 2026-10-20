## Verdict

Do not approve Part 3 yet. I found three P0s, four P1s, and one P2. The server route allowlist is broadly sound; the blockers are browser identity/storage, HTTP caching, and client paths that bypass `apiFetch`.

### F1 — P0 — The view still considers the admin to be its reader

The server switches ownership to the subject, but the browser continues using the admin’s Supabase user everywhere:

- `/current` returns no `subjectId`, only email and expiry ([plan](/var/tmp/spideryarn-worktrees/admin-view-as/docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:382)).
- `SignedInReader` remains `user.id`, meaning the admin ([App.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/App.tsx:427)).
- Requests are fenced to `heldReader()`, also the admin ([api.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/lib/api.ts:509)).
- Search reads and can tidy the admin’s stored search pairs ([SearchMode.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/modes/search/SearchMode.tsx:148)).
- Referee mode reads/writes criteria state under the admin’s storage key ([useCriteria.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/useCriteria.ts:98)).
- `/profile` shows the admin’s email and sign-in provider, not the subject’s ([AccountSection.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/AccountSection.tsx:31)).

Nulling the offline-cache drawer does not cover these stores. It also does not cover module memory or every future reader-keyed store.

There is a second leak in the same mechanism: a new same-origin window inherits a copy of its opener’s `sessionStorage`. Consequently, the initial view-as tab can inherit the admin tab’s per-tab drafts, and a tab opened from the view-as tab can inherit the nonce. “Per tab” does not mean “initially empty.”

Concrete fix:

- Return `subjectId` from both start and current.
- Introduce an explicit client identity `{ actorId, subjectId, persistence: "disabled" }`.
- Continue fencing credentials against `actorId`; do not key browser persistence as either actor or subject. Reader-owned persistence must use a central disabled adapter in view-as, not scattered `if` statements.
- Render subject-facing identity from the subject record; do not render `AccountSection` or other account controls.
- Open the initial tab with `noopener`, and ensure every new browsing context opened while viewing-as also has no opener. Alternatively, keep the nonce only in module memory and accept that reload ends the view.
- Test with populated admin local/session storage and assert none of it is read, changed, or displayed.

### F2 — P0 — The browser HTTP cache can retain and replay subject data after Stop

The plan disables the application’s IndexedDB cache, but says nothing about the browser’s HTTP cache ([plan](/var/tmp/spideryarn-worktrees/admin-view-as/docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:450)).

Two allowlisted binary routes explicitly return one-year cacheable responses:

- Illustrated plates: `private, max-age=31536000, immutable` ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:897)).
- Article assets: the same ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:974)).

The source PDF deliberately has no cache policy ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:810)).

The ordinary and view-as requests have the same URL and admin Authorization token. Without `Vary: X-Spideryarn-View-As`, the custom nonce header is not a cache-key dimension. More importantly, even with `Vary`, a cached view-as response can be served again without asking whether the nonce has expired or ended.

Concrete fix:

- Set `cache: "no-store"` on every view-as client request.
- Centrally force `Cache-Control: private, no-store` on every successful view-as response, overriding handler headers, including binary responses.
- Add `Vary: X-Spideryarn-View-As` as defence in depth, not as the primary fix.
- Browser-test an asset request followed by Stop and a repeat of the same URL; the repeat must reach the server and be refused.

### F3 — P0 — Refusing non-GET in `apiFetch` does not make the tab read-only

Several network and mutation paths do not use `apiFetch`:

- Profile sign-out deletes the admin’s local dictation/feedback data and calls Supabase directly ([AccountSection.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/AccountSection.tsx:41)).
- OAuth consent directly approves or denies a grant through Supabase ([OAuthConsentPage.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/OAuthConsentPage.tsx:126)).
- Password update calls Supabase directly ([SetNewPassword.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/SetNewPassword.tsx:37)).
- A 401 causes a direct Supabase token refresh ([api.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/lib/api.ts:645)).
- Upload uses a direct `XMLHttpRequest` PUT ([upload.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/upload.ts:94)); the preceding grant request usually makes it unreachable, but the transport is outside the proposed guard.
- Hovering a Wikipedia link makes a raw third-party fetch, revealing the requested title and network identity ([link-facts.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/link-facts.ts:518)).

`leavingFetch` is covered by the plan; raw `fetch`, XHR, and Supabase SDK calls are not.

Concrete fix:

- In view-as, allow only the reader pages needed for the feature. Do not render account/auth, OAuth consent, password recovery, add/upload, or live-conversation routes.
- Disable external link-preview fetching in view-as.
- Put all application network effects behind one capability-checked adapter, with explicit control-plane exceptions.
- Add a static test/inventory for raw `fetch`, XHR, WebSocket and direct Supabase mutation calls, plus browser tests for `/profile` and `/oauth/consent`.
- Narrow the promise if token refresh remains allowed: it is not true that “no non-GET leaves the tab.”

### F4 — P1 — Deferred work loses the view-as marker but keeps subject ownership

`setRequestOwner` mutates the request’s outer owner box ([owner.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/owner.ts:185)). `runViewingAs` would be a nested scope around the handler, while `afterResponse` stores a plain callback ([after-response.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/after-response.ts:67)).

Those callbacks are drained only after the routed request returns ([after-response.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/after-response.ts:45)). At that point:

- `runViewingAs` has ended, so DB/spend/email backstops see no marker.
- The mutated outer owner box still says “subject.”
- The spend collector has also ended.
- A deferred DB write can therefore run as the subject without any view-as backstop.

The current allowlist does not appear to enqueue such work, and `noteArrival` is explicitly skipped, so this is P1 rather than P0. It is exactly the queue-context class already documented in [owner.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/owner.ts:196).

Concrete fix:

- Keep the outer owner as the actor.
- Invoke the handler as `runViewingAs(..., () => runAsOwner(subject, handler))`; do not mutate it permanently with `setRequestOwner(subject)`.
- Make `afterResponse` synchronously refuse enqueue while `viewingAs()` is set.
- Apply the same rule at every job/global-queue enqueue boundary.
- Test a synthetic allowlisted handler that tries both deferred work and a queued callback.

### F5 — P1 — Stop is internally contradictory, and expiry leaves the subject view alive

The plan says `apiFetch` refuses every non-GET before sending ([plan](/var/tmp/spideryarn-worktrees/admin-view-as/docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:450)), but Stop is a POST ([plan](/var/tmp/spideryarn-worktrees/admin-view-as/docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:461)). The necessary exception or separate transport is unspecified.

On 410, the plan only changes the bar and “offers to close.” The already-rendered subject article, object URLs, React state, and in-flight responses remain visible. The same is true for up to a minute after local expiry because current is polled once per minute.

Concrete fix:

- Give Stop one narrowly scoped transport that can send exactly `POST /api/admin/view-as/end`; keep all other non-GETs refused.
- Wait for 2xx/410 before clearing the nonce. On a network failure, retain the barrier and offer Retry.
- At `expiresAt`, Stop, or any 410: abort tracked requests, unmount the app immediately, clear the nonce, and hard `location.replace("/")` if the tab cannot close.
- Never leave subject content under an “ended” banner.

### F6 — P1 — Minting a subject `VerifiedUser` destroys the type’s security meaning

`VerifiedUser` currently means an object produced by `requireUser`, with identity recorded in a private `WeakSet` ([auth.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/auth.ts:65)). Its runtime assertion explicitly rejects anything that did not come from `requireUser` ([auth.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/auth.ts:150)).

The plan proposes adding a second minting path for a person who supplied no credential ([plan](/var/tmp/spideryarn-worktrees/admin-view-as/docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:393)). That turns “verified token principal” into “effective identity chosen by trusted code.” Future authorization, billing, or logging code receiving it can no longer distinguish actor from subject.

Concrete fix:

- Never mint a subject `VerifiedUser`.
- Keep `actor: VerifiedUser` intact.
- Represent the subject as a separate `ViewAsSubject`/owner value.
- Prefer a discriminated route principal containing both actor and effective owner.
- Since the audit says allowlisted handlers do not read `user`, dispatch them with the real actor and use `runAsOwner(subject)` for owner-scoped stores.

### F7 — P1 — A SQL text blacklist is a tripwire, not a write backstop

The database is a shared Drizzle handle over a pooled connection ([client.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/db/client.ts:171)). A query-text blacklist cannot reliably decide whether PostgreSQL will write:

- `SELECT nextval(...)` and writable/volatile functions look like reads.
- `CALL`, `DO`, writable CTEs, multi-statements and security-definer functions broaden the grammar.
- A simple keyword search falsely refuses strings, comments, and quoted identifiers such as `SELECT 'update'`.
- A more elaborate scanner becomes an incomplete SQL parser.
- Any delayed execution that loses the ALS marker bypasses it entirely, as in F4.

Because the plan says this catches missed sweeps, it is being relied on as more than diagnostics.

Concrete fix:

- Use a second database credential/role with SELECT-only permissions and a separate pool selected by the view-as scope.
- Restrict function and sequence privileges as well as table writes.
- Keep the text scanner only as a diagnostic tripwire.
- Do not use request-level `SET TRANSACTION READ ONLY`; the plan is right that it does not fit the shared transaction pooler.

### F8 — P2 — The allowlist is broader than the current client and mislabels external reads

A freshly opened tab uses the current bundle, so it does not need the old one-deploy aliases:

- `debate-claims` ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:11993))
- old debate claim checks ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:12042))
- `debate` ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:12244))
- `citations` ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:12381))

Keep those ordinary compatibility routes if necessary, but do not expose them through view-as.

Also, the “pure reads” label is inaccurate. `/api/uploads/:id` makes a Supabase Storage HEAD request ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:13604)); source PDFs, assets, plates and referee scans also read object storage. Those may be justified, but they should be named as explicit outbound-read exceptions.

I did not find an additional allowlisted GET that writes after applying the plan’s stated sweep/job changes. `/api/library/terms` is correctly refused; voucher claims and billing are correctly refused.

## Gate assessment

The gate ordering itself is sound if implemented literally:

- Pure route matching occurs before owner switching or handler invocation.
- Unknown routes, HEAD, non-GET methods, and unannotated rows fail closed.
- Only the three exact control routes bypass subject switching.
- Actor admin status, nonce ownership/liveness, and subject non-admin status are rechecked on every request.
- Admin namespace rows remain excluded.

The matcher must be a new pure lookup; `dispatchAuthRoute` cannot be reused for this check because it invokes the matched handler immediately ([routes.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/routes.ts:14087)).

The simplest safe server shape is therefore:

```text
real actor VerifiedUser
        │
pure route lookup + live-session checks
        │
runViewingAs(actor, subject)
        │
runAsOwner(subject)
        │
allowlisted handler using a SELECT-only DB pool
```

That preserves the existing authentication invariant, contains both ALS scopes, and replaces the SQL heuristic with an enforceable database boundary.

Read-only review only; I changed no files.