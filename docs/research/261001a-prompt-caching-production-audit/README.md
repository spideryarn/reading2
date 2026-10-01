# Prompt-caching audit: every AI call, its cache, and the money left on the table

2026-10-01. Worktree `prompt-caching-sweep`. Everything here was read-only:
- the code was read in this tree;
- production was read through `.env.prod`, with every query inside `BEGIN READ ONLY … ROLLBACK`. The runner is `runq.mjs` in this folder (psql is not installed on the box, so it uses node `pg` by absolute path). Every query is reproduced below as `q*.sql`.

## The headline, in plain words

- **The volume is small.** Production spent **$72.39 over the last 30 days**: 1,569 calls on 45 articles, and **one owner** (Greg). Every figure below is dollars per month at *that* volume. It scales with readers.
- **None of the pipeline's article stages has ever cached anything in production.** `cache_read_tokens` and `cache_write_tokens` are 0 on all 300+ calls from arc, tweets, glossary, quotes, ideas, sketch, timeline, quiz, faq, simple, citations, illustrated and hierarchy.
  - The cause is a design fact, not a bug. A stage marks the article only when another step of the **same job** is in its cache group (`cacheArticleForStep`, `src/pipeline.ts:393`). The UI posts **one job per mode** (`web/useStepJob.ts:567`), and so does the import tick-box (`web/auto-modes.ts:140`, which fires them together with `Promise.all`).
  - So `cacheArticle` is always false in practice.
- **Yet the calls do cluster.** Of 129 calls in the high/ids group, 49 (38%) start within 5 minutes of another call in the same group on the same article: 16 of them under 10 s, so concurrent, and 33 between 10 s and 5 min.
  - 38% is well above the 21.7% per-call warm-hit break-even that `prompt-caching.md` derives for "always mark".
  - Most of these pairs are in **different jobs**: 35 of 43 in an earlier cut.
- **The realistic win is about $2.5/month on a 5-minute TTL**, rising to about **$5/month with a 1-hour TTL**. That is 3–7% of spend. The ceiling, if every article stage shared one prefix, is about $6–9/month, but that needs one effort setting and one renderer for all of them, which is a quality trade-off.

## Part A: the call sites (code)

The census was done by a subagent and spot-checked by me: the renderer table, chat's last round, and debate's claims pass, against `models.ts:1766-1803`, `converse.ts:1896` and `debate.ts:1873`.

How to read the table:
- **gated** means the explicit breakpoint is added only when `opts.cacheArticle` is true.
- **expl** means there is always an explicit breakpoint.
- Nowhere uses the top-level automatic mode.

