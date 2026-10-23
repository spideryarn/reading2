# The reading measure, counted in real characters

Report `spya-vywcpu` (#673), Greg, 2026-10-21 23:02 UTC, portrait iPad, Plain view, Rovelli's
*The Order of Time*. Admin, so trusted input (`feedback-reporter.ts` exit 0).

> I did a rough count of the number of characters visible horizontally, and I think it was more like
> 70. … I thought we had done some research on the ideal sort of reading width … between sort of about
> 45 and 65. So it seems as though the column is now a bit too wide. … where we can, stay within these
> bounds. … on a portrait iPhone … keep the margins horizontally as absolutely small as possible …
> when we have space, that we are optimizing the reading experience. … If there are other things that
> make a difference, I don't know, line spacing, paragraph spacing, blah blah, then let's try and
> optimize those too.
>
> — Greg, 2026-10-21 (`spya-vywcpu`)

## What is actually wrong

**He counted right: 70.** Measured in Playwright at his window (725×967, from the diagnostics of
`spya-e5t77w`, his report from the same iPad nine minutes later), Plain view, 933 full lines of an
essay: median **70** characters per line, 10th–90th percentile 62–75, longest 80. The same at 820,
1440, and at text size Large. The research doc has the table:
[261022a](../research/261022a-reading-measure-line-spacing-and-paragraph-spacing-evidence.md).

**The cause is the unit, not the text size.** `--reading-measure` is `65ch`, and `ch` is the width of
a "0", not of a character. In Source Serif 4, the author's face since 2026-10-02, the zero is 8.82px
at 17px and the average prose character (letters and spaces) 8.19px, so 65ch holds ~70. The number
was carried from the previous app, whose face was Arial/Geist, where the gap is wider still
(stand-in fonts measured ~82). Nobody ever counted.

**The text size was not what he thought.** That nine-minutes-later report says `textSize: default`.
The setting lives in `localStorage` per device and per web-app context, so the home-screen app may
not have his Safari setting; and since the measure is in `ch` it would not have changed the count
anyway, at any size where the column fits. Mentioned to him; nothing to build.

## The evidence, briefly

[261022a](../research/261022a-reading-measure-line-spacing-and-paragraph-spacing-evidence.md):
comprehension is flat across roughly 45–100 characters in most screen studies; speed rises with
length; readers prefer about 55–75 and rate ~55 easiest; craft tradition says 45–75 with 66 ideal.
So Greg's 45–65 sits inside the evidence, and nothing argues for going above it. Leading 1.2–1.6 is
a flat optimum and 1.8 hurts; nothing supports changing our 1.6. Paragraph spacing has no screen
evidence at all. It also found that the "80 characters read 7% faster and comprehend 12% worse"
line in our comments is not in the paper cited (Dyson & Kipping 1998 tested 25/55/100).

## The change

1. **`--reading-measure: 56ch`** (from 65ch), in `styles/tokens.css`. In Source Serif that is
   ~494px at 17px: a median of about 60 characters, so the 90th percentile lands near 65 and the
   longest lines near 70. Aiming the median at 65 would put a third of lines over Greg's ceiling;
   60 puts nearly all of them under it, and is still inside every recommended band. Because it is
   still `ch`, it scales with the text size: at Large and Largest the column widens in px and holds
   the same ~60 characters while there is room, and narrows in characters only when the window runs
   out — which is the behaviour he described ("the column may get narrower as the text size goes up"
   is what the window does; the cap never goes over).
2. **Everything else that reads the token follows with no edit** — the masthead boxes, the gutter's
   position, footnotes, the matter stub, Quiz and Skim's article-measure boxes. All of them use
   `var(--reading-measure)`, which is why the tests assert the variable rather than a number.
3. **Correct the comments** that state 65ch as current or quote the Dyson & Kipping figures
   (`styles/tokens.css`, `prose.css` header, `layout.ts`'s `PROSE_ALONE_MAX_REM` comment, which
   also says 65ch is "≈46rem" when it is 35.8rem at 16px).
4. **`PROSE_ALONE_MAX_REM` comes down with it — stage 2, held for Greg (§ Stage 2, held).** The plan said leave it at 49; GPT Sol's
   plan review showed it is not just Plain's whitespace. It is what `fitMargin` and `fitBoth` place
   Marginalia against, and what `spareBeyondTheMeasure` subtracts before a band may widen. And it
   was already stale: 49rem was "65ch ≈ 46rem" in *Geist*, and since the author's face became
   Source Serif on 2026-10-02 the same 65ch was 35.8rem, so Marginalia has sat ~200px from its
   paragraphs and bands have waited ~240px longer to widen for three weeks. New value: 34rem (56ch
   is 30.9rem, plus 1.4 + 0.7 of pad and inset, rounded up a whole rem so a fallback serif cannot
   clip it). It moves 28 hand-derived numbers in four test files, including the 1600px chat-card
   shift Greg tuned by eye, so it is **its own stage, after stage 1 lands**, with Marginalia, the
   chat card and a band screenshotted at 1024 / 1280 / 1440 / 1600 / 1920. Visible effect: in Plain
   none; with Marginalia the notes come ~120px closer to their paragraph; with a band on a 980–1364px
   window the band is up to 144px wider and the prose exactly as wide. That last is Greg's own rule
   from 2026-10-01 (spya-xebdgz) — the band takes the page the prose cannot use — applied to the
   page it was never told about.
5. **The rule goes into [typography.md](../project/typography.md)** as § The measure, counted in real
   characters: when there is room, a reading column holds about 60 characters (median) and at most
   65 on most lines; `ch` is a zero, not a character, so any new measure is set by counting in a
   browser, not by writing the number of characters as `ch`; the phone margins are as they are and
   why. With the command that counts.
5b. **Blockquotes and callouts** were a fixed `58ch`, narrower than 65 and wider than 56; they become
   `calc(var(--reading-measure) - 7ch)` so they stay inside the body whatever the measure is (Sol's
   plan review). Captions stay 48ch.
5c. **A footnote mark no longer opens up its line.** Seen in the first screenshot: a line with a
   `<sup>` sat 31px from its neighbours against 27. `.prose :is(sup, sub) { line-height: 0 }` —
   measured 31 → 27/28 on the same paragraphs, red then green.
5d. **Stale words swept**: every current-tense `65ch`, the /design page's "thirds" (the gaps have been
   quarters since 2026-08-28), and the Dyson & Kipping figures, corrected in place in
   original-version/typography.md.
