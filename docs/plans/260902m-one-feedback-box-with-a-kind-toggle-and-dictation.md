# One feedback box, a kind toggle, and a microphone

The Feedback dialog asks three questions in three boxes. Greg, 2026-09-02:

> We recently added a new "Feedback" dialog box. It has three input boxes. I worry that will be
> intimidating/off-putting to users, so let's combine them into one, with combined instructions (and
> perhaps a tooltip with extra guidance/reassurance). And add some kind of indication of our
> appreciation for them making the effort to provide feedback at the top of the dialog box.
>
> Maybe also add toggle for "Bug/problem" vs "Suggestion".
>
> And as a bonus, it would be great if we could add voice dictation (we have this elsewhere that
> hopefully we can reuse) for the new combined input box, to make it easier for people to speak out
> loud with their issue.

Three boxes is a form. A form is a thing you fill in when you have decided to file a bug; a person
who has just been mildly annoyed by something closes the dialog instead. The whole point of this
feature is to catch the second person, because [silent-success.md](../reusable/silent-success.md)
says most of what goes wrong here never throws, so the reader is the only instrument that detects
it.

## References

- [feedback.md](../project/feedback.md) — the evergreen doc for this whole feature; the map, the one
  rule, and what the tick-box is for.
- [260831aj-feedback-button-and-bug-reports-to-sentry.md](260831aj-feedback-button-and-bug-reports-to-sentry.md)
  — the plan that built it, and the two Sol reviews that changed it. The three-box shape came
  straight from Greg's original request, and that is the only argument it ever had.
