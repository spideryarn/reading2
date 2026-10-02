# A visible bookmark, a comment without an AI reply, and each comment's kind in the margin

Two of Greg's suggestions about comments, both admin reports (`feedback-reporter.ts` exit 0), so
built. Overseer queue item qi-ynaan2cf.

**SPIDERYARN-READING2-9C** (spya-zper0p, 2026-10-01, Summary with the margin open):

> If I bookmark a block using the icon in the gutter, it should be a bit more visible.
>
> And it should be possible to comment on a block without wanting an AI-chat-response. Enable that
> and make a small UI tweak that will make that clear to the user.
>
> — Greg, 2026-10-01

**SPIDERYARN-READING2-9H** (spya-m55h94, 2026-10-01, Summary with the margin open):

> Comments should be visible in marginalia mode in the right-hand column, probably default
> collapsed. And perhaps indicate whether, in general, comments should indicate whether they're a
> comment from the user that didn't want an AI chat response, or one that did want an AI chat
> response, or a question with AI chat response.
>
> — Greg, 2026-10-01

## What is already there

- **Comments are already in the margin, shut** — fb82 landed it the next morning
  ([261002b](261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md)): one
  shut "Note" line per block, a bare bookmark left out. So 9H's first sentence is done; its second
  (the kind) is not.
- **A comment without an AI reply already exists, but nobody can find it from the gutter.** A
  selection opens a comment box where the AI is a tick-box. From the gutter, the bookmark button
  stores a bare bookmark, and words can be added only by pressing the mark afterwards and typing in
  the comment dialog's "Add a comment…" box. Greg's report says he did not know that. The gutter's
  speech bubble, which he has called "comment" before (report 37), opens an **AI chat**.
- **The three kinds are already in the data**, so nothing new is stored:

  | kind | what it is | how we know |
  |---|---|---|
  | Comment | the reader's words, no AI | a comment with no `threadId` and `status: "none"` |
  | Comment + AI | the AI was asked: *Also ask the AI* made a chat, or an explanation was attempted before 2026-08-28 | a comment with a `threadId`, an answer, or a legacy status other than `none` |
  | Question | the "?" or *Chat about this*: a conversation, not a comment | an anchored chat no comment points at (`askedQuestions`) |

  `askedQuestions` already drops the chats a comment points at, so the three do not overlap.

## What the reader gets

1. **A bookmark you can see.** The mark at the head of the gutter is drawn **filled**, at full
   strength, in `--highlight` (it was an outline at 0.75). Nothing else in the gutter is filled, so
   it reads as state, not as a control.
2. **Bookmarking opens the comment box.** One press still stores the bookmark, exactly as now. Then
   the comment dialog opens on it, with its box saying what it is: *"Add a comment — it's yours;
   the AI doesn't reply"*. Typing and leaving the box saves the words; closing it leaves a bare
   bookmark. Focus goes to the dialog's close button as for any comment, so an iPad keyboard does
   not jump up on every bookmark.
3. **The AI doors say AI.** The gutter's speech bubble becomes *"Chat with the AI about this
   paragraph"*; the bookmark button *"Bookmark this paragraph, and comment if you like (no AI)"*;
   the dialog's follow-up box *"Ask the AI about this…"*. That is the small UI tweak Greg asked
   for: the free door and the paid doors say which they are.
