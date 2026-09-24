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
cost. **One of them was written as a deploy blocker and the deploy went out anyway** — that one is
answered and off the table now, but the note immediately below says what happened, and its last
paragraph is the part still worth acting on.

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

<!-- Nothing resting with Greg: the last six rows were answered on 2026-09-24, below. -->

**Six rows came off this table on 2026-09-17**, because Greg had already answered them on 2026-09-11
and they were still sitting here as though he had not: the dictation privacy wording, the Socratic
wording, 2D, 2B, 2G and 2A. Each answer is in *Answered 2026-09-11* below, which is where they now
live — and it is why the live table above is short. Left by the feedback sweep, whose own rule this
is (*"when Greg answers … the line comes off"*).

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

## Answered 2026-09-24, on Greg's delegated judgment

Greg, 2026-09-24: *"work through the various feedback suggestions"*, under his standing *"otherwise
use your judgment. try to keep things simple."* Each decision is the simplest ending that does right
by the reader, and each is reversible by him. Fable arbitrated the four where two options both looked
fine; the notes carry what would change each one.

| report | the decision |
|---|---|
| [30](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-30) — maths in PDFs | **Build it** (`qi-njx3xh37`): Greg asked for the maths, and this is the half that reaches most PDFs. [260924b](../plans/260924b-pdf-transcriber-writes-maths-as-tex.md) — on `dev` at `42cb3bf5`. Greg, 2026-09-24: *"ideally we would have some general way of representing LaTeX that might also be useful for HTML imports too"* — delimited TeX in block text is that representation, and HTML imports are its next stage in the same plan |
| [3J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3J) — Tweets writes on open | **Keep writing on open**: it is what Greg asked for, and the unasked cases are one run per article per page load on the reader's own article. **No spend cap for now** — Greg, 2026-09-24, on that recommendation: *"yes, approved"*. |
| [42](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-42) — street noise in the live conversation | **Wait for data**: each of the three changes alters every live conversation, and the first Sentry `LiveStall-*` events will say whether noise is the stall that happens. Nothing built. |
| [3D](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3D) + [3F](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3F) — enforcing provenance | **Leave it**: enforcing would end streaming and add a model call per turn for a case the evals show rarely, and the logging step would write to logs nobody reads. Nothing built. |
| [3C](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3C) — an outdated quote list | **Offer *Choose them again* on an outdated list**: it is the one state where Find more provably cannot help, and Greg's 2026-09-11 removal was about current lists. [260924d](../plans/260924d-choose-them-again-on-an-outdated-quote-list.md) — on `dev` at `8029714d` |
| 3Y follow-up — chat links on an iPad | **Leave them opening on the first tap**: they are tapped on purpose, print their real host, and their card has no fetched preview. [note](260912_1209-ipad-link-tap-opens-the-page-instead-of-the-card.md) |
| [3E](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3E) — the send icon on an iPad | **Treated as fixed.** Greg, 2026-09-24, asked for a Playwright screenshot in place of his device check: in real WebKit (Playwright's, installed on the box) at 834×1194 and 1194×834, iPad user agent, touch, the icon is drawn empty and typed, 18px, full opacity. He reopens it if his iPad disagrees. [note](260912_0828-send-button-icon-and-primary-style.md) |
| 3P follow-up — the logo tap in the reading view | **Leave it**: tap goes home and a hold plays an animation; a play-first tap would cost everyone two taps home. [note](260912_1032-logo-animations-not-showing.md) |
| 3T follow-up — the score card's fuller passage | **Leave it**: Greg asked where the card opens from, which shipped, and the passage is a desktop reader's only preview. [note](260912_1048-search-card-opens-from-the-score.md) |



## Answered 2026-09-11, by the Overseer under Greg's instruction

Greg, 2026-09-11, on the whole list: *"otherwise use your judgment. try to keep things simple."* So
the six rows above are closed as follows, each the simplest ending, and each reversible by him:

| report | the decision |
|---|---|
| dictation privacy wording | **Reviewed, stands.** The live sentence is the corrected one; no change. |
| the Socratic wording | **No spend.** The wording stays as Greg picked it; the replicates are not bought. Spending is the one gate the Overseer does not hold, and the finding is a lean, not a verdict. |
| 2D — the entry-point doc edit | **Approved as it is on `dev`.** |
| 2B — picture size | **Folded into cluster F** of the product plan: trial a ~1,280px candidate under the existing caps (Greg's default answer, 2026-09-11). |
| 2G — permalink hover | **Fix it**, with the preview-page cleanup the Overseer dispatched the same night. **Shipped to `dev` 2026-09-11** — the [note](260907_1742-gutter-icons-on-touch.md) has the measurement. |
| 2A — the file name in the public URL | **Leave it.** The uploader chose the name and chose to publish; changing the slug shape would break every existing link for a leak the uploader controls. Revisit if a reader reports it. |

The six-things section that stood here is history: three from 2026-09-07 and three from 2026-09-08,
the latter added by three sessions that did not know about each other, which is the collision this
file exists to make visible.

Everything this file listed on 2026-09-06 has been answered. The `toc/6` question that stood here —
whether to re-run the structure stage across the library so existing articles picked up the new gist
lengths — was answered *"leave it, new articles only"*, and is now recorded where it belongs, in
[hierarchy.md § A new prompt reaches new articles only](../project/hierarchy.md#prompt-versions),
together with the re-run control that came out of the same answer.
