# Prompt caching across every call: what is worth doing, and the one lever that is

**Status as of 2026-10-01:** researched, audited, reviewed by GPT Sol (round 1: *reframe*) and cut to
Stage 1, which is **built and reviewed**. Stage 2 is **dropped** — § What the review changed.

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

**The calls do cluster.** In the old high/`ids` cut, 43 of 103 calls (57% of those that follow a sibling on the same
article) land within 5 minutes and 18% of followers more within the hour; glossary+quotes, 55% and 20%. That was
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

## What the review changed

GPT Sol, plan review round 1 (2026-10-01, read-only, on f9736a1c): **reframe**, no P0/P1. Every
finding checked against the code; all six stand.

- **F1, the burst is two pairs, not six calls** (checked: `tests/auto-modes.test.tsx` pins the jobs as
  `tweets`, `glossary`, `quotes`, `ideas`, `quotes→ideas→trajectory`, `crossrefs`). Only
  tweets→ideas and glossary→quotes can share. At 10k tokens that is
  2 × (0.9 − 0.25) × 10k × $2/M ≈ **$0.026 an import**, about **$1 a month** at today's volume — not
  the $0.09–0.10 below, which counted the experimental modes the box never queues. And the audit's
  high/ids figure includes Simple's own historical fan-out, which 261001j has since fixed.
- **F2/F3, the cross-job design has no readiness signal.** A step persisted as `running` says nothing
  about whether the provider has begun the request; the cache-ready event (`message_start`) exists
  only in the leader's process. An election over active jobs also admits two leaders (an older job
  queued behind the cap) and misses a warm cache whose writer has already finished. And the manual
  provider `order` turns off OpenRouter's sticky routing, so even a correct wait is not a guaranteed
  hit. Doing it properly needs a durable "cache ready" record written at the model-call seam — real
  machinery for ~$1/month.
- **F4, Debate's three passes share no prefix** (direct, claims and synthesis passes each open
  differently; the audit grouped them by purpose only). Removed from the ranking.
- **F5, the eval must say what it checks.** Forcing `cacheArticle: true` tests the wire, not the job
  wiring that decides it; that needs its own deterministic test. And a cold-start marker must not be
  an eval-only edit to the request bytes.
- **F6, prose**: one percentage mixed denominators (43 of 103 calls is 42% of all; 57% of followers).

**Decision: Stage 2 is dropped**, including the simpler "post the pairs as two jobs" variant Sol
offered — it would hold Quotes behind Glossary and Ideas behind Tweets on every import (each pair's
second mode ready a minute or so later) to save about a dollar a month, which is the trade Greg's
"sparingly, and for good reason" rules out. **Revisit** when post-2026-09-30 production data, Simple
excluded, shows the import pairs are worth more than that — the audit's SQL re-runs as it stands.

## Plan

Stage 1 only, below. Stage 2 is kept as written for the record, under its heading, and is **not
being built**.

Two stages, as first written. Stage 1 is cheap and certain. Stage 2 is the one real lever, and it is complexity, so it
is spiked, measured, and put to the Overseer as a recommendation with numbers before it is built.

### Stage 1 — correct the record, measure the Messages wire, make the checklist ask

1. **prompt-caching.md**: fix the groups table (arc alone; tweets in the ids group); say plainly that
   article caching is effectively off in production and why; the floors (Sonnet 5 1,024; Opus 5.x
   512; Haiku 4.5 4,096); the 1h arithmetic above; the import burst, what it is worth (two pairs,
   ~$1/month) and why it is not coordinated;
   link the research doc and this plan; replace "no eval calls a pipeline stage" once item 2 lands.
2. **A Messages-wire eval, named as one** (Sol F5). `npm run eval:caching` reads `data/<slug>` from
   the filesystem, which no longer exists for real articles, and calls only chat-wire functions. Move
   its loading to the store (as `evals/simple/fanout-spike.ts` does) and add a Messages-wire arm: two
   **real stage functions of one cache group** (glossary then quotes, run one after the other, so no
   stagger is needed) on one article with `cacheArticle: true`, then a **negative control** — the
   same second stage with only its effort changed. Cold-start honesty without touching the request
   bytes: call 1 must *write* and read zero (if it reads, the run is reported "warm, inconclusive",
   never as a pass). Pass: call 2 reads ≈ call 1's write; the control reads 0. It checks the wire
   and the stages' byte layout; it says in its header that it does **not** check the job wiring.
   Results under `evals/results/`.
