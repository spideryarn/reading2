# /admin/feedback — reading the bug reports we already store

Greg pressed **Feedback** on production on 2026-09-02 and then asked the obvious next question:

> Can you see if this is visible in the production Postgres table (you might not have visibility
> into that) and/or Vercel MCP?
>
> Also, do we have an /admin/feedback/ page? If not, let's create one.

The answers were *yes, indirectly* and *no*. This plan is the second half.

## What we could already see, and what that says

The report landed: `spya-us5kzc`, 2026-09-02T15:22:01Z, `environment: production`, `route_kind:
read`, slug `temporal-context-reinstatement-spya-dhqkf9`, `consented: true`, `has_screenshot: true`,
`build_commit b6be6a78`, `vercel_id fra1::zjhq7-…`. It was read out of **Sentry**
([SPIDERYARN-READING2-M](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-M)), and it is
evidence about Postgres because [`src/feedback.ts`](../../src/feedback.ts) mirrors only a *newly
created* row — a `duplicate` or a `limited` submission never reaches Sentry, so a Sentry item
implies an insert.

Three things follow, and they are the argument for building the page:

- **No agent in this repo can read the production `feedback` table.** `.mcp.json` points the
  Supabase MCP at `http://127.0.0.1:54361` — the laptop stack — and `DATABASE_URL` in `.env.local`
  is local too. That is deliberate ([database.md](../project/database.md)) and is not going to
  change.
- **Vercel's runtime logs did not answer.** Every window tried (45m, 3h, filtered and unfiltered)
  came back `Query did not finish within the time budget`. Even when they work they would only show
  a 200 on `/api/feedback`; the report itself is never logged, by design
  ([pg-feedback.ts](../../src/store/pg-feedback.ts) § What may be logged from this file).
- **So Sentry is currently the only reader of a feature whose whole design says Sentry is the
  *second* destination.** [feedback.md](../project/feedback.md) is explicit that the row is
  authoritative and the Sentry copy is a best-effort mirror that cannot fail the request. A mirror
  being the only way to read the original is exactly backwards, and it means a report that Sentry
  dropped — `mirror_attempted_at is not null and mirrored_at is null`, the query the schema comment
  advertises — is today invisible to everybody.

## What this is

A third admin page, `/admin/feedback`, listing every report across all owners, newest first, with
the reader's three answers on it.

## The one thing that makes it different from /admin/users

[admin.md](../project/admin.md) and [pg-admin.ts](../../src/store/pg-admin.ts) both carry the same
rule, stated as the thing that makes the cross-owner exception narrow:

> **Counts and dates only.** No title, no URL, no filename, no sentence.

**This page breaks that rule, and it has to.** A bug report is prose or it is nothing. So the rule
does not get quietly widened — it gets a second clause, written where the first one lives:

> The admin pages show **counts and dates about accounts**, and **the words a reader deliberately
> typed into the Feedback dialog** — nothing else, and never a third category.

That is defensible on exactly the ground [feedback.md](../project/feedback.md) § The one rule
already stands on: consent. The reader typed those sentences into a box labelled with what happens
to them, and one of the things that happens is that Greg reads them. Nothing else on an admin page
gets that permission, and this page must not become the place where article prose, a comment or a
note leaks in behind it.

**Consequence for the store method's name.** `listUsersAcrossOwners` was named that way on GPT Sol's
advice so the seam argues with its own call sites. Same trick: `listFeedbackAcrossOwners`.

## Stages

### Stage 1 — the store and the wire shape

- `AdminFeedbackReport` in [`src/admin.ts`](../../src/admin.ts), beside `AdminUser` and for the same
  two reasons that shape is there: it is one page's row, and `src/admin.ts` imports nothing.
  It is `FeedbackReport` plus the fields a cross-owner reader needs and an owner-scoped one does
  not — `ownerId` — and minus nothing. `screenshotBytes` is already the shape
  [`REPORT_COLUMNS`](../../src/store/pg-feedback.ts) selects, so no row drags a PNG through memory.
- `listFeedbackAcrossOwners(limit)` on `AdminStore` in
  [`contracts.ts`](../../src/store/contracts.ts), and `readAcrossOwners(id)` beside it for the
  screenshot route. Both implemented in a **new file**, `src/store/pg-admin-feedback.ts`, composed
  into `pgAdminStore`.

  New file rather than a method in `pg-admin.ts`: that file's header is a sustained argument that
  it never returns a sentence, and five paragraphs of it become false the moment a `steps` column
  is selected in it. Two files, one contract.
- `adminOnFiles` refuses it, loudly, in the shape `listUsersAcrossOwners` already refuses —
  `feedbackOnFiles` in [`store/index.ts`](../../src/store/index.ts) has the sentence to copy.
- `limit` is a bounded number with a default (200) rather than an unbounded select. This is the one
  table in the app that a stranger with an account can add rows to, capped at ten an hour each.

### Stage 2 — the route

