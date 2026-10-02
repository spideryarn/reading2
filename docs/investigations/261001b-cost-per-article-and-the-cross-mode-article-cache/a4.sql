-- a4: per article: cost, calls, tokens, article size (current revision) and its five costliest purposes
WITH art AS (
  SELECT a.id article_id, sum(length(rb.text)) chars, count(*) blocks
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id=a.current_revision_id GROUP BY a.id),
c AS (
  SELECT article_id, purpose, (coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9 usd,
    CASE WHEN wire='messages' THEN coalesce(reported_input_tokens,0)+coalesce(cache_read_tokens,0)+coalesce(cache_write_tokens,0)
         ELSE coalesce(reported_input_tokens,0) END prompt_tok, coalesce(output_tokens,0) out_tok
  FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' AND scope_kind<>'eval' AND article_id IS NOT NULL),
p AS (SELECT article_id, purpose, sum(usd) usd, count(*) n FROM c GROUP BY 1,2),
top AS (SELECT article_id, string_agg(purpose||'×'||n||' '||round(usd::numeric,2), ', ' ORDER BY usd DESC) tops FROM
   (SELECT *, row_number() OVER (PARTITION BY article_id ORDER BY usd DESC) rn FROM p) z WHERE rn<=6 GROUP BY 1)
SELECT round(sum(c.usd)::numeric,2) usd, count(*) calls, sum(prompt_tok) prompt_tok, sum(out_tok) out_tok, max(art.chars) chars,
  max(art.blocks) blocks, max(top.tops) top6
FROM c LEFT JOIN art USING (article_id) LEFT JOIN top USING (article_id)
GROUP BY c.article_id ORDER BY usd DESC;
