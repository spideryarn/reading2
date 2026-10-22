# Plan review: 261019n

## Verdict

Part 1's diagnosis is right, and `published` does not disclose another reader's private article.
The job selection is still wrong in a retry edge: it compares status classes before recency and can
resurrect an older failure.

Parts 2 and 3 should not be approved as written. The route classification is a sound core, but the
raw subject header is only client state, without a server-issued session, expiry, reason, revocation,
or durable start/end audit. The client work is also much larger than reader-id substitution: as
proposed it either trips `NotThisReader`, mixes the admin's cached data into the subject's view, or
starts engines that make writes.

## Findings, ranked by severity

### Blocker 1 — the browser can invent an unlimited view-as session

The proposal copies `{subject id, address}` from `sessionStorage` into a request header
(`docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:156-169`). The admin token
still proves the actor, so this is not an account escalation, but there is no server-created object
to expire or revoke and no authoritative reason or durable access record. Duplicated tabs and tabs
opened with an opener can begin with copied `sessionStorage`, so closing one tab is not a reliable
end.

This drops the research's safe-v1 defaults: absolute expiry, POST start, reason, start/end audit row,
and server-derived banner state (`docs/research/261019a-admin-impersonation-best-practice.md:36-47,58-66`).
The plan defers them instead (`docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:237-240`).
They cannot be deferred when the feature exposes private prose, notes, chats, and profiles.

The header does prevent ordinary cross-origin form CSRF: another origin cannot add it without CORS.
A non-admin header also does nothing if the server checks the verified actor from `requireUser`
before changing owner (`src/auth.ts:319-353,395-417`). But `/view-as/<id>` is a GET navigation that
mutates browser state, so an outside page can navigate a signed-in admin into a fixed subject. It is
also only a static SPA route (`vercel.json:59-61`), so it cannot emit the promised server start log.

Keep per-tab state, but store an opaque server-issued nonce. `POST /api/admin/view-as` should freshly
check actor and target, require a reason, write `{actor, subject, reason, started_at, expires_at}`, and
return a short-lived nonce. Every request resolves it; Stop POSTs revocation/end. The server response
supplies the banner identity and expiry.

### Blocker 2 — reader-id substitution breaks the client isolation boundary

`apiFetchOwned` binds a call to one reader and compares that reader with the owner of the token it
actually gets (`src/web/lib/api.ts:509-536,593-611`). In view-as, token owner is the admin and
`madeFor` is the subject, so current code correctly throws `NotThisReader`. Loosening that comparison
would weaken the cross-account defence in `docs/project/auth.md:110-149`.

Capture an explicit `{actor, subject, viewAsNonce}` before the first await and preserve it through a
401 retry. Token-owner checks stay against `actor`; the server session authorises `subject`. Ordinary
requests retain today's one-reader rule.

The plan disables cache saves, but must disable reservation, fallback reads, and writes. Cache keys
come from the actual token owner (`src/web/lib/api.ts:593-629`); on transport failure `attempt` can
return that owner's cached response as a synthetic 200 (`src/web/lib/api.ts:784-865`). Otherwise the
subject's banner can sit above the admin's cached shelf/article. The save path is likewise keyed by
token owner (`src/web/lib/api.ts:879-978`).

Do not rebind the normal job session. It starts job, upload, and batch engines and hands over the
auto-mode setting (`src/web/useJobs.ts:230-286`); the job engine GETs the list and automatically
POSTs `/advance` (`src/web/jobEngine.ts:1061-1066`). View-as needs a passive list only: no advance,
retry, upload, batch, or hand-off.

Entering view-as does not change the Supabase session, so `forgetOnReaderChange` never runs
(`src/web/lib/session.ts:63-75`; `src/web/lib/reader-change.ts:35-48`). Add an effective-reader epoch
that clears module chat/search/link stores before rendering on entry, subject change, and exit. Hide
all write and local-persistence surfaces too: `FeedbackHost` receives the reader id
(`src/web/App.tsx:420-436`) and writes drafts under it (`src/web/feedback-draft.ts:10-15,54-115`).

### High 3 — route coverage is good, but enforcement must move to the matched row

All authenticated HTTP handlers are rows in `AUTH_ROUTES`; the closed route types are at
`src/routes.ts:9657-9741` and the sole dispatcher at `src/routes.ts:13964-13991`. This includes
authenticated streams, upload-grant endpoints, and assets. Public routes, Stripe, and MCP run before
`requireUser` (`src/routes.ts:9395-9462`) and should ignore/refuse view-as state. All other `/api/*`
go through the same function (`vercel.json:38-50`); static files never enter owner scope. Direct
Storage upload is outside the router, but a view-as tab cannot mint a new grant if POST is refused;
its client upload engines must still be stopped.

The current gate sets owner before route matching (`src/routes.ts:14042-14057`), while classification
is only known in dispatch (`src/routes.ts:14112-14128`). Match first; then check verified actor and
subject, reject admin/refused routes, enter `{actor, subject, viewAs}`, and invoke only that handler.
The admin check must use `user.id`, never switched `currentOwnerId()`. Refused/unknown routes must
never enter subject scope.

A required field prevents omission, not a wrong classification—the existing attribution contract
says the same (`src/routes.ts:9726-9730`). Tests should drive every known side-effecting GET and prove
that store/model/fetch/email effects did not run. The plan says seven sweep guards
(`docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:201-203`), but its inventory
contains eight route rows: comments, chat, search, criteria, promises, two claim-check aliases, and
jobs (`docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:123-131`). Shared guard
code is fine; both aliases still need contract coverage.

Another GET-side effect is missing: every successful authenticated route schedules
`noteArrival(user.id,user.email)` (`src/routes.ts:14128-14137`). It affects actor, not subject, but
should be suppressed during view-as, as the research requires for last-seen/arrival activity.

