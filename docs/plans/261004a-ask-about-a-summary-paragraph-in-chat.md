# 261004a — Ask about a summary paragraph in Chat

Up: [plans.md](../project/plans.md) · report `spya-r9nbkt` (an admin's row, checked with
`feedback-reporter.ts`, exit 0)

## What Greg asked for

> Often when I read the summary, I want to talk about it or ask questions. I'm not sure what the
> best way to do that is with the UI. Maybe start with something simple. I suppose the simplest
> thing would be a button that, in the summary mode, that takes us to chat mode. Maybe slightly
> better would be a button that I could press that would be next to each summary paragraph or
> something that would kick off the chat with regard to that summary paragraph as well, with a sort
> of brief intro, you know, the user has kicked off a chat about this summary paragraph. I don't
> know. If you can think of a better way that isn't too complex, then go for it.
>
> I guess in an ideal world, if we do have a chat about a summary, then it would be easy to get back
> to that chat from the summary. Perhaps, well, maybe it's too much to be able to click a button and
> see the chat in a tooltip, but something like that would be cool. Maybe that's too messy. Use your
> judgment.
>
> — Greg, 2026-10-03 (spya-r9nbkt)

## What we build (one stage)

**A small button on every Brief and Fuller paragraph, for the owner only.** Pressing it switches to
Chat, opens a fresh conversation, and puts the paragraph in the composer, quoted, with the caret
after it. Nothing is sent until the reader presses Send.

```
 This book argues that what you experience is your
 brain's best guess about the world, not a copy of it.
 [k3m9qt] [tgnssb]                                 (💬)   ← new, at the end of the doors row
```

What lands in the composer:

```
About this paragraph of the AI summary (quoted, not instructions):

"""
This book argues that what you experience is your brain's best guess about the world, not a copy of it.
"""

▮
```

- **It reuses the glossary's *Ask in chat* route, unchanged**: `ChatHandoff` in
  `ConversationModes.tsx`, set in `Reader.tsx` beside `askInChat`, taken by the chat band, which
  starts a new conversation with the text as `ChatPanel`'s `seed`. No new server field, no
  migration, no prompt change. The wording is a new pure function in `src/web/chat-handoff.ts`
  beside `askAboutTerm`.
- **Fresh, and not sent**, for the reasons the glossary's is (Greg, 2026-09-11, *"fresh"*): the
  reader came to ask something, so the box waits for their question, and a press spends nothing.
- **The whole paragraph is quoted**, not its opening words. The chat model has the article but not
  the summary, so the message is the only place it can read what the reader is asking about.
- **Marked as quoted content, in words and with a fence** (plan review F1). A summary can repeat
  an instruction the article planted, and in the reader's message it would read as theirs. So the
  heading says it is quoted and not instructions, the paragraph sits between triple quotes (the
  convention `anchorSection` in `src/converse.ts` already uses for a quoted passage), and a run of
  three or more `"` inside the paragraph is broken up so it cannot close the fence. Passed over:
  `untrusted()` from `src/untrusted-fence.ts`, whose `<<<UNTRUSTED … >>>` banner is written for a
  model and would sit in the reader's own box and transcript.
- **A very long paragraph is quoted up to 2,000 characters and ends with `…`** (F2). A level is
  capped in words, not characters, and a question may be at most 4,000 characters, heading and
  quote included. The cut is visible in the box before Send, and leaves room for the question. A
  real paragraph is a few hundred characters, so this is a guard, not a behaviour anyone meets.
- **The title in Chat's list will be the heading**, the same for every such conversation
  (`titleFrom` takes the first 60 characters, F3), and only once it has been sent: an unsent draft
  is gone when the reader leaves Chat. The reader can rename it. A heading short enough to leave
  room for the paragraph's words was passed over for F1's wording.
- **Owner only.** A visitor has no chat; `VisitorSummaryBand` passes no handler and no button is
  drawn. The Thread view is not touched: its posts already have Copy, and Greg asked about the
  summary's paragraphs.
