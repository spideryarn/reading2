---
reports: spya-hw8mhz, spya-hzpf9b, spya-mtsf0y
ending: shipped
---
# Tutorial: a softer blurb, quotes shown in place, and more weight on retention

From Greg (admin), three suggestions filed 2026-10-03 between 09:36 and 09:54 UTC from Remember's
Tutorial sub-mode on `/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`. Sentry
`SPIDERYARN-READING2-AJ`, `-AP`, `-AQ`. Overseer queue `qi-vmyvyhwj`, session `fb-tutorial-2610`.

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261003i](../plans/261003i-tutorial-leans-to-retention-a-softer-blurb-quote-links-that-show-the-quote.md).

## `spya-hw8mhz` — the blurb

> In the blurb for tutorial mode, it says something like, you know, or say if you haven't read it.
> Actually, I don't think the user should have to say that they haven't read it, because you already
> know that they haven't read it because you see the reading time. So, I mean, perhaps you can
> soften that language to say something like, it's okay if you haven't read it or haven't finished
> reading it, or words to that effect. So you're not asking the user to tell you, you know, you can
> infer that, but you're letting them know it's okay if they haven't read/finished it.

The invitation now reads *"What do you remember about this article? It's fine if you haven't read it
yet, or haven't finished — we can start from wherever you are."* The box's placeholder, the model's
canned opening line and the help page say the same. The prompt no longer asks anyone to confirm.

Deferred, and queued as `qi-a7p9xc4p`: showing the tutor the reader's reading time. It is not shown
it today.

## `spya-hzpf9b` — the quote and its link

> I just got a ... in tutorial mode from the piece, which is great, and it provided a block link.
> But when I click the block link, it didn't seem to take me with the quote. So can we tweak the
> prompt to say, you know, yes, it's good to provide quotes, but whenever you do, always make sure
> that we're providing a block link as well so that the user can see the quote in situ.

His thread was read: every quotation already had a link, and every link was to the right block.
The blocks were 200 to 250 words long, and the click washed the whole paragraph. So the fix is on
screen: a link whose sentence quotes the article now paints the quoted words in the paragraph, in
Chat, Recall and Tutorial. Where the words cannot be found it does what it did before.

## `spya-mtsf0y` — retention, and an Exploration sub-mode

> The tutorial mode is nice. It's certainly asking me to think, which is kind of fun. I guess I
> would like to make just a tiny nudge towards tutorial mode focusing more on retention of the
> article rather than helping me explore my own thoughts. And actually, why don't we create a new
> exploration submode alongside tutorial submode that is more for, like, what do I think? Now, it may
> be that I can just get that from the chat, but ideally the exploration submode would have access to
> my comments, my highlights, my chat threads, and so it would know what discussions I've had so far
> and try and push me to think further about the things that are interesting to me. And so that's
> not to say that tutorial mode shouldn't push me to think at all. It's great that it does, but just
> a bit less, or at least a bit more of a focus on retention. To say understanding the author's, what
> the author is trying to say, and internalizing it.

The Tutorial prompt now puts what the author says first and rations questions about the reader's own
view. Measured before and after on two articles: such questions fell from 19 of 60 turns to 6 of 60
([261003c](../investigations/261003c-tutorial-prompt-leans-to-retention.md)).

**The Exploration sub-mode is built** (queue item `qi-pbskakrj`), on `dev`, not deployed. Offered
a Chat tool (B), a fourth Remember chip (A), or B then A, Greg answered:

> Q-explore B and A

and then reframed the chip before it was started:

> With regard to Explore sub-mode, I'm not sure that "pushier" is quite the right way to frame it.
> It's more that it's about helping me to think, explore & spark new ideas of my own and deepen my
> intuitions and apply to interesting cases of my own (if relevant, e.g. based on "Why you're reading
> this"), and a bit less about remembering specifically what's in the article. So it may also be that
> Explore submode also makes more web searches, to situate the article in terms of the wider world.

Both are built, in
[261003l](../plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md):

- **Chat can read his notes.** Asked what he has marked, what he thinks, or about an earlier
  conversation, Chat now reads his comments, highlights and bookmarks on the article and a list of
  his other conversations on it, and can read one of those. Only his own, only this article.
- **Explore**, a fourth chip in Remember: Recall · Tutorial · Explore · Quiz. Its own single
  conversation. Every turn is given his notes and conversations, starts from something he marked,
  makes one move (a question, a case of his own, a connection, or what others say, searched and
  linked), and is brief. No Live voice yet, as in Tutorial.

Measured against Chat with the new tool, on two articles
([261003e](../investigations/261003e-explore-sub-mode-against-chat-with-the-notes-tool.md)):
Explore's replies are half the length (138 words against 288), start from his notes every time,
and search and link every time he asks what others say. **It did not beat Chat on the number
meant to lead**: a blind judge called 93% of Explore's replies "about the reader's thinking" and
87% of Chat's. Asked to be a thinking partner, Chat is one too; the difference is the shape of a
turn.
