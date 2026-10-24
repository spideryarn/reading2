# Admin commands in the command bar, and an author gift without leaving the article

Report `spya-v88mga` (#683), Greg as admin, 2026-10-23, reading `effective-expressiveness-spya-z8dehh`:

> I'm an admin, and I'm reading an article, and I'm wondering if this would be a good author to tell
> about Spidey on. And I know we've built a bunch of machinery for gift vouchers and sending authors
> private links and stuff like that. And I was hoping to be able to somehow access it, you know, from
> the command bar or whatever. I guess this might be a bit complicated because it's something that
> would only be available to admins. So maybe that would require us to have a kind of admin-specific
> set of functionality that would only be included in the command bar for admins. Probably it would
> just open up the relevant page in /admin. But do a review of all the functionality we might want to
> include that's admin-specific and add it to the command bar. And if there's a way to do this
> without leaving the article, that would be even better.

He asked us to proceed (an admin report with the review left to us), so this plan decides rather
than asks.

## What exists

- **The command bar** (`src/web/CommandBar.tsx`) is mounted by the Dock for the article's owner, on
  the reading view and the Metadata page. Its non-mode rows are `besideTheModes`, then
  `experimentalRows` and `appearanceRows`. **Admin rows were left out on purpose in 260908e**
  (*"Admin and Design, which would need an admin check the bar has never had, for two rows one
  person can use"*). Greg now asks for them, so that paragraph changes.
- **The author gift** is `POST /api/admin/author-gifts` `{ slug, rightsConfirmed: true, highPower? }`:
  makes the private link if needed, saves a draft, queues the main modes (Opus first if asked), and
  starts the web lookup. `200` means the article already has a gift. Nothing is emailed until *Send*
  on `/admin/vouchers` → Drafts. The client hook `useAdminAuthorGifts` (list, `ensure`, a poll while
  a lookup runs) is what the Drafts tab uses. Today it is reachable from the add page (while
  importing) and from `/admin/vouchers` → Give, with the box ticked.
- **The gate is the server's**: everything under `/api/admin` is a 403 for anybody but
  `ADMIN_USER_IDS` (`src/routes.ts`, tested in `tests/routes.test.ts` and
  `tests/author-gifts.test.ts`). Client-side `isAdmin` checks are courtesies
  (admin.md § The three refusals).

## The review: which admin functions belong in the bar

| Admin function | In the bar? | Why |
|---|---|---|
| **Author gift for this article** | **Yes — an action that opens a small dialog over the article** | What Greg asked for, and the one admin task that starts *from* an article |
| **What it cost** (Metadata's admin-only section) | **Yes — a page row to Metadata `?section=what-it-cost`** | About this article; Metadata's own row list says "not *What it cost*, which is an administrator's" |
| `/admin` index, Users, Feedback, Gift vouchers, Articles, Costs | **Yes — six page rows** | Navigation he would otherwise click through the shelf for |
| `/design` | **Yes — one page row** | Also admin-only (`ADMIN_ONLY`), and was named alongside Admin in 260908e |
| View as a reader | No | Needs a person and a reason; it starts from `/admin/users`, which is a row |
| Move this article to another account | No | Needs a target account; `/admin/articles` is a row |
| Send / edit a draft gift | No | That review belongs on the Drafts card, where the exact email is shown |

All of them are **typed-only** (`typedOnly: true`), so the list an empty bar opens on does not grow;
typing `admin`, `gift`, `author`, `users`, `costs` brings them up.

## What we will build

### D1. One module of admin rows, built only for the administrator

`src/web/admin-commands.ts` holds the words (labels, descriptions, aliases) and a function
`adminRows({ article, openAuthorGift })` returning `Command[]`. `CommandBar` calls it only when
**`isAdmin(session user id) && viewAsNonce() === null`** — under *view as* the bar is a reader's
and must not offer admin writes. The rows go after `besideTheModes` and before the experimental and
appearance rows, so on a tie the page's own rows win.

- The article rows (gift, cost) only when `article` is present; the page rows always.
- The gift row only where the bar is open over the reading view or Metadata page of an article the
  server already answered as the reader's own (the Dock mounts the bar only for the owner, and the
  route refuses anybody else's article with 400).
- `generates`: the gift row is `true` (it queues the main modes and a paid lookup); page rows `false`.

**Not in the command-pick catalogue.** `tests/command-pick-catalogue.test.ts` builds the catalogue
from `besideTheModes` and friends; `adminRows` is not one of them, so the sentence-picking model is
never shown admin rows and the server drops their keys (`knownOptions`). The picker serves readers;
one person typing `gift` does not need it, and it keeps the eval's slices unchanged.

### D2. The gift without leaving the article: a dialog the bar opens

Enter on **Gift this to its author** closes the bar and opens `AuthorGiftDialog` — a native
`<dialog>` like FeedbackDialog — over the page. **Lazy-loaded** (`React.lazy`) so no reader
downloads it, the same reason the admin pages are lazy (admin.md, 260905i). It is mounted by
`CommandBar`, which is always mounted while the Dock is, so no prop threading.

The dialog uses `useAdminAuthorGifts()` and finds this article's gift by `starter.slug`:

- **Loading** — one line.
- **A gift exists** — its status (*draft*, *sending*, *sent*, *discarded*), the lookup's progress
  while it runs (the hook already polls), and **Open it in Gift vouchers** (`/admin/vouchers?gift=<id>`,
  a new tab, so the article stays put).
- **No gift** — the same four lines the add page shows (`AUTHOR_GIFT_AT_ADD_STEPS`, reworded from
  "when the import finishes" to fit), the rights tick-box (`SHARING_RIGHTS_CONFIRM`), the
  *High-powered AI* box ticked by default (as the Give form), and **Draft a gift for the author**,
  disabled until the rights box is ticked. Pressing it calls `ensure(slug, { highPower })`. Created
  or existing, the dialog shows the gift state above; refused, the server's own words.
- **Read failed** — the server's words and a Retry.

Nothing is sent to the author from here: Send stays on the Drafts card, beside the exact email.

### D3. Docs

- `reading-view-overview.md` § The command bar: a paragraph on admin rows.
- `admin.md`: a line in the author-gift section and the three-refusals table (the bar's rows are a
  courtesy; the gate is unchanged).
- `marketing-author-gifts.md`: one line, the third door.
- CommandBar.tsx's header paragraph that said Admin and Design are left out.

## Tests

- `tests/admin-commands.test.ts`: no admin rows for a non-admin or under view-as; the rows and ids
  for the admin; every page row's href is on `ADMIN_ONLY` or Metadata; no label or alias parses as
  an argument (the collision matrix's rule); the gift row only with an article.
- `tests/author-gift-dialog.test.tsx`: mounts the dialog over a mocked `fetch` — the draft form is
  disabled until the rights box is ticked; Draft POSTs `{ slug, rightsConfirmed: true, highPower: true }`
  to `/api/admin/author-gifts`; an existing gift shows its status and link without posting; a refusal
  shows the server's words.
- `tests/command-bar.test.tsx`: the bar opened as the admin finds *Gift this to its author* for
  `gift`, and Enter opens the dialog; as a reader, `gift` finds nothing admin.
- The server gate is already covered (403 on `/api/admin/author-gifts` for a non-admin).

## The simpler option passed over

**Every row a link into `/admin`**, the gift row going to `/admin/vouchers` with the article
pre-chosen and the box ticked. Smaller (no dialog), and Greg guessed that is what it would be. Passed
over because he said doing it without leaving the article would be better, and the dialog reuses the
hook, the steps, the rights wording and the server route already built, so the extra is one
component. The page link is still offered from inside the dialog for the review that follows.

## Risks

- **A press that spends**: drafting queues main modes (Opus by default) and a paid lookup. The
  rights tick and an explicit Draft button stand between the bar's Enter and that spend, as on the
  add page. The bar row itself only opens the dialog.
- **The client check is a courtesy**: a non-admin who forced the dialog open would get 403s from
  every request it makes.

## After GPT Sol's plan review

[261024n-admin-commands-plan-review-sol.md](261024n-admin-commands-plan-review-sol.md). All six kept.

- **F1** — `what-it-cost` was not an accepted `?section=` value (`METADATA_SECTIONS`), and a page row
  would skip the in-place reveal on Metadata. *What it cost* becomes an **action through
  `goToSection`**, as the other section rows are, and `what-it-cost` joins `METADATA_SECTIONS`. For
  anybody but the administrator the section is not drawn, so the value does nothing, as any unknown
  section would.
- **F2** — the gift row only opens the dialog: `generates: false`, `opensOnly: true`. The Draft
  button inside it is what spends.
- **F3** — the dialog (and so its `GET /api/admin/author-gifts` and poll) is rendered only after the
  first press, and stays mounted after. A reader, *view as*, and an administrator who never pressed
  it make no request.
- **F4** — the keys sent to the sentence picker, and the signature, are built from the rows
  **without** the admin ones, so the catalogue's claim (every row the picker can be sent) stays true.
- **F5** — the four lines say *up to three searches*; the limit is five. Fixed at its source by
  deriving the number from `AUTHOR_LOOKUP_MAX_SEARCHES`, in the add page's lines and the Give form.
- **F6** — tests added for a failed first read then Retry, High-powered AI unticked
  (`highPower: false`), and a created gift whose refresh fails without a second POST.

## After GPT Sol's code review

[261024n-admin-commands-code-review-sol.md](261024n-admin-commands-code-review-sol.md) (exit 0).
Sol fixed F1–F5 inside the stage; I read its diff and re-ran the suites and typecheck.

- **F1, kept.** A press now captures its slug; a route change unmounts the dialog rather than
  retargeting it, and the loaded component is cached so a second press keeps state.
  Postmortem [261024d](../postmortems/261024d-an-asynchronous-intent-without-its-target-adopts-the-next-render-s-target.md).
- **F2, kept.** A ref latch stops a same-tick double submit sending two POSTs (the server's
  idempotency already stopped two gifts). Postmortem
  [261024c](../postmortems/261024c-a-disabled-button-does-not-close-the-same-tick-submit-gap.md).
- **F3, kept.** `tests/eager-client-graph.test.ts` now also asserts that every derived lazy root is
  named in `ROUTE_PRIVATE`. Postmortem
  [261024b](../postmortems/261024b-a-one-way-calibration-check-cannot-prove-every-derived-root-is-named.md).
- **F4, F5, kept.** The Feedback-precedence test mounts `FeedbackHost`; admin.md and
  `article-commands.ts` no longer say every destination is under `/api/admin` (`/design` is the
  data-free exception).
- **F6, not changed.** The Give form on /admin/vouchers has the same same-tick gap; it is
  pre-existing and the server's idempotency keeps it harmless.

Also from the full suite: the eager card `AddAuthorGift.tsx` must not import
`src/admin-author-gifts.ts` (an admin-route module), so its "5" is written out and
`tests/add-page-author-gift.test.tsx` holds it to `AUTHOR_LOOKUP_MAX_SEARCHES`; and
`useVisualViewport.ts` joins `SHARED_WITH_READER`, at no cost to the reader.

**Browser check** (Sonnet subagent, Playwright on the box): gift dialog opens after the bar shuts with
focus inside, rights gate and High-powered default right, Escape and a second press work, *What it
cost* lands in place, a non-admin sees none of the rows, no console errors, fits at 390px. One miss:
"admin costs" found nothing, because `›` in the label is not typeable. Each `Admin › …` row now has an
`admin …` alias, with a test seen red first.
