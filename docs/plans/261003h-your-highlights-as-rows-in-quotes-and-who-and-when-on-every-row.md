# 261003h — Your highlights as rows in Quotes, and who and when on every row

Report: spya-ma5h9b (Greg, 2026-10-03). Overseer queue: qi-xafwewcr. Follows
[261003e](261003e-span-highlights-with-a-colour.md), which made a highlight a comment with a colour.

The question put to Greg was `[Q-highlights-in-quotes]`
([the note](../user-feedback/261003_0929-highlighting-on-an-ipad-and-highlights-in-quotes.md)):
should a reader's own highlights appear in Quotes mode? His answer, relayed by the Overseer:

> A yeah that sounds good. The only hesitation I have is that one might want to highlight the text
> and add a comment or something. I don't know if there's a way for them to show up in both, or
> maybe we keep it simple and just say that comments are block level and highlights show up
> alongside quotes. They should obviously have a different color if it's from me, and they should
> have a tooltip. Actually, quotes should as well, maybe saying when it was applied and whether it's
> AI generated or human highlights. Use your judgment. Let's try and avoid making things too complex.
>
> — Greg, 2026-10-03

And the rule he added the same day (AGENTS.md § Writing code): *"Store when it happened."*

## What gets built

1. **A reader's highlights are rows in the Quotes band**, among the model's quotes, in the
   highlight's own colour, and never hidden by the threshold bar.
2. **Every row says who made it and when**, in a tooltip: *Your highlight · 3 Oct 2026, 14:02* or
   *Chosen by the AI · 2 Oct 2026, 09:10*. The same line goes on the hover card a quote already has
   in the prose.
3. **Every quote the model chooses is stamped with when**, from now on (`Quote.addedAt`).

```
 ❝ in order  most important  most striking            14 + 3 yours
 ──────────────────────────────────────────────────────────────────
 ▌ "the variance of the estimator falls as n grows"        ⓘ  §2.1     ← yours, yellow bar
   "Entropy is not disorder; it is the number of ways…"  ▂▅ ⓘ  §2.3     ← the model's
 ▌ "which is why the bound is tight"                    ✎  ⓘ  §3.0     ← yours, pink, has a note
   "The second law, read this way, says only that…"     ▅▂ ⓘ  §3.2
```

## The one decision: a highlight with a comment

Greg's hesitation was a highlight that also carries a comment, and his fallback was to make comments
block-level only so the two kinds never meet.

**Chosen: it shows up in both, with nothing new to build.** Since 261003e a highlight *is* a
comment with a colour, so "in both" is already what the data says: the row appears in Quotes
because it has a colour, and in the comments drawer and the margin because it has words. The Quotes
row carries a small note mark, its tooltip shows the note, and pressing the row opens the comment.

**Passed over: Greg's simple default** (comments block-level, highlights span-level). It reads
simpler but is the bigger change: span-level comments have existed since 2026-08-28 and readers have
them, so it would mean removing a working feature or migrating its rows. The option above changes
nothing about comments. If in use it turns out confusing, restricting later is still possible.

**What counts as a highlight here: a selection-anchored comment with a colour.** An uncoloured
comment or bookmark is not a row in Quotes (it never claimed the words were worth keeping, only that
there was something to say or come back to). Colouring it from its box makes it one.

## Design

### The rows

A new pure function builds the band's list from two sources, `Quote[]` and the reader's coloured
comments, as one discriminated union:

```ts
type QuoteBandRow =
  | { by: "ai"; quote: Quote }
  | { by: "reader"; comment: Comment & { quote: string; colour: HighlightColour } };
```

- **Order.** *in order* and *prioritised*: document order, both kinds interleaved (block order, then
  `start`). *most important* / *most striking*: the reader's rows first as one group in document
  order, then the model's by score. They have no score, and "unscored last" would bury the lines
  the reader chose.
- **The bar never hides a reader's row**, and they are not counted in "5 of 14". The count reads
  `14 + 3 yours` (`5 of 14 + 3 yours` when prioritised).
- **Colour.** A bar down the row's left edge in the highlight's `--hl-*` colour, at full strength
  rather than the wash, plus the word *yours* for anyone who cannot tell the colours apart. The
  model's rows keep their green. In the prose nothing changes: a highlight is already a wash and a
  quote already an outline.
