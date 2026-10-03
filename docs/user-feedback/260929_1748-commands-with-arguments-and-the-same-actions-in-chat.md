---
reports: spya-wh2xys
ending: shipped
---

# Commands that take arguments, and the same actions in chat

A suggestion from Greg (an admin; `feedback-reporter.ts` exited 0 on the production row), sent from
Chat on `pnas-202123432-spya-rekvg9`; Overseer queue qi-8dzvqm49, and with it qi-qkjnkwce (the tag
command) and the Overseer's addition of dictation in the bar (Greg, 2026-10-02: *"ok"*).

> The commands panel that pops up where you can jump to things. I'm wondering if we should add more
> to it than that. So, for example, I might want a command to make it public, or a command to
> archive, or a command to regenerate something, or a command to turn on the experimental features
> or off, or something like that. And indeed, those lists of commands, you can imagine some of them
> being disabled. So turning on the experimental features might be disabled if it's already on. I
> don't know. And turning off would be available. And I guess look through the metadata, look
> through the user profile, look through, yeah, and I mean, in an ideal world, it would sort of take
> parameters. So you could say something like, do a search for X within that command bar, rather
> than having to go to search and then type in, or, you know, look up some word in the glossary that
> may or may not already be there. So then we might need a lot of different ways of, you know, tools
> effectively that can hook into different functionality within modes. And indeed, for everything
> that we do along these lines, we want to build those tools such that the chat or whatever could
> also make use of them. So the chat could also look up words in the glossary or place a bookmark at
> a particular block or something. And actually, a tool I would really like would be jump to the
> first place where X, which is a kind of search, but it's a sort of limited, you know, it's like a
> sort of SQL search with limit one. So yeah, you might want to search for the first place or the
> best place. So that's more about, like, your confidence rather than the ordering. And so I guess I
> think this is a task that might involve breaking it down into pieces and maybe sub-agents and a
> bit of investigation first. But you're looking for lots of different things like this that the
> user might want to do and/or that we might want to empower the chat agent to do. And then we want
> to make sure that anything like that, ideally almost all of them are available both in the command
> panel and also in the chat, and that the command panel can take a sort of an argument like a
> search term or whatever.

**Shipped.** Archive, regenerate, *find X* and the row that takes you to the sharing switch were
already there from SPIDERYARN-READING2-8D
([the note](261001_1124-commands-do-more-and-an-interface-model-vision.md)). This run did what was
left; everything is in
[261003f](../plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md).

- **Jump to the first place it says X.** Type *jump to first free energy* or *where does it first
  mention free energy*. Enter takes you to that passage, and Back returns you.
- **Look up X in the glossary.** *define X* or *look up X* opens a matching entry in the glossary's
  visible list. Otherwise the row offers to look the term up in the article (one model call, marked
  as such).
- **Tags.** *tag X*, *add a tag of X to this paper*, *untag X*.
- **Experimental features on or off**, as one row whose label follows the switch, rather than two
  rows with one greyed out.
- **Dictation** in the bar's box.
- **The same actions in chat.** Chat can offer a button when asked to bookmark a passage, tag the
  article, find or jump to some words, or look up a term. Nothing happens until you press it, which
  is the rule you accepted on 2026-10-02
  ([chat-tools.md](../project/chat-tools.md), § Command buttons). The bar and chat share the command
  proposal and dispatcher; chat has its own explicit allowlist of which proposals it may offer.
  The prompt change was measured, including the requests where the model omitted the button:
  [261003b](../investigations/261003b-chat-proposes-commands-as-chips.md).

**Not done, each on purpose:**

- **Make public from the bar.** The row still takes you to the switch; publishing from a keystroke
  is the "never from a sentence" row of the accepted rule.
- **The best place for X** (by meaning, not the first literal match). It is a model call, so it is
  queued as its own item, qi-cehs9yfh, for you to authorise.
- **Free words picked by a model** (*"what's changed since yesterday"*). That is the next session,
  `fb-command-bar-nl` (qi-3wb7cgda), which starts from this.
