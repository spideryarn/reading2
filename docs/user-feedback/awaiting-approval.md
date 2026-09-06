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

| arrived | report | the decision | written up in |
|---|---|---|---|
| 2026-09-05 | [1Z](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1Z) | **A yellow highlighter for quote marks?** A quote mark *is* a search hit by design, and the hue channel already means "which search found it". Yellow costs either borrowing that channel or adding a second way to draw a marked passage. | [note](260905_1754-quotes-marked-in-the-prose.md) |
| 2026-09-05 | [21](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-21) | **The quiz slider — and the first of its three questions is fatal rather than awkward.** The centrality × easiness blend was proposed and killed on review: hard-central and easy-peripheral both sum to 6, so the tie-break opens with the hardest question, which is the complaint the report starts with. | [note](260905_1800-quiz-questions-too-hard.md) |
| 2026-09-05 | [23](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-23) | **Was anything actually wrong?** The spinner shipped 2026-09-01 and is in production. If one that flashes for 80ms reads as no spinner, the fix is a ~300ms minimum — deliberate added latency on a path that currently has none. | [note](260905_1802-spinner-on-the-send-button.md) |
| 2026-09-05 | [24](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-24) | **Which Socratic question wording, if any.** The eval's calibration gate failed, so it reports **no ranking** and nothing shipped. V4 reproduced Greg's own example almost word for word — and the variants that hit his shape are the longest lines on the page, against a brief that also asked for simpler language. | [plan § the lines themselves](../plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md) |

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
