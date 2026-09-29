# One place to re-run AI processing

Two reports from Greg, 2026-09-29, prod build 43f99ecb.

> In Metadata:
> - We have both a "Generate it again" and "Start this article again". Let's somehow amalgamate them.
>   Think about how to make this a clean, understandable UI. Perhaps this section should be
>   default-collapsed. Maybe name it something clearer like "Re-run AI processing" or "Reset this
>   article" as you see fit. And maybe position it above "Archive this article".
>
> — Greg, 2026-09-29 (SPIDERYARN-READING2-4Z)

> In Trajectory mode, remove the "Plan it again" button. The user can do that from Metadata if they
> really want. Same goes for any other modes that still have a "redo this processing" button - let's
> just rely on the Metadata mode for that.
>
> — Greg, 2026-09-29 (SPIDERYARN-READING2-53)

UI only. No server route, step or prompt changes.

## Every redo button in the modes today, and what happens to it

There are two kinds, and they are different acts:

- **The standing button** — always there under a current result, "do it again because I feel like
  it". This is what Greg means by *"redo this processing"*. **All of these go.**
- **The button inside a stale/outdated banner** — shown only when we know the result was made from an
  older version of the article or the prompt. It is a repair the page is prompting, and it is the only
  place the reader learns the result is out of date. **These stay.** Quotes is already in this shape:
  Greg removed its standing "Choose them again" on 2026-09-10 and the banner buttons stayed.

| Mode | Standing button (removed) | Banner button (kept) | Metadata row it now relies on |
|---|---|---|---|
| Trajectory | `TrajectoryPanel.tsx` foot, "Plan it again" | outdated banner, "Plan it again" | **Trajectory — new row** |
| Ideas | `IdeasPanel.tsx` foot, "Find them again" | stale / outdated | Ideas |
| Timeline | `TimelinePanel.tsx` foot, "Read it again" | stale / outdated | Timeline |
| Debate | `DebatePanel.tsx` foot, "Search again" | stale / outdated | Debate |
| Quiz | `QuizPanel.tsx` foot, "Write them again" | older-version notice | Quiz |
| Thread | `Tweets.tsx` `Rewrite`, "Write it again" (idle state only; its running/failed display stays) | stale banner | Thread |

Not touched, and why:

- **Quotes, Citations, FAQ** — no standing button left; only banner ones. (Citations and FAQ have no
  Metadata row; nothing is removed from them, so nothing becomes impossible. Adding them is a separate
  question, below.)
- **Empty-state buttons** ("Plan the route", "Find the ideas", …) — first runs, not redos.
- **Claims** ("Pull them again", referee) — an on-demand call, not a pipeline step; Metadata has no
  way to run it, so removing it would make it impossible.
- **Criteria** ("Run this criterion again"), **Mirror** ("Read them again") — each runs over something
  the reader wrote, not over the article. Not "this processing".
- **Diagram** "Try … again", **Illustrated** — retries after a failure / a first paint.

**The rule that nothing becomes impossible to redo:** five of the six have a Metadata row already.
Trajectory does not, so it gains one in `METADATA_RERUN_STEPS` (src/rerun-steps.ts), placed by
`STEP_ORDER` between Sketch and Debate. The list's three questions for it:

1. *How many metered calls does one press buy?* One. The row forces `trajectory` only; Quotes and
   Ideas are not named, so they do not run (`useStepJob.start` sends `steps: [step]`).
2. *Does it refuse without a prerequisite?* Yes — without Quotes (src/pipeline.ts § trajectory), and
   the refusal comes back as a sentence in the row, as for Sketch-less Illustrated would. With Quotes
   present (always, if there is a route to redo) it runs; stale Quotes are not refused.
3. *Is a successful run safe to publish over a good one?* Yes — draft-then-publish, and a route that
   planned is a route.

## Metadata: one section, "Re-run AI processing"

Today there are two sections: *Generate it again* (the per-mode rows, above Export) and *Start this
article again* (experimental, above Archive). They become one section:

```
  RE-RUN AI PROCESSING ›                 (collapsed by default; the heading opens it)
  ┌────────────────────────────────────────────┐
  │ Ask for any of these to be written again…  │
  │ Arc             ran      [Run it again]    │
  │ …                                          │
  │ Trajectory      ran      [Run it again]    │
  │ Debate          not run  [Run it]          │
  └────────────────────────────────────────────┘
  Start the whole article again                 (experimental switch only, as today)
  ┌────────────────────────────────────────────┐
  │ <ResetArticle, unchanged>                   │
  └────────────────────────────────────────────┘
  ARCHIVE THIS ARTICLE
```

- **Name: "Re-run AI processing".** Greg's first suggestion; it covers both halves, where "Reset this
  article" describes only the second and sounds destructive for the per-mode rows.
- **Position: directly above "Archive this article"**, where Reset already sits — both are acts on the
  article, past everything somebody came to read. So it moves down past Export and Technical details.
- **Collapsed by default**, using `Section`'s existing `collapsible`. Costs: while shut the rows are
  unmounted, so a job finishing while shut does not call `refresh` (the next open re-subscribes and
  shows the current state); and the page contents list still lists the section.
- **Reset stays behind the experimental switch**, unchanged in behaviour; it becomes a sub-block
  inside the section instead of its own section.

## Simpler option passed over

Leaving the two sections separate and only renaming/collapsing them. Rejected: Greg asked for them to
be amalgamated, and two neighbouring "do it again" sections is the confusion reported.

## Deferred

- Metadata rows for **Citations** and **FAQ** (they only have banner redos, so nothing is lost now).

## Checks

- `tests/metadata-rerun-steps.test.ts` pins the list → add `trajectory`.
- `tests/metadata-page-order.test.tsx`, `metadata-rerun-section.test.tsx`,
  `metadata-reset-section.test.tsx` → update for the one collapsed section (open it first).
- Panel tests that assert a standing button → assert it is gone, and the banner one remains.
- Browser check: Metadata shut/open with screenshots; Trajectory, Ideas, Timeline with no standing
  button.

## Plan review (GPT Sol, 2026-09-29) and what changed

1. **P1, fixed.** Shutting the section unmounted the rows, and with them each row's `useStepJob`
   subscription: a run that finished while shut never called `onFinished`, and reopening does not
   replay it (`useJobs` starts a new subscriber at the latest completion). `Section` gained
   `keepMounted`, which hides the rows rather than unmounting them; the page-order test asserts the
   rows are in the document, inside `[hidden]`, while shut.
2. **P2, narrowed.** "Every mode can be regenerated" was too broad: a *current* FAQ or Citations
   result has no redo anywhere, and had none before this change either. The claim that holds is the
   one this plan needs — none of the six removed buttons leaves its mode without a way back.
3. **P2, kept, and flagged to Greg.** The banner buttons are this plan's own distinction, not
   Greg's words. Kept because the banner is the only place a reader learns the result is out of
   date, and removing the action would leave a warning that points somewhere else; the feedback
   notes ask him.
4. **P3, recorded.** Glossary's and Quotes' **Find more** also force their step, but they add to the
   list rather than redo it. Not a redo, so they stay.
5. **P3.** The Trajectory row buys *at most* one call: none when it refuses for want of Quotes.
