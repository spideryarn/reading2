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

Each is a few minutes of attention, and each has a note that already sets out the options and their
cost. **One of them now blocks a deploy** — that used to be true of none of them, and the first row
says which.

> **⚠ Do not deploy until the dictation privacy wording is signed off.** 2026-09-07: dictation moved
> onto an OpenAI transcriber, which cannot be routed with zero data retention, so the sentence
> `/privacy` and every microphone have carried until now — *"your voice … isn't stored"* — is false
> on `dev` as of this landing. The replacement wording is written and is quoted on its own, out of
> the diff, in
> [260907c § The proposed reader-facing wording](../plans/260907c-dictation-onto-an-openai-transcriber.md#the-proposed-reader-facing-wording).
> Deploying before you have read it publishes a false promise about people's voices.

| report | the decision resting with you |
|---|---|
| dictation privacy wording (2026-09-07, **blocks the next deploy**) | **A published zero-data-retention promise about a reader's voice has to go.** Greg chose the switch to an OpenAI transcriber on 2026-09-06 knowing it cost this; what needs your eye is not the decision but the four sentences that replace it, one of which is the fourteen words beside every microphone. Measured reason it cannot be kept: OpenRouter ignores the `provider` block entirely on its transcription endpoint, so `zdr: true` there is a flag nobody reads — `only: ["anthropic"]` returns a transcript. [plan](../plans/260907c-dictation-onto-an-openai-transcriber.md#the-proposed-reader-facing-wording) |
| [2A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2A) — upload an HTML file (shipped 2026-09-07) | **An uploaded file's name is in its public URL.** `slugFromFilename` mints the article slug from the filename's stem and the slug is in `PublicMeta`, so publishing `confidential-client-acme.html` publishes `confidential-client-acme`. This predates the report by weeks — it has been true of uploaded PDFs since August — and was found only because this work was about to assert the opposite in a comment. Minting an opaque slug for uploads instead would change existing addresses and is a decision about what a URL should look like, so no agent took it. [note](260906_1709-upload-an-html-file-and-a-url-for-a-pdf.md) · [plan](../plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md#a-privacy-question-this-work-did-not-create-and-did-not-fix) |

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

## Two things are waiting on Greg

The dictation privacy wording, which blocks the next deploy, and the 2A slug question above, both
added 2026-09-07. Everything this file listed on 2026-09-06 has been
answered. The `toc/6` question that stood here —
whether to re-run the structure stage across the library so existing articles picked up the new gist
lengths — was answered *"leave it, new articles only"*, and is now recorded where it belongs, in
[hierarchy.md § A new prompt reaches new articles only](../project/hierarchy.md#prompt-versions),
together with the re-run control that came out of the same answer.