4. **Each comment says its kind** — in the margin and in the Comments drawer, from one function
   (`commentKind` in `comment-nav.ts`) and one label table:
   - the margin's comment line takes the kind as its stamp: `COMMENT`, `COMMENT + AI`,
     `QUESTION`; several in one block show *"3 comments"* and each opened row has its own stamp;
   - **questions join the margin** (owner only — a visitor's payload has no chats), in the same shut
     line as the comments on that block, opening to *Open the conversation*, which is the drawer's
     own press (`openAskedFromDrawer`);
   - the drawer's comment rows gain the same small label the question rows already have
     (*Comment*, *Comment + AI*; a bare bookmark says *Bookmark*).

```
  gutter                        margin (shut)                 margin (opened)
  ■ ← filled mark               ▸ COMMENT  check this vs §4   ▾ 3 comments
  🔗                                                            COMMENT  check this vs §4
  💬 Chat with the AI…                                          COMMENT + AI  why n=12?
  ?  Ask the AI…                                                QUESTION  "the bound holds"
                                                                  Open the conversation
```

A visitor's copy carries no `threadId` or `status` (public-types.ts), so to them an owner's comment
is *Comment + AI* only when it carries a legacy answer, *Comment* when it has words, and *Bookmark*
when it has neither. A wordless modern comment linked to a private chat is therefore left out of the
visitor's margin like any bare bookmark: the projection reveals less than the owner sees, never more.

## Simpler options passed over

- **Only relabel the tooltips**, leaving the bookmark-then-press-the-mark route. Cheapest, but Greg
  asked to *enable* commenting without AI, which says the route is not findable; a tooltip on a
  button that appears on hover would not change that.
- **A fifth gutter button, "Comment"**. Clearer still, but the gutter holds four slots and its
  folding arithmetic (gutter.css, 260905c) is built on four; a fifth reopens it for every short
  paragraph.
- **A stored `wantsAi` field.** The brief allowed a migration, but `threadId` and the chat list
  already say it. The one case they miss: *Save & ask* where the chat call failed before the
  conversation existed — that comment shows as *Comment*. Small, and honest about what happened.
- **A popover instead of the dialog** after bookmarking — a second surface for the same box.

## Deferred

- The dialog's prev/next arrows still skip questions (as 260930f left them).
- A whole-block comment with *Also ask the AI*: `linkThread` is selection-only on purpose
  (comments.md), and the gutter already has two AI doors.
- Showing a question's first message in the margin: the summaries' `lastLine` is not live
  (260930f § Deferred), so the margin shows the passage, as the drawer does.

## Stages

1. **Kinds** (red-first tests): `commentKind` + labels in `comment-nav.ts`; `marginaliaNotes`
   takes `asked` and groups comments and questions as one kind per block; the margin's
   `CommentNote` and the drawer render the stamps; Reader threads `askedList` and
   `openAskedFromDrawer` (owner only).
2. **The gutter and the dialog**: filled mark; `makeBlockBookmarker` resolves the stored id (or
   `null`) so Reader opens the dialog on it; the three relabels; tests that pin strings updated.
3. **Docs**: comments.md (the bookmark opens the box; the three kinds), marginalia.md (questions in
   the margin), the feedback note.

Browser check (Sonnet, Playwright): bookmark press → filled mark + dialog; type, close, the margin
shows `COMMENT`; a "?" question shows `QUESTION` and opens its conversation; 390px leaks nothing.
GPT Sol on this plan (`--sandbox review`) and on the code (`--sandbox workspace-write`).

## GPT Sol on the plan, and what changed

[The review](261002j-plan-review-sol.md): no P0, three P1s, all accepted.

1. **Intent or outcome.** Greg asked whether a comment *wanted* an AI reply; the tick-box is never
   stored, and a reader can tick it and close the chat draft unsent. Taken as **observable AI
   involvement**: the label is *Comment + AI* (neither "+ AI chat", which is wrong for a legacy
   explanation, nor "+ AI reply", which is wrong while one is pending or after it failed), and
   `commentKind`'s comment says so. Storing the tick is a column, a route change and a payload
   change for one edge case. **Deferred**, and named for Greg in the feedback note. A wordless
   comment that did ask (*Save & ask* with an empty box) is no longer dropped from the margin: the
   exclusion is now `commentKind === "bookmark"`.
2. **A slow store opening over something else.** The press keeps a copy of what is open (`?note=`,
   `?thread=`, the chat draft, the selection box, the drawer, Marginalia, the mode and its sub-mode)
   and its own press number. The answer opens the dialog only if none has moved. Sol's code review
   also had it check the DOM for any newly opened `role="dialog"` (modals, hover cards); that was
   taken out after its review, because the prose's hover cards are dialogs, so a pointer drifting
   over a glossary term in the round trip would silently cancel the box, and the comment box sits
   beside a card rather than replacing it. Reader.tsx § `bookmarkBlock` says the same. Whole-app tests hold the POST while a chat, a mode band
   or the Comments drawer opens, and each remains the foreground choice after it lands.
3. **Focus on close.** The bookmark button is replaced by the mark before the dialog mounts, so the
   recorded opener was `<body>`. `CommentDialog` no longer records `<body>`, and falls back to the
   paragraph's `.blk-cmt` before the Comments button. Tested in the same file.
4. (P2) The margin's hover card now covers both comments and questions (tips.ts, "Yours").
5. (P2) The visitor sentence above corrected.

Both new whole-app cases were run red with their fix switched off, then green.
