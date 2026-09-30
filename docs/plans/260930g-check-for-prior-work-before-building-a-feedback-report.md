# Check for prior work before building a feedback report

SPIDERYARN-READING2-6F (report `spya-vv68py`), a suggestion from Greg (admin, so trusted input). It is
a doc edit a few lines long. No code changes.

## Greg's words

> I have a hunch that when I make suggestions, especially by the feedback box, that I often have the
> same idea multiple times, or I have an idea, suggest it, but it takes, you know, a day or two for it
> to get implemented, and in the meantime I find myself suggesting it again because I can't remember
> whether I've already suggested it. […] as part of the job, whichever agent is delegated to for a
> feedback report, it should do a quick check, perhaps with a sub-agent, for plans or evidence that
> this has already been done. In fact, it may be that also the overseer needs to do a quick check to
> see if it has already delegated to another agent in a different, you know, work tree or something.
> Anyway, so we don't need to go overboard on this, but let's just try and make a small effort to
> avoid unnecessary kind of duplication of work.
>
> — Greg, 2026-09-30, via the feedback box

He also asks for the admin-versus-other-readers rule. That is already in place: report 5K
([260929_2025-feedback-from-other-people-trust-tiers.md](../user-feedback/260929_2025-feedback-from-other-people-trust-tiers.md))
and [feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it). Nothing new is
needed for it.

## What the docs already covered, and what they didn't

