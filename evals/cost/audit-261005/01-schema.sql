-- columns
select table_name, string_agg(column_name, ',' order by ordinal_position) cols from information_schema.columns where table_schema='spideryarn' and table_name in ('ai_calls','articles','article_revisions','jobs','revision_step_runs','realtime_sessions','ingest_events','search_runs','chat_messages','chat_threads','glossary_lookups','link_summaries','citation_finds','citation_investigations','upload_source_guesses','shelf_topic_sets') group by 1;
-- ledger totals
select count(*) calls, count(distinct owner_id) owners, min(started_at) first_at, max(started_at) last_at, sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9 usd, count(generation_id) with_gen from spideryarn.ai_calls;
-- by owner and scope
select left(owner_id::text,8) owner, scope_kind, count(*) calls, round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9,4) usd, min(started_at)::date first_d, max(started_at)::date last_d from spideryarn.ai_calls group by 1,2 order by 3 desc;
-- by wire, cost_source, account
select wire, cost_source, provider_account, is_byok, count(*) calls, count(generation_id) with_gen, round(sum(coalesce(credits_used_nanos,0))/1e9,4) credits, round(sum(coalesce(byok_upstream_nanos,0))/1e9,4) byok, round(sum(coalesce(computed_cost_nanos,0))/1e9,4) computed from spideryarn.ai_calls group by 1,2,3,4 order by 5 desc;
-- articles by owner
select left(a.owner_id::text,8) owner, count(*) articles, min(a.created_at)::date first_d, max(a.created_at)::date last_d from spideryarn.articles a group by 1 order by 2 desc