| purpose | file:fn | wire / effort / renderer | layout and breakpoint | fan-out | in production |
|---|---|---|---|---|---|
| arc | arc.ts:368 | msgs / high / text | system[article **gated**, SYSTEM] + user | 1 | 0 cache. **Alone in its group**; see the doc error below |
| tweets | tweets.ts:641 | msgs / high / **ids** (since 89702083, 2026-09-29) | same | 1 | 0 cache |
| glossary, quotes | glossary.ts:1456, quotes.ts:1687 | msgs / medium / text | same | 1 each | 0 cache |
| ideas, sketch, timeline, faq | ideas.ts:933, sketch.ts:540, timeline.ts:1255, faq.ts:630 | msgs / high / ids | same (sketch has `systemOverride`) | 1 each | 0 cache |
| quiz | quiz.ts:1058 | msgs / high / ids | same, plus an optional reader-rules block after SYSTEM | 1 | 0 cache |
| crossrefs | crossrefs.ts:476 | msgs / **medium** / ids | same | 1 | alone in its group |
| simple (**out of scope**; another session owns it) | simple-summary.ts:692 | msgs / high / ids | article marked whenever it is over the floor, without the `cacheArticle` gate (`:647-655`) | 3 levels: the first alone, the other two on its `onStart` (the stagger that just landed) | 0 cache on the 17 calls so far: 2–3 calls per job, all concurrent, all before the stagger |
| citations | citations.ts:1779 | msgs / own effort / ids | system[article gated, refList?, SYSTEM] | 1 | gate always false (not an `ArticleStage`) |
| illustrated | illustrated.ts:1038 | msgs / none / ids wrapped in `=== ARTICLE ===` | system[article gated, SYSTEM] | 1, then image calls (`illustrate`) | gate always false; the wrapper means it can never share with sketch |
| trajectory | trajectory.ts:1054 | msgs / no article | system + user | 1 | nothing to cache |
| hierarchy | hierarchy.ts:2510 | msgs / `renderBlocks` | system + user(whole article), **no breakpoint** by design | 1 | 0 cache. Single use; 2 re-runs within an hour in 30 days |
| (hierarchy deepen) | hierarchy-expand.ts:667 | msgs | user[outline **expl**, own] | parallel wave, no warm-up (documented) | off by default |
| labels | labels.ts:1910 | msgs / low / outline | system + user[outline **expl**, batch] | parallel batches; warm-up when over the floor | working: 75 of 148 calls read, average read 1.6k tokens |
| explain | explain.ts:415 | chat / ids | tools[web_search] → system → user[article **expl**, position…] | 1 | 5 calls, 5 writes, 0 reads: one per article |
| search | search.ts:252 | chat / ids | system → user[article **expl**, query] | 1 | 12 of 14 writes never read |
| chat | converse.ts:1205 | chat / ids | tools[web_search + CHAT_TOOLS] → system → user[article **expl**] → history → final user | tool loop of up to 3+1 rounds; **the last round drops CHAT_TOOLS** (`:1896`), which changes position 0 | 42% of calls read; uncached input only 18k tokens in 30 days. Orphaned writes: 14 of 23 |
| referee-criteria | referee-criteria-run.ts:375 | chat / medium / ids, anonymous head | tools (literature only) → system varies by `config.kind` → user[article **expl**, criterion] | 1 per criterion, started by hand | 9 writes, 6 never read |
| referee-claims, -candidates | referee-claims-run.ts:341, converse.ts | chat | article **expl** | 1 / tool loop | all writes, no reads |
| debate | debate.ts:1566 / :1873 | chat | claims pass: **article inside the system string, no `cache_control`** (ai-call.ts:525); plus web_search | 3 sequential passes | reads 652k and writes 409k anyway, so something upstream caches; **not explained**. 488k uncached input arrived within 5 min of a sibling |
| quiz-mark, citation-investigate | quiz-mark.ts:415, citation-investigate.ts:459 | chat / ids | article **expl** | 1 | single use |
| pdf | pdf-read.ts:858 | chat / gpt-5.6-luna | system (about 2.9k chars) → user[per-chunk instruction, chunk file] + json_schema; no `cache_control` | per 6-page chunk, in parallel (PQueue) | OpenAI's automatic caching shows reads of 1.1M and writes of 3.1M (not billed). The shared prefix is probably under OpenAI's 1,024-token floor. Nothing to gain |
| pdf-frontmatter, pdf-figure-locate, link-summary, shelf-topics, dictation, embeddings, citations-find, upload-source-guess | various | chat etc. | no article prefix, or tiny | — | negligible |
| live_conversation | live.ts:351 | realtime | instructions = LIVE_SYSTEM → **profile** → article (automatic caching) | — | profile before article means a per-reader prefix; $0.75 in 30 days |

**A doc error found on the way.** `docs/project/prompt-caching.md` (the "Where the caches are" table, and the effort section) says `arc`+`tweets` share a cache. They have not since tweets switched to `ids` on 2026-09-29. The groups today, read off `STAGE_EFFORT` × `ARTICLE_RENDERER`:

| effort / renderer | stages |
|---|---|
| high/text | arc alone |
| high/ids | tweets, ideas, sketch, timeline, quiz, faq, simple |
| medium/text | glossary, quotes |
| medium/ids | crossrefs alone |

## Part B: production, last 30 days

### Spend and cache use by purpose (measured, q1)

