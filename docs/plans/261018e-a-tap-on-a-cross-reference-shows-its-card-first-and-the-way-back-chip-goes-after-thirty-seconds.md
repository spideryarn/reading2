# A tap on a cross-reference shows its card first, and the way-back chip goes after thirty seconds

Two admin reports from Greg, batched because both are about following a link to another part of the
article. Queue item qi-rbj6q9kp.

> It looks like there's a link to another part of the article in this paragraph (dotted line). I was
> expecting a single touch on an iPad to show me a tooltip before taking me there.
>
> Or to show where it would take me in the Annotation mode.
>
> Probably the tooltip would make more sense.
>
> — Greg, 2026-10-17 (spya-yk33ke)

> I really like how if I click on something that takes me to a different part of the article, like a
> footnote or whatever, there's a little back to X sort of UI widget so I can go back to where I was.
> That's great. But after a while, if I haven't clicked it, probably I'm never gonna. And so maybe we
> could have, I don't know, 30 second timeout on it, and after that it just disappears, because
> otherwise I have to dismiss it explicitly, and it's just like a slight distraction.
>
> — Greg, 2026-10-17 (spya-vzrjju)

## Part 1: a finger's first tap on a cross-reference reveals, the second jumps

**Today** ([cross-references.md § In the prose](../project/cross-references.md#in-the-prose)):
*"Touch: a tap goes straight there."* A mouse gets the block card on hover; a finger gets nothing and
commits blind. Every other underline in the prose that carries a card already does reveal-then-commit
under a finger — a glossary term, a citation, a footnote marker, an outbound link
([touch.md § What happens where](../project/touch.md#what-happens-where)). The cross-reference was
left out on purpose in 260930f (*"a tap on a block link simply follows it"*), and Greg has now said
he expected the other way.

**Change.** In `BlockLinkCard.tsx`, the card that already draws the cross-reference's preview:

- record recent `pointerdown`/`pointerup` pairs in dispatch order, document-wide — iOS reports their
  type correctly even when its click says `mouse` for a finger (WebKit 282988); only a press on the open
  `data-xref` phrase carries permission to jump, while a press beside it still identifies a
  touch-adjusted click as a finger's;
- decide at the **click**, on `document` in the capture phase (ahead of React's root, so ahead of
  `TableView`'s jump): a finger or pen press whose card was not already open → `preventDefault` +
  `stopPropagation`, and `controls.openNow(el, y, true)`. A finger press whose card was open →
  let the click through: `TableView` jumps as today, the card closes (it is pressed-open, so it
  goes on the scroll the jump makes; and closed explicitly too, so it never lingers on a jump that
  does not scroll).
- A mouse or a keyboard (Enter is TableView's keydown, untouched): jump at once. A finger click
  with any doubt — no permit, a stale or cancelled press, a grouped click — reveals; it never
  jumps (changed after Sol's plan review, below).
- The card says **"Tap again to go there"** (`tip-tap`, the line Structure rows and the spine
  already use) when a finger opened it.

Why at the click and keyed on the `pointerdown` record: the two postmortems
[260915a](../postmortems/260915a-a-tap-judged-at-pointerup-and-acted-on-at-click.md) (a tap's pointer
events and its click disagree) and the rail's fix in 260924c. The reading-time line's press handler in
the same file is the shape this follows.

**Interaction with ProseHoverCard.** `mark.xref` is excluded from its `selector` and `tapSelector`
(`:not(.xref)`), so a term or citation under a cross-reference does not reveal its own card; the
xref still wins the words. Those comments said "excluded, the tap falls through to TableView's click
and jumps" — updated to say the block card reveals it first.

**Not done** (Greg's alternative, "show where it would take me in the Annotation mode"): he said the
tooltip makes more sense, so no Marginalia change.

## Part 2: the *back to ⟨section⟩* chip goes away by itself after 30 s

**Today** `ReturnChip` shows whenever the current history entry carries a jump stamp, and only the ×
or leaving the article removes it.

**Change.** In `ReturnChip.tsx`, a timer per journey stamp: 30 s after the chip appears,
it fades out (≈0.5 s, none under `prefers-reduced-motion`) and then calls `dismissJumpOrigin()` —
exactly what the × does. So browser Back still undoes the jump; only the chip is gone.

- **Restarts on a new journey.** `useJumpStampKey` keys the clock on the whole stamp, including the
  journeys behind it, so another jump from the same block and a press landing on an earlier journey
  both start a fresh 30 s. The callback checks that key again before it strips anything.
- **Held while the reader is on it**: pointer over the chip or focus inside it pauses the timer; on
  leaving, a fresh 30 s starts. A keyboard user who has tabbed to it does not have it vanish under
  them (WCAG 2.2.1 Timing adjustable is about content a user is interacting with).
- **Not the band chip.** `BandBackChip` (*↩ back to ⟨mode⟩*, phone only) is a different thing: the
  band is hidden behind it, has no × on purpose, and timing it out would leave the mode open and
  invisible. Greg's words are about the jump's way back.

Thirty seconds is Greg's number; a constant `RETURN_CHIP_MS` beside the component.

## The simpler options passed over

- **Part 2 without the pause on hover/focus**: one effect fewer, but a chip disappearing under the
  pointer or the focus ring is the one case where a timeout is actively wrong.
- **Part 2 with no fade**: a pill vanishing in peripheral vision is its own small distraction, which
  is what the report is trying to remove. The fade is one class and one CSS transition.
- **Part 1 by putting `mark.xref` in ProseHoverCard's `tapSelector`**: that hook owns the term,
  citation and link cards, not the block card; it would open the wrong card (or none).

## Tests

- `tests/xref-prose.test.tsx`: the finger cases that asserted *a tap jumps* become *first tap
  reveals the block card and does not jump; second tap jumps* (over a term, citation, comment, search
  outline). New: a mouse click still jumps at once; a tap on a different mark re-reveals rather than
  jumping; the hint line shows for a finger only.
- `tests/return-chip.test.tsx`: disappears 30 s after appearing (and the stamp is cleared, as the ×
  does); a new origin restarts the clock; hover/focus holds it.

## Review log

### GPT Sol, plan review — REJECT, seven findings ([answer](261018e-plan-review-sol.md))

The build had started alongside the review; each finding was checked against it.

1. **Doubt let the jump through** (stale press, no press). *Taken.* Recent presses are queued
   document-wide (so a finger landing beside the mark counts), and matched by reliable type/id or
   release order when WebKit labels the click as a mouse; a finger click reveals unless its own
   fresh permit says otherwise.
2. **The chip's clock was keyed on the origin, which ignores `earlier`.** *Taken.* New
   `useJumpStampKey` / `jumpStampKey` in router.ts (the whole stamp, as a string); the clock keys
   on it, and the dismissal checks the key is still the current entry's before stripping.
3. **`mouseup` can land on a comment mark beside the xref before the click does.** *Not taken.*
   That is today's behaviour for any adjusted tap, and the worst case under this change is a card
   beside an opened comment, never a jump. Fixing mouseup/click disagreement for the whole prose is
   its own change.
4. **A single press record lets grouped clicks borrow a permit.** *Taken*: recent presses and their
   permissions are queued in dispatch order, while the first click spends every permission, so a
   grouped second click reveals. Release order also keeps a held trackpad press from stealing the
   delayed iOS click even when WebKit gives that click the mouse pointer's id (tightened after code
   review).
5. **Element identity is wrong for a split phrase.** *Taken*: the open arm and hint are keyed by
   `data-xref` (`phraseOf`), so a Pencil hovering from one marked piece to another keeps the one
   phrase armed (tightened after code review).
6. **The fade is a state.** Pulling it back on hover or focus already worked (test added). *Taken*:
   no fade under reduced motion. *Accepted*: the 3.25rem the chip reserves goes when it does, the
   same snap the × makes today.
7. **Tests and docs.** *Taken*: cases for each seam above; cross-references.md, touch.md and
   url-state.md updated.

### GPT Sol, code review — APPROVE WITH CHANGES, made ([answer](261018e-code-review-sol.md))

Six findings, all fixed by the reviewer and read before commit: the press queue with release order
(a delayed iOS finger click given a trackpad's pointer id), a chip that unmounts its hover/focus
state with it (a removed focused node need not fire `blur`, which would exempt the next journey for
ever), a non-primary contact revoking every pending permit, a permit issued only for a press that
began on the open phrase, the arm keyed by phrase, and timeout tests that also prove no Back was
taken. The press queue is the shape `useHoverCard.ts` § `clickPress` already has for the same
WebKit bug; kept rather than simplified, because a first tap that jumps is the bug being fixed.

### Browser check, Playwright on the box (Sonnet subagent)

Local article `dodo-spya-nyc4ud` (27 cross-references), real CDP touches at 834×1194: first tap
showed the card and "Tap again to go there" with `?at=` and scroll unchanged; a tap on a different
phrase showed that one; a second tap 4–6px off-centre jumped and the chip appeared. At 1440×900 a
hover showed no hint and a click jumped at once. The chip took `return-chip-going` at ≈29.6s and
was gone 0.55s later; a mouse resting on it from 21s to 36s held it, and it went ≈31s after the
mouse left; Back still worked. No console errors. Run before the review changes, which touch only
the edge-case matching the unit tests cover.
[Card](261018e-shot-1-xref-tap-card.png), [chip](261018e-shot-2-return-chip.png).
