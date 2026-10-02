-- a6: the ceiling for Greg's shape — ONE article prefix shared by every Claude call that sends the
-- whole article — at three cache lifetimes, plus the plain split of Claude spend into
-- article-input, other-input and output.
--
-- P (the article's tokens in one call) = least(prompt tokens, 0.35 × article chars). 0.35 is the
-- slope a5 measures on the stages whose prompt is article-plus-fixed-instructions (hierarchy,
-- arc, tweets, quiz, faq, explain, search, referee-criteria: r2 ≥ 0.97, slope 0.33–0.36).
-- The audit's chars/4 + 8/block is ~25–30% low.
--
-- Group: every purpose that sends the full article. Debate is left out (a5: r2 0.04, the
-- article is one pass of three). Labels, pdf, trajectory, pdf-frontmatter send no article.
-- 'single' = the article is excluded if it is the one 1M-character outlier, reported apart.
WITH art AS (
  SELECT a.id article_id, sum(length(rb.text)) chars
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id=a.current_revision_id GROUP BY a.id),
c AS (
  SELECT x.article_id, x.purpose, x.requested_model, x.started_at, art.chars,
    CASE WHEN x.wire='messages' THEN coalesce(x.reported_input_tokens,0)+coalesce(x.cache_read_tokens,0)+coalesce(x.cache_write_tokens,0)
         ELSE coalesce(x.reported_input_tokens,0) END prompt_tok,
    coalesce(x.output_tokens,0) out_tok, coalesce(x.cache_read_tokens,0) rd,
    (coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9 usd,
    CASE WHEN x.requested_model LIKE '%opus%' THEN 5.0 ELSE 2.0 END/1e6 px,
    x.purpose IN ('arc','tweets','glossary','quotes','ideas','sketch','timeline','quiz','faq','crossrefs','simple',
      'citations','illustrated','hierarchy','chat','search','explain','referee-criteria','referee-claims',
      'referee-candidates','quiz-mark','citation-investigate') AS sends_article
  FROM spideryarn.ai_calls x LEFT JOIN art USING (article_id)
  WHERE x.started_at > now()-interval '30 days' AND x.scope_kind<>'eval' AND x.requested_model LIKE 'anthropic/%'),
d AS (SELECT *, CASE WHEN sends_article AND chars IS NOT NULL THEN least(prompt_tok, 0.35*chars) ELSE 0 END p,
        coalesce(chars,0) > 500000 AS outlier FROM c),
g AS (SELECT *,
  extract(epoch FROM started_at - lag(started_at) OVER w) gap_prev,
  extract(epoch FROM lead(started_at) OVER w - started_at) gap_next
  FROM d WHERE p > 0 WINDOW w AS (PARTITION BY article_id, requested_model ORDER BY started_at)),
split AS (
  SELECT outlier, round(sum(usd)::numeric,2) claude_usd,
    round(sum(p*px)::numeric,2) article_input_usd_list,
    round(sum((prompt_tok-p)*px)::numeric,2) other_input_usd_list,
    round(sum(out_tok*px*5)::numeric,2) output_usd_list
  FROM d GROUP BY 1),
ceil AS (
  SELECT outlier, count(*) article_calls, count(DISTINCT article_id) arts,
    round(sum(CASE WHEN gap_prev<300 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_5m,
    round(sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=300) AND gap_next<300 THEN 0.25*p*px ELSE 0 END)::numeric,2) prem_5m,
    round(sum(CASE WHEN gap_prev<3600 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_1h,
    round(sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=3600) AND gap_next<3600 THEN 1.0*p*px ELSE 0 END)::numeric,2) prem_1h,
    round(sum(CASE WHEN gap_prev IS NOT NULL THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_forever,
    round(sum(CASE WHEN gap_prev IS NULL THEN 1.0*p*px ELSE 0 END)::numeric,2) prem_forever
  FROM g GROUP BY 1)
SELECT * FROM split JOIN ceil USING (outlier);
