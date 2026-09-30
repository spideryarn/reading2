# A question asked from the gutter shows up in the Comments drawer

**Status:** built, 2026-09-30; plan reviewed by GPT Sol (§ What the plan review changed). Report:
[SPIDERYARN-READING2-6W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6W), from Greg.

Greg, 2026-09-30:

> I just asked a question, but with clicking the sort of question mark icon in the vertical gutter
> next to a block, and I got a good answer, and that was great. And then I clicked the X in the top
> right to close it. I was expecting, therefore, that to show up when I clicked on the comments, but
> it seemed like my question had disappeared, and I couldn't remember which block it was, so I
> couldn't check to see whether it was still there. I think if I ask a question, I expect that to
> show up in the comments so that I can find it again or find the answer again. Perhaps somehow
> flagged as a question rather than a comment, but still there.

## Lost, or only hidden? Hidden

Read out of the code, not inferred:

- The gutter's "?" does not make a comment. It opens a **chat thread** (`kind: "chat"`) anchored to
  the whole block, and sends *"Help me understand."* as its first turn
  ([260904b](260904b-gutter-help-button-and-detached-streaming-chat.md) § no new `ThreadKind`;
  `HELP_QUESTION` in `src/web/chat-handoff.ts`). The thread is stored, like any chat, in
  `chat_threads`. Nothing is lost.
- The **Comments drawer** (`?panel=questions`, titled *Your comments*) lists `comments` rows only —
  `Questions` in `src/web/Dock.tsx`, fed `ordered` from `useComments`. A chat thread never appears
  there.
- A **whole-block** chat draws **no mark in the prose** — `anchored()` in `useChatAnchors.ts` skips
  anchors without a quote. What is left is the gutter's chat chip on that one paragraph, which is no
  help to someone who does not remember the paragraph.
- It is also in Chat mode's thread list, but that is not where Greg looked, and there it is titled
  from its first turn, *"Help me understand."*, which is the same for every "?" press.

So the answer is kept but hidden. The scope note allows "list asked questions alongside comments,
marked as questions, or point from comments to them, whichever is simpler and keeps one store".

## What we build

