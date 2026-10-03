# The Earlier tab's pills say how many

[SPIDERYARN-READING2-95](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-95), report
`spya-yj2vdr`, 2026-10-01 18:31 UTC, `kind=suggestion`, from Greg (admin — `feedback-reporter.ts`
exit 0), build `43be719b`.

> In Feedback / Earlier / Not shipped, it says at the bottom "Showing your 50 most recent."
>
> Is that true? Are there >50 not shipped?
>
> Perhaps include a number/badge in the tab-pills for Shipped and Not shipped?
>
> — Greg, 2026-10-01

Builds on [260930e](260930e-earlier-tab-filters-by-done-from-the-notes.md) (the filter) and
[261001c](261001c-earlier-tab-marks-not-shipped-too.md) (Not shipped in All).

## Was it true? Yes

The line is printed only when the store found a 51st row **after** the filter
(`listMine` reads `limit + 1`, `more: rows.length > limit`, src/store/pg-feedback.ts), so it cannot
be shown for a filter with 50 or fewer. Checked against production, read-only, on 2026-10-03: every
one of the 345 feedback rows is Greg's. Under the shipped map compiled into build `43be719b`, 230
of them were shipped and **115 were not**. Under the map on `main` today it is 305 and 40, so the
line no longer appears in Not shipped. "Not shipped" falls as notes ship; nothing was wrong.

(Those 345 are today's rows. On 2026-10-01 there were fewer, but the rows filed since then are
the newest and so were the least likely to be shipped. The 115 is close, and above 50 either way.)

## The change

1. **A count on each pill.** `All 345 · Shipped 305 · Not shipped 40`, the number in a quieter
   `.fb-show-count` span inside the button. All gets one too: three pills with two numbers would
   read as though All had no number to give, and its number is what the other two add up to.
2. **The cap line names the total.** `Showing the 50 most recent of your 45 not-shipped reports.`
   (`reports` / `shipped reports` / `not-shipped reports` by filter.) That answers "is that true?"
   on the screen itself, without anyone having to take it on trust.

### Where the numbers come from

`listMine(limit, countIds, filter?)` now also returns `counts: { all, in }`: `count(*)` and
`count(*) filter (where id = any(countIds))` over the owner's rows, **in the same read-only
`repeatable read` transaction as the list**, so the list and its counts are one moment. Run
separately, a report filed between the two queries could make the screen say "50 most recent of
50". The route passes `shippedFeedbackIds()` (the same ids the filter narrows by) and adds
`counts: { all, shipped: in, unshipped: all - in }` to **every** `EarlierFeedbackPage`,
whatever `?show=` asked for. So the first read of an opening (All) is enough to label all three
pills.

The client labels the pills from **the showing filter's own answer** once it has one, and from any
other answer in the opening until then. The counts are forgotten when the dialog shuts, like the
lists. An older answer never outvotes the one on screen, even if a deploy between two reads
changed the shipped map. The client's shape check refuses counts that do not add up
(`all ≠ shipped + unshipped`), or that disagree with the list they came with (`more` must mean
the count is larger than the list; no `more` means they are equal).

`unshipped` is `all - in`, not a third count. That is the same set the `out` filter returns,
because the filter is `not (id = any(ids))` over the same owner's rows and an id is never null.

Before any answer arrives, or after a failed one, the pills carry no number. A pill never shows
a guess.

### The simpler option passed over

**Counting in the client over the 50 it holds.** That needs no server change, but the numbers would
be wrong in exactly the case Greg asked about, with more than 50 in a filter. Also passed over:
**counts only on Shipped and Not shipped**, as Greg worded it. It is one word fewer, but a bare All
looks like a missing number (above).

### Changed by the plan review

[GPT Sol](261003b-earlier-tab-counts-on-the-pills-plan-review-sol.md): REVISE, and all four were
taken. One snapshot for the list and its counts (it was two pool reads). The showing answer's
counts win over the first answer's. The shape check enforces the sums and agreement with `more`.
The cap line names its noun.

### Deferred

Paging past 50. 260930e's reasoning still holds: a reader with that many is the administrator, who
has `/admin/feedback`.

## Tests

- `tests/feedback-store.test.ts`: `listMine`'s counts are of the owner's rows only, are uncapped
  and unfiltered, `in` follows the ids given (an empty list too), and `all - in` is what the `out`
  filter lists.
- `tests/feedback-route.test.ts`: every `?show=` answer carries `counts`, computed from the
  shipped ids, owner-scoped. A mutation (`unshipped: all`) turned both new tests red.
- `tests/feedback-dialog.test.tsx`: the pills show their numbers once an answer lands and none
  before; the showing filter's answer labels them when answers differ; the cap line reads
  `of your N …` for the filter showing; five malformed counts are refused.
- Browser (Sonnet, Playwright, local, dark theme, 1100px and 375px): `All 20 · Shipped 0 ·
  Not shipped 20`, rows matching, no wrap or overflow, no console errors. That ran on the
  pre-review build; the review changed the store's internals and the copy, not the pills.
