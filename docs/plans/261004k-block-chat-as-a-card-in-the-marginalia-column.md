# 261004k — the block chat as a card in the Marginalia column (option B, on trial)

Queue item `qi-9gtawaxd`. Follows
[261003p](261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md), which shipped option A
(the chat panel docked over the bottom of the Marginalia column) and left B as [Q-margin-chat].

Greg, 2026-10-04, answering it:

> Q-margin-chat I'm not sure what's best. Shall we try B, and see how it goes. Make it
> expandable/collapsible.

And two reports the same afternoon, both on Bitter Lesson with Structure + Marginalia open.

`spya-ntb7p6`:

> I had made a suggestion about moving the chat into the right-hand sidebar. If we've initiated a
> comment chat or a question chat for a particular block, I don't know if you've done that already.
> If you have, it's not taking up enough space, and so on my very wide screen it's incredibly narrow,
> whereas the actual right-hand sidebar column is wider than the space given to the chat.

`spya-f6dpj5`:

> In the Marginalia mode for a question-on-a-block, it says "question about this paragraph"
> collapsed. Ok, so I clicked on that, and then it says "question about this paragraph" again
> underneath when expanded.

Client rendering and CSS only. No server, prompt, store, or URL parameter changes.

## What B is

```
 A (shipped, kept behind the switch)        B (this plan)

 | band | prose      |notes |               | band | prose        | note            |
 |      | ▌¶ ………… ▐  |      |               |      | ▌¶ ……………… ▐  [ chat card      ]|
 |      |            |[chat]|               |      |              [  transcript    ]|
 |      |            |[box ]|               |      | ¶ ………        [  composer      ]|
 +------+------------+------+               |      |                note (pushed)   |
  fixed to the window's bottom                scrolls with its block, level with it
```

The conversation is drawn in the Marginalia column, starting level with the block it is about, and
scrolls with the article. It is **the same `ChatDialog` component**, not a second chat surface: same
`useChat`, same `Conversation` and `Composer`, same draft store, same `?thread=`. Only where its
`<aside>` is attached and how it is styled change.

## The decisions, and what was passed over

**1. One component, one persistent portal container, moved.** `ChatDialog` stays mounted where it
is in `Reader`, and **always** renders its `<aside>` through `createPortal` into one container
element it creates once. An effect attaches that container to the host in the anchor block's cell
(card) or to a mount point where the panel is today (float, dock). The portal's target never
changes, so nothing under it remounts: a first draft switched `createPortal` on and off, and Sol's
probe (F5) showed that remounts `Conversation`, losing the transcript's scroll position, an open
question editor and a running dictation. Moving a DOM node still drops focus and scroll offset, so
the move saves and restores both, and the focus-return effect asks the container, not a captured
aside. Passed over: rendering a `<ChatDialog>` element inside the `margin` map that `TableView`
takes. That would (a) remount the component when a resize crosses the threshold, firing the "?"
auto-send latch (`sentHelpFor`) a second time and dropping a half-typed passage draft, and (b) put
ever-changing callbacks into `marginNotes`' memo deps, so `memo(TableView)` would re-render on every
`Reader` render. With a portal, `ChatDialog`'s own state survives a move between float, dock and
card; and React events bubble through the React tree, not the DOM, so a click in the card does not
reach `TableView`'s cell handlers.

**2. The host.** `Reader` adds a stable `<div data-chat-card-host data-marg-note>` to the `margin`
map entry of `chatOpenBlock`, **before** that block's ordinary notes, so the card is the thing level
with the block and the block's own notes sit under it (Sol F3: after them, an opened note would
push the chat away from its paragraph). Where an earlier block's notes already run down past this
block, the card is pushed below them like any note; "level with its block" means as level as a note
would be. The host is the absolutely positioned, measured element (`top: 0; left: 100%`), and the
aside is in normal flow inside it, so the host's `offsetHeight` is the card's. Its deps
are only `chatOpenBlock`, whether card mode applies, and a stable ref callback (`useState` setter)
that hands `Reader` the DOM node. `data-marg-note` is what `useMarginLayout` collects, so later
notes are pushed below the card and, when it collapses or closes, return to their blocks; its
`ResizeObserver` already re-runs as a streamed answer grows.

