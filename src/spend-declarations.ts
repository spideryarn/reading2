/**
 * **The register of calls allowed to skip the gateway** — data only, no way to
 * make one.
 *
 * Split from [`evals/declared-spend.ts`](../evals/declared-spend.ts), which
 * holds the wrapper and the guarded `fetch`. The wrapper lives under `evals/`
 * so that nothing in `src/` can reach a second way of calling a model; but the
 * *list* has to be readable from `src/` and from `scripts/`, because
 * [`npm run cost`](../scripts/ai-cost.ts) prints the still-unmetered entries by
 * name every run and
 * [`tests/no-undeclared-spend.test.ts`](../tests/no-undeclared-spend.test.ts)
 * checks the list is complete. A table of facts is safe to share; the thing
 * that can spend money is not.
 *
 * Why any of this exists: docs/plans/260828g-ai-spend-outside-the-gateway.md.
 */

import type { ProviderAccount } from "./ai-spend.js";
import type { AiJob, Wire } from "./models.js";

/**
 * **Every hostname that can take our money**, in one place.
 *
 * Two things read this and used to keep their own copy: the capability scan in
 * [`tests/no-undeclared-spend.test.ts`](../tests/no-undeclared-spend.test.ts),
 * which asks which *source* files could spend, and the runtime guard in
 * [`tests/setup/no-provider-calls.ts`](../tests/setup/no-provider-calls.ts),
 * which refuses an outbound request from a *test*. A second copy is a list that
 * goes stale in one place and not the other, and the direction it goes stale in
 * is quiet: a new provider added to the scan but not to the guard is a provider
 * tests may call for free.
 *
 * Hosts, not URLs. The guard matches a request's hostname against these exactly
 * or as a suffix (`foo.openrouter.ai` counts), so a base URL moving from
 * `/api/v1` to `/v2` does not need an edit here.
 */
export const PROVIDER_HOSTS: readonly string[] = [
  "openrouter.ai",
  "api.anthropic.com",
  "api.openai.com",
  "api.voyageai.com",
];

/**
 * Paths that cost money wherever they are served from.
 *
 * Only the capability scan uses these — a *string* naming one is evidence a
 * source file talks to a provider. The runtime guard does not, because it has
 * the real hostname in front of it and does not need to guess from a path.
 */
export const PAID_ENDPOINT_PATHS: readonly string[] = [
  "/v1/chat/completions",
  "/v1/audio/transcriptions",
  /* Text-to-speech, added 2026-09-02. `evals/live/jargon-recovery.mts` buys it
     to say the test sentences, and it was reaching the scan only through the
     hostname — so a file that named the path and built the host at run time
     would have gone unseen. A path that costs money belongs in the list whether
     or not something currently uses it that way. */
  "/v1/audio/speech",
  "/v1/embeddings",
  /* Pictures, added 2026-09-03 with the Illustrated sub-mode's wire. About
     $0.013 a plate, which is more than a whole quiz costs — the only reason it
     reads as small is that it is a fraction of a cent per *token* nowhere. It
     goes through the owned seam (`openRouterImage`, src/ai-call.ts), so there
     is no `Declaration` and no `UNMETERED_SPEND` entry for it and there must
     not be: either would be this register claiming a hole that does not exist.
     What the path buys is the scan — a source file that names it is a source
     file that can spend, whether or not anything uses it that way today. */
  "/v1/images",
];

