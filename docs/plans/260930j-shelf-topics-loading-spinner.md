# A spinner where the shelf's topics will be

Status: built and twice code-reviewed for dev. Report spya-a4xsg3 (Sentry SPIDERYARN-READING2-76), overseer queue qi-ysm9jwc6.

> On the logged in homepage, there's a delay while the topic-pills load. That's fine, but let's show
> some kind of loading spinner in their place while they're loading.
>
> — Greg, 2026-09-30, via the Feedback button on the signed-in shelf

## What happens now

The Topics row ([shelf-terms.md](../project/shelf-terms.md)) is drawn by `ShelfTerms` only once
`GET /api/library/terms` has answered: Library.tsx renders it under `total > 0 && terms.data`. Until
then there is nothing, and when the answer lands the row appears and pushes the count line and the
cards down by a row. `useShelfTerms` returns `data: null` both **before the first answer** and
**after a failure**, so the page cannot tell the two apart — and a failure is meant to draw nothing
(the hook's header: "a failed request means nothing is known, and the row is simply not drawn").

`git log origin/dev` has nothing on a loading state for the row (checked 2026-09-30).

## What changes

1. **`useShelfTerms` says when it is waiting.** `ShelfTermsState` gains `loading: boolean` — true
   when a question is being asked (`shelfKey !== null`) and no answer to *that* question has arrived
   (neither a body nor a failure). A failure stores an answer with `data: null`, so it is not
   loading, and the row stays undrawn as now.
2. ~~The archive's own wait counts too.~~ **Dropped after Sol's plan review (P2):** while the
   archived list loads, `ArchiveStatus` already draws *"Loading archived…"* in its own `mb-3` line;
   a spinner row under it would be two status rows, and the first vanishing would move the cards —
   the jump this plan exists to remove. So `loading` is only "the terms question is out"; with
   `shelfKey === null` there is no question, and the archive's line says the wait.
3. **A placeholder row in the row's place.** `ShelfTermsLoading` in ShelfTerms.tsx: the same
   `tw:mb-3` row wrapper, the same "Topics" label, and the app's one spinner —
   `<LoaderCircle className="cmt-spinner" size={13} />`
   ([icons.md § The loading spinner](../project/icons.md#the-loading-spinner)) — **with the words
   *"Loading topics…"* visible beside it** (Sol P3: icons.md says never a bare spinner), in a row
   held at `tw:min-h-7`, the height of one pill (`chipClass` is `tw:h-7`). `role="status"`,
   `aria-label="Loading topics"`. Library.tsx draws it under the same `total > 0` guard when
   `terms.data` is null and `loading` is true. The small-shelf line (*"Topics appear once…"*) gets
   the same `tw:min-h-7` (Sol P3), so it does not shrink the row when it replaces the spinner.

**What "nothing jumps" can and cannot promise.** ~~The placeholder reserves one row of pills.~~
**Revised after the browser check.** One row was wrong on a real shelf: with 21 articles the collapsed
row (twelve pills, "All N topics", "More detail") is 2 rows at 1000px and 6 at 400px, so the cards
still dropped 36px and 180px. Sol, consulted on the fork, advised against remembering the last
height in `localStorage` (it goes stale with the shelf, the window, rotation, zoom and fonts, and an
overestimate is a gap that collapses instead) and for **a placeholder with the row's shape**: on a
shelf of at least `MIN_WORKS` article rows, eleven faint outline pills of varied widths (≈50–130px,
mean ≈100px, as measured) after the spinner's slot, then "More detail" drawn invisibly at its real
width, all in the real row's `flex-wrap gap-x-2 gap-y-2`. The conditional "All N topics" control is
reserved only above `COLLAPSED_CHIPS` article rows, because the chooser cannot return more topics
than distinct works: more than twelve rows is necessary, though not sufficient, for that control.
It reflows at every width and needs no state. What remains is the labels' actual lengths and actual
topic count, a smaller residual either way. A shelf under `MIN_WORKS` gets the one-line placeholder,
the height of the line that will say "too few". The row can also answer "no topics" (settled, empty,
enough works) — then the page shrinks, the rare case.

The client knows only article rows before this answer; the distinct-work count is computed from
`textHash` by the terms route and is not part of `LibraryEntry`. A shelf with at least eight rows
but fewer than eight distinct works can therefore briefly get the outline reserve and then collapse
to the one-line "too few" answer. Removing that residual would mean exposing the server's work
identity earlier, beyond this small loading-state change; naming the prop `articleCount` keeps the
upper-bound estimate honest.

**Measured** (Playwright, the 21-article local shelf, terms delayed 5 s; how far the first element
after the row moved when the pills landed):

| Width | Placeholder | Landed | Shift |
|---|---|---|---|
| 1280px | 64px | 64px | 0 |
| 1000px | 64px | 64px | 0 |
| 768px | 100px | 100px | 0 |
| 400px | 172px | 208px | +36px (one row; was +180px with one row reserved) |

The 400px residual is these labels being longer than the mean; tuning widths to one shelf would
be fitting noise, so it stays.

It also shows when the question changes under a loaded row — a job finishing, the archive switched
on — since the hook deliberately drops yesterday's answer while the new one is in flight. Today the
row vanishes then; now it becomes the spinner, which is the same wait said out loud.

## Simpler option passed over

Rendering the placeholder whenever `terms.data` is null, with no new field. It would spin for ever
after a failed request, the thing
[silent-success.md](../reusable/silent-success.md) and icons.md both warn about, and it would spin
while a failed archive stops the question being asked at all.

## Tests (red first)

In `tests/shelf-topics.test.tsx`, with the terms answer held open:

- the row shows `role="status"` "Loading topics" with a spinner and the "Topics" label, and no chips;
- once released, the status is gone and the chips are there;
- a failed request draws neither the spinner nor chips (extends the existing failure test);
- switching the Archived chip on shows the spinner while the widened answer is held;
- the outline reserve omits "All N topics" at 8–12 article rows and includes it only when more than
  twelve article rows make that control possible.

## Done

Tests and typecheck green; a browser check of the shelf with a slow terms response; shelf-terms.md
says what the row shows while it loads; the note in `docs/user-feedback/`.
