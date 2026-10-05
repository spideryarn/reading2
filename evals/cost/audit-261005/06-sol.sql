-- raw sums
select count(*) calls, sum(credits_used_nanos) credits, sum(byok_upstream_nanos) byok, sum(computed_cost_nanos) computed from spideryarn.ai_calls;
-- the same sums over a GROUP BY of twelve dimensions
select count(*) grp_rows, sum(calls) calls, sum(credits) credits, sum(byok) byok, sum(computed) computed from (
  select count(*) calls, sum(credits_used_nanos) credits, sum(byok_upstream_nanos) byok, sum(computed_cost_nanos) computed
    from spideryarn.ai_calls
   group by owner_id, article_id, article_slug, scope_kind, purpose, step_name, wire, requested_model, answered_model, upstream, outcome, (started_at at time zone 'UTC')::date) g;
-- answered model differs from requested, by pair
select requested_model, answered_model, count(*) calls, round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9,4) usd from spideryarn.ai_calls where answered_model is not null and answered_model <> requested_model group by 1,2 order by 3 desc;
-- answered model null, by wire and outcome
select wire, outcome, count(*) calls from spideryarn.ai_calls where answered_model is null group by 1,2 order by 3 desc;
-- article id null, slug not null
select count(*) calls, count(distinct article_slug) slugs, round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9,4) usd, min(started_at) first_at, max(started_at) last_at from spideryarn.ai_calls where article_id is null and article_slug is not null;
-- the three run ids read from production logs on 2026-10-04 (log said: chat $0.1233 1 call; glossary $0.0920 1 call; glossary $0.1250 1 call)
-- the three uuids below are placeholders: at audit time they were real production run ids, not kept here. Substitute run ids from the log you are checking.
select left(run_id::text,8) run, purpose, count(*) calls, sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)) nanos from spideryarn.ai_calls where run_id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003') group by 1,2;
-- accounts with an expected paid event since the ledger's first row, by source table
select 'jobs with a model step done' src, left(j.owner_id::text,8) owner, count(*) n from spideryarn.jobs j where exists (select 1 from jsonb_array_elements(j.steps) s where s->>'status'='done' and s->>'name' not in ('fetch','extract','blocks','assets')) group by 2
union all select 'chat assistant messages since 2026-09-03', left(t.owner_id::text,8), count(*) from spideryarn.chat_messages m join spideryarn.chat_threads t on t.id = m.thread_id and t.article_id = m.article_id where m.role='assistant' and m.created_at >= '2026-09-03' group by 2
union all select 'search runs since 2026-09-03', left(owner_id::text,8), count(*) from spideryarn.search_runs where created_at >= '2026-09-03' group by 2
union all select 'realtime sessions connected', left(owner_id::text,8), count(*) from spideryarn.realtime_sessions where connected_at is not null group by 2
union all select 'revision model-step runs since 2026-08-30', left(a.owner_id::text,8), count(distinct (v.article_id, r.step_name, r.started_at)) from spideryarn.revision_step_runs r join spideryarn.article_revisions v on v.id = r.revision_id join spideryarn.articles a on a.id = v.article_id where r.status='done' and r.started_at >= '2026-08-30' and r.step_name not in ('fetch','extract','blocks','assets') group by 2
union all select 'ledger rows', left(owner_id::text,8), count(*) from spideryarn.ai_calls group by 2
order by 1,2
