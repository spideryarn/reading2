# The shelf's add box and search box look like different things

Report: #564 `spya-zh5f23` (SPIDERYARN-READING2-HD), an admin's suggestion, provenance proved
(`feedback-reporter.ts`, exit 0). Note:
[261011_0147-shelf-add-box-and-search-box-look-different.md](../user-feedback/261011_0147-shelf-add-box-and-search-box-look-different.md).

> In the logged in homepage, we have two text input boxes near the top, one for adding a URL and one
> for searching the shelf. Users keep confusing them, so I wonder if we can do something in the UI
> to make them more distinct. For example, can we narrow the search box and perhaps right align it
> with a search icon somewhere?
>
> And then I don't know how to make the add input box look more like an add, maybe an upload icon
> somehow, maybe make it narrower and left aligned. I did consider making the add kind of default
> collapsed with some kind of clear upload label there, but maybe that's too extreme a solution
> because then it'll be confusing for how to add new articles.
>
> — Greg, 2026-10-11

## What is there now

Both are full-width text boxes of about the same height, one above the other, at the top of the
shelf (`src/web/AddArticle.tsx`, `SearchBox` in `src/web/Library.tsx`). The add box sits in a card
under a small grey *+ Add an article*; the search box has a magnifier inside it. At a glance they
are two long empty fields. **And the search box takes the cursor on arrival** on a desktop
(`takesFocusOnArrival`, plan 260929g), so a reader who arrives and pastes a link pastes it into the
search, which then quietly finds nothing.

## What we do

Greg's two suggestions, plus one catch for the mistake itself. No collapsed add box — he called it
too far, and it would hide the main thing the page is for.

1. **The search box: narrower, right-aligned.** `width: min(24rem, 100% - 2rem)` and pushed to the
   right of the shelf column, so on a phone, where 24rem is wider than the column, it still keeps a
   2rem step on the left (GPT Sol's change: a plain `max-width` left the two boxes the same shape at
   320 and 390). The magnifier stays inside on the left. Placeholder becomes *Search your shelf: titles,
   authors, text*, so its words say which shelf-side job it does.
2. **The add box: narrower, left-aligned, and it says *add*.** The card gets `max-width: 42rem`
   on the left of the column, so the two boxes no longer line up edge to edge. The heading *Add an
   article* (kept word for word: Help and its picture name it) moves from 12px grey to 14px in the
   foreground colour, with Lucide `BookPlus` (an add onto the shelf) instead of the bare `+`. The URL
   field gets a leading `Link` icon inside it, the way the search box has its magnifier — so the two
   fields begin with different pictures, a link and a magnifier — and its placeholder becomes
   *Paste a link, e.g. example.com/an-essay*. The `Upload` icon Greg mentioned is already on the
   **File** button beside it; putting it on the URL field too would say "upload" about a box that
   takes an address, so the link icon stands in for it.
3. **A link pasted into the search box is offered to the add box.** When the whole query is one
   token that `slugFromUrl` accepts — the add box's own rule, so it never offers what Add would
   refuse (GPT Sol) — and carries a scheme or a path, so that `nature.com` stays a search, a line appears under the search box: *That's a link. Add it
   to your shelf?* with an **Add it** button that goes to `/add/<url>` — the same `addHref` the Add
   button uses, so it is the same act, admission and billing included, and only on a press. And the
   other way: the add box's existing *That doesn't look like a URL yet.* gains *To search your
   shelf, use the search box below.*, so a reader typing words into the wrong box is told where the
   right one is.

### What this deliberately does not do

- **Does not move the focus to the add box on arrival.** Which box takes the cursor was decided in
  260929g, for readers who come back to find something; the catch in 3 handles the paste that goes
  astray without reversing that. Worth asking Greg if the confusion persists.
- **No collapsed add box** (Greg's own call above).
- **No restructuring the search onto the chips row.** Putting the search box on the right of
  `ShelfControls`' row is the common "filter above a list" shape, but that row wraps and has a bare
  state; a separate right-aligned line is the afternoon version.

The simpler option passed over: placeholder and label wording alone. The boxes would still be two
identical full-width fields, which is the shape Greg says readers confuse, so it does not answer
the report.

## Stages

1. **Build** — `AddArticle.tsx` (card width, heading, link icon, placeholder, the redirect line),
   `Library.tsx` `SearchBox` (width, alignment, placeholder, the pasted-link offer), a unit test for
   the "is this a link" rule (red first), and the rendered behaviour in an existing shelf test if
   one fits. Docs: `library.md` gets a short paragraph; Help's `shelf.md`/`adding-articles.md`
   checked for anything now false.
2. **Look** — screenshots before and after at 1280 and 390 (Sonnet subagent), and the Help picture
   `adding-articles.png` retaken from its `help-images.ts` entry, since the box it shows changed.
3. **Review and land** — GPT Sol code review (workspace-write), gates, push to `dev`, the note.

## Plan review

GPT Sol, `--sandbox review`:
[261011l-shelf-add-vs-search-plan-review-sol.md](261011l-shelf-add-vs-search-plan-review-sol.md),
*BUILD WITH CHANGES*. All five taken: the URL rule reuses `slugFromUrl` (with the scheme-or-path
condition added on top, so a bare site name is not offered); the phone step above; 320 and 768 in
the screenshots; the link icon on a wrapper that takes the input's flex sizing, `id="add-url"`
kept on the input; Help's `shelf.md` updated and its corpus regenerated.

## Results

Before, 1280: [261011l-shot-before-1280.png](261011l-shot-before-1280.png) (and
[light](261011l-shot-before-1280-light.png), [390](261011l-shot-before-390.png)). The search box,
which takes the cursor on arrival, is drawn with an orange focus ring and is the most inviting field
on the page.
