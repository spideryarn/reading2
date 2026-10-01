-- a5: how much of each purpose's prompt is the article. Regress prompt tokens on the article's
-- characters (current revision), per purpose, Claude calls only. The slope is tokens per article
-- character (≈0.25–0.35 if the whole article is sent once); the intercept is the fixed
-- instructions; r2 says whether the article really drives the prompt size.
WITH art AS (
  SELECT a.id article_id, sum(length(rb.text)) chars, count(*) blocks
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id=a.current_revision_id GROUP BY a.id),
c AS (
  SELECT x.purpose, x.wire, art.chars, art.blocks,
    CASE WHEN x.wire='messages' THEN coalesce(x.reported_input_tokens,0)+coalesce(x.cache_read_tokens,0)+coalesce(x.cache_write_tokens,0)
         ELSE coalesce(x.reported_input_tokens,0) END prompt_tok,
    coalesce(x.output_tokens,0) out_tok,
    (coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9 usd
  FROM spideryarn.ai_calls x JOIN art USING (article_id)
  WHERE x.started_at > now()-interval '30 days' AND x.scope_kind<>'eval' AND x.requested_model LIKE '%claude%')
SELECT purpose, wire, count(*) n, round(sum(usd)::numeric,2) usd,
  round(regr_slope(prompt_tok, chars)::numeric,3) tok_per_char, round(regr_intercept(prompt_tok, chars)) fixed_tok,
  round(regr_r2(prompt_tok, chars)::numeric,2) r2,
  round(avg(prompt_tok)) avg_prompt, round(avg(chars)/4) avg_chars_div4, round(avg(out_tok)) avg_out
FROM c GROUP BY 1,2 HAVING count(*)>=3 ORDER BY usd DESC;
