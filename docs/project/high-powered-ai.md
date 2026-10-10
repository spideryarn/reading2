# High-powered AI

Up: [reading-view-overview.md](reading-view-overview.md). Tests:
[`high-power-models.test.ts`](../../tests/high-power-models.test.ts),
[`high-power-routes.test.ts`](../../tests/high-power-routes.test.ts),
[`high-power-step.test.ts`](../../tests/high-power-step.test.ts),
[`billing-high-power.test.ts`](../../tests/billing-high-power.test.ts),
[`add-high-power.test.ts`](../../tests/add-high-power.test.ts),
[`metadata-high-power-switch.test.tsx`](../../tests/metadata-high-power-switch.test.tsx). The build,
and every decision behind it, is [260930f](../plans/260930f-high-powered-ai-per-article.md) (the switch, for the administrator)
and [260930k](../plans/260930k-high-power-for-readers-and-cost-only-for-admins.md) (readers, and what
it costs them), and [261002k](../plans/261002k-high-powered-ai-at-import.md) (choosing it while
the article is added).

**One switch per article — on `/metadata`, or a tick box while the article is added — that moves most of that article's capable-tier calls from
Claude Sonnet to Claude Opus.** For a difficult piece — a dense paper, an argument that takes several
readings — the stronger model writes the structure, gists, quotes, FAQ answers and chat replies.
Simple's plain-words summaries are the exception: they use Opus for every article. So is
*Dig deeper*, whose answers are Opus's on every article.
Opus 5.5's input and output token prices are twice Sonnet 5.5's (the same as Sonnet 5's); the dated prices and measurement live
in [the plan](../plans/260930f-high-powered-ai-per-article.md#what-this-is-in-one-paragraph). Greg,
2026-09-30:

> In some cases, for difficult articles, we might want to really be using the best AI thinking
> available. So, for example, we might switch Sonnet -> Opus or whatever, especially for the modes
> that will benefit from greater intelligence, like chat or summary or trajectory or, well, probably
> most of them.

## What it costs a reader

> it should double the processing cost per-article - that's how I'd think about it.
>
> — Greg, 2026-09-30

**Switching it on counts as one more article against the reader's allowance, and half of one while
the article is public.** Added to the ingest, that makes a private article cost two articles and a
public one cost one. It is **charged once per article, in the period it is switched on, and never
refunded**:

- switching off gives nothing back;
- switching on again charges nothing.

**It must fit whole.** If the allowance doesn't have room, the switch is refused with
`[pay-high-power]` and nothing changes.

The administrator is exempt, as with ingests. The mechanism is billing's:
[billing.md § High-powered AI counts double](billing.md#high-powered-ai-counts-double).

**The copy states the price in articles, never in money.** That applies to the switch, `/pricing`
and `/features`
([cost-tracking.md § Only the administrator ever sees a figure](cost-tracking.md#only-the-administrator-ever-sees-a-figure)).

## Switching it on while the article is added

Since 2026-10-02 the add page (`/add/…`) has a **High-powered AI** tick box beside *Generate the main
modes*, off by default and never remembered — a remembered tick would double the price of every later
import unseen. It sends **the same `PUT`** as the Metadata switch, so the price and every refusal
above are unchanged; only the moment is earlier. The build is
[261002k](../plans/261002k-high-powered-ai-at-import.md); the page's half is
[`src/web/add-high-power.ts`](../../src/web/add-high-power.ts).

- **It is sent as soon as the page knows the job's slug**, and a `404` while the job is still alive
  is retried — a job reports `running` before its claim creates the article row.
- **Ticked before the capable-tier work starts, the whole import runs on Opus**: before `structure`
  for a web page, before `extract` for a PDF, whose front matter is read on the capable tier. Later
  than that, the line under the box says some of it *may* have used Sonnet; exactly which steps
  cannot be told from the page, because the runner reads the setting before it marks a step running.
- **The main modes run on Opus when the switch was committed before the first of them starts.**
  Each step reads the article's power as it starts (`readStepPower`), and no main-mode job starts
  until the `labels` job ahead of it has ended. The page sends the switch as soon as the article row
  exists, which is long before publication. **What is no longer promised**: until 2026-10-04 the
  page held the modes until the switch request *answered*, however long that took. The server queues
  them at publication now ([261004h](../plans/261004h-post-import-modes-decided-on-the-server-for-every-import-path.md)),
  so a mode step that starts before the switch commits uses the standard model; later steps read
  the setting again. A late tick, or labels ending quickly after failure or cancellation, can leave
  very little time for the switch to commit. A tick in the last second is still sent at completion,
  and the navigation to the article does not wait for it. (An administrator's armed *For the
  author…* does make the exit wait, for its own request, not for this switch:
  [ingest-queue.md § The add page](ingest-queue.md#the-add-page).)
- **It is a page's intent**: a tab closed before the job is claimed
  sends nothing, and the article imports on Sonnet. (*Generate the main modes* was one too until
  2026-10-04; it is the reader's setting now.) An import that fails after the switch keeps the
  charge on its article row, under the never-refunded rule; its *Retry* does not charge again.
- **It is one reader's intent.** The retry is not sent with another reader's token, so a change of
  account on an open add page cannot charge whoever signed in
  ([ingest-queue.md § The add page](ingest-queue.md#the-three-traps-in-a-page-whose-whole-job-is-one-effect)).
  If the first reader comes back within the retry second, their own tick can still reach their own
  article.

Deferred, and a billing change if built: the charge riding the job itself (admitted at
`POST /api/jobs`, switched server-side at the first capable-tier step), which would survive a closed
tab and charge only an import that got past `fetch`.

Simple is not part of the default ingest and already uses Opus whenever it is requested.

## What it changes, and what it does not

- **Every task on the capable tier except Simple moves**, for that article only: the pipeline stages
  (structure, headings, gist, glossary, quotes, ideas, timeline, quiz, FAQ, sketch, illustrated,
  skim, debate, bibliography) and the calls made while you read it (chat; explain — a comment's
  first answer and *Try again*, and the glossary's *Look up* box; search; quiz marking; referee;
  Bibliography's stand-alone *Look it up*; live conversation's search tool). A *Dig deeper* press does
  not move with it — the next point.
  A developer's explicit per-task environment override still wins, so a deliberate model comparison
  stays pinned. [`TASK_TIER` and `resolveModel` in `src/models.ts`](../../src/models.ts) are the
  exhaustive list and that exception.
- **Simple (Summary's plain-words levels) is already on Opus for every article**, so the switch
  does not change it. Sonnet borrowed a paper's name for one thing to name another where Opus did
  not, at about $0.05 a press more: `ALWAYS_HIGH_POWER` in `src/models.ts`,
  [261001p](../plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md).
- ***Dig deeper* is always on Opus, and is not charged as the switch is.** The glossary's, a
  comment's and Bibliography's *Dig deeper* send `DIG_DEEPER_MODEL`
  ([`src/dig-deeper.ts`](../../src/dig-deeper.ts)) directly, switch on or off — for Citations that
  is the quick check's verdict, the paper's passages and the answer, everything the reader reads.
  Directly, not through `resolveModel`, so a per-task environment override does not put it back on
  Sonnet either. Greg asked for the bigger model whenever a reader wants to know more about one
  thing ([glossary.md § Digging deeper into a term](glossary.md#digging-deeper-into-a-term)). A press
  costs the reader nothing from their article allowance; it is bounded instead by an allowance of
  presses — `DIG_DEEPER_RATE_POLICY` for the glossary and comments, Bibliography's own
  `INVESTIGATE_RATE_POLICY`. Its quick-tier search step does not move either.
- **The quick tier and fixed-model calls do not move.** That includes link summaries, quiz-verdict
  classification, PDF reading and figure location, embeddings, dictation, shelf topics, the live
  voice session itself, and Illustrated's separate image-generation call. In Illustrated, only the
  capable-tier call that plans the plates moves. The task and non-task inventories are
  [`TASK_TIER`, `NON_TASK_MODELS` and `AI_JOB_WIRE`](../../src/models.ts); the two additional models
  belong to [`src/live.ts`](../../src/live.ts) and the image call to
  [`src/ai-call.ts`](../../src/ai-call.ts).
- **Nothing re-runs by itself, in either direction.** Switching on changes the model for runs from
  then on; for a mode offered on `/metadata`, press *Run it again* to redo it. Which modes have a row
  is [`METADATA_RERUN_STEPS`](../../src/rerun-steps.ts). Switching off keeps what Opus wrote — its
  output does not count as stale because a cheaper model is now selected. A pipeline artefact Opus
  wrote keeps `generator: "claude-opus-5-5"`.

## How it works, in four places

| | |
|---|---|
| The setting | `articles.high_power_since timestamptz null` — null is off. Written by `PUT /api/article/:slug/high-power` (`{ on: boolean }`), scoped to the caller's **own** article. A reader's switch-on goes through `chargeAndSwitchOnHighPower` ([`src/billing/admission.ts`](../../src/billing/admission.ts)): the charge row and the column commit in one transaction. The administrator's switch goes through the admin-checked, uncharged `highPowerStore.switchOnForAdmin`; every switch-off goes through the off-only `highPowerStore.switchOff`. Each real transition, on or off, also stamps `articles.updated_at` — switching off nulls `high_power_since`, so that is the only record of when; a repeat of the state it is already in moves neither |
| Whether it applies | `articlePower` in [`src/models.ts`](../../src/models.ts) reads whether the column is set; `powerFor` then applies the one task exception, Simple. Until 2026-09-30 the column also required an administrator owner, because nothing charged a reader. Now the only writer that sets it for a reader charges in the same transaction |
| Which model | The model's two spellings, the stored name and the wire address, are `HIGH_POWER_MODEL` and `HIGH_POWER_MODEL_OPENROUTER` in [`src/high-power-model.ts`](../../src/high-power-model.ts), a leaf so `src/ai-call.ts` can use `isHighPowerModel` without an import cycle; `src/models.ts` re-exports and explains them. `powerFor(task, articlePower)` selects the effective power where a task has a policy exception; `modelFor(task, power)` / `resolveModel(task, power)` resolve that selection. `power` is a **required** argument all the way down (`StepContext.power`, `streamMessage`'s options, every request-path stream), so a call that forgets to decide does not compile. Chosen over an `AsyncLocalStorage` scope because its failure is silent and it loses context across a streamed response |
| Freshness | `generationKey` / `sameGenerator`: the stamp comparison and the two citation fingerprints treat Sonnet and Opus as one generation. Checkpoint keys (labels batches, the whole-document call, deepening) stay exact, because there the question is *which model paid for this answer* |

## Four things that move with the model

- **Effort.** Opus 5.5's default effort is `medium`; Sonnet 5's (and 5.5's) is `high`. A call that takes the
  provider default sends `high` explicitly on Opus, so switching up never means thinking less. Calls
  that already choose their effort keep it.
- **The completion ceiling.** Chat sends 6,000 tokens on the high-power model instead of the standard
  model's 4,000; explain sends 4,000 instead of 1,500. Both key this choice on the model actually sent,
  not the article setting, so a deliberate model override carries the matching ceiling. `max_tokens`
  is outside the cached prompt and unused allowance is not billed
  ([261009h](../plans/261009h-high-powered-chat-cut-off-at-its-ceiling.md)).
- **The cache floor.** Opus 5.5 caches a prefix from **512** tokens, and so does Sonnet 5.5; Sonnet 5 needed 1,024 (until
  2026-10-09) — Opus measured live on 2026-09-30 (the plan's § Measurements). `underCacheFloor` takes the model.
- **The run is read per step.** The job runner reads the article's setting as each step starts, so
  flipping the switch mid-job changes the steps still to come.
