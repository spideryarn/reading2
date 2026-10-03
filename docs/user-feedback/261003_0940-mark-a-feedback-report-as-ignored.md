---
reports: spya-g95x4j
ending: shipped
---
# Mark a feedback report as ignored

Report `spya-g95x4j`, a suggestion, from Greg (admin), 2026-10-03, relayed by the Overseer (Sentry
event `d1d00fc4815a471aa3d0c897d5c3230c`), filed from the Entropy article in Remember:

> I just noticed there's a piece of feedback that hasn't been shipped yet that looks like it's just
> testing. It's like ASDF1, ASDF2. And so I wish I could delete it or mark it as invalid or
> something. Yeah, maybe mark it as invalid, or just remove, you know, mark it as to be ignored. I
> mean, hopefully you'd have figured out anything, but I just wanted to be able to do that. And maybe
> even add an addendum. I think probably one shouldn't be able to change the original feedback, but
> perhaps one can add an extra to it or something. I think that second part is lower priority.
> Anyway, I think we had started to move towards using the version in the database rather than the
> version in Sentry as the source of truth. I think that's probably a good idea. I guess the only
> thing I'm hesitating about is we had talked about moving towards using Linear for task tracking,
> and this feels like it's, well, I suppose we could mark something invalid in the feedback, and then
> that would perhaps flow through to Linear. I'm not sure what the best thing to do here is. I guess
> I just saw feedback that I wished I could delete, and there wasn't a way to do it, or at least mark
> it as to be ignored. And I thought that might be a useful signal for you and consider it. And we're
> not going to get to implementing Linear urgently because right now it doesn't feel necessary. It's
> working pretty well as it is, so maybe this is worth doing in the short run.

**Ending: Shipped**, on `dev`. Plan
[261003j](../plans/261003j-mark-a-feedback-report-as-ignored-from-the-admin-page.md); how it works
is [feedback.md § Ignoring a report](../project/feedback.md#ignoring-a-report-since-2026-10-03).

- **Ignore**: each card on `/admin/feedback` has an Ignore button. It marks the report in the
  database, the card stays in the list dimmed, and Undo takes the mark back. Nothing is deleted
  and the report's words are never changed.
- **What it changes for the agents**: `scripts/feedback-unswept.ts` leaves an ignored report out of
  the list of reports to work through, and says how many it left out.
- **The addendum** is not built. Greg called it lower priority; it is Overseer queue item
  `qi-943kc63h`.
- **Linear** stays deferred, as Greg said. The mark lives on the database row, so it is there to
  be read whenever Linear is picked up.
