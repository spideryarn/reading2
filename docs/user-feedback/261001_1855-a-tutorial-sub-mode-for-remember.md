---
reports: spya-j0scgz
ending: shipped
---
# A Tutorial sub-mode for Remember

Report `spya-j0scgz` (SPIDERYARN-READING2-98), a suggestion, from Greg (admin), filed
2026-10-01T18:55:13Z on production build `43be719`, on
`https://www.spideryarn.com/read/melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj?at=spya-rkpybr&mode=remember&summary=brief&thread=spya-uv286k`.
His words are the spec:

> For the remember mode, we currently have recall and quiz. Let's add one more that I guess we'll
> call it teach, unless you've got a better name for it. And I guess what I want to do is alternate
> like you providing a brief summary and then asking me to say it back in my own words.
>
> And so and, you know, if we go multiple iterations of this, then, you know, you might start to
> involve some spacing effect stuff where you start to ask previous to refer back and ask me to
> remember things that came earlier on in the conversation. Maybe take some ideas from Bloom's
> taxonomy and, you know, perhaps try and ask me to think of examples or applications or questions or
> concerns.
>
> In other words, basically, actually, maybe it's more of a tutorial. Let's call it tutorial. And so
> I think it might start with the sort of basic recall question. You know, what do you remember about
> the article?
>
> But it may be that the user says nothing. I haven't read it yet. Or maybe they say, oh, I have read
> it and here's what I remember. So if they have read it and here's what I remember, then I guess
> it's a little bit like the recall mode, except that you're doing teaching as well as asking and
> asking for them to respond back more.
>
> Whereas recall is a bit more like about the testing effect, test driven learning. So in tutorial
> mode, again, your responses should be fairly brief because we want this to be a quick back and
> forth. And actually, I think this would be ideal for the live real time voice.
>
> But that doesn't work very well at the moment. And so let's just focus on assume it's probably
> mostly going to be, you know, the user with voice dictation or maybe typing and then, you know,
> reading your responses. So if you use Sonnet for web research on any of these topics in order to
> kind of give yourself inspiration about how to, you know, structure the prompt.
>
> And if you can think of minor UI tweaks that would help, then great. I'm a bit wary about multiple
> choice, but I'd be open to close, i.e. fill in the gaps or other stuff a bit. Although I always find
> them kind of artificial and annoying. So I'm open to sort of specialist UI interactions that you can
> draw on as, you know, you need.
>
> But maybe let's just try and get the plain back and forth conversation mode working first. So let's
> try and avoid too much complexity. The prompt itself can be quite complex. Write up your research
> in docs research.
>
> And, yeah, like I say, it's a sort of balance between test-driven learning and kind of
> conversational teaching one-to-one. Take into account anything from the user profile or the why
> are you reading this information. Because obviously if I'm an expert in the topic trying to find
> out one particular issue, then the conversation should be very different than if I'm a complete
> novice.
>
> So that's important. And, you know, as before, include block links. And I suppose my mental model
> is that the goal is you're sort of teaching in a sort of somewhat Socratic way. So you're sort of
> asking questions where the questions themselves are often a form of teaching because they get me
> thinking about the topic.
>
> And also they might nudge a recollection. Or at least they might nudge me to speculate. Hopefully in
> a way that I'm guessing in the right direction. Because you want the user to feel successful and
> smart.
>
> And lots of small increments is probably better than big, slow increments.
>
> If you have other ideas that might be fun/valuable/interesting, but won't add too much complexity,
> feel free to add them.
>
> Write some of this up as a docs/project/remembering-vision.md

**Ending: Shipped**, on `dev`, with one part queued. Plan
[261002i](../plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md), stage 3;
research [261002c](../research/261002c-recall-and-tutorial-pedagogy-for-remember-mode.md); vision
[remembering-vision.md](../project/learning-vision.md).

What is built: chips **Recall · Tutorial · Quiz**. Tutorial is its own single conversation per
article. Each turn: a brief reaction, one small cited piece of the article, one task (say it back,
why, an example, apply it, push back), climbing as the reader succeeds and stepping down when they
are stuck; a reach back to an earlier point every few turns; the profile and reason for reading
shape it (an expert hunting one argument is taken straight to it); "I haven't read it" starts from
zero as guided reading, every piece a linked quotation. Plain back-and-forth only — no multiple
choice or cloze. Eval: `evals/remember-tutorial.ts`, two runs.

**Queued, not built:** Live voice for Tutorial, once Live is good enough — Overseer queue
`qi-vndvbye9`. Cloze and other specialist interactions are in remembering-vision.md as ideas, not
promised.
