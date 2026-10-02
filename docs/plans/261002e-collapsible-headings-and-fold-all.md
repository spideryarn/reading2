# Collapsible headings, and fold or unfold them all at once

Report `spya-skqwg8` (suggestion, 2026-10-02), from Greg, on
`/read/s41598-023-33209-9-spya-hxekgz?mode=summary&summary=fuller`:

> It would be nice to be able to make headings collapsible, i.e. a little icon that would hide that
> heading's section.
>
> And ideally `Cmd+Opt+t` (and appropriate Windows equivalent) as keyboard shortcut to
> expand/collapse all.  And/or perhaps if I hold Opt while pressing on the expand/collapse-icon it
> switches to expand/collapse-all?
>
> (Indicate keyboard shortcuts in the heading-collapse-icon rich tooltip).
>
> If you can see a place in the UI to provide an icon to expand/collapse-all, add that too.
>
> Update docs as appropriate.
>
> Stop & let's discuss first if this would add substantial complexity.
>
> — Greg, 2026-10-02

## Is it substantial? No — and why not

The worry is real: nearly everything in the reading view measures rows — the spine's bands, the
reading position (`?at=`), the arrow keys, "is it on screen", the jump-back history. Hide a row with
`display: none` and every one of them reads a zero rectangle at the top of the viewport, which
breaks the "tops are in order" assumption `activeSectionIndex` and the spine both rely on.

**The finding that makes it small:** hide the folded row's *cells*, not the row. Measured in headless
Chrome on the box, 2026-10-02, three ways of hiding rows 1–2 of four:

| CSS | rows' `[top, height]` |
|---|---|
| `tr { display: none }` | `[10,34] [0,0] [0,0] [46,34]` — tops jump to 0, order broken |
| `tr { visibility: collapse }` | `[84,34] [118,0] [118,0] [120,34]` — in place, zero height (Safari support uncertain) |
| **`tr > td { display: none }`** | `[158,34] [194,0] [196,0] [198,34]` — in place, zero height, plain CSS everywhere |

A row with no cells stays in the table at zero height, at the top of the next visible row. So every
existing measurer keeps working unchanged: a folded section is simply a section of zero height —
the spine draws it as a sliver, the reading position can never land inside it (ties go to the last
row, which is the next visible one), and `measureRow` behaves.

Two things do need code, and only two:

1. **A jump into a folded section must unfold it.** Every jump to a block — a Structure row, a
   search hit, a chip, the spine, a comment, `?at=` — goes through one function,
   `scrollToBlock` in `src/web/scroll.ts`. It calls `revealBlock(id)` first. (Two other
   `scrollIntoView` calls in the reader, flash.ts and Library, are not to a prose row.)
2. **↑ / ↓ must step over folded rows**, not into them — otherwise the reveal above would make ↓
   unfold every section it meets. `step` in `keynav.ts` filters the starts it is handed through
   `isFolded` at keypress time.

So the cost is one small module, one button per heading, two one-line hooks, a chord, CSS, tests and
docs. That is under the "discuss first" line; built. (**Not quite two hooks**: GPT Sol's plan
review found three more places that had to learn about folds — see § Reviews.)

## What gets built (v1)

### The fold state — `src/web/fold.ts`, new

- **Pure:** `foldedBlocks(blocks, folded: ReadonlySet<BlockId>): Set<BlockId>` — a folded heading at
  level L hides every following block up to (not including) the next heading whose level ≤ L. The
  heading itself stays visible. Nested folds compose (a folded H3 inside a folded H2 is simply also
  hidden). `foldable(blocks): Set<BlockId>` — the headings that have at least one block under them,
  so a heading with nothing to hide gets no button.
- A heading with no `level` (the type allows it) is treated as level 6, the narrowest — it can only
  ever hide what follows until the next heading of any level.
- **A tiny external store** (`useSyncExternalStore`, the jobEngine pattern): the set of folded
  heading ids for the article now open, keyed by slug so it resets on a different article.
  `toggle(id)`, `foldAll()`, `unfoldAll()`, `toggleAll()` (anything folded → unfold all; else fold
  every foldable heading), `revealBlock(id)` (unfold every heading whose section contains `id`),
  `isFolded(id)`.
