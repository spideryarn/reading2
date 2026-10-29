---
reports: spya-zytb0g
ending: shipped
comment: Built: a Discussion kind for you, monospaced ASCII in questions, and mockups that open inside this dialog. ASCII is the default for now, as you chose; the Overseer's rules reworded (1A).
---
# Discussions, monospaced mockups, /admin/mockups, and the Overseer reaching Greg

Report #723, `spya-zytb0g`, Greg (admin, provenance proved), filed as a suggestion on 2026-10-28
from `/read/10356-a-path-towards-autonomous-mach-spya-jwqnrf`. Sentry: confirmed (event
`f0c8741e35774a00a4939a6c0b05a15c`). No addenda.

> In the feedback dialogue we have options for a problem or a suggestion. I guess I'd like to add a
> third for something like a question or a discussion where I'm going to ramble for a bit, raise some
> ideas, and I'm going to expect the model to come back with its own responses or proposals that we'll
> discuss some further, and then eventually go and build them.
>
> I think we have most of the UI machine we need for this. Really, so I don't actually need this extra
> category, but I feel like it would signal to the model expectations, and maybe it would have slightly
> different UI machine. Because I think we have this idea of like what is it? Add a reply or add an
> addendum or something like that in the feedback. Needs a decision stuff. So I think we can use that,
> but if you can see a way to improve it, I mean one really cool feature would be if the model could
> propose screenshots, or well at the very least ASCII text, but then it would need to be monospaced.
> Screenshots would be cool little ones, but maybe that's too hard. I suppose it could create mockups
> somewhere at a particular URL that only admins can see.
>
> So actually maybe that would be a really good extra feature. It would be to create a /admin/mockups
> page with a table that can link out to particular mockups. And then the decision process for new
> ideas could reference these mockups. For this, you're welcome to use the OpenRouter ChatGPT images
> API or Claude Design or any other approach that you think will be useful for generating mockups.
> There may be third-party libraries for mockups that would be helpful.
>
> Yeah, you could even try a few things and you know we'll compare and I'll say which I like. So if
> you want to have fun with this, you could even try, well, I was going to say you could mock up with
> /admin/mockups. I suppose it would have to exist in order for you to be able to do that, but perhaps
> you could do it and then show ideas for different ways the mockups page could or flow could work.
>
> And while we're at it, you could consider whether this feedback dialogue could be improved. The
> machinery to make discussions back and forth better, so that I basically never have to open the
> terminal right now. Sometimes still things still get blocked, and I get the sense that the Overseer
> or whatever in the terminal doesn't always surface them as feedback. And so actually that will be
> another thing that you could do. We make sure that anything that the Overseer needs to say to me can
> be said via this feedback machinery.
>
> So I guess there's a bunch of valuable things here!

**Ending: shipped** (since 2026-10-29; it was *awaiting Greg* until both questions were answered). Plan:
[261028b](../plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md).

- Built: an admin-only third kind, *A discussion*, which agents answer with proposals before
  building anything; fenced monospace blocks in questions; `/admin/mockups`, with mockup ids in a
  question linking to their pages; a line in the Overseer's tick naming each session stuck at a
  prompt with no open question about it.
- Asked: [q-c8h4zg](questions/q-c8h4zg.md) (which mockup style, and whether mockups should go live
  without a deploy) and [q-cgpett](questions/q-cgpett.md) (rewording the Overseer's rules so
  prompts, refused commands and asides reach Needs a decision; a notice kind; approving prompts from
  the phone).
- Deferred until 1 November: an image-model mockup through OpenRouter, which is over its monthly
  limit.
- Answered 2026-10-28. q-cgpett: 1A, done. q-c8h4zg (`spya-rrvwca`): ASCII in the question by
  default, a richer mockup only when the look matters and looked at first; a mockup id now opens
  the mockup inside the dialog instead of leaving it
  ([261029g](../plans/261029g-mockups-shown-inside-the-feedback-dialog-ascii-by-default.md)); no
  database publishing of mockups; the image-model mockup is parked in the queue (`qi-2fs87mnx`)
  rather than waiting for 1 November.
