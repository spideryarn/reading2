# The Earlier tab shows the page each report was filed from

Report `spya-y4upzw`, Overseer queue item `qi-dykpdksc`. Up: [plans.md](../project/plans.md).

> Can you ensure that when I provide feedback using this Feedback dialog that it includes the URL
> of the page that I was on as metadata.
>
> — Greg, 2026-10-01, filed from `/admin/vouchers`

## What is already true

The report has carried the page address since commit `7a590fe58` (2026-09-02, *"A bug report says
where you were by naming the address, not by picking from a list"*). Checked on 2026-10-03, surface
by surface:

| Where | Carries the address? | Evidence |
|---|---|---|
| The browser's POST | yes: `location.href`, read when the dialog opens | `FeedbackHost` in `src/web/FeedbackButton.tsx` |
| The production row | yes: 367 of 368 rows | read-only query, 2026-10-03; the one `null` is `spya-us5kzc`, the first report ever, filed 2026-09-02 15:22 before that commit deployed. This report's own row holds `https://www.spideryarn.com/admin/vouchers` |
| Sentry | yes: the `url` tag, on every event | `tagsFor` in `src/feedback.ts` |
| `/admin/feedback` | yes: printed on each card | `src/web/AdminFeedbackList.tsx` |
| The email to the admin | yes: a `Page:` line | `pageLine` in `src/feedback-notice.ts` |
| The brief an agent is given | yes: `url:` | `scripts/feedback-reporter.ts` output, as in this report's own brief |
| The copy-to-email fallback | yes: `Page:` | `asPlainText` in `src/web/FeedbackDialog.tsx` |
| **The dialog's Earlier tab** | **no** | `EarlierFeedback` in `src/types.ts` leaves it out on purpose |
| A page with no address sent | none found | every page that has a Feedback button is under the one `FeedbackHost`; signed-out pages have no button at all |

So the request was already met, and the only place a person filing a report cannot see that is the
dialog itself. The Write tab says nothing (the hover card on the button does), and the Earlier tab
lists each report without where it was filed.

## What this builds

Each row on the Earlier tab says which page the report was filed from:

```
2 days ago · Suggestion · on /admin/vouchers · Not shipped
Can you ensure that when I provide feedback…
```

That is the reader's proof that the address was recorded, and it is useful on its own: "which
article was I on when I said that".

### Why it was left out, and what stays of that

`EarlierFeedback` kept the address back for two reasons: the list "has no use for it", and the
address "can carry the reader's own search terms or a credential in an `/add/` URL". The first is
what Greg's report disagrees with. The second still holds, so the response does **not** carry the
address. It carries a **page label**, made on the server:

- the path only: no origin, no query string, no fragment (search terms and `?mode=` live there);
- **only a path the app's own router recognises** (`parseRoute`); anything else is `null`. Added
  after GPT Sol's plan review: a signed-in reader can file from any address, mistyped or pasted, and
  the route accepts any `http(s)` origin, so an unrecognised path is arbitrary text;
- an import becomes just `/add` (what follows is a third-party URL or an upload id);
- no length cap, because every recognised path is short (a slug is at most 60 characters);
- `null` when the stored value is `null` or does not parse as an `http(s)` address.

What it still carries, knowingly, is an article's slug in `/read/<slug>`: validated, and already the
name the reader sees in their own address bar.

One pure function, `feedbackPageLabel(url)`, in a new `src/feedback-page.ts`. The store calls it
inside `listMine`, so the raw address is selected but never leaves the store: `MyFeedback` gains
`page`, not `url`. The route goes on picking fields by name and adds `page` to the pick. The client
validator requires `page` to be a string or `null`, and the row prints it as text, not as a link.

### The simpler option passed over

**Send the whole stored URL and trim it in the browser.** One fewer file, but the response would
then carry exactly what the type's comment says it must not, and the trim would be a display rule
rather than a boundary.

**End Shipped with no code.** Also honest, since the request was met a month ago. Passed over
because the author of the request could not tell, and the next reader cannot either.

## Deferred, by name

- **A link rather than text.** The label is not the full address, so a link would go to the page
  without its mode or position. Text first.
- **A line on the Write tab saying the address goes.** Greg has twice taken a sentence out of that
  tab (2026-09-05, 2026-09-30); the hover card and `/privacy` already say it. Not added.
- **The mode (`?mode=`) in the label.** It is in the query string, which the label drops whole
  rather than parsing an allowlist out of it.

## Tests (each seen red first)

1. `feedbackPageLabel`: an article path, `/read/<slug>/metadata`, a query and fragment dropped,
   `/add/https://example.com/?token=…` → `/add`, `/add/upload/<uuid>` → `/add`, `null`, not a URL,
   `javascript:`, and `null` for a path the router does not have, on any origin.
2. Store (`tests/feedback-store.test.ts`): `listMine` returns `page` for a row with a URL, `/add`
   for an import URL, `null` for a `null` URL, and no `url` key.
3. Route (`tests/feedback-route.test.ts`): the answer carries `page`; a store that hands back a
   `url` field too still sends none.
4. Dialog (`tests/feedback-dialog.test.tsx`): the row prints the page; a `null` page prints nothing
   extra; a response whose row has no `page` is the failed state, not a list.
5. `FeedbackHost` sends the address in force when the dialog is opened, after an in-app navigation
   — the property the whole table above rests on, and not pinned today if no test covers it.

## Docs

`docs/project/feedback.md` § the Earlier tab (four fields → five, and the label rule), the comments
on `EarlierFeedback`, `listMine` in `src/store/contracts.ts`, and the route. `/help` says the tab
shows the page. `privacy.md` does not describe the Earlier tab, so it is unchanged.

## GPT Sol's plan review, and what was done with it

[The review](261003g-earlier-tab-shows-the-page-each-report-was-filed-from-plan-review-sol.md).

- **P1, a path can be arbitrary text. Accepted and fixed**: the label is now only for a path
  `parseRoute` recognises, above.
- **P2, the address is the one in force when the dialog opened, not when Send was pressed.** True,
  and kept: "the page I was on" is the page the box was opened on, and the dialog is modal, so the
  address changing underneath it is rare. `FeedbackHost` reads `location.href` at render and opening
  is a render. Test 5 pins exactly that instant.
- **P2, test 5 cannot go red from this feature.** Right that it is not a test of the feature. It is
  a pin on the property the table rests on, and it was seen red by holding the address in a
  `useState` initialiser, which is the regression it exists for.
- **The application log carries the full address** (`"feedback report accepted"` in
  `src/routes.ts`). Not changed here. Logging `url` is a recorded decision
  (`src/log-redaction.ts`: "an article URL is the single most useful field when a fetch fails, and
  this is a one-reader beta"), and its premise has gone stale since readers arrived on 2026-09-03.
  That is Greg's call and wider than this report; it is raised in the feedback note.
- Sol's overall view: the request was already met by `7a590fe58`, and the Earlier label is a
  separate improvement rather than the missing implementation. Agreed, and the note says so.
