# 261003p — the block chat's spinner, and the panel docked in the Marginalia column

Report `spya-nseuz2`, from Greg, 2026-10-03, on the Entropy article with a Structure band open and
Marginalia on (`?mode=structure&margin=1&thread=…`):

> I just had a comment chat on a block, so I clicked the comment button and asked, or maybe I clicked
> the question button and then the AI responded. Okay, great. A couple of thoughts. One is, can we
> have a loading spinner when we're waiting for the AI? I think it says something faint like waiting
> for answer, but it'd be better to have a loading spinner. And then secondly, I think now that we
> have a right-hand column that we sometimes use for marginalia, why don't we put the block-level
> chat comment in that right-hand column? I'm not 100% sure this is a good idea. So, you know, if you
> disagree, I mean, maybe we could situate it relative to the block, but I don't want to make things
> too complicated either. I want to kind of make it clear that it's a block-level comment somehow.
> But at the moment, it kind of shows up in this own panel that kind of occludes things, and I mean,
> it's okay, but I just feel like it's more in the way than it would be if it was in the right-hand
> column. So see if you can come up with a good solution.take some screenshots.

Two things, and they are two stages. Nothing here touches the server, a prompt, the store or a URL
parameter; it is client rendering and CSS only.

## What is there now

The panel is `ChatDialog` ([`src/web/ChatDialog.tsx`](../../src/web/ChatDialog.tsx)), `position:
fixed` in the bottom-right corner, 26rem wide, up to 34rem tall
([`dialogs.css`](../../src/web/styles/dialogs.css) § `.chat-dialog`). It holds `Conversation` from
[`ChatPanel.tsx`](../../src/web/ChatPanel.tsx), the same transcript and composer the Chat band uses.

**The wait.** A model turn that is `pending` draws, in `Turn` (ChatPanel.tsx, the block starting
`const thinking =`):

- a 13px `LoaderCircle` and the word *thinking…*, in `--ink-faint` at 0.9rem — **only while there is
  no text and no tool row at all**;
- once a tool has run, the tool strip, whose *running* row has its own 12px spinner;
- once words arrive, a blinking cursor.

And the composer's placeholder reads *Waiting for the answer…*, in placeholder grey. That is the
"something faint" Greg read. Two faults:

1. **There is a state with no spinner anywhere**: `pending`, no text yet, a tool strip whose every
   row has finished (the model has its search results and is writing its first word). `thinking` is
   false because `tools.length > 0`; no row is `running`; there is no text for a cursor to follow.
   On a block question that reaches for the web this is seconds long, and the only thing saying
   "working" is the grey placeholder. This is a bug, and gets a red test.
2. **Where the spinner does show, it is small and faint**: 13px beside faint 0.9rem words, easy to
   miss in a 34rem panel.

## Stage 1 — the spinner (clearly wanted; ship)

In `Turn`:

- `waiting = pending && text === "" && !recovering && no tool row is running`. That is the old
  `thinking` plus the gap. A running tool row keeps its own spinner and `waiting` stays false then,
  for the reason already in the comment there: two spinners for one wait.
- The line reads *thinking…* throughout. (The first draft said *writing the answer…* once a tool
  had finished; Sol F5: a finished tool does not mean the answer is next, the model may ask for
  another.)
- The spinner goes from 13px to 16px and the words from `--ink-faint` to `--ink-soft`, so it reads
  as a status rather than a footnote. Still `.cmt-spinner`, the house inline spinner
  ([loading-spinner.md](../project/loading-spinner.md): `LoaderCircle` wherever something else is
  already drawn; the wordmark is for a whole empty page, and would outshout a transcript).
- **No `useSlow` gate.** The 600ms rule is for a wait that is usually over before it could be seen;
  a model's first word never is, and the turn is already on screen with nothing in it. The existing
  spinner has no gate either. Said here because loading-spinner.md states the rule as shared.

The composer placeholder stays. It is the box saying why it will not send, not the wait indicator.

This changes the Chat band, Remember and the floating panel alike, since they share `Turn`. That is
intended: the gap is the same gap in all three.

**Tests** (red first): a `Turn`-level render test — `tests/chat-turn-waiting-spinner.test.tsx` —
over the five states: nothing yet (spinner, *thinking…*); tool running (strip spinner only); tools
all done and no text (**red today**: spinner, *writing the answer…*); text arriving (no waiting
line); recovering (the reconnecting line only). If `Turn` is not exported, export it for the test
rather than render the whole `Conversation`.

## Stage 2 — the panel docks in the right-hand column when that column is showing

### The options weighed

```
 today                        A. docked (built here)         B. a card level with the block

 | band | prose      |notes|  | band | prose      |[chat ]|  | band | prose      | note  |
 |      |            |     |  |      |            |[     ]|  |      | ¶ ……………… [chat ]|
 |      |      +---------+ |  |      | ▌¶ ………… ▐  |[     ]|  |      |            [     ]|
 |      |      | chat    | |  |      |            |[ box ]|  |      | ¶ ………      [ box ]|
 |      |      +---------+ |  +------+------------+-------+  |      |              note |
   covers prose and notes       covers the notes only          scrolls away with its block
```

- **A. Dock the existing panel in the column.** Same component, same slot in the tree, one class.
  When the Marginalia column is on screen, the panel is `position: fixed` over the column rather
  than over the corner: it starts at the prose's right edge, so it covers notes and never prose.
  The block it is about wears a mark, so the tie to the block is in the prose rather than in the
  panel's position. Cost: one pure function, one prop, about thirty lines of CSS. Gives up: the
  panel is not *beside* its block, and it hides the notes while open.