6. **The counting script is committed**, as `scripts/measure-line-length.ts` (Playwright, signs in
   through `scripts/browser-sign-in.ts`, prints median/percentiles per window for a given article),
   so the rule is checkable and the next face change gets counted. It was red on the old measure
   (median 70, p90 75 → exit 1) before it was green (60 / 64 → exit 0), which is the reason to
   trust it. It also fails when a window 1000px or wider has a column narrower than the measure:
   the cap clipping it, the stage-2 mistake it is there to catch.

## Stage 2, held

Built and then not landed, 2026-10-22. With the cap at 34rem, 28 tests moved and four of them
were invariants, not hand numbers, which showed what the change really is:

- **Bands widen from a 980px window, not 1220.** `spareBeyondTheMeasure` gives a band whatever the
  prose cell cannot use, so a smaller cap is a lower threshold. At a 16px root the standard band
  goes 400 → 444 at 1024, **400 → 544 at 1194 (iPad landscape)**, 460 → 544 at 1280, and is 544
  either way from 1366. Greg said of exactly those windows, "the way it works right now for
  slightly narrow windows is pretty good, so we don't want to screw that up" (spya-xebdgz), and
  544 is the landscape Tweets band he asked to be narrower on 2026-09-30 (6G).
- **Tweets' wide band fell below the standard one** between ~980 and ~1300, because its lower bound
  is the unwidened standard band; it would need `max(standard, spare)`.
