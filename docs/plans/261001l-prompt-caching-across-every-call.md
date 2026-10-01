# Prompt caching across every call: what is worth doing, and the one lever that is

**Status as of 2026-10-01:** researched and audited; plan written, awaiting review. Nothing built.

Part of [prompt-caching.md](../project/prompt-caching.md). From Greg, via the Overseer:

> delegate an agent to do some Sonnet web research on prompt caching best practices, then look for
> ways we could restructure prompts and/or improve the way we're calling the AI to make much more
> effective use of prompt caching across the board. Run spikes, perhaps even create an eval,
> measure, get input/review from GPT Sol, update @docs/project/new-mode.md etc, follow & update
> @docs/project/prompt-caching.md etc.
>
> — Greg, 2026-10-01

And the constraint the Overseer passed on, from Greg's reservations about caching the same day: use
it sparingly and for good reason, and do not add complexity for small savings.

The research is [261001a](../research/261001a-prompt-caching-best-practice-2026.md). The audit (call
site census, production `ai_calls` over 30 days, read-only, SQL included) is summarised below; its
numbers are the basis of every ranking here — the full audit is
[261001a-prompt-caching-production-audit](../research/261001a-prompt-caching-production-audit/README.md).

## What the audit found

**The money is small.** Production spent **$72.39 in 30 days** — 1,569 calls, 45 articles, one owner.
The realistic saving from better caching is **about $2.5–5 a month, 3–7% of spend**. It scales with
readers, but today the argument for any change has to survive being worth a few dollars.

**The pipeline's article stages have never cached anything in production** — arc, tweets, glossary,
quotes, ideas, sketch, timeline, quiz, faq: zero reads and zero writes on 300+ calls. Not a bug: a
stage marks the article only when another step of the **same job** shares its group
(`cacheArticleForStep`), and the client posts one job per mode. So the rule that keeps us from
paying the 1.25× write for nothing has also, in practice, switched article caching off.

**The calls do cluster.** In the high/`ids` group, 41% of calls that follow a sibling on the same
article land within 5 minutes and 18% more within the hour; glossary+quotes, 55% and 20%. That was
measured mostly *before* two changes that make clustering much tighter:

- 2026-09-29: mode jobs on one article **run in parallel** (`mayOverlap`, src/sharing-steps.ts).
- 2026-09-30: the add page's tick box queues **every main mode at once** after an import
  (src/web/auto-modes.ts § `queueAutoModes`).

So the commonest shape from now on is an **import burst**: seven or eight article-reading calls on
one article, started within a second of each other, none marked. Marking them without staggering
would be *worse* than today — each pays the write, none reads (measured on Simple in
[261001j](261001j-simple-press-cost-and-latency.md): $0.172 marked-together against $0.142 unmarked).

