-- Q2: inter-call gaps within a cache group, per article, last 30 days (product spend only).
-- cache group = what could share one prefix today (same article, same model, same group of stages).
WITH c AS (
  SELECT id, article_id, purpose, wire, requested_model, started_at, finished_at, job_id,
    CASE WHEN wire='messages' THEN coalesce(reported_input_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_write_tokens,0)
         ELSE coalesce(reported_input_tokens,0) END AS prompt_tok,
    coalesce(cache_read_tokens,0) AS rd, coalesce(cache_write_tokens,0) AS wr,
    CASE WHEN purpose IN ('arc','tweets') THEN 'G:text-high(arc,tweets)'
         WHEN purpose IN ('glossary','quotes') THEN 'G:text-medium(glossary,quotes)'
         WHEN purpose IN ('ideas','sketch','timeline','quiz','faq','simple') THEN 'G:ids-high(ideas,sketch,timeline,quiz,faq,simple)'
         ELSE purpose END AS grp,
    (coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9 AS usd
  FROM spideryarn.ai_calls
  WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval' AND article_id IS NOT NULL
    AND wire IN ('messages','chat')
), g AS (
  SELECT *, extract(epoch FROM started_at - lag(started_at) OVER w) AS gap_s,
            lag(job_id) OVER w AS prev_job
  FROM c WINDOW w AS (PARTITION BY article_id, grp, requested_model ORDER BY started_at)
)
SELECT grp, requested_model, count(*) calls, count(DISTINCT article_id) arts,
  sum((gap_s IS NULL)::int) first_in_grp,
  sum((gap_s < 10)::int) lt10s_concurrent,
  sum((gap_s >= 10 AND gap_s < 300)::int) s10_5m,
  sum((gap_s >= 300 AND gap_s < 3600)::int) m5_60,
  sum((gap_s >= 3600 AND gap_s < 86400)::int) h1_24,
  sum((gap_s >= 86400)::int) gt24h,
  sum((gap_s < 300 AND job_id IS DISTINCT FROM prev_job)::int) lt5m_other_job,
  round(avg(prompt_tok)) avg_prompt,
  round(sum(usd)::numeric,2) usd
FROM g GROUP BY 1,2 ORDER BY usd DESC;
