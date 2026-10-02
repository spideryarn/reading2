SELECT count(*), min(started_at), max(started_at) FROM spideryarn.ai_calls;
SELECT wire, scope_kind, purpose, count(*) FROM spideryarn.ai_calls WHERE started_at > now()-interval '30 days' GROUP BY 1,2,3 ORDER BY 4 DESC;
