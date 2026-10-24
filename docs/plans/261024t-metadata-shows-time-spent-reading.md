# The Metadata page says how long you have spent reading the article

Report #702, `spya-db7w6f`, Greg as admin, 2026-10-24, on `arxiv-2308-08708-spya-xax6v4`:

> In that metadata section for an article, can you provide an estimate of the amount of time spent
> reading the article by the user?
>
> — Greg, 2026-10-24 (spya-db7w6f)

## What is already there

Every owner's reading time is recorded per block, as running totals in `spideryarn.reading_time`,
and read back by `GET /api/reading-time/:slug` (owner-scoped, `viewAs: "read"`) —
[reading-time.md](../project/reading-time.md). The spine and the gutter draw it; the gutter's card
says the time for one passage. Nothing says the total.

## What changes

One row in the Metadata page's **Your reading** card, under *Where you left off*:

```
 ⏱  TIME SPENT READING                        about 14 min
                       counted while the article was on your screen and you were active
```

- The value is the sum of every stored block's seconds, said with `reading-time.ts § spentWords`
  (the same words the gutter card uses), prefixed "about" because it is an estimate. Zero or
  nothing stored says "None recorded yet." A failed read says it could not be read; loading says
  "Checking…".
- **Every stored block counts**, front matter and blocks a re-read has since retired included: the
  question is how long you spent reading this article, not how much of today's body you covered.
- **The read waits for any reading-time write still in flight** (`waitForReadingTimeWrites`, shared
  inside `useReadingTime.ts`). Stepping from the reader to Metadata unmounts the reader, whose
  cleanup sends its last seconds; without the wait the page's GET could overtake that POST and show a
  total up to a minute short.
- A small hook, `useTimeSpentReading(slug)`, beside `useReadingTime` in `useReadingTime.ts`, shaped
  like `ArticleCost.tsx § useArticleCost` (state tagged with its slug, a `live` flag).

## Who sees it

**Owner only, by where it is mounted**: `Metadata` is rendered only for the owner
(`ArticlePage.tsx`); a visitor gets `PublicMetadataPage`, which is not touched, and the route is
owner-scoped regardless. **Viewing as another reader, it reads nothing** and says so, as
`useReadingTime` draws nothing on the spine then: the route would allow the GET, but an
administrator has never been shown a subject's reading time, and a feedback report is not the place
to start (GPT Sol's plan review, F1). No new data is stored, sent or logged, and nothing new goes to a model,
so `/privacy` needs no change.

**Offline it fails rather than showing an old total**: `/api/reading-time/` is not in the offline
cache's `CACHEABLE` (`src/web/lib/api.ts`), and must stay out (F2). StrictMode's discarded first
mount stops after the wait, before its GET (F3).

## Passed over

- **Also showing the share read** ("about a quarter of it", `reading-so-far.ts`) — cheap, but not
  what was asked, and a second number invites the question of how the two relate. Easy to add later.
- **Putting the total in the masthead or the read-time card** — the report names the metadata page,
  and the masthead is seen by visitors too.
- **A server-side total route** — the per-block GET already exists and is small; summing it in the
  browser adds no route.

## Tests

`tests/metadata-time-spent-reading.test.tsx` renders the page: a total summed across a retired
block, nothing stored, a failed read, and view-as reading nothing. It also walks from a recording
reader to Metadata with the cleanup POST held, proving that the total's GET waits and includes those
last seconds. `tests/use-reading-time.test.tsx` separately pins the same ordering for a second reader
mount.
