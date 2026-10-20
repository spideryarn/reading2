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