export interface Declaration {
  /** Stable id. Appears on the row's `step_name`, so a row can be traced here. */
  readonly id: string;
  /** Which bill it lands on. */
  readonly account: ProviderAccount;
  /** The one file allowed to use it — checked by the scan, not at run time. */
  readonly file: string;
  /**
   * **What kind of hole this is**, which turned out to be two things wearing one
   * name.
   *
   * `"bypass"` — the file talks to a provider itself, round the outside of both
   * seams. `"unscoped"` — it uses the seam perfectly well and simply never opens
   * a collector, so `recordSpend` warns and drops the row on the floor.
   *
   * The distinction is not bookkeeping. A bypass needs a *reason* the seam is
   * wrong for it; an unscoped file needs one line. GPT Sol found the entry that
   * proved they are different: `bench-vocabulary-sources.ts` was declared as a
   * bypass and had by then been rewritten to call `transcribeWith`, so the
   * declaration was standing permission for something that no longer happened
   * and the test meant to catch that could not, because "names a credential"
   * looked like capability.
   */
  readonly kind: "bypass" | "unscoped";
  /** Which job the call is doing, in the ledger's vocabulary. */
  readonly job: AiJob;
  /** What shape of API it speaks. */
  readonly wire: Wire;
  /**
   * **Whether it actually writes a row yet.**
   *
   * `false` is not a to-do marker that can be ignored: `npm run cost` prints
   * every `false` row by name, every run, as the spend it knows it cannot see.
   * That is the whole difference between this table and the sentence it
   * replaced — *"Not counted here: anything evals/ spends"* — which named
   * nothing and so could never be finished.
   */
  readonly metered: boolean;
  /**
   * Why the seam is wrong for this call — or, for an `"unscoped"` entry, why the
   * one line has not been written. Not "it was easier".
   */
  readonly why: string;
  /**
   * When this entry was opened, `YYYY-MM-DD`.
   *
   * There is no expiry and no build that fails on an old date, because a gate
   * that breaks on a calendar boundary gets muted rather than fixed. What this
   * buys is that `npm run cost` prints the age, so an admission that has been
   * open for three months reads differently from one opened this morning — which
   * is the whole of what GPT Sol was asking for when he called `metered: false`
   * a loophole with no expiry.
   */
  readonly since: string;
}