**The Comments drawer lists every chat the reader started from a passage, beside their comments,
in reading order, each marked *Question*.** Pressing one closes the drawer and opens that
conversation in the floating chat dialog, with the passage brought into view — the same
jump-and-push a comment gets from the drawer
([comments.md § Opening a question is a jump](../project/comments.md#opening-is-a-jump)).

One store: the rows come from `useChatAnchors`' summaries, which the reading view already holds for
the owner. No new table, no migration, no new endpoint.

```
  Your comments                                  ×
  ───────────────────────────────────────────────
  "the sentence he marked"
    this is the bit I doubt
  Question  Whole paragraph — In 1998 the lab…
    The key idea is that the earlier result…     ← lastLine of the answer
  "a later phrase"
    thinking…
```

### The rules

1. **Which threads:** `kind === "chat"` with an anchor — the "?" press (whole block) and the
   *Chat about this* from a selection (a quote). Both are a question the reader asked about a
   passage. Unanchored chats (started in Chat mode) are about the whole piece, have nowhere to jump
   to, and stay in Chat mode only. Remember and candidates threads are never anchored.
2. **Owner only.** A visitor's summary list is already empty and the chat dialog is owner-gated; the
   visitor arm of the drawer gets no chat rows by construction (the prop is absent), not because a
   list happens to be empty.
3. **Order:** one list in reading order, the rule `orderComments` already states — block index from
   `blocks.json` (never the id string), whole-block before a quote, then offset, then `createdAt`,
   then id. A chat whose block is gone sorts to the end, as an orphan comment does. The sort becomes
   generic over anything with `blockId`, `start?`, `createdAt`, `id`, so there is one ordering rule
   rather than a second copy.
4. **What a row shows:** the passage (the quote, or *Whole paragraph —* and the paragraph's opening,
   via the existing `passageOf`), a *Question* tag, and a preview line: the first line of the newest
   answer (`lastLine`), or *thinking…* when the newest turn has no answer yet. `title` is not used —
   for a "?" press it is *"Help me understand."* on every row.
5. **Opening:** close the drawer, then `jumpToComment(chatRows, id, openChatThread, jumpTo)` —
   `comment-jump.ts` is already generic over `{ id, blockId }` and takes the opener as a parameter,
   so the three-way *here / away / nowhere* check and its at-most-one history entry come for free.
   `openChatThread` sets `?thread=` and clears `?note=` in the same tick. An away passage pushes;
   from Remember, switching to Chat also pushes even when the passage is here or gone, so Back can
   return to Remember. The setters are batched, so either route is still one entry rather than two.
6. **The count on the Comments button** counts both, so the number matches the list it opens.
7. **Loading:** the drawer's "not loaded yet" state waits for both lists, so a reader with only
   questions is not told *"Nothing marked yet"* while the chat summaries are in the air — the bug
   `tests/dock-questions-loading.test.tsx` exists for, in its new second place.

## Passed over

- **Make the "?" write a comment instead of a chat.** Greg's own words ("flagged as a question
  rather than a comment") point at a comment row. But a comment is one question and one answer, no
  follow-up ([comments.md](../project/comments.md)), and the "?" was built on 2026-09-04 as a
  conversation on purpose, with streaming and follow-ups. It would also be a second store for the
  same thing, or a migration of existing help threads. Rejected: more parts, and it takes away
  something that works.
- **A line in the drawer pointing to Chat mode.** It would be simpler, but it leaves Greg exactly
  where he was: a list of identical *"Help me understand."* titles and no way to tell which paragraph
  each was about.

## Deferred

- **The comment dialog's prev/next arrows** still walk comments only; they do not step into a
  question. The drawer is where Greg looked, and stepping across two dialogs is a separate design
  (which dialog is open, whose arrows).
- **Chat mode's thread list** still titles every "?" conversation *"Help me understand."* Worth a
  look separately: the title could be the paragraph's opening.
- **The empty-state sentence** (*"Nothing marked yet. Select a sentence…"*) does not mention the
  "?". It only shows when there is neither a comment nor a question.
- **The Comments tooltip copy** (`NOT_A_MODE.comments`) — checked in the build; changed only if it
  now says something false.

## Stages

One stage: `comment-nav.ts` (generic order), `Dock.tsx` (rows, count, loading), `Reader.tsx`
(wiring), a CSS rule for the tag, tests, and a paragraph in `docs/project/comments.md`.

Tests, red first where there is a behaviour to be red:

- ordering: a chat and a comment in one block and across blocks, an orphan chat, a whole-block chat
  before a quote.
- the drawer renders a chat row with the *Question* tag and its `lastLine`, and pressing it calls
  `onOpenChat` with the thread id rather than `onOpenComment`.
- the count includes chats.
- loading: comments loaded and empty, chats not yet loaded, shows loading not *"Nothing marked
  yet"*.
- a visitor drawer draws no chat row.

## What the plan review changed

GPT Sol, read-only, 2026-09-30 —
[260930f-gutter-questions-listed-in-the-comments-drawer-plan-review-sol.md](260930f-gutter-questions-listed-in-the-comments-drawer-plan-review-sol.md).
Verdict *build with changes*; all six findings checked against the code and taken. They override
the rules above where they disagree.

1. **Opening depends on the mode.** `overlay` is suppressed in Chat and Remember. In Chat mode the
   band already shows `?thread=`; in Remember the press now also sets `?mode=chat`, the rule the
   band's own `onThread` keeps (a chat in the Remember band is wrong, and Quiz's cleanup wipes
   `?thread=`). Every other mode gets the floating dialog.
2. **No answer preview.** `lastLine` is not kept live: a conversation minted this visit has none
   until reload, so the row would say *thinking…* under the answer the reader has just read, the
   report's own sequence. Rows show *Question* and the passage only. A live preview is deferred.
3. **Chats a comment points at are left out.** *Also ask the AI* on a comment makes an anchored chat
   and records it as the comment's `threadId`; the comment's row already covers it.
4. **Loading and failure over a partial list.** A loading line shows above the comments while the
   questions are still out, a failed load says so (`useChatAnchors.error`, now cleared when a new
   fetch starts), and *"Nothing marked yet"* waits for both.
5. **The Dock's fit signature** uses the same combined count the chip draws, so 9→10 re-measures.
6. **History, precisely:** at most one entry, and exactly one when the passage was away. Outside
   Remember, *here* and orphan rows move nothing and push nothing, as for comments. In Remember,
   both still move nothing, but the deliberate switch to Chat pushes one entry so Back returns to
   Remember; nuqs batches that mode change with the thread and any away jump.