| purpose | wire | calls | $ | cache-read tok | cache-write tok | % calls reading | % calls writing |
|---|---|---:|---:|---:|---:|---:|---:|
| hierarchy | msgs | 38 | 8.25 | 0 | 0 | 0 | 0 |
| sketch | msgs | 24 | 6.77 | 0 | 0 | 0 | 0 |
| labels | msgs | 146 | 5.35 | 121k | 88k | 51 | 46 |
| ideas | msgs | 28 | 5.29 | 0 | 0 | 0 | 0 |
| illustrated | msgs | 15 | 5.08 | 0 | 0 | 0 | 0 |
| glossary | msgs | 37 | 4.61 | 0 | 0 | 0 | 0 |
| pdf (Luna) | chat | 549 | 3.89 | 1.12M | 3.07M | 25 | 74 |
| chat | chat | 43 | 3.73 | 1.86M | 1.13M | 42 | 53 |
| debate | chat | 28 | 3.72 | 584k | 363k | 57 | 57 |
| quotes | msgs | 36 | 3.28 | 0 | 0 | 0 | 0 |
| arc | msgs | 38 | 2.83 | 0 | 0 | 0 | 0 |
| timeline | msgs | 15 | 2.22 | 0 | 0 | 0 | 0 |
| tweets | msgs | 18 | 1.85 | 0 | 0 | 0 | 0 |
| referee-criteria | chat | 10 | 1.54 | 23k | 504k | 10 | 90 |
| explain | chat | 5 | 1.21 | 0 | 467k | 0 | 100 |
| search | chat | 18 | 1.19 | 128k | 393k | 22 | 78 |

Opus 5.5 (high-powered) rows are small (about $3.5 in all) and omitted here; they are in the q1 output. Savings already being collected (q3, `realised` = 0.9 × read tokens × input price):

| purpose | $ saved |
|---|---:|
| chat | 3.35 |
| debate | 1.36 |
| search | 0.23 |
| labels | 0.22 |

### When the calls in one cache group arrive (measured, q2)

Each figure is a gap since the previous call in the same group on the same article, on the same model (Sonnet).

| group | calls | first in group | <10 s (concurrent) | 10 s–5 min | 5–60 min | 1–24 h | >24 h |
|---|---:|---:|---:|---:|---:|---:|---:|
| ideas, sketch, timeline, quiz, faq, simple (old cut, without tweets) | 103 | 27 | 11 | 32 | 14 | 12 | 7 |
| glossary + quotes | 73 | 29 | 2 | 22 | 9 | 5 | 6 |
| arc + tweets (old cut) | 56 | 37 | 1 | 4 | 7 | 4 | 3 |
| chat | 43 | 13 | 6 | 10 | 7 | 5 | 2 |
| debate | 28 | 10 | 5 | 9 | 1 | 2 | 1 |
| labels | 146 | 32 | 92 | 21 | 0 | 0 | 1 |
| pdf (Luna) | 549 | 25 | 472 | 48 | 2 | 0 | 2 |
| hierarchy | 38 | 35 | 0 | 0 | 2 | 0 | 1 |

What the gaps say:
- **High/ids:** 41% of calls that have a predecessor land within 5 minutes, and 18% more land in the next 55 minutes.
- **Glossary + quotes:** 55% within 5 minutes and 20% in 5–60 minutes.
- **So a 1-hour TTL pays** for the glossary/quotes group and modestly for high/ids. It does not pay for chat or search.

Per job (q6), every article stage makes exactly **one call per job**. Within an hour, 59 article-hours saw more than one stage run, 4.3 stages on average and 12 at most.

### Money left on the table, net, ranked (estimated, q4b / q7)

**Assumptions.**
- P, the reusable prefix, is the article alone: `sum(length(block text))/4 + 8 tokens per block` on the current revision, capped at the call's prompt size. System and instruction tokens are not counted, so this is conservative.
- Prices are Sonnet 5 at $2/MTok input, and Opus 5.5 assumed $5.
- The multipliers are read 0.1×, 5-minute write 1.25×, 1-hour write 2×.
- A call that could read saves 0.9·P.
- **oracle** means only the head of a chain whose next call comes inside the TTL writes (+0.25·P, or +1.0·P on a 1-hour TTL). **always** means every call that cannot read writes.
- Concurrent followers are assumed staggered.
- 30 days ≈ one month.

