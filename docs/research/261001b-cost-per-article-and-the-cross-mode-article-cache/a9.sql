-- a9: a7 redone after GPT Sol's plan review (docs/plans/261001o-cross-mode-cache-plan-review-sol.md, F1/F2/F6).
--  * 'always' charges the write premium on EVERY cold call in a group — what option B's
--    "claim, mark, write" actually does — not only on a chain head whose follower is known to come
--    (the oracle a7 used).
--  * Simple is left out: it already marks and staggers its own three calls (261001j), so its
--    historical fan-out is not a saving B would add.
--  * Citations is left out of every pipeline group: it sends every block, apparatus included
--    (src/citations.ts), so it shares no prefix with the body-only stages.
--  * pipe_one_nohier added: one effort, one renderer, Hierarchy left on its own format.
--  * P at 0.30 / 0.35 / 0.40 tokens per character, for a sensitivity range.
WITH art AS (
  SELECT a.id article_id, sum(length(rb.text)) chars
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id=a.current_revision_id GROUP BY a.id),
c AS (
  SELECT x.article_id, x.purpose, x.requested_model, x.started_at, art.chars,
    CASE WHEN x.wire='messages' THEN coalesce(x.reported_input_tokens,0)+coalesce(x.cache_read_tokens,0)+coalesce(x.cache_write_tokens,0)
         ELSE coalesce(x.reported_input_tokens,0) END prompt_tok,
    coalesce(x.cache_read_tokens,0) rd,
    CASE WHEN x.requested_model LIKE '%opus%' THEN 5.0 ELSE 2.0 END/1e6 px,
    CASE WHEN x.purpose IN ('arc','tweets','ideas','sketch','timeline','quiz','faq','illustrated') THEN 'high'
         WHEN x.purpose IN ('glossary','quotes','crossrefs') THEN 'medium'
         WHEN x.purpose = 'hierarchy' THEN 'low'
         WHEN x.purpose IN ('chat','search','explain','referee-criteria','referee-claims','referee-candidates',
           'quiz-mark','citation-investigate','citations','simple') THEN 'other' END eff
  FROM spideryarn.ai_calls x JOIN art USING (article_id)
  WHERE x.started_at > now()-interval '30 days' AND x.scope_kind<>'eval' AND x.requested_model LIKE 'anthropic/%'),
f AS (SELECT 0.30 tpc UNION ALL SELECT 0.35 UNION ALL SELECT 0.40),
d AS (SELECT c.*, f.tpc, least(prompt_tok, f.tpc*chars) p, chars > 500000 AS outlier
      FROM c CROSS JOIN f WHERE eff IS NOT NULL),
s AS (
  SELECT 'all' scen, 'all' k, * FROM d
  UNION ALL SELECT 'pipe_one', 'one', * FROM d WHERE eff <> 'other'
  UNION ALL SELECT 'pipe_one_nohier', 'one', * FROM d WHERE eff IN ('high','medium')
  UNION ALL SELECT 'pipe_eff', eff, * FROM d WHERE eff IN ('high','medium')
  UNION ALL SELECT 'now_groups_ill', CASE WHEN purpose IN ('glossary','quotes') THEN 'mt' ELSE 'hi' END, * FROM d
    WHERE purpose IN ('tweets','ideas','sketch','timeline','quiz','faq','glossary','quotes','illustrated')
  UNION ALL SELECT 'now_groups', CASE WHEN purpose IN ('glossary','quotes') THEN 'mt' ELSE 'hi' END, * FROM d
    WHERE purpose IN ('tweets','ideas','sketch','timeline','quiz','faq','glossary','quotes')),
g AS (SELECT *,
  extract(epoch FROM started_at - lag(started_at) OVER w) gap_prev,
  extract(epoch FROM lead(started_at) OVER w - started_at) gap_next
  FROM s WINDOW w AS (PARTITION BY tpc, scen, k, article_id, requested_model ORDER BY started_at)),
r AS (SELECT scen, outlier, tpc,
  sum(CASE WHEN gap_prev<300 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END) gross_5m,
  sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=300) AND gap_next<300 THEN 0.25*p*px ELSE 0 END) prem_oracle_5m,
  sum(CASE WHEN gap_prev IS NULL OR gap_prev>=300 THEN 0.25*p*px ELSE 0 END) prem_always_5m,
  sum(CASE WHEN gap_prev<3600 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END) gross_1h,
  sum(CASE WHEN gap_prev IS NULL OR gap_prev>=3600 THEN 1.0*p*px ELSE 0 END) prem_always_1h
  FROM g GROUP BY 1,2,3)
SELECT scen, outlier, tpc,
  round((gross_5m-prem_oracle_5m)::numeric,2) net_5m_oracle,
  round((gross_5m-prem_always_5m)::numeric,2) net_5m_always,
  round((gross_1h-prem_always_1h)::numeric,2) net_1h_always
FROM r ORDER BY outlier, tpc, scen;
