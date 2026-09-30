# 260930f — High-powered AI, per article

Feedback **SPIDERYARN-READING2-6C**, from Greg (admin, provenance checked). The note is
[260930_0230-high-powered-ai-per-article.md](../user-feedback/260930_0230-high-powered-ai-per-article.md).

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
   default effort is `medium`, where Sonnet 5's is `high`. Most chat-wire jobs deliberately send no
   effort (`providerDefault` in `CHAT_REASONING`, `src/ai-call.ts`), and so does the messages-wire
   `illustrated` call — so on Opus they would think *less* than they do on Sonnet today, which is
   the opposite of the switch's promise (Sol F2).

   **Rule: on high power, a call that would take the provider's default effort sends `high`
   explicitly** — Sonnet 5's own default, so Opus thinks at the level the call already gets. No
   `max_tokens` ceiling moves: each was sized against Sonnet running at its default, which is `high`,
   so nothing asks for more reasoning than it was budgeted for. Calls that already choose an effort
   (`STAGE_EFFORT`, the referee rows at `medium`) keep it. Enforced at the two seams —
   `CHAT_REASONING` resolution in `ai-call.ts` and `messagesWireBody` — not per call site.

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

   **The same equivalence is needed in two content hashes**, not only in stamps (Sol F1):
   citation lookup and citation investigation fingerprint the exact model
   (`src/citation-lookup.ts:149`, `src/citation-investigate-context.ts:132`), and `loadCitations`
   recomputes them to attach stored results — so a toggle would detach every lookup from its
   article. Both use one `generationKey(modelId)` that maps the standard and high spellings (wire and
   stored) to one value and leaves every other id, env overrides included, exact. `sameGenerator` is
   `generationKey(a) === generationKey(b)`.

   The consequence, stated: when the capable tier next moves (Sonnet 5 → something), articles whose
   artefacts were written by Opus will still read as current as long as Opus 5.5 is the high-power
   model. That is the right answer — the better model's output is not stale because the cheaper one
   changed.

7. **Checkpoint keys must see the real model** (unlike the freshness keys above, which must not). Two places key a paid-for answer on the model:
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

**Stages 1 and 2 are one stage in practice** — one implementer, one code review — because the
column is what Stage 1's job runner reads. They stay listed separately so the checklist is legible.

### Stage 1 — the model choice (server)

- `src/models.ts`: `HIGH_POWER_MODEL = "claude-opus-5-5"`, `HIGH_POWER_MODEL_OPENROUTER =
  "anthropic/claude-opus-5.5"`, `type ModelPower = "standard" | "high"`; `resolveModel(task, power)`
  and `modelFor(task, power)` — capable-tier tasks go to Opus when `power === "high"`, an env override
  still wins (and is reported as one); `generatorFor(power)` for the stored stamp;
  `sameGenerator(a, b)`. `DISPLAY_NAME` gains both Opus spellings. `/api/models` reports `standard`.
- `src/messages-stream.ts`: `messagesWireBody(task, body, power)`, `streamMessage(task, body, { power,
  signal? })`, both required.
- Every `streamMessage` caller (15 stages), every `generator: CAPABLE_MODEL` write, every stamp's
  `model:`, `labels.ts` fingerprint, and the chat-wire calls made inside the pipeline (`debate`,
  `citations`/`citations-find`, `pdf-frontmatter`) take `power`.
- **Production entry points require `power` (or an explicit `model`)**; a standard-default wrapper
  is allowed only for scripts and evals (Sol F4). Today `citation-find.ts` and `source-guess-run.ts`
  keep optional model defaults, so requiring `power` on `modelFor` alone would not force their routes
  to supply it.
- Effort parity (decision 1): `providerDefault` becomes `high` on high power, in `ai-call.ts` and
  `messagesWireBody`.
- `generationKey` / `sameGenerator` (decision 6), used by `sameStamp`, `arc.ts`'s `isStale`, and the
  two citation fingerprints at write and read.
