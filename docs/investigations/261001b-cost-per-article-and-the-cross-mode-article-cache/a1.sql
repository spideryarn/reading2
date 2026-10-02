-- a1: per purpose x model, last 30 days: where the money goes, prompt vs output tokens
WITH c AS (
  SELECT purpose, wire, requested_model, article_id,
    (coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9 usd,
    CASE WHEN wire='messages' THEN coalesce(reported_input_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_write_tokens,0)
         ELSE coalesce(reported_input_tokens,0) END prompt_tok,
    coalesce(output_tokens,0) out_tok, coalesce(reasoning_tokens,0) reas_tok,
    coalesce(cache_read_tokens,0) cr, coalesce(cache_write_tokens,0) cw
  FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval')
SELECT purpose, wire, requested_model, count(*) calls, count(DISTINCT article_id) arts,
  round(sum(usd)::numeric,2) usd, sum(prompt_tok) prompt_tok, sum(out_tok) out_tok, sum(reas_tok) reas_tok,
  sum(cr) cr, sum(cw) cw, round(avg(prompt_tok)) avg_prompt, round(avg(out_tok)) avg_out
FROM c GROUP BY 1,2,3 ORDER BY usd DESC;
