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
cost. **One of them was written as a deploy blocker and the deploy went out anyway** — the first row
says what happened.

> **⚠ The dictation privacy wording shipped before it was signed off, and it is live now.**
> 2026-09-07: dictation moved onto an OpenAI transcriber, which cannot be routed with zero data
> retention, so the sentence `/privacy` and every microphone had carried — *"your voice … isn't
> stored"* — stopped being true. New wording was written in the same commit (`b088b24a`, 14:03) and
> this line was added asking that nobody deploy until Greg had read it. **A deploy went out at
> 17:37 regardless**: production serves `c0fb04a4` (`/api/health`), which contains both the new
> transcriber and the new sentence. Checked by the feedback-reports loop, 2026-09-07 17:20.
>
> **The good half:** what shipped is the *corrected* wording, not the false one — *"Your voice goes
> to OpenRouter and OpenAI to be transcribed. We don't save it on our servers; they may keep it
> under their own policies."* No false promise is live. Greg's read is now a review of live copy
> rather than a gate before it, and the four sentences are still quoted on their own, out of the
> diff, in
> [260907c § The proposed reader-facing wording](../plans/260907c-dictation-onto-an-openai-transcriber.md#the-proposed-reader-facing-wording).
>
> **The half worth fixing:** a "do not deploy" sentence in this file is not a gate. Nothing reads it
> — not `npm run deploy`, not the deploy loop — so it stopped a deploy for exactly as long as a
> human happened to be looking. If reader-facing copy is ever to be gated on a person, the gate has
> to live somewhere the deploy path executes.

| report | the decision resting with you |
|---|---|
| dictation privacy wording (2026-09-07, **already live — shipped unsigned-off**) | **A published zero-data-retention promise about a reader's voice has to go.** Greg chose the switch to an OpenAI transcriber on 2026-09-06 knowing it cost this; what needs your eye is not the decision but the four sentences that replace it, one of which is the line beside every microphone. Measured reason it cannot be kept: OpenRouter does not apply routing on its transcription endpoint, so `zdr: true` there is a flag nobody reads — `only: ["anthropic"]`, which no transcriber can satisfy, returns a transcript anyway. [plan](../plans/260907c-dictation-onto-an-openai-transcriber.md#the-proposed-reader-facing-wording) |
| the Socratic wording, after the eval was repaired (2026-09-07) | **The eval you asked for now runs, and its first answer leans against the wording you picked.** It named no leader — the two completed repeats had different ones — but the run carried one generation of the **pre-V4** wording against three of V4, and the pre-V4 control ranked ahead of all three, head-to-head in 9, 8 and 11 of 12 lineups. One control generation on one document is directional and **not enough to revert a wording you chose that morning**, so nothing was changed. What is worth your minute is whether to spend on settling it: balanced replicates over several documents, about $0.05 a generation call. [note](260905_1803-only-the-socratic-question.md) · [plan](../plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md) |
| [2B](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2B) — the monkeys illustration (shipped 2026-09-08) | **We store the smallest picture the publisher offers, and the ⤢ has nothing to enlarge.** `imageSourceOf` takes `img[src]` and nothing else, which on `asteriskmag.com` is the **300 px** thumbnail while the `srcset` we drop runs to 1920 — measured: a 300 px image in a 659 px sheet, rendered at 311 px. Fetching a larger candidate means choosing between candidates rather than reading one attribute, and costs bytes: the publisher's 1920 PNG is **1.6 MB against the 126 KB** we store now, because `sniffImage` knows only PNG/JPEG/GIF and so refuses their 164 KB AVIF. Teaching it AVIF/WebP is a second, separable decision. Nothing was changed, because "how big a picture is worth how many bytes" is a product call. [note](260907_0735-the-monkeys-illustration-does-not-load.md) · [plan](../plans/260908a-the-monkeys-illustration-did-not-load.md#the-picture-we-serve-is-the-smallest-one-the-publisher-offers) |
| [2G](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2G) — gutter icons on touch (shipped 2026-09-08) | **The permalink never brightens when you point at it, and fixing that is a visible desktop change.** `tr:hover .blk-permalink { opacity: 0.6 }` is (0,2,1) against `.blk-permalink:hover { opacity: 1 }` at (0,2,0), so the recessive value wins whenever you hover the control itself — you get the orange and not the lift, against a comment two lines up promising *"full when it is the thing you are pointing at"*. Pre-existing, and the same class as a bug this stylesheet already fixed once at `.blk-permalink.failed`. Left alone because it changes what a pointer sees inside a report about touch, and the clean repair (`:where(tr:hover)` on the recessive rule, which would also retire the `.failed` workaround) needs the permalink taken out of a heavily-argued selector list. Two minutes, but it is your eye it wants. [note](260907_1742-gutter-icons-on-touch.md) · [plan](../plans/260908e-gutter-icons-on-touch-only-when-a-block-is-selected.md) |
| [2A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2A) — upload an HTML file (shipped 2026-09-07) | **An uploaded file's name is in its public URL.** `slugFromFilename` mints the article slug from the filename's stem and the slug is in `PublicMeta`, so publishing `confidential-client-acme.html` publishes `confidential-client-acme`. This predates the report by weeks — it has been true of uploaded PDFs since August — and was found only because this work was about to assert the opposite in a comment. Minting an opaque slug for uploads instead would change existing addresses and is a decision about what a URL should look like, so no agent took it. [note](260906_1709-upload-an-html-file-and-a-url-for-a-pdf.md) · [plan](../plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md#a-privacy-question-this-work-did-not-create-and-did-not-fix) |

**Answered 2026-09-06, in one sitting, and this is what happened to each** — kept here briefly
rather than deleted, because "the file shrank" is only good news if you can see what it shrank into:

| report | the decision | what followed |
|---|---|---|
| [1Z](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1Z) — a yellow highlighter for quotes | **Neither option.** Greg proposed a *third* channel: a **border rather than a fill**, with stroke thickness and weight carrying the quote's priority — so search hits fill and quotes outline, and neither has to borrow from the other. Fluorescent yellow with pastel search marks is the named fallback | session `fb1z-quotes-outlined-by-priority`; [note](260905_1754-quotes-marked-in-the-prose.md) |
| [23](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-23) — the send-button spinner | **No change.** The spinner shipped 2026-09-01, is in production, and a test pins it. A ~300ms minimum visible duration would mean deliberately adding latency to a path that has none, and there is no evidence yet that it is needed | [note](260905_1802-spinner-on-the-send-button.md) |

**Report 24 came off this list on 2026-09-07**, which is what these rows are for. V4 shipped as
`toc/7`, the cascade got the same block as `expand/4`, and the eval's calibration gate was repaired
and passed for the first time. Nothing was tweaked, which was the third of Greg's three instructions
— **but the repaired eval produced one finding that is now a decision, and it is in the table
above.** [note](260905_1803-only-the-socratic-question.md) ·
[plan](../plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md).

**The quiz row (21) came off on 2026-09-07**, which is what these rows are for: the adaptive quiz is
built and on `dev` — [260907d](../plans/260907d-make-the-quiz-adaptive.md), and the note records the
decision and its reasoning
([260905_1800](260905_1800-quiz-questions-too-hard.md#what-greg-decided)).

**The thing worth noticing about that sitting:** three of the four answers were **not** one of the
options put to Greg. Two of them dissolved a trade-off an agent had accepted as fixed — the quote
mark by using a channel nobody had thought to use, and the quiz by removing the control rather than
tuning it. That is the argument for this file existing rather than for agents deciding faster.

## Four things are waiting on Greg

The dictation privacy wording, which is already live rather than pending; the 2A slug question;
whether to spend on settling what the repaired Socratic eval leaned towards — all three added
2026-09-07 — and, added 2026-09-08, whether to fix the permalink's hover brightness, which is the
cheapest thing on this page and the only one that is purely a matter of taste. Everything this file
listed on 2026-09-06 has been answered. The `toc/6` question that stood here —
whether to re-run the structure stage across the library so existing articles picked up the new gist
lengths — was answered *"leave it, new articles only"*, and is now recorded where it belongs, in
[hierarchy.md § A new prompt reaches new articles only](../project/hierarchy.md#prompt-versions),
together with the re-run control that came out of the same answer.
