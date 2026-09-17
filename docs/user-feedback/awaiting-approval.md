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

| report | the decision resting with you |
|---|---|
| [30](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-30) — equations shown as raw LaTeX (half shipped 2026-09-12) | **The other half of your own report needs your yes, and it is the half that reaches most PDFs.** Delimited TeX now draws as maths in the reading view — but the PDF transcriber is told *"no LaTeX, plain text only"*, so most maths-bearing PDFs never produce a delimiter to render: reproduced on your entropy paper, equation (1) came out over eight lines and `≠` as `6=`. Asking the transcriber for `\(…\)` is **not a prompt edit**: GPT Sol found that under the current scorer TeX fails every maths chunk's content check, so the chunk is paid for twice and never checkpointed (P0). The scorer and the dedup pass have to become TeX-aware first. Written up with its requirements and a measured baseline; the plan says it goes out only on your word, so no agent has taken it. Queued as `qi-njx3xh37` (priority 0.6, needs Greg). [note](260912_0804-equations-render-as-raw-latex.md) · [plan](../plans/260912d-render-latex-equations-in-the-reading-view.md), § *Stage 2, deferred* |
| [3J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3J) — the Tweets page starts writing when opened (shipped 2026-09-16) | **Two things, both small.** (1) Opening the thread page now writes the thread however you got there, which includes two cases where nobody chose Tweets just then: Back or Forward onto it after a full reload, and signing in while already on its address. At most one run per article per page load, on your own article. Keep it, or go back to "only when pressed" (a one-line revert). (2) Re-running a step like Tweets has **no per-owner spend cap** on the server and never had — slots cover new articles only. Nothing was bypassed, but a paid re-run can now happen without a press. A cap would be a billing defence, so it is yours to ask for or not. [note](260912_1021-tweets-page-starts-writing-when-opened.md) · [plan](../plans/260915e-tweets-page-starts-writing-when-opened.md#every-way-the-page-now-spends-without-a-press-gpt-sols-audit-p1-1) |
| [42](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-42) — the live conversation kept hanging, outdoors on a phone (shipped 2026-09-15) | **Should street noise be made harmless, not just visible?** A stall now shows a sentence and a **Reconnect** button, and Sentry will say which stall it was. But nothing stops background sound from opening a turn or cutting the companion off mid-sentence: OpenAI's `interrupt_response` is on, and it stops the answer every time the voice detector thinks you started speaking. Three changes would fix that, and each alters how every live conversation behaves. (a) A "noisy place" setting that needs louder sound to count as speech. (b) Turn `interrupt_response` off, so you can no longer talk over the companion either. (c) Push-to-talk: hold a button while you speak. Worth waiting for the first Sentry `LiveStall-*` events before choosing. [note](260912_1639-live-conversation-hangs-on-a-phone.md) · [plan](../plans/260915b-live-conversation-stalls-visible-and-recoverable.md#not-built-and-why) |
| [3D](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3D) + [3F](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3F) — questions about a passage reach for the web, and chat can read the citations list (shipped 2026-09-13) | **Should "what is and is not from the article" be enforced, not just very likely?** Chat now marks every claim's origin, with a reminder beside each question: the "?" answers marked what was not from the article 6 of 6 times, up from 0; "what has happened since?" answers carried their links in the text 6 of 6, up from 1. But a prompt cannot guarantee it — the last eval still had unlinked quotes in one answer. The only way to *enforce* it is to check each sentence against what the turn actually found before showing it, which means **answers no longer stream in word by word** (they would arrive all at once, or sentence by sentence) and costs a second model call per turn. GPT Sol raised it; Fable judged it yours. A cheaper first step that changes nothing you see: log how many paragraphs per answer carry no block id, no link and no marker, so production says how often it happens. [note](260912_0827-comment-questions-reach-for-the-web-and-the-citations-list.md) · [plan](../plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md#progress) |
| [3C](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3C) — quotes long enough to stand on their own (shipped 2026-09-12) | **Should an outdated quote list be offered a rewrite?** `quotes/6` chooses longer, self-sufficient quotes — but only for new lists. The entropy paper you reported from keeps its short `quotes/5` list, and **Find more cannot repair it**: the quotes already on a list win every overlap, so a longer version of an old short quote is dropped. The simplest fix is a *Choose them again* on an outdated list as well as a stale one — which partly brings back the button you asked to remove on 2026-09-11. Nothing built; GPT Sol raised it. [note](260912_0823-quotes-long-enough-to-stand-on-their-own.md) · [plan](../plans/260912e-quotes-long-enough-to-stand-on-their-own.md#gpt-sols-plan-review-and-what-was-done-with-it) |
| [3E](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3E) — the send button's icon (shipped 2026-09-12) | **After the next deploy, is the send icon there on your iPad?** Send is restyled as you asked (bigger, filled orange when it can be pressed, outlined when not), but *why* the icon went missing was not found: Chromium set up as an iPad and real WebKit both draw it, and what is left happens only on iOS. The restyle removes the two leading suspects, so it may simply be fixed. If it is still missing, five checks in Safari's Web Inspector (Mac, Develop ▸ your iPad) would settle it, starting with whether typing one character makes it appear. [note](260912_0828-send-button-icon-and-primary-style.md) · [plan](../plans/260912c-send-button-icon-and-primary-style.md#what-gpt-sol-added-to-the-diagnosis) |
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
