-- Q1: per purpose x wire x model, last 30 days
SELECT purpose, wire, requested_model,
  count(*) AS calls,
  round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9::numeric, 3) AS usd,
  sum(reported_input_tokens) AS rep_in,
  sum(output_tokens) AS out_tok,
  sum(cache_read_tokens) AS c_read,
  sum(cache_write_tokens) AS c_write,
  sum(cache_write_1h_tokens) AS c_write_1h,
  round(avg((coalesce(cache_read_tokens,0)>0)::int)::numeric,2) AS frac_read,
  round(avg((coalesce(cache_write_tokens,0)>0)::int)::numeric,2) AS frac_write,
  count(DISTINCT article_id) AS articles,
  sum((outcome<>'ok')::int) AS not_ok
FROM spideryarn.ai_calls
WHERE started_at > now()-interval '30 days' AND scope_kind <> 'eval'
GROUP BY 1,2,3 ORDER BY usd DESC;
SELECT scope_kind, count(*), round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9::numeric,3) usd FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' GROUP BY 1;
SELECT outcome, cost_source, count(*) FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC;
SELECT date_trunc('week', started_at)::date wk, count(*), round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9::numeric,2) usd, count(DISTINCT owner_id) owners FROM spideryarn.ai_calls GROUP BY 1 ORDER BY 1;
