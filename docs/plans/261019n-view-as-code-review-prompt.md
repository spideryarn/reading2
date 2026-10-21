# Review: admin "view as", a read-only tab showing the app as another reader sees it (plan 261019n § Part 3)

Repo: /var/tmp/spideryarn-worktrees/admin-view-as, branch worktree-admin-view-as. TypeScript, ESM,
one Node server (src/routes.ts), React client under src/web/, Postgres through Drizzle and pg,
Supabase auth and Storage.

## The candidate

Committed: commit e8180d86d (parent e97877409)
           git diff e97877409..e8180d86d
           changed paths: git diff --name-only e97877409..e8180d86d (79 paths)

Start with src/routes.ts (search `serveViewingAs`, `pinViewAsHeaders`, `viewAs: "read"`,
`isViewAsControlPath`), src/db/client.ts (`readOnlyWhileViewingAs`), src/view-as-scope.ts,
src/store/pg-view-as.ts, index.html (`view-as-boot`), src/web/lib/api.ts and src/web/lib/view-as.ts.
That is where to begin; the whole manifest is in scope.

The design and its two rounds of your plan review: docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md,
from "## Part 3, built: view as" to the end, and docs/plans/261019n-view-as-plan-review-sol-2.md and -3.md.
The security docs it updated: docs/project/security.md § view-as, docs/project/security-map.md,
docs/project/admin.md § "Viewing the app as a reader, read-only".

## What it is meant to do

An admin presses "View as" on /admin/users, gives a reason, and a new tab opens the app as that
reader sees it: their library and their articles in every mode, for thirty minutes, with a bar
showing who, the minutes left, and Stop. The invariant is: **while viewing as, nothing is written
anywhere on the reader's behalf or the admin's**, with the following exceptions only: the
view_as_sessions row itself (start, stop), and the logs. Nothing may be written to the database or
Storage, no model is paid for, no email is sent, no job is queued, and no afterResponse work runs.
**Read-only is enforced on the server**; the client's refusals are courtesy. The second invariant is
**no session leakage**: the reader's data must not land in the admin's own browser storage, HTTP
cache, offline cache or other tabs; the admin's own data must not show in the view; the nonce must
not be usable by anyone but the admin who started it, or after Stop or expiry; and the view-as marker
(AsyncLocalStorage) must never reach another request, or be dropped inside one.

Deliberately out of scope: a SELECT-only database role (proposed to Greg, not built); the server
session surviving a reload until its expiry (a reload ends the tab's view; the row lives until
Stop or 30 minutes).

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review, each finding red-first with
the test that reproduces it, and leave everything wider as a finding for me to decide. Do not commit.
List every file you changed at the end.

/tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). You have no
network, so suites needing Postgres will skip. I ran the full `npm test` on this tree: 2049 files,
47171 passed, exit 0. `npm run typecheck` is clean.

## Attack it

Independently, before you read my questions below.

1. **Any write path open while viewing as.** Walk every GET row marked `viewAs: "read"` in
   AUTH_ROUTES and everything its handler reaches: store calls, `afterResponse`, p-queues,
   fire-and-forget promises, lazy "compute on read" caches, `ensure…`/`touch…`/`record…` helpers,
   outbound fetches, Storage, model calls through any path other than `beginSpend`. Then the DB
   wrapper in src/db/client.ts: can any statement, in or out of a transaction, write (a
   `prepare transaction`, `commit and chain`, `set session characteristics`, a function with side
   effects called from a SELECT such as `nextval` or a volatile function, `copy`, a `do` block, a
   connection obtained without going through the wrapped `query`/`connect`, a second Pool or
   Client constructed elsewhere, `listen/notify`)? Does an exception path leave a client in a
   transaction or out of the pool?
2. **Session leakage.** Marker escape through p-queue, timers, EventEmitters or an SSE handler that
   outlives the request; a promise started under the marker and awaited by an ordinary request, or
   the reverse; cache headers on a refusal or error path; the boot script's storage swap and its
   auth pass-through (could the reader's data be written to a key that passes through?); the
   BroadcastChannel, service worker or IndexedDB the app uses, if any; the nonce in Referer,
   history, logs or Sentry.
3. **The gate's order and its fail-closed properties**: unknown route, HEAD, OPTIONS, a path that
   matches two rows, the admin namespace, the three control routes (can a view-as tab call them,
   and can a non-admin?), an actor demoted mid-session, a subject who is an admin, an expired or
   stopped nonce, a nonce belonging to another admin.

For each finding give an ID numbered C1, C2, … (the plan rounds used F1–F8 and R2-1 to R2-6), a
severity, and whether it is established or reasoned; (a) the input or mutation that shows it fails;
(b) the smallest change that closes it. A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it.

**State the guarantee at its true strength.** For the invariant above, end your answer with one
sentence: is the statement in docs/project/security.md § view-as accurate as written, and if not,
the exact replacement wording?

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- In `readOnlyClient`, a `prepare transaction 'x'` inside a transaction ends it without matching
  `END_STATEMENT`, so `inTransaction` stays true and later statements are sent bare. Supabase's
  `max_prepared_transactions` is probably 0, but it is the kind of edge the regexes miss.
- `pinViewAsHeaders` wraps setHeader/appendHeader/removeHeader/writeHead on one response; does a
  streaming (SSE) handler or `res.end` before any header escape it?
- The client's in-memory storage swap runs in an inline script before the module graph; does any
  code read `window.localStorage` from a module evaluated before it, or from a worker?