**3. Never nothing.** Card mode needs: the switch on `"card"`, the column showing with room
(below), an anchored chat (`chatOpenBlock !== null`), **the anchor block not folded away** (a fold
hides the cell with `display: none` and leaves the host mounted; use fold.ts's subscription and
visibility predicate, Sol F4), and **a host node actually in hand**. Any of
those missing and the panel is exactly what it is today: docked (A) if `chatDock` says so, else
floating. So an unanchored thread, a block the table is not drawing, and the one commit before the
host's ref lands all fall back to something visible. This also keeps A's code exercised.

**4. Width: the room right of the prose, not the notes' 288px.** (Report `spya-ntb7p6`.) New pure
`chatCard(fit, windowWidth)` in `layout.ts`, beside `chatDock`: `null` unless `fit.margW > 0`; room
= `windowWidth − fit.margLeft − gap − CHAT_DOCK_GUTTER`, where gap is `--marg-gap` (1.25rem, so it
takes `rootFontPx`; one constant shared with the stylesheet's value, Sol F2: without it the card
overran a 1440 window by 12px); `null` if room < `CHAT_DOCK_MIN`; else
`min(room, CHAT_CARD_MAX)` with `CHAT_CARD_MAX = 576` (36rem, a comfortable measure for chat text;
the notes themselves stay at `--marg-w`). The card's left edge is the cell's right edge plus the
column's own `--marg-gap`, so its text starts on the column's one left edge; the width has that gap
taken out. Written on the host as a custom property. At 1440 with Structure it is the column's
~288; on Greg's very wide screen it is up to 576.

**5. Expanded and collapsed.** The collapsed thread's id (an id, not a flag, so it cannot transfer
to another conversation), **cleared by every press that opens a conversation**, including one that
names the thread already open: `openChatThread`, the gutter chip and "?" only write `?thread=`, so
without an explicit reopen signal a collapsed card would ignore the press that asked for it (Sol
F1). `Reader` owns the signal (the state itself, or a nonce the dialog watches).

- **Collapsed** is about one note tall: a single button, the whole card. Line 1: chat icon and the
  thread's title (the reader's own words, reader's face per fonts.md), one line, ellipsis. Line 2,
  faint: while an answer is arriving, the house inline spinner and *answering…*; otherwise the first
  line of the latest answer, clamped to one line, in the AI's face; if there is no answer text, the
  turn count. Pressing it expands. `aria-expanded="false"`.
- **Expanded** is the panel as today (header, scrolling transcript, footer) with one new header
  button, a chevron, *Collapse*, beside the close X. The title appears once, in the header.
  `max-height` as the floating panel's (34rem or the visible viewport less chrome, `--kb-inset`
  included), so the composer is never more than one card-height from the transcript's top and an
  iPad keyboard still shrinks it.
- **Defaults.** Opens expanded, always: asking, pressing "?", reopening from the gutter chip, the
  margin line or the Comments drawer. **Collapsing is the reader's press, and nothing collapses by
  itself in v1.** The first draft collapsed the card when it scrolled out of view; Sol's review
  called that more machinery than the trial needs (visibility history, focus exceptions, a layout
  shift nobody pressed for), and simplest-first agrees. It is the named follow-up if Greg finds
  the pushed-down notes a nuisance. **Opening another** conversation replaces this one, as today
  (there is one `?thread=`); the one left behind is its ordinary *Question* line in the margin.
- A **draft** (passage chosen, nothing asked) has no collapsed state: it is already short, and
  collapsing it would hide the box the reader opened it to type in. A help draft ("?") shows
  *Asking…* as today.
- **Close** (X, Esc) is unchanged: it clears `?thread=`; the answer carries on being written and the
  margin's *Question* line reopens it.

