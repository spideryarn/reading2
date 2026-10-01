-- Q6: shape of pdf (Luna) runs and the after-import burst: per job, call count, spread, read/write.
SELECT purpose, count(DISTINCT job_id) jobs, round(avg(n)) avg_calls_per_job, max(n) max_calls,
  round(avg(spread_s)) avg_spread_s, round(avg(avg_prompt)) avg_prompt, round(avg(avg_rd)) avg_read, round(avg(avg_wr)) avg_write
FROM (
  SELECT purpose, job_id, count(*) n, extract(epoch FROM max(started_at)-min(started_at)) spread_s,
    avg(reported_input_tokens) avg_prompt, avg(coalesce(cache_read_tokens,0)) avg_rd, avg(coalesce(cache_write_tokens,0)) avg_wr
  FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' AND scope_kind='job_step'
  GROUP BY 1,2) j
GROUP BY 1 ORDER BY 2 DESC;
-- How many distinct mode stages start on one article within 5 minutes (the after-import burst)?
WITH s AS (
  SELECT article_id, purpose, min(started_at) t FROM spideryarn.ai_calls
  WHERE started_at > now()-interval '30 days' AND scope_kind='job_step' AND wire='messages'
    AND purpose IN ('arc','tweets','glossary','quotes','ideas','sketch','timeline','quiz','faq','simple','crossrefs','citations','trajectory','illustrated','hierarchy')
  GROUP BY 1,2, date_trunc('hour', started_at)
)
SELECT a.article_id IS NOT NULL ok, count(*) bursts, round(avg(k),1) avg_stages, max(k) max_stages FROM (
  SELECT article_id, date_trunc('hour', t) h, count(*) k FROM s GROUP BY 1,2 HAVING count(*)>1) a GROUP BY 1;
