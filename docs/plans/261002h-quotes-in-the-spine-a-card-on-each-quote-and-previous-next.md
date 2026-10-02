# Quotes in the spine, a card on each quote, and previous / next

Feedback `spya-yd2c47` and `spya-mtyquy`, both from Greg (admin, provenance proved by
`scripts/feedback-reporter.ts`), Overseer queue item `qi-seg5mayh`. Up:
[quotes.md](../project/quotes.md).

> Perhaps show Quotes in the spine (use the same colour we use for their outline-border)
>
> — Greg, 2026-09-10 (`spya-yd2c47`)

> For the highlighted-Quotes shown in the text (with an outline-border), tooltip to show our
> quantitative scores and perhaps Previous/Next icon-buttons to jump to the next Quote, and a button
> to open Quotes mode.
>
> And in Quotes mode, add fairly big Previous/Next icon-buttons to jump around, and use left/right to
> navigate between quotes.
>
> — Greg, 2026-09-11 (`spya-mtyquy`)

Prior work checked 2026-10-02: nothing on `dev` does any of this. `quotes.md` says the quotes reach
"the paragraph bar, the spine rail and the ring in none" outside Quotes mode; `QuotesPanel.tsx` has
no previous/next and no ← / →; a quote mark has no card. The recheck note
(`docs/user-feedback/261002-recheck-all-reports.md`, rows 64 and 68) says the same.

## What exists, in one paragraph

Every quote the Quotes panel lists is outlined in the prose in every mode (`useQuoteMarks` →
`proseFound`). In Quotes mode only, the quotes are also the mode's passage slot, so they get one
lane in the spine's right-hand search gutter — painted in `--cat-0`, **the first saved search's
colour**, not the quote green (`--quote-stroke-rgb`), because `resolveQuotes` gives every quote
`slot: 0`. Outside Quotes mode they reach the rail not at all, deliberately: `blockMatches`,
`blockStrength` and `blockHues` would misread a quote as a search (passages.ts § `proseFound`).
← / → already have a per-mode seam: `useArrowNav`'s horizontal handler, which Skim and Quiz use.

## The three pieces

### 1. The spine: one green strip, in every mode

```
 spine (12px)
 ┌────────────┐
 │▌   ░░░  ▐▐ │   ▌ = quote strip, left 2px, --quote-stroke-rgb
 │▌   ░░░     │   ▐ = search lanes, right 10px gutter (unchanged)
 │    ░░░  ▐  │   ░ = reading runs / part tint (unchanged)
 │▌▌          │
 └────────────┘
```

- **Its own element, not a lane** — the `.spine-from` precedent (spine-marks.ts § `OriginMark`).
  The search gutter is the right 10px of a 12px rail, so the left 2px is free: a quote strip there
  can never push a search sideways, never be packed by `laneOrder`, and never be counted as a
  "search match" on a band's card.
- **In every mode**, because the outlines are in every mode, and the rail is the bird's-eye of what
  is marked. Drawn from `quotes.found` (what the prose actually outlines), so a quote the bar hides
  or whose block is gone has no strip — the same set as the marks, by construction.
- **Quotes mode loses its old `--cat-0` lane** (`hitBlocks` is empty there), so a quote is drawn one
  way everywhere. That also stops the band card calling quotes "search matches", which it does today.
- **Fade carries priority**, as the outline's does: a block's strip takes the highest `quoteAlpha`
  of the quotes in it. No width tier — 2px has no room for one.
- Pure function `quoteRailMarks(rows, byBlock)` in spine-marks.ts, beside `jumpOriginMark`, so the
  arithmetic is tested without a DOM.

Simpler option passed over: **put the quotes in the lane system with a green colour** (`laneColour`
keyed on `QUOTES_RUN`). Fewer new lines, but quotes would then take a lane from every search, shift
the searches sideways whenever quotes exist, and be counted in "N search matches" — three channels
mixed to save one element.

### 2. A card on a quote in the prose

The quote joins `ProseHoverCard` (the one delegated card for marks in injected HTML) as a fourth kind
of section, under the term and citation halves and above the link half:

```
┌────────────────────────────────────┐
│ ❝ Quote                     3 / 14 │
│ Importance  ███████░░  0.78        │
│ Striking    ████░░░░░  0.45        │
│ Why: <the model's reason>          │   ← model's voice (fonts.md)
│ [‹]  [›]          [Open in Quotes] │
└────────────────────────────────────┘
```

- **Scores**: both raw numbers when present, drawn with `ScoreBars` *and* printed — this card *is*
  the tooltip the panel's rows send their numbers to (quotes.md: "the numbers are in the tooltip").
  Never the composite. "Not scored" when neither is there.
- **Why**: `quote.reason`, which the panel already shows behind its ⓘ (Greg, 2026-08-31: *"with
  reason as a tooltip"*). Cheap and it is what the card is for; in the model's face.
- **‹ ›**: previous / next quote **in the list's order** (`markedQuotes` — the panel's own list,
  document order by default, by importance if the reader chose that). Selects it (`?quote=`, the
  ring) and jumps to its block, then closes the card. Disabled at either end, no wrap — `BlockNav`'s
  and Skim's rule.