- **B. Render the conversation as a note in the column, level with its block.** The most literal
  reading, and the closest to [interface-vision.md](../project/interface-vision.md)'s right column.
  Costs that A does not have: a conversation is routinely taller than its paragraph, so it runs down
  past later blocks and `useMarginLayout` would push every later note below it; the composer and a
  streaming answer scroll off screen with the block (the floating panel exists so a reader can ask
  and read on); the keyboard-inset and focus contracts are written for a fixed panel; and the notes
  are `user-select: none` and 13px by design, neither of which suits an answer the reader wants to
  read and copy. This is a second chat surface, not a move.
- **C. Leave the panel, and only mark the block.** Cheapest; answers "make it clear that it's a
  block-level comment" and nothing about "in the way".

**A is built**, because it is the simplest version that gets most of what was asked (out of the
prose's way, in the right-hand column, visibly about a block), it is a class on an existing panel
and so trivially undone, and Greg asked for simple. **B is the open question for Greg**, with
screenshots of A to decide against — [Q-margin-chat] in the debrief.

### What A does, exactly

- **When it docks.** `chatDock(fit, windowWidth)` in [`layout.ts`](../../src/web/layout.ts), pure:
  the room is from the column's left edge (`fit.margLeft`) plus `CHAT_DOCK_INSET` to the window's
  right edge, less a 12px gutter (Sol F3: the inset comes off before the minimum is applied). The
  helper returns that room in px or `null`; Reader passes it down and the panel writes it as
  `--chat-dock-room`, so the cap stays in CSS as `min(26rem, var(--chat-dock-room))`. Docked when `fit.margW > 0` and that room is at least `CHAT_DOCK_MIN` = 272px
  (17rem). Below that the panel floats exactly as today: a 200px chat is worse than an overlapping
  one. So: Marginalia off, a phone, a covering band, a narrow iPad portrait — all unchanged.
  The panel's width is `min(26rem, the room)`: on a wide window where the centred prose leaves more
  than the column beside it, the panel keeps its full width and still clears the prose.
- **Where.** `.chat-dialog.docked`: `left` at the column's edge (`--safe-left + --marg-left`, the
  same expression `.marg-head` uses, plus `CHAT_DOCK_INSET` = 10px so the gutter icons stay
  clear), `right: auto`, and **the bottom anchor, height and `--kb-inset` exactly as the floating
  panel has them**. So it is a horizontal dock only: the panel sits in the lower part of the
  column. A lighter shadow, since it no longer floats over prose. (The first draft anchored it to
  the top of the column; Sol F1: that drops the iOS visual-viewport contract the bottom anchor
  already keeps. It also leaves `.marg-head` uncovered, which answers most of F2.)
- **Narrow screens.** No Marginalia column on a phone (`fitMargin`: none below 612px), so no dock,
  and the panel is today's. That is the answer to "what about a phone", and it needs no new code.
- **Marginalia off.** Unchanged in v1. Docking into the free room beside centred prose with
  Marginalia off, or opening the column on a block chat, are both possible later; neither is asked
  for and each moves something the reader did not touch. Named in the question.
- **The block's mark.** While the panel is open on a block (floating or docked, any width), that
  block's `td.text` carries `chat-open`: a 2px accent rule down its right edge, the side the gutter
  icons and the column are on. The block id is the draft's `anchor.blockId`, or the open thread's
  anchor from `owner.chatAnchors`. No mark for an unanchored thread. A rule rather than a wash:
  the flash and the search hit already use the wash.

**Tests**: `chatDock` in `tests/layout-margin.test.ts` (no column → not docked; column with 272px →
docked at that width; wide window → capped at 26rem; band + column). A render test that
`ChatDialog` carries `docked` only when told to. The mark: a test at whatever seam `TableView`
already takes per-block classes through.

**Browser check** (Sonnet subagent, Playwright on the box): desktop 1440 with band + Marginalia
(Greg's own layout), desktop with Marginalia alone, iPad landscape 1180 and portrait 820, phone
390. Before and after screenshots of the same state, into `docs/plans/` as
`261003p-shot-*.png`. Things to look for: the panel never over prose when docked; the composer
reachable; the spinner visible in the gap state; the block's mark; the floating panel unchanged
where it should be.

## Docs

- [comments.md](../project/comments.md): nothing in it describes the floating chat's position
  beyond "the floating chat dialog"; add a short section naming the dock and the mark.
- [marginalia.md](../project/marginalia.md): one paragraph — the column also holds the block chat
  while one is open, and when.
- [loading-spinner.md](../project/loading-spinner.md): one line under the 600ms rule saying a model
  turn already on screen is not gated, with the reason.
- `/help`: check whether it describes where the block chat appears; update if so.

## Not doing

- Option B (above), pending Greg.
- `CommentDialog` and `AnnotateDialog` share the corner and are not moved. The report is about the
  chat; moving the other two is the same class and can follow if A is liked. Named in the question.
- No change to what Marginalia's notes show.

## GPT Sol on the plan

[261003p-review-plan-gpt-sol.md](261003p-review-plan-gpt-sol.md): build after changes. F1 (top
anchor loses the keyboard contract), F3 (the inset) and F5 (the wording) taken as above. **F2**
(the docked panel covers Marginalia controls that Tab still reaches): with the bottom anchor kept
the head is no longer covered; the notes under the panel are covered exactly as the floating panel
covers them today, in the same corner, so this is no regression and nothing is made inert. Left as
is, and named here so it is a decision. **F4** (a `docked` prop test passes if Reader never sets
it): the browser check asserts the panel's real bounds against the prose's right edge in an
eligible layout, and that it is *not* docked in an ineligible one; a Reader-level unit test only if
a harness for one already exists.

## Progress

- 2026-10-03: plan written.
- 2026-10-03: Sol's plan review in; stage 1 built (red first: the tools-all-done case had no waiting line).
