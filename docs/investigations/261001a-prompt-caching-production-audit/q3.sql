-- Q3: money left on the table, per cache group, last 30 days.
-- P (the reusable prefix) = the article's own size: sum(length(block text))/4 + 8 tokens per block for ids,
--   from the article's current revision, capped at the call's whole prompt. System prompt and
--   stage instructions are NOT counted (conservative: they may or may not sit inside the shared prefix).
-- Input price per MTok: Sonnet 5 = $2.00, Opus 5.5 assumed $5.00 (pricing.ts has opus-5 at $5).
-- Read = 0.1x, 5m write = 1.25x (premium 0.25x), 1h write = 2x (premium 1.0x).
WITH art AS (
  SELECT a.id AS article_id, sum(length(rb.text))/4.0 + 8*count(*) AS art_tok
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id = a.current_revision_id
  GROUP BY a.id
), c AS (
  SELECT x.article_id, x.purpose, x.wire, x.requested_model, x.started_at, x.job_id,
    CASE WHEN x.wire='messages' THEN coalesce(x.reported_input_tokens,0)+coalesce(x.cache_read_tokens,0)+coalesce(x.cache_write_tokens,0)
         ELSE coalesce(x.reported_input_tokens,0) END AS prompt_tok,
    coalesce(x.cache_read_tokens,0) AS rd, coalesce(x.cache_write_tokens,0) AS wr,
    CASE WHEN x.purpose IN ('arc','tweets') THEN 'G:text-high(arc,tweets)'
         WHEN x.purpose IN ('glossary','quotes') THEN 'G:text-medium(glossary,quotes)'
         WHEN x.purpose IN ('ideas','sketch','timeline','quiz','faq','simple') THEN 'G:ids-high(ideas..simple)'
         ELSE x.purpose END AS grp,
    CASE WHEN x.requested_model LIKE '%opus%' THEN 5.0 ELSE 2.0 END / 1e6 AS px,
    art.art_tok
  FROM spideryarn.ai_calls x JOIN art ON art.article_id = x.article_id
  WHERE x.started_at > now()-interval '30 days' AND x.scope_kind<>'eval'
    AND x.wire IN ('messages','chat') AND x.requested_model LIKE 'anthropic/%'
), g AS (
  SELECT *, least(art_tok, prompt_tok) AS p,
    extract(epoch FROM started_at - lag(started_at) OVER w) AS gap_s
  FROM c WINDOW w AS (PARTITION BY article_id, grp, requested_model ORDER BY started_at)
)
SELECT grp,
  count(*) calls,
  round(avg(p)) avg_p,
  round(avg(art_tok)) avg_art,
  round(avg(prompt_tok)) avg_prompt,
  sum((gap_s >= 10 AND gap_s < 300)::int) n_5m,
  sum((gap_s < 10)::int) n_conc,
  sum((gap_s >= 300 AND gap_s < 3600)::int) n_1h,
  -- already collected: what reads saved vs paying fresh
  round(sum(0.9*rd*px)::numeric,2) realised,
  -- gross saving still available inside 5 min (non-concurrent), net of reads already made on those calls
  round(sum(CASE WHEN gap_s>=10 AND gap_s<300 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_5m,
  -- concurrent calls (<10 s): available only if the fan-out is staggered
  round(sum(CASE WHEN gap_s<10 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_stagger,
  -- extra if the TTL were 1h (calls 5-60 min after the previous one)
  round(sum(CASE WHEN gap_s>=300 AND gap_s<3600 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_1h_extra,
  -- write premium if every call in the group marked the article (5m): every call that cannot read writes
  round(sum(CASE WHEN gap_s IS NULL OR gap_s>=300 THEN 0.25*p*px ELSE 0 END)::numeric,2) prem_5m_always,
  -- write premium already being paid now (writes that were never followed by a read are in here too)
  round(sum(0.25*wr*px)::numeric,2) prem_paid_now,
  -- premium if 1h TTL and always marked
  round(sum(CASE WHEN gap_s IS NULL OR gap_s>=3600 THEN 1.0*p*px ELSE 0 END)::numeric,2) prem_1h_always
FROM g GROUP BY 1 ORDER BY 10 DESC;
