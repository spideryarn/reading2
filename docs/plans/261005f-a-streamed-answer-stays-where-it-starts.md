# A streamed answer stays where it starts

Queue item `qi-asc74kfd`, from Greg's report `spya-nq847n` (2026-10-05). Up:
[plans.md](../project/plans.md). The area is
[comments.md § The answer arrives a few words at a time](../project/comments.md#streaming) and
`Conversation` in [`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx).

> When I ask a question in a chat or a comment, it starts streaming in the output response from the
> AI. That's great. The problem is that it immediately starts scrolling down so I can't read from the
> beginning of the response. What I would prefer is if it streams in, but stays in position so that I
> can start reading without having to scroll back up to the beginning of the response.
>
> — Greg, 2026-10-05

## What the reader sees today

Ask something in Chat. The question lands at the bottom of the transcript, the answer starts under
it, and from then on every few words the transcript scrolls to its new bottom. Once the answer is
taller than the panel, its first sentence has left out of the top while the reader is still on it.

## Background, in plain words

- One component draws every conversation: `Conversation`. Chat mode in the band uses it; so does
  the block chat panel (`ChatDialog`) in all three of its places (floating, docked over the
  Marginalia column, a card in that column); so do Remember and Explore.
- Its scroller is `.chat-scroll`. An effect runs on every streamed word and, when the reader was at
  the bottom (`stick`), sets `scrollTop = scrollHeight`. **That effect is the report.** It was
  written on purpose (follow the answer down), and what it gets wrong is the premise: a reader
  reads from the top of an answer, at their own speed, and the text arrives faster than that.
- The selection comment box (`CommentDialog`, scroller `.cmt-body`) has no such effect. What it
  does while an answer streams was measured rather than assumed: § The comment box, below.

## What we will do

**While an answer streams, the transcript does not move. When a question is sent, it is put at the
top of the panel once, and the answer fills the panel under it.**

```
before                          after
┌──────────────────┐            ┌──────────────────┐
│ …end of sentence │ ← the      │ Your question    │ ← placed here once, on send
│ four, sentence   │   start    │                  │
│ five, sentence   │   has      │ The answer's     │
│ six, and the     │   gone     │ first sentence,  │
│ words still      │            │ and it grows     │
│ arriving ▍       │            │ downward ▍       │
└──────────────────┘            │                  │
   moves every few words        └──────────────────┘
                                   still; "Latest" appears if it outgrows the panel
```

The parts:

1. **Placing the question at the top needs room under it.** A scroller cannot scroll its last item
   to the top unless there is a panel's height of content below it. So an empty block, the *room*,
   sits after the last turn, exactly tall enough that the question can reach the top, and it
   shrinks as the answer grows into it. When the answer is taller than the panel the room is zero.
   This is what the ChatGPT and Claude apps do.
2. **A hold.** It starts when the last message *becomes* a pending answer (a send, a Retry, an
   Edit), or when a conversation is opened with one already arriving. It is told by that rising
   edge and by the number of turns, not by the message's id, because Retry keeps the id and the
   server's `begin` frame changes it mid-answer (Sol F2). The conversation places the question
   once, and from then on streamed text and the finishing frame (action row, sources) move nothing.
   It ends when the turn count changes without a new answer starting, or when Live speaks (6).
3. **A long question.** If the question is taller than 40% of the panel (a pasted passage, a
   Remember recall), its top would push the answer below the fold. Then the answer's first line is
   placed 40% of the way down instead, and the question's top is above the panel.
4. **Where room would cost: the card.** The card in the Marginalia column sizes itself to its
   content up to a cap, so room under a short conversation would inflate it by most of a screen and
   shove every later note down. So in the card, room is given only when the transcript already
   overflows, which is exactly when the card is at its cap and room costs nothing. Below the cap
   there is no room and no need: one scroll as far toward the question as it will go, and the card
   grows downward. **The card never follows the answer** (Sol F1; the first draft slid until the
   question reached the top, which is the report again for a card's height). `ChatDialog` tells
   `Conversation` which it is, as a prop, not by a stylesheet (Sol F5).
5. **"Latest" says when there is more.** The pill has only ever been updated by a scroll event,
   because content growing used to be followed. Now content can grow past the fold with nobody
   scrolling, so during a hold the effect shows the pill when the bottom is more than 60px away.
   One press jumps to the end; it does not start following.
6. **Live is the exception, and it ends a hold.** Spoken words are heard, not read from the top,
   so they follow the bottom as they do today. Their lines sit after the saved turns without
   changing the last message, so the first spoken line retires any hold and its room in the same
   pass (Sol F3).
7. **A tool row arriving mid-answer.** The wire allows text, then a tool, then more text, and the
   tool strip is drawn *above* the text, so it pushes a first line the reader is on down by a row.
   During a hold, once text has started, a change in the text's offset inside its turn is added to
   `scrollTop`, so the line stays where it was on screen (Sol F4).
8. **The panel changing size.** The "Latest" pill, a growing composer, a keyboard, a collapse and a
   move between card, dock and float all change the scroller's height, and the room depends on it.
   A `ResizeObserver` on the scroller re-runs the same sizing, reads before writes, and writes the
   room only when it changed (Sol F5, F7).
9. **Unchanged:** opening a finished conversation still shows its end. An empty conversation still
   reads from the top.

### Options passed over

- **Just delete the follow** (simplest: two lines). The question sits at the bottom of the panel
  when sent, so the answer streams entirely below the fold and the reader has to scroll to see any
  of it. It trades the report for a worse one.
- **Follow only until the question reaches the top, everywhere** (no room element). The first
  panel-height of the answer still slides upward as it arrives, which is the report in miniature,
  for exactly the lines the reader is on. The first draft kept it for the card; the plan review
  took it out.
- **Resume following when the reader scrolls to the bottom mid-stream.** Today's rule. A reader who
  reads down to the arriving edge would be dragged again from that moment. Not kept: streaming
  never moves the view; the pill is the way to the end.

**Complexity named:** one extra element in the transcript, sized from JS on each streamed word
(geometry read first, then at most one style write and one scroll write; the placement itself needs
a second layout, once per question), and a small state machine (`hold`) beside the existing `stick`. No dependency, no server change, no migration.

## The comment box

Measured before any change (Playwright, system Chrome, 1280×800, `/read/fowler-phrenology`, a Sonnet
subagent). The answer was a stand-in stream, eight paragraphs at about 300 characters a second, fed
through a replaced `window.fetch` in the same SSE frames the client reads, because this box's
OpenRouter key was over its monthly limit that morning. So the client's scrolling is what was
measured, and a model's real pacing is not. `st` is the scroller's `scrollTop`; "start" is the top
of the answer's first paragraph, measured from the top of the scroller.

| Where | Does the start leave the view? | What moved |
|---|---|---|
| Chat in the band, first question | Yes, once the answer passes the panel (664px): `st` 0 → 1230, start 85 → −1119 | `.chat-scroll` only |
| Chat in the band, second question | Yes: the question is at the **bottom** (540 of 664) when the first words arrive, and the start crosses the top at about 1,100 characters | `.chat-scroll` only |
| Block chat from the gutter `?` — it opened as **the card** in the Marginalia column, 331px of scroller | Yes, almost at once: by 360 characters the start is at −160; finally −3440 | `.chat-scroll` only; the card and the page stay put |
| Selection comment box, *Dig deeper* | **No.** `.cmt-body` stays at `st` 0 from first word to last | nothing |
| A comment's card in the Marginalia column | **No.** The open note keeps its box | nothing |

Three things follow.

- **"A comment" in the report is the block chat**, the thing a block's `?` opens and which the
  earlier report called *"a comment chat on a block"*
  ([261003_1931](../user-feedback/261003_1931-block-chat-spinner-and-the-panel-in-the-marginalia-column.md)).
  It is the same `Conversation`, so one fix covers both halves of the report.
- **The selection comment box needs no change**, and gets none. Its answer already grows downward
  from a still start.
- **The card is the block chat's usual place, so part 4 above is not a corner.** In the card a
  first question already sits at the top, so nothing will move at all. A follow-up in a card
  at its height cap gets room like any fixed panel; below the cap the card just grows.

One thing seen and left alone: in the comment box, when a whole-paragraph quote and a long note fill
the box, the answer starts below the fold and nothing brings it into view. It is not this report (the
view does not move), and the path is only reachable on an older comment that already has an answer.

The scripts are in the session's scratchpad, `nq847n-before-*.ts`; the after-check reuses them.

## Stages

One stage; it is one component.

1. `src/web/chat-hold.ts`: the pure arithmetic — where to place (`holdTarget`), how much room
   (`roomNeeded`) — so the numbers are tested without a layout engine.
2. `Conversation`: the hold, the room element, the pill during a hold. `Turn` roots get a
   `data-turn` id so the effect can find the question and the answer.
3. CSS: `.chat-room`, and not drawn in `.chat-dialog.in-column`.
4. Tests, red first: a jsdom test with supplied geometry (the pattern in
   `tests/chat-empty-reads-from-the-top.test.tsx`) that a streamed word does not change `scrollTop`,
   that a send places the question at the top, that the pill appears when the answer outgrows the
   panel, that Live lines still follow; unit tests of the arithmetic.
5. Browser check (Playwright, Sonnet subagent): the same sampling as the before-measurement, on the
   band, the floating panel, the docked panel and the card, at 1280 and at a phone's width.
6. Docs: comments.md § streaming gets the rule and Greg's words; the feedback note.

**Done means:** in a browser, for each typed attempt (a first question, a follow-up, a Retry, an
Edit), in the band, the floating or docked panel, and the card below and at its cap: the first line
of the answer is **on screen** after at most one placement, and then does not move for anything the
stream does, until the reader scrolls or the panel is resized. Live is the stated exception. The
gates are green; GPT Sol has reviewed the plan and the code.

## The browser check

**First pass, on `2902f4d68`** (Playwright, system Chrome, the same stand-in stream, ten paragraphs;
a Sonnet subagent sampling every 200 ms). "Line" is the top of the answer's first paragraph from the
top of the scroller, at the first words → at the end. The page never scrolled, and the console
showed no React warning.

| Case | Line | Room | Verdict |
|---|---|---|---|
| Chat, first question, 1280 | 85 → 85, then 112 at the finish | 0 | held; **+27 at the finish** |
| Chat, second question | 121 → 121, then 148 | 434 → 0 | held; +27; **question at 47, not 11** |
| *Latest* mid-stream | pill appeared; one press went to the end; `scrollTop` then fixed at 2499 while the content grew 3118 → 4633; pill came back | | pass |
| Block chat card, first question | 183 → 183, then 210; card top fixed at 221, bottom grew to its cap | 0 | held; +27 |
| Same card, follow-up at its cap | 147 → 147, then 174 | 107 → 0 | held; +27 |
| Floating panel (900 wide), first and follow-up | 135 → 135 → 162; 123 → 123 → 150 | 0; 199 → 0 | held; +27 |
| Phone 390×844, first and second | 85 → 85 → 112; 122 → 122 → 148 | 0; 509 → 0 | held; +27 |
| A 1,500-character question | line at 230 of 599 (0.38), question top −420 | 294 → 0 | pass |
| Retry | placed again, then held | 294 → 0 | pass |
| Reload a finished conversation | opens at its end | 0 | pass (unchanged) |

Two things it found, both fixed afterwards:

- **+27 px when the answer finishes.** Every question's pencil row was withdrawn while an answer
  arrived and came back when it ended, so each question grew a row above the line being read. The
  row now keeps its height throughout, empty. And the hold no longer only *leaves `scrollTop`
  alone*: it remembers where its anchor is on screen and puts it back, which also covers a tool row
  (Sol F4) by the same rule instead of a special one.
- **A follow-up question landed 36 px low.** The "Latest" pill was showing when the question was
  sent; placing cleared it, the panel grew by the pill's row, and the browser clamped `scrollTop`
  before the room was re-sized. The same put-it-back rule, run from the resize observer, fixes it;
  and the room is now sized for wherever the view is as well as for the placement, so shrinking it
  cannot clamp a reader who scrolled down into it.

*The second pass, on the reviewed code, is below the code review.*

## The plan review

[GPT Sol's review](261005f-a-streamed-answer-plan-review-sol.md) said **rework**, seven findings, all
taken: F1 the card must not follow (part 4); F2 the hold's trigger (part 2); F3 Live retires a hold
(part 6); F4 a tool row mid-answer (part 7); F5 placement and size changes (parts 4 and 8); F6 a
"done" that requires the line to be visible (above); F7 the layout-cost claim, reworded. One thing
kept that it would have deferred: room in a card at its cap, because a block chat's follow-up is the
"comment" half of the report and without room its answer would stream below the fold.
