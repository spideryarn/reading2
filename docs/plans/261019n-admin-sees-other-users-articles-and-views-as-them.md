# What an admin can see of other readers' articles, and viewing the app as them

Three admin reports from Greg on one subject, 2026-10-19, all `feedback-reporter.ts` exit 0
(trusted). Overseer queue item `qi-tgm93qpt`.

> I tried opening this:
>
> https://www.spideryarn.com/read/conscious-artificial-intelligence-and-biological-spya-drhjjm
>
> But I just get a "Not shared" page...
>
> What's going on with it?
>
> It's named "Untitled" in the table
>
> — Greg, 2026-10-19 (`spya-zt7u0h`, problem, from `/admin/articles`)

> If I'm an admin, I should be able to see everything about other users' articles
>
> — Greg, 2026-10-19 (`spya-vm5enm`, suggestion, from `/admin/articles`)

> As an Admin, I want to be able to make sure things are working for other people, and/or reproduce
> problems that other people are experiencing.
>
> Create a way for me to log in as someone else? e.g. in /admin/users - so that I can browse the site
> as if I'm them.
>
> This can be tricky though, so use Sonnet for web research on best practice for this kind of
> login-the-admin-as-another-user behaviour. e.g. how do I log back out? Perhaps some kind of special
> bar at the top that stays visible while I'm in logged-in-as-another-user mode?
>
> Avoid making this tooooo complex if you can.
>
> — Greg, 2026-10-19 (`spya-k06kam`, suggestion, from `/`)

**Two parts.** Part 1 was a bug that is not a defence edit, so it is built and on `dev`. Parts 2
and 3 let an admin read another reader's article or act as them. That is an edit to a defence
([security-map.md](../project/security-map.md), [auth.md](../project/auth.md),
[admin.md](../project/admin.md)), so an unattended run plans it and asks
(`docs/user-feedback/questions/`). Nothing of parts 2 and 3 is built.

## Part 1: "Not shared" and "Untitled" (built)

### What was going on

The article is **Greg's own**, not another reader's. Its owner id is the production admin's. It was
a 7.8 MB PDF upload at 10:08 UTC on 2026-10-19 (job `spya-k0ytd8`). The job failed at `extract`:
the model wrote a NUL while transcribing three pages of maths, and Postgres stores none. That is
the bug Greg reported at 10:15 as `spya-u5azdm`. It was fixed in
[261019h](261019h-a-nul-in-a-pdf-transcription-stops-the-import.md) and is in production
(`origin/main` holds `4585fe1eb`). The article row has one revision with no title, and
`current_revision_id` is null: nothing ever published. All of this comes from read-only queries on
production.

So:

- **"Untitled"** is `/admin/articles` drawing an article with no published revision. It is not a
  separate fault: an article with nothing published has no title. But the word hid the real state.
- **"Not shared"** is a real bug. Before an import publishes, both the owner's read and the public
  read are 404. `OwnerNotShared` (`src/web/article/StillBeingAdded.tsx`, plan
  [261005l](261005l-permalink-and-share-while-an-article-is-importing.md)) exists so that the owner
  sees their import's card instead. It looked only for a **live** import, a **completed** one, or
  one it had **followed** from live to failed. An import that had **already failed** before the page
  opened matched none of these. So the page told the owner that their own article "isn't shared".
  It should have shown the failure and its Retry button.

### What changed

- `OwnerNotShared` now looks only at the **newest import job for the slug**, by `createdAt`, and
  reads its status:
  - queued, running, failed or cancelled: the page draws its card, with the reason and Retry;
  - done: it draws the card while following it to the end, or uses it once to re-read the article.

  The first draft added failed jobs as a fourth fallback after live, followed and completed. GPT
  Sol's plan review (F5) showed that ranks status above recency. In that draft, after a Retry the
  page could draw an older failure over a newer failed or completed job. Mode jobs and other slugs
  still say *Not shared*. The tests are in `tests/still-being-added.test.tsx`, each red before its
  fix:
  - a fresh visit to a failed import;
  - a newer failed retry over the failure the tab followed;
  - a newer completed import never falling back to an older failure;
  - plus a newer live import over an older failure, and a failed mode job.
