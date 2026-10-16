# ← / → step Search's results

Report: spya-b4vfq5 (SPIDERYARN-READING2-J8, queue item qi-tvjdbbzm), an admin suggestion,
2026-10-15:

> left/right keys should move between search results in Search mode
>
> — Greg, 2026-10-15

Up: [keyboard.md](../project/keyboard.md) · [search.md](../project/search.md)

## What it does

While Search is the mode, **← / → step the results list, in the band's own order** — whatever the
reader chose (*document*, *confidence*, *prioritised*), and only the rows the prioritised bar lets
through, because that is the list on screen and the same `Found[]` the prose is marked from
(`results` in `modes/search/SearchMode.tsx` § `useSearchMode`, `found` in `Reader`). Both matchers,
*words* and *meaning*, and for a visitor too: the list is the list.

A step does exactly what a press on the row does — `openHit` set to the row's key (the row lit,
the phrase ringed in the prose) and `bandJump` to its block, which on a narrow window steps a
covering band aside, as a row press does. The URL's `?at=` follows the scroll by itself, as for
every keypress ([keyboard.md § A keypress writes no URL of its own](../project/keyboard.md#a-keypress-writes-no-url-of-its-own));
`openHit` has never been in the URL and this does not change that.

The rules are Quotes' (`stepQuote`), so the four list-stepping modes behave alike:

- nothing open, or an open row the list no longer has → the first row, whichever way;
- ← on the first goes to the first again (Skim's rule, SPIDERYARN-READING2-4K);
- → on the last takes nothing, so the key goes back to the browser; no wrap;
- an empty list takes nothing.

**Not while typing.** `useArrowNav` already returns before any handler when the key's target is
an input, a textarea, a select or contenteditable (`key-chord.ts` § `isTyping`) — so the search
box, the confidence slider (a range input, whose ← / → are its own) and the row checkboxes all
keep their keys — and when a widget has called `preventDefault`, inside a dialog, with a modifier,
or on auto-repeat. Nothing new to write; the composition test pins the search box case.

**The row follows into view in the band.** A step to a row scrolled out of the results list is a
step the reader cannot see in the band. `QuotesPanel` already does this on its own selection, and
`OutlinePanel` has a better version of the same arithmetic (a row that fits is never cut at the
list's foot). Rather than a third copy, the arithmetic moves to one small pure function shared by
Quotes and Search; Outline keeps its own surrounding fisheye logic and is left alone.

## Code

1. **`src/web/list-step.ts`** (new): `stepInList(listed, at, dir)` — the generic form of
   `stepQuote`'s rule over an index — and `followScrollTop(list, row)`, the "bring a row into a
   scrolled list without touching any ancestor" arithmetic, pure over four numbers.
   `stepQuote` becomes a one-line wrapper (its tests stay as they are); `QuotesPanel`'s follow
   effect calls `followScrollTop`.
2. **`Reader.tsx`**: a `searchKeys` handler beside `quoteKeys`, passed to `useArrowNav` only while
   the mode is Search: `stepInList(found, index of openHit, dir)` → `setOpenHit(key)` +
   `bandJump(blockId)`.
3. **`SearchPanel.tsx` § `Results`**: a layout effect on `openKey` that brings the open row into
   the `.srch-hits` list via `followScrollTop`; rows get `data-hit-key`. Not on every render, so a
   reader who scrolls the list by hand keeps their place until the selection moves — Quotes' rule.
4. **Keyboard help.** There is no shortcut sheet; the convention is that a shortcut is named on
   its control's card ([tooltips.md § A shortcut is named on its card](../project/tooltips.md#a-shortcut-is-named-on-its-card)).
   Search has no ‹ › controls, so the hint goes on the results' count line (`SortBar`) as a
   hover title — no new chrome. And a section in keyboard.md, a line in search.md, and `/help`
   if it lists keys.

## Tests

- `tests/list-step.test.ts`: `stepInList` (the four rules) and `followScrollTop` (in view → null;
  above; below; taller than the list).
- `tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx`, Search arm: → pressed *in
  the search box* changes nothing; → on the page opens the first row and rings its phrase, and lights
  the row — the same state the row press below asserts. Written first and watched red.

## Passed over

- **A handler inside `SearchPanel`**, registered upward the way `QuizPanel` does. Search's list
  and open key already live in `Reader` (`found`, `openHit`), so the handler can be built there
  exactly as Quotes' is, with no registration seam.
- **‹ › buttons on the band**, as Quotes has. Not asked for; the rows are already the controls.
  One line to add later if wanted.
- **Leaving Quotes' follow arithmetic and copying it.** Three copies of one rule is the thing
  web-client.md § Shared code is there to stop.

## After GPT Sol's plan review

[The review](261015d-search-arrow-keys-plan-review-sol.md) said REWORK, on six findings. What was
done with each:

1. **P1, a step pushes `?at=` history** (`bandJump` → `jumpTo`). True, and **kept**: Quotes' ← / →
   already go through `bandJump` and push, Skim's steps push `?stop=`, and the brief asks for
   "the same way a click on it does". A second, quieter jump would make Search the one
   list-stepping mode whose key is not its row's press. Named in keyboard.md § ← / → in Search, so
   it is a decision rather than an accident; if Back filling with steps turns out to grate, the fix
   belongs to all four modes at once.
2. **P2, narrow window.** Both halves real, and Quotes had both. The follow is now one hook,
   `useFollowRow` in `list-step.ts`, which also follows when the list comes back into view
   (a `ResizeObserver`, as Outline does); Quotes and Search use it. And `bandJump` remembers the
   band's focus only on the way out, as `bandStepsAside` already did, so a second step while the
   band is away no longer forgets where to hand focus back.
3. **P2, streaming moves the open row.** Declined: following on every reorder would yank a list
   the reader is browsing. Each press steps the list as it stands; the next press brings its row
   into view. Said in `useFollowRow`'s docblock.
4. **P2, the tests.** `stepByKey` (one function now, `stepQuote` its wrapper) is tested on a
   three-row list in an order that is not the article's; `useFollowRow` is tested mounted, including
   a hidden list coming back. History is not asserted — see 1.
5. **P3, the colour popover and the score card.** Intended, as in Quotes: focus is on the row's
   control and the key steps the list behind. Said in keyboard.md.
6. **P3, help.** `/help` names Search in its ← / → line and Search's help page has a sentence. The
   hint is on the score's card (the row's only card), not a `title` on the count line.
