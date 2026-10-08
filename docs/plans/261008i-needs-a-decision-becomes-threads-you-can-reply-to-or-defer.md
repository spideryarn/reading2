# *Needs a decision* becomes a list of threads you can reply to, or defer

Up: [feedback.md](../project/feedback.md) · [feedback-reports.md](../project/feedback-reports.md) ·
builds on [261007d](261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md) ·
reports `spya-u6h6q8` (bug), `spya-bzwzfw`, `spya-t6nmxt`, `spya-bbe74w`, `spya-n7hvm0`,
`spya-krvuc9`, `spya-za2tse`, `spya-frpy22` · worktree `feedback-earlier-decisions`

Named **261008f** while it was built: another plan took that letter on `dev` at the same time (the
way-back chip), so this one became 261008i at merge. Commits `6d5f0b934` and `ff88d0cd8` say 261008f.

Status as of 2026-10-08: **built, reviewed by GPT Sol (plan twice, code once: approve with six fixes, applied), seen in Chromium and iPhone-sized WebKit, and on `dev`; not deployed.** The reply box on a real iPhone with its keyboard up is still to be seen (Greg's phone).

**The code review** (`261008i-needs-a-decision-code-review-sol.md`, C1–C6, all fixed by the reviewer): `--answers` printed deferrals of settled or since-replied questions as in force (C1); a question kept on screen only to protect a draft was counted and grouped as live (C2); a reply could be sent by keyboard while a deferral was in flight (C3); a deferral receipt that another tab had overtaken was refused (C4); nested answers and the reply receipt were not held to exact keys (C5); and the endings map was stale against this plan's own note, so the eight reports would have shown as Open (C6).

## What Greg asked for

Eight admin reports, 2026-10-08 16:12–16:50 UTC (`feedback-reporter.ts` exit 0 on each). His words:

> I'm using the feedback slash earlier slash needs a decision interface, and it's weird. There seems
> to be a few that are listed there, but there doesn't appear to be a reply button or input box for
> me to use to actually provide a reply.
>
> — Greg, 2026-10-08 (`spya-u6h6q8`, #490)

> In feedback slash earlier, first open the "needs input" tab by default.
>
> — Greg, 2026-10-08 (`spya-bzwzfw`)

> I wonder if we could add a quick link to it next to the Write and Earlier tabs at the top of the
> feedback dialog. […] Maybe it would show the number there with a tooltip showing, I don't know,
> how many since my last visit or when they were most recently added or something. […]
> within needs a decision, I think what would be nice would be if there was a kind of table of
> contents of all of the threads that need a decision. And then if I clicked on one, it would sort
> of show me that thread on its own. […] I guess then there would have to be next and previous
> thread buttons, or I could click back to, you know, the table of contents of all the threads.
> And maybe there should be a button to say, do you know what, I think for now let's defer this as
> an alternative to replying.
>
> — Greg, 2026-10-08 (`spya-t6nmxt`; `spya-bbe74w` asks for the same table of contents)

> if I reply to a needs a decision, put it into a separate box for "Human response being
> considered" or "You have responded" or something like that.
>
> — Greg, 2026-10-08 (`spya-n7hvm0`)

> I wondered whether we should also include, I don't know, the agent or session ID and/or the
> question ID in the needs a decision tab, so that I could move between the feedback dialogue and
> the overseer conversation in my terminal and kind of know that I'm referring to the same thing
> across them.
>
> — Greg, 2026-10-08 (`spya-krvuc9`)

> can you allow me to see exactly what my original sort of input question was (perhaps
> default-collapsed expandable)? And also, somehow the response interface feels clumsy on an
> iPhone. I recorded something with voice into the little reply box and then tried to edit it, and
> the keyboard popped up, and somehow I couldn't actually ever see the... I couldn't scroll properly
> to actually get to the right bit of the input box. […] Finally, for the prompt that generates
> those replies, just make sure that it explains really plainly, provides a bit more of the context
> of what you've done. Assume that I haven't ever seen the code and that I might have forgotten a
> lot of the details. […] At the same time, be concise. So maybe there's a TLDR at the top, and with
> the choices, and then kind of a longer appendix with details underneath that I can read if I need
> to.
>
> — Greg, 2026-10-08 (`spya-za2tse`)

> Can you make the feedback dialog a bit taller and wider, especially on a big screen
>
> — Greg, 2026-10-08 (`spya-frpy22`)

## The bug: two lists under one heading, and only one of them can be answered

*Needs a decision* draws **two lists from two sources that nothing joins**:

1. the question cards (`EarlierQuestions`), one per open file under
   `docs/user-feedback/questions/`, each with a **Reply** button; and
2. under them, the report rows whose status is `waiting` (`EarlierList` → `AdminRow`), which is
   *derived from the notes' endings* (`ending: awaiting`, or a split report with a part not yet
   written up) and has **no reply control by design**: a report row was never a thing to answer.

On production today that is nine question cards and then three report rows: `spya-mdp0em` and
`spya-nnr8ha`, each of which **repeats** a question card above it (`q-deh67j`, `q-wux4k7`) without
its reply button, and `spya-thpsnd`, which has **no question at all**. thpsnd is `awaiting` only
because it was split into three parts and part 2 has no note (`combinedEnding`: fewer notes than
`parts` ⇒ awaiting); the two questions its part 1 note says were "queued for you" were in the old
`awaiting-approval.md` list and never became question files. So Greg sees rows under *Needs a
decision* with nothing to press, which is exactly the report.

**The class: one claim ("this needs a decision from you") computed from two sources, with nothing
that requires them to agree, drawn as if they were one list.** It went in with 261007d stage 2
(`ed62e3ab4`), whose decision 7 put the questions "at the top of *Needs a decision*" above the
reports and treated report status and question status as separate facts, which they are, without
asking what a report row under that heading offers the reader.

**The fix is the design below**: the unit of *Needs a decision* becomes the **thread**, which is
an open question; a waiting report with an open question is drawn **inside** its thread, never as
a row of its own; and a waiting report with no open question is drawn in a group that says so in
plain words, and is listed by the script the sweep runs, so an agent writes the missing question.
The failing test first: render *Needs a decision* with a question about a waiting report and a
waiting report with no question; assert that every report drawn there either sits inside a thread
that offers a reply, or sits under the heading that says no question has been written yet.

## The design in one picture

```
 ┌ Feedback ───────────────────────────────────────────── ✕ ┐
 │  Write   Earlier   Needs a decision (3)                   │  ← tabs; the third is admin-only
 ├───────────────────────────────────────────────────────────┤
 │  All 120 · Open 4 · Needs a decision 3 · Set aside · …    │  ← the pills, unchanged
 │                                                           │
 │  NEEDS A DECISION · 3                                     │  ← table of contents
 │   › A text size setting: the whole scale…   q-wux4k7 #212 │
 │   › Topic pills on the public shelf…        q-deh67j #301 │
 │   › Is waiting for the next deploy OK?      q-f6ub8e      │
 │  YOU'VE REPLIED · BEING CONSIDERED · 1                    │
 │   › Should Citations become part of Debate? q-xf2xvb #330 │
 │  DEFERRED · 1                                    (shut)   │
 │  WAITING, BUT NO QUESTION WRITTEN YET · 1                 │
 │   #295 · 3 Oct · Suggestion  "I would like to have fewer…"│
 └───────────────────────────────────────────────────────────┘

        click a thread ▼

 ┌───────────────────────────────────────────────────────────┐
 │  ‹ All threads        2 of 5        ‹ Previous  Next ›    │
 │  q-deh67j · about #301 (spya-mdp0em) · asked 4 Oct        │
 │  Topic pills on the public shelf: now, later, or…?        │
 │  TL;DR … the options … Recommended: C.                    │
 │  ▸ Details                                (shut)          │
 │  ▸ Your report #301                       (shut)          │
 │  [ your reply ……………………………………………………………… ] 🎤             │
 │  [Send reply]  [Defer for now]                            │
 └───────────────────────────────────────────────────────────┘
```

## Decisions, and the simpler option passed over each time

1. **A thread is an open question; it is in exactly one of three groups.** The server works out
   each question's `state`:
   - `responded` (*You've replied, being considered*) when at least one of the admin's replies to
     it has an id that the question file's `acted:` line does not list. Greg spoke; no agent has
     answered him yet. This is `spya-n7hvm0`.
   - `deferred` (*Deferred*) when the admin pressed **Defer for now** and has not replied since:
     the deferral's time is later than the newest unacted reply's.
   - `waiting` (*Needs a decision*) otherwise: never replied, or every reply acted on and the agent
     left the question open, which means its follow-up is in the body.

   Latest action wins between a deferral and a reply, by timestamp, in one pure function. A reply
   sent from a deferred thread therefore moves it to *being considered* with no second write.
   *Passed over:* a reply clearing the deferral row in the same request. It couples two routes for
   a rule a comparison of two times already states.
   The server needs `acted:` for this, so the compiler emits it in a **server-only** map beside the
   open questions; the browser receives only the derived `state`, as before it received no `acted`.
2. **What the admin replied: every reply not yet acted on, oldest first**, not only the newest.
   Acted replies are already quoted in the question's body by the agent that acted on them
   (feedback-reports.md § To act on one), so showing them again would print them twice. The wire
   field `answer` becomes `answers: []` plus `state`. A tab built before this deploy talking to a
   server after it fails its strict check and shows the failure sentence until reloaded; a tab
   after it talking to a server before it (a rollback) maps the old `answer` to
   `answers: [answer]`, `state` from whether there is one, as `withLegacyPage` does for `page`.
3. **Defer is the one new state, and it is a timestamp.** A new table
   `feedback_question_deferrals`: `(owner_id, question_id)` primary key, `deferred_at timestamptz`
   (null once brought back), `updated_at timestamptz not null` — *store when it happened*, both
   ways. `POST /api/admin/feedback/deferrals` `{ question, deferred: true|false }`, under the
   admin prefix gate like `answers`, one segment after `feedback/`, the question checked against
   the compiled list (any known id, as a reply is), idempotent: deferring a deferred question keeps
   its first time. Answers `{ deferredAt: string | null }`. In the dialog: **Defer for now** on a
   waiting or responded thread, **Bring back** on a deferred one.
   **What a deferral means to agents:** "not now; do not chase". `feedback-questions.ts --answers`
   prints the current deferrals as their own section (exit codes unchanged; before the table is
   deployed it says so and exits 0, as for replies). A deferred question stays `status: open`: it
   is still Greg's to decide. *Passed over:* a deferral as a reply row with a `kind` column. It
   would arrive in `--answers` as words to act on, and "bring back" would be a third kind.
4. **The table of contents, and one thread at a time.** *Needs a decision* opens on the contents:
   the three groups in that order, each row the thread's title, its `q-` id and its report's
   `#number`; *Deferred* is a `<details>`, shut. After the three groups, the fourth group, *Waiting,
   but no question written yet*, draws those report rows as today, under a line saying no agent has
   written the question for them yet. Clicking a thread shows it **alone**, with *‹ All threads*,
   *N of M*, and *‹ Previous* / *Next ›* through the contents in the order drawn (deferred last).
   The pills are hidden while one thread is showing: on a phone with the keyboard up they cost
   three lines. The contents is a list of buttons; the pager is buttons; both `type="button"`
   inside the form, as every control on this panel is.
   *Passed over:* every thread expanded in one long list with a contents of anchor links. It is
   what is there now plus links, and it keeps one reply box among nine bodies, which is the
   iPhone problem.
5. **In a thread, the reply box is simply there.** No *Reply* button to open it: a thread on its
   own is the thing being answered. Its draft is kept per question exactly as today (the hook the
   dialog keeps mounted), so going to the next thread and back keeps the words. Still one box, and
   one `useDictationField`, at a time; leaving the thread, the tab or the dialog stops the
   microphone as today.
6. **The ids, for talking to the Overseer** (`spya-krvuc9`). Each contents row shows the question's
   `q-` id; the thread shows `q-… · about #301 (spya-mdp0em)`. In a terminal,
   `npx tsx scripts/feedback-questions.ts --show q-deh67j` (new) prints that question's file, its
   `refs:` line included, and `feedback-unswept.ts --show 301` already prints the report.
   *Passed over:* the session's name. A question outlives the session that asked it (the asking
   session is usually gone by the time Greg reads it), so a session id would point at nothing; the
   `refs:` line already names the plan and queue item, and stays agent-side.
7. **His own report, shut** (`spya-za2tse`). The thread carries the report's whole text, in a
   `<details>` labelled *Your report #301*, shut by default. `linkedReports` returns the body too;
   still owner-scoped, so a question about someone else's report shows nothing of it.
8. **The shortcut (a button, not a tab: F7)** (`spya-t6nmxt`). For an admin, *Needs a decision (N)* after *Earlier*, where N
   is the number of threads in `waiting`. It is not a third panel: it is selected when the Earlier
   panel shows the *Needs a decision* filter, and pressing it, or that pill, is the same state.
   Its tooltip: *"3 need a decision · newest asked 8 Oct 2026 · 1 you've replied to · 1 deferred"*.
   To have N before Earlier is opened, **an admin's dialog reads the *Needs a decision* filter when
   it opens**, one GET per opening, admin only; every other reader is unchanged.
   *Passed over:* "how many since your last visit". It needs a remembered set of seen question ids
   per reader on each device; "newest asked" says nearly the same with nothing stored.
9. **Earlier opens on *Needs a decision* when a thread is waiting** (`spya-bzwzfw`). For an admin,
   pressing Earlier shows *Needs a decision* if the opening's read says any thread is `waiting`,
   and All otherwise. If the read has not landed when Earlier is pressed, it shows *Needs a
   decision*, and moves to All when the answer lands empty, unless the reader has chosen a pill in
   the meantime. The dialog still opens on Write.
10. **The iPhone reply box** (`spya-za2tse`). The box was three rows inside a scroller inside a
    dialog: a dictated paragraph scrolled inside the three rows while the panel scrolled around
    them, two scrollers under one finger with the keyboard taking half the screen. Now the box
    **grows with its text and never scrolls itself** (`field-sizing: content`, as `.cmt-note` and
    the annotate box already do, with a measured height where that is unsupported), so there is
    one scroller, the panel's, and iOS scrolls it to the caret. It starts at five lines. When it is
    focused and the visible viewport changes (the keyboard arriving), the caret's line is scrolled
    into view (`block: "nearest"`). The thread-at-a-time view (4) is most of the fix: one body
    above one box, not nine.
11. **The questions are written TL;DR first, details after** (`spya-za2tse`). The rule lives in
    feedback-reports.md § To ask and in the header `--new` prints; both get a short edit pointing
    at [ask-me-questions.md](../reusable/ask-me-questions.md) for the shape rather than restating
    it: the first lines are the question, the options and the recommendation, readable alone; then
    a line that is exactly `Details`, and under it what the report asked, what was done and what
    each option means, written for someone who has forgotten all of it and never read the code.
    The dialog draws everything after the `Details` line in a shut `<details>`. The body cap goes
    from 4,000 to 6,000 characters to make room for the appendix; the compiler refuses a second
    `Details` line. Existing questions, with no such line, show whole, as now.
12. **A bigger dialog on a big screen** (`spya-frpy22`). From 1024px wide: `min(92vw, 46rem)` wide
    (from 34rem), and on a window at least 760px tall the panel is at least `min(90%, 44rem)` tall,
    the scroller taking the room. A phone is unchanged; the `max-height: 90%` of the visible strip
    stays the cap everywhere.
13. **The orphans are found at the source too.** `feedback-questions.ts` (the listing the sweep
    runs every time) prints *waiting reports with no open question* as their own section, from the
    endings map and the question files, so the next sweep writes thpsnd's missing questions rather
    than this group quietly growing. `prompt-feedback-sweep.md` gets a line to act on it.

## What the plan review changed

GPT Sol refused the first draft (`261008i-needs-a-decision-plan-review-sol.md`, F1–F9). All nine
accepted, and **they amend the decisions above where they differ**:

- **F1, thpsnd was misdiagnosed.** Its part 2, steering Debate, *was* written up: in the caue42
  note (`261003_1016-debate-…`), whose header names only `spya-caue42`, and whose deferred half is
  the open question `q-sn37bt`. And the two questions part 1 queued have moved on: Simple is gone,
  and the More button superseded the list-modes menu; only the Marginalia filter is still open
  ([interface-vision.md](../project/interface-vision.md)). So:
  - **"A split report with a part not written up" is no longer `awaiting`.** The compiler tells
    the two apart: an explicit `ending: awaiting` is a decision owed by Greg; a split with fewer
    notes than `parts` is bookkeeping owed by an agent. The second is emitted in its own list
    (`FEEDBACK_INCOMPLETE_SPLITS`) and the admin tab shows it as **Open**, its comment the parts
    note's as now. Nothing else reads the difference: `isFeedbackShipped` was already false for
    both. `feedback-questions.ts` lists incomplete splits as their own section.
  - The caue42 note's header names `spya-thpsnd` too, so thpsnd has its three notes.
  - The part 1 note's comment is corrected, and **one question file is written for the Marginalia
    filter**, in the new TL;DR shape (decision 11), because it is the one thing from thpsnd still
    waiting on Greg and has no file.
  - The orphan group (decision 4) and its listing (13) stay, for explicit `awaiting` with no
    question; the failing test gains an incomplete split (drawn as Open, not in the view) and an
    answered question's report.
- **F2, the state rule, restated.** Both times are the database's `now()`: `created_at` on a
  reply, `deferred_at` on a deferral. **`deferred` when the current deferral is at or after the
  newest reply of any kind** (acted or not; a tie is deferred); otherwise **`responded` when a
  reply is unacted**; otherwise **`waiting`**. `acted` chooses only which replies are drawn. So
  defer → reply → acted, left open, is `waiting`, not the old deferral come back.
- **F3, both directions across a deploy.** The new client asks
  `GET /api/admin/feedback/earlier?…&questions=2`. The new server sends `answers`, `state` and
  `deferredAt` only when asked that, and otherwise the old six-key shape exactly, so an old tab
  keeps working after the deploy. An old server ignores the parameter, and the new client
  normalises its six-key questions (`answer` → `answers: [answer]`, `state` from whether there is
  one, `deferredAt: null`) before the same strict check. A test for each direction.
- **F4, a reply just sent.** On success the thread shows the reply and moves to *being
  considered* at once. That local receipt is retired only by an answer to a GET **started after
  the receipt landed**; an older GET landing later does not erase it. Each read records the
  moment it started on a per-hook clock.
- **F5, deferral writes are conditional both ways.** `deferred: true` writes only null → now;
  `false` writes only a time → null; `updated_at` changes only with a change. A retry returns the
  stored row untouched.
- **F6, a deferral needs an open question and a provenance.** Deferring an answered question is
  409 (a late reply keeps Greg's words; a late deferral preserves nothing). The table carries the
  server-authored `environment`, and `--answers` holds deferrals to the replies' rule: an
  administrator's row, from production or preview, or exit 2.
- **F7, a shortcut, not a third tab.** Write and Earlier stay the two ARIA tabs. Beside them, for
  an admin, a button *Needs a decision N* with `aria-pressed`: pressing it selects Earlier and the
  waiting filter. The pill does the same thing inside the panel.
- **F8, the reader's choice wins.** A per-opening counter goes up on every choice the reader makes
  (a pill, the shortcut, a thread, the pager); the opening read may move the filter to All only
  if the counter has not moved since it started.
- **F9, the reply box grows by measurement.** `field-sizing` reached iOS Safari only in 26.2, so
  the box is fitted by `scrollHeight` as QuizPanel's answer box is, measured again on a width
  change; that mechanism is pulled out of QuizPanel into a shared hook rather than copied. **The
  caret is left to Safari's own reveal**, which works once there is a single scroller; the plan
  no longer claims a `scrollIntoView` puts the caret in view. And **no desktop browser shows an
  iOS keyboard**: the WebKit check at 390px is of the layout with a short window standing in for
  the keyboard, and the real check is Greg's phone, said so in the note.

**Round two** (`261008i-needs-a-decision-plan-review-sol-r2.md`) closed F2–F9 and refused on F1
and F10. What changed:

- **F1, done as amended.** I had first added thpsnd to the command-bar note (`261003_1005`), which
  was wrong: that plan only *noted* thpsnd's command-bar paragraph, which shipped as part 3. It is
  the caue42 Debate note that wrote up part 2, steering Debate (queued there, asked as `q-sn37bt`),
  and its header now names both. A test pins thpsnd at shipped from the real notes. One cost,
  named: thpsnd's row now shows the caue42 note's comment (the newest shipped note's, by the
  existing rule), which is about Claims, not about fewer modes.
- **F10, declined for now.** It asks for a part number on every split note, so that a note
  attached to the wrong report cannot make a split look complete. The weakness is real and
  predates this plan (a wrong `reports:` line has always been able to mark a report shipped); this
  plan does not widen it, and fixing it means numbering 21 existing split notes after the fact.
  Written up as a follow-up in the note for Greg rather than built here.
- **F11, deferral receipts reconcile like replies.** A local defer or bring-back stands until an
  answer to a GET started after it landed; an older GET cannot put the old state back.
- **F12, bounded.** A thread sends at most its newest 5 unacted replies and `olderAnswers`, the
  number of older unacted ones not sent ("and 3 earlier replies"). Every reply is still stored
  and still printed by `--answers`; this bounds what one page carries.
- **F13**: the operative text below is corrected (one Marginalia question, a shortcut).
- **F14**: the client test's body-over-the-cap case uses the constant.
- **F15**: the `Details` line is compared exactly, untrimmed.
- **F16, a postmortem**: written by a subagent, under `docs/postmortems/`.

## Not in this plan

- Part numbers on split notes (F10, above).
- Showing any of this to readers who are not admins: unchanged, as 261007d decided.

## Stages

1. **The bug and the threads** — the failing test; `state`, `answers`, the report body, the
   compiler's `acted` map and `Details` split, the contents view, one thread at a time with the
   pager, the orphan group; `--show` and the orphan listing in the script. Server, client, tests.
2. **Defer** — the migration, the store methods, the route, the buttons, `--answers`' deferral
   section.
3. **The shortcut, the default, the size and the phone** — the shortcut and its count and tooltip, the
   prefetch, the default filter, the growing reply box, the dialog size; the docs (feedback.md,
   feedback-reports.md, the `--new` header, the sweep prompt); a WebKit check at 390px and a
   desktop check.

Each stage: `npm test` and `npm run typecheck` on the files touched, lint on them, a GPT Sol code
review that fixes what it finds, a commit. Push to `dev` at the end.
