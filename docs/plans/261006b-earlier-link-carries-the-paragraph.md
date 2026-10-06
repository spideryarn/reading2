# The Earlier tab's link also carries the paragraph

Up: [plans.md](../project/plans.md)

Queue item `qi-hwkfga7y`. It finishes the question
[261005m](261005m-earlier-tab-links-the-page-and-marginalia-tips-say-what-to-press.md) left open.

## What Greg chose

In the Feedback dialog's Earlier tab, each report says *on /read/some-slug*, and that text is a
link to the article. 261005m asked whether the link should also open at the paragraph the report
was filed from, and Greg answered on 2026-10-06:

> B whatever's simplest

B is: the link carries the paragraph (`?at=spya-…`), and nothing else from the address the report
was filed at.

## Background

- A report's stored address is the whole URL the reader was on, for example
  `https://www.spideryarn.com/read/why-trees?mode=search&q=private+words&at=spya-k3m9qt`.
- The reader's own Earlier tab is never sent that address, because the query string can hold
  search terms. It is sent a **label** made on the server: the path only
  (`src/feedback-page.ts` § `feedbackPageLabel`).
- `at` is the reading position: the id of the first block of the section in view
  ([url-state.md](../project/url-state.md)). A block id has one fixed shape, `spya-` and six
  characters from a set alphabet, checked by `isSpideryarnId` in `src/ids.ts`. So an `at` that
  passes that check cannot hold anybody's words.

## The change

One stage.

**Server** (`src/feedback-page.ts`): a second function, `feedbackPageAt(url)`, beside the label.
It returns the block id, or `null`. It returns an id only when all of these hold:

- the label is an article's reading page, `/read/<slug>`: not `/read/<slug>/metadata`, not the
  public shelf `/read/public`, not any other page, since `at` means something only on the reading
  page;
- the stored address has an `at` parameter (the first one, if it is repeated);
- its value passes `isSpideryarnId`.

Anything else is `null`: no `at`, an empty one, a wrong shape, an unparseable address.

**Wire** (`src/types.ts` § `EarlierFeedback`): a new field `at: string | null` beside `page`.
`listMine` in `src/store/pg-feedback.ts` fills it and `GET /api/feedback` passes it on. The label
`page` is unchanged, and is still what the row shows as text.

**Client** (`src/web/FeedbackEarlier.tsx`): the link's `href` is `page` when `at` is null and
`` `${page}?at=${at}` `` otherwise. The visible text stays the path. The validator refuses an
answer whose `at` is present and is not a block id, or is present on a row with no `page`: the
same second line the path has. A row with no `at` field at all (an older server still answering
a newer tab during a rollback) reads as `at: null`, the way a missing `page` already does.

**A reader already on that page at that paragraph stays where they are** (added after the plan
review, P1-F1 below). An ordinary click closes the dialog and does nothing else when the address
bar's path is the row's `page` and its `at` is the row's `at`. Without this, the app's `navigate`
scrolls to the top, and the reading view moves to `?at=` only when its value changes, so the link
would lose the very place it names.

The server does not check that the block still exists in the article. A stale id already degrades
to the top of the article ([block-ids.md](../project/block-ids.md)), and looking it up would be a
second query per row for no gain.

## What it gives up

The mode and everything else in the query is still dropped. The link opens the article at the
paragraph in the reader's default view, not in the mode the report was filed from.

## Passed over

- **Passing the whole query through an allow-list of safe parameters.** More would be restored
  (the mode), but each parameter needs its own argument for why it cannot hold private text, and
  Greg asked for the simplest.
- **One `href` field built on the server** instead of `at` beside `page`. It could be checked
  as strictly, but only by parsing a second URL in the client; keeping `at` separate lets the
  client use `isSpideryarnId` on it directly.

## Tests, red first

- `tests/feedback-page.test.ts`: `feedbackPageAt` returns the id for a reading page; `null` for no
  `at`, an empty `at`, a wrong-shaped one (too long, upper case, a path, a script), a metadata
  page, the public shelf, a fixed page, `/add`, an unrecognised path, a non-http address and
  `null`; the first of a repeated `at`; and never anything from `q=` or the fragment.
- `tests/feedback-store.test.ts`: `listMine` returns `at` for a report filed with one, and `null`
  without. The key list of a row gains `at`.
- `tests/feedback-dialog.test.tsx`: the `href` carries `?at=<id>` and the text does not; a row with
  `at: null` links to the bare path; a missing `at` field reads as null; a bad `at` fails the whole
  answer; an `at` with a null `page` fails it.
- `tests/feedback-route.test.ts`: the exact answer of `GET /api/feedback` gains `at`, with the
  fake store's row still carrying private extras, so the route is still seen to pick its fields.
- `tests/feedback-dialog.test.tsx` again: already on that page at that paragraph, a click closes
  the dialog and navigates nowhere; from another paragraph, no paragraph or another article it
  still follows the link.

## Docs

[feedback.md](../project/feedback.md) § the Earlier tab: the paragraph that says the link goes
"to the page, not to the paragraph" changes to say it carries the paragraph and nothing else.
The comments in `src/feedback-page.ts`, `src/types.ts` and `FeedbackEarlier.tsx` that say the same.

## Done looks like

`npm test` and `npm run typecheck` green; GPT Sol's code review read and its fixes checked; a
browser check at desktop, iPad and phone widths that the link opens the article at the paragraph.

## GPT Sol's plan review

Read-only, 2026-10-06:
[the answer](261006b-earlier-link-carries-the-paragraph-review-sol.md). Three findings, verdict
*revise before building*. It agreed the privacy and same-site statement holds, that the old and
new builds read each other's answers, and that leaving out the public shelf and Metadata is right.

- **P1-F1, a link to the paragraph you are already at lands at the top** (P1, established with a
  DOM probe). Taken, with a smaller fix than the one it proposed. It suggested scrolling to the
  block after navigating. Instead the click does not navigate at all when the reader is already
  on that page at that paragraph: fewer parts, and the reader's exact spot inside the section is
  kept, where a scroll to the block would move them to the section's start.
- **P1-F2, the plan named the wrong route test file** (P2). Taken; the bullet above is corrected.
- **P1-F3, the reason given for passing over a server-built `href` was false** (P3). Taken; reworded.

## What landed

One stage, as planned, plus the stay-put rule from P1-F1.

- Every new test was seen red before the code: 31 across the four files, then the stay-put test
  on its own (`navigate` was called once).
- Nine mutants, one guard removed at a time, and a test failed for each: the server accepting any
  `at`; any page keeping it; the public shelf keeping it; the last repeated `at` winning; the
  client not checking `at`; the client allowing `at` with no page; the `href` dropping `at`; a
  missing `at` not read as null; the route not passing `at` on.
