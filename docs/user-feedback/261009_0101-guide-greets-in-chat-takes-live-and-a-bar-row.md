---
reports: spya-s6qhzv, spya-x38nge
ending: shipped
comment: The guide now greets you in the chat and asks why you're reading (no box), takes Live, and has a Guide row in the command bar. Still waiting on you (q-w2740x): may it save your reason itself, and offer share, private link and archive?
---
# The guide greets you in the chat, takes Live, and has a row in the command bar

Two admin reports from Greg (`scripts/feedback-reporter.ts` exit 0 on both), filed 2026-10-09 at
01:01 UTC from `/changelog` (SPIDERYARN-READING2-FB, #500, with a screenshot) and 01:05 UTC from the
guide on *Attention Is All You Need* (SPIDERYARN-READING2-FC, #501). Session
`fbs6qhzv-guide-greets-and-live`, queue item `qi-7wcnqdd6`. Plan, Opus's product call, both GPT Sol
reviews and the browser check:
[261009i](../plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md).

> The new guide chat UI is a bit confusing. It shows the input box for why you're reading this, and
> so I put in some text in there, and then I was like, well, now what? There didn't seem a button to
> save it, or I guess it says saves as you type, but I definitely didn't notice that. And I think if
> we're in a chat interface, I want to use the chat interface. So, for example, I think what I was
> expecting it to do was, before it loads the chat, check, you know, have I entered a user profile?
> Have I entered why you're reading this? And then depending on that, maybe it would
> deterministically generate an initial message: Hi there, welcome. I see you've imported blah blah
> blah. I noticed from your profile that blah blah. Is that right? More importantly, why are you
> reading this particular article? You can tell me about yourself, or you're perhaps reading it and
> I'll update your profile and reasons accordingly, and then help you figure out how to get the most
> and kick off, you know, tools to help you get the most out of Spideryarn's functionality for
> reading this, or something like that. So probably it would mean that the model would then
> generate. The first message, the greeting message, so that it's customized to, based on, you know,
> their profile and what we know about them and anything else. I mean, I suppose it could even be
> like, Oh, well, I notice you're a cognitive neuroscientist. What makes you want to learn about
> LLMs? or something. Because basically we're trying to elicit information about both the profile
> and especially their reasons for reading it, and then use that in order to guide them towards good
> stuff. And so probably it could say, Well, listen, the summary's just finished loading. Do you want
> to see that? It sounds like, you know, you don't really have a background in this, so maybe start
> with a briefer one. Or it sounds like you really do, and so maybe why don't you start with the
> fuller one? And it would provide, ideally it would provide buttons in the chat interface, but links
> would be fine as well for now. Because basically this is, like I say, it's like a guide or
> tutorial, but also an efficient way to kick things off in the background and just navigating
> around a bit, I guess. Maybe you can see an 80/20 or a better way of doing this, but hopefully that
> gives you the gist of the intent. And of course it has all the other chat tools. So it may be that
> something the user says requires a web search or, you know, if they say they want to read it with
> their journal club, then maybe we'd say, Okay, do you want to create a private link? Or they'd say,
> Well, this is actually My article, and I'm, you know, trying to share it with the world, and I want
> to run AI processing on it. Okay, great. Do you want to make it shared? Or actually, I kind of
> don't. I'm finished with this now. Okay, do you want to archive it? Like, all of these should be
> actions that the chat could help them take.
>
> And then it should always be possible to get back to the guide chat. In fact, there should be a
> command in the command bar for opening the guide chat. Now, as it happens, I think we're basically
> saying that the command bar itself has an LLM chatbot in it, which basically overlaps with a lot of
> the guide functionality. But nonetheless, we might want to get back to the original guide chat
> since it's hopefully going to be really useful and might include some context that builds up in the
> early part of the conversation. So maybe it gets its own icon in the list of chat threads.
>
> — `spya-s6qhzv`

> Why doesn't the Guide chat have a live conversation option?
>
> — `spya-x38nge`

## What we did

- **The greeting asks in the conversation, and there is no box.** Ours and free, drawn as the
  guide's opening message: welcome to the piece by title, *why are you reading it?*, and About you
  quoted back with *is that still right?* (or an invitation to say who you are). The reader answers
  in the composer. The personal part (*"what makes a neuroscientist want to learn about LLMs?"*)
  is the guide's first real reply, which has the profile, the reason and the whole article — Opus's
  80/20, over a second model call for the greeting.
- **Keep this as why you're reading**, under your first answer: saves your own words on your press,
  and never over a reason saved elsewhere meanwhile.
- **Live in the guide**, on both engines, with the guide's own spoken instructions and its own
  tools (enforced on the server, not only offered).
- **Guide in the command bar**, on your own article's reading view.
- **Already there**: the guide's own icon (the pinned Compass row, 261007j), and the guide
  suggesting Brief or Fuller from your background and opening it when already made (261007p,
  261008a).

## Still to come

- **Asked of Greg, `q-w2740x`**: may the guide save your reason (and About you) itself from what
  you say, and how should it offer a private link, sharing and archive? Queue entries
  `qi-bn7qs2r9` and `qi-rt49dwcd`.
- **Queued, `qi-bt4z2zaw`**: a spoken guide that opens modes itself; asking about the profile less
  often; a model-written greeting, if the fixed one reads flat in use.