**6. The margin's own line for the open conversation is dropped while its card is up**, so the block
does not say *Question · About this paragraph* directly above a card that is that question. `Reader`
filters the open thread out of the `asked` list it gives `marginaliaNotes`, only in card mode.

**7. The duplicate in the shut line** (report `spya-f6dpj5`), fixed whatever the switch says. In
`CommentNote`, a lone question's open half repeats its stamp and line (*Question · About this
paragraph*, or the quote). The shut line already un-truncates when open (marginalia.css), so the
head is pure repetition: for a lone question the open half is just *Open the conversation*. With
several entries the per-item heads stay; that is how they are told apart.

**8. The switch.** `BLOCK_CHAT_IN_COLUMN: "card" | "dock" = "card"` in `layout.ts`, read in one
place in `Reader`. On `"dock"` no host is rendered, the `asked` filter is off, and everything is
A. Going back is that one word.

**9. Recording where a chat started: nothing new.** A block chat already stores its `anchor` on the
thread. The sibling chat-as-research session is designing origin records and a link back; this plan
adds no second mechanism. Checked against `origin/dev` before landing (see Progress).

## Things the builder must get right (each wants a test or a browser assertion)

- **The card is inside `td.text` in the DOM, and is not prose.** `.marg-note` is `user-select:
  none`; the card must be selectable and copyable. A selection or click inside it must not open
  `AnnotateDialog`, select the row, or start a block comment. The portal shields it from React
  handlers only, so check each native listener on the prose one by one. **Not a blanket exclusion**
  (Sol F7): chat link previews and block-link hover cards are delegated native listeners and must
  keep working in the card. What must change is provenance: `ProseHoverCard` takes `inBlock` from
  the nearest `tr[data-block]`, so a link in a chat answer would be treated as the anchor
  paragraph's own; inside the card host `inBlock` is `null`, as it is for the floating panel. Test
  a chat link whose URL is also in the anchor paragraph.
- **The iPad keyboard** (Sol F6, reasoned). The fixed panel stays above the keyboard by its bottom
  anchor; the card has none. It is page content, which Safari scrolls a focused field into view
  for, and the card's height is capped to the visible viewport. On composer focus and on a visual
  viewport change while focus is inside, also `scrollIntoView({ block: "nearest" })` the footer.
  **This cannot be proved on the box** (desktop Chrome at iPad size has no Safari keyboard); it is
  named in the debrief as the thing for Greg to try on the iPad.
- **Focus must not scroll the page.** The thread arm focuses the close button on open; in card mode
  on a cold load (`?thread=` with `at=` elsewhere) that would scroll the page to the card and fight
  `at=`. Use `preventScroll` in card mode. A draft's composer focus may scroll (the reader just
  pressed that block).
- **Not `position: fixed`.** `.chat-dialog.in-column` overrides the fixed geometry: `position:
  absolute; top: 0; left: 100%`, no bottom anchor, lighter shadow or none, the column's padding.
  The host is the positioned, layout-collected element; check which of host and aside carries the
  absolute positioning so `offsetHeight` on the `[data-marg-note]` element is the card's height.
- **A resize across the threshold** keeps a half-typed passage draft and does not re-send a "?"
  (the component is not remounted; the test proves it).
- **The mark on the block** (`td.text.chat-open`) and the waiting spinner stay as they are.
- **Fonts**: title in the reader's face, answer line in the AI's (fonts.md). **Copy**: plain words.
- **Marginalia's tips table**: if the collapsed card or host needs a `data-marg-tip`, it needs a
  row in `tips.ts`; a title/aria-label on the two new buttons is enough otherwise.

## Tests (red first)

- `tests/marginalia-shut-notes.test.tsx`: a lone question, opened, shows *About this paragraph*
  once and still offers *Open the conversation*. Red today.
