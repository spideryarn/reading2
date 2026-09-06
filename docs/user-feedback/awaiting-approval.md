# Awaiting Greg

Reports that were researched and written up but **not built**, because the call is Greg's — the
fourth ending in
[feedback-reports.md § Three ways a report ends](../project/feedback-reports.md#three-ways-a-report-ends).

Their Sentry issues are `ignored`, so they are out of the unresolved queue and **this file is the
only place they are visible**. The loop reads it first, every run, and says what is on it.

One line each: the date the report arrived, its Sentry short id, one sentence of what is being
proposed, and a link to the plan doc. When Greg answers, the work either happens or doesn't, the note
in this directory records which, and the line comes off.

<!-- Nothing awaiting approval. -->

## Decisions resting with Greg from reports that DID ship

A second list, and a different thing from the one above: these reports are **finished and
`resolved`** — the work is on `dev`. What is left in each case is one product decision that was
deliberately not taken by an agent, written into the report's note and therefore invisible unless
somebody goes and reads it. That is the same failure this file exists to prevent, so they are listed
here too.

None of them blocks anything. Each is a few minutes of attention, and each has a note that already
sets out the options and their cost.

<!-- All four were answered on 2026-09-06; see below. -->

**Answered 2026-09-06, in one sitting, and this is what happened to each** — kept here briefly
rather than deleted, because "the file shrank" is only good news if you can see what it shrank into:

| report | the decision | what followed |
|---|---|---|
| [1Z](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1Z) — a yellow highlighter for quotes | **Neither option.** Greg proposed a *third* channel: a **border rather than a fill**, with stroke thickness and weight carrying the quote's priority — so search hits fill and quotes outline, and neither has to borrow from the other. Fluorescent yellow with pastel search marks is the named fallback | session `fb1z-quotes-outlined-by-priority`; [note](260905_1754-quotes-marked-in-the-prose.md) |
| [21](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-21) — the quiz difficulty slider | **Declined, and replaced with something better.** The quiz goes **adaptive** — right answer, harder next; wrong answer, easier — which serves the goal the slider was for without a knob and without showing the reader a `band` or a `value` | session `fb21-adaptive-quiz`; [note](260905_1800-quiz-questions-too-hard.md) |
| [23](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-23) — the send-button spinner | **No change.** The spinner shipped 2026-09-01, is in production, and a test pins it. A ~300ms minimum visible duration would mean deliberately adding latency to a path that has none, and there is no evidence yet that it is needed | [note](260905_1802-spinner-on-the-send-button.md) |
| [24](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-24) — which Socratic wording | **Ship V4 now, then repair the eval, then tweak only if it teaches us something.** V4 reproduced Greg's own example almost verbatim; the eval's calibration gate failing is a separate defect and is not allowed to block the wording | session `fb1v-socratic-v4-and-the-eval`; [plan](../plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md) |

**The thing worth noticing about that sitting:** three of the four answers were **not** one of the
options put to Greg. Two of them dissolved a trade-off an agent had accepted as fixed — the quote
mark by using a channel nobody had thought to use, and the quiz by removing the control rather than
tuning it. That is the argument for this file existing rather than for agents deciding faster.

## One item that is nobody's report, and is still Greg's call

**Do we re-run the structure stage across the library to pick up `toc/6`?**

The gist length changes (2026-09-06 — coarse lines shorter, fine lines longer, plainer words) reach
**new articles only**. Verified rather than assumed: [`src/pipeline.ts`](../../src/pipeline.ts)
imports only `generateHierarchy` from [`src/hierarchy.ts`](../../src/hierarchy.ts) and no version
constant; the tree has no `outdated` mechanism of the kind glossary, quotes and ideas each have; and
the tree-version chip came off the reading view on 2026-09-05. So an existing article keeps its
`toc/5` gists silently and indefinitely, and the only route is *re-run a stage* on the metadata page.

That is the right default — nothing is broken, nothing is charged, and nobody is shown a warning
about a summary that reads perfectly well. But it does mean **the change Greg asked for is not
visible on anything he has already read** until somebody decides to spend the calls.