- **The hiding is a `<style>` element the store writes synchronously**, one rule per hidden row —
  `tr[data-block="…"] > td { display: none }` — the same mechanism `ReadingTimeStyle` uses, and for
  the same reason: `TableView` re-renders nothing when a section folds. Synchronous matters for
  `revealBlock`: `scrollToBlock` measures the row in the same tick it asks for it, and a reveal that
  waited for React's next commit would aim the first frame of the glide at a zero-height row.
- Not persisted, not in the URL. Reload and everything is open again.

### The button — on every foldable heading

- A small chevron (`ChevronDown` open, `ChevronRight` folded, Lucide — icons.md) on the heading's
  row, inside `td.text` but **outside `.prose`**, so comment offsets (`td.text .prose`) are
  untouched. Position: **at the right-hand end of the heading's line**, on its first line; faint
  at rest, full on row hover and on focus, full whenever folded. (The first draft said left of the
  gutter. Building it showed there is no room there: left of the gutter is `--blk-gutter-x`,
  0.35rem, whenever the cell is no wider than the measure — every band mode. So it mirrors the
  gutter's own `left` formula on the right, and the heading's prose keeps a slot clear at its end.)
  Checked in a browser at a wide window, a mode band, and a narrow window.
- A real `<button>` with `aria-expanded` and `aria-controls`-free label *"Hide this section"* /
  *"Show this section"*.
- **⌥-click (Alt-click) folds or unfolds every section**, matching the Finder and VS Code outline
  convention for disclosure triangles.
- **A rich tooltip** (`ControlTip`), as Greg asked: *"Hide this section. ⌥-click, or ⌘⌥T, for every
  section."* — the platform's own spelling (Ctrl+Alt+T off a Mac), the way the Metadata card spells
  its chord. Tens of headings per article, so a Floating UI instance each is fine (tooltips.md's
  cost argument is about per-block triggers, hundreds of them).
- When a heading is folded, a faint *"N paragraphs hidden"* under it? **Not in v1** — the chevron's
  state says it; deferred below.

### The chord — ⌘⌥T on a Mac, Ctrl+Alt+T elsewhere

- Toggles all: anything folded → unfold all; nothing folded → fold all.
- Matched on `e.code === "KeyT"`, not `e.key`, because ⌥ turns `t` into `†` on a Mac.
- Keeps every rule ⌘-K keeps (keyboard.md § The one chord that is not an arrow): no repeat, no
  Shift, no IME composition, not while typing, not over an open dialog, `preventDefault()` only when
  claimed. `isModChord` refuses Alt by design, so this is a sibling helper in `key-chord.ts`
  (`isModAltChord(e, code)`), not a loosening of that one.
- Lives with the reader (owner and visitor alike — folding is a view, not a write). Only while the
  prose is on screen.
- **Known gaps, named:** on Linux desktops Ctrl+Alt+T opens a terminal before the page ever sees it;
  on Windows, Ctrl+Alt is AltGr on many layouts, so a reader typing AltGr+T outside a text box would
  toggle. The ⌥-click and the button below cover both.

### The fold-all control — where

The masthead's facts line (word count, parts, sections) is the one place that is about the whole
article and is always above the prose. A small text button there, *"Fold sections"* / *"Unfold all"*,
shown only when the article has a foldable heading. If the browser check finds it cramped, it moves
to the Dock's overflow — but not into the Dock's mode row, which is modes.

### Docs

- `keyboard.md`: a section for ⌘⌥T beside ⌘-K and ⌘-Enter, and ↑ / ↓ stepping over folded rows.
- `reading-view-overview.md`: a line on folding, pointing here.
- No new `docs/project/` doc for v1 — this plan is where the reasoning lives; if folding grows (see
  deferred), it gets one.

### Tests

- `fold.test.ts`: `foldedBlocks` (nesting, levels, no-level headings, last section, a heading with
  nothing under it), `toggleAll`, `revealBlock` unfolds the ancestors and only them.
- keynav: `step` skips folded rows (red first).
- scroll: `scrollToBlock` on a folded block unfolds it before measuring (red first).
- The chord: Mac and non-Mac spellings, refused while typing, refused with Shift, `e.code` not `e.key`.
- A component test that the chevron renders only on foldable headings and that ⌥-click folds all.