- `tests/layout-margin.test.ts`: `chatCard` — no column → null; 1440 + Structure → the column's
  room; a very wide window → capped at `CHAT_CARD_MAX`; under `CHAT_DOCK_MIN` → null.
- `tests/chat-dialog-in-column.test.tsx`: given a host, the aside is inside it with `in-column` and
  not `docked`; without a host it falls back to `docked`/floating by `dockRoom`; collapse shows the
  one-button card with the title once and the state line (answering / first answer line); expand
  restores; a draft has no collapse control; moving host → null → host keeps a typed draft and sends
  a help question once.
- The `asked` filter: a pure helper or the seam `Reader` already has, tested there.
- **A Reader-level test** if a harness that renders `Reader` already exists (Sol): the card really
  lands in the anchor block's cell, a press on the already-open collapsed thread expands it, the
  margin line is filtered, fold and no-host fall back, and `"dock"` on the switch gives A. If no
  such harness exists, these are browser assertions, and the plan says so in Progress.
- Moving the container (host → mount point → host) keeps: a typed passage draft, the help latch
  (one send), an open question editor's text, the transcript's scroll offset, and focus.
- Mutate at the end: flip the switch to `"dock"` and check the in-column tests that should care go
  red; remove the selection guard and check its test goes red.

## Browser check (Sonnet subagent, Playwright on the box)

1440 with Structure + Marginalia (Greg's layout), a ~2200-wide window with the same (the width
report), iPad landscape 1180, iPad portrait 820, phone 390, and 1440 with Marginalia off.
Screenshots of collapsed and expanded into `docs/plans/261004k-shot-*.png`. Assert real bounds: the
card's left edge is at or past the prose cell's right edge; its top is level with its block; later
notes are below its bottom; on the wide window it is wider than `--marg-w`; floating and unchanged
at 820, 390 and with Marginalia off. Select text in an answer: no comment dialog opens. Scroll the
card away and back: still expanded. Collapse it: the notes it had pushed are back level with their
blocks. Fold the section holding the open chat: the panel is docked, not gone. The lone *Question* line opened shows its words once.

## Docs

- [comments.md § Where the chat panel sits](../project/comments.md#chat-dock): the card, the
  defaults, the fallbacks, the switch and how to go back.
- [marginalia.md](../project/marginalia.md): replace the docked paragraph; the lone-question line.
- `/help`: check; 261003p found nothing about where the chat appears.
- `docs/user-feedback/`: a note each for `spya-ntb7p6` and `spya-f6dpj5`
  ([feedback-reports.md](../project/feedback-reports.md)).

## Known costs, for Greg's trial

- A streaming answer, and the composer, still scroll away with the block; the collapsed card says
  *answering…* but it is beside the block, not beside the reader. A is the design that follows you.
- A reloaded `?thread=` whose block is not on screen shows nothing until the reader scrolls to it
  (the block's rule marks it).
- While expanded, later notes sit below the card rather than beside their blocks, until the reader
  collapses it.
- The composer above an iPad keyboard is unproven until tried on an iPad.

## GPT Sol on the plan

[261004k-review-plan-gpt-sol.md](261004k-review-plan-gpt-sol.md): build after changes. All seven
taken, as marked above: F1 (a reopen signal), F2 (the gap in the width), F3 (card first, host
measured), F4 (fold falls back to A), F5 (one persistent container), F6 (the keyboard, stated as
unproven), F7 (link provenance, no blanket exclusion). Its wider advice, manual collapse only, is
taken too. It confirmed the shut-line duplicate, that portal events bypass the table's React
handlers, and found no one-frame docking flash.

## Stages

1. The shut-line duplicate (7). Small, independent, ships whatever happens to B.
2. The card (1–6, 8): `chatCard`, the host, the portal, collapse, the filter, the switch, CSS.
3. Browser check, docs, feedback notes.

GPT Sol reviews this plan before stage 1 and the code after stage 2.

## Progress

- 2026-10-04: plan written; Sol's plan review in and folded in. No chat-as-research commit or plan on `origin/dev` yet.