| rank | cache group / leak | $/mo net, 5 min, oracle | 5 min, always mark | **1 h, oracle** | 1 h, always | measured or estimated |
|---:|---|---:|---:|---:|---:|---|
| — | *ceiling: every Sonnet Messages article stage in one prefix* | *5.90* | *4.52* | *8.74* | *7.94* | *estimated; needs one effort and one renderer* |
| 1 | high/ids (tweets, ideas, sketch, timeline, quiz, faq, simple) | **1.84** | 1.06 | **2.62** | 2.15 | gaps measured, P estimated |
| 2 | glossary + quotes (medium/text) | 0.60 | −0.18 | **2.18** | 1.41 | gaps measured, P estimated |
| 3 | debate (no breakpoint; uncached input within 5 min of a sibling) | ≤0.88 gross | — | — | — | uncached tokens measured; net unknown, since something upstream already caches part of it |
| 4 | orphaned writes on the request path (chat 0.27, explain 0.23, referee-criteria 0.22, search 0.16, others 0.15) | 1.03 paid for nothing | — | — | — | measured. Mostly inherent single use, not recoverable |
| 5 | hierarchy (re-runs) | 0 | −0.69 | 0.44 | −0.71 | estimated |
| 6 | arc alone | 0.07 | −0.36 | 0.07 | −1.64 | estimated: do not mark |
| 7 | referee-criteria (system varies per kind, before the article) | 0.06 | −0.10 | 0.02 | −0.60 | estimated |
| 8 | pdf-frontmatter | 0.05 | 0.01 | −0.01 | −0.17 | estimated |
| 9 | labels (wasted parallel writes, prefix about 1.3k) | ≈0.1 | — | — | — | measured: 68 writers over 35 jobs |
| 10 | chat (history), search, explain, pdf, live | ≈0 | — | — | — | measured |

The rate behind "always mark" is the **per-call warm-hit rate** (break-even 21.7%):

| group | warm-hit rate | against 21.7% |
|---|---:|---|
| high/ids | about 38% | above, so always-mark pays |
| glossary + quotes | about 33% (25 of 75) | above on paper, but its 5-minute net is still negative, because many of its hits fall in 5–60 minutes rather than under 5 |
| arc | about 15% | below; do not mark |

**Going forward this undercounts.** The import tick-box shipped 2026-09-30 (`web/auto-modes.ts`). It now fires glossary, quotes, ideas, tweets and crossrefs **together on every import**: glossary with quotes (one group), tweets with ideas (another). With stagger and marking, that is 2 × (0.9 − 0.25) × P ≈ **$0.09 an import**, or about $3.5/month at the 38 imports/month seen. That is close to everything in rows 1–2 at 5 minutes, and it would be collected reliably rather than opportunistically.

## Top opportunities

1. **Mark and stagger the import burst. About $3.5/month at current imports; reliable.**
   - When a job starts on an article, `cacheArticle` should also consider *other queued or running jobs on that article* (the article line in `jobs.ts`), not only `job.steps`.
   - When several same-group jobs start together, start one, and release the rest on its first streamed byte. This is the `MeteredCall.onStart` pattern simple-summary just adopted.
   - Code: `cacheArticleForStep` takes the article's live job steps; the job runner (or `queueAutoModes`) holds same-group siblings until the first one streams.