2b. **The job wiring gets its own deterministic test** (Sol F5): that the `StepContext` a real job
   builds (src/jobs.ts, where `cacheArticle` is set) carries `true` for both members of a same-group
   pair and `false` for a lone stage — through the code that builds it, not a hand-built context. If
   such a test already exists, cite it instead.
3. **new-mode.md**: a short "Its cache group" item — a new article-reading stage takes a row in
   `STAGE_EFFORT` and `ARTICLE_RENDERER` (the compiler already asks), and the choice of renderer and
   effort *is* the choice of which stages it shares an article with; say which group it joins, or
   that it is alone, in the comment on its row. Point at prompt-caching.md.
4. ~~Debate's claims pass~~ — dropped (Sol F4): its passes share no prefix. Its unexplained
   existing reads are noted in prompt-caching.md as an open question, not chased here.

Done when: docs corrected; the Messages-wire eval run once with a committed result (positive and
negative control both as predicted); `npm test`, `npm run typecheck` green.

### Stage 2 — the import burst (DROPPED after review; kept for the reasoning)

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

## What Stage 1 landed

- **prompt-caching.md**: groups table corrected (arc and crossrefs alone, tweets in the `ids` group);
  new § What production actually does — article caching is effectively off in production, why that
  is about right, the import burst and why it is not coordinated, the revisit trigger, Simple's
  `onStart` stagger as the pattern for a call site that fans out, Debate's unexplained reads as an
  open question; floors brought up to date; the 1h arithmetic against *not marking*; the eval
  paragraph rewritten for the new arm.
- **new-mode.md** § Its cost: an "Its cache group" item.
- **`npm run eval:caching -- <slug> [--wire=chat|messages|both]`**: loads from the store; the new
  Messages arm runs real `generateGlossary` → `generateQuotes` with the article marked, plus an
  effort-changed control. First run on noema-mythology-of-conscious-ai (~13k tokens): **PASS** —
  glossary wrote 16,192, quotes read 16,192, the control read 0; all served by Anthropic.
  Quotes cost $0.0697 reading against $0.1206 for the control writing.
- **The job wiring**: `tests/article-cache-call-site.test.ts` already walked real jobs through
  Postgres and read `ctx.cacheArticle`; it gained the glossary+quotes pair and a lone glossary, and
  was seen red both ways (wiring forced `false`: 2 fail; forced `true`: 3 fail) before restoring.
- Found on the way, left alone: the chat arm's hard-coded 2026-08-26 prices read ~26% under the
  ledger; it labels them estimates and the Messages arm uses the ledger.

**Code-review correction.** The first run above remains evidence and is kept as
`prompt-caching-noema-mythology-of-conscious-ai-2026-10-01.md`; it had replaced the August result at
the old stable path. Future runs are timestamped. The Messages arm now runs the alternate-effort
control first, so both cache keys establish a cold write before a PASS; a pre-warmed key is
inconclusive. It also refuses retries, incomplete ledger accounting and partial reads instead of
selecting the first row and accepting a 90–110% band. Its store input is the reader-facing article,
whose title override can differ from a pipeline draft's extracted metadata; the arm proves the two
stage functions' shared layout, not an exact replay of one production job.

## Spend

Research and audit: $0 (read-only). Stage 1's eval run: **$0.44** (Messages arm $0.283, chat arm
$0.160 by the ledger). The re-run after the code review: **$0.33** (Messages arm only, PASS under
the stricter verdict — two cold writes, then quotes read exactly glossary's 16,192;
`evals/results/prompt-caching-noema-mythology-of-conscious-ai-2026-10-01T13-11-22-229Z.md`).
Total: **$0.77** of the ≤ $15 budget. Stage 2's spike was never run.

## Code review

GPT Sol, round 1 on 63fb95c9, write-capable: **ship after my fixes**, no P0/P1, eight fixes (C1–C8)
all read and kept — exact read instead of a 10% band, every ledger row counted rather than the first,
the control moved first so both keys are shown cold, no hard-coded floor, results timestamped rather
than overwritten, and four doc corrections (Simple's own fan-out is the exception to "one call per
stage"; not every whole-article mode belongs in `ArticleStage`). Its eval changes were unreviewed
code by someone else, so they were checked by running them: the re-run above. The Postgres wiring
test, which its sandbox could not run, was run here: green. One round was enough; nothing open.
