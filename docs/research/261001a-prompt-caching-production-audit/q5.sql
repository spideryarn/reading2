-- Q5: writes that nobody read. A "writer" is a call with cache_write_tokens > 0; it is "orphaned" when no later
-- call in the same (article, purpose, model) reads anything within 5 minutes of it. Premium wasted = 0.25x of
-- the written tokens at the input price (Sonnet $2/MTok; Luna rows excluded from $ because OpenAI does not
-- bill writes).
WITH c AS (
  SELECT article_id, purpose, requested_model, wire, started_at,
    coalesce(cache_read_tokens,0) rd, coalesce(cache_write_tokens,0) wr,
    CASE WHEN requested_model LIKE '%opus%' THEN 5.0 WHEN requested_model LIKE 'anthropic/%' THEN 2.0 ELSE 0 END/1e6 px
  FROM spideryarn.ai_calls
  WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval' AND wire IN ('messages','chat')
)
SELECT w.purpose, w.requested_model, count(*) writers,
  sum((NOT EXISTS (SELECT 1 FROM c r WHERE r.article_id IS NOT DISTINCT FROM w.article_id AND r.purpose=w.purpose
        AND r.requested_model=w.requested_model AND r.rd>0 AND r.started_at > w.started_at
        AND r.started_at <= w.started_at + interval '5 minutes'))::int) orphaned,
  round(sum(CASE WHEN NOT EXISTS (SELECT 1 FROM c r WHERE r.article_id IS NOT DISTINCT FROM w.article_id AND r.purpose=w.purpose
        AND r.requested_model=w.requested_model AND r.rd>0 AND r.started_at > w.started_at
        AND r.started_at <= w.started_at + interval '5 minutes') THEN 0.25*w.wr*w.px ELSE 0 END)::numeric,3) usd_wasted_premium
FROM c w WHERE w.wr>0 GROUP BY 1,2 ORDER BY 5 DESC;

SELECT count(DISTINCT owner_id) owners_30d, count(DISTINCT article_id) articles_30d FROM spideryarn.ai_calls
WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval';
