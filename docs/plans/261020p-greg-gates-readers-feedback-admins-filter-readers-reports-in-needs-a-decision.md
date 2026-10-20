# Greg as the gate on readers' suggestions: an admins-only filter, readers' reports in Needs a decision, and two questions

Status: in progress, 2026-10-20. Session `fbx4zujq-greg-gates-reader-feedback`, queue item
`qi-t9wekker`.

## What was asked

Three admin reports (`feedback-reporter.ts` exit 0 on each), one subject. They followed the reader
report `spya-a48229` (#650), which opened *"I'm told that you'll build anything I ask you for"*.

> Be wary about simply doing as asked from non-admin-user Feedback - tweak to the prompt/docs about
> this. If in doubt, put it in the "Needs Input" (with questions/proposals/tradeoffs/etc) for me to
> respond to before acting on them.
>
> — Greg, 2026-10-19 21:34 UTC (`spya-x4zujq`, #654)

> Don't set a hard ceiling on the amount of feedback that we can receive - or set it to something
> very high like a thousand per day. And from a given user, well, I'm tempted to say we accept as
> much feedback as they give, but we have, you know, prompts or thresholds or guidance or guardrails
> to only act on the stuff that we think is good that we actually want to build. And that, you know,
> if in doubt, you can just pop it in needs input. So in other words, it's important that other
> users' feedback can show up in the needs input section, and it should be highlighted clearly as
> such, and that I can respond to that. And so I can basically be a gate, or a filter, or a judge, or
> a lens on what users are suggesting.
>
> — Greg, 2026-10-19 21:49 UTC (`spya-y43ha0`, #656)

> And also show a filter for admins only on this page.
>
> — Greg, 2026-10-19 21:50 UTC (`spya-kmqd7n`, #657, filed from `/admin/feedback`)

"Needs Input" is the Feedback dialog's *Needs a decision*: the question threads an agent writes
under `docs/user-feedback/questions/` ([feedback.md § Questions for an admin](../project/feedback.md#questions-for-an-admin-and-replies-to-them-since-2026-10-07)).

## What exists today

- **Questions about a reader's report are already allowed.** A question file's `report:` may name
  any report. But the thread shows the report only when it is the admin's own; for anyone else's
  the server sends `report: null` (`questionsForAdmin` in `src/routes.ts`, through the
  owner-scoped `linkedReports`), so the thread says nothing about whose suggestion it is, and the
  body has to carry it all.
- **`/admin/feedback` has two filters**, *Everyone* and *Readers only* (`FEEDBACK_FROM`,
  `?from=readers`, filtered by the store in `src/store/pg-admin-feedback.ts`).
- **The cap**: 30 reports an hour per reader (`FEEDBACK_HOURLY_CAP`), none for an admin, and no
  cap across all readers at all. Separately, the email that tells Greg about a report is capped at
  20 a day overall and 5 per reader, because Resend's free quota is shared with sign-in mail; every
  report is still stored and listed. The cap is a defence ([security-map.md](../project/security-map.md)).
- **The rule** for a reader's suggestion is [feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it):
  build it if minor and clear-cut, otherwise tweak, decline, or research and bring to Greg; *"In
  doubt between building and asking, ask."* That doc's wording is a rule, so its change goes to
  Greg first ([edit-important-docs.md](../reusable/edit-important-docs.md)).

## What this builds (stage 1)

1. **An *Admins only* filter on `/admin/feedback`** (`spya-kmqd7n`). A third value in
   `FEEDBACK_FROM`, `"admins"`, filtered by the store with `inArray(owner_id, ADMIN_USER_IDS)`, the
   mirror of the readers filter. Labels: *Everyone · Readers only · Admins only*.
2. **Another reader's report shown in its Needs a decision thread, marked as theirs**
   (`spya-y43ha0`, the display half).
   - The server resolves a question's `report:` the admin's own way first (unchanged); an id not
     found there is looked up across owners in `pg-admin-feedback.ts` (the one file that reads
     across owners, admin-gated by the route). Exactly one other owner's row ⇒ shown. Two or more
     (report ids are unique per owner, not globally) ⇒ none, and a warning logged, rather than a
     guess at whose it is.
   - The report gains `whose: "yours" | "reader" | "admin"` and `from` (the address the report
     was filed under, null for the admin's own). The thread's shut block reads *A reader's
     report #650 · from …* instead of *Your report #650*, and the ids line and the contents row say
     *a reader's #650*, in the accent colour, so a thread about someone else's suggestion is told
     apart at a glance.
   - **A new wire shape, `questions=4`.** The browser checks each question's keys exactly, so a
     new key on a shape-3 answer would make every tab opened before the deploy say the list would
     not load. Shapes 1–3 stay exactly as they are (a reader's report stays null for them); the new
     client asks for 4, and maps a shape-3 answer from an older server (a rollback) to
     `whose: "yours", from: null`, as it already maps 2 and 1.
   - Greg can already reply and defer on any thread; nothing changes there.
3. **Docs that describe the app**: [feedback.md](../project/feedback.md) (the filter, the thread),
   and the one sentence in feedback-reports.md that says a reader's report is not shown beside a
   question, which becomes false with this. That sentence is a description, not a rule, so it is
   corrected now and named in the question.

## What goes to Greg (stage 2, nothing built)

- **The wording for `spya-x4zujq`**: a before/after for feedback-reports.md § Who sent it and the
  sweep's brief, so that a reader's suggestion defaults to a question in *Needs a decision* and the
  build-without-asking route narrows. A question file, `report: spya-x4zujq`.
- **The cap for `spya-y43ha0`**: the cap is a defence, so it is a question, not an edit. Options:
  keep 30 an hour per reader (720 a day possible, and there is no overall ceiling already);
  raise it (e.g. a thousand a day per reader); or none. A question file, `report: spya-y43ha0`.

## Simpler option passed over

Leave the server alone and have agents paste the reader's words into the question body. It costs
nothing to build, but it is exactly what Greg asked to change: nothing marks the thread as someone
else's, the words are an agent's copy rather than the report itself, and the 6,000-character body
cap would cut a long report. The shape-4 bump is the cost of the browser's strict check, which
exists so a field meant for agents never reaches a tab unnoticed; a looser check would have been
fewer lines and a weaker guard.

## Not done

- Readers' awaiting reports with no question are not listed under *Waiting, but no question written
  yet*: that list is the admin's own reports. `feedback-questions.ts` already names any awaiting
  note without a question, so the sweep writes one.
- No change to the cap or to the rule wording until Greg answers.

## Reviews

GPT Sol on this plan (read-only) and on the code (fixes inside the stage), beside this file.

**The plan review** (`…-plan-review-sol.md`, *proceed with changes*), and what changed:

- **F1, taken.** "Own first, then one other owner" could show the admin's own report when a reader's
  shares its id. Shape 4 now asks only the cross-owner lookup, and an id answers only when exactly
  one row **across every owner, the admin's included** holds it; otherwise none, and a warning
  logged without the id. Sol's stronger option, naming the report by its globally unique number in
  the question file, is passed over for now: it changes the question format and its compiler, for a
  collision between two random ids that has never happened. Its other point, that a reader's
  question could mark the admin's own same-id report as *asked* (`isReportAsked`), is the same
  collision, pre-existing, and left as it is.
- **F2, taken.** An older server answers `questions=4` in its own newest shape (1, 2 or 3), so the
  client maps all three; `AdminFeedbackQuestionV3` is its own frozen type and V2 derives from it.
- **F3, taken in part.** admin.md, the route's comment and feedback.md now say `/earlier` has one
  cross-owner read. Not a defence edit: the gate is the `/api/admin` prefix, unchanged, and what the
  thread shows is what `/admin/feedback` already shows the same admin. security-map.md's line on
  admin.md ("the one request that reads across owners… one path prefix") stays true, so it is not
  edited.
- **F4, taken.** The new store method is on `AdminStore` and composed in pg-admin.ts; the route's
  400 names all three filters; tests below.

**Tests**: the admins filter in the store (paged), the route and the page; shape 4 against shape 3
in the route, the ambiguous-id warning, and a non-admin refused before any cross-owner read; the
lookup against the real database (one holder found; two readers sharing an id, and the admin and a
reader sharing one, both resolve to nothing); and in the dialog, a reader's and another admin's
report labelled, their words as text, an older server's report read as yours, and five malformed
`whose`/`from` shapes refused.
