-- jobs by owner and status
select left(owner_id::text,8) owner, status, count(*) n, min(created_at)::date first_d, max(created_at)::date last_d from spideryarn.jobs group by 1,2 order by 1,2;
-- ingest events by owner
select left(owner_id::text,8) owner, kind, count(*) n, count(succeeded_at) succeeded, count(released_at) released, min(reserved_at)::date first_d, max(reserved_at)::date last_d from spideryarn.ingest_events group by 1,2 order by 1,2;
-- articles: per owner, with current revision, fixture
select left(owner_id::text,8) owner, fixture, visibility, count(*) n, count(current_revision_id) with_rev from spideryarn.articles group by 1,2,3 order by 1;
-- which tables have owner_id
select table_name from information_schema.columns where table_schema='spideryarn' and column_name='owner_id' order by 1;
-- other tables by owner
select 'chat_threads' t, left(owner_id::text,8) owner, count(*) n from spideryarn.chat_threads group by 2
union all select 'search_runs', left(owner_id::text,8), count(*) from spideryarn.search_runs group by 2
union all select 'glossary_lookups', left(owner_id::text,8), count(*) from spideryarn.glossary_lookups group by 2
union all select 'link_summaries', left(owner_id::text,8), count(*) from spideryarn.link_summaries group by 2
union all select 'realtime_sessions', left(owner_id::text,8), count(*) from spideryarn.realtime_sessions group by 2
union all select 'shelf_topic_sets', left(owner_id::text,8), count(*) from spideryarn.shelf_topic_sets group by 2
union all select 'citation_finds', left(owner_id::text,8), count(*) from spideryarn.citation_finds group by 2
order by 1,2;
-- the second owner: ledger rows
select left(id::text,8) id, scope_kind, purpose, step_name, wire, requested_model, outcome, cost_source, credits_used_nanos, started_at, article_slug is not null has_slug, article_id is not null has_aid, left(job_id::text,8) job from spideryarn.ai_calls where owner_id::text like 'aa8b0dd2%' order by started_at;
-- the second owner: jobs and their steps
select left(id::text,8) job, status, failure_kind, created_at, started_at, finished_at, profile, requeues, reset, steps from spideryarn.jobs where owner_id::text like 'aa8b0dd2%' order by created_at;
-- the second owner: step runs for its article revisions
select r.step_name, r.model, r.status, r.started_at, r.finished_at from spideryarn.revision_step_runs r join spideryarn.article_revisions v on v.id = r.revision_id join spideryarn.articles a on a.id = v.article_id where a.owner_id::text like 'aa8b0dd2%' order by r.started_at