### High 4 — `beginSpend` is a good backstop, not a side-effect boundary

The central paid-model claim is correct: the two model gateways call `beginSpend` before opening the
network request (`src/ai-call.ts:1737-1741`; `src/messages-stream.ts:642-647`). The known Live session
exception is POST and should be refused. `beginSpend` does not catch outside fetches, DB writes or
sweeps, email, arrivals, or accidentally allowed Live; classification remains necessary.

After-response tasks inherit owner `AsyncLocalStorage`: `runInRequest` is outermost
(`src/routes.ts:9323-9341`) and tasks drain before it returns (`src/after-response.ts:45-60`). They do
not inherit the spend collector, which has returned before that drain. Put the view-as refusal in an
identity/request scope. `/api/library/terms` refresh is awaited inside its handler after sending the
response (`src/routes.ts:10843-10863`), so it remains in both scopes; refusing it is still correct.

`runAsOwner` replaces the scope box with `{owner}` (`src/owner.ts:197-220`). A `viewAs` field added to
that box would disappear on nested re-entry. Preserve the immutable request marker across request-
local owner changes, or keep it in a separate context; test this explicitly.

### Medium 5 — Part 1 still chooses status before recency

The original diagnosis is correct: a failed import already present at mount matched neither live,
completed, nor followed. Adding failed/cancelled imports fixes that case, and `isImportJob` correctly
excludes mode jobs.

But the final choice remains `live ?? followed ?? completed ?? failed`
(`src/web/article/StillBeingAdded.tsx:111-130`). Separate `find`s mean status/follow history outrank
time despite a newest-first queue. Retry creates a new job for the same slug
(`src/jobs.ts:5115-5155`). Thus:

- If this tab followed failed A, another tab retries, and new B fails before this tab observes B live,
  `[B(error), A(error)]` still displays A because `followed` precedes `failed`.
- If B finishes but the one article reread still yields 404, `retryCompleted` becomes false
  (`src/web/article/ArticlePage.tsx:103-113,180-193`), completed B disappears, and old failed A is
  shown. A normal successful reread unmounts this branch, but a transient refusal must not turn a
  success into a stale failure.

Find the newest import job once, then interpret only its status. If newest is a completed job already
checked, show no job rather than falling through to an older failure. `followed` must not outrank a
newer retry. Add both sequences; current tests cover newer-live/older-failed and done-only, not these
retry orders (`tests/still-being-added.test.tsx:226-235,268-284`).

### No finding — `published` does not leak a private article

`shown = mine || visibility === "public"`, and `published` is null otherwise
(`src/store/pg-article-transfer.ts:663-679`). The raw revision id only derives the boolean and is not
returned. The route test pins title, slug, and published to null for a private cross-owner row and
checks private title/slug are absent from serialized JSON (`tests/article-transfer.test.ts:619-643`).
A public article gains one publication-state bit, but it was already in the deliberate public branch.

### Medium 6 — the proposed log is telemetry, not an audit trail

It reveals an actor/subject access relationship, time, and route class. UUID fields are not redacted,
though email is (`src/log-redaction.ts:47-69`); log ids, not addresses, and restrict access/retention.
“No slug” applies only to the new line: the existing HTTP line logs the exact path in fields and its
message (`src/routes.ts:9226-9279`), as the logging design promises (`docs/project/logging.md:178-190`).

There is no log drain (`docs/project/logging.md:14-17`), the static GET start cannot write a server
line, and Stop has no end line. Use the server session row from Blocker 1 for durable audit; request
logs are supporting diagnostics.

## A materially simpler first version

Build a **support snapshot**, not identity impersonation: an admin-only
`/admin/articles/:id/inspect` endpoint/page that loads one article explicitly by id and owner in one
narrow store function and returns a purpose-built read-only DTO containing article data, persisted
mode artefacts, and job/import diagnostics. Do not switch owner scope, mount normal job/upload
engines, use offline cache, or expose mutation controls. Audit admin, article, reason, and time.

This fully answers report 2 and most article-centred report 3 cases without changing roughly 300
route contracts or giving the browser two identities. It will not reproduce account-wide shelf,
profile, chat-session, or interactive-write bugs; those are the evidence threshold for full view-as.
The plan rejects an admin article page because modes use owner-scoped hooks
(`docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:233-236`), but that only means
the snapshot should not promise pixel-identical interactivity. It can render persisted outputs from
one DTO and state its limits.

## The three questions for Greg

1. **Scope is Greg's choice, but question 1 is not ready as framed.** A is unsafe as proposed, B is
   full-power and unaudited, and C is undersold. Ask whether to ship the support snapshot now
   (recommended), or invest in full read-only view-as with the mandatory session/audit/client
   isolation above. Keep login-as as an exceptional accepted-risk procedure, not a default option.

2. **The title choice is Greg's, but recommend B.** Ability to click through does not make ambient
   disclosure free. The current defence excludes titles, URLs, filenames, and reading prose from the
   cross-account table (`docs/project/admin.md:203-220`). Dates plus deliberate Inspect/View-as keeps
   minimisation and makes the banner/audit meaningful.

3. **Disclosure is Greg's, and B is fair.** The current policy already says the administrator may
   read articles and writing to fix bugs (`src/web/PrivacyPage.tsx:643-649`), but naming read-only
   support viewing is clearer. Per-view email is unnecessary for a one-admin beta if access is
   purpose-limited and durably audited.

Greg does not need to choose the safeguards: server-side admin checks, non-admin target refusal,
POST start/stop, absolute expiry, reason/audit, fail-closed classification, suppressed arrival/email/
spend/writes, no cache reads or writes, passive jobs, and effective-reader resets follow from the
security goal. They are prerequisites, not product options.
