-- a2: totals by model, last 30 days
WITH c AS (
  SELECT requested_model, wire, article_id,
    (coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9 usd,
    CASE WHEN wire='messages' THEN coalesce(reported_input_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_write_tokens,0)
         ELSE coalesce(reported_input_tokens,0) END prompt_tok,
    coalesce(output_tokens,0) out_tok
  FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval')
SELECT requested_model, count(*) calls, count(DISTINCT article_id) arts, round(sum(usd)::numeric,2) usd,
  sum(prompt_tok) prompt_tok, sum(out_tok) out_tok
FROM c GROUP BY 1 ORDER BY usd DESC;