- [`src/web/FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) — the dialog; `Answer`,
  `reportBody`, `asPlainText`, `discard`.
- [`src/routes.ts`](../../src/routes.ts) § feedback — `FEEDBACK_FIELDS`, `feedbackAnswer`,
  `parseFeedback`, `MAX_FEEDBACK_BODY_BYTES`.
- [`src/db/schema.ts`](../../src/db/schema.ts) § feedback — the columns and the CHECKs, including
  `feedback_says_something` and the three `*_shape` constraints.
- [`src/store/contracts.ts`](../../src/store/contracts.ts) — `NewFeedback`, `FeedbackReport`.
- [`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts) — the insert, the row shape, and
  `charsIn` (the rate cap's size measure).
- [`src/feedback.ts`](../../src/feedback.ts) — `message()` glues the three answers for Sentry;
  `tagsFor()` is the tag allowlist, pinned by `FEEDBACK_TAG_KEYS` in
  [`src/feedback-envelope.ts`](../../src/feedback-envelope.ts).
- [dictation.md](../project/dictation.md) § Adding it to a box — the three lines, and why `context`
  says *where* rather than *what*.
- [`src/web/AnnotateDialog.tsx`](../../src/web/AnnotateDialog.tsx) — the closest existing call site:
  a dialog, one textarea, `useDictationField`, and the `dictate.readOnly` guard on submit.
- `260902l-admin-feedback-page.md` — the `/admin/feedback` plan. Not linked, because it is not
  committed anywhere this worktree can see it: it exists as **uncommitted work in the shared tree**,
  and it is already built there against the three columns. See § What this collides with.
- [copy.md](../project/copy.md) — every reader-facing failure sentence ends in a bracketed code.

## Decisions

**One box, and it is required.** The three columns become one, and the dialog refuses an empty
report exactly as it does today.

**The three columns are backfilled and dropped.** Greg's call, asked directly on 2026-09-02, over
the additive-only alternative. A `body` column beside three dead ones would leave every reader of
this table — and the `/admin/feedback` page that has not been written yet — with two shapes to
handle forever, for the sake of a handful of alpha rows. So: add `body`, `update … set body =
concat_ws` from whatever the old rows have, drop `steps`, `expected`, `actual`. **This drops
columns on production**, which [AGENTS.md](../../AGENTS.md) says to ask about; it was asked and
approved. It is applied locally here and reaches production through `npm run deploy`, which is
Greg's to run — this box has no production credential.

**A `kind` toggle that starts unset.** *A problem* or *a suggestion*, and **neither is preselected**
— Greg, revising his own answer mid-plan: *"don't default to Problem. Default to null/unknown."* So
the column is nullable, sending nothing is allowed, and the old rows stay null rather than being
asserted to have been bugs. Native radios rather than a hand-rolled toggle: keyboard, screen reader
and focus ring come free.

**Thanks at the top.** One sentence, above everything, in the reader's interest rather than ours.

**"What helps?" as an inline disclosure, not a hover tooltip.** Greg asked for "perhaps a tooltip";
this dialog is a modal `<dialog>` painted in the **top layer**, and the house tooltip
([tooltips.md](../project/tooltips.md)) portals to `document.body`, which is underneath it. It could
be portalled into the dialog element, and that is fiddly for content that is invisible on touch
anyway. A small button that expands two sentences under the box does the job, works on a phone, and
adds nothing to the page when it is shut. Greg chose this over both the real tooltip and
always-visible hint text.

**The microphone is the existing one, unchanged.** `useDictationField` + `DictationButton` +
`DictationStrip`, the pattern in AnnotateDialog, and the `dictate.readOnly` guard on ⌘/Ctrl+Enter so
a send cannot beat the transcript in.

**The dictation `context` reuses the two kinds that exist.** `{ kind: "article", slug }` when the
reader is on an article, `{ kind: "profile" }` otherwise. A third `Where` kind for feedback is the
documented extension path and would buy nothing: the recipes already give this box the app's own
words (`Spideryarn`, `granularity zoom`, a block id) in both cases, and the article's glossary and
proper nouns when there is an article — which is exactly the vocabulary of somebody describing what
went wrong on the page in front of them.

### Simpler options passed over

- **Write the combined text into `steps` and leave the other two null.** No migration at all. Passed
  over: a column called `steps` holding a suggestion is a lie that every later reader has to be told
  about, and the header comment on the table argues at length for columns that mean what they say.
- **Keep the three columns as legacy.** Offered to Greg; he chose the backfill. See above.
- **Free-text `kind`, or a fourth "not sure" value.** The vocabulary is closed and null is the third
  state; a value spelled `unknown` and an absent value would be two spellings of one fact, which is
  the rule `comments_body_nonempty` and `consented` are already held to.
- **Raising `MAX_FEEDBACK_ANSWER_CHARS`.** One box replaces three, so the ceiling drops from 12,000
  characters to 4,000. Left alone: 4,000 characters is a very long bug report, the number is written
  into a CHECK, and the failure is a sentence telling the reader to trim, not a lost report.

### What the review changed

GPT Sol reviewed this plan before it was built —
[the prompt](260902m-one-feedback-box-with-a-kind-toggle-and-dictation-review-prompt.md), [the
answer](260902m-one-feedback-box-with-a-kind-toggle-and-dictation-review-sol.md) — and said *"do not
build this as written"*. Five of its nine findings changed the design, and three of those were bugs
that would have shipped:

1. **The backfill would have thrown a reader's words away.** The plan added a `body ≤ 4000` CHECK and
   then glued three separately-capped answers under it: three full ones come to 12,072 characters, so
   either the migration aborts or it truncates. It now admits `MAX_FEEDBACK_BODY_CHARS` (12,072) at
   the column and holds the reader to `MAX_FEEDBACK_ANSWER_CHARS` (4,000) in the route and the
   dialog, and nothing is cut.
2. **Closing the dialog would have left the microphone running.** `FeedbackButton` renders this
   dialog whether or not it is open, so Escape unmounts nothing and `useDictation`'s cleanup — which
   runs on unmount — never fires. Verified in the code, and now an effect on `open`.
3. **`dictate.readOnly` is not "the microphone is busy".** It is `transcribing` alone, the two
   seconds *after* stop. Send is now refused on `armed || readOnly`, with a test for each — the
   single test the plan asked for would have passed with the listening bug still there.
4. **A stale client would have been refused.** `FEEDBACK_FIELDS` rejects an unknown key outright, so
   a reader with a tab open from before the deploy would be told *"a report has a field this endpoint
   does not take"* at the moment they are trying to report that something is broken. The old three
   fields are accepted and folded into `body` under the migration's headings; sending both shapes at
   once is refused as `[fb-shape]`.
5. **Native radios cannot be un-picked**, and the plan wanted a toggle that starts unset. Two
   `aria-pressed` buttons instead: pressing the pressed one clears it.

Two more it was right about and this plan took a different way:

- **The deploy window.** Dropping columns is non-additive and `npm run deploy` commits migrations
  before the code goes live, so for a minute or two an old function serving `POST /api/feedback`
  would 500 — and if the Vercel build failed, until the next deploy. Sol asked for expand/contract
  over two deploys. Put to Greg with that cost named, he chose **one deploy**: an alpha with a
  handful of readers, an endpoint whose failure path already offers Copy and an email address, and
  the legacy acceptance above covers the client half of the same window.
- **`body` should not be nullable.** Agreed, and it is `not null`, which retires
  `feedback_says_something` altogether — the column's type is now the constraint.

### What this collides with

**`/admin/feedback` is built, and only in the shared tree.** Sol found the uncommitted
`AdminFeedbackList.tsx`, `pg-admin-feedback.ts`, `AdminFeedbackReport` and their tests in
`/home/greg/code/spideryarn2` — none of it committed, so none of it is on `dev` or in this worktree.
It renders `steps`, `expected` and `actual` individually and `ADMIN_FEEDBACK_SHAPE_MATCHES` pins the
wire type against `FeedbackReport`, so **whoever lands second has a typecheck failure and three dead
field reads to fix**. It is a small fix — one pre-wrapped body, and `kind` as Problem / Suggestion /
Unspecified — but it will not happen by itself, and 260902l's own doc needs the same amendment.

### The migration chain was forked before any of this

`npm run db:generate` refused on the first attempt: `0052_per_article_job_queue` and
`20260902141103_byok_upstream_nanos` both claimed `0051`'s snapshot as their parent, and **both were
already on `dev`**. Repaired here by rebuilding `drizzle/meta/20260902141103_snapshot.json` onto
`0052`'s id — 0052 touches `jobs` only and 141103 touches `ai_calls` only, so the merge was
unambiguous — leaving both `.sql` files and the journal untouched, which is what
[database.md § Repairing a fork](../project/database.md#repairing-a-fork-what-the-losing-migration-is-decides-everything)
requires of a published migration. A peer session reported repairing the same fork on `dev`
independently, about twenty minutes later.

## Stages

### Stage 1 — the schema, the store and the route ✅

- [x] `src/types.ts`: `FEEDBACK_KINDS`, `FeedbackKind`, `MAX_FEEDBACK_BODY_CHARS`.
- [x] `src/db/schema.ts`: `body text not null`, `kind text`, `feedback_body_shape` (12,072),
      `feedback_kind`; the three old columns and their four CHECKs gone.
- [x] Two migrations rather than one, because the shape needs three steps and drizzle will not
      generate a rename it has to guess at: `20260902161529_feedback_body_and_kind` adds the two
      columns nullable, and `20260902161553_feedback_one_body` backfills, sets `not null`, drops the
      three, and widens the CHECK. The `UPDATE` in the second is hand-written — everything either
      side of it is generated.
- [x] `npm run db:migrate` against the local Supabase (`Target:` read, not the success line).
- [x] `src/store/contracts.ts`, `src/store/pg-feedback.ts`: `body` and `kind` through the insert, the
      selection and `charsIn`.
- [x] `src/routes.ts`: the field allowlist, `feedbackBody` (both shapes), `feedbackKind`,
      `[fb-kind]`, `[fb-shape]`, and `reportKind` in the log line beside the store's own `kind`.
- [x] `src/feedback.ts` and `src/feedback-envelope.ts`: the message is the body, and `kind` is a tag
      that is absent rather than empty when the reader did not say.
- [x] `tests/feedback-store.test.ts`, `tests/feedback-route.test.ts`, `tests/feedback-mirror.test.ts`
      — the cap at exactly 12,072 and one over, every kind and none, a bad kind, the legacy shape,
      both shapes at once, and the tag's absence.

### Stage 2 — the dialog ✅

- [x] One box; the thanks line; the two toggle buttons; the "Not sure what to write?" disclosure;
      `asPlainText` carrying the kind; the title, the button's tooltip, the mailto subject and the
      "boxes above" sentence in `src/messages.ts` all made to say one box and not three.
- [x] `src/web/styles.css`: `.fb-thanks`, `.fb-kind`, `.fb-kind-button`, `.fb-under-box`,
      `.fb-help-toggle`, `.fb-help`, `.fb-body`.
- [x] `tests/feedback-dialog.test.tsx`: one body and a null kind, picking and un-picking.

### Stage 3 — the microphone ✅

- [x] `useDictationField` on the box, the button and the strip under it, the `armed || readOnly`
      guard on both send paths, and the effect that stops the microphone when the dialog shuts.
- [x] Three tests, and **each one watched to fail** with its guard removed before it was kept.

### Stage 4 — check it, review it, ship it

- [x] `npm test` and `npm run typecheck` (the five reds are the shared tree's, not this change's —
      `store-ai-calls`, `pdf-bundle-trace`, `auth-user-seeding`, `pdf-chunk-concurrency`,
      `store-jobs-parity` and friends fail the same way on `origin/dev` here).
- [ ] Browser pass in a Sonnet subagent against `npm run dev`: the dialog, the toggle, the
      disclosure, a report filed, and the row's `kind`. The microphone permission dialog is browser
      chrome and cannot be granted by an automated session
      ([dictation.md](../project/dictation.md) § What a browser pass could and could not check).
- [ ] Update [feedback.md](../project/feedback.md) and [dictation.md](../project/dictation.md) (the
      count of boxes with a microphone becomes six).
- [ ] GPT Sol code review of the diff; act on the findings.
- [ ] Commit and push to `dev`.
- [ ] **Greg**: `npm run deploy`, which is what applies these two migrations to production.
- [ ] **Somebody**: reconcile with the unlanded `/admin/feedback` work — see § What this collides
      with.
