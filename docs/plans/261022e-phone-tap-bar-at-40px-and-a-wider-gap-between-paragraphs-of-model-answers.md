# The phone's tap bar at 40px, and a wider gap between the paragraphs of a model's answer

Two open questions from plan
[261021g](261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md), both
answered by Greg on 2026-10-21 with "use your judgment":

> Take screenshots, use your judgment. If you think the answer is a clear-cut yes, then make a
> minimal update to the docs so that you always do this going forwards.
>
> — Greg, 2026-10-21 (`spya-v6c8dz`, on `q-trbv2r`, the tap bar)

> Take screenshots, follow best practices, use your judgment. And if it's, you know, a clear cut
> yes, then make a minimal update, you know, to something, whether it's docs or CSS, core rules or
> templates or whatever, so that, you know, everything's better going forwards by default without
> requiring decisions and judgment and complexity.
>
> — Greg, 2026-10-21 (`spya-rrbbk8`, on `q-x0y2gh`, the chat gap)

## 1. The tap bar (`q-trbv2r`)

On a no-hover screen, tapping a paragraph raises the gutter's icons as a bar above it
([touch.md § The gutter](../project/touch.md#the-gutter-and-the-row-a-finger-is-on)). Measured
before, at 390 × 844 with touch emulated, on `fowler-phrenology`:

| | before |
|---|---|
| each control | 24 × 24, 8px apart (a 32px pitch) |
| the bar | 134 × 30 |
| the line above | 27.2px, so the bar covers 1.1 lines |

**Decision: yes, 40px.** The rule in [controls.md § The numbers](../project/controls.md#the-numbers)
is that nothing a finger presses is under 40, and these four are exactly the things the bar exists
to be pressed for. 24px targets 8px apart are the case the rule was written for. The cost the
question named is real but small. The bar is only there while a paragraph is selected. What it hides
is the tail of the paragraph *above* the finger, not the one being read. It moves from about 1.1
lines to about 1.5.

Drawn as 40px slots with no gap between them, a 40px pitch like the masthead's icons. The glyphs
keep their size. The vertical padding goes from 2px to 0, so the bar is 42px tall (40 plus a 1px
border each side): 1.54 lines at the 27.2px line. It is 4 × 40 + 8 + 2 = 170px wide, against about
330px of prose column. A count beside a mark makes its slot wider, as before.

The size is written once, as a token next to `--blk-slot` in `shell.css`, rather than as a bare 40px:
`--blk-bar-slot: max(40px, 2.5rem)`, per controls.md's "write 40px, never a bare 2.5rem".

**The default for next time**, which is what Greg asked for: controls.md § The numbers gets one
line saying that a control drawn over text is not an exception. Cover more text, or move it; do not
shrink the target. The gutter bar comes off the "still under 40" list.

Passed over: **an invisible halo** that keeps the bar 30px tall and reaches 5px past it above and
below. It would take taps meant for the line above and for the tapped paragraph's first line, which
is the overlap controls.md already rules out. **Pushing the paragraph down instead of overlaying**
is the other half of 261021g's R6 and a bigger change: it reflows the article on every tap.

## 2. The gap between paragraphs of a model's answer (`q-x0y2gh`)

Measured before, identical at 390 and 1280: chat answers are 15.36px on a 23.04px line, with
**9.6px** (`0.6rem`) between paragraphs. In iA Writer Quattro, which is wide and loosely spaced, a
9.6px gap is barely more than the white space between two lines of one paragraph. That is the floor
[typography.md § Vertical rhythm](../project/typography.md#vertical-rhythm) names: once the gap
between paragraphs stops clearly exceeding the gap between lines, the paragraph stops being a unit
the eye can see. The usual default for body text is about one em between paragraphs. It is the
browser's own default for `p`, GitHub's rendered Markdown uses it, and so do the large chat apps.

**Decision: yes, 1em.** That is about 15.4px in chat.

**The same small gap is elsewhere** (survey, 2026-10-22). Every surface that draws a model's
multi-paragraph answer with real `<p>`s picks its own number:

| surface | rule | before | after |
|---|---|---|---|
| Chat, and everything that draws a conversation through ChatPanel: Learn's Recall and Explore, Sources' threads, the chat dialog | `.chat-turn.model p`, `.fmt-list`, `.fmt-quote`, `.fmt-pre` in mode-band.css | 0.6rem | the token |
| the AI's answer to a comment | `.cmt-answer p`, annotations.css | 0.7rem | the token |
| Referee's Candidates answer | none: the browser's 1em, by accident | ~1em | left: already about 1em (review R2) |
| Help's *Ask* answer | `tw:gap-2` in `ANSWER_CLASS`, HelpAsk.tsx | 0.5rem | the token |

**One token, `--answer-gap: 1em`**, in tokens.css, beside the text roles. It is in `em` so it
follows each surface's own size. typography.md gets a short paragraph saying that a model's answer
puts this token between its paragraphs, so a new surface takes it instead of picking a number.

Left alone, each for a reason:

- **Summary** already has 0.9rem between paragraphs.
- **Quiz's reply, Referee's notes and the Guide's offer** are a single `pre-wrap` element, where a
  blank line is already a full line of space.
- **Dig deeper** is folded to three lines until *Read all*, and its parts are short fragments.
  **Glossary's lookups** are one `pre-wrap` paragraph or two. **Marginalia's** preview is one
  clamped paragraph. (Review R4 corrected the first draft of this list.)
- **Nested list items** (`li`, `li p`) keep their tighter spacing, because a list is meant to read
  as one thing.

Passed over: **a rule on `.voice-ai p`.** The voice class says whose words they are, not that they
are an answer, so it would reach captions and one-line notes too. The token is opt-in, one line
per surface. **Matching the article's spacing exactly** was also passed over: the article's 11.9px
at 17px is the same fraction of a line as chat's 9.6px, so it would change almost nothing. And the
article's number is tuned for a serif in a wide column.

## Stages

One stage: the CSS and docs for both answers, before and after shots, the tests, then the Sol
code review.

- `src/web/styles/shell.css`: the `--blk-bar-slot` token. `gutter.css` § a no-hover screen: the
  bar's rows, the controls' `min-width`, `column-gap: 0`, `padding: 0 4px`.
  `tests/gutter-phone-bar.test.ts`: pin that the bar's slot is the token and the token is at least
  40px.
- `tokens.css`: `--answer-gap`. Use it in mode-band.css (chat), annotations.css (`.cmt-answer`),
  and HelpAsk.tsx (`tw:gap-[var(--answer-gap)]`). A test that each uses it, so a later edit cannot
  drop one quietly.
- Docs: controls.md § The numbers, touch.md § The gutter (one line), typography.md (one paragraph).
- Before and after shots at 390 for both, and at 1280 for chat.

## Plan review (GPT Sol, 2026-10-22)

[Answer](261022e-plan-review-sol.md). Exit 0, *build with changes*, four findings.

- **R1 (P1) The controls would still be 24px tall.** `.blk-gutter > *` keeps a 24px `min-height`
  and the controls are centred in the row. Taken: `min-height` as well as `min-width`, and the
  browser pass reads each control's box.
- **R2 (P1) Changing the bottom margin also widens the space after the answer**, before its
  sources and actions, because `p:last-child` rarely matches. Taken, differently from the
  suggestion. Rather than zeroing the outer margins, which would move that space the other way, the
  token is a `margin-top` on the second of two direct-child answer blocks (unclassed `p`, lists,
  quotes, code). It collapses with the existing 0.6rem bottom margin to the larger. So the gap
  between blocks is 1em and the space after the answer is exactly what it was. `.chat-failed` and
  `.chat-stopped` are classed `p`s and are left out. Candidates is dropped from the list, since the
  browser default already gives it about 1em.
- **R3 (P2) Check more row shapes, and the sticky chrome.** First row and the row after a heading:
  checked, below. **Under the sticky chrome**: the bar is `z-index: 3`, beneath the top bar and the
  section breadcrumb at 40. So a paragraph whose top sits within the bar's height of that chrome
  has its bar hidden until the reader scrolls a little. That is not new. What is new is that the
  band is 42px instead of 30. Accepted, not solved. Raising the bar over the chrome would be a
  separate change to how the two stack.
- **R4 (P2) The inventory missed Dig deeper's *Read all*, Glossary's lookups and Marginalia's
  preview.** Corrected above. All three are still left out.

## Results

Playwright with system Chrome: 390 × 844, `isMobile` and `hasTouch` (so `(hover: none)` matches),
DPR 2, and 1280 × 900 for chat. The before and after shots are in the session scratchpad. They are
not committed, because the numbers below say the same thing.

| | before | after |
|---|---|---|
| tap bar | 134 × 30, controls 24 × 24, 1.10 lines covered | 170 × 42, controls 40 × 40, 1.54 lines covered |
| tap bar, first paragraph and the paragraph after a heading | | each control 40 × 40, and `elementFromPoint` at its centre is the control |
| chat gap between paragraphs, 390 and 1280 | 9.6px | 15.4px |
| chat: the space between the answer and its copy button | | unchanged |

## Code review (GPT Sol, 2026-10-22)

[Answer](261022e-code-review-sol.md). Exit 0, *ship*, no findings, no edits. It checked that the
prefixed `tw:gap-[var(--answer-gap)]` is generated in a production build.

A small follow-on, not done: Help's flex gap also puts one em between a heading and the paragraph
under it, where Chat keeps a heading closer to its own text. Help's answers rarely carry headings.