- **At a 9–11px root the prose went below `MODE_PROSE_FLOOR`** and the roomy band overflowed: 34rem
  + gutter is 330px at 9px. It would need the spare taken against `max(cap, PROSE_MIN)`.
- What it buys is Marginalia's notes ~120px closer to their paragraph (a ~157px gap → ~37px at 1440).

So it is a product trade-off, not a stale number, and the question offers: both (A), Marginalia only
with a separate "bands widen from" number (B, recommended), or neither (C). The 34rem version of
value and its derivation are item 4 above; whichever of A or B is chosen, the two invariant fixes
above go with it.

**Answered 2026-10-22**: *"Maybe somewhere in the middle? Dunno. Take screenshots, use your
judgment."* The cap came down to 42rem, with both invariant fixes:
[261023a](261023a-reading-column-cap-a-middle-value.md).

## What is not changing, and why

- **Phone margins.** At 390 wide on a touch screen the first glyph is 21.6px in (the 12px spine plus
  0.6rem) and the last ends 20px from the edge (`max(1.25rem, 19px)`, which holds the reading mark
  and its inset — 261019d). That gives 42 characters. The only slack left is a few pixels of the
  left pad, under half a character; the two earlier rounds Greg asked for (261018g, 261019d) took
  the rest. Left as is.
- **Line spacing**, 1.6: inside the evidence's flat optimum; nothing measured says a narrower measure
  wants less. Convention suggests 1.45–1.5 at ~40 characters on a phone; that is taste, not
  evidence, so not done unasked.
- **Paragraph spacing**, 0.7em: no screen evidence either way. The researcher's suggestion of
  0.8–1em is a judgement call, and Greg has brought this exact gap down twice (typography.md §
  Vertical rhythm). Not changed.
- **Text size not syncing** between Safari and a home-screen app: per-device by design (261019g).

## Simpler option passed over

Leave `65ch` and only document it. Rejected: it is the measure he asked to change, and the fix is one
token.

## Verification

- The script before and after, at 725/820/1440 (mouse), 725 touch at Default/Large/Largest, 390 and
  375 touch: median ≈ 60, p90 ≤ 66 wherever the column is at its cap; phones unchanged.
- Screenshots of Plain at 725 and 1440, and of one band mode (Quiz or Skim) whose box reads the
  token, in a Sonnet subagent.
- `npm test`, `npm run typecheck`.

## Status

- [x] GPT Sol plan review — go with changes
  ([review](261022d-reading-measure-in-real-characters-plan-review-sol.md)): all five taken —
  the cap (stage 2), blockquote/callout, the test claim, the comment sweep, /design's copy
- [x] Stage 1: the measure, the quotation and callout, `sup`, the rule, the script, the sweep —
  measured after: median 60, p90 64, max 69 wherever the column is at the measure, at every
  text size; phones unchanged (42 / 40)
- [x] Stage 2 **not built; put to Greg as [q-z3j0ep](../user-feedback/questions/q-z3j0ep.md)**
  (see § Stage 2, held). `layout.ts`'s comment says the cap is known loose and why; the two tests
  that said "under a rem of slack" are now `it.fails` against the true ~31rem measure, red on 34
  and green on 49, so they turn red the day it comes down
- [x] GPT Sol code review — ship with fixes, made
  ([review](261022d-reading-measure-in-real-characters-code-review-sol.md)): the counter now also
  fails on an implausible or too-short median and a missing measure (its silent-success hole), and
  more stale 65ch wording was corrected. One of its edits was put back: it had deleted
  narrow-window.css's written-down small-root title drift, which still holds at 56ch; restored,
  marked as measured at 65ch. Counter re-run green, touched suites and typecheck green
- [x] Note: [261021_2302](../user-feedback/261021_2302-reading-measure-in-real-characters.md);
  question q-z3j0ep published
