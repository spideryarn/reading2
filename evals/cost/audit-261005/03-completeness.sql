-- distinct owners in every owner_id table
select 'articles' t, count(distinct owner_id) owners from spideryarn.articles
union all select 'ai_calls', count(distinct owner_id) from spideryarn.ai_calls
union all select 'billing_accounts', count(distinct owner_id) from spideryarn.billing_accounts
union all select 'reader_profiles', count(distinct owner_id) from spideryarn.reader_profiles
union all select 'reader_arrivals', count(distinct owner_id) from spideryarn.reader_arrivals
union all select 'feedback', count(distinct owner_id) from spideryarn.feedback
union all select 'rate_limit_events', count(distinct owner_id) from spideryarn.rate_limit_events
union all select 'uploads', count(distinct owner_id) from spideryarn.uploads
union all select 'jobs', count(distinct owner_id) from spideryarn.jobs
union all select 'ingest_events', count(distinct owner_id) from spideryarn.ingest_events
union all select 'comments', count(distinct owner_id) from spideryarn.comments
union all select 'chat_threads', count(distinct owner_id) from spideryarn.chat_threads
union all select 'realtime_sessions', count(distinct owner_id) from spideryarn.realtime_sessions
union all select 'shelf_topic_sets', count(distinct owner_id) from spideryarn.shelf_topic_sets;
-- owners anywhere that are not in the ledger
select t, left(owner_id::text,8) owner, n from (
  select 'billing_accounts' t, owner_id, count(*) n from spideryarn.billing_accounts group by 2
  union all select 'reader_profiles', owner_id, count(*) from spideryarn.reader_profiles group by 2
  union all select 'reader_arrivals', owner_id, count(*) from spideryarn.reader_arrivals group by 2
  union all select 'feedback', owner_id, count(*) from spideryarn.feedback group by 2
  union all select 'rate_limit_events', owner_id, count(*) from spideryarn.rate_limit_events group by 2
  union all select 'uploads', owner_id, count(*) from spideryarn.uploads group by 2
  union all select 'comments', owner_id, count(*) from spideryarn.comments group by 2
) x where owner_id not in (select distinct owner_id from spideryarn.ai_calls) order by 1,2;
-- rate limit events by owner and bucket (independent trace of requests that reach paid routes)
select left(owner_id::text,8) owner, count(*) n from spideryarn.rate_limit_events group by 1;
-- jobs: every step that finished, against ledger rows carrying that job id and step
select s->>'name' step, s->>'status' status, count(*) step_runs, count(*) filter (where exists (select 1 from spideryarn.ai_calls c where c.job_id = j.id and c.step_name = s->>'name')) with_ledger_row from spideryarn.jobs j, jsonb_array_elements(j.steps) s group by 1,2 order by 1,2;
-- ledger rows whose job_id is not in jobs (jobs pruned?) and jobs date range
select count(*) filter (where job_id is not null) with_job, count(*) filter (where job_id is not null and not exists (select 1 from spideryarn.jobs j where j.id = c.job_id)) job_gone, min(started_at) filter (where job_id is not null and exists (select 1 from spideryarn.jobs j where j.id = c.job_id)) earliest_joined from spideryarn.ai_calls c;
-- revision_step_runs: distinct (article, step) with a model recorded or not, against ledger rows for that article and step
select r.step_name, count(distinct (v.article_id, r.step_name, r.started_at)) runs, count(distinct (v.article_id, r.step_name, r.started_at)) filter (where exists (select 1 from spideryarn.ai_calls c where c.article_id = v.article_id and c.step_name = r.step_name and c.started_at between r.started_at - interval '10 seconds' and r.finished_at + interval '10 seconds')) with_ledger from spideryarn.revision_step_runs r join spideryarn.article_revisions v on v.id = r.revision_id where r.status = 'done' group by 1 order by 1;
-- independent artefacts of interactive model work vs ledger rows by job
select 'search_runs' t, count(*) n, min(created_at)::date first_d from spideryarn.search_runs
union all select 'glossary_lookups', count(*), min(created_at)::date from spideryarn.glossary_lookups
union all select 'link_summaries', count(*), min(created_at)::date from spideryarn.link_summaries
union all select 'citation_finds', count(*), min(created_at)::date from spideryarn.citation_finds
union all select 'citation_investigations', count(*), min(created_at)::date from spideryarn.citation_investigations
union all select 'upload_source_guesses', count(*), min(claimed_at)::date from spideryarn.upload_source_guesses
union all select 'chat_messages assistant', count(*), min(created_at)::date from spideryarn.chat_messages where role = 'assistant'
union all select 'realtime_sessions', count(*), min(issued_at)::date from spideryarn.realtime_sessions
union all select 'realtime connected', count(*), min(issued_at)::date from spideryarn.realtime_sessions where connected_at is not null
union all select 'realtime connected silent', count(*), min(issued_at)::date from spideryarn.realtime_sessions s where connected_at is not null and not exists (select 1 from spideryarn.ai_calls c where c.realtime_session_id = s.id);
-- ledger by scope, job, step (for categories)
select scope_kind, purpose, step_name, count(*) calls, round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9,4) usd, count(*) filter (where article_slug is null) no_slug, count(*) filter (where article_id is null) no_aid, count(*) filter (where outcome <> 'ok') non_ok, count(*) filter (where cost_source <> 'computed' and case when is_byok is true then byok_upstream_nanos is null else credits_used_nanos is null end) unpriced, min(started_at)::date first_d, max(started_at)::date last_d from spideryarn.ai_calls group by 1,2,3 order by 1,2,3;
-- unpriced rows by job, model, wire, outcome
select purpose, wire, requested_model, outcome, cost_source, count(*) calls, sum(reported_input_tokens) in_tok, sum(output_tokens) out_tok, count(generation_id) with_gen, min(started_at)::date first_d, max(started_at)::date last_d from spideryarn.ai_calls where cost_source <> 'computed' and case when is_byok is true then byok_upstream_nanos is null else credits_used_nanos is null end group by 1,2,3,4,5 order by 6 desc;
-- outcome totals
select outcome, count(*) calls, round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9,4) usd, count(*) filter (where cost_source='none') none_rows from spideryarn.ai_calls group by 1;
-- computed rows by model, event kind, price version
select requested_model, event_kind, price_version, count(*) calls, round(sum(computed_cost_nanos)/1e9,4) usd, min(started_at)::date first_d, max(started_at)::date last_d from spideryarn.ai_calls where cost_source='computed' group by 1,2,3 order by 1,2;
-- article owner differs from row owner
select count(*) rows_with_aid, count(*) filter (where a.owner_id <> c.owner_id) owner_differs from spideryarn.ai_calls c join spideryarn.articles a on a.id = c.article_id;
-- slug set, article id null: does an article with that slug exist now, and whose
select count(*) n, count(*) filter (where a.id is not null) slug_exists_now, count(*) filter (where a.id is not null and a.owner_id <> c.owner_id) other_owner, count(*) filter (where a.id is not null and c.started_at >= a.created_at) after_creation from spideryarn.ai_calls c left join spideryarn.articles a on a.slug = c.article_slug where c.article_slug is not null and c.article_id is null;
-- by model
select requested_model, wire, count(*) calls, round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9,4) usd from spideryarn.ai_calls group by 1,2 order by 4 desc;
-- credentials
select credential_fingerprint, count(*) calls, round(sum(coalesce(credits_used_nanos,0))/1e9,4) credits, min(started_at)::date first_d, max(started_at)::date last_d from spideryarn.ai_calls group by 1 order by 2 desc;
-- month totals (credits pocket) for reconciliation
select to_char(started_at at time zone 'UTC','YYYY-MM') m, count(*) calls, round(sum(coalesce(credits_used_nanos,0))/1e9,4) credits, round(sum(coalesce(byok_upstream_nanos,0))/1e9,4) byok, round(sum(coalesce(computed_cost_nanos,0))/1e9,4) computed from spideryarn.ai_calls group by 1 order by 1
