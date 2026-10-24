# Structure's Hover sub-mode: pointing at a row goes there

Report `spya-kaxamm` (#677), Greg, 2026-10-23, on Structure's two columns. Up:
[structure.md](../project/structure.md).

> A friend of mine was using structure mode, and he said that what he wanted was to be able to use
> the mouse just when hovering in the first column, and that it would automatically switch to that
> area in the second column. […] It's an experiment I'd like to try, but we might want to revert it.
> […] create a new submode alongside FishEye and expanded submodes so that when the user hovers
> their mouse over a section, it automatically opens up that section in the second column. […] in
> hover mode, we don't need the tooltip in the section, the first column […] I'm tempted to go all
> the way and say that basically what we're saying is that in this hover submode, it looks like
> fisheye submode, but the interactions with hovering with a mouse are different, and that hovering
> is like clicking, in which case hovering on the second column with the subsections would also be
> like clicking on them. […] you figure out what's going to be least complicated and easiest to
> experiment with and perhaps even revert.
>
> — Greg, 2026-10-23, spya-kaxamm

## What it does

A third chip, **Hover**, after Fisheye and Expanded (`?structure=hover`). It draws exactly what
Fisheye draws. In the two columns, a mouse resting on a row for a moment (a dwell, ~150ms) goes
there — the prose moves, and column B follows, as it does after a click today. Both columns, as Greg
said ("go all the way"). No row cards (tooltips) in either column, because the hover is the preview.
A click still does what it always did.

## The choices, and why

- **A sub-mode, not an option on Fisheye.** Fisheye is untouched, and reverting is deleting one
  view. A sub-mode is one entry in the typed tables (`STRUCTURE_VIEWS`, `STRUCTURE_SUB_MODES`), and
  the compiler names every other place.
- **Behind the experimental-features switch** (`experimental: true`), the established home for an
  experiment: readers with the switch off do not see the chip; a shared `?structure=hover` link still
  opens it (experimental-visibility.ts § the third clause). Greg has the switch; his friend would
  need to turn it on at /profile.
- **The hover jump is a quiet scroll, not a jump.** A click is `jumpTo`: it pushes a history entry,
  arms the return chip and flashes the landing. Sweeping the mouse down a column would push a dozen
  Back entries. A hover instead does what ← / → stepping does: `scrollToBlock` directly (no history,
  no flash, no return chip), through the same `jumpToRow` that opens a folded stretch first. Like
  scrolling, it is not undone by Back.
- **Instant, not smooth.** A smooth glide across several parts walks the focus line through every
  part in between, and column B — the thing the reader is looking at — would flicker through each.
  To be confirmed in the browser spike.
- **Dwell, and `pointermove` only.** A dwell stops a diagonal mouse path from column A to column B
  from jumping to every part it crosses (the menu-aim problem). Arming on `pointermove` rather than
  `pointerenter` means a row that slides under a still mouse — column B re-lays out after every jump,
  and column A re-windows on a long piece — does not trigger another jump, so it cannot oscillate.
  Mouse only (`pointerType === "mouse"`): a finger keeps the tap behaviour.
- **The columns only.** The narrow face (the nested list) scrolls itself to follow the reader, so a
  hover-jump there would move the list under the mouse. In Hover, the list face behaves as Fisheye
  does, and the chip's card says the hover works where there is room for two columns.

## Simpler option passed over

Hover only previews: column B shows the hovered part, and the prose moves only on click. Rejected
because it needs a second "where" in the projection (hovered vs read), a snap-back when the mouse
leaves, and Greg leaned to hover-as-click. It is the obvious next try if the moving text is too much.

## Stages

1. `params.ts`, `sub-modes.ts`: the view and its words (`experimental: true`).
2. `StructureMode.tsx`: the chip filtered through `shownBehindTheSwitch` (the switch handed in from
   `Reader`), `VIEW_HOW.hover`, and `hover` passed to `StructurePanel` on the columns face.
3. `StructurePanel.tsx`: in hover, rows with no card, plus the dwell handler calling an injected
   `onGlance` through `jumpToRow`. `StructureBand` supplies `onGlance` = `scrollToBlock(id, "auto")`.
4. A jsdom test: hover draws no card; a mouse `pointermove` held past the dwell glances once; a
   `pointerleave` before it does not; a row already current does not.
5. Browser spike with screenshots (Sonnet subagent); tune dwell and smooth/instant.
6. Docs: structure.md § Fisheye and Expanded (and the help page if it lists the chips).

Revert: delete the view from `STRUCTURE_VIEWS` and follow the compiler; then the hook, the help
page's paragraph, `structureInSearch` and its clause in `subModeRows`, and regenerate the
command-pick catalogue.

## GPT Sol's plan review, and what changed

All four taken.

1. *The quiet scroll aligned the top, while the focus sampler reads 40% down*, so a short section
   would read as the next one. → `scrollToBlock(id, "auto", undefined, { align: "centre" })`.
2. *A dwell pending when the reader clicks would replace the click's glide with a quiet move.* →
   `pointerdown`, the wheel and a key cancel a wait; a wait that ends while `glideTarget()` is set
   gives way.
3. *`pointermove` alone does not prove no oscillation, as browsers differ.* → one controller for
   the panel; after a glance nothing re-arms until a move arrives at different coordinates.
4. *More places than the compiler names*: the command bar's row for a shared `?structure=hover`
   with the switch off (`subModeRows` now takes Structure's open view), the generated command-pick
   catalogue, url-state.md, last-view.ts's comment, and the help page.

## Browser spike

On `openai-huggingface` (8 parts) at 1440×900, real mouse moves (Playwright, Sonnet subagent).
Column B followed the hovered part, and the hovered part was the current one after landing for all
eight parts. No row card in Hover (three in Fisheye). After one move, a still mouse gave one scroll
and then 2.6s of nothing. A diagonal sweep across column A made no jumps. Hovers added no history
entries, a click added one, and there were no console errors. 150ms and instant were kept.

## GPT Sol's code review

Fixed by the reviewer, read and kept:

1. A press now fences its coordinates as a glance does, so a same-place move during the click's
   relayout cannot arm a wait behind the click.
2. A wait is cancelled synchronously when the reader's position or the view changes, so a closure
   holding a stale `here` cannot fire.
3. The hook's window listeners (wheel, key, a press anywhere) exist only in Hover.
