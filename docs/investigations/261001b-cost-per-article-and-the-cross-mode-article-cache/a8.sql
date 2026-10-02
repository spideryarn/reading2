-- a8: the other half of the bill. Claude output split into thinking (reasoning_tokens) and the
-- visible answer, per purpose, at list price ($10/MTok Sonnet, $25 Opus), with the one
-- book-length article apart. Check first that reasoning never exceeds output (it is a subset).
WITH art AS (
  SELECT a.id article_id, sum(length(rb.text)) chars
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id=a.current_revision_id GROUP BY a.id),
c AS (
  SELECT x.purpose, coalesce(art.chars,0) > 500000 outlier,
    coalesce(x.output_tokens,0) out_tok, coalesce(x.reasoning_tokens,0) reas,
    CASE WHEN x.requested_model LIKE '%opus%' THEN 25.0 ELSE 10.0 END/1e6 opx
  FROM spideryarn.ai_calls x LEFT JOIN art USING (article_id)
  WHERE x.started_at > now()-interval '30 days' AND x.scope_kind<>'eval' AND x.requested_model LIKE 'anthropic/%')
SELECT purpose, count(*) calls, sum((reas>out_tok)::int) reas_gt_out,
  round(sum(reas*opx) FILTER (WHERE NOT outlier)::numeric,2) thinking_usd,
  round(sum((out_tok-reas)*opx) FILTER (WHERE NOT outlier)::numeric,2) answer_usd,
  round(sum(out_tok*opx) FILTER (WHERE outlier)::numeric,2) outlier_output_usd
FROM c GROUP BY ROLLUP(1) ORDER BY thinking_usd DESC NULLS LAST;
