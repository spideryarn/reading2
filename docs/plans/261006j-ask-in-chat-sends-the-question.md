# 261006j — Ask in chat sends the question

Queue item `qi-av4qxhpb`. Report `spya-x896vu` (Sentry SPIDERYARN-READING2-E1), from an admin,
provenance proved. Session `fbe1-ask-in-chat-sends-on-click`.

Greg, 2026-10-06, in the Feedback box:

> When I click "ask in Chat" anywhere, automatically submit the input (rather than just prefilling
> the input box and waiting for me to hit send)

## What happens today

Several buttons around the reading view take the reader to a conversation with a question already
written in the box. None of them sends it. The reader presses the button, then has to find **Send**
and press that too. Greg is asking for the first press to be the only one.

Prior-work check (docs/plans, docs/user-feedback, `git log origin/dev`, `gjd-remote ls`): nothing has
shipped or is in flight for this. The nearest work is
[261006d](261006d-glossary-and-citations-ask-in-chat-with-origin.md), which added two of these
buttons this morning and kept "carried across, never sent" from the older ones.

## Every entry point (found by grep, not from memory)

There are **two paths**, and every button goes down one of them.

**Path A: a fresh conversation in Chat mode.** One function in `Reader.tsx`, `handToChat`, sets a
`ChatHandoff` and switches the mode; `ConversationBand` takes it, begins a conversation, and writes
the question in as that conversation's unsent words. Seven senders (the seventh was missed by the
first draft of this plan and found by GPT Sol, PR-1):

| # | Where | Button | The question ends in a question? |
|---|-------|--------|---|
| 1 | Glossary, a word the article does not contain | **Ask in chat** | yes (`askAboutTerm`) |
| 2 | Glossary entry | **Ask in chat** | yes (`askAboutGlossaryEntry`) |
| 3 | Citations row | **Ask in chat** | yes (`askAboutCitedWork`) |
| 4 | Debate, *Look at the debate from an angle* | **Ask in chat** | yes (`askDebateThroughLens`) |
| 5 | Debate claim | **Check this claim in chat** | yes (`askToCheckClaim`) |
| 6 | Summary paragraph | **Ask about this paragraph in chat** (an icon) | **no**: the quoted paragraph, then an empty line for the reader's question |
| 7 | Command bar, the suggested row under *From why you're reading* | **Ask chat what the web says about "…"** | yes, the same seed as 4, but the angle is worded by a model from the reader's profile |

**Path B: the floating chat over the article.** Two senders, both a draft `ChatTarget` with
`question` set:

| # | Where | Button |
|---|-------|--------|
| 8 | The follow-up box under an AI explanation (`CommentDialog`) | **Ask in chat** |
| 9 | The comment box (`AnnotateDialog`) | **Ask AI** |

For 8 the reader types a question and presses the button; `Reader`'s `onDiscuss` opens the floating
`ChatDialog` as a draft about that passage with the typed words in its box, unsent. So today that
reader types a question, presses a button that says *Ask*, and is shown their question again with
a Send button. 9 is the same shape with the comment's words.

## Decisions

**D1. Path A sends, in the band, through the same function the Send button uses.** `ChatHandoff`
gains a required field, `send: boolean`, so each sender has to say. When it is true the band begins
the conversation as now, stores the origin beside it as now, and then calls the function behind the
panel's `onSend` with that conversation's id and the question. That function is today an inline
arrow reading `current`; it becomes `sendTo(id, question)`, and `onSend` is
`(q) => sendTo(current, q)`. One send path for typed and handed-over questions, so the origin, the
on-screen blocks, the `drafts.submitted` mark and the id correction are the same code.

The simpler option passed over: keep writing the question into the draft and have the composer
"press Send" on mount. That is a second thing deciding to send, in a component that remounts on
every conversation switch, and it would need its own once-only latch. The band already has one
(`taken`, by object identity) for exactly this effect.

**D2. Senders 1 to 5 send. Sender 6, the Summary paragraph, does not.** Its message has no question
in it: it is the paragraph and an empty line where the reader types. Sending that spends a model
call on a message that asks nothing. So it passes `send: false` and behaves as today.

GPT Sol disagreed (PR-3, P1): the button is named *…in chat*, so send it, with `HELP_QUESTION`
("Help me understand.") as the question. **Overruled, after Opus arbitrated.** Plan 261004a built
the seed to wait: *"the reader came to ask something, so the box waits for their question, and a
press spends nothing"*. And `HELP_QUESTION` is not a free default: its own note says the sentence
works because the press also sets `help: true` and the prompt carries the real instruction.
Borrowing the words without the flag is new wording in the reader's voice and a call they did not
ask for. That is Greg's to choose, so it is a deferred item with a queue entry.

