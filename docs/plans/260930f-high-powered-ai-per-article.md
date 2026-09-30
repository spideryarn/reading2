# 260930f — High-powered AI, per article

Feedback **SPIDERYARN-READING2-6C**, from Greg (admin, provenance checked). The note is
[260930_1100-high-powered-ai-per-article.md](../user-feedback/260930_1100-high-powered-ai-per-article.md).

> In some cases, for difficult articles, we might want to really be using the best AI thinking
> available. So, for example, we might switch Sonnet -> Opus or whatever, especially for the modes
> that will benefit from greater intelligence, like chat or summary or trajectory or, well, probably
> most of them.
>
> […] There's probably a lot of potential complexities to this. So, you know, write a doc about it,
> implement it. But if there's complexities, try and look for a sort of simple but decent v1 that
> communicates clearly to the user, you know, gets 80% of the value for 20% of the effort.
>
> Oh, and I think this should broadly double the processing cost for an article. […] it probably
> would be disabled if they've only got one doc remaining, because it requires two docs in order to
> do it. […] if you make a document public […] that only costs half a doc. So I suppose you could do
> the high-powered AI processing on a doc you've made publicly shared, and it would cost a single
> doc, because the 0.5 multiplies by the two.
>
> — Greg, 2026-09-30 (the whole report is quoted in the note)

## What this is, in one paragraph

Every article-reading model call in the app runs on the **capable tier**, which is Claude Sonnet 5
(`src/models.ts`). This adds a per-article switch, **High-powered AI**, which moves that article's
capable-tier calls to **Claude Opus 5.5** instead — the pipeline stages (structure, gist, glossary,
quotes, FAQ, trajectory…) and the calls made while you read it (chat, explain, search, quiz marking,
referee). Quick-tier jobs and the specialist non-tier models (PDF reader, embeddings, dictation) do
not move. Opus 5.5 is **$4 / $20 per million tokens against Sonnet 5's $2 / $10** — exactly twice,
checked against OpenRouter's live list today — so "broadly double" is the literal answer.

## Two halves, and why only one is built here

**Built (v1): the switch, for the administrator only, on `/metadata`.** It needs no billing change,
because nothing it does costs a reader anything: re-running a mode from `/metadata` is a bare-slug
`POST /api/jobs` that reserves no slot ([billing.md](../project/billing.md), and the
[metadata run-it note](../user-feedback/260930_0745-metadata-run-it-without-a-confirm.md) checked
this today), and only an administrator can turn the switch on. So the whole cost lands on us, and
"us" is Greg's own articles.

**Waiting on Greg: the reader-facing half.** Charging two docs for a high-powered article (one if it
is public), refusing it with one doc left, a flag at import time, and the line on `/pricing` and
`/features`. That is slot accounting, which is a defence
([security-map.md](../project/security-map.md) → billing.md), and published copy on the pricing
page — this unattended session writes those up (§ Deferred, below) rather than building them.

## Decisions, each with the simpler option passed over

1. **Opus 5.5 (`anthropic/claude-opus-5.5` on OpenRouter, named `claude-opus-5-5`).** The current
   Opus, and cheaper than Opus 5 ($5 / $25). Fable 5.1 was the other candidate: 5× Sonnet, and
   Greg asked for roughly 2×. Checked for request compatibility: Opus 5.5 rejects
   `thinking: {type: "disabled"}` and forced `tool_choice` (`any`/`tool`); `src/` sends neither
   (the one `tool_choice` is `"auto"` in `src/live.ts`, which is not on a tier). It takes adaptive
   thinking and `output_config.effort` exactly as Sonnet 5 does. **One behavioural difference:** its
   default effort is `medium`, where Sonnet 5's is `high`. The four article-reading stages send
   their effort explicitly (`STAGE_EFFORT`); any call that sends none would run *lower* effort on
   Opus than on Sonnet. Stage 1 lists which those are and says whether it matters.

2. **Every capable-tier task moves, not a hand-picked list.** Greg: *"probably most of them"*. A
   per-mode list is a second table to keep and argue over; "the article is high-powered" is one
   sentence a reader can hold. The quick tier stays quick: those jobs were put there because they do
   not need reasoning, and doubling them buys nothing.

3. **The setting is a column on `articles`: `high_power_since timestamptz null`.** Null is off —
   the house shape for a switch (experimental-features.md, sql.md), and it says *when*, for free.
   Passed over: a `jobs` column snapshotted at enqueue like `profile`. That is more consistent (one
   job, one setting) but adds a column to a second table and a field to five enqueue paths
   (reset, retry, upload, successor…). **Read once per step instead**, from the article row, when the
   step starts. The cost of that choice: flipping the switch while a job is mid-flight makes the
   *remaining* steps use the new setting. That is arguably what a reader means by "from now on", and
   it is written down rather than hidden.

