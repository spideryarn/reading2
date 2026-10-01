# Raise the job concurrency cap to six

Status: plan, 2026-10-01. Follow-up to Sentry SPIDERYARN-READING2-4C
([note](../user-feedback/260929_0509-modes-generate-in-parallel.md)), relayed by the Overseer.

Only 3 background jobs may run at once across **all** readers. Since
[260929c](260929c-modes-generate-in-parallel-on-one-article.md) let mode jobs on one article overlap,
one reader opening four modes fills every slot, and everyone else waits. Asked whether to raise it to
6–8, Greg (2026-10-01, ~00:15, via the Overseer):

> yes

## Where production's number comes from

**The code default.** `SPIDERYARN_JOB_CONCURRENCY` is not set on Vercel — the project's environment
list (read 2026-10-01 through the Vercel MCP, values not decrypted) has no such key, and no
`DATABASE_POOL_MAX` either. So production runs `DEFAULT_JOB_CONCURRENCY = 3` in `src/jobs.ts`, and the
change is a code change with a test. Nothing for the Overseer to set.


## The real limits, and which one binds

Each running job is one Vercel invocation that walks the whole job (`advanceJobWith`). Under Fluid
compute several invocations may share one instance, and with it one DB pool, one memory ceiling and
one set of per-process model-width gates.

| limit | the number | what N jobs asks of it | binds? |
|---|---|---|---|
| **Postgres** | `max_connections` 60 on prod (read 2026-10-01, read-only), so Supabase's smallest tiers; the app reaches it through the transaction pooler | each *process* holds at most `DATABASE_POOL_MAX` 5 (src/db/client.ts), shared by every invocation on it; a job spends its time waiting on models, not in transactions | no |
| **Vercel concurrency** | Pro, Fluid: auto-scales to 30,000 | N | no |
| **Vercel duration** | `maxDuration` 800 s (vercel.json) | per invocation, independent of N | no |
| **Vercel memory / CPU / fds** | 2 GB / 1 vCPU default, 1,024 file descriptors, per instance, shared by whatever Fluid packs onto it | mode jobs are small. A long PDF measured 608–632 MB RSS (src/pdf-read.ts), and there is no per-process admission gate on PDF parses, so **three PDF ingests packed onto one instance** is the case that hits the ceiling | **binds first if jobs are packed** |
| **Model provider throughput** | OpenRouter imposes no rate limit on paid models (docs, 2026-10-01); the upstream provider does, per account. The width gates (`WidthGate`) are per process, so nothing governs the total across instances | PDF extract is 100 calls per job (`CHUNK_CONCURRENCY`, on Luna); hierarchy deepening 8 per job (on Sonnet). N PDF jobs spread across instances is up to N × 100 calls | **binds first if jobs are spread**; unmeasured for Sonnet |
| **Spend** | the global OpenRouter spend limit ([ai-gateway.md](../project/ai-gateway.md)) | concurrency changes *when* money is spent, not how much | policy — Greg's answer |

So which limit binds depends on placement: spread across instances, upstream provider throughput;
packed onto one, memory under concurrent PDF parses. Neither is measured at N > 3. That argues for
**6**, the conservative end of the range Greg approved: it doubles the machine, lets one reader open
four modes and still leave two slots, and keeps the unmeasured worst cases at twice the previous
configured ceiling rather than nearly three times. **8 is the next step once production has run at 6**
without provider 429s in `ai_calls`, function memory errors or pool timeouts — an environment variable
the Overseer can set on Vercel, no code change.

Production usage for scale: 50 jobs in the table (retention keeps recent ones), all from one owner,
the busiest day 34.

## The change

