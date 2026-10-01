-- a7: the same ceiling as a6, under four groupings, so the price of each constraint is visible.
--   all        every Claude call that sends the whole article shares one prefix (Greg's shape, perfect)
--   pipe_one   only the Messages-wire article stages (no request path), all at one effort
--   pipe_eff   the Messages-wire stages, one prefix PER EFFORT LEVEL as they run today:
--              high = arc tweets ideas sketch timeline quiz faq simple illustrated
--              medium = glossary quotes crossrefs citations; low = hierarchy
--   pipe_eff_nohier  pipe_eff without hierarchy (its renderer and version pin stay as they are)
--   now_groups  no effort or renderer change at all: high/ids = tweets ideas sketch timeline quiz faq
--              simple; medium/text = glossary quotes (arc, crossrefs, citations, hierarchy alone)
--   now_groups_ill  now_groups plus illustrated in high/ids (its fence moved after the article)
-- Same P and the same oracle premium as a6 (only a chain's head writes, and only when the next
-- call comes inside the TTL). Opus calls are in their own partition (a different model's cache).
WITH art AS (
  SELECT a.id article_id, sum(length(rb.text)) chars
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id=a.current_revision_id GROUP BY a.id),
c AS (
  SELECT x.article_id, x.purpose, x.requested_model, x.started_at, art.chars,
    CASE WHEN x.wire='messages' THEN coalesce(x.reported_input_tokens,0)+coalesce(x.cache_read_tokens,0)+coalesce(x.cache_write_tokens,0)
         ELSE coalesce(x.reported_input_tokens,0) END prompt_tok,
    coalesce(x.cache_read_tokens,0) rd,
    CASE WHEN x.requested_model LIKE '%opus%' THEN 5.0 ELSE 2.0 END/1e6 px,
    CASE WHEN x.purpose IN ('arc','tweets','ideas','sketch','timeline','quiz','faq','simple','illustrated') THEN 'high'
         WHEN x.purpose IN ('glossary','quotes','crossrefs','citations') THEN 'medium'
         WHEN x.purpose = 'hierarchy' THEN 'low'
         WHEN x.purpose IN ('chat','search','explain','referee-criteria','referee-claims','referee-candidates',
           'quiz-mark','citation-investigate') THEN 'request' END eff
  FROM spideryarn.ai_calls x JOIN art USING (article_id)
  WHERE x.started_at > now()-interval '30 days' AND x.scope_kind<>'eval' AND x.requested_model LIKE 'anthropic/%'),
d AS (SELECT *, least(prompt_tok, 0.35*chars) p, chars > 500000 AS outlier FROM c WHERE eff IS NOT NULL),
s AS (
  SELECT 'all' scen, 'all' k, * FROM d
  UNION ALL SELECT 'pipe_one', 'one', * FROM d WHERE eff <> 'request'
  UNION ALL SELECT 'pipe_eff', eff, * FROM d WHERE eff <> 'request'
  UNION ALL SELECT 'pipe_eff_nohier', eff, * FROM d WHERE eff NOT IN ('request','low')
  UNION ALL SELECT 'now_groups', CASE WHEN purpose IN ('glossary','quotes') THEN 'mt' ELSE 'hi' END, * FROM d
    WHERE purpose IN ('tweets','ideas','sketch','timeline','quiz','faq','simple','glossary','quotes')
  UNION ALL SELECT 'now_groups_ill', CASE WHEN purpose IN ('glossary','quotes') THEN 'mt' ELSE 'hi' END, * FROM d
    WHERE purpose IN ('tweets','ideas','sketch','timeline','quiz','faq','simple','glossary','quotes','illustrated')),
g AS (SELECT *,
  extract(epoch FROM started_at - lag(started_at) OVER w) gap_prev,
  extract(epoch FROM lead(started_at) OVER w - started_at) gap_next
  FROM s WINDOW w AS (PARTITION BY scen, k, article_id, requested_model ORDER BY started_at))
SELECT scen, outlier, count(*) calls,
  round(sum(CASE WHEN gap_prev<300 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric
      - sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=300) AND gap_next<300 THEN 0.25*p*px ELSE 0 END)::numeric,2) net_5m,
  round(sum(CASE WHEN gap_prev<3600 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric
      - sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=3600) AND gap_next<3600 THEN 1.0*p*px ELSE 0 END)::numeric,2) net_1h,
  round(sum(CASE WHEN gap_prev<10 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_concurrent_lt10s
FROM g GROUP BY 1,2 ORDER BY 2,1;