**D3. A sent hand-off does not take focus.** Today the composer takes the caret, because the reader
is about to edit or send. After this there is nothing to edit; the answer is arriving. On a phone,
focus would raise the keyboard over it. On a laptop, focus in the box stops ↑/↓ stepping the
article. So `startNew` is asked not to raise the focus counter when the hand-off sends. An unsent
hand-off (the Summary's) still takes focus.

**D4. Path B sends too, on mount, the way the "?" already does.** The draft target gains
`sendNow?: true`. `ChatDialog` already has an effect that sends `HELP_QUESTION` once for a "?"
press, behind a ref latch; a sibling effect sends the question once for a `sendNow` draft. Its
latch holds the passage and the words, and is let go when the draft becomes a conversation, so the
same question asked again later is a second send. Such a draft is drawn as the "?" draft is:
*Asking…* and no composer (Sol, PR-5: an ordinary draft body says "Nothing is asked until you
send" and mounts a composer that takes focus, which raises a phone's keyboard).

The simpler option passed over: reuse `question` alone and send whenever it is set. Two names for
two behaviours, for the reason `help`'s own note gives; in the end both callers set `sendNow`.

**D5. Sender 7, the command bar's suggested row, still waits.** It shares Debate's handler, so it
would have started sending unnoticed while its row still said `generates: false` and *"Nothing is
sent until you press Send"* (Sol, PR-1). The handler now takes "send" or "wait" and the command bar
passes "wait". Why not send: the angle is worded by a model from the reader's private profile,
`reader-profile.md` says keeping personal details out of it *"is asked of a model. It is not
enforced"*, and the privacy page promises the question is sent only when the reader presses Send.
Removing that press changes a published promise. Opus agreed. Deferred, with a queue entry.

**D6. Sender 9, Ask AI, sends.** The first draft of this plan left it alone, because 261003i (D5)
chose "opens the conversation; it does not send". Sol (PR-4) and Opus both read it the other way,
and they are right: that D5 was labelled "the smaller version", an agent's sizing call and not a
preference of Greg's; his words there were only that *"ask AI would be a button"*. With words
typed it is exactly the complaint: type, press a button named Ask, see the words again beside
Send. With none, `askAboutBlock` already asks *"Explain this passage."*, which its note records as
Greg's call. The comment is still stored first, inside the same `then`, and `sourceCommentId` still
travels. **This reverses 261003i D5, and Greg should know it did.**

## How a mis-click is bounded

Sending on click spends one model call per click. What limits it:

- It is the reader's own article and their own allowance; a visitor has none of these buttons.
- **One press is one conversation and one call.** For Path A the press switches to Chat mode in the
  same commit, so the button is gone before a second press can land; two calls to `handToChat`
  before a commit replace one state value with another, and the band takes one object once
  (`taken`), under StrictMode too. For Path B the form clears its box on submit and the dialog
  closes, and the send is latched in `ChatDialog`.
- **Stop is on screen at once**, and the conversation can be deleted from the list.
- Path B is not a mis-click in the same sense: the reader typed the words and pressed a button
  named *Ask*, or Enter. Ask AI is `type="button"` and no key presses it; its comment is saved
  before anything is spent.
- **The buttons say so.** The tooltips on *Ask in chat* said "Nothing is sent until you press
  Send"; they now say the press asks straight away. `/help` says the same.
- The server's own limits on chat are unchanged and still apply to this send like any other.

Not added: a confirm step or an undo window. Either would put the second press back.

## What a failed send looks like

The same as a typed first question that fails, because it is the same call: the question stays in
the transcript with its failure and a retry, and a pending origin is offered again on the next send
(`pendingOrigin`). Nothing new to build; the tests check the request, and the browser check looks
at the happy path.

## Stages

One stage; it is small.

1. Red tests first:
   - `tests/conversation-band-handoff.test.tsx`: a hand-off with `send: true` makes exactly one
     POST carrying the question, under StrictMode; `send: false` makes none and leaves the words
     in the box; a hand-off from another article makes none.
   - `tests/conversation-band-origin.test.tsx`: the POST carries the origin.
   - The app-level tests for each sender (`glossary-ask-in-chat`, `glossary-and-citations-ask-in-chat`,
     `summary-ask-in-chat`, the Debate ones): the question is in the transcript, not the box;
     the Summary's is still in the box.
   - A `ChatDialog` test: a `sendNow` draft sends once under StrictMode and the box is empty; a
     draft with `question` and no `sendNow` sends nothing.
2. The change: `ChatHandoff.send`, `sendTo`, `handToChat`'s senders, `ChatTarget`'s `sendNow`,
   `onDiscuss`.
3. Comments and docs that say "carried across, never sent" or "waits for Send": `chat-handoff.ts`,
   `ConversationModes.tsx`, `Reader.tsx`, `GlossaryPanel.tsx`, the `/help` text in
   `help-modes.tsx`, and the owning docs under `docs/project/` (glossary, citations, debate,
   comments, chat). A subagent sweeps; I decide each hit.
4. Gates: typecheck, the touched suites, doc-links; a browser check of one Path A button and the
   Path B box (Playwright, in a Sonnet subagent); GPT Sol's code review; the full suite once.

## Deferred, with a queue entry (`qi-w7j56j26`: one entry, two questions for Greg)

1. **The Summary paragraph button** has no question to send (D2). Sending would need a default
   question, which is new words in the reader's voice and Greg's to choose.
2. **The command bar's suggested chat row** (D5). Sending on the press would mean changing the
   privacy page's promise about profile-worded questions.

## Open questions for the reviewer

- Is there a path into chat with a pre-filled question that the table misses?
- Does sending from the band's hand-off effect, before the list has loaded, hit anything the typed
  path is protected from by the reader's reaction time?

## Log

- 2026-10-06: plan written; to GPT Sol for review.
- 2026-10-06: Sol's plan review (`261006j-ask-in-chat-sends-plan-review-sol.md`), verdict *build
  with the P0/P1 fixes*. PR-1 accepted (a missed entry point; resolved as D5, it waits). PR-2 was
  already how it was built: a hand-off that sends never writes the draft. PR-3 overruled after
  Opus (D2). PR-4 accepted (D6). PR-5 accepted (D4). PR-6 accepted: a test with the list fetch
  held, and one for the same follow-up asked twice.
- 2026-10-06: the pending-origin machinery in the band (an origin kept beside an unsent draft
  across a mode change) is now reached only by a first send that fails. It is kept, and its
  band-level tests keep building hand-offs with `send: false`.
