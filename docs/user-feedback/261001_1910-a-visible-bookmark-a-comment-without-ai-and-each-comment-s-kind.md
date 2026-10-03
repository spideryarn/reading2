---
reports: spya-zper0p, spya-m55h94
ending: shipped
---
# A visible bookmark, a comment without an AI reply, and each comment's kind

Two suggestions from Greg, both checked as his with `feedback-reporter.ts` (exit 0), so both built.
Overseer queue item qi-ynaan2cf.

**spya-zper0p** ([SPIDERYARN-READING2-9C](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-9C)),
2026-10-01, sent from Summary with the margin open on
`melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj`:

> If I bookmark a block using the icon in the gutter, it should be a bit more visible.
>
> And it should be possible to comment on a block without wanting an AI-chat-response. Enable that
> and make a small UI tweak that will make that clear to the user.

**spya-m55h94** ([SPIDERYARN-READING2-9H](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-9H)),
2026-10-01, sent from Summary with the margin open on
`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`:

> Comments should be visible in marginalia mode in the right-hand column, probably default
> collapsed. And perhaps indicate whether, in general, comments should indicate whether they're a
> comment from the user that didn't want an AI chat response, or one that did want an AI chat
> response, or a question with AI chat response.

**Ending: shipped.** On `dev`, not deployed. No migration.

What we did:

- **The bookmark is easier to see.** The mark at the top of the gutter is now a filled bookmark at
  full strength. It used to be an outline at three-quarters strength.
- **A comment with no AI reply, from the gutter.** You could always do this by pressing the mark
  afterwards and typing, but nothing told you so. Now pressing the gutter's bookmark button saves
  the bookmark and then opens the comment box. The box says *"It's yours: the AI doesn't reply"*.
  Close it without typing and you have a plain bookmark, so bookmarking is still one press. The
  places that do ask the AI now say so: the speech bubble is *Chat with the AI*, and the dialog's
  lower box is *Ask the AI about this…*.
- **Comments in the margin** were already there, shut by default: fb82
  ([its note](261002_0300-marginalia-shows-other-modes-items.md)) landed that the next morning.
- **Each comment says which kind it is**, in the margin and in the Comments drawer: *Comment*,
  *Comment + AI*, or *Question*. The drawer also has *Bookmark*. The questions you asked from a
  paragraph, with "?" or *Chat about this*, now sit in the margin beside that paragraph's comments.
  *Open the conversation* there takes you back to the chat.

**The one thing that differs from what you asked**: the labels say what *happened*, not what you
*wanted*. Ticking *Also ask the AI* is never stored. So if you tick it and then close the chat draft
without sending, that comment is labelled *Comment*. Storing the tick would need a new database
column and changes to the API, all for that one case, so we didn't build it. It is a queue entry for
you to decide.

Plan, both GPT Sol reviews and what changed after each:
[261002j](../plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md).