2. **Always mark the high/ids group, even across jobs. +$1.1–1.8/month.** Its measured warm-hit rate (38%) is above the 21.7% break-even, so even the dumb policy pays. Code: a per-group "always" flag in `sharesArticleCache`, or the oracle in #1.
3. **A 1-hour TTL for glossary + quotes and high/ids. +$1.5–2/month over the 5-minute figure.**
   - The 5–60 minute bucket holds 20% of glossary/quotes follow-ups. That is the reader opening Quotes a quarter of an hour after Glossary.
   - Code: `cache_control: {type:"ephemeral", ttl:"1h"}` on those stages' article block. This needs to be checked through OpenRouter's Skin; `cache_write_1h_tokens` exists in the ledger, so it would be measurable.
   - It contradicts the doc's "1h deliberately not used", which was argued for the request path, not for these groups.
4. **Debate's claims pass: put an explicit breakpoint on the article. ≤$0.9/month gross.**
   - The article is already first in the system string. Split it into a system block with `cache_control`.
   - First explain the reads it already gets (584k tokens) with no breakpoint: not verified.
5. **Fix the doc (`prompt-caching.md`), and decide crossrefs.**
   - The arc+tweets row is stale.
   - crossrefs (medium/ids) sits alone. At `medium` with `text`, or with glossary and quotes moved to `ids`, it would join glossary+quotes in the import burst: +1 read, about $0.06 an import, about $2/month. That is a renderer or effort change, so it is a quality decision for Greg, not a free one.
6. **Chat's last round drops CHAT_TOOLS, so the prefix changes at position 0** (`converse.ts:1896`).
   - The measured cost is small: chat's uncached input is 18k tokens a month, and 14 of 23 writes were orphaned, about $0.27/month.
   - Keeping the tool list constant and refusing tool calls in the last round some other way would remove a write per long turn.
   - Low priority.

**Not worth doing:**
- marking arc, hierarchy or referee-criteria;
- anything on pdf (Luna, prefix under the floor);
- labels;
- a 1-hour TTL on chat or search.

**Uncertainty.**
- The gaps, calls and spend are measured.
- P is an estimate from current revision text. It can be off ±30%; it is likely an underestimate, since instructions inside the prefix are not counted.
- The "oracle" policy assumes foresight that #1 only approximates.
- Tweets' group membership changed mid-window.
- One owner and 45 articles is a thin sample: treat every row below $0.5 as noise.

## The SQL (re-runnable: `node scratchpad/runq.mjs qN.sql`, wrapped in BEGIN READ ONLY … ROLLBACK)

Cost expression throughout: `coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0)` (schema.ts says this sum is correct). Prompt size: Messages wire = `reported_input + cache_read + cache_write` (additive); chat wire = `reported_input` (inclusive).

