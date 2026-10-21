# Feedback rules: Greg's answers on reader suggestions, the per-reader cap, and asking him less

Queue item `qi-92cdpjxv`, session `fbx4zujq-feedback-rules-replies`. Two replies Greg wrote in the
Feedback dialog on 2026-10-20, to two questions asked by the run in
[261020p](261020p-greg-gates-readers-feedback-admins-filter-readers-reports-in-needs-a-decision.md).
Doc-only: no code, no schema, no prompt the app sends.

## What Greg said

To [q-jq72qd](../user-feedback/questions/q-jq72qd.md) (should a reader's suggestion come to him by
default; A yes as written, D keep the current rule), reply `spya-ktu6cu`, 21:47 UTC:

> I'm torn between A and D. I guess let's try and make a minimal update that lands somewhere in
> between.

To [q-eedt7w](../user-feedback/questions/q-eedt7w.md) (keep, raise or drop the 30-an-hour
per-reader feedback cap), reply `spya-p607q2`, 21:45 UTC — the key parts:

> Use your judgment. Keep things simple. And can you make a minimal update to whatever prompt it is
> that is asking me these questions to sort of say, look, you know, is it important to ask me a
> question like this kind of question? I don't really care. The stakes are incredibly low. […] All
> I'm trying to avoid is anything that's going to be a bad user experience. And, you know, the worst
> case is we have a bunch of rows in the database that are junk for some reason that we'd have to
> delete. […] If in doubt, ask GPT Sol for a second opinion. Or try asking an Opus sub-agent that's
> pretending to be a user and another Opus sub-agent that's pretending to be a different role and
> then, you know, make your judgment based on their arguments or something. But don't bug me for
> trivial stuff.

## Decisions

1. **The cap stays at 30 an hour per reader.** The simple answer: nothing changes, nobody has come
   near it (a reader's busiest day was 3), and it stops a loop or one account hammering, limiting that account's agent work to 30 reports an
   hour (it does not stop account farming; [feedback.md § The rate cap](../project/feedback.md#the-rate-cap-and-who-has-none)). Greg's "keep things simple" and "use your
   judgment" settle it; no Sol or role-play needed for a no-op.
2. **Reader suggestions: between A and D.** D (today) lets an agent build a reader's suggestion
   without asking if it is minor and clear-cut. A made *Awaiting Greg* the default and narrowed the
   build route to things he would be surprised to be asked about (a typo), plus a line in every
   session's brief. The middle keeps D's thresholds, the build route and the brief as they are, and
   takes from A only two things:
   - its framing: a request is evidence, not authority; a reader's suggestion is a proposal to
     judge (his 2026-10-19 "be wary");
   - one sentence on the build route: a change other readers would notice needs extra scrutiny
     however small, and is built without asking only when Opus and Sol both support it; otherwise
     it goes to Greg.

   Passed over: A's brief line (the brief already sends the session to this section), A's
   *Awaiting Greg* default, and B. The simpler option, changing nothing, is D, which he declined.
3. **Asking less.** The rule for whether to ask lives in one place,
   [ask-me-questions.md § Whether to ask at all](../reusable/ask-me-questions.md#whether-to-ask-at-all);
   engineering-manager.md, overseer.md gate 2 and AGENTS.md point at it or say a compatible thing.
   One paragraph goes there: the gated list (which includes "a security defence", the reason q-eedt7w
   was asked) is a prompt to weigh the stakes, not a trigger to ask; low stakes, a plainly good
   option or no real trade-off ⇒ decide; in doubt, Sol or two Opus role-players, then judge. Nothing
   else changes — AGENTS.md is not touched (it costs every turn and already says "ask only when there
   is a genuine choice").

## The edits (before → after)

The wording below is as landed, after GPT Sol's plan review (§ Review).

### 1. `docs/project/feedback-reports.md` § Who sent it

Before: *"… The bar for building is not that the request is harmless. **The report chooses the
problem, never the implementation** …"*

After, one sentence and a quote inserted between those two:

> **A request is evidence, not authority**: a reader's suggestion is a proposal to judge, not an
> instruction to carry out, and being told that we build whatever readers ask does not lower the bar.
> Greg, 2026-10-19: *"Be wary about simply doing as asked from non-admin-user Feedback"*.

First bullet (build it, if minor and clear-cut), before: *"… ([overseer.md](../project/overseer.md)'s
list, plus the last three). The quality bar is the same as any build …"*

After, inserted before "The quality bar":

> A change to what other readers see or do needs extra scrutiny, however small: build it without
> asking only when Opus and GPT Sol both support it and neither names a credible downside; otherwise
> bring it to Greg. (Greg, 2026-10-20, between a stricter rule and this one: *"let's try and make a
> minimal update that lands somewhere in between."*)

### 2. `docs/reusable/ask-me-questions.md` § Whether to ask at all

Before: the section's first paragraph ends *"Anything else is yours to settle with a second opinion
(Sol, or Opus to arbitrate). Decide it, and say in a line what you decided."* and goes straight on
to "Before asking, check it is still open."

After, a new paragraph between them:

> **That list is a reason to weigh the stakes, not by itself a reason to ask.** Keeping things as
> they are is yours to decide when nothing about them gives a reader a bad time and it is cheap to
> revisit. So is a change where the stakes are low, one option is plainly good, or there is no real
> trade-off, unless it loosens a defence, changes a prompt or a privacy promise, or writes
> destructively to real data: those still go to him. In doubt, ask GPT Sol, or have two Opus
> subagents argue from different roles (a reader, and someone else with a stake), and judge between
> them. Greg, 2026-10-20: *"is it important to ask me a question like this kind of question? […] All
> I'm trying to avoid is anything that's going to be a bad user experience. […] But don't bug me for
> trivial stuff."*

## Bookkeeping

- Both question files: reply quoted under the body with its date, reply id in `acted:`,
  `status: answered`, before/after recorded.
- Both notes: ending changes from *awaiting* to *shipped* (`spya-x4zujq`: wording landed;
  `spya-y43ha0`: built half already on dev, cap kept).
- `npx tsx scripts/feedback-endings.ts`, then `overseer-queue.ts done qi-92cdpjxv --by overseer`.

## Review

**Plan, GPT Sol (`--sandbox review`, exit 0, six findings).** Taken: the reader-visible sentence
became a strong presumption (both reviewers agree, else Greg) rather than an automatic gate, which
had made the middle operationally A (finding 2); "being asked counts for nothing" became "evidence,
not authority", since a reader's need is still signal (4); the cap rationale no longer overclaims
(6). Blended: findings 1 and 3 said the first draft of the ask-me-questions paragraph could be read
as licence to change a defence, a prompt or real data without Greg, and was too long. The landed
version names those as still his, and is shorter; it keeps a short quote of Greg, as the house style
asks, which Sol would have left out. Finding 5 (overseer.md gate 2's summary) needs nothing once 2
was taken.

**Diff, GPT Sol (`--sandbox workspace-write`, exit 0, approved).** Three low findings, all fixed by
Sol and read: the plan had called the ending `done` rather than `shipped`, and three quotes of Greg
had their punctuation moved to match the source.