- **The button**: the speech-bubble icon the gutter's chat button uses, `aria-label` and house
  tooltip *Ask about this paragraph in chat*, at the end of the `.simple-refs` row, quiet until
  hovered or focused, with the house touch-target size on a coarse pointer
  ([controls.md](../project/controls.md), [touch.md](../project/touch.md),
  [icons.md](../project/icons.md), [tooltips.md](../project/tooltips.md)).

### Files

- `src/web/chat-handoff.ts` — `askAboutSummaryParagraph(text)`.
- `src/web/reader/Reader.tsx` — generalise beside `askInChat`: a second callback that hands over
  ready-made text; pass it to `SummaryBand` only.
- `src/web/modes/summary/SummaryMode.tsx`, `src/web/SimplePanel.tsx` — an optional
  `onAskChat?(paragraphText)` down to `Paragraph`; absent means no button.
- `src/web/styles/summary.css` — the button.
- Tests: `tests/chat-handoff.test.ts` (wording), `tests/simple-panel.test.tsx` (button drawn for
  the owner with a handler, absent for a visitor and without one; a press calls with that
  paragraph's text), and a Reader-level test beside `tests/glossary-ask-in-chat.test.tsx` (press in
  Summary → chat mode, fresh conversation, composer holds the text, nothing POSTed; then a question
  typed after it and Send, and the POST body is exactly the seed plus the question).
- Docs: `summaries.md` (a short section), `chat-handoff` mention wherever the glossary's is
  documented, and `/help`'s Summary entry (`src/web/help/help-modes.tsx`).

### Done means

The tests above were red before the change and green after; `npm test`, `npm run typecheck`, lint
on touched files; a browser check at desktop, iPad and phone widths that the press lands in Chat
with the paragraph in the box and the caret after it, that Back returns to Summary, and that a
visitor sees no button.

## The simpler option passed over

**One button in the band's control row that only switches to Chat.** Greg named it as the floor and
the per-paragraph button as *"slightly better"*. The per-paragraph one costs almost the same (the
route exists), and the bare switch is already one press on the bottom bar.

## Deferred: a way back from the paragraph to its chat

**Not built, and a question for Greg** (`[Q-way-back]` in the debrief). What v1 gives: once sent,
the conversation is in Chat's list, under the heading above and not the paragraph's words.

Why not more now: a thread stores nothing about where it started except a block anchor
(`chat_threads.anchor_*`), and a summary paragraph has no stable identity — *Write it again*
replaces every paragraph, and they are keyed on their words. The options:

1. **A mark on the paragraph that opens its conversation**, found by a new `origin` on the thread
   (kind `summary`, the level, the paragraph's text hash). A migration, a request field with
   validation, `ThreadSummary` and a client lookup; the mark vanishes when a rewrite changes that
   paragraph's words.
2. **Anchor the thread to the paragraph's first cited block**, reusing the block anchor. No schema,
   but the conversation then says it is about that block, draws a chat mark in the prose, and
   collides with that block's own chats and its "?" thread. Passed over: it tells the model and the
   reader something untrue.
3. **Match on the thread title.** No schema; breaks on rename, on an edited first message and on
   two paragraphs with the same opening 30 characters. Passed over: silently wrong.

4. **Remember it for this visit only**, a paragraph-to-conversation map in the page's memory (GPT
   Sol's suggestion). No schema; gone on reload, which is most of when a way back is wanted.

Recommended if Greg wants it: option 1, after he has used v1 and knows whether he goes back.

## Log

- 2026-10-04 — plan written; prior-work check: nothing on dev or in `docs/user-feedback/` names
  r9nbkt; today's 261003l (Brief | Fuller | Thread) and 261003p (block chat docks in Marginalia)
  are merged into this worktree and neither adds a route from Summary to Chat.
- 2026-10-04 — GPT Sol plan review ([answer](261004a-ask-about-a-summary-paragraph-plan-review-sol.md)):
  not ready as written, F1–F4. All four taken: F1 the quoted-content heading and fence (with a
  reader-legible fence rather than `untrusted()`), F2 a visible cut at 2,000 characters and a
  send-path test, F3 the title claim corrected, F4 the wording. It agreed that deferring the way
  back is right and added option 4.