- **The sweep (the Overseer's side)** already reads `docs/user-feedback/` for a finished report on the
  same subject (feedback-reports.md § The run, step 1). It also checks `gjd-remote ls` for a session
  named after **the same Sentry id** (§ A report dispatched is still `unresolved`). What it doesn't
  catch is Greg's actual case: the same idea filed again under a **new** id while the first report is
  still in flight. The first report's session is named `fb<its-id>-…`, so a search by the new id finds
  nothing.
- **The report session** had no step that checks for prior work at all. The sweep's dispatch briefs
  have started adding that step by hand (this session's brief had it), but the template in § The run
  doesn't include it. So whether it happens depends on whoever writes the brief.

## The change, as built

**Where it went, and why not where it belongs.** The right home is
[feedback-reports.md § The run](../project/feedback-reports.md#the-run). But that file is the feedback
sweep's authorised document, pinned by sha256 in `tools/overseer/standing-jobs.ts`
(`AUTHORISED_DOCUMENTS["feedback-sweep"]`). Changing one byte de-authorises the job and turns
`tests/overseer-standing-jobs.test.ts` red, and re-pinning is Greg's call, not a run's (fb32,
`eba0359c`; 5K, where the classifier refused the re-pin and Greg made it himself, `2678340a`). So
the rule went into [overseer.md](../project/overseer.md), in the feedback-reports bullet of the
standing jobs. That's the runbook the Overseer reads, and the Overseer writes every report brief, so
it takes effect today without touching the pin. § For Greg has the move into its proper home.

What it says:

1. **The sweep** also looks for the same idea under a different id. A repeat carries a new Sentry
   id, so an `fb<short-id>` search can't find it. It searches the subject's distinctive words in
   `gjd-remote ls`, `overseer-queue.ts list` and `docs/user-feedback/`, and opens what matches. A
   repeat found before dispatch joins that entry; if its owner is already live, the sweep sends it
   the new report id for the final note.
2. **Every report brief** gets one more line: check `docs/plans/`, `docs/user-feedback/`, `git log`
   and `gjd-remote ls` before building (a cheap subagent is fine), and open what matches rather than
   trusting a name. Already on `dev` → end **Shipped**, naming the commit. Another session has it →
   use `SendMessage` to ask that session to include this report id in its final note's `reports:`
   header, then stop without a second note. If delivery fails, leave the report unresolved for the
   next sweep.

**Why one shared final header, and not "Declined as a duplicate" or a headerless note.** GPT Sol's
plan review (P1): the reader's Earlier tab derives *shipped* from note headers, so `declined` would
stay false after the other session shipped the idea. The three endings have no "in flight" value.
The first built draft used a headerless note, which correctly reads as not shipped, but left the
sweep to edit it, regenerate the map, commit and push later — work the sweep does not own. The live
session already owns the ending and note, and headers already allow several comma-separated report
ids, so it records both. A failed handoff leaves the repeat unresolved rather than inventing an
ending.

**The simpler option passed over:** do nothing and rely on the briefs. The sweep's briefs have
started adding the check by hand, but that's the sweep's habit, not the doc, and a habit disappears
the next time someone writes a brief from the template.

**The heavier option passed over:** machinery. That would mean a similarity search over the queue,
or a check in `overseer-queue.ts add` that flags a near-duplicate. Greg said not to go overboard. This
kind of duplicate is cheap to spot by eye, and costs one wasted worktree when it's missed. Deferred
until it's seen to cost more than that.

## For Greg

**Move the rule into feedback-reports.md, and re-pin.** One commit that:

- in [feedback-reports.md § The run](../project/feedback-reports.md#the-run), step 1: after "Read the
  note before re-deriving its answer.", adds: *"Look for the same idea under a different id too: a
  repeat carries a new Sentry id, so search the subject's words in `gjd-remote ls`,
  `overseer-queue.ts list` and these notes, and open what matches. Before dispatch, put both reports
  in one entry. If its owner is already live, use `SendMessage` to ask it to include the new report
  id in its final note's `reports:` header; if delivery fails, leave the repeat unresolved."*
- in the dispatch template in step 2, before "Proceed autonomously": adds *"Start with the
  prior-work check in step 3."*
- at the start of step 3: adds *"**First, check it isn't already done or in flight**: docs/plans/,
  docs/user-feedback/, `git log`, `gjd-remote ls` (a cheap subagent is fine), and open what matches
  rather than trusting a name. Already on `dev`: end Shipped and name the commit. Another session has
  it: use `SendMessage` to ask that session to include this report id in its final note's `reports:`
  header, then stop without a second note; if delivery fails, leave this report unresolved for the
  next sweep."*
- cuts the overseer.md passage down to a pointer at that section;
- updates `AUTHORISED_DOCUMENTS["feedback-sweep"]` in `tools/overseer/standing-jobs.ts` to the new
  `sha256sum docs/project/feedback-reports.md` (the fingerprint in `AUTHORISED_HASHES` may move too:
  `tests/overseer-standing-jobs.test.ts` says which).

Two nearby things GPT Sol noticed and this run left alone for the same pin reason:
§ The run step 2 still says "One `gjd-remote` session per report" (it's per queue entry since
2026-09-10), and "Each session does its own bookkeeping — its own note … and its own Sentry status
write" predates the sweep taking over the Sentry write (2026-09-11). Worth fixing in the same
re-pin.

## Reviews

- Plan: GPT Sol,
  [plan-review-sol](260930g-check-for-prior-work-before-building-a-feedback-report-plan-review-sol.md).
  Taken: P1.1 (no false `declined`; the owner records both report ids at the real ending), P1.3 (the
  pin, which changed where the edit went), P1.4 (a name match is a lead: open it). P2.5's
  consolidation is in § For Greg. Not taken: P1.2 (telling sessions to write the note header and run
  `scripts/feedback-endings.ts`). [feedback.md](../project/feedback.md) already says it, and it's
  outside this report.
- Code: GPT Sol, workspace-write,
  [code-review-sol](260930g-check-for-prior-work-before-building-a-feedback-report-code-review-sol.md).
  It fixed a P1: the sweep can't reliably edit, regenerate and commit another session's headerless
  note, so the in-flight case is now a `SendMessage` to the owning session, which puts both report
  ids in its own note's header at the real ending. It also shortened the overseer.md passage. I
  reworded its brief line so a session reading it cold knows what the handoff is.

## Status

Shipped to `dev` (docs only; not deployed). The move into feedback-reports.md and its re-pin wait for
Greg (§ For Greg, and a line in `docs/user-feedback/awaiting-approval.md`).