**The cache groups today** (read off `STAGE_EFFORT` × `ARTICLE_RENDERER`; the doc is wrong about the
first row — tweets left arc's group when it moved to `ids` on 2026-09-29):

| effort / renderer | stages |
|---|---|
| high / text | arc, alone |
| high / ids | tweets, ideas, sketch, timeline, quiz, faq, simple |
| medium / text | glossary, quotes |
| medium / ids | crossrefs, alone |

**Request path** (search, chat, explain, referee): working as designed. About $1/month of writes
nobody reads, mostly inherent single use.

**Ranked, $/month net, estimated** (the article size at 4 characters a token; ±30%):

| # | lever | 5 min | 1 h |
|---|---|---:|---:|
| 1 | high/ids group, leader-then-followers across jobs | 1.8 | 2.6 |
| 2 | glossary + quotes, same | 0.6 | 2.2 |
| 3 | debate: an explicit breakpoint on the claims pass | ≤0.9 gross | — |
| 4 | everything else (arc, hierarchy, referee, labels, pdf, live) | ≈0 or negative | |

These are from a window before the import burst existed. The burst alone is worth about **$0.09–0.10
an import** on a ~10k-token article (six followers reading at 0.1× rather than paying 1.0×, less
one 0.25× write premium), so its monthly value is that times imports with the box ticked.

## The 1-hour TTL arithmetic, said carefully

The research doc's summary says 1h "beats 5m even for a single reuse". True against a *5-minute
marker*; false against **not marking**, which is the real alternative. Per article prefix, in units
of its uncached price: one write plus *n* reads costs 2.0 + 0.1n at 1h, against 1 + n unmarked. That
breaks even at **n ≈ 1.1**, so 1h needs **two or more** later reads inside the hour to pay. 5m needs
one (1.25 + 0.1n vs 1 + n, n ≈ 0.28). The 1h case is only worth having where the audit's 5–60-minute
tail is two-plus reads deep — glossary+quotes, at most. **Not in this plan** (see § Not doing).

## Plan

Two stages. Stage 1 is cheap and certain. Stage 2 is the one real lever, and it is complexity, so it
is spiked, measured, and put to the Overseer as a recommendation with numbers before it is built.

### Stage 1 — correct the record, measure the Messages wire, make the checklist ask

1. **prompt-caching.md**: fix the groups table (arc alone; tweets in the ids group); say plainly that
   article caching is effectively off in production and why; the floors (Sonnet 5 1,024; Opus 5.x
   512; Haiku 4.5 4,096); the 1h arithmetic above; the import burst as the shape that matters now;
   link the research doc and this plan; replace "no eval calls a pipeline stage" once item 2 lands.
2. **The eval covers the Messages wire.** `npm run eval:caching` today reads `data/<slug>` — a
   filesystem article dir from before the store moved to Postgres — and calls only chat-wire
   functions. Extend it (or add a sibling) to run **two stages of one cache group on one article
   through the real `runStep`-equivalent path with `cacheArticle: true`**, staggered on `onStart`,
   with a unique per-run marker at the front so a warm cache from an earlier run cannot fake a read
   (the `evals/simple/fanout-spike.ts --cold` lesson). Pass: the second call's
   `cache_read_input_tokens` ≈ the first's write. Also a negative control: same pair, effort
   differing → the read is zero. Results under `evals/results/`.
3. **new-mode.md**: a short "Its cache group" item — a new article-reading stage takes a row in
   `STAGE_EFFORT` and `ARTICLE_RENDERER` (the compiler already asks), and the choice of renderer and
   effort *is* the choice of which stages it shares an article with; say which group it joins, or
   that it is alone, in the comment on its row. Point at prompt-caching.md.
4. **Debate's claims pass** (item 3 above) only if a read of `debate.ts` shows the article prefix is
   byte-identical between its passes and the change is a few lines (move the article into its own
   `cache_control` part ahead of `CLAIMS_SYSTEM`). Otherwise listed, not done.

Done when: docs corrected; the Messages-wire eval run once with a committed result (positive and
negative control both as predicted); `npm test`, `npm run typecheck` green.

### Stage 2 — the import burst: spike, then recommend, then (if yes) build

**Spike** (budget ≤ $6): on two real articles, run the high/ids group's stages (6 calls) twice each,
cold: (a) all together, unmarked — today; (b) the first alone, marked, the rest started once its
stream has begun, all marked. Measure cost and time-to-all-done. This is 261001j's measurement for
a different fan-out, and the arithmetic predicts (b) ≈ 0.35–0.45× of (a)'s input cost and a few
seconds more wall time for the followers.

**The design, if built** — *leader and followers across jobs*, because the burst is several jobs,
possibly several processes, and `onStart` is in-process:

- An article stage, at the moment it is about to call the model, asks the store which **other active
  jobs on this article** contain a step of its cache group (`sharesArticleCache` against their
  steps, so the grouping stays one table).
- None → today's behaviour exactly: `cacheArticleForStep` on its own job.
- Some → it marks the article. If an **older** such job (by `(created_at, id)`, the order `claim`
  already uses) is the leader and is running that step, it waits until the leader's step has been
  running ≥ T seconds (T ≈ 8, from 261001j's 3–7 s `message_start`) or the leader has ended, capped
  at W ≈ 20 s; then calls. The leader does not wait.
- What a wrong guess costs is bounded: one 0.25× write premium, or a follower that waited W for
  nothing. No reader-visible output changes.

**Why it is a product call**: followers in a burst finish a few seconds later, and a mode the reader
opens *during* a burst may be a follower. And it is real complexity — a store query and a bounded
wait inside `runStep` — for roughly $0.10 an import. So after the spike, **the Overseer gets a
recommendation with the measured numbers** and Stage 2's build waits on its answer.

The simpler options it passed over:

- **Always mark every article stage** (the way it was before `24335207`). Under the burst this is
  the measured-worst arm: everyone writes, nobody reads.
- **One job per cache group** for the burst, so `cacheArticleForStep` works unchanged. It serialises
  six modes behind one another, undoing 260929c's parallelism, which Greg asked for.
- **Stagger in the browser**: post the leader's job, wait, post the rest. Same effect with no server
  change, but the server still marks nothing (each job is alone), and a closed tab loses the rest —
  the reason the add page fires together (Sol P4 on 260930).

## Not doing, and why

- **1h TTL anywhere.** Needs two-plus reads in the hour to beat not marking; the only group that
  might qualify is glossary+quotes at ≈$1.6/month over 5m, estimated, on one owner's data. Revisit
  when the readership is ten times this.
- **Aligning efforts or renderers to merge groups** (e.g. crossrefs into another group, arc to
  `ids`). Quality calls already measured once against it (evals/results/effort-vs-quality.md); about
  $2/month at most. Not worth reopening.
- **Arc, hierarchy, referee-criteria, labels, pdf, live, chat history**: ≈0 or negative in the audit.
- **`src/simple-summary.ts`**: owned by build-simple-fidelity-guard, already staggered (261001j).
  Stage 2 must not double-handle Simple: Simple's own three calls already lead/follow internally;
  in a burst, Simple counts as one group member like any other stage.

## Spend

Research and audit: $0 (read-only). Budget for this plan: ≤ $15 total, tracked here per stage.
