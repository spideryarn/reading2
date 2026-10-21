# Investigate takes you back to your conversation

Feedback `spya-nhwy3d` (#666, SPIDERYARN-READING2-MZ), Greg (admin), filed 2026-10-20 21:58 UTC from
Sources › Investigate on `rovelli-order-of-time-…-spya-r26sug`; overseer queue item `qi-fsadskxx`.
Up: [sources.md § Investigate](../project/sources.md#investigate). Built on
[261020n](261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md) § Stage 2.

> I started an investigate chat about how the piece had been received, and I can see it listed in
> the chat threads, but when I go to investigate, it just shows me an empty thing. So I feel like
> any time there's, yeah, I think in the case of investigate, either there's a single investigate
> thread, in which case it always takes me back to the same one, or we allow multiple investigate
> threads, which are like a subset of all the threads in chat that are part of the investigate
> mode, whichever you think's easiest and best.
>
> — Greg, 2026-10-20 (spya-nhwy3d)

## What happened

Nothing was lost. Production holds one chat on that article started 2026-10-20 21:56, kind `chat`,
origin `{ mode: "reception", lens: "How has this piece been received, and by whom?" }`, two
messages, a minute before the report (read-only query, `scripts/feedback-reporter.ts §
productionClient`).

A Sonnet browser agent walked the same journey on the box and found every mechanism working:
- the press opens Chat on a fresh conversation and sends;
- Back, the *Back to your question in Investigate* line, and the Sources chip all land on Investigate;
- *Your questions* lists the chat, and pressing its line opens the conversation beside Sources.

What it does **not** do is the thing Greg expected. Investigate is a launcher: a box, five
suggested questions, the claim and work rows, and *Your questions* last. Coming back to it shows
the launcher again, with no conversation on screen. And on a cold load *Your questions* is missing
until the chat summaries arrive, so for a few seconds it looks like a first visit. Greg asked for
"a general Chat mode for Sources" (261020n, spya-x4xpw4), so a sub-mode that never shows a
conversation reads as empty.

## The decision: multiple threads, and Investigate opens the newest

Of Greg's two options, **multiple threads, a subset of Chat's**. That is what exists already: every
chat with a lens origin is an Investigate chat, and Chat lists them all. What changes is that
Investigate takes you back to one.

1. **Arriving on Investigate opens your newest Investigate conversation beside Sources**, in the
   floating chat dialog that a *Your questions* line already opens (`Reader.tsx § openClaimChat`).
   - Once per visit. A visit is one mount of the panel: the chip, a link, Back, the way back from
     Chat. Closing the dialog keeps it closed until you leave Investigate and come back.
   - Only after the chat summaries have loaded (`chatAnchors.loaded`), so a cold load waits and
     then opens rather than deciding on an empty list.
   - **Never over anything already beside the mode** (`occupied`, built in `Reader`):
     - any `?thread=`, whether a dialog draws it or not. A stale id, or Chat's state carried
       across, sits in the address with no dialog (`overlay` opens only a summary of kind `chat`),
       and Chat relies on it surviving.
     - an unsent passage chat (`chatDraft`), whose words live only in the dialog;
     - an open note;
     - an annotation in progress (`annotating`).

     Any of these decides the visit at once, before the summaries arrive.
     *Revised after GPT Sol's F1 (blocker) and F2: the first draft checked `?thread=` alone, which
     would have discarded an unsent passage chat.*
   - Not when there are none. The launcher is then the whole of it, as now.
   - It sends nothing and buys nothing: it opens a stored conversation (`threadParam` replaces the
     history entry, so Back is not doubled).
2. **The way back from an Investigate chat keeps that chat open.** `openOrigin`'s `reception` arm
   clears `?thread=` today, which would make (1) open the newest instead of the one you came from.
   It keeps it instead, so *Back to your question in Investigate* lands on Investigate with that
   same conversation beside it.
3. **Your questions moves to the top**, under the box, above *Suggested*. Your own conversations
   come before ours.

Pressing a question still opens Chat on a fresh conversation, as in 261020n.

## The options passed over

- **A single Investigate thread** (Greg's first option). Every question would go into one
  conversation, the way Remember works (`learn`/`explore` are single-thread kinds). It needs a new
  `ThreadKind`, which about fifty files name, plus a migration and a one-per-article index. Each
  question would also carry every earlier answer as context, which costs more per turn. The
  multi-thread model already exists and Greg named it as acceptable.
- **Investigate's band becomes a `ConversationBand`** scoped to lens chats, so questions are asked
  and answered inside Sources. Opus read it through. It is a refactor of a component that assumes
  it is Chat's band:
  - the arrival rule reads a per-article drafts store, so two `chat` bands would put the reader
    back in each other's conversation;
  - `?thread=` would mount the same conversation in both the band and the floating dialog, since
    `overlay` suppresses itself only in Chat and Learn;
  - `handToChat` always switches to Chat;
  - the list filter has no lens-only axis.

  It would re-open races that `conversation-band-handoff` and `learn-own-thread` were written to
  pin.
- **The cheaper half of that**: sending a new question to the floating dialog beside Sources
  instead of switching to Chat. It needs a `ChatTarget` draft with no anchor, which is 261020n's
  named deferred step. It is still deferred: what Greg reported is coming back, not going.

## What it gives up

- **On a phone the dialog lies over the launcher on arrival.** One tap on its close button shows
  the launcher, and it stays closed for that visit.
- **Asking a new question still leaves Sources for Chat.**

## The tests

Red first, in `tests/reception-lens-in-chat.test.tsx` (the whole app, as that file already does):

- arriving on `?mode=sources&sources=investigate` with a stored lens chat opens it beside Sources
  (`?thread=` is its id, the dialog shows its transcript), with no chat POST;
- with two, the newer by `updatedAt`;
- closing it does not reopen it while Investigate stays mounted;
- `?thread=<another chat>` on arrival is left alone;
- no lens chat: no dialog, no `?thread=`;
- the way back from a lens chat in Chat lands on Investigate with that chat open, also when it is
  not the newest;
- added after GPT Sol's review:
  - a `?thread=` no dialog draws is left alone;
  - an unsent passage chat survives the switch to Investigate. Seen red with `chatDraft` taken
    out of `occupied`;
  - leaving for another chip and coming back opens it again;
  - a suggested question pressed with the conversation open makes one fresh chat and one POST.

In `tests/reception-lens.test.tsx`: *Your questions* comes before *Suggested* in the DOM.

A browser pass on the box at 1440 and 390.

## GPT Sol's plan review

[261021b-…-plan-review-sol.md](261021b-investigate-takes-you-back-to-your-conversation-plan-review-sol.md):
*revise before build*. All taken:

| Finding | What changed |
|---|---|
| F1 (blocker) | `occupied` covers a passage draft and a note as well as `?thread=`, and decides the visit at once |
| F2 | The rule reads "never replace any `?thread=`", with a test for one no dialog draws |
| F3 | Tests for the visit boundary and for a press while the conversation is open |
| F4, F5 | Confirmations: keeping `?thread=` on the way back is safe; the arrival cannot spend |

## Progress

- [x] Plan reviewed by GPT Sol (revise before build; all taken, above)
- [x] Red tests, then the change
- [x] Gates, browser pass, GPT Sol code review
  - The browser pass was on the box at 1440 and 390: the cold arrival opens the newest chat with
    its transcript; a closed dialog stays closed; a chip away and back reopens it; the way back
    from Chat keeps the same chat; no chat POST; no console errors. The phone's chip switch was
    not clicked (the chip was scrolled out of the strip); the test covers it. Shots:
    `261021b-shot-*.png`.
  - [GPT Sol's code review](261021b-investigate-takes-you-back-to-your-conversation-code-review-sol.md)
    approved. It made one fix of its own: an annotation in progress (`annotating`) also counts as
    occupied, with a test that was red first. It also added tests for the two races, a visit
    decided while occupied and summaries arriving after a press has left for Chat.
- [x] sources.md, the help page, the user-feedback note, queue item done, pushed to dev