- **Cache floor (Sol F5):** `CACHE_FLOOR_TOKENS` is Sonnet 5's 1,024, and its comment says a model
  change must revisit it. Probe Opus 5.5 live on the messages wire (one short and one ~2k-token
  cached prefix, twice each, read `cache_read_input_tokens`); if its floor differs, make
  `underCacheFloor` take the model. A few cents.
- `runStep`: a genuinely new ingest (no article row yet) is `standard`; a reset/retry/successor
  whose article is unexpectedly missing fails rather than silently downgrading (Sol, checks that
  passed).
- `StepContext.power: ModelPower` (required), filled in `runStep` in `src/jobs.ts` from the article
  row at step start (decision 3–4). A fresh ingest, before the article row exists, is `standard`.
- Evals and scripts pass `"standard"`.
- Tests: a table test that every capable task resolves to Opus at `high` and every other task does
  not move; `sameStamp` treats an Opus stamp as current against a Sonnet expectation and vice versa,
  and still rejects a *different* model; the labels fingerprint differs by power; a pipeline test
  that a step run for a high-power article sends the Opus id (through the existing stubbed
  transport in `tests/messages-stream.test.ts`'s shape).

### What landed

As planned, with these differences — each one a place the plan did not settle or turned out
wrong:

- **The two literals live in a leaf, `src/high-power-model.ts`**, re-exported by `models.ts`.
  `ai-call.ts` needs `isHighPowerModel` for its effort seam, and importing `models.ts` from there
  closes `ai-call → models → embeddings → ai-call`, which `npm run cycles` gates on.
- **Effort parity is keyed on the model sent, not on `power`**: `wireEffort(job, model)` in
  `ai-call.ts` and the `parity` spread in `messagesWireBody` give `high` to a would-be default call
  when the id is Opus 5.5. The reason is that model's default, so an env override to Opus gets it
  too. A call that names its own effort keeps it (`STAGE_EFFORT`, the two referee `medium` rows).
- **`generationKey`'s canonical value is `CAPABLE_MODEL_OPENROUTER`**, not a new token, so every
  stored citation-lookup and investigation hash (both were taken over that exact wire id) stays
  byte-identical on deploy.
- **The labels checkpoint key uses `generatorFor(power)`** — the stored *name* — so a standard
  run's keys are byte-identical to the `CAPABLE_MODEL` they held; labels has no env override, so
  the name is exact. The hierarchy structure key and the deepening wave's expansion key follow
  `messagesWireBody` automatically; `ExpansionIdentity` gained a required `power` so the key and
  the executor cannot disagree.
- **`buildTree` still stamps `CAPABLE_MODEL`** (113 test callers want only a tree);
  `generateHierarchy` overwrites `generator` on the tree it returns. Every other stage's pure
  builder (`buildArc`, `buildGlossary`, `buildQuiz`…) takes `power` and stamps `generatorFor`.
- **`runStep` reads power through a required `AdvanceParts.power` seam**, not a direct store call:
  production passes `readStepPower` (and `PRODUCTION` is exported so
  `tests/high-power-step.test.ts` can assert that wiring); tests pass `async () => "standard"`. A
  read that throws is recorded as that step's failure — the step's `try` re-throws it before
  `run`, and the skip preflight is not consulted, so the `standard` placeholder on `ctx` can reach
  no model call.
- **There is no "fresh ingest, no row yet" case at step time.** The claim opens the job's draft
  before any step runs, and that is where the row is born (`openOrBeginJobDraft` →
  `lockOrCreateArticle`), with the column null. So `readStepPower` treats a missing row as a
  failure, always, rather than special-casing ingest.
- **Production entry points require `power` or `model`** (Sol F4): `findWorkPage`,
  `runCitationLookup`, `GuessSourceDeps.find` (`FindOpts`), `openRouterFrontMatterReader` and
  `openRouterAuthorsReader` lost their defaults. The quick-tier callers (`link-summary`,
  `quiz-verdict`) pass `"standard"` with a comment, since High-powered AI does not move them.
- **`underCacheFloor(text, model)`** is model-aware — Opus 5.5's floor is 512 (§ Measurements).
  `labels.ts`'s `prefixIsCacheable` and `hierarchy-expand.ts`'s `expansionPrefixIsCacheable` still
  use Sonnet's 1,024: they are estimates that decide whether to serialise the first batch, and
  1,024 errs toward fanning out (a missed cache hit on a 512–1,023-token prefix at high power), not
  toward a false alarm. Left for a follow-up if it ever matters.
- Freshness reads in `src/store/pg.ts` (the `*IsCurrent` family, the debate row, the citation
  fingerprints) ask with `"standard"`: `sameStamp` and `generationKey` make the power irrelevant
  there, and an override still compares exactly.
- `/api/models` reports `resolveModel(task, "standard")` — the app's configuration, not one
  article's.
- `src/web/PrivacyPage.tsx` names `claude-opus-5-5` — `tests/privacy-page.test.ts` requires every
  `DISPLAY_NAME` value on the page. One clause of reader-facing copy; worth Greg's eye.

### Stage 2 — the column, the route, the request path

- Migration: `alter table spideryarn.articles add column high_power_since timestamptz` (additive).
  Drizzle schema. Not copied by any path that clones an article (checked, not assumed).
- `Article.highPowerSince` from `loadArticle`; `articleMetadata` returns it.
- Store: `setHighPower(slug, on)` owner-scoped; `readModelPower(slug, ownerId)` for the job runner.
- Route `PUT /api/admin/article/:slug/high-power` `{ on: boolean }` → 200 `{ highPowerSince }`;
  strict body parsing like `patchShelf`; 404 for a slug the caller does not own.
- Request-path routes pass `model: modelFor(task, powerOf(article, owner))` — explain, chat
  (`converse`), search, quiz-mark, referee (mirror/criteria/claims/candidates), term-lookup's two
  `explainStream` calls, citation-investigate (including its nested find-first path), the citation
  `/find` route (`routes.ts:7974`) and the upload source-guess route (`routes.ts:8024`). Chat with no
  article open stays standard.
- Tests per route family, not one representative route (Sol F4).
- Tests: the route (admin 200, non-admin 403 from the namespace gate, other owner's slug 404, bad
  body 400); a request-path route for a high-power article sends the Opus id.

### What landed

- **Migration `drizzle/20260930111320_article_high_power_since.sql`**, generated by
  `db:generate`, then edited to `ADD COLUMN IF NOT EXISTS`. The reason is local, and worth
  knowing: the shared local database's ledger holds another worktree's not-yet-merged migration
  (`20260930100840_crossrefs`, fb-5z), so `npm run db:migrate` here refused, correctly, to
  reconcile. The column was applied to the **local** database only (`Target:
  postgresql://postgres@127.0.0.1:54362/postgres`) by running the migration's SQL directly, and
  `IF NOT EXISTS` means the ordinary `db:migrate` after both branches land does not fail on it.
  The private test lane mints its own database and applies the file normally. Production untouched.
- `Article.highPowerSince: string | null` (required, like `sourceGuess`) from `loadArticle`, and
  `ArticleMetadata.highPowerSince` from `articleMetadata`. The client's public projection
  (`src/web/article/access.ts`) nulls it, as it does `sourceGuess`: the owner's spend is not a
  visitor's business.
- Store: `src/store/pg-high-power.ts` — `set(slug, on)` (owner-scoped, idempotent: a second "on"
  keeps the first `since`) and `read(slug, ownerId)` for the job runner — exported as
  `highPowerStore` behind the usual `guarded(...)`.
- `articlePower(highPowerSince, ownerId)` in `src/models.ts` is the one spelling of decision 4,
  used by the job runner and every request path. Routes in `routes.ts` go through `powerOf(article)`
  (`loadArticle` is owner-scoped, so the ambient owner is the article's).
- **Request paths pass `power`, not `model`.** Each stream's request type gained a required
  `power: ModelPower` and its `defaultModel(power)` resolves from it; `model` stays as an override
  for tests and evals. Fewer moving parts at each route (one argument, not a task name and a
  resolver call), and the compiler still finds every caller.
- **One family the plan's list missed, found by the compiler:** a live conversation's
  `search_article_meaning` tool (`POST /api/chat/:slug/live-tool` → `runTool` → `findPassages`),
  and typed chat's own use of the same tool — `ToolContext` gained `power`.
- Route `PUT /api/admin/article/:slug/high-power` with `parseHighPowerRequest` (strict: an extra
  key or a non-boolean `on` is a 400). Added to `tests/authenticated-api-route-contract.test.ts`.

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

### What landed

The UI half, 2026-09-30.

- **`src/web/HighPowerSwitch.tsx`**, mounted first inside `RerunSection` in `Metadata.tsx`, above
  the whole-article row and the mode rows it changes the model for. It draws nothing unless
  `isAdmin(useSession().user?.id)`. It is a native checkbox tinted like the experimental switch on
  `/profile`, with the help text beneath it and `On since <date>` when on. The box is controlled by
  the server's last answer, never by the click. It is disabled until the metadata has answered and
  while the `PUT` is out. A failure reads `Not saved — <the server's message>` and leaves the box as
  it was. A success calls the page's `refresh`.
- **Where it sits has a cost.** The section is shut by default, so an admin sees whether an article
  is on only after opening *Re-run AI processing*. Section's `aside` slot on the heading row could
  say it while shut. That was not built.
- **`tests/metadata-high-power-switch.test.tsx`** has 7 tests, mounted through `Metadata`. It covers
  six things:
  - it is absent for a reader and present for the admin;
  - it already reads as on when the column is set;
  - it sends `PUT /api/admin/article/:slug/high-power` with `{on:true}` and then `{on:false}`, and
    re-reads the metadata after each;
  - it is disabled while the write is out;
  - a 404 leaves the box unchanged and shows the message;
  - a race, below.
- **The browser check found a bug that the first five tests missed.** It ran under Playwright on the
  box, against this worktree's own vite on :5391, signed in as the local admin, on
  `the-mythology-of-conscious-ai-spya-rn5m0q`. The box was first re-synced from the page's read in
  an effect keyed on `saving`. Finishing a save therefore re-applied the read from before the write:
  switching off drew *On since …* again until the refresh landed. The race test holds the refresh
  open. It went red on that code and green once the sync moved to a render-time adjustment on `read`
  alone. A re-run in the browser then showed on → reload still on → off, with no stale line. The
  shots are `260930f-shot-high-power-off.png` and `260930f-shot-high-power-on.png`.
- **Not done here:** the plan's fuller browser check (run a cheap mode with the switch on and confirm
  Opus in the technical details and in `ai_calls`). It spends a real model call.

## Deferred — written up for Greg, not built

These are his decisions; each is small once decided.

1. **The charge.** A high-powered article counts **2** articles; a public one **1** (Greg's
   0.5 × 2). The half-price public rule is already built
   ([billing.md § A public article counts half](../project/billing.md)): usage is counted in
   half-units, a private ingest 2 and a public one 1, **recomputed live from `articles.visibility`**
   every time it is asked. The obvious extension is to multiply by 2 when `high_power_since` is set —
   same query, same half-units, no new ledger row.

   **But neither live recomputation nor a sticky column works, and that is the decision to make.** Sharing is an
   ongoing state that benefits other readers, so un-sharing rightly puts the cost back. High power is
   money spent at the moment a stage runs: live recomputation would let a reader switch on, run every
   mode on Opus, switch off, and get the extra article back. And a sticky column
   (`high_power_charged_at`) multiplying the article's ingest rows charges the **wrong period**
   (Sol F3): usage counts `ingest_events` by the period each *ingest* succeeded in
   (`src/store/pg-billing.ts:395`, `:450`), so switching on a three-month-old article this month
   charges nothing this month — and it would double every ingest row of the article, where the
   contract is N ingest rows to one article (billing.md).

   **Recommended: a one-time upgrade charge event**, unique per article, timestamped when the switch
   is first turned on (at import, that is the ingest's own moment). It is one extra article's worth
   — 2 half-units private, 1 public, recomputed from live visibility like ingest rows, frozen on
   delete the same way. Switching off refunds nothing (the Opus calls were spent); switching on again
   charges nothing new. Open question for Greg: does a re-added URL (a second ingest of the same
   article) change that single charge? Proposed: no.
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

## Measurements

**Opus 5.5's minimum cacheable prefix (Sol F5), 2026-09-30.** Live, through OpenRouter's
`/v1/messages` with the app's own `messagesClient` and `MESSAGES_PROVIDER`, a `system` block marked
`cache_control: ephemeral`, `max_tokens: 8`, no thinking; each prefix sent twice, a fresh nonce per
size so nothing was already cached. Twelve calls in all, well under ten cents.

| Model | Prefix tokens | 1st call: cache write | 2nd call: cache read |
|---|---|---|---|
| `anthropic/claude-opus-5.5` | ~443 (459 total) | 0 | 0 |
| `anthropic/claude-opus-5.5` | ~502 (518 total) | 0 | 0 |
| `anthropic/claude-opus-5.5` | 543 | 543 | 543 |
| `anthropic/claude-opus-5.5` | 915 | 915 | 915 |
| `anthropic/claude-opus-5.5` | 1,131 | 1,131 | 1,131 |
| `anthropic/claude-opus-5.5` | 2,597 / 5,184 / 10,105 | written | read |
| `anthropic/claude-sonnet-5` (control) | ~912 (928 total) | 0 | 0 |

So Opus 5.5's floor is between 503 and 543 — **512**, Anthropic's documented Opus figure — against
Sonnet 5's 1,024 (the control confirms the method: 912 does not cache on Sonnet). It differs, so
`underCacheFloor` takes the model (`HIGH_POWER_CACHE_FLOOR_TOKENS`, `src/article-prompt.ts`).
Every call was answered by the model asked for (`answeredBy` matched). The script was a scratch
file and is not kept.

## Review log

- **Plan review, round 1** (GPT Sol, read-only):
  [prompt](260930f-high-powered-ai-per-article-plan-review-prompt.md),
  [answer](260930f-high-powered-ai-per-article-plan-review-sol.md). `VERDICT: revise`, no P0, one
  P1. F1 (citation hashes detach on toggle) → decision 6 extended with `generationKey`. F2 (Opus's
  lower default effort) → effort-parity rule in decision 1. F3 (sticky billing column charges the
  wrong period) → deferred item 1 rewritten as a one-time charge event. F4 (two routes missing,
  optional model defaults) → Stage 1/2 checklists. F5 (cache floor) → live probe in Stage 1. All
  five accepted as found; none overruled. Not re-reviewed as a plan: the changes are additions Sol
  itself proposed, and the code review will see them built.

- **Code review, Stages 1–2** (GPT Sol, write-capable, candidate 9b611dfe):
  [prompt](260930f-high-powered-ai-per-article-stage1-review-prompt.md),
  [answer](260930f-high-powered-ai-per-article-stage1-review-sol.md). `VERDICT: ship`, no P0/P1. It
  fixed two P2s itself, red-first: F1, the labels and hierarchy-expansion cache estimates still used
  Sonnet's 1,024 floor on Opus (so a high-power run could skip a warm-up it qualified for); F2,
  `generationKey` returned the mutable `CAPABLE_MODEL_OPENROUTER`, so the next capable-tier move
  would have detached every stored citation lookup — now a frozen literal,
  `CAPABLE_GENERATION_KEY`, pinned byte-for-byte by a test. Its fixes were read and the gates re-run
  here. It could not run the three Postgres-backed suites (no loopback in its sandbox); they were run
  here.

## Status

Stages 1–3 built. Stage 3 review next.