4. **Effective only when the owner is an administrator.** The step reads
   `high_power_since !== null && isAdmin(owner)`. Only an administrator can set the column in v1, so
   the second half should never matter — it is there so that a row copied, restored or hand-edited
   onto a reader's article cannot quietly double what we spend on it before the billing half exists.
   When the reader-facing half lands, this is the one line that changes.

5. **The model is chosen by an argument, not by ambient state.** `modelFor(task, power)` and
   `streamMessage(task, body, { power, signal })` take the power **as a required parameter**, so the
   compiler lists every call site that has to decide, and a site that forgets does not compile.
   Passed over: an `AsyncLocalStorage` scope like `src/owner.ts`, which is one wrap at the job runner
   and a handful at routes, and much less diff. Rejected because (a) its failure is silent — a call
   outside the scope runs Sonnet while the switch says Opus, and nothing notices — and (b) the
   request-path calls return async generators that are iterated *after* a `run()` callback returns,
   which is exactly where an ALS context goes missing. The request-path functions already take a
   `model` argument that no route passes; this finally passes it.

6. **Switching does not re-run anything, in either direction.** Greg: *"a way to switch back again,
   though you wouldn't want to rerun things"*. Today every stage's freshness stamp expects
   `model: CAPABLE_MODEL`, so an Opus-written artefact would read as stale the moment the switch goes
   off, and be regenerated at the next run. So the freshness comparison treats the high-power model
   and the capable model as **the same generation** (one function, `sameGenerator`, used by
   `sameStamp` in `src/store/artifacts.ts` and by `arc.ts`'s own check). What is *stored* stays true:
   an artefact written by Opus says `generator: "claude-opus-5-5"`. Turning the switch on changes
   nothing until you press **Run it again**; the switch's own text says so.

   The consequence, stated: when the capable tier next moves (Sonnet 5 → something), articles whose
   artefacts were written by Opus will still read as current as long as Opus 5.5 is the high-power
   model. That is the right answer — the better model's output is not stale because the cheaper one
   changed.

7. **Checkpoint keys must see the real model.** Two places key a paid-for answer on the model:
   `labels.ts` `batchFingerprint` (hard-codes `CAPABLE_MODEL`) and the hierarchy structure-call
   fingerprint (goes through `messagesWireBody`, so it follows automatically). The first must use the
   model actually sent, or an Opus run reuses a Sonnet batch and calls it Opus.

8. **The switch is on `/metadata`, beside *Re-run AI processing*, admin-only.** Not on the import
   page in v1: an import-time flag is exactly where the two-doc charge lives, so it belongs to the
   deferred half. The route is **`PUT /api/admin/article/:slug/high-power`** with
   `{ on: boolean }`: inside the `/api/admin` namespace, so the existing administrator gate enforces
   who may call it without a new check anywhere, and still scoped to the caller's **own** article
   through `ownedSlug` (the admin namespace reads across owners; this route deliberately does not
   write across them). `GET /api/metadata/:slug` gains `highPowerSince`.

## Stages

### Stage 1 — the model choice (server)

- `src/models.ts`: `HIGH_POWER_MODEL = "claude-opus-5-5"`, `HIGH_POWER_MODEL_OPENROUTER =
  "anthropic/claude-opus-5.5"`, `type ModelPower = "standard" | "high"`; `resolveModel(task, power)`
  and `modelFor(task, power)` — capable-tier tasks go to Opus when `power === "high"`, an env override
  still wins (and is reported as one); `generatorFor(power)` for the stored stamp;
  `sameGenerator(a, b)`. `DISPLAY_NAME` gains both Opus spellings. `/api/models` reports `standard`.
- `src/messages-stream.ts`: `messagesWireBody(task, body, power)`, `streamMessage(task, body, { power,
  signal? })`, both required.
- Every `streamMessage` caller (15 stages), every `generator: CAPABLE_MODEL` write, every stamp's
  `model:`, `labels.ts` fingerprint, and the chat-wire pipeline calls (`debate`, `citations-find`,
  `citation-investigate`, `pdf-frontmatter`, `upload-source-guess`) take `power`.
- `StepContext.power: ModelPower` (required), filled in `runStep` in `src/jobs.ts` from the article
  row at step start (decision 3–4). A fresh ingest, before the article row exists, is `standard`.
- Evals and scripts pass `"standard"`.
- Tests: a table test that every capable task resolves to Opus at `high` and every other task does
  not move; `sameStamp` treats an Opus stamp as current against a Sonnet expectation and vice versa,
  and still rejects a *different* model; the labels fingerprint differs by power; a pipeline test
  that a step run for a high-power article sends the Opus id (through the existing stubbed
  transport in `tests/messages-stream.test.ts`'s shape).

### Stage 2 — the column, the route, the request path

- Migration: `alter table spideryarn.articles add column high_power_since timestamptz` (additive).
  Drizzle schema. Not copied by any path that clones an article (checked, not assumed).
- `Article.highPowerSince` from `loadArticle`; `articleMetadata` returns it.
- Store: `setHighPower(slug, on)` owner-scoped; `readModelPower(slug, ownerId)` for the job runner.
- Route `PUT /api/admin/article/:slug/high-power` `{ on: boolean }` → 200 `{ highPowerSince }`;
  strict body parsing like `patchShelf`; 404 for a slug the caller does not own.
- Request-path routes pass `model: modelFor(task, powerOf(article, owner))` — explain, chat
  (`converse`), search, quiz-mark, referee (mirror/criteria/claims/candidates), term-lookup's two
  `explainStream` calls, citation-investigate. Chat with no article open stays standard.
- Tests: the route (admin 200, non-admin 403 from the namespace gate, other owner's slug 404, bad
  body 400); a request-path route for a high-power article sends the Opus id.

### Stage 3 — the switch on `/metadata`, and the docs

- In `Metadata.tsx`, above the *Re-run AI processing* rows, admin-only: a checkbox
  **High-powered AI** — *"Uses Claude Opus instead of Sonnet for this article's AI: better on hard
  pieces, about twice the cost. Only runs from now on use it; nothing re-runs by itself — press Run it
  again on a mode to redo it."* When on, each rerun row's button is unchanged; the technical details
  already show which model wrote hierarchy and arc.
- A browser check (Sonnet subagent, Playwright on the box): toggle on, run one cheap mode, confirm the
  artefact's generator is Opus in the metadata technical details and in `ai_calls`; toggle off, the
  mode still reads as current.
- Docs: a new `docs/project/high-powered-ai.md` (owner: reading-view-overview.md), a line in
  setup-dev.md § Which model everything uses, the note, and the deferred half below.

## Deferred — written up for Greg, not built

These are his decisions; each is small once decided.

1. **The charge.** A high-powered article counts **2** articles; a public one **1** (Greg's
   0.5 × 2). The half-price public rule is already built
   ([billing.md § A public article counts half](../project/billing.md)): usage is counted in
   half-units, a private ingest 2 and a public one 1, **recomputed live from `articles.visibility`**
   every time it is asked. The obvious extension is to multiply by 2 when `high_power_since` is set —
   same query, same half-units, no new ledger row.

   **But live recomputation is wrong for this one, and that is the decision to make.** Sharing is an
   ongoing state that benefits other readers, so un-sharing rightly puts the cost back. High power is
   money spent at the moment a stage runs: live recomputation would let a reader switch on, run every
   mode on Opus, switch off, and get the extra article back. So either (a) the charge is sticky —
   *ever* switched on counts double, which is one more column (`high_power_charged_at`, never
   cleared) and the same query — or (b) the charge is a ledger row at switch-on. (a) is simpler and
   keeps the half-units arithmetic untouched; it means switching off is a model choice, not a refund,
   and the copy has to say so.
2. **When the charge applies.** At import (the flag on the paste box / upload, available *"up to the
   point where it starts doing the structure"*), or on switching on from `/metadata` for an article
   already imported, or both. Switching on later without a charge would let anyone import cheap and
   upgrade free; charging the second slot at switch-on is the simplest honest rule.
3. **Refuse with one doc left** — follows from 1, with one wrinkle: admission today deliberately
   admits one half-unit of overdraft (`used < budget`, billing.md), so "refuse unless two whole
   articles remain" is a different comparison from the one ingests use, and needs its own test.
4. **Re-runs.** Re-running a mode is free today. On a high-powered article each re-run costs us twice
   as much. Probably still fine at beta volumes; worth a sentence.
5. **Pricing and features copy, proposed:**
   - `/pricing`, a line under the plans: *"High-powered AI: for a difficult piece, switch an article
     to our strongest model. It counts as two articles (one, if you've shared it publicly)."*
   - `/features`: an entry, *"High-powered AI — Opus instead of Sonnet for one article, when the
     reading is hard."*
6. **Who sees the switch.** v1: administrators. Opening it to readers is the same component with
   `isAdmin` swapped for the entitlement check that item 1 creates, plus decision 4's one line.

## Status

Plan written; Sol plan review next.
