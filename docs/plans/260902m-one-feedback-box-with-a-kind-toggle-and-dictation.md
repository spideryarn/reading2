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
- [260902l-admin-feedback-page.md](260902l-admin-feedback-page.md) — not built yet, and it will read
  whatever columns this plan leaves behind.
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

## Stages

### Stage 1 — the schema, the store and the route

- [ ] `git pull` first.
- [ ] `src/db/schema.ts`: add `body text` and `kind text`; CHECKs `feedback_body_shape` (null or
      non-empty and ≤ 4000) and `feedback_kind` (`null or kind in ('problem','suggestion')`).
      `npm run db:generate -- --name feedback_body_and_kind`.
- [ ] `src/db/schema.ts` again: remove `steps`/`expected`/`actual` and their three `*_shape` CHECKs;
      rewrite `feedback_says_something` to name `body`. `npm run db:generate -- --name
      drop_feedback_three_answers`, then **hand-write the backfill at the top of that file**, before
      the drops: `update spideryarn.feedback set body = concat_ws(E'\n\n', …) where body is null`,
      with the old headings kept so an old report still reads as one.
- [ ] `npm run db:migrate` locally, and read its `Target:` line rather than its success line
      ([database.md](../project/database.md)).
- [ ] `src/store/contracts.ts`: `NewFeedback` loses the three, gains `body: string | null` and
      `kind: FeedbackKind | null`. `FeedbackReport` keeps extending it — there is no legacy shape to
      read any more, which is the point of the drop.
- [ ] `src/types.ts`: `FEEDBACK_KINDS = ["problem", "suggestion"] as const`, beside the other two
      closed vocabularies, with the same note about the CHECK being a second copy pinned
      behaviourally.
- [ ] `src/store/pg-feedback.ts`: insert and select `body`/`kind`; `charsIn` counts `body`.
- [ ] `src/routes.ts`: `FEEDBACK_FIELDS` becomes `id, body, kind, consented, routeKind, slug,
      buildCommit, diagnostics, screenshot`; `feedbackAnswer` is reused for `body` and the empty
      check becomes one field (`[fb-empty]` keeps its code, new sentence); a `kind` check refusing
      anything outside the vocabulary (`[fb-kind]`); `MAX_FEEDBACK_BODY_BYTES` drops its `3 *`.
- [ ] `src/feedback.ts`: `message()` is the body; `tagsFor` gains `kind` when it is not null, and
      `FEEDBACK_TAG_KEYS` in `src/feedback-envelope.ts` gains it too (the compile error is the pin).
- [ ] Tests, written before the code where they can be: `tests/feedback-store.test.ts` (the cap at
      exactly 4,000 and one over, every value of `FEEDBACK_KINDS`, null kind, the says-something
      refusal), `tests/feedback-route.test.ts` (a body with `steps` in it is now refused as an
      unknown field, a bad kind is refused, a report with only a kind is refused),
      `tests/feedback-mirror.test.ts` (the message is the body, the tag arrives).
- [ ] `npm test`, `npm run typecheck`.

### Stage 2 — the dialog

- [ ] `tests/feedback-dialog.test.tsx` first: it posts `body` and `kind: null`; picking Suggestion
      posts `kind: "suggestion"`; Send stays disabled with an empty box; the existing id/idempotency
      cases keep passing with one box.
- [ ] `src/web/FeedbackDialog.tsx`: one `body` state replacing three; the thanks line; the radios;
      the disclosure; `asPlainText` and `reportBody` follow. Title becomes **Feedback** rather than
      *Report a problem*, because half of what it now takes is not a problem — and the `aria-label`
      with it.
- [ ] `src/web/styles.css`: `.fb-thanks`, `.fb-kind`, `.fb-help`, and the mic row. House `fb-*`
      classes, as the block there already says.
- [ ] `npm test`, `npm run typecheck`, `npm run check`.

### Stage 3 — the microphone

- [ ] `useDictationField` on the box, `DictationButton` under it (guarded on
      `dictation.supported`, as AnnotateDialog does), `DictationStrip` below the actions.
- [ ] The ⌘/Ctrl+Enter handler and the Send button both refuse while `dictate.readOnly`.
- [ ] A test that Send is refused mid-transcription.

### Stage 4 — check it, review it, ship it

- [ ] Browser pass in a **Sonnet subagent** — [browser-control.md](../project/browser-control.md)
      then [browser-testing.md](../project/browser-testing.md) — against `SPIDERYARN_STORE=postgres
      npm run dev`: the dialog opens, the thanks reads, the toggle picks and unpicks, the disclosure
      opens, a report files, and the reports land in the local `feedback` table with the right
      `kind`. The microphone permission dialog is browser chrome and cannot be granted by an
      automated session ([dictation.md](../project/dictation.md) § What a browser pass could and
      could not check), so the mic is checked as far as "Opening the microphone…" and no further.
- [ ] Update [feedback.md](../project/feedback.md) — the three answers are all over it — and the
      dictation.md line that counts the boxes with a microphone (it will be six).
- [ ] GPT Sol code review of the diff; act on the findings.
- [ ] Commit and push to `dev`.
- [ ] **Greg**: `npm run deploy`, which is what applies these two migrations to production.