export const DECLARATIONS: readonly Declaration[] = [
  {
    /* **The concurrency probe behind `CHUNK_CONCURRENCY` 100 and `WidthGate`**,
       2026-09-04. Fires N transcription requests at once and reports the raw
       status, timing and dispatch spread of every one.

       **The seam is wrong for it in the strongest sense available: the seam is
       the thing under test.** `openRouterJson` retries a 429, turns a status
       into a `ProviderRefused`, and imposes one `provider` policy per job — so
       routing this through it would measure our retry logic rather than the
       upstream's tolerance, and the question was precisely *at what width does
       the upstream start refusing*. The answer on the day was "not at 400", and
       it is a fact about this account's tier at the provider rather than about
       the model, so it can change without anyone telling us. That is why the
       script is kept rather than thrown away, and why this entry exists rather
       than the script being deleted after one use.

       `metered: false` and it should stay that way: the run is manual,
       occasional, and its cost is reported by the script itself from the
       `usage` block ($0.35 for the width-100 run). Writing `ai_calls` rows for a
       deliberate load test would put probe traffic in the same table as real
       readers' articles, which is the one thing `npm run cost` must not have to
       explain away. */
    id: "pdf-width-spike",
    kind: "bypass",
    since: "2026-09-04",
    account: "openrouter",
    file: "scripts/spike-pdf-width.ts",
    job: "pdf",
    wire: "chat",
    metered: false,
    why: "The seam is what is being measured. `openRouterJson` retries a 429, converts a status into a `ProviderRefused` and imposes one `provider` policy, and this script exists to find the width at which the upstream starts refusing — so routing it through the seam would measure our own retry logic instead of the provider's tolerance.",
  },
  {
    /* **The only `account: "anthropic"` entry in the table, and the only reason
       `ANTHROPIC_API_KEY` exists in this project at all.** Since 2026-08-31 that
       is pinned rather than merely true — `tests/no-undeclared-spend.test.ts`
       fails if a second one appears, because the whole app is on OpenRouter
       (docs/project/ai-gateway.md) and a second Anthropic-direct caller would be
       a second bill nobody is watching.

       The key is not in `.env.local` by default. Only this bake-off's four
       `transport: "anthropic"` arms need it, and the file skips them with a
       message rather than failing when it is absent. */
    id: "bakeoff-anthropic-transport",
    kind: "bypass",
    since: "2026-08-28",
    account: "anthropic",
    file: "evals/pdf/bakeoff/bakeoff.mts",
    job: "pdf",
    wire: "messages",
    metered: true,
    why: "The bake-off's whole question is which transport wins. Routing its `transport: \"anthropic\"` arm through OpenRouter would leave it comparing OpenRouter with OpenRouter and reporting a winner.",
  },
  {
    id: "bakeoff-openrouter-transport",
    kind: "bypass",
    since: "2026-08-28",
    account: "openrouter",
    file: "evals/pdf/bakeoff/bakeoff.mts",
    job: "pdf",
    wire: "chat",
    metered: true,
    why: "The other half of the same comparison, and it cannot go through `openRouterJson` either: the seam owns the `provider` block per job, and this bake-off's arms deliberately differ from each other — the model arms forbid fallback, the Mistral OCR arm allows it. One policy imposed on both would change what two of the arms measure.",
  },
  {
    id: "embedding-eval-judge",
    kind: "bypass",
    since: "2026-08-28",
    /* **`openrouter` since 2026-08-31**, when the judge moved off
       `api.anthropic.com` onto the Skin. It was `anthropic` because the bypass
       was written the same week the pipeline migrated and the judge was left
       where it was; nothing about the judge needed a second vendor. The bypass
       itself did not go away — the reason below is unchanged — but the account
       did, which is why this row now takes a settled `cost` from OpenRouter
       instead of our arithmetic over `ANTHROPIC_PRICES`. */
    account: "openrouter",
    file: "evals/embedding-retrieval.ts",
    job: "eval",
    wire: "messages",
    metered: true,
    why: "The judge picks its own model per run, and `streamMessage` owns the model on purpose so a stage cannot quietly switch one. Converting it to the chat wire would mean losing `thinking: {type: \"adaptive\"}`, which changes the judgements — and the judgements are cached on disk under a rubric version, so changing them costs a full re-judge in real money.",
  },
  {
    id: "dictation-bench-audio",
    kind: "bypass",
    since: "2026-08-28",
    account: "openrouter",
    file: "evals/dictation/bench-transcribers.mjs",
    job: "dictation",
    /* `chat` until 2026-09-07, and it was never right: this file has posted to
       `/v1/audio/transcriptions` since the day it was written. The value was
       wrong rather than stale, and it survived because nothing checks a
       declaration's wire against the path the file actually names. */
    wire: "transcription",
    metered: false,
    /* **The reason below expired on 2026-09-07 and is kept as history**, because
       it is the argument somebody will otherwise make again. It said the seam
       deliberately did not serve this path and that wiring the file up would
       need a fourth `Wire`. Both were true until dictation moved endpoint:
       `OpenRouterPath` now carries `/v1/audio/transcriptions`,
       `openRouterTranscription` sends to it, and `Wire` has a `transcription`
       member — so the widening this entry refused happened anyway, for the app's
       own sake. What is left is a scrappy sixteen-model sweep that nobody has
       rewired, not a call the seam is wrong for. Converting it would be the same
       one-line job as the three `unscoped` dictation entries below.
       docs/plans/260907c-dictation-onto-an-openai-transcriber.md. */
    why: "Posts a raw `fetch` to `/v1/audio/transcriptions` over sixteen candidate models, from before the seam served that path at all. Since 2026-09-07 `transcribeWith`'s `model` option would do the same job through the seam — as `bench-models.ts` does — so this is now an unconverted file rather than a call the seam cannot make.",
  },
  {
    id: "dictation-bench-vocabulary-sources",
    kind: "unscoped",
    since: "2026-08-28",
    account: "openrouter",
    file: "evals/dictation/bench-vocabulary-sources.ts",
    job: "dictation",
    /* `chat` until 2026-09-07, when dictation moved from a chat completion on
       `google/gemini-3.1-flash-lite` to a transcription request on
       `openai/gpt-transcribe`. This file never chose a wire of its own — it
       calls `transcribeWith`, so it speaks whatever the production seam speaks,
       and the old value was simply the production wire of the day left behind.
       Same story as `dictation-gate-models` and `dictation-bench-models` below.
       docs/plans/260907c-dictation-onto-an-openai-transcriber.md. */
    wire: "transcription",
    metered: false,
    why: "Not a bypass at all — it calls `transcribeWith`, which goes through the seam and is metered. It simply never opens a collector, so every call warns \"no spend collector open\" and the row is dropped. One `withLedger(\"eval\", …)` fixes it, in a file another agent was actively writing on the day this was found.",
  },
  /* **The two halves of the 2026-09-03 model bake-off**, and the same story as
     `dictation-bench-vocabulary-sources` above: both call `transcribeWith`, so
     every call goes through the seam and is metered — they simply never open a
     collector, so each one warns "no spend collector open" and its row is
     dropped. The fix for all three is one `withLedger("eval", …)` each, and it
     is deliberately not being done here: the sibling's entry has said so since
     2026-08-28, and doing it for two files and not the third would leave the
     directory half-converted with nothing saying which half. Worth doing as one
     small job across the three, under the `eval` kind rather than `dictation`,
     so a few hundred eval calls do not land in the product's cost report. */
  {
    id: "dictation-gate-models",
    kind: "unscoped",
    since: "2026-09-03",
    account: "openrouter",
    file: "evals/dictation/gate-models.ts",
    job: "dictation",
    /* `chat` until 2026-09-07, when dictation moved endpoint. The file still
       probes chat/completions in its `diagnose` section — that is the permanent
       record of why `openai/gpt-audio` was unreachable — but the request it
       *gates* is the production one, and that is now a transcription. */
    wire: "transcription",
    metered: false,
    why: "Asks which candidate models can serve the production request at all, before the bake-off spends an hour finding out. Calls `transcribeWith`, so it is through the seam and metered; it opens no collector. Its `diagnose` half sends raw fetches the app never would, on purpose — that is where the answer to 'why not OpenAI on the chat endpoint?' comes from. docs/plans/260903i-which-model-transcribes-dictation.md and 260907c.",
  },
  {
    /* **The one file in this repo that spends on two accounts in one run, and
       the comparison is the whole point.**
       docs/plans/260907c-dictation-onto-an-openai-transcriber.md.

       Greg's brief expected dictation to need `OPENAI_API_KEY` directly,
       because OpenAI has no zero-data-retention endpoint on OpenRouter. This
       probe is what established that it does not need to: `openai/gpt-transcribe`
       reached through OpenRouter takes the same webm and the same `keywords`
       and produces the same transcript as OpenAI reached directly. **The app
       therefore stays wholly on OpenRouter and this remains the only file that
       touches the second account** — which is the reason it is worth keeping and
       worth declaring, rather than being deleted after one use.

       `account` names OpenAI because that is the notable half — a second
       billing account, outside the monthly cap on the OpenRouter one
       (docs/project/ai-gateway.md § What stops a reader spending our money).
       The same run also calls OpenRouter, and one row cannot say two accounts;
       it is a handful of cents either way and both are stated here.

       **The seam is wrong for it in the strongest sense: the seam is one of the
       two things being compared.** `openRouterTranscription` can only send to
       OpenRouter, so a probe asking whether the gateway forwards a parameter
       cannot ask it through the gateway. */
    id: "dictation-probe-stt-routes",
    kind: "bypass",
    since: "2026-09-07",
    account: "openai",
    file: "evals/dictation/probe-stt-routes.ts",
    job: "dictation",
    wire: "transcription",
    metered: false,
    why: "Compares OpenAI directly against OpenAI-through-OpenRouter on the transcription endpoint, which no seam can do because the seam is one of the two arms. It is what proved `keywords` is forwarded — read by the transcript changing, since OpenRouter drops unrecognised keys silently — and what proved `zdr` is ignored there, which is why /privacy no longer promises a reader their voice is unstored.",
  },
  {
    id: "dictation-bench-models",
    kind: "unscoped",
    since: "2026-09-03",
    account: "openrouter",
    file: "evals/dictation/bench-models.ts",
    job: "dictation",
    /* `chat` until 2026-09-07; dictation's production request is a
       transcription now, and this bench sends the production request. */
    wire: "transcription",
    metered: false,
    why: "The bake-off that kept `gemini-3.1-flash-lite`: holds the shipped vocabulary fixed and varies the model, through `transcribeWith`'s `model` option. Through the seam and metered, no collector opened. docs/plans/260903i-which-model-transcribes-dictation.md.",
  },
  {
    id: "dictation-bench-vocabulary",
    kind: "bypass",
    since: "2026-08-28",
    account: "openrouter",
    file: "evals/dictation/bench-vocabulary.mjs",
    job: "dictation",
    /* **`chat` is right here and is the only dictation row where it still is.**
       This file is a record of the route dictation used until 2026-09-07: a chat
       completion to a Gemini model with the vocabulary pasted into a system
       prompt. It measures that route, so it stays on that wire; it just no
       longer measures what dictation does. */
    wire: "chat",
    metered: false,
    why: "Ordinary chat/completions, from when dictation was one. It could have gone through `openRouterJson` until 2026-09-07 and now cannot — dictation left `ChatJob` when it moved to the transcription endpoint, so `openRouterJson(\"dictation\", …)` no longer compiles. It was left alone on 2026-08-28 because a successor (`bench-vocabulary-sources.ts`) was being written in the same directory and re-plumbing a file mid-rewrite loses somebody's work; it is left alone now because the route it measures is gone.",
  },
  {
    id: "hierarchy-structure-messages",
    kind: "bypass",
    since: "2026-08-30",
    account: "openrouter",
    file: "evals/hierarchy-structure/model-arms.ts",
    job: "eval",
    wire: "messages",
    metered: true,
    why: "The structure eval's arms vary model and effort per call, and `streamMessage` owns both on purpose — `modelFor(task)` is applied after the spread precisely so a stage cannot quietly switch models, and src/hierarchy.ts pins its effort. The prompt itself is shared (`structureRequest` in src/hierarchy.ts, parity-pinned by tests/hierarchy-structure-request-parity.test.ts); only the transport differs.",
  },
  {
    id: "hierarchy-structure-chat",
    kind: "bypass",
    since: "2026-08-30",
    account: "openrouter",
    file: "evals/hierarchy-structure/model-arms.ts",
    job: "eval",
    wire: "chat",
    metered: true,
    why: "The cheap arm's model (the quick tier) is served only on chat/completions, and the seam for that wire (`openRouterJson`) owns the per-job provider policy — this eval's arms deliberately differ from the app's policy and from each other, which is the same reason the PDF bake-off's OpenRouter arm is a declared bypass.",
  },
];

