---
reports: spya-vv68py
ending: shipped
---
# Check for prior work before building a report

SPIDERYARN-READING2-6F (report `spya-vv68py`), a suggestion from Greg (admin), sent from
`/read/dongetal25-spya-vfmvmm?mode=glossary`. The time in the file name is the feedback row's
`created_at` (UTC), read from production inside a read-only transaction. This session runs on a pool
account and couldn't read Sentry.

> I have a hunch that when I make suggestions, especially by the feedback box, that I often have the
> same idea multiple times, or I have an idea, suggest it, but it takes, you know, a day or two for it
> to get implemented, and in the meantime I find myself suggesting it again because I can't remember
> whether I've already suggested it. Anyway, if that happens, I guess what I'm asking is, can we make
> a minimal update to the doc that deals with feedback reports? And we should have one that sort of
> says things like, take suggestions from me, the admin, as if they're prompts, but from other users
> more judiciously. I think I've given a suggestion about this in more detail already. Anyway, point
> is, we need a doc about feedback reports and how to process them, and in that make a minimal update
> that says something like, as part of the job, whichever agent is delegated to for a feedback
> report, it should do a quick check, perhaps with a sub-agent, for plans or evidence that this has
> already been done. In fact, it may be that also the overseer needs to do a quick check to see if it
> has already delegated to another agent in a different, you know, work tree or something. Anyway, so
> we don't need to go overboard on this, but let's just try and make a small effort to avoid
> unnecessary kind of duplication of work.

**Ending: Shipped.** It's on `dev`, not deployed, and the next feedback sweep resolves 6F in Sentry.
One small follow-up is yours, and is listed in `awaiting-approval.md`.

What we did: before building anything, this session checked for prior work (plans, notes, `git log`,
`gjd-remote ls`) and found none. The admin-versus-others half was already done in 5K. The new rule is
in [overseer.md](../project/overseer.md), in the feedback-reports bullet:

- the sweep looks for the same idea under a **different** Sentry id, not only the same one;
- every report brief tells its session to check before building. If the work is already on `dev`, the
  session ends Shipped. If another session has it, that owner is asked to put both report ids in its
  final note; a failed handoff leaves the repeat unresolved for the next sweep.

It belongs in `feedback-reports.md`, but that file is pinned by hash as the scheduled sweep's
authorised document, and re-pinning is yours. The exact wording for the move, and the re-pin, are in
[260930g § For Greg](../plans/260930g-check-for-prior-work-before-building-a-feedback-report.md#for-greg).
