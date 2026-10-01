# 261001r — the reading-time line gets a rich card; cross-references quieter than the glossary

Two admin suggestions about marks in the prose, both filed by Greg on 2026-10-01 against the same
article. Provenance confirmed with `scripts/feedback-reporter.ts` (both rows are an administrator's).

## 1. The reading-time line (spya-mn3ruw, SPIDERYARN-READING2-8S)

> We have a vertical line next to the block that indicates how long you've spent reading it […] The
> tooltip, firstly, can you make it a rich tooltip? And indeed, make a note somewhere that we always
> prefer to use our rich tooltip machinery because they're just more attractive. […] that vertical
> line […] like it gets darker the longer you have been reading it. I'm not sure if that's great. It
> almost looks, because the background is black, so it almost looks like it's getting brighter,
> whiter, certainly more visible against the black background the longer I've been reading it […]
> In other words, there's no visible line at first, and then for stuff I've been reading a lot, there
> is a visible line, and that visible line would have to be, you know, whitish to show up against the
> default black background.
>
> — Greg, 2026-10-01

### What is actually wrong

The line is already drawn in `--ink` (the foreground — near-white, since the app is dark only:
`styles/tokens.css`), at `opacity: --read × 0.1`, so it *does* get lighter and more visible as you
read. **The words are wrong, not the drawing**: the native `title` says "this line gets darker the
longer you spend reading here", copied from light-theme thinking. The changelog of 2026-09-29 says
the same. So Greg read "darker" and saw "brighter", and was rightly confused.

There is no light theme to check against (styles/tokens.css: "DARK ONLY, unconditionally"). The
colour stays a token (`--ink`), so if one ever arrives the line inverts with it.

### What we do

1. **The words**: "gets stronger / more visible", never "darker".
2. **A rich card, not a `title`.** The gutter cannot have a `Tooltip` per row — BlockGutter.tsx
   already explains why for the permalink: a Floating UI instance per trigger, several hundred
   triggers. The reading view already has **one delegated card for many triggers**:
   `BlockLinkCard` (BlockLinkCard.tsx), a document-level `pointerover` / `focusin` and
   `setPositionReference`. Add `span.blk-read` to its selector and a third branch to `contentFor`.
   - Head "Reading time", then one sentence saying how much of this passage you've spent (from the
     row's `--read` level, read off `getComputedStyle` — the level is already the one source, put
     there by `ReadingTimeStyle`), then what the line is and its two unguessable facts: it counts
     only while the passage is on screen and you are active, and only you see it.
   - **Positioned at the pointer's height**, not the strip's top: the strip is the whole block's
     height, and a card above a 20-line paragraph's top is nowhere near the pointer. A virtual
     reference whose rect is the strip's x at the hover's y offset, with `contextElement` the strip
     so scrolling still tracks it.
   - Touch: unchanged (the delegated card already returns on `pointerType === "touch"`); the doc
     already says "Nothing yet on touch".
   - The `title` goes, so the browser's own tooltip doesn't double the card. `aria-hidden` stays —
     the line is decoration and nothing about reading time is announced.
3. **A slightly steeper ramp**, so a passage you have read through is plainly visible and one you
   have glanced at barely is: opacity `0.02 + level² × 0.03` → 0.05, 0.14, 0.29, 0.50 (was 0.1, 0.2,
   0.3, 0.4). Greg's "no visible line at first, and then … a visible line".
4. **The note Greg asked for**: tooltips.md gets a short section, *Prefer the rich card to a native
   `title`*, with his words, and the exceptions that stand (a `title` where a card per trigger is
   too many instances *and* no delegated card fits yet). design-css-overview.md's line for
   tooltips.md says so too, so it is signposted from the design map.

**Passed over**: a third delegated-card file of its own for the line (`ReadingTimeCard.tsx`). It
would be a second copy of ~150 lines of hover-intent, detach and dismiss logic that BlockLinkCard
already has right; the cost of reusing it is that "the card every block link shares" also describes
one non-link, which its header will say.

## 2. Cross-references vs. the glossary (spya-sxvq2j, SPIDERYARN-READING2-8W)

> it's a little bit difficult to tell the difference between them and the glossary. Maybe because
> they both kind of look like dotted lines […] those internal links are probably less important than
> the glossary. So visually the glossary links should be a bit more prominent.
>
> — Greg, 2026-10-01

Today (annotations.css):

