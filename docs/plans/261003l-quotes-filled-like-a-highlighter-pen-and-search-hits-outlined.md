# Quotes filled like a highlighter pen, and search hits outlined

Report `spya-xrgste` (SPIDERYARN-READING2-B7), a suggestion from Greg (admin, provenance proven),
2026-10-03, from Structure mode on `entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`:

> I think right now the quotes show an outline, and the search results show a highlighter filled in,
> like as if with a highlighter pen. Let's switch this round. I think the quotes should be like with
> a highlighter pen, so filled in, and the searches should have an outline.

This reverses his own decision of 2026-09-06 (report 1Z,
[quotes.md § Not yellow](../project/quotes.md),
[260907c](260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md)): *"Search
fills; quotes outline."* That section ends *"If a later design finds it needs a fill for quotes
after all, the reason this was chosen has been lost."* The reason is not lost; it is overruled by
the person who gave it, after a month of looking at both. The docs change with the code.

## What is on the page today

| Mark | Drawn as | What varies |
|---|---|---|
| Quote (`mark.hit[data-quote]`) | green outline (`box-shadow`, caps on the true ends) | 1px or 3px by tier; alpha 0.70 to 1.00 by priority |
| Thorough-search or literal hit, and a Referee criterion (`mark.hit[data-wash]`) | slate fill, plus a 2 to 6px band of the search's colour(s) under the words | fill alpha by the model's confidence |
| Quick-search hit (`Mark.bare`) | nothing on the words (2026-10-03, `spya-m59qg0`) | not touched by this plan |
| Reader's highlight (`mark.cmt[data-colour]`) | fill in yellow, green, blue or pink (2026-10-03) | not touched |
| Pressed quote, which is also Skim's current stop | stroke goes to `--toward-ink`, faint green fill | |
| Pressed search hit | stronger slate fill, 1px slate ring | |
| Spine quote tick | 2px strip in the quote colour | follows the token |

## What changes

### Quotes: a fill

- `mark.hit[data-quote]` paints `background-color` in the quote colour and no stroke.
- **Priority moves from stroke weight and stroke alpha to fill strength.** Same two inputs
  (`data-quote` tier, `--quote-a`), so nothing changes in TypeScript: light tier fills at
  `--quote-a × 0.20` (0.14 to 0.17), heavy tier at `--quote-a × 0.32` (0.28 to 0.32). (This plan
  first said 0.30 and 0.42; the plan review asked for link and soft-ink contrast, and a link inside
  a heavy quote came out at 2.9:1 on the light page.) The step
  between tiers stays visible and the two still move the same way. The 2026-09-07 finding was that
  priority read *"through brightness more than thickness"*, so this should lose nothing; the browser
  check says whether a light and a heavy quote are tellable apart side by side.
- **The quote colour moves from green to purple** (OKLCH hue 310). This is the part that is not a
  recolouring. The reader's own highlights are fills at hues 100, 150, 270 and 350, and today's
  quote green (hue about 163) as a fill is the reader's green highlight to within a few degrees.
  Purple is 40° from the reader's blue and 40° from their pink. The spine tick follows, because it
  reads the same token. A test asserts the quote hue stays about 40° from each of the reader's four
  in both themes, read from the tokens, so a later token edit cannot quietly bring them together.
  **This plan first said teal** (hue 205, the widest gap that is not the brand orange). Found while
  building: the spine's reading-time area, which landed the same day, is a cyan at hue 200, and the
  quote strip sits on it. The old token comment had already named violet as the least-used gap.
- The token is renamed `--quote-stroke-rgb` → `--quote-rgb`. It is no longer a stroke. The light
  theme's value is darker than a straight hue swap would give, because the spine strip at the fade's
  floor has to clear 3:1 on the light page and the test showed it at 2.8.