- `DEFAULT_JOB_CONCURRENCY` 3 → **6** in `src/jobs.ts`, with the reasoning above in its docblock.
- A test that pins the default and the env handling (`jobConcurrency()` had none): red at 3.
- `tests/hierarchy-deepen-wave.test.ts` pins `DEFAULT_JOB_CONCURRENCY × EXPANSION_CONCURRENCY ≤ 24`,
  which 6 × 8 = 48 breaks. The 24 was a quarter of `CHUNK_CONCURRENCY`, but that is a Luna figure
  and hierarchy runs on Sonnet (GPT Sol), so it was never evidence for this account. Rather than
  quietly loosening it to 100, the bound becomes **48, stated as a chosen ceiling rather than a
  measurement**, so raising either number again is a decision somebody has to make on purpose; the
  per-wave timing assertions stay as they are. `hierarchy-deepen.ts`'s docblock says the same.
- Stale "3" / "three" where the *current* value is stated: `jobConcurrency`'s docblock, the "three
  global slots" sentence in `src/jobs.ts`, `src/vercel-health.ts`, `src/illustrated.ts`,
  `src/hierarchy-deepen.ts`. Dated records (plans, worktrees.md's incident) stay as they were.
- `evals/deepen` phase D used to hard-code three jobs while comparing only the runtime cap with
  `DEFAULT_JOB_CONCURRENCY`; at 6 its gate would have passed over half the load it claimed to test.
  It now derives one book job plus the remaining load jobs from the default, and its estimate and
  expected-job count follow the same number. Not rerun (it is a paid eval).

## Deferred: a per-reader share

Raising the cap without one leaves one reader able to take every slot, at a higher number. It is
deferred, on GPT Sol's review: production has had **one** job owner in the recent window, so a share
of 5 of 8 would have turned this into a 3 → 5 increase for the only real workload while leaving slots
idle, and there is still no evidence of one reader starving another — the report was one reader
wanting more parallelism. [260929c](260929c-modes-generate-in-parallel-on-one-article.md) said the
same: add it *if it bites*.

The shape, for when it does (reviewed and found sound by Sol): a second count inside `claim`'s
`queue_state` lock in `src/store/pg-jobs.ts` — `running` rows with this `owner_id` — refusing `busy`
with a reason naming the reader, not the machine; the share passed in by `src/jobs.ts` as a
**required** argument (an optional one defaulting to "no limit" is exactly the silent-disable that
`tests/jobs.test.ts` already guards against for `maxRunning`); and a test with two *concurrent*
same-owner claims, since sequential ones prove the arithmetic and not the lock. It would guarantee
other readers the remainder *collectively*, not each — there is no fair ordering, so a second reader
can still take all of it.

## Simpler option passed over

Setting `SPIDERYARN_JOB_CONCURRENCY=6` on Vercel instead of changing the default: no deploy of
code, but it makes the number production actually runs live somewhere no test or reader of
`src/jobs.ts` can see, and local dev would stay at 3.

## Review log

- **Plan review, GPT Sol, round 1** (2026-10-01, read-only): no P0; request changes. P1: "64 calls
  at worst" was false — PDF extract is 100 per job and gates are per process — and Luna evidence
  says nothing about Sonnet; which limit binds depends on placement (memory if packed); make the
  per-reader argument required; loosening the hierarchy bound to 100 is a weakened check. P2: test
  the owner count under concurrency; "everyone else keeps three" is collective not each; a stale
  comment in `src/illustrated.ts`. Verdict: choose 6 and defer the per-reader share. **All taken**;
  the plan above is the revision.
- **Code review, GPT Sol, round 1** (2026-10-01, workspace-write, on `ba98a380`): no P0; approve
  with its fixes. P1 (fixed by Sol): `evals/deepen` phase D still hard-coded three jobs while its
  gate compared only the runtime cap with the default, so at 6 it would have passed over half the
  load it claims to measure — it now derives the job count, slugs, estimate and expected jobs from
  `DEFAULT_JOB_CONCURRENCY`, reusing the first article file when fewer are given. Read and accepted:
  nothing is spent until somebody reruns it. P2 (fixed): the default-path test now deletes the
  variable rather than setting it empty; current-tense "three" in `ingest-queue.md`, `glossary.md`,
  `src/routes.ts` and the eval docs. No test depended on a refusal at the fourth claim.