| mark | rule |
|---|---|
| glossary `mark.term` | 1px **dotted** `border-bottom`, orange at 45% |
| cross-reference `mark.xref` | 2px **dotted** `text-decoration`, orange-ink at 75% — the *heavier* of the two |
| citation `mark.cite` | 1px dashed `text-decoration`, grey |
| author's own link | orange text, 1px solid underline |
| comment `mark.cmt` | 1px solid orange `border-bottom`, ✳ |

So the cross-reference is both the same shape and the louder one — exactly backwards.

**Change**, CSS only:

- **Glossary louder**: `2px dotted`, orange at 70% (hover 90%). Still a dotted rule in the orange, so
  it keeps its identity and still never recolours the author's words.
- **Cross-reference quieter and a different shape and hue**: a `1px solid` underline in grey
  (`--ink-soft` at ~55%), offset 3px. Hover turns it the link hue (`--highlight-ink`) with the
  existing wash, so it still announces itself as the one mark a click follows. Focus ring unchanged.

Now each of the five differs from its neighbours on at least two of shape, hue and weight: glossary
is the only *dotted orange* line; the cross-reference is a thin *solid grey* one; the citation a thin
*dashed grey* one.

**Passed over**: a small trailing glyph on the cross-reference (an arrow, like the comment's ✳). The
most distinctive option, but it needs an end-of-phrase marker in annotate.ts like `data-mark-end`,
and it adds ink to every linked phrase where Greg asked for less. The underline change is the
simpler first step; the glyph is the next one if solid-grey vs dashed-grey (citation) turns out to
be confusable in use.

## Tests

- block-gutter.test.tsx's `title` assertion changes: no `title` on `.blk-read`.
- A jsdom test that hovering a `.blk-read` opens the shared card with the reading-time head, and that
  its words say "more visible" / never "darker". Red first against the old `title`.
- reading-time.md, cross-references.md, glossary.md (if it describes the rule's weight) and
  tooltips.md updated where they state the old look.

## Browser check (on the box, Playwright)

A Sonnet subagent, per browser-control.md: an owner article with reading time and cross-references
and a glossary, experimental switch on; screenshot the gutter line at a few levels, hover it and
screenshot the card; screenshot a paragraph with both a glossary term and a cross-reference.

## Plan review (GPT Sol, 2026-10-01) — what changed

All seven findings checked and taken (`…-plan-review-sol.md`):

1. **P1** `0.02 + level² × 0.03` is 0.02 at level 0, and the 2px `::after` is not clipped by the
   zero-width strip — a faint line on every unread row. Now `level × (level + 1) × 0.025` → 0, .05,
   .15, .30, .50, and tests/gutter-target-size.test.ts's pinned value moves with it.
2. **P2** A level sentence read once from CSS would go stale while the card is open. **Dropped**: the
   card explains what the line means, not how far you got — the line itself says that.
3. **P2** `mark.cmt.term` would inherit 2px from the term; it keeps `border-bottom-width: 1px`, so the
   comment still wins the overlap as before.
4. **P3** The virtual reference recomputes `strip.top + offset` on every call; the real span stays in
   `shown.el`; selector `.blk-gutter > span.blk-read`; no `aria-describedby` on an `aria-hidden`
   trigger.
6. **P3** Wording: "while this passage is visible in the reading view, the page is visible, and you
   have been active in the last five minutes".
7. **P3** Citation vs cross-reference differ by shape and intensity, not by hue — corrected above in
   spirit; both are thin grey.

## Code review (GPT Sol, 2026-10-01) and the browser check

No P0–P2 (`…-code-review-sol.md`). Sol fixed three P3s in place: re-entering the strip before the
close delay now moves the card to the new pointer height; the tests were tightened (the touch case
had passed before the change; now it dismisses an open card, and `pointerout` to the cell, `tip-soon`
and re-entry are pinned); tooltips.md lists all five remaining gutter `title`s. Its fourth, a stale
`mark.term[data-open]` in glossary.md, was fixed too.

Browser, on the box (Playwright, Sonnet subagent): `::after` opacity measured 0, .05, .15, .30, .50
for levels 0–4, with the level-0 strip 0px wide; the card opens 9px above the pointer two-thirds down
a tall paragraph, with no `title`; the permalink beside the strip still gets its own hover; the term
is `2px dotted` orange at .7 and the cross-reference `1px` solid grey at .55, which turns orange on
hover. No local article has real cross-references, so that mark was injected by hand to compare its
look.