- `/admin/articles` now gets a `published` flag on the rows it already shows a title for (the
  admin's own and public ones), and `null` on another reader's private row. The flag is false when
  the article has no current revision. A row with no title and `published: false` reads *Not
  published: its import failed or has not finished*, in the UI's voice, not the author's. Its link
  still goes to `/read/<slug>`, which now shows the job's card. Another reader's private row carries
  nothing new: `published` is null there, as the title is (admin.md § What it deliberately does not
  show). Tests: `tests/admin-articles-page.test.tsx` (red first), and `tests/article-transfer.test.ts`
  on the route.

**For Greg: Retry job `spya-k0ytd8`.** Open the article's address and press Retry on the card. The
fix behind the failure is deployed, and the 37 good chunks are cached, so a retry pays only for the
three that failed ([261019h § The job itself](../user-feedback/261019_1015-a-pdf-with-a-nul-in-its-transcription-imports.md)).
Nothing was re-run from here: that is a production write.

The simpler option passed over: keep "Untitled" and leave the table alone. That was rejected
because the word is what sent Greg to a page that misled him. The flag costs one column in a query
the route already runs.

## Parts 2 and 3: seeing other readers' articles, and viewing the app as them (proposed)

### Why these are one design

"See everything about other users' articles" (2) is most of what "browse the site as them" (3) gives.
Suppose the admin can open the app *as* the owner. Then the article opens with all its modes,
notes, chats and failures exactly as the owner sees them, and nothing has to be rebuilt for an
admin-specific article view. So the proposal is one mechanism, *view as*, plus a link to it from
`/admin/articles`.

### What the research says

[261019a-admin-impersonation-best-practice.md](../research/261019a-admin-impersonation-best-practice.md),
done by a Sonnet subagent.

- **Supabase has no built-in impersonation.** The community pattern is a service-role magic link
  for the target, then swapping the browser's session. That mints a full-power session that cannot
  be told apart from the reader's own. It touches their sign-in records. It overwrites the admin's
  own rotating refresh token, so "getting back" is fragile.
- **Clerk and WorkOS** issue a separate short-lived session whose token names the admin as the
  *actor* (RFC 8693 `act`).
- **The closest model is Pigment's write-up**: read-only by default and enforced on the server, deny
  by default, with a check that fails when an endpoint is unclassified. The admin's own session is
  kept apart. There is a persistent frame with an exit, and every start is audited.
- **The side effects to suppress** (WorkOS's list): emails, analytics identity, last-seen, jobs
  started, billable usage.

### What our code says

A read-only audit of the API (Explore subagent, 2026-10-19; route lines as of `54e7828f2`):

- **"GET means read-only" is false here.** 13 authenticated GETs write.
  - Five sweep stale pending rows: comments, chat, search, referee criteria, referee promises.
  - Two sweep claim checks: Sources and Debate.
  - `GET /api/jobs` settles or requeues a dead job.
  - `GET /api/library/terms` claims a topic set, then makes **paid model calls** after the
    response.
  - `GET /api/link-summary` streams a **paid OpenRouter call**.
  - `GET /api/link-preview` and `GET /api/citers/:slug` **fetch outside URLs**.
  - `GET /api/billing/usage` claims vouchers and can **send email**.
- **Two GETs are sensitive though read-only.** `GET /api/article/:slug/share-link` returns the
  private-link key, which is a credential. `GET /api/export/:slug` returns a zip of everything the
  reader holds on the article.
- **There is one place every paid model call passes**: `beginSpend` in `src/ai-spend.ts`, called by
  both gateways. The exception is Live's session minting, which is POST anyway.
- **A read-only database is not cheap.** `getDb()` is one shared pool on the transaction pooler.
  A per-request transaction would not survive SSE or the stores' own transactions. A second pool
  logged in as a SELECT-only Postgres role is the clean backstop, but it is infra plus a new secret.
- **The client files every response under the signed-in reader's id.** That covers the offline
  IndexedDB cache, `localStorage` drafts, last-view and the job engine. Shown as somebody else
  without care, a tab would write the other reader's shelf into the admin's own cache.

### What the two reviews changed

The first draft proposed *view as* with a raw header naming the subject, every route classified,
and the client's reader id swapped. Both reviewers disagreed with parts of it. Their files are
[the plan review](261019n-admin-sees-other-users-articles-and-views-as-them-plan-review-sol.md)
(GPT Sol) and § Reviews below (Opus).

- **GPT Sol: unsafe as written.**
  - The browser could invent an open-ended session. There was nothing on the server to expire,
    revoke or audit, and `/view-as/<id>` was a GET that changed state.
  - Swapping the reader id breaks the client's isolation in three ways. `NotThisReader` would have
    to be loosened. The offline cache can answer a failed request with *the admin's own* cached
    shelf under the subject's bar. And the job engine POSTs `/advance` by itself.
  - The gate sets the owner before the route is matched.
  - `runAsOwner` would drop a `viewAs` marker kept in the same box.
  - `noteArrival` is one more GET side effect.

  Sol recommended a narrower first version: a read-only **support snapshot** of one article.
- **Opus: view-as is the right shape, made smaller.**
  - Use an **allowlist** of the GET routes view-as may use. A route not on it is refused, so a new
    route fails closed without anyone typing `refuse` on all 151 rows.
  - Make the client passive: send no background writes, and don't attempt the whole client.
  - The job requeue is a real way to spend money: a job that `GET /api/jobs` requeues runs later,
    outside the request's scope, on the subject's account.
  - A refused panel must say *hidden while viewing as*, never draw its empty state. Otherwise
    "she has no comments" is a false reading.
  - Fold the titles question into the main one, and decide the safeguards ourselves.

**Where they agree, it is decided here.** These are prerequisites, not options for Greg:

- start and stop are POSTs;
- a server-side session row with an absolute expiry and a reason;
- non-admin subjects only;
- an allowlist that fails closed;
- no spend, email, arrivals, sweeps or requeues;
- no offline cache reads or writes;
- a passive job list;
- a clean reset on entry and on exit.

**Where they disagree (snapshot or view-as), Greg chooses.** It is a product trade-off: how much of
"browse as them" he wants now, against how much machinery.

### Option A: read-only *view as*, done properly

```
/admin/users                          a new tab, viewing as alice
┌──────────────────────────────┐      ┌──────────────────────────────────────────────────┐
│ alice@…  12 articles  [View as]──▶  │▌ Viewing as alice@… · read-only · 27 min · Stop   │ ← fixed bar
│ bob@…     3 articles  [View as]│    ├──────────────────────────────────────────────────┤
└──────────────────────────────┘      │  alice's shelf, her articles, modes, notes and    │
                                      │  chats, as she sees them. Anything that would     │
                                      │  write says "hidden while viewing as".            │
                                      └──────────────────────────────────────────────────┘
```

1. **Start.** *View as* on `/admin/users` (and *View as owner* on `/admin/articles`) asks for a
   one-line reason. Then it `POST`s `/api/admin/view-as` with `{ subject, reason }`.
   - The server checks the caller is an admin and the subject an existing non-admin account.
   - It writes a row in a new table, `view_as_sessions`: actor, subject, reason, `started_at`,
     `expires_at` (30 minutes on), `ended_at`. This is one additive migration.
   - It returns an opaque nonce. A new tab holds the nonce in sessionStorage. The admin's own tabs
     and Supabase session are untouched.
2. **Every request** from that tab carries the admin's own token and `X-Spideryarn-View-As: <nonce>`.
   The gate **matches the route first**. Then it checks four things:
   - the verified caller (`user.id`, never the switched owner) is an admin;
   - the nonce is theirs and is live;
   - the route is on the allowlist;
   - it is a GET.
   Only then does it run that one handler as the subject, with an immutable `viewAs { actor }` marker
   kept apart from the owner box, so `runAsOwner` cannot drop it. Anything else is 403
   `[view-as-read-only]`, and never enters the subject's scope. `noteArrival` is skipped.
3. **The allowlist** (an optional field on `AUTH_ROUTES`, which is a type error on a non-GET row)
   holds about 25 routes: the shelf, the article and its assets, the metadata page, each mode's
   stored artefact, comments, chat threads, searches, the reader profile, and the job list. Six of
   those sweep stale rows on a GET: comments, chat, search, referee criteria and promises, and
   jobs. They read **without** sweeping while viewing as, and the jobs list never settles or
   requeues. Everything the audit found writing, spending, fetching or emailing stays off the
   list. So does `share-link`, whose key is a credential, and so does export. A test drives every
   one of those 13 GETs with a nonce and proves nothing ran.
4. **Backstop on money.** `beginSpend` throws while the marker is set, so a mistake on the allowlist
   still spends nothing.
5. **The client is passive in that tab.**
   - Each request is bound to `{ actor, subject, nonce }`, and the token check stays against the
     actor. Ordinary tabs keep today's rule.
   - The offline cache neither reads nor writes.
   - It has a job list but no engine that advances, retries or uploads.
   - There are no reading-time beacons, no last-view, no drafts and no Feedback dialog.
   - In-memory stores are reset on entry and on exit.
   - A view the allowlist refuses says *hidden while viewing as*.
   - The bar shows who, the minutes left (from the server's answer, not the tab's) and Stop. Stop
     `POST`s the end and closes the tab.
6. **Audit** is the session row. Request logs name the actor and subject ids, never addresses.

**Cost.** About two days, in three stages, each reviewed by GPT Sol: the migration and gate, the
allowlist and its tests, then the client. **It gives Greg** the real app as the reader sees it:
shelf, articles, modes, notes, chats and failed imports. **It gives up** anything that writes, so
a bug that only shows on pressing a button is still reproduced in his own account.

### Option B: a support snapshot of one article (Sol's simpler version)

- `/admin/articles` gets an *Inspect* button on every row.
- It opens an admin-only page that loads one article by id through one narrow store function, with
  a reason asked first and the visit logged in a small audit table.
- The page shows:
  - the article's text;
  - which modes have output, and what it says, drawn plainly rather than in each mode's own
    interface;
  - the reader's comments, notes and chats on it;
  - the import history: each job, its steps and its error.
- Nothing switches identity. No engines, caches or reader-facing code are touched.

**Cost.** About half a day to a day. **It gives Greg** all of report 2, and the article-centred
half of report 3: a failed import, a mode that went wrong, what the reader wrote. **It gives up**
browsing as them. That leaves out the shelf, the profile, and the look of each mode as the reader
saw it. It is a separate page that does not look like the app.

### Option C: log in as them (passed over)

A Supabase magic link for the reader, opened in a private window. It needs the least code, and it
is the only option that reproduces writes. But it gives full power with no marker. It writes as
them and spends their quota and our money. It updates their sign-in record, has no bar Greg can
trust, and leaves no audit. It also overwrites the admin's own refresh token in that window. Not
recommended. It stays as an exceptional, by-hand procedure if a write-only bug ever needs it.

### What either option changes in the written defences

admin.md § *What it deliberately does not show* says the admin pages show "never a title, a URL, a
filename, or a sentence of anybody's reading". A and B both break that rule on purpose, for one
reader at a time, after a reason. So the rule is rewritten as part of the build, shown before and
after, through [edit-important-docs.md](../reusable/edit-important-docs.md). The public privacy page
already says *"we may read your articles and what you have written in order to fix a bug or make
the thing better"*, so neither goes beyond what readers were told. The table on `/admin/articles`
keeps hiding other readers' titles in both options. The deliberate button is the only way in,
which is what makes the reason and the audit mean something (Sol).

### Questions for Greg

In `docs/user-feedback/questions/`. In short:

1. A (view as, ~2 days), B (article snapshot, ~half a day to a day), or B now and A later?
   Recommended: **A**, because it is what reports 2 and 3 ask for, and the safeguards that made
   it heavy are now designed rather than skipped. B first is the reasonable cheaper path if "browse
   as them" can wait.
2. What do readers read about it? (A) Nothing new: the privacy page's current sentence covers it.
   (B) One added clause: *"…we may read your articles and what you have written, including by
   viewing the app as you, read-only, in order to fix a bug…"*. Recommended: **B**.

Decided here, not asked:

- other readers' titles stay out of the `/admin/articles` table;
- every safeguard listed above;
- no email to the reader on each view;
- no write mode.

## Reviews

- **GPT Sol, plan review** (2026-10-19,
  [file](261019n-admin-sees-other-users-articles-and-views-as-them-plan-review-sol.md)). Findings:
  - Part 1: F5 (status before recency) was right; fixed and tested as above. It confirmed that
    `published` leaks nothing.
  - Parts 2–3: blockers 1–2 and highs 3–4 are taken into option A; the snapshot is option B; and
    finding 6 (a log is not an audit) led to the session row.
  - Its advice on Q2: keep titles out of the table. Adopted, so it is no longer a question.
- **Opus, design** (2026-10-19, subagent):
  - Allowlist, not classify-everything: adopted.
  - A passive client, with background writes never sent: adopted.
  - The job requeue as a spend path, so `GET /api/jobs` must not requeue in view-as, with a test:
    adopted.
  - *Hidden while viewing as* rather than empty states: adopted.
  - The safeguards decided rather than asked: adopted.
  - Its pick was trimmed view-as over the snapshot; Sol's was the reverse. That split is
    question 1.
- **GPT Sol, code review of part 1** (2026-10-19,
  [file](261019n-admin-sees-other-users-articles-and-views-as-them-code-review-sol.md)). It found
  three gaps in the new selector and fixed each one, with a test it saw go red first:
  - after Retry, the old failed card stayed until the next poll. The replacement the POST returned
    is now held until the list carries its id;
  - an equal `createdAt` now breaks by id, as the store does;
  - a malformed `createdAt` can no longer hide a valid job.

  `published` was confirmed complete and leak-free. The diff was read and the gates re-run here.
  Its postmortem is [261019e](../postmortems/261019e-a-selector-is-only-as-current-and-total-as-its-input.md).
  The bug Greg hit has its own: [261019f](../postmortems/261019f-a-fallback-chain-covers-only-the-states-its-author-pictured.md).
  Deferred, and named in 261019e: decoding `/api/jobs` at the browser boundary.

## Part 3, built: view as (Greg chose A, 2026-10-20)

> A
>
> — Greg, 2026-10-20 16:21 UTC, reply `spya-kpzvrk` to question 1 of
> [q-kyhvkm](../user-feedback/questions/q-kyhvkm.md)

He did not answer question 2, so its recommendation is taken by default: the privacy page's
sentence gains *"including by viewing the app as you, read-only"*.

The design is option A above, unchanged in what it promises. This section is how it is built, and
it is what the reviews read. Two audits fed it (Explore subagents, 2026-10-20): one of every
authenticated GET, one of everything the client does without a click.

### The shape

```
admin's ordinary tab                       the view-as tab (opened by the first)
/admin/users  [View as] ── reason? ──▶     POST /api/admin/view-as {subject, reason}
                                           ◀── {nonce, subject email, expiresAt}
window.open("/#view-as=<nonce>")  ───▶     boot: nonce → sessionStorage, fragment stripped
                                           every apiFetch: Authorization: <admin's own token>
                                                           X-Spideryarn-View-As: <nonce>
                                           server: admin? nonce live and theirs? subject not admin?
                                                   GET on the allowlist? → run as the subject
                                                   anything else → 403 [view-as-read-only]
                                           ▌ Viewing as alice@… · read-only · 27 min · Stop
```

The admin's own Supabase session is never touched: no token is minted, no sign-in is recorded on
the reader's account. The nonce is useless without the admin's own token, and the admin's token is
useless for view-as without a live nonce.

### Server

1. **One additive migration**: `view_as_sessions` — `id`, `nonce_hash` (sha256 of the nonce; the
   nonce itself is never stored), `actor_id`, `subject_id`, `reason` (1–300 characters),
   `started_at`, `expires_at` (`started_at + 30 min`, absolute, never extended), `ended_at`
   (nullable). Foreign keys to `auth.users` for both ids, and a check that they differ. Written
   only by the admin routes below; nothing deletes a row, so it is the audit.
2. **Three admin routes**, inside `/api/admin/` and so behind the existing admin gate, run as the
   admin, never switched:
   - `POST /api/admin/view-as` `{ subject, reason }` → the subject must exist in Auth and not be
     an admin; returns `{ nonce, subjectEmail, expiresAt }`. 32 random bytes, base64url.
   - `GET /api/admin/view-as/current` (nonce in the header) → `{ subjectEmail, expiresAt }` for a
     live session of this admin's, or 410 `[view-as-ended]`. The bar reads its minutes from this.
   - `POST /api/admin/view-as/end` (nonce in the header) → sets `ended_at`; idempotent.
3. **The gate**, in `serveAuthenticatedApi`, before the admin namespace check and the table:
   - no `x-spideryarn-view-as` header → today's path, byte for byte;
   - header on one of the three control routes → today's path (they read the header themselves);
   - header anywhere else → `serveViewingAs`: the verified caller must be an admin (403
     `[view-as-not-admin]`); the nonce must match a live session of **this** actor (410
     `[view-as-ended]`); the subject must still not be an admin; the route is matched against
     `AUTH_ROUTES` first and must be a GET row with `viewAs: "read"` (403 `[view-as-read-only]`,
     whose sentence the panel shows: *Hidden while viewing as another reader: this would change
     something or cost something.*). Only then: `setRequestOwner(subject)`, a `VerifiedUser` for
     the subject made by one function in `src/auth.ts` that takes the actor's `VerifiedUser` and
     re-checks `isAdmin`, and the handler runs inside `runViewingAs({ actor, subject, session })`.
   - No `noteArrival`, and the monitoring user is the actor, tagged with the subject id.
   - The request log line carries `viewAs: { actor, subject }` ids — never addresses.
4. **The allowlist** is a field on the route row, `viewAs?: "read"`, allowed by the type only on a
   GET row. A row without it is refused, so a new route fails closed. A test enumerates every GET
   row and pins which are on the list, and that no admin-namespace row is.
5. **The marker** is its own `AsyncLocalStorage` in `src/view-as-scope.ts`, separate from the owner
   box, so `runAsOwner` does not drop it. `viewingAs()` answers the marker or `null`.
6. **Backstops**, each a throw when `viewingAs()` is set, each with a test that an allowlisted
   handler reaching it is stopped:
   - `beginSpend` (every paid model call);
   - `sendEmail`;
   - **database writes**: the pool's `query` (and every checked-out client's) refuses a statement
     that writes (`insert`, `update`, `delete`, `merge`, `truncate`, `select … for update/share`,
     DDL) while the marker is set. A text check, so it fails toward refusing; a read that trips it
     is a bug to see, not a leak.
   - Outbound fetches are **not** backstopped generically: the server's own `fetch` also reads
     Supabase Storage and the JWKS. They are kept off by the allowlist (link-preview, link-summary,
     citers, terms are refused), and the audit names every GET that fetches.
7. **Sweeps.** The GETs that sweep stale pending rows (comments, chat, searches, referee criteria
   and promises, Sources/Debate claim checks) and `GET /api/jobs` (settle/requeue) skip the sweep
   when `viewingAs()` is set, and read what is there. If skipping is not clean for one of them it
   stays off the list. The database backstop catches any sweep that was missed.


### The allowlist, from the audit

66 GET rows (Explore audit of `AUTH_ROUTES`, 2026-10-20). **On it** (`viewAs: "read"`), pure reads:
`/api/library`, `/api/library/search`, `/api/library/tags`, `/api/models`, `/api/feedback`,
`/api/reader`, `/api/article/:slug`, `/api/source/:slug`, `/api/asset/…`, `/api/metadata/:slug`,
and each mode's stored artefact: tweets, glossary, ideas, quotes, timeline, quiz, faq,
sources-claims (and its old name debate-claims), relations, crossrefs, simple, skim, reception
(and debate), related-work, bibliography (and citations), reading-time, stale-notices, sketch,
illustrated and its plates, arc, referee scan, referee hidden-check, `/api/uploads/:id`,
`/api/jobs/:id`.

**On it with the side effect skipped while viewing as**: comments, chat, search, referee criteria,
referee promises (each skips its pending sweep), the two claim-check routes (skip `.sweep`, read
`.list`), and `GET /api/jobs` (skip `settleExpired`; list only).

**Refused**: every `/api/admin/…` GET; `/api/library/terms` (it writes phrase-run rows even on its
free path, then claims and spends after the response); `/api/link-preview` and `/api/citers/:slug`
(fetch outside, write caches); `/api/link-summary` (spends); `/api/article/:slug/share-link` (a
credential); both exports; `/api/billing/usage` (claims vouchers **as `user`, the real caller**, and
may email). Their panels say *hidden while viewing as*.

Handlers that read `user` rather than the owner box would read the admin's data: the audit found
them only on refused rows (admin routes, billing). The subject's `VerifiedUser` is still what the
handler is given, so an allowlisted handler that reads `user.id` gets the subject.

### Client

1. **Entry.** `boot.tsx` reads `#view-as=<nonce>` before anything else runs, puts it in
   `sessionStorage` (per tab), and strips the fragment with `replaceState`. A new module
   `src/web/lib/view-as.ts` answers `viewAsNonce()`; it imports nothing.
2. **`apiFetch`** in that tab:
   - adds the header;
   - refuses any non-GET **before sending**, with the same 403-shaped `HttpError` and sentence the
     server would give, so no write leaves the tab at all (the server still refuses on its own);
   - sets the cache drawer to `null`, which every offline-store helper already treats as "keep
     nothing, read nothing";
   - `leavingFetch` is a no-op.
3. **Reader-keyed browser storage** that runs without a click is skipped: `useShelf`'s cached
   shelf read, `useLastView`'s writes and restore, the Feedback button (hidden), reading-time
   flushes, the shelf preload, `useJobSession`'s engine (it lists jobs but never advances,
   retries or uploads), and the auto-run `ensure`. Each is one `if (viewAsNonce())` at its entry.
