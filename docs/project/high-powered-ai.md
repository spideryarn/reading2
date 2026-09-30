# High-powered AI

Parent: [reading-view-overview.md](reading-view-overview.md). The build, and every decision behind
it, is [260930f](../plans/260930f-high-powered-ai-per-article.md) (the switch, for the administrator)
and [260930k](../plans/260930k-high-power-for-readers-and-cost-only-for-admins.md) (readers, and what
it costs them).

**One switch per article, on `/metadata`, that moves that article's capable-tier calls from Claude
Sonnet to Claude Opus.** For a difficult piece — a dense paper, an argument that takes several
readings — the stronger model writes the structure, gists, quotes, FAQ answers and chat replies.
Opus 5.5's input and output token prices are twice Sonnet 5's; the dated prices and measurement live
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

**Switching on happens only on `/metadata`, after the article is on the shelf**, not at import. The
first pass is always Sonnet, and a reader who wants Opus throughout presses *Run it again* (free,
as every re-run is). An import-time flag is the named next step; it needs its own plan, because
the charge would have to ride the job.

## What it changes, and what it does not

- **Every task on the capable tier moves**, for that article only: the pipeline stages (structure,
  headings, gist, glossary, quotes, ideas, timeline, quiz, FAQ, sketch, illustrated, trajectory,
  debate, citations) and the calls made while you read it (chat, explain, search, quiz marking,
  referee, citation lookup and investigation, glossary look-ups, live conversation's search tool).
  A developer's explicit per-task environment override still wins, so a deliberate model comparison
  stays pinned. [`TASK_TIER` and `resolveModel` in `src/models.ts`](../../src/models.ts) are the
  exhaustive list and that exception.
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
| The setting | `articles.high_power_since timestamptz null` — null is off. Written by `PUT /api/article/:slug/high-power` (`{ on: boolean }`), scoped to the caller's **own** article. A reader's switch-on goes through `chargeAndSwitchOnHighPower` ([`src/billing/admission.ts`](../../src/billing/admission.ts)): the charge row and the column commit in one transaction. The administrator's switch, and every switch-off, go through the uncharged `highPowerStore.set` |
| Whether it applies | `articlePower` in [`src/models.ts`](../../src/models.ts): the column is set. Until 2026-09-30 it also required an administrator owner, because nothing charged a reader. Now the only writer that sets the column for a reader charges in the same transaction |
| Which model | `modelFor(task, power)` / `resolveModel(task, power)` — `power` is a **required** argument all the way down (`StepContext.power`, `streamMessage`'s options, every request-path stream), so a call that forgets to decide does not compile. Chosen over an `AsyncLocalStorage` scope because its failure is silent and it loses context across a streamed response |
| Freshness | `generationKey` / `sameGenerator`: the stamp comparison and the two citation fingerprints treat Sonnet and Opus as one generation. Checkpoint keys (labels batches, hierarchy structure, deepening) stay exact, because there the question is *which model paid for this answer* |

## Three things that move with the model

- **Effort.** Opus 5.5's default effort is `medium`; Sonnet 5's is `high`. A call that takes the
  provider default sends `high` explicitly on Opus, so switching up never means thinking less. Calls
  that already choose their effort keep it.
- **The cache floor.** Opus 5.5 caches a prefix from **512** tokens, Sonnet 5 from 1,024 — measured
  live on 2026-09-30 (the plan's § Measurements). `underCacheFloor` takes the model.
- **The run is read per step.** The job runner reads the article's setting as each step starts, so
  flipping the switch mid-job changes the steps still to come.
