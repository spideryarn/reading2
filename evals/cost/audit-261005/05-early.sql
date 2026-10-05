-- assistant chat messages per day up to 2026-09-05, with and without a ledger row nearby
select to_char(m.created_at at time zone 'UTC','YYYY-MM-DD') d, count(*) msgs,
       count(*) filter (where exists (select 1 from spideryarn.ai_calls c where c.article_id = m.article_id and c.purpose in ('chat','live_conversation','explain','dig-deeper','referee-candidates')
          and c.started_at between coalesce(m.attempt_started_at, m.created_at) - interval '2 minutes' and coalesce(m.finished_at, m.created_at) + interval '5 minutes')) with_ledger
  from spideryarn.chat_messages m where m.role = 'assistant' and m.created_at < '2026-09-06' group by 1 order by 1;
-- ledger rows per day and scope up to 2026-09-05
select to_char(started_at at time zone 'UTC','YYYY-MM-DD') d, scope_kind, count(*) n, string_agg(distinct purpose, ',') jobs from spideryarn.ai_calls where started_at < '2026-09-06' group by 1,2 order by 1,2;
-- articles created per month, and how many have any ledger row
select to_char(a.created_at at time zone 'UTC','YYYY-MM') m, count(*) articles, count(a.current_revision_id) with_rev, count(*) filter (where exists (select 1 from spideryarn.ai_calls c where c.article_id = a.id)) with_ledger from spideryarn.articles a group by 1 order by 1;
-- articles with a current revision and no ledger row at all: when created, what extract method, whether a structure step ran
select left(a.id::text,8) article, a.created_at::date created, v.extract_method, v.source, v.block_count,
       (select count(*) from spideryarn.revision_step_runs r where r.revision_id = v.id and r.step_name = 'structure') structure_runs
  from spideryarn.articles a join spideryarn.article_revisions v on v.id = a.current_revision_id
 where not exists (select 1 from spideryarn.ai_calls c where c.article_id = a.id) order by a.created_at
