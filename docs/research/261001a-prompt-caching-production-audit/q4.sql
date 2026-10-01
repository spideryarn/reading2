-- Q4: NET money left on the table per group, under two marking policies, last 30 days.
--  "oracle": a call marks the article only when the next same-group call on this article arrives inside the TTL
--            (what a cross-job-aware cacheArticle could approximate: "another stage of this group is queued/running").
--  "always": every call in the group marks the article.
-- Concurrent (<10 s) followers are assumed staggered (i.e. they can read). Same P, prices and multipliers as Q3.
-- Groups: 'grp' = today's cache-compatible groups; 'grp_all' = ceiling if every Sonnet Messages-wire article
-- stage shared one prefix (needs one effort + one renderer: NOT free, a quality trade-off).
WITH art AS (
  SELECT a.id AS article_id, sum(length(rb.text))/4.0 + 8*count(*) AS art_tok
  FROM spideryarn.articles a JOIN spideryarn.revision_blocks rb ON rb.revision_id = a.current_revision_id
  GROUP BY a.id
), c AS (
  SELECT x.article_id, x.purpose, x.wire, x.requested_model, x.started_at,
    CASE WHEN x.wire='messages' THEN coalesce(x.reported_input_tokens,0)+coalesce(x.cache_read_tokens,0)+coalesce(x.cache_write_tokens,0)
         ELSE coalesce(x.reported_input_tokens,0) END AS prompt_tok,
    coalesce(x.cache_read_tokens,0) AS rd, coalesce(x.cache_write_tokens,0) AS wr,
    CASE WHEN x.purpose IN ('arc','tweets') THEN 'G:text-high(arc,tweets)'
         WHEN x.purpose IN ('glossary','quotes') THEN 'G:text-medium(glossary,quotes)'
         WHEN x.purpose IN ('ideas','sketch','timeline','quiz','faq','simple') THEN 'G:ids-high(ideas..simple)'
         ELSE x.purpose END AS grp,
    CASE WHEN x.wire='messages' AND x.purpose IN ('arc','tweets','glossary','quotes','ideas','sketch','timeline','quiz','faq','simple','crossrefs','citations','trajectory','illustrated')
         THEN 'ALL-messages-article-stages' ELSE NULL END AS grp_all,
    CASE WHEN x.requested_model LIKE '%opus%' THEN 5.0 ELSE 2.0 END / 1e6 AS px,
    art.art_tok
  FROM spideryarn.ai_calls x JOIN art ON art.article_id = x.article_id
  WHERE x.started_at > now()-interval '30 days' AND x.scope_kind<>'eval'
    AND x.wire IN ('messages','chat') AND x.requested_model LIKE 'anthropic/%' AND x.purpose <> 'labels'
), u AS (
  SELECT grp AS k, * FROM c UNION ALL SELECT grp_all AS k, * FROM c WHERE grp_all IS NOT NULL
), g AS (
  SELECT *, least(art_tok, prompt_tok) AS p,
    extract(epoch FROM started_at - lag(started_at) OVER w) AS gap_prev,
    extract(epoch FROM lead(started_at) OVER w - started_at) AS gap_next
  FROM u WINDOW w AS (PARTITION BY article_id, k, requested_model ORDER BY started_at)
)
SELECT k AS cache_group, count(*) calls,
  round(sum(CASE WHEN gap_prev<300 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_5m,
  round(sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=300) AND gap_next<300 THEN 0.25*p*px ELSE 0 END)::numeric,2) prem_oracle_5m,
  round(sum(CASE WHEN gap_prev IS NULL OR gap_prev>=300 THEN 0.25*p*px ELSE 0 END)::numeric,2) prem_always_5m,
  round(sum(CASE WHEN gap_prev<3600 THEN greatest(0.9*(p-rd)*px,0) ELSE 0 END)::numeric,2) gross_1h,
  round(sum(CASE WHEN (gap_prev IS NULL OR gap_prev>=3600) AND gap_next<3600 THEN 1.0*p*px ELSE 0 END)::numeric,2) prem_oracle_1h,
  round(sum(CASE WHEN gap_prev IS NULL OR gap_prev>=3600 THEN 1.0*p*px ELSE 0 END)::numeric,2) prem_always_1h,
  round(sum(0.25*wr*px)::numeric,2) prem_paid_now
FROM g GROUP BY 1 ORDER BY 3 DESC;

-- Labels on its own: its shareable prefix is system + outline, not the article. Measured from its own writes.
SELECT count(*) calls, count(*) FILTER (WHERE cache_write_tokens>0) writers, count(*) FILTER (WHERE cache_read_tokens>0) readers,
  round(avg(cache_write_tokens) FILTER (WHERE cache_write_tokens>0)) avg_write,
  round(avg(cache_read_tokens) FILTER (WHERE cache_read_tokens>0)) avg_read,
  count(DISTINCT job_id) jobs
FROM spideryarn.ai_calls WHERE purpose='labels' AND started_at > now()-interval '30 days' AND scope_kind<>'eval';