```sql
-- q1: per purpose x wire x model
SELECT purpose, wire, requested_model, count(*) AS calls,
  round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9::numeric, 3) AS usd,
  sum(reported_input_tokens) rep_in, sum(output_tokens) out_tok, sum(cache_read_tokens) c_read, sum(cache_write_tokens) c_write,
  round(avg((coalesce(cache_read_tokens,0)>0)::int)::numeric,2) frac_read,
  round(avg((coalesce(cache_write_tokens,0)>0)::int)::numeric,2) frac_write, count(DISTINCT article_id) articles
FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' AND scope_kind <> 'eval'
GROUP BY 1,2,3 ORDER BY usd DESC;

-- q2: gap histogram per cache group
WITH c AS (
  SELECT article_id, purpose, requested_model, started_at, job_id,
    CASE WHEN purpose IN ('arc','tweets') THEN 'arc+tweets' WHEN purpose IN ('glossary','quotes') THEN 'glossary+quotes'
         WHEN purpose IN ('ideas','sketch','timeline','quiz','faq','simple') THEN 'ids-high' ELSE purpose END grp
  FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval'
    AND article_id IS NOT NULL AND wire IN ('messages','chat')
), g AS (SELECT *, extract(epoch FROM started_at - lag(started_at) OVER w) gap_s, lag(job_id) OVER w prev_job
  FROM c WINDOW w AS (PARTITION BY article_id, grp, requested_model ORDER BY started_at))
SELECT grp, requested_model, count(*) calls, sum((gap_s IS NULL)::int) first_in_grp, sum((gap_s<10)::int) lt10s,
  sum((gap_s>=10 AND gap_s<300)::int) s10_5m, sum((gap_s>=300 AND gap_s<3600)::int) m5_60,
  sum((gap_s>=3600 AND gap_s<86400)::int) h1_24, sum((gap_s>=86400)::int) gt24h,
  sum((gap_s<300 AND job_id IS DISTINCT FROM prev_job)::int) lt5m_other_job
FROM g GROUP BY 1,2;

-- q4b: net money left on the table (groups corrected: arc alone; tweets in ids-high)
WITH art AS (
  SELECT a.id article_id, sum(length(rb.text))/4.0 + 8*count(*) art_tok
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id = a.current_revision_id GROUP BY a.id
), c AS (
  SELECT x.article_id, x.purpose, x.requested_model, x.started_at,
    CASE WHEN x.wire='messages' THEN coalesce(x.reported_input_tokens,0)+coalesce(x.cache_read_tokens,0)+coalesce(x.cache_write_tokens,0)
         ELSE coalesce(x.reported_input_tokens,0) END prompt_tok,
    coalesce(x.cache_read_tokens,0) rd, coalesce(x.cache_write_tokens,0) wr,
    CASE WHEN x.purpose='arc' THEN 'arc' WHEN x.purpose IN ('glossary','quotes') THEN 'glossary+quotes'
         WHEN x.purpose IN ('tweets','ideas','sketch','timeline','quiz','faq','simple') THEN 'ids-high' ELSE x.purpose END grp,
    CASE WHEN x.wire='messages' AND x.purpose IN ('arc','tweets','glossary','quotes','ideas','sketch','timeline','quiz','faq',
         'simple','crossrefs','citations','trajectory','illustrated') THEN 'ALL' END grp_all,
    CASE WHEN x.requested_model LIKE '%opus%' THEN 5.0 ELSE 2.0 END/1e6 px, art.art_tok
  FROM spideryarn.ai_calls x JOIN art ON art.article_id = x.article_id
  WHERE x.started_at > now()-interval '30 days' AND x.scope_kind<>'eval' AND x.wire IN ('messages','chat')
    AND x.requested_model LIKE 'anthropic/%' AND x.purpose<>'labels'
), u AS (SELECT grp k, * FROM c UNION ALL SELECT grp_all k, * FROM c WHERE grp_all IS NOT NULL),
g AS (SELECT *, least(art_tok, prompt_tok) p,
  extract(epoch FROM started_at - lag(started_at) OVER w) gap_prev, extract(epoch FROM lead(started_at) OVER w - started_at) gap_next
  FROM u WINDOW w AS (PARTITION BY article_id, k, requested_model ORDER BY started_at))
SELECT k, count(*) calls,
  round(sum(CASE WHEN gap_prev<300 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_5m,
  round(sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=300) AND gap_next<300 THEN 0.25*p*px ELSE 0 END)::numeric,2) prem_oracle_5m,
  round(sum(CASE WHEN gap_prev IS NULL OR gap_prev>=300 THEN 0.25*p*px ELSE 0 END)::numeric,2) prem_always_5m,
  round(sum(CASE WHEN gap_prev<3600 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_1h,
  round(sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=3600) AND gap_next<3600 THEN 1.0*p*px ELSE 0 END)::numeric,2) prem_oracle_1h,
  round(sum(CASE WHEN gap_prev IS NULL OR gap_prev>=3600 THEN 1.0*p*px ELSE 0 END)::numeric,2) prem_always_1h
FROM g GROUP BY 1 ORDER BY 3 DESC;
-- net = gross - prem
```

The supporting queries are in `scratchpad/`:
- `q3.sql`: the 5-minute, stagger and 1-hour gross split, plus the realised savings;
- `q5.sql`: orphaned writes, meaning a write with no read of the same purpose on the article within 5 minutes;
- `q6.sql`: calls per job and the burst counts;
- `q7.sql`: uncached request-path input within 5 minutes.

Up: [research.md](../../project/research.md) · the plan this fed: [261001l](../../plans/261001l-prompt-caching-across-every-call.md)
