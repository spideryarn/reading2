# The shelf focuses the add box on arrival, not the search box

> By default, put the focus in the add box, not the search box.
>
> — Greg, 2026-10-26, `spya-nmx5ga` (admin, suggestion, the library page)

This reverses Part A of
[260929g](260929g-shelf-search-focus-and-metadata-chord.md), where he asked for the search box. Nothing
for it was on `origin/dev` when this started (`git log origin/dev`, 2026-10-27).

## What changes

The focus-on-arrival effect moves from `SearchBox` (Library.tsx) to the URL field in
`AddArticle` (AddArticle.tsx). **Every guard comes with it, unchanged**, because each one was about
the reader, not about which box:

- **a finger is the primary pointer** (`media("(pointer: coarse)")`) — no focus, so a phone's
  on-screen keyboard does not cover the shelf. Same as now ([touch.md](../project/touch.md));
- **something else already has the focus** — the shelf takes it from nobody;
- **the box is not wholly on screen** — Back can mount the shelf scrolled; `preventScroll` as before;
- **the page arrived with a `?q=`** — no focus anywhere. The reader came to look at results; a
  caret in the add box would not change their query, but it is not what they came for, and it keeps
  this case exactly as it is now. `Library` decides this once, from the query it mounted with, and
  passes `AddArticle` a boolean.

`takesFocusOnArrival` moves into AddArticle.tsx with its reasons. Decided once, on mount, as before.

## What else depends on the search box having the focus

- **No key on the shelf.** `/` (quick search) exists only on an owner's reading view
  ([keyboard.md § Quick search](../project/keyboard.md#quick-search-the-slash-key)); the shelf binds
  nothing that assumes the search box is focused. Escape and Enter in the search box are scoped to
  the box and still work once it is clicked or tabbed to.
- **The pasted-link offer** (*That's a link. Add it to your shelf?*, plan 261011l) existed because
  the search box had the caret on arrival. It stays — a link can still be pasted there — but its
  comment, and library.md's line, no longer give that as the reason.
- **Tests:** `tests/shelf-search-focus.test.tsx` asserts the old behaviour; it is rewritten for
  the add box (renamed `shelf-add-box-focus.test.tsx`), with the search box asserted *not* focused.

## Simpler option passed over

Adding `autoFocus` to the add box and deleting the effect. It would pop the phone keyboard on
every visit and grab focus over an already-focused control and an off-screen box — the four guards
are what made the original change safe, and they cost nothing to keep.

## Cost

A keyboard reader's first Tab now starts from the add box rather than the search box, and a reader
who arrives meaning to search has to click or Tab to it (one Tab further down the page, past File,
Add and anything between). That is the trade Greg asked for.