- **Open in Quotes**: `?quote=` + `?mode=quotes`, as `openTermInGlossary` does for a term. Hidden
  while Quotes is already the mode.
- **Pointer only (see the review below); a tap still falls through.** A quote is the one mark a tap may select a
  paragraph through (quotes.md, TableView `NOT_A_BLOCK_SELECTION`) — that is how a finger reaches the
  gutter and annotates. Adding quotes to `tapSelector` would trade that away. Deferred, named below.
- **A longer rest before it opens on a quote-only hit** — a quote is a whole passage, often a
  paragraph, and a pointer resting while the reader reads it would otherwise raise a card every
  third of a second's pause. `useHoverCard` gains an optional per-hit open delay; a quote that is
  also a term, a citation or a link keeps the normal 320ms. Proposed 900ms; to be felt in a browser.
- Selector: `mark.hit[data-quote]:not(.xref)`, `:not(.xref)` for the reason the term and citation
  entries have it. Which quote: the `data-hit` keys looked up in a key → quote map of the listed
  quotes, so a stale or forged key draws nothing (the terms' rule).

### 3. Quotes mode: big ‹ › and ← / →

- A stepper `[‹]  3 of 14  [›]` pinned in the band's foot, above Find more — for owners and
  visitors alike. 20px chevrons, the Skim stepper's size (`.skim-arrow`), each with a card naming its
  key (tooltips.md § A shortcut is named on its card). Position spoken through an `sr-only` live
  region, as Skim's is.
- **← / →** through the existing seam: `Reader` passes a quotes handler to `useArrowNav` while the
  mode is Quotes, after every guard there (no modifiers, not typing, not in a dialog, no repeat).
- **One stepping rule for buttons, keys and the card**: `stepQuote(listed, currentId, dir)`, pure,
  in QuotesPanel.tsx beside `markedQuotes`. Nothing selected → the first quote either way. At the
  first, ← goes to the first again (Skim's rule, SPIDERYARN-READING2-4K: the page may be anywhere).
  At the last, → takes nothing and the key goes back to the browser. No wrap.
- **The selected row scrolls into view in the list** when the selection changes — the list's own
  `scrollTop`, never `scrollIntoView` (OutlinePanel's rule: that scrolls the page too).

`useQuoteMarks` grows to return the listed quotes and the selection setter alongside the slot, so the
card, the stepper and the keys all read one list — the same "one function, or two expressions that
agree until somebody edits one" rule `markedQuotes` exists for.

## Deferred, and why

- **A tap opening the card.** It would cost the tap that selects a paragraph through a quote, which
  is how a finger annotates (touch.md). Needs a decision about which gesture wins.
- **Previous / next relative to where the reader is** when nothing is selected (e.g. the first quote
  after `?at=`). First-quote is simpler and predictable.
- **Keeping the card open and re-anchoring it on the next quote** after ‹ ›. Closing is simpler and
  the reader can point at the new one.

## Stages

1. Spine strip: `quoteRailMarks`, Spine prop, CSS, `hitBlocks` empty in Quotes mode; tests.
2. Shared stepping: `useQuoteMarks` returns `listed` + select; `stepQuote` + tests; Quotes-mode
   stepper in the foot; ← / → via `useArrowNav`; row scrolls into view.
3. The prose card: `read` finds quotes, quote section, per-hit open delay, Open in Quotes; tests.
4. Docs (quotes.md, keyboard.md, tooltips.md, help page if it lists keys), browser check (Sonnet
   subagent), GPT Sol code review, feedback note, endings, queue done.

## Plan review, and what it changed

GPT Sol, `--sandbox review`, 2026-10-02 —
[the findings](261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next-plan-review-sol.md).
No P0; four P1s, all accepted:

- **P1-1, Skim.** Emptying `hitBlocks` only in Quotes mode left Skim's stop (a quote's own `Found`)
  as a `--cat-0` lane beside the new strip, and a strip from `quotes.found` missed a Skim stop the bar
  hides from the band. **Now:** `railFound` (passages.ts) takes anything with a quote stroke out of
  the lanes in every mode, and the strip is drawn from `proseMarked`.
- **P1-2, keyboard.** Quote marks are not focusable, and a card opened from a focused link loses
  itself when focus moves into it. **Now:** the card is pointer-only, said so; Quotes mode's ← / →
  is the keyboard route. `read` looks upward from the pointer only.
- **P1-3, split and merged marks.** Handled by looking up every key in `data-hit` against the quote
  map and de-duplicating; with pointer-only, no downward search is needed.
- **P1-4, dead quotes.** `markedQuotes` keeps a row whose block is gone, with no mark. **Now:**
  `useQuoteMarks` returns `steppable` — the listed quotes that have a mark — and the band's ‹ ›,
  ← / → and the card all step over that.

P2s: the card steps **in document order** (down the page) while the band and keys use the list's
order — accepted, Sol's suggestion; the strip's 2px is not quite free (reading runs, and the lanes'
floor at seven or more searches) — paint order chosen and the overlap accepted in quotes.md; the
tap precedence for merged marks is documented; the 900ms delay keeps the warm 60ms swap; and the
three tests pinning the old rail are updated.
