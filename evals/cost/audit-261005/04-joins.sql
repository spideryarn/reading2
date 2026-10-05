-- step runs vs ledger, old step names mapped (hierarchy->structure, trajectory->skim); labels once ran inside the hierarchy step
with runs as (
  select distinct v.article_id, r.step_name, r.started_at, r.finished_at
    from spideryarn.revision_step_runs r join spideryarn.article_revisions v on v.id = r.revision_id
   where r.status = 'done' and r.step_name not in ('fetch','blocks')
), j as (
  select runs.*, exists (
    select 1 from spideryarn.ai_calls c
     where (c.article_id = runs.article_id or (c.article_id is null and c.article_slug = (select slug from spideryarn.articles a where a.id = runs.article_id)))
       and (case c.step_name when 'hierarchy' then 'structure' when 'trajectory' then 'skim' else c.step_name end = runs.step_name
            or (runs.step_name = 'labels' and c.purpose = 'labels'))
       and c.started_at between runs.started_at - interval '15 seconds' and runs.finished_at + interval '15 seconds') has_row
    from runs)
select step_name, count(*) runs, count(*) filter (where has_row) with_ledger, count(*) filter (where not has_row) no_row,
       min(started_at) filter (where not has_row) first_without, max(started_at) filter (where not has_row) last_without,
       count(*) filter (where not has_row and started_at >= '2026-08-30') without_since_ledger
  from j group by 1 order by 1;
-- the model-step runs with no ledger row since the ledger existed: which, when, how long
with runs as (
  select distinct v.article_id, r.step_name, r.started_at, r.finished_at, r.model
    from spideryarn.revision_step_runs r join spideryarn.article_revisions v on v.id = r.revision_id
   where r.status = 'done' and r.step_name not in ('fetch','blocks','assets','extract')
)
select left(runs.article_id::text,8) article, runs.step_name, runs.model, runs.started_at, round(extract(epoch from runs.finished_at - runs.started_at)::numeric,1) secs,
       (select count(*) from spideryarn.ai_calls c where c.article_id = runs.article_id) article_ledger_rows
  from runs
 where runs.started_at >= '2026-08-30'
   and not exists (
    select 1 from spideryarn.ai_calls c
     where (c.article_id = runs.article_id or (c.article_id is null and c.article_slug = (select slug from spideryarn.articles a where a.id = runs.article_id)))
       and (case c.step_name when 'hierarchy' then 'structure' when 'trajectory' then 'skim' else c.step_name end = runs.step_name
            or (runs.step_name = 'labels' and c.purpose = 'labels'))
       and c.started_at between runs.started_at - interval '15 seconds' and runs.finished_at + interval '15 seconds')
 order by runs.started_at;
-- assistant chat messages vs a chat/live ledger row for the same article around the same time
select count(*) msgs, count(*) filter (where has_row) with_ledger, count(*) filter (where not has_row) no_row,
       count(*) filter (where not has_row and created_at >= '2026-09-03') without_since_0903,
       min(created_at) filter (where not has_row) first_without, max(created_at) filter (where not has_row) last_without
  from (select m.created_at, exists (select 1 from spideryarn.ai_calls c where c.article_id = m.article_id and c.purpose in ('chat','live_conversation','explain','dig-deeper')
          and c.started_at between coalesce(m.attempt_started_at, m.created_at) - interval '2 minutes' and coalesce(m.finished_at, m.created_at) + interval '5 minutes') has_row
          from spideryarn.chat_messages m where m.role = 'assistant') x;
-- the assistant messages without a ledger row since 2026-09-03: status, model, thread kind
select m.created_at::date d, m.status, m.model, t.kind, m.stopped, m.interrupted, (m.error is not null) errored, count(*) n
  from spideryarn.chat_messages m join spideryarn.chat_threads t on t.id = m.thread_id and t.article_id = m.article_id
 where m.role = 'assistant' and m.created_at >= '2026-09-03'
   and not exists (select 1 from spideryarn.ai_calls c where c.article_id = m.article_id and c.purpose in ('chat','live_conversation','explain','dig-deeper')
          and c.started_at between coalesce(m.attempt_started_at, m.created_at) - interval '2 minutes' and coalesce(m.finished_at, m.created_at) + interval '5 minutes')
 group by 1,2,3,4,5,6,7 order by 1;
-- search runs vs a search ledger row
select kind, status, count(*) runs, count(*) filter (where has_row) with_ledger, count(*) filter (where not has_row and created_at >= '2026-09-03') without_since_0903, max(created_at) filter (where not has_row) last_without
  from (select s.kind, s.status, s.created_at, exists (select 1 from spideryarn.ai_calls c where c.article_id = s.article_id and c.purpose in ('search','search-quick','embeddings')
          and c.started_at between coalesce(s.attempt_started_at, s.created_at) - interval '2 minutes' and coalesce(s.finished_at, s.created_at) + interval '5 minutes') has_row
          from spideryarn.search_runs s) x group by 1,2 order by 1,2;
-- slug set but no article id: by job and month, and whether the slug still names an article
select c.purpose, to_char(c.started_at,'YYYY-MM-DD') d, count(*) n, count(a.id) slug_exists_now, count(*) filter (where a.id is not null and c.started_at < a.created_at) before_current_article
  from spideryarn.ai_calls c left join spideryarn.articles a on a.slug = c.article_slug
 where c.article_slug is not null and c.article_id is null group by 1,2 order by 2,1;
-- dictation and link-summary: with and without a slug, before and after the 2026-09-30 attribution change
select purpose, (started_at >= '2026-10-01') after_change, count(*) n, count(article_slug) with_slug from spideryarn.ai_calls where purpose in ('dictation','link-summary') group by 1,2 order by 1,2;
-- first request-scope row per job, and first job_step row overall
select scope_kind, min(started_at) first_at from spideryarn.ai_calls group by 1;
-- deleted or re-created articles: ledger rows whose article is gone
select count(*) rows_no_aid_with_slug, round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9,4) usd from spideryarn.ai_calls where article_slug is not null and article_id is null;
-- realtime sessions vs ledger rows, per session
select left(s.id::text,8) sess, s.model, s.issued_at::date d, s.connected_at is not null connected, s.closed_at is not null closed, s.close_reason, s.voice_seconds_reported,
       round(extract(epoch from coalesce(s.closed_at, s.accepts_until) - s.connected_at)::numeric) open_secs,
       (select count(*) from spideryarn.ai_calls c where c.realtime_session_id = s.id) ledger_rows,
       (select round(sum(computed_cost_nanos)/1e9,4) from spideryarn.ai_calls c where c.realtime_session_id = s.id) usd
  from spideryarn.realtime_sessions s order by s.issued_at;
-- web_searches recorded on rows
select purpose, count(*) calls, count(web_searches) with_count, sum(web_searches) searches from spideryarn.ai_calls where purpose in ('debate','citations-find','citation-investigate','upload-source-guess','referee-candidates','referee-criteria','explain','chat','dig-deeper-search') group by 1 order by 1;
-- duplicate generation ids (one call written twice?)
select count(*) dup_groups, coalesce(sum(n),0) dup_rows from (select generation_id, count(*) n from spideryarn.ai_calls where generation_id is not null group by 1 having count(*) > 1) x;
-- one step bought more than once for one article
select count(*) article_steps, count(*) filter (where n_ok > 1) bought_more_than_once, round(sum(usd) filter (where n_ok > 1),2) usd_in_those from (select article_id, step_name, count(distinct job_id) filter (where outcome='ok') n_ok, sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0))/1e9 usd from spideryarn.ai_calls where scope_kind='job_step' and article_id is not null group by 1,2) x
