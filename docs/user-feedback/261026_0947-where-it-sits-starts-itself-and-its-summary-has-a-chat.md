---
reports: spya-mfuz6g
ending: shipped
comment: Opening Where it sits with the Sources button or its tab now starts the literature search by itself (a link or Back does not). The summary has its own Ask in chat, quotes go to their passage, and cited works link out.
---
# Where it sits starts itself, and its summary has a chat

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-26 09:47 UTC, a suggestion filed from
`/read/index-spya-wq3rud?mode=sources`. Sentry SPIDERYARN-READING2-PA (#711). Session
`fbc5gvp0-where-it-sits-layout`, with its siblings spya-c5gvp0 and spya-pkpqch. No addenda when
re-read before this note.

> In the news sources search of the literature, I just ran it. First thing to say is when I open
> that submode, I want it to automatically start running rather than requiring me to open the
> submode and then click. Secondly, I ran it and it looks like there's kind of a summary at the
> top. Okay, good. I expected there to be a way to ask in chat about that summary. It looks like
> there's a way to ask in chat about each of the individual sections, but not about the summary
> itself.
>
> And also, I didn't check this, but I want to make sure that any of this stuff has lots of
> hyperlinks and block links and whatever to the text and to the outside world. The sources should
> be really densely linking.

**Ending: Shipped**, on `dev`. Plan
[261026g](../plans/261026g-where-it-sits-made-clear-runs-itself-and-reaches-the-margin.md) §§ Stage
2, 4 and 5.

**It starts itself — and this is where it met your cost rule.** Your answer to q-vg2b69 on
2026-10-25 put a ~$0.30 run *"upon user request"*; this report asks for it to start on opening.
**I took the press that opens the sub-mode as the request, and only the press**: the Sources button
when Where it sits is the view, its tab, or its command-bar row. That is the same line every mode
that starts itself already draws: a pasted link, a reload, Back and Forward, a margin's *Open in
Sources* or a chat's way back start nothing. One try per article per tab, never a re-run of a
search already stored (even an outdated one: that is *Search again*), and the existing allowance
(four an hour, twelve a day) still applies. When the works the piece cites are missing too, they
are listed first in the same job. The privacy page says so and is dated 26 October.

**The summary's chat.** The chat icon beside the overview asks about it, with the overview's words
in the question (chat cannot read the search itself). The chat is listed as *Started from the
overview in Sources › Where it sits*, its way back lands on the summary, and a new search gets a
new chat.

**Links.** Each finding's quoted words now go to their passage (as well as its id); each work
under *Before it* links out to the work itself where the article or the web gave an address; the
findings' sources and *After it*'s papers already linked out. **Not done: the overview's own
sentences linked to the passages they rest on.** That needs the search's prompt to return them,
as Summary's does, and waits until 261025h's model change to the same prompt has landed, so the two
are measured one at a time. Proposed to the Overseer as a queue item, since a session cannot add
one.

GPT Sol reviewed the plan (revise: the overview chat would have been filed under Investigate as
first designed, and two arms for one press were unsafe; both fixed as it suggested) and the code
(approve with fixes: the overview's way back now lands on the summary, and the tests cover every
path that must not spend).
