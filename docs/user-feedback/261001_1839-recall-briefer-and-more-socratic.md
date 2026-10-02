---
reports: spya-cjquu6
ending: shipped
---
# Recall: much briefer, nudging, and willing to fill the gaps

Report `spya-cjquu6`, a suggestion, from Greg (admin), filed 2026-10-01T18:39:28Z on production,
relayed by the Overseer with no Sentry mirror, on
`https://www.spideryarn.com/read/melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj?at=spya-s8dmnr&mode=remember&summary=brief&thread=spya-jxcxj7`:

> For the recall or remember mode, I forget what it's called, where it says, okay, just ramble, what
> do you remember? I want it to be much more Socratic. And so I think probably, I guess I'm in balance
> mode. I should, maybe I'll try it again in a different mode.
>
> But even in balance mode, I want its answers to be much more brief. And so, you know, let's say I
> ramble a bit and I don't do a particularly good job. Then perhaps it might nudge me in a, you know,
> it might correct something and then nudge me.
>
> I suppose it could nudge me in a couple of different directions so that I've got a choice. In case
> I don't remember much about the particular direction it chose. And, you know, if I say, you know
> what, I don't remember, it should be willing to fill in the gaps.
>
> But I'd say I want each interaction with it to be quite fast. So it's a bit more of a dialogue.
> Dialogue's maybe, yeah, okay. So maybe it's a paragraph or two at most in its responses.
>
> Unless, of course, it really needs a lengthy explanation because I've asked for it or because I've
> really got something subtle wrong. But maybe if that's the case, then maybe it would point me to the
> article rather than trying to explain it. Or, you know, offer to start up a chat for me about that
> particular topic.
>
> And hopefully there is a tool for starting a new chat thread. And if not, there should be.

**Ending: Shipped**, on `dev`, with one part queued. Plan
[261002i](../plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md), stage 2,
read with `spya-kqynj5` and `spya-c8x66d`, which ask for the same thing.

What changed: Recall is one adaptive voice. Each reply corrects at most one thing, quoted and linked,
then nudges — often in two directions to choose from; "I don't remember" or a nudge that got nothing
gets the gap filled; 60–100 words, one question. A reply that would need a long explanation points
at the passage and suggests Chat. Evidence: `evals/results/remember-recall.md`.

**Queued, not built:** a tool that starts the chat itself — there is none today. Overseer queue
`qi-mhqsts4z`.