- **The words** are the comment's stored `quote`, drawn as the article's (the same `<blockquote>`):
  they are the article's characters, sliced from the block by the browser's own selection.
- **A highlight whose words a re-extraction took away** still shows as a row (as it still shows in
  the drawer), and pressing it goes to its block if that survives.
- **No scores, no "why"** on a reader's row.

### Pressing a row

A model's row: unchanged (selects it, rings it in the prose, `?quote=`).
A reader's row: `jumpToComment`, the existing path the drawer uses: go to the passage and open the
comment's box (`?note=`), where the colour can be changed and the note read or edited.

**The stepper (‹ ›, ← →) and `?quote=` stay the model's quotes only.** A highlight has no quote id
and its own selection state is `?note=`. Stepping through both kinds needs one selection model for
two id spaces. Deferred, by name.

### The tooltip: who and when

- Every row gets the ⓘ button, whether or not there is a reason. Its card ends with a provenance
  line, in the app's face: *Chosen by the AI · {date}* or *Your highlight · {date}*.
- A model's row keeps its reason above that line, in the model's face ([fonts.md](../project/fonts.md)).
  A reader's row shows the note, if any, in the reader's face.
- The prose hover card on a quote (`ProseHoverCard`) gets the same provenance line.
- The date is `Quote.addedAt` or the comment's `createdAt`, formatted by whatever helper the client
  already uses for dates (find it; do not write a second one).

### `Quote.addedAt`

`Quote` has no time of its own, only the list's `generatedAt`, which every *Find more* overwrites.
So a quote appended on Tuesday to Monday's list cannot say Monday.

- `addedAt?: string` on `Quote`, set in `src/quotes.ts` when a run adds it. A quote carried across a
  run (appended to, or kept by id in a replace) keeps the one it has.
- It is inside the `quotes` jsonb column, so there is **no migration**.
- **A quote stored before today has none**, and the list's `generatedAt` is an upper bound, not its
  time. The tooltip then says *Chosen by the AI · on or before {generatedAt}*. No backfill: writing
  `generatedAt` into old rows would turn a bound into a claim.
- Check that `addedAt` does not enter any content hash or freshness comparison, and that the public
  projection of quotes either carries it or drops it deliberately.

A highlight already has `createdAt`. A recolour stores no time of its own (261003e chose not to
touch `updatedAt`); that is a known gap against "store when it happened", named here and left.

### Where the highlights come from

The Quotes band needs the reader's comments. Reader.tsx already holds them (`owner.comments`) for
the drawer and the prose marks; pass the coloured ones down. No new request.

- **Owner only in v1.** A visitor on a shared link sees the model's quotes as today. The public
  comment projection does carry colours, so this is a display choice, not a privacy one. The wording
  for someone else's highlight ("the sharer's highlight"?) is a small product call. Deferred.
- **An article with highlights but no quote list yet**: the highlights show, above whatever the
  panel says about the list (running, failed, not started). The panel still starts its stage as now.
- **Before the comments read lands**, the band shows the model's rows only; highlights appear when
  it lands. No spinner for them.

## Stages

One stage; it is one band and one field.

1. `Quote.addedAt` in `src/quotes.ts` (+ tests in the quotes step's suite: new ones stamped, kept
   ones untouched, absent stays absent).
2. The row union, ordering, counts (pure, unit-tested: interleave, group-first under score orders,
   bar exemption, count strings).
3. `QuotesPanel` rows, colour bar, *yours*, the note mark, the ⓘ card with provenance on every row;
   `ProseHoverCard` provenance. Mounted tests.
4. Reader wiring, press → `jumpToComment`.
5. Docs: `quotes.md` § a new section, `comments.md` one line; the feedback note; the queue.

GPT Sol reviews this plan before the build and the code after. Browser check by a Sonnet subagent.

## Deferred, by name

- Stepping (‹ ›, ← →) through highlights as well as quotes.
- Highlights in the spine's quote strip.
- A visitor seeing the sharer's highlights in Quotes.
- A time for a recolour.
- Filtering Quotes to "only mine" or by colour.
- The floating selection menu, still `[Q-highlight-menu]`.
