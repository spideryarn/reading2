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
the reader's own words on it. **Built 2026-09-02.**

## The one thing that makes it different from /admin/users

[admin.md](../project/admin.md) and [pg-admin.ts](../../src/store/pg-admin.ts) both carry the same
rule, stated as the thing that makes the cross-owner exception narrow:

> **Counts and dates only.** No title, no URL, no filename, no sentence.

**This page breaks that rule, and it has to.** A bug report is prose or it is nothing. So the rule
does not get quietly widened — it gets a second clause, written where the first one lives.

The first draft of that clause said *"the words a reader deliberately typed"*, and GPT Sol refused
it as **not truthful**: the page also shows an email, an owner id, a route kind and slug, build and
Vercel identifiers, an opt-in diagnostics blob, and a screenshot whose *pixels* may be article
prose. The wording that shipped enumerates all of it, and says out loud the two things the short
version hid — that a screenshot of somebody else's shared article is not that owner's consent, and
that the `slug` travels whether or not the diagnostics box is ticked while the tick-box copy implies
otherwise. [admin.md § What it deliberately does not show](../project/admin.md) is the text.

## What was built

### The store — [`src/store/pg-admin-feedback.ts`](../../src/store/pg-admin-feedback.ts)

A file of its own rather than a method on `pg-admin.ts`, whose header is a sustained argument that
it never returns a sentence — five paragraphs of which would become false the moment a `body` column
were selected in it.

**A report is `(owner_id, id)`, never `id`.** The primary key is composite because the id is minted
by a browser, and `tests/feedback-store.test.ts` already proves two readers may file under one id.
The first draft keyed the screenshot route on the id alone, which serves the wrong person's
screenshot — and the collision is *chosen*, not stumbled into. GPT Sol led its review with it.

**The projection is written out by hand**, not shared with `REPORT_COLUMNS`. Sharing it would make
every field added to a reader's own report cross owners the same day, with nothing to review. The
duplication is the fence; `tests/admin-feedback-store.test.ts` pins the exact key set.

**Keyset pagination on the whole sort key** (`created_at`, `owner_id`, `id`), not an offset: an
offset shifts under an inbox being written to while it is read, and the report this page exists to
find is precisely an old one nobody knew about. `hasMore` is *seen* — the store asks for one row
more than it returns — rather than inferred from `reports.length === limit`, which is wrong exactly
on a boundary.

> **The cursor's one real bug, found by a test written for something else.** `timestamptz` is
> microseconds; a JavaScript `Date` is milliseconds. Building the cursor from
> `createdAt.toISOString()` compared a rounded value against a precise one, so `created_at =
> <cursor>` matched nothing and paging stopped dead at the first row of any group sharing an
> instant. The fix carries a `to_char`-formatted exact timestamp for the cursor only — never on the
> wire report, so the key fence stays exact.

### The routes — [`src/routes.ts`](../../src/routes.ts)

- `GET /api/admin/feedback` → a page, with `?limit=` and `?before=`.
- `GET /api/admin/feedback/:ownerId/:id` → one report *with* its diagnostics.
- `GET /api/admin/feedback/:ownerId/:id/screenshot` → `image/png`.

All exact-matched, all behind the `/api/admin` namespace gate that sits above the route table, all
`private, no-store`. `isUuid` and `isSpideryarnId` are the rules; the route patterns are only
shapes. A malformed `?before=` is a **400**, not a silent restart from the top — that would hand
back page 1 while the reader pressed *Load older*.

### The page — [`AdminPage.tsx`](../../src/web/AdminPage.tsx), [`AdminFeedbackList.tsx`](../../src/web/AdminFeedbackList.tsx)

Cards, not a `DataTable`: the shelf and the users page are tables because their rows are numbers, and
*which report is longer* is not a question anybody has. Each card carries the body verbatim, the
kind (including an explicit **not specified**, because `null` is a real answer), the correlation
handles, and the mirror state **as words** — *mirrored*, *sent, not acknowledged*, *not sent* —
because a raw pair of timestamps hides the one state this page exists to surface.

Diagnostics and the screenshot are fetched only when opened. The allowlist permits ~179 KB of JSON
per report, so two hundred in one response is tens of megabytes over the platform's ceiling. The
screenshot goes through `apiFetch` → `blob()` → `createObjectURL`, because auth here is a Bearer
header and an `<img>` sends none; the fetch and the object URL's lifetime are **two effects**, after
the first draft's single effect revoked the URL it had just handed to state.

## Landing it: two features met in the same table

While this was being built, a peer collapsed `steps`/`expected`/`actual` into one `body` plus a
`kind` toggle ([260902m](260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md)) and landed
it on `dev`. Greg's call, 2026-09-02, was to target the shape that was landing rather than the one
on the trunk at the time, so the card renders one body and a kind chip. The merge itself is written
up in the commit; `src/owner.ts` turned out to be an **add/add** conflict where two agents had
independently invented `EVAL_OWNER_ID` with different uuids.

## The simpler options passed over

- **Read it in Sentry and build nothing.** It is what happened on the day, and it worked. Refused
  because it makes a best-effort mirror the system of record: a report Sentry rate-limited, dropped
  or never received is filed correctly and invisible, and there is no way to notice.
- **A script — `npx tsx scripts/feedback-ls.ts`.** Cheaper, and it cannot run: nothing on this box
  holds a production `DATABASE_URL`, which is the constraint that started this.
- **One `/admin/feedback/:id` detail page.** More addresses, and the card already fits the report.
- **The screenshot as a data URL in the list JSON.** One route instead of three, and it drags every
  PNG into a response nobody has asked to look at.
- **No pagination, just a cap.** Rejected by GPT Sol and rightly: an account-farming burst could
  make an older legitimate report — including the Sentry-missed one this page exists to find —
  unreachable.

## Checks

- `tests/admin-feedback-store.test.ts` — 12 cases: cross-owner reads, the shared-id collision, the
  exact-key fence, the total order walked by cursor, `hasMore` at the boundary, the filesystem
  refusal. The tie-break case was **watched red** with `desc(ownerId)` removed, and the cross-owner
  case with an owner filter added.
- `tests/routes.test.ts` — 403 for a non-admin on both new namespaces, 400 on either malformed half
  of the key and on a malformed cursor, 404 on a path with anything extra.
- `tests/router.test.ts`, `tests/page-title.test.ts` — the address parses, the tab is named, and
  `/admin/FEEDBACK` and `/admin/feedback/extra` still fall through to the shelf.

## Still to do

- **A browser pass** against the local stack with `SPIDERYARN_STORE=postgres`, and against
  production once deployed, where `spya-us5kzc` is the row that must appear.
- **An index matching the sort key** — `(created_at desc, owner_id, id)`. Not added here: it needs a
  migration, and at the current row count the sort is free. The moment the table is large enough for
  this page to feel slow, that is the fix.
- **The dialog's tick-box copy**, which implies the article is part of the *extra* diagnostics while
  the `slug` is sent regardless. Named in [admin.md](../project/admin.md); it belongs to whoever owns
  the dialog.

## Risks

- **The one that matters: a column added later that is neither account metadata nor part of the
  report the reader submitted.** The rule is written in three places and **nothing enforces it
  mechanically** — what the code does instead is refuse to make widening automatic.
- Reading is all this page does. Nothing resolves, deletes or replies — the same read-only posture
  as `/admin/users`, and the same reason: a page that can only look is a much smaller thing to get
  wrong.
