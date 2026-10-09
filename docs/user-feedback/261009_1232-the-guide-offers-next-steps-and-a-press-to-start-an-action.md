---
reports: spya-pqaftb
ending: shipped
comment: The guide now offers up to three next steps as buttons, and for a private link, sharing or archiving a button that takes you to where you do it. Still to come: sharing in a dialog over the page, and archive on the press (qi-ddvxcsdv).
---
# The guide offers next steps as buttons, and a press to start an action

An admin report from Greg (`scripts/feedback-reporter.ts` exit 0), filed 2026-10-09 at 12:32 UTC
from the guide on *Attention Is All You Need* (`/read/arxiv-1706-03762-spya-wyt7j0?mode=chat&thread=spya-mcaq7e`),
SPIDERYARN-READING2-FY, #518, kind suggestion; acted on together with part 2 of his reply
`spya-ujstyz` to [q-w2740x](questions/q-w2740x.md). Session `fbpqaftb-guide-action-buttons`, queue
item `qi-j45yc3ck` (superseding `qi-rt49dwcd`). Plan, Opus's product call, both GPT Sol reviews, the
eval and the browser check:
[261009s](../plans/261009s-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md).

> For the guide chat, it has a button for where do I start. That's good. I guess what other options
> can we offer? I suppose other buttons could include help me clarify my intent, suggest some tools
> or modes. What else? But we want to frame this in terms of user value and not use jargon. Ideally,
> it would actually have very custom suggestions like search for X or, you know, check the
> literature for Y or read the brief summary or kick off a chat with the following question or do a
> tutorial on the following thing or quiz me to see if I really do remember as well as I think, or
> something like that. We obviously don't want to present too many buttons to the user. Maybe three
> or four is the maximum, plus the free text input box, of course. So maybe three would be about
> right. Probably the LLM should suggest them as the language, but maybe there are some defaults.
> Yeah, so maybe if it's early in the conversation, we probably rely more on built-ins and defaults,
> and if it's further along in the conversation. So then maybe the element for creating custom ones.
> I think this fits with my previous suggestion that maybe it was sort of have custom, well,
> reusable UI components that kick off particular tools, like I would search for X, so you'd have an
> input box and a search button, then that would show a loading spinner and whatever. But at the
> same time, we're trying to reuse existing UI machinery, and we're not. I think it would be so easy
> for this to get really complex. Let's try and look for the 80/20 as always. And so if anything,
> I've asked is really hard, either simplify or ignore it for now.
>
> — Greg, 2026-10-09, `spya-pqaftb`

And part 2 of his reply `spya-ujstyz` to q-w2740x:

> 2 so my original intention was actually that the guide would be able to take the actions itself if it was confident. I suppose there's a bit of risk to that and maybe complexity. So the alternative would be it takes you to the relevant place, although that might be a bit confusing for the user.
>
> Here's what would be ideal, I think, would be if the guide was able to kind of add UI components for different kinds of actions. This would be perfect. So then if I say I want to generate a private link, that maybe it would say, okay, I think what you want to do is generate a private link. Click this button to do so. Now in an ideal world that would then, I don't know, flash up a modal, a modal or something like that, with all the extra information, so it doesn't all happen within the chat.
>
> For that to work well, we want to make sure we're reusing UI components and machinery, that there aren't multiple ways to create a private link, and so perhaps that means that in the metadata creating a private link uses the same modal machinery rather than being within, buried within or something like that.
>
> I guess the key point is that, the point is that I think the ideal would be if the chat has the ability to add certain simple UI components like buttons to kick things off, or feedback, or toggles, or sliders, or whatever else it needs, so that it can take what the user has asked for and enable them to manually initiate things.
>
> In the case of something like a search, well, yeah, so maybe it'd be like, okay, well I think what we should do is search for X, and maybe it would show an input box and a button and you could tweak the input and then press the button. That way we're de-risking it. It's not automatic. The user can modify it and also see what's happening.
>
> I guess the only thing is that then, yeah, and then what I was trying to say was that it reuses existing machinery. So in the case of a search, I suppose then what it would do is it would show you a loading spinner and a button that says "Show me this search" or something, and then that would take you to search mode.
>
> I can imagine a future world in which actually all of the machinery for searching, the UI components for searching, are actually embedded within the chat, so you can do everything from within a chat, do everything from within a chat, like a kind of control center. That would be super cool. I can't tell for sure if that would be a good user experience, and I assume it would be complex. But perhaps that's one potential vision of where we're going.
>
> — Greg, 2026-10-09

## Ending: shipped

On `dev`, not deployed. An empty guide offers three ways in (*Where should I start?*, *Help me work
out what I want from this*, *How could I read this well?*). After that, the guide's own
`offer_next_steps` tool puts up to three buttons under its latest answer: something to ask next, a
mode, a quick search whose words you can change first, or *Share this article…* / *Archive or put
back…*, which take you to the place on Metadata where you do it. The guide never presses any of
them, and nothing in the row shares, publishes or archives.

Simplified or left for later, as he allowed: sharing in a dialog over the page, and archiving on the
press with an Undo (queued as `qi-ddvxcsdv`, a proposal); toggles, sliders and the "control centre"
(named in the plan, not queued); next steps in Live.