/**
 * **The spend a `Declaration` cannot describe** — and which `npm run cost` names
 * anyway, every run.
 *
 * `DECLARATIONS` above is a table about *this app's two seams*: every entry has
 * a `ProviderAccount` that bills it and a `Wire` it speaks, because every entry
 * is a call that could in principle have gone through one of them. The two
 * things below cannot be written down that way at all:
 *
 * - **A realtime session is not a request.** `ProviderAccount` and `Wire` do now
 *   hold `"openai"` and `"realtime"` — Stage 2A widened them — but a
 *   `Declaration` is spent through `declaredFetch`, which wraps a `fetch` and
 *   hands an `Observer` the response body. `evals/live/*.mts` opens a live
 *   session and talks over it; there is no response body anywhere in that, so
 *   there is nothing for the wrapper to wrap.
 * - `scripts/run-codex.ts` does not make an HTTP call at all. It spawns another
 *   vendor's CLI, on a third account, and there is no response body for an
 *   `Observer` to read.
 *
 * **Live conversation itself left this table on 2026-09-02**, and how it left is
 * the point: not by starting to use a seam, but because the browser now posts
 * what each turn cost to `/api/live/:sessionId/usage`, where the server prices
 * it and writes an ordinary `ai_calls` row — Stage 2B of
 * docs/plans/260902g-cost-tracking-that-can-set-a-price.md. The WebRTC
 * connection from the tab to OpenAI is unchanged and is still a sanctioned
 * provider bypass, named in the `ALLOWED` map of
 * tests/no-undeclared-spend.test.ts. Only the *accounting* moved. An entry here
 * is a claim that money leaves and **no row appears**, so keeping one for a
 * feature that now writes rows would make this register overclaim in the one
 * direction it exists to prevent.
 *
 * The point of the table is narrower and it is the whole of why it was added on
 * 2026-09-02: until then these files were named only in the `ALLOWED` map of
 * `tests/no-undeclared-spend.test.ts`, **which prints nothing**. A green test is
 * not a register. Somebody asking "what spends money here that I cannot see"
 * got a report that named the `metered: false` declarations and stopped, while
 * three files spent real money on two other accounts.
 *
 * A row here is a claim that money leaves and no `ai_calls` row appears. Adding
 * one is cheap and correct; leaving one out is how a report goes quietly
 * complete — docs/reusable/silent-success.md.
 */