- `GET /api/admin/feedback` → `{ reports }`, with `Cache-Control: private, no-store`, exactly as
  `/api/admin/users` sets it and for the reason recorded there.
- Matched as an **exact path** (`path === "/api/admin/feedback"`), like `adminUsers`, so
  `/api/admin/feedback/anything` is a 404 rather than a quiet match — and behind the namespace gate
  either way, since that gate is above the route table.
- `GET /api/admin/feedback/:id/screenshot` → `image/png`, or 404 when the row has no screenshot.
  The id is validated with `isSpideryarnId` before it reaches the store.
- `tests/routes.test.ts` already proves the namespace gate covers routes nobody has written yet;
  add a case that a non-admin gets 403 on both of these, so the proof names them.

### Stage 3 — the page

`AdminFeedbackPage` in [`AdminPage.tsx`](../../src/web/AdminPage.tsx), reusing `Shell`, and a
`useAdminFeedback` hook shaped like [`useAdminUsers`](../../src/web/useAdminUsers.ts) — same
callback, same `reload`, same "the old list stays on screen and the page says so" behaviour.

**Not a `DataTable`.** The shelf and the users page are tables because their rows are numbers, and a
table is the right shape for numbers. A bug report is three paragraphs; twelve of them in a
`<td>` is a page you cannot read. So: a list of cards, newest first, each one

- a header line — when (relative, `timeAgo`, with `exactly` in the `title`), who, environment, route
  kind and slug;
- the three answers, labelled, with a blank one saying so rather than collapsing;
- a footer of the correlation handles: `report_id`, `build_commit`, `vercel_id`, and the mirror
  state as **words** — *mirrored*, *sent, not acknowledged*, *not sent* — because
  `mirror_attempted_at is not null and mirrored_at is null` is the whole reason a page like this
  earns its place, and a raw pair of timestamps hides it;
- the diagnostics blob behind a `<details>`, and the screenshot behind another, fetched lazily via
  `apiFetch` → `blob()` → `URL.createObjectURL`, which is what
  [`Metadata.tsx`](../../src/web/Metadata.tsx) and [`SourceLink.tsx`](../../src/web/SourceLink.tsx)
  already do. `<img src="/api/admin/…">` cannot work: auth here is an `Authorization: Bearer`
  header, not a cookie, and an `<img>` sends no header.

Plus the wiring: `AdminPage` union in [`router.ts`](../../src/web/router.ts) gains `"feedback"` and
the regex gains an alternation; `ADMIN_FEEDBACK_HREF`; `page-title.ts`; the branch in
`App.tsx`; a second card on `AdminHome`.

### Stage 4 — the docs

[admin.md](../project/admin.md) gets the second clause of the rule, in the section that currently
states the first. [feedback.md](../project/feedback.md) gets a line saying where a report is read,
which is the question it does not currently answer.

## The simpler options passed over

- **Read it in Sentry and build nothing.** It is what happened today and it worked. It is refused
  because it makes a best-effort mirror the system of record: a report Sentry rate-limited, dropped
  or never received is filed correctly and invisible, and there is no way to notice.
- **A script — `npx tsx scripts/feedback-ls.ts`.** Half a day cheaper, and it cannot run: nothing on
  this box holds a production `DATABASE_URL`, which is the constraint that started this. A page
  authenticated as Greg is the only reader that can reach the production row from a laptop.
- **One `/admin/feedback/:id` detail page.** More routes, more addresses, and the list already fits
  the whole report on a card. Revisit when there are enough reports that scrolling is the problem.
- **Serving the screenshot as a data URL inside the list JSON.** One route instead of two, and it
  drags every PNG in the list — up to 300 KB each, base64'd to 400 — into a response nobody has
  asked to look at. `REPORT_COLUMNS` avoids exactly this and says why.

## Checks

- `tests/admin-feedback-store.test.ts` — two owners' reports come back from one call, and the
  filesystem store refuses rather than returning `[]` (the silent-success shape this directory keeps
  being bitten by).
- `tests/routes.test.ts` — 403 for a non-admin on both new paths; 404 for
  `/api/admin/feedback/nonsense`.
- `tests/page-title.test.ts` / `tests/router.test.ts` — the new address parses and titles.
- `npm test`, `npm run typecheck`, `npm run check`.
- A browser pass in a Sonnet subagent against the local stack with `SPIDERYARN_STORE=postgres`,
  after filing a report through the real dialog — and then, once deployed, against production, where
  `spya-us5kzc` is the row that must appear.

## Risks

- **The one that matters: a column added later that is neither a count, a date, nor something the
  reader typed into this dialog.** The rule is written in three places for that reason. There is no
  mechanical enforcement and this plan does not invent one.
- Reading the reports is all this page does. Nothing on it resolves, deletes or replies — the same
  read-only posture as `/admin/users`, and the same reason: an admin page that can only look is a
  much smaller thing to get wrong.
