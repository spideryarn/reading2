# Import step durations in production (measured 2026-10-20)

## Which database
PRODUCTION. Not the Supabase MCP: `mcp__supabase__execute_sql` and `get_project_url` hit the LOCAL stack
(http://127.0.0.1:54361, 114 jobs) and were used only to establish that. Production was read with a node script
(`pull.cjs`, `pull2.cjs` in this scratchpad), `.env.prod` DATABASE_URL (app role, transaction pooler :6543,
committed CA), every query inside `begin read only` ... `rollback`. Check printed `transaction_read_only = on`,
server address a remote IPv6 (not local), 129 rows in spideryarn.jobs. Nothing written, no SET issued.
Greg's standing permission: database.md § Connecting to the remote (2026-10-19).

## Sample is tiny
`jobs` in production only reaches back to 2026-09-28 (129 jobs in all, 11 of them imports, i.e. with a `fetch`
step). So "last 60 days" = 3 weeks, n = 11: 6 URL done, 2 upload done, 3 failed (1 upload extract error,
1 upload fetch error, 1 URL fetch error). Percentiles below are indicative only; with n=6 "p90" is the max.

## SQL (exact)
```sql
-- pull.cjs: import jobs, steps JSON analysed in node (finishedAt - startedAt of steps with status 'done')
select j.id, j.url is not null as has_url, j.upload_id is not null as has_upload, j.status, j.created_at, j.finished_at,
 j.steps, j.draft_revision_id, u.bytes as upload_bytes, u.claimed_bytes,
 (select count(*) from spideryarn.revision_blocks b where b.revision_id=j.draft_revision_id) as nblocks,   -- 0: draft_revision_id is null after publish
 (select coalesce(sum(b.words),0) from spideryarn.revision_blocks b where b.revision_id=j.draft_revision_id) as nwords
from spideryarn.jobs j left join spideryarn.uploads u on u.id=j.upload_id
where j.created_at > now() - interval '60 days' and j.steps @> '[{"name":"fetch"}]'::jsonb;

-- pull2.cjs
select min(created_at) mn, max(created_at) mx, count(*) n,
  count(*) filter (where steps @> '[{"name":"fetch"}]'::jsonb) imports from spideryarn.jobs;
select left(j.id,8) id, j.requeues, j.status, u.bytes upload_bytes,
 (select count(*) from spideryarn.revision_blocks b where b.revision_id=a.current_revision_id) nblocks,
 (select coalesce(sum(b.words),0) from spideryarn.revision_blocks b where b.revision_id=a.current_revision_id) nwords
from spideryarn.jobs j left join spideryarn.uploads u on u.id=j.upload_id
left join spideryarn.articles a on a.slug=j.slug and a.owner_id=j.owner_id
where j.steps @> '[{"name":"fetch"}]'::jsonb and j.created_at > now() - interval '60 days' order by j.created_at;
```

## Per-job raw (seconds, done steps only; words = finished article's words)
| job | kind | upload bytes | words | fetch | extract | blocks | structure | assets | create->finish |
|---|---|---|---|---|---|---|---|---|---|
| kup | url | | 422 | 0.7 | 3.9 | 1.7 | 0.1 | 0.4 | 7.3 |
| dzj | url | | 1,125 | 2.6 | 4.8 | 0.2 | 11.8 | 0.1 | 20.1 |
| nkr | url | | 5,214 | 1.1 | 3.1 | 1.8 | 0.1 | 0.8 | 7.7 |
| pxk | url | | 11,861 | 1.7 | 12.7 | 2.7 | 0.5 | 0.1 | 18.6 |
| rzr | url | | 13,657 | 1.0 | 62.2 | 2.1 | 0.4 | 0.1 | 67.4 |
| mm8 | url | | 4,645 | 1.3 | 122.4 | 0.7 | 73.8 | 32.0 | 231.8 |
| m0j | upload | 1.2 MB | 17,379 | 1.3 | 90.7 | 3.8 | 0.4 | 13.5 | 111.6 |
| s9g | upload | 14.7 MB | 44,991 | 3.5 | 216.2 | 4.9 | 0.8 | 38.5 | 267.0 |
| k0y | upload (error) | 8.0 MB | - | 2.0 | ERROR after 203.6 | | | | 205.9 |

## Per step (done only)
| step | scope | n | min | median | p90~max | max |
|---|---|---|---|---|---|---|
| fetch | all | 9 (corrected from 8 by the plan review: the upload whose extract failed had a done fetch) | 0.7 | 1.3 | 3.5 | 3.5 |
| extract | url | 6 | 3.1 | 8.8 | 122 | 122.4 |
| extract | upload | 2 | 90.7 | 153 | 216 | 216.2 |
| blocks | all | 8 | 0.2 | 1.9 | 4.9 | 4.9 |
| structure | url | 6 | 0.1 | 0.45 | 73.8 | 73.8 |
| structure | upload | 2 | 0.4 | 0.6 | 0.8 | 0.8 |
| assets | all | 8 | 0.1 | 0.6 | 38.5 | 38.5 |

Whole import wall clock (create->finish), done jobs: URL n=6 min 7.3, median 19.4, max 231.8; upload n=2: 111.6 and 267.0.
(first startedAt -> last finishedAt is within ~1s of create->finish: queue wait is negligible in this sample.)

## Predictability
- Extract on uploads: bytes 1.2 MB -> 91 s, 14.7 MB -> 216 s, 8.0 MB -> still failed at 203.6 s. Monotone-ish with
  size (and pages) but n=2 done + 1 failure: no usable fit; an 8 MB file burning >200 s then erroring sits between
  the two. Words: 17k -> 91 s, 45k -> 216 s (~5 s/1000 words, same two points). Plausibly linear in pages, but cannot
  be called from this data. Size known at start: `uploads.bytes` (page count not stored on the job).
- Extract on URLs: bimodal and NOT a function of length. 3-5 s for 422/5,214/1,125 words, 12.7 s for 11.9k words,
  62 s for 13.7k, 122 s for only 4.6k words. Slow ones look like a fallback extractor (second of the "two" extractors in
  content-extraction.md), which is not knowable from the size of the page.
- Structure: mostly under 1 s (headings-first imports publish before the model call, which the job step then
  skips quickly); when it does the model call it is 12 s (1.1k words) to 74 s (4.6k words). Too few points.
- No size/time table by bucket is meaningful at n<=9.

## Requeue question (code, src/jobs.ts runStep ~1481, comment ~1483)
Each attempt does `step.status="running"; step.startedAt=new Date()`; a requeue resets a running step to `pending`
keeping other fields. So startedAt IS RESET on every window and finishedAt is the final window's end:
finishedAt - startedAt = only the LAST window of a resumed step, not its whole time. All 11 imports have
`requeues = 0`, so no resumed step is in this sample, but any resumed one would under-report. For whole-import time use
job createdAt -> finishedAt. The per-step clock must be kept elsewhere (revision_step_runs has started_at/finished_at
per run, untested here) if resumed steps need counting.