export interface UnmeteredSpend {
  /** The file, as `npm run cost` prints it. */
  readonly file: string;
  /** Which account is billed, in prose — there is no type that fits these. */
  readonly account: string;
  /** What it buys, and roughly how much, in one line a person can act on. */
  readonly what: string;
  /** Why no `Declaration` can be written for it. Not "nobody got round to it". */
  readonly why: string;
  /** When this was written down, `YYYY-MM-DD`. Printed as an age, like a declaration's. */
  readonly since: string;
}

export const UNMETERED_SPEND: readonly UnmeteredSpend[] = [
  {
    file: "evals/live/hallucination-on-noise.mts, evals/live/jargon-recovery.mts",
    account: "OPENAI_API_KEY — a separate bill, and outside the OpenRouter spend cap",
    what: "The live-mode evals. Realtime sessions on gpt-realtime-2.1 plus transcription arms, and jargon-recovery also buys text-to-speech from /v1/audio/speech to say the test sentences. A few cents a run, on a key nothing else in this report can see.",
    why: "An eval opens its own realtime session and talks over it, with no server of ours in the middle and no browser to report from — so neither seam applies: declaredFetch wraps a fetch and reads a response body, and the acceptance endpoints that meter the app’s own live conversation (Stage 2B, 2026-09-02) are authenticated and expect a session this server journalled.",
    since: "2026-09-02",
  },
  {
    file: "scripts/run-codex.ts",
    account: "a ChatGPT subscription first, then CODEX_API_KEY on platform.openai.com — a third account again",
    what: "Every GPT Sol review this repo asks for. It is the most-used paid thing here that is not the app, and a long xhigh review is not free.",
    why: "It spawns `codex exec` as a subprocess rather than making a request, so there is no HTTP call to route through a seam and no response body to meter. The provider scan cannot see it either — it names neither a provider host nor one of the inference credentials — so before this entry it was in no list anywhere.",
    since: "2026-09-02",
  },
  {
    file: "scripts/run-claude.ts",
    account: "whichever credential the machine itself resolves (--auth machine, the default): a claude.ai login, an apiKeyHelper, or a cloud provider — Greg's Max subscription on the laptop, the box's separate one there. --auth env instead passes ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN, and refuses unless `claude auth status` confirms one of them is what will be billed. Each run prints what that probe said.",
    what: "A Claude subagent dispatched from outside a Claude session: a delegated implementation, or a second opinion with a clean context. An Opus run at --effort high is not free, and the CLI reports what it cost in the status line (total_cost_usd) even on a subscription.",
    why: "The same reason as run-codex.ts above — it spawns another vendor's CLI as a subprocess rather than making a request, so there is no HTTP call for declaredFetch to wrap and no response body to meter. It is in this table rather than only in the test's ALLOWED map because a green test is not a register.",
    since: "2026-09-06",
  },
];

export function declarationFor(id: string): Declaration {
  const found = DECLARATIONS.find((d) => d.id === id);
  if (!found) {
    throw new Error(
      `${id} is not a declared bypass. Add it to DECLARATIONS in evals/declared-spend.ts, with the reason the seam is wrong for it.`,
    );
  }
  if (!found.metered) {
    throw new Error(
      `${id} is declared as not metered, so it must not be used through this wrapper. Flip metered to true in the same change that wires it up.`,
    );
  }
  return found;
}

