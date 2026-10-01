-- Q7: request-path calls (chat wire): input paid at full price beyond the cached article, and how much of it
-- arrived within 5 min of the previous call of the same purpose on the same article (so a moving breakpoint
-- on the history could have read most of it). Chat-wire reported_input is inclusive of cache read+write.
WITH c AS (
  SELECT purpose, article_id, started_at, reported_input_tokens p, coalesce(cache_read_tokens,0) rd, coalesce(cache_write_tokens,0) wr,
    extract(epoch FROM started_at - lag(started_at) OVER (PARTITION BY article_id, purpose ORDER BY started_at)) gap
  FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval' AND wire='chat'
    AND requested_model='anthropic/claude-sonnet-5'
)
SELECT purpose, count(*) calls, sum(p-rd-wr) uncached_in, sum(CASE WHEN gap<300 THEN p-rd-wr ELSE 0 END) uncached_in_lt5m,
  round(sum(CASE WHEN gap<300 THEN (p-rd-wr) ELSE 0 END)*0.9*2/1e6::numeric,2) usd_if_read
FROM c GROUP BY 1 ORDER BY 5 DESC;