## Deferred, by name

- **Remembering folds** across reloads or devices (would need storage per reader per article).
- **Folding by the AI's Structure tree** rather than the author's headings. Greg asked about
  headings; an article with no headings gets no buttons in v1.
- **A "N paragraphs hidden" line** under a folded heading.
- **Browser find (⌘F) inside a folded section** — hidden cells are not searchable by the browser.
  The app's own Search mode jumps, and so unfolds.
- **Folding inside the Notes region** — notes are blocks like any other; they fold with their
  heading. No special case.

## The simpler option passed over

**Hide the row with `display: none` from React state in `TableView`.** Fewer lines in the store, but
every measurer then has to learn that a zero rectangle at the top of the viewport means "hidden", the
first frame of a reveal-and-scroll aims at nothing, and folding a section re-renders the whole prose
table. The cells-not-row trick plus a style element is the same amount of code and touches nothing
that measures.

## Stages

1. `fold.ts` + tests; reveal hook in `scroll.ts`; skip in `keynav.ts`. Commit.
2. The chevron, ⌥-click, tooltip, the chord, the masthead button, CSS. Browser check (Sonnet,
   Playwright on the box). Commit.
3. Docs, GPT Sol code review, gates, push, the feedback note.

## Reviews

### Plan review — GPT Sol, read-only, 2026-10-02

[261002e-…-plan-review-sol.md](261002e-collapsible-headings-and-fold-all-plan-review-sol.md). No
P0s, and it agreed the feature stays under the "discuss first" line — but **the section above
overclaimed.** "Two hooks and every measurer keeps working" was false in three places, all now fixed
and tested:

1. **"Already on screen" checks skipped the jump that would unfold** (P1). A folded row's
   zero-height rectangle can sit inside the viewport, so `isBlockOnScreen`, `isPassageOnScreen`
   and `whereIsBlock` said *here*, and the occurrence chips, comment stepping and a pasted `?note=`
   never called `scrollToBlock`. All three now answer *not here* for a folded block, and
   `arrivalAnchor()` drops a held arrival that has since been folded.
2. **A tie with no visible row after it** (P1). `activeSectionIndex` picks the last of equal tops;
   that lands on the next visible row only if the array has one. A sparse list of Structure starts
   (`?at=`'s spy, Structure's live context) or a folded last section did not. It takes a `skip`
   predicate now, passed by all four callers, and `?at=`'s spy also listens to fold changes, since
   a fold moves rows without a scroll event.
3. **The spine** (P2) drew a zero-height hit target per folded band, stacked on one pixel at the
   minimum height. Bands whose rows are all folded are dropped, and folded rows give no search,
   reading or origin marks.

Taken as advice, not changed:

- **Chord reliability** (P2): ⌘⌥T is macOS's *show/hide toolbar* in Safari web apps, and
  Ctrl+Alt+T is Ubuntu's terminal and Windows' AltGr. Kept as the accelerator Greg asked for,
  backed by the chevron's ⌥-click and *Fold all*; keyboard.md says where it never arrives. Accepting
  either ⌘ or Ctrl on any platform is what `isModChord` already does.
- **Chevron inside the gutter** (P2): Sol's alternative to "left of the gutter", which building had
  already abandoned for the right-hand end. The gutter's single heading slot is the note mark's,
  and outranking it is a product call not worth making for v1.
- **Fold-all off the masthead** (P2: the masthead is for constant facts, and scrolls away). Greg
  asked for an icon *if there is a natural place*; beside *N sections* is one, and an article-wide
  action that scrolls away with the title is still found by the reader starting the article. The
  Dock's row is modes. Revisit if Greg disagrees.
- **Two prose tables** (P2): there is exactly one `<TableView>` (Reader.tsx); the store says it
  assumes one.
- **Performance wording** (P2): fair — rows are not individually memoised. The reason that holds is
  the synchronous reveal.
- **Diagram's own step buttons** use unfiltered starts and so unfold their target: consistent with
  "an explicit jump reveals".

### Code review — GPT Sol, workspace-write

Below once it lands.