- **Text contrast is tested, not felt**: the article's ink over the strongest quote fill, composited
  from the real tokens, must clear 4.5:1 in both themes. This replaces the stroke-floor test, whose
  subject no longer exists. The faintest fill has no 3:1 requirement (no highlighter wash on this
  page meets one, the reader's included); the test requires only that it differs measurably from
  the page.
- **Square pieces, rounded true ends.** One quote is several `<mark>` elements (around an `<em>`),
  so per-piece rounding would notch the fill. `data-quote-start` / `data-quote-end` already say
  where the quote really begins and ends; they now carry the 2px radius, and a 1px page-coloured
  inset on the start so two abutting quotes do not weld into one.
- **One `box-shadow` for every hit** (as built). `mark.hit` declares it once, composed from
  `--mk-top`, `--mk-bottom`, `--mk-start`, `--mk-end` and `--mk-gap`, and each rule sets only the
  edges it owns. A run can be a search hit, a quote and pressed at once; three rules each declaring
  `box-shadow` would draw whichever came last. All edges are inset, so none lands on the line above.
- **Pressed quote / Skim's current stop**: the fill stays, and a 1px `--toward-ink` ring is drawn
  round it with the existing four-edge machinery (top and bottom on every piece, caps on the true
  ends). Same idea as the reader's highlight, whose open state is also an outline round its fill.
- **A reader's highlight over a quote wins on its exact words**, as it already does over a search
  wash. The selector list gains the quote cases so order in the file cannot decide it.

### Search: an outline

Applies to every mark with `data-wash`: thorough-search hits, literal matches, Referee criteria.

- No fill. The band of the search's colour(s) under the words stays exactly as it is and becomes
  the **bottom edge** of the outline; it is still where two searches over one phrase are told apart.
- A 1px top edge on every piece and 1px caps at the true ends, in the first colour of the band
  (`--h0`), or `--hit-rgb` for a literal match that has no colour of its own.
- **Confidence moves from fill alpha to the alpha of the top edge and caps**: `0.35 + 0.65 × --hit-a`.
  A hedged hit is an underline with a faint box; a sure one is a closed box. The band stays full
  strength, as today.
- The caps need to know the true ends, which `annotateHtml` writes for quotes only. It gains
  `data-wash-start` / `data-wash-end`, written the same way. **The sanitiser is not edited** (this
  plan first said it would be): since version 8 it is an allow-list that removes every `data-*` it
  does not name, so the two new attributes are already stripped from an article's own HTML, and
  `tests/sanitize.test.ts` now checks exactly that. It is also a defence, which a feedback run does
  not edit. Its comments still describe the old split; that is noted in the debrief for Greg.
- `box-decoration-break: slice` on these marks, so a wrapped hit is capped at its ends and not on
  every line. `annotations.css` records that the band renders the same under `slice` and `clone` in
  Chrome, and a quote-over-search mark has been `slice` since 2026-09-08.
- **Pressed search hit**: edges go to `--toward-ink` and a faint slate fill appears inside. This is
  the mirror of what a pressed quote did yesterday, and for the reason written there: a momentary
  fill on the one row you pressed does not undo the resting rule.
- RTL mirrors the caps, as the quote rule does.

### A quote that is also a search hit

Draws both: the teal fill and the search's outline and band. That was the point of the two channels
on 2026-09-07 and it survives the swap.

## Not changing

- `data-wash` keeps its name. Its comment already defines it as *"something here wants the search
  painting"*, which is still true.
- `QuoteStroke` / `quoteStroke` keep their TypeScript names, with the doc comments corrected.
  **Passed over: renaming them** to say fill. About sixty references across `search-hits.ts`,
  `passages.ts`, `spine-marks.ts` and the tests, in files two live sessions are editing today
  (Skim's arrows, search). The name is internal; the merge conflicts would not be.
- Quick-search hits, the paragraph bar, the spine search lanes, glossary, comments, cross-references.
- `quoteTier`, `quoteAlpha`, `QUOTE_HEAVY_AT`, the Quotes bar.

## The simpler option passed over

**Swap the paint and keep the green.** One stylesheet edit. Refused because a green quote fill and
the reader's green highlight would be one mark with two meanings, on the day highlights shipped.

## Stages

1. **Tests red first**: `annotate.test.ts` (wash start/end), `sanitize.test.ts` (the two new
   attributes), the renamed fade test (fill contrast, hue separation, stylesheet shape),
   `DesignPage` specimens.
2. **Code**: `annotate.ts`, `styles/tokens.css` (both themes),
   `annotations.css`, `spine.css`, `DesignPage.tsx`, help copy in `help-modes.tsx`.
3. **Docs**: `quotes.md` § Not yellow rewritten with Greg's new words and the old decision kept as
   history, `search.md`, `skim.md`, `design-css-overview.md`, `tooltips.md`, `colour-scales.md`
   where it describes the wash.
4. **Browser check** by a Sonnet subagent at desktop, iPad and phone-portrait, dark and light: a
   light and a heavy quote, a quote split by an `<em>`, two abutting quotes, a thorough-search hit
   alone and over a quote, two searches over one phrase, a reader's highlight in each colour beside
   and over a quote, a pressed quote, Skim's current stop, the spine.
5. **GPT Sol code review**, gates, push, feedback note.

## Questions for Greg (asked in the debrief, not waited on)

- **[Q-quote-fill-colour]** purple (built), against keeping green and accepting the clash, against
  the fluorescent yellow he named on 2026-09-06 (which is the reader's yellow).
- **[Q-search-confidence]** whether a faint top edge is enough of a confidence signal, or whether
  the outline should be one strength and confidence live only in the panel's chip.
