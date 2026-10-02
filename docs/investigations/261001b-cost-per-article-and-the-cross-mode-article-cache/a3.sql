-- a3: cost per article, last 30 days: distribution
WITH c AS (
  SELECT article_id, (coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9 usd
  FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval'),
a AS (SELECT article_id, sum(usd) usd FROM c GROUP BY 1)
SELECT count(*) FILTER (WHERE article_id IS NOT NULL) arts,
  round(sum(usd) FILTER (WHERE article_id IS NULL)::numeric,2) unattributed_usd,
  round(sum(usd) FILTER (WHERE article_id IS NOT NULL)::numeric,2) attributed_usd,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY usd) FILTER (WHERE article_id IS NOT NULL))::numeric,3) p50,
  round((percentile_cont(0.75) WITHIN GROUP (ORDER BY usd) FILTER (WHERE article_id IS NOT NULL))::numeric,3) p75,
  round((percentile_cont(0.9) WITHIN GROUP (ORDER BY usd) FILTER (WHERE article_id IS NOT NULL))::numeric,3) p90,
  round((max(usd) FILTER (WHERE article_id IS NOT NULL))::numeric,3) mx,
  count(*) FILTER (WHERE article_id IS NOT NULL AND usd>=1) n_ge1,
  count(*) FILTER (WHERE article_id IS NOT NULL AND usd>=2) n_ge2
FROM a;
