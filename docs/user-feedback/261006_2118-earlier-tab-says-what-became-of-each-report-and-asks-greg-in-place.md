---
reports: spya-cnbv8f, spya-sshjd2
ending: shipped
comment: Shipped: your Earlier tab now sorts reports into Open, Needs a decision, Set aside and Shipped, numbers each one, and lets you answer my questions in place.
---
# The Earlier tab says what became of each report, numbers them, and asks Greg in place

Two reports from Greg (admin; `feedback-reporter.ts` exit 0 on each production row), filed from
`/changelog` on 2026-10-06, SPIDERYARN-READING2-E2 and -E3. Overseer queue item `qi-ewwnsr85`.

> When I look in feedback earlier, not shipped, there's still quite a few listed. Some of them are
> very new, so I'm sure you'll get to them. But some of them are older, and I'm assuming that's
> because maybe you've decided not to, or you're deferring them, or you think the complexity doesn't
> merit the value. Okay, that's fine. But let's give you another category for deferred or ignored,
> or maybe even both. Perhaps with the— and what I'd like would be for you to write some kind of
> comment that would indicate why you deferred them, or what the question was, or something like
> that. And maybe you could give every single feedback report its own ID somehow, so that it would
> be easy for us to refer to them in conversation.
>
> — `spya-cnbv8f`, 2026-10-06 21:18

> I had a follow-up thought around feedback. Perhaps you could even find some way of signalling when
> you need input from me. So perhaps there'd be a way to categorize feedback reports as needing
> input, and you'd show my report and then their question from you, and then some kind of input box
> with a voice dictation button, so that if there are things that are blocking your ability to act
> on a feedback report, you can ask me inside the feedback dialogue on Spideryarn, and I can respond
> there. Of course, there'll be some things that will need me to open up our conversation, but
> hopefully fewer and fewer actually over time. And in fact, it should be possible for you to ask my
> input on things that aren't tied specifically to a feedback report. So you could ask me questions
> about anything in that needs input section.
>
> If there are any other minor improvements you want to make to this idea, go for it.
>
> — `spya-sshjd2`, 2026-10-06 21:30

**Ending: shipped**, on `dev`, not yet deployed. The plan, its two GPT Sol plan reviews, both code
reviews and the browser pass are in
[261007d](../plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md).

- **For an admin**, the Earlier tab has five pills: All · Open · Needs a decision · Set aside ·
  Shipped. *Set aside* is a declined note or an Ignore on `/admin/feedback`; *Needs a decision* is
  an awaiting note. Each report starts with a number (`#212`, said "feedback 212"), and may carry
  one line from its note saying why it was set aside, what is being asked, or what half is still
  queued. `feedback-reporter.ts` and `feedback-unswept.ts --show` take the number too.
- **Questions:** an agent writes a file in [`questions/`](questions/); after a deploy it leads
  *Needs a decision*, with a reply box and the dictation button. The reply is stored in
  production by Greg's own request, and `npx tsx scripts/feedback-questions.ts --answers` reads it
  back. The waiting list that used to be in [awaiting-approval.md](awaiting-approval.md) is now ten
  question files, two of them the questions this work raised.
- **Other readers see no change.** Whether they should is question `q-bw83d2`.

**Not built, written up for Greg:** a question appears only after the next deploy, because making
it instant needs an agent to write into production, either through a new endpoint with a secret
(an edit to the sign-in gate, a listed defence) or by the Overseer copying questions in between
deploys. That is question `q-f6ub8e`, recommending to keep the deploy for now. Multiple-choice
options as buttons are queued as `qi-kwkv4pct`.