4. **The bar**, mounted in `main.tsx` beside `OfflineStrip`, outside `App`, so every page has it:
   who (the subject's email, from the server), minutes left (from `expiresAt`, re-read every
   minute), and **Stop**, which POSTs the end, clears sessionStorage and closes the tab (or, if the
   browser will not close it, reloads to the admin's own shelf). On 410 the bar says the session
   has ended and offers to close.
5. **Buttons**: *View as* in the Account cell on `/admin/users` for any non-admin account, and
   *View as owner* on `/admin/articles` beside Transfer. Each asks for a reason, POSTs, and opens
   the tab.

### Docs

- admin.md § *What it deliberately does not show*: the rule rewritten (before and after in the
  commit and the report), plus a § on view as.
- security.md: a section on the new cross-owner read, its four checks, the allowlist, the
  backstops and what is not backstopped.
- security-map.md: rows for `src/view-as*.ts`, the gate, and the client's passive switch.
- auth.md § Whose data is it: the second deliberate exception, pointing at admin.md.
- privacy.md and `PrivacyPage.tsx`: the added clause.
- The question file and the report's note.

### Stages

1. **Server**: migration, store, routes, gate, allowlist, marker, backstops, sweeps, tests (red
   first for the gate). Sol code review.
2. **Client and docs**: the tab, the bar, the buttons, the passive switches, the docs, the
   question and note. Sol code review, adversarial, of both stages together.

### Not done, deliberately

- No write mode, no "log in as".
- No per-page audit rows: the session row says who, whom, when and why.
- No email to the reader.
- No generic outbound-fetch backstop (above).

### What GPT Sol's plan review changed (round 1, 2026-10-20)

[Review file](261019n-view-as-plan-review-sol-2.md): three P0s, four P1s, one P2. All accepted;
the design above is amended by this list, which wins where they differ.

- **F1 (P0), the tab still believes the admin is its reader.** Reader-keyed browser storage is
  not fixed by scattered `if`s. `boot.tsx` replaces `window.localStorage` and
  `window.sessionStorage` in a view-as tab with **empty in-memory stores**, before any other module
  runs, so nothing the admin's tabs saved is read and nothing is written where they can see it.
  The nonce lives only there, in memory: **a reload ends the view**, and a tab opened from it
  inherits nothing. The tab is opened with `noopener`. `/current` and start return `subjectId` and
  the subject's email; wherever the app names the signed-in reader, it names the subject.
  Credentials stay fenced against the actor (`NotThisReader` unchanged).
- **F2 (P0), the browser's HTTP cache.** Assets and plates are `max-age=31536000, immutable`, so
  a response could outlive Stop. Every view-as request is sent `cache: "no-store"`, and the server
  forces `Cache-Control: private, no-store` and `Vary: X-Spideryarn-View-As` on every view-as
  response, overriding the handler's own header.
- **F3 (P0), writes that never go through `apiFetch`.** The tab renders only the shelf, an
  article (with its modes) and the metadata page; every other route (profile and account, add,
  upload, OAuth consent, password, live, admin, pricing) draws *Not available while viewing as*.
  Wikipedia hover cards fetch nothing. The promise is narrowed to what is true: no request to our
  API but the allowlisted GETs, `current` and `end` leaves the tab; the admin's own token refresh
  may.
- **F4 (P1), deferred work.** The outer owner box stays the actor. The handler runs as
  `runViewingAs(marker, () => runAsOwner(subject, handler))`. `afterResponse` and job enqueue
  refuse while the marker is set.
- **F5 (P1), Stop and expiry.** Stop has its own transport, the only non-GET the tab may send.
  On Stop (after 2xx or 410), at `expiresAt`, or on any 410 `[view-as-ended]`, the tab tries
  `window.close()` and otherwise `location.replace("/")`, which drops the nonce with the page.
  Subject content is never left under an *ended* bar.
- **F6 (P1), no second way to mint a `VerifiedUser`.** The handler is given the actor's real
  `VerifiedUser`; the subject is only the owner box. A view-as row's handler is typed to receive
  `{ request }` with **no `user`**, so a handler that reads `user` does not compile onto the list.
- **F7 (P1), the SQL-text check was a tripwire, not a boundary.** Replaced by Postgres's own: while
  the marker is set, the pool runs each query inside `BEGIN TRANSACTION READ ONLY … COMMIT` on a
  checked-out client, and a store's own transaction has its `begin` sent as `begin transaction
  read only`. Postgres then refuses every write (`nextval`, writable CTEs and volatile functions
  included). This needs no second role or secret; Sol's SELECT-only role remains the stronger
  option if this ever proves leaky.
- **F8 (P2).** The old aliases (`debate-claims`, `debate-claims/…/checks`, `debate`, `citations`)
  are off the list. Storage reads (source, assets, plates, upload status, referee scan) are named
  as outbound reads to Supabase Storage, not "pure".

### What round 2 changed (2026-10-20)

[Review file](261019n-view-as-plan-review-sol-3.md). F2, F4, F6 and F8 closed; no P0. Taken:

- **R2-1 (P1)**: the in-memory `localStorage` passes the Supabase session key
  (`sb-<project>-auth-token`, and its code-verifier) **through to the real storage**. The tab then
  shares the admin's session exactly as any other tab does, and a token refresh in it cannot fork
  the rotating refresh token away from the admin's other tabs (which a copied-in key would). Every
  other key starts empty and stays in memory.
- **R2-2 (P1)**: `BEGIN READ ONLY` alone could be escaped by a multi-statement simple query or by
  `SET TRANSACTION READ WRITE` sent first. So while viewing as: every query is sent with
  `queryMode: "extended"` (pg 8.23), which Postgres refuses to run as more than one statement;
  each ordinary query runs alone in its own read-only transaction, so a lone `COMMIT` or `SET`
  reaches nothing after it; and a Drizzle transaction's `begin` is rewritten to read-only and
  followed at once by `select 1`, which takes the snapshot, after which Postgres refuses to switch
  to read-write. An explicit `accessMode: "read write"` is refused. Writes to an *existing*
  temporary table remain possible, and harmless here. **Sol's SELECT-only role is still the
  stronger boundary**; it needs a new database role and a new secret, so it is proposed to Greg
  rather than built.
- **R2-3 (P1)**: the per-query wrapper rolls back on any failure, always releases, and destroys
  the client (`release(err)`) when cleanup itself fails. Tested by five failing view-as queries
  followed by an ordinary write.
- **R2-4 (P2)**: the bootstrap (nonce out of the fragment, the storage swap) is an inline script
  in `index.html` ahead of the appearance script and every module, not a statement in `boot.tsx`.
- **R2-5 (P2)**: no `sweepDictations` and no dictation in a view-as tab.
- **R2-6 (P2)**: if Stop's request fails in transport, the nonce and the subject content stay
  behind the bar, which says Stop did not complete and offers Retry.

### What GPT Sol's code review changed (2026-10-20)

Reviewed commit e8180d86d; prompt
[261019n-view-as-code-review-prompt.md](261019n-view-as-code-review-prompt.md), answer
[261019n-view-as-code-review-sol.md](261019n-view-as-code-review-sol.md) (exit 0). Sol refused it
as submitted on eleven P1s and fixed each inside the stage, red-first; I read the diff and re-ran
typecheck and the ten view-as, route-contract and doc suites against Postgres (749 passed, none
skipped). In short:

- **The database guard** (C1–C4) now tokenises SQL comments before deciding that a statement ends
  a transaction, refuses `PREPARE TRANSACTION`, pins a chained transaction with `select 1`, and
  refuses the known session and external effects that `READ ONLY` does not stop (`NOTIFY`,
  `set_config`, session advisory locks, SQL `PREPARE`, held cursors, `LOAD`, `COPY`). The stores'
  `pg_advisory_xact_lock` is still allowed, and nothing in the app names a prepared statement.
- **The request lifecycle** (C5, C6): the three control routes no longer queue the arrival
  epilogue, and the referee scan neither reads nor fills its process cache while viewing as.
- **The tab** (C7–C11): a null email no longer discards the expiry; the reader's pages mount only
  after `/current` has authorised them; a demoted actor or promoted subject ends the tab; a page
  restored from bfcache is hidden and sent home; and a Supabase sign-out or account switch ends the
  view without touching the admin's offline cache.
- **C12**: only an auth key already present at boot passes through to real localStorage.
- **Accepted, deliberately** (C14–C16): the admin's own Supabase session can refresh in real
  localStorage (the R2-1 design, and it carries nothing of the reader's); writes to an existing
  temporary table and arbitrary extension functions are not covered by SQL inspection, which the
  SELECT-only role would close; bfcache is defended by hide-and-redirect, not proven absent. Each is
  stated at that strength in [security.md § view-as](../project/security.md#view-as).

Three postmortems name the classes:
[261020b](../postmortems/261020b-a-read-only-handler-is-not-a-read-only-request-lifecycle.md),
[261020c](../postmortems/261020c-a-sql-regex-state-machine-cannot-own-the-server-transaction-state.md),
[261020d](../postmortems/261020d-authorization-expiry-must-remove-data-already-on-screen.md).

### Landing (2026-10-21)

- **The migration was renumbered twice** at merges with dev, which gained
  `20261020164021_article_open_times` and then `20261020204049_chat_threads_mode_prepared_at`. Each
  time it was regenerated on top (identical DDL, the two hand-written `auth.users` keys appended
  again), ending as `20261021154507_view_as_sessions`, so the snapshot chain stays linear and the
  journal in time order. Applied to the local database (`Target: postgresql://postgres@127.0.0.1:54362`).
- **Browser run (Playwright, the box, as dev-admin viewing dev-reader-b): all seven checks
  passed.** The button and reason form; the new tab with the fragment stripped; the reader's
  library and articles in six modes; chat and Add refused with the read-only message, and no
  non-GET leaving the tab except `/api/admin/view-as/end`; both storages empty in-memory shims;
  `private, no-store` on every `/api` GET; Stop closing the tab and the old nonce answering 410;
  the admin's own library unchanged. At 390px the bar clipped "30 min left" to "30 mi…", so the
  name now gives way first (`shrink-[100]`). A hand-written `fetch` POST from the console leaves
  the tab, as expected, and the server refuses it.
- **Dev's new open counter** (`POST /api/library/:slug/open`, now also writing
  `article_open_times`) is a POST, so the gate refuses it, and ArticlePage already skips it while
  viewing as.
