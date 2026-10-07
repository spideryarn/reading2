-- columns
select column_name from information_schema.columns where table_schema='spideryarn' and table_name='ai_calls' order by ordinal_position;
-- by fingerprint, all time
select credential_fingerprint, count(*), round(sum(credits_used_nanos)/1e9,2) credits, min(started_at)::date first, max(started_at)::date last from spideryarn.ai_calls group by 1 order by 3 desc nulls last;
-- local key by month and scope
select date_trunc('month', started_at)::date m, scope_kind, count(*), round(sum(credits_used_nanos)/1e9,2) credits from spideryarn.ai_calls where credential_fingerprint='66c3cdfc178e' group by 1,2 order by 1,2;
-- local key by UTC day, Sep 20 on
select (started_at at time zone 'utc')::date d, count(*), round(sum(credits_used_nanos)/1e9,2) credits, round(sum(byok_upstream_nanos)/1e9,2) byok, count(*) filter (where credits_used_nanos is null and byok_upstream_nanos is null) unpriced from spideryarn.ai_calls where credential_fingerprint='66c3cdfc178e' and started_at >= '2026-09-20' group by 1 order by 1
