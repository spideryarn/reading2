-- name: articles
select a.id, a.owner_id, a.slug, a.created_at, a.archived_at, a.fixture, a.visibility, a.opens, a.updated_at,
       r.id as revision_id, r.title, r.created_at as revision_created_at, r.fetched_at, r.raw_content_type,
       r.source, r.extract_method, r.pages, r.word_count, r.block_count, r.raw_sha256, r.raw_source_sha256,
       r.raw_source_kind, r.raw_byte_count, r.final_url is not null as has_url,
       r.citations is not null as has_citations
from spideryarn.articles a
left join spideryarn.article_revisions r on r.id = a.current_revision_id
order by a.created_at
-- name: step_runs
select s.revision_id, s.step_name, s.implementation_version, s.prompt_version, s.model, s.status, s.finished_at
from spideryarn.revision_step_runs s
join spideryarn.articles a on a.current_revision_id = s.revision_id
where s.step_name in ('fetch','extract','blocks','citations')
-- name: blocks
select b.article_id, b.block_id, b.ordinal, b.tag, b.kind, b.role, b.treatment, b.note_id, b.text, b.html
from spideryarn.revision_blocks b
join spideryarn.articles a on a.current_revision_id = b.revision_id
order by b.article_id, b.ordinal
-- name: citations
select a.id as article_id, r.citations
from spideryarn.articles a
join spideryarn.article_revisions r on r.id = a.current_revision_id
where r.citations is not null
-- name: comments
select article_id, id, owner_id, block_id, quote, start, status, body is not null and body <> '' as has_body,
       answer is not null as has_answer, colour, thread_id, created_at
from spideryarn.comments
-- name: chat_threads
select article_id, id, owner_id, anchor_block_id, anchor_quote, kind, created_at
from spideryarn.chat_threads
-- name: reading_time
select article_id, block_id, seconds from spideryarn.reading_time
-- name: checkpoint_namespaces
select namespace, count(*) as n, count(distinct article_id) as articles from spideryarn.checkpoints group by 1 order by 1
-- name: search_runs
select article_id, id, owner_id, status, created_at,
       (select array_agg(distinct m[1]) from regexp_matches(hits::text, '(spya-[a-z0-9]{6})', 'g') m) as ids
from spideryarn.search_runs
-- name: referee_criteria
select article_id, owner_id, status,
       (select array_agg(distinct m[1]) from regexp_matches(results::text, '(spya-[a-z0-9]{6})', 'g') m) as ids
from spideryarn.referee_criteria
-- name: referee_claims
select article_id, owner_id, status,
       (select array_agg(distinct m[1]) from regexp_matches(claims::text, '(spya-[a-z0-9]{6})', 'g') m) as ids
from spideryarn.referee_claims
-- name: chat_messages
select article_id, thread_id, role,
       (select array_agg(distinct m[1]) from regexp_matches(text || ' ' || coalesce(passages::text, '') || ' ' || coalesce(citations::text, ''), '(spya-[a-z0-9]{6})', 'g') m) as ids
from spideryarn.chat_messages
-- name: link_summaries
select article_id, owner_id, block_id from spideryarn.link_summaries
