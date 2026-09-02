# The storm that was not a retry, and not about truncation

**2026-09-02.** Greg read `data/_ai-calls.jsonl` and found one ingest job that had made **eleven paid
model calls for one step, $5.43**, every row `outcome: "ok"`, every one with the same 20,023 input
tokens. It looked like a retry loop hammering a call that kept truncating, and the brief that came
out of it was called *the truncation retry cost storm*.

It is neither. Nothing retried, and the truncation was a passenger.

## What actually happened

**Saving a file the dev server imports restarts the dev server, in the same process, with a fresh
copy of every server module — and does not stop the pipeline step that is running.** The filesystem
job store's mutual exclusion was a `Map` in that module, so the fresh copy had never heard of the
claim, handed the job straight back out, and the browser started the same eight-minute model call
again. Eleven times, while the first was still going.

The chain, link by link:

1. [`vite.config.ts`](../../vite.config.ts) mounts the API with a dynamic import of `src/routes.js`
   inside `configureServer`. Vite's config bundler externalises only non-relative specifiers, so that
   import is **bundled into the config** — which makes every server module a config dependency.
   `resolveConfig` reports **176** of them here, with `src/jobs.ts`, `src/store/jobs-fs.ts` and
   `src/hierarchy.ts` in the list and `src/web/jobEngine.ts`, which only the client reaches, not.
2. A change to any of those restarts the server. Measured on the box, not inferred:

   ```
   2:12:58 PM [vite]   VITE v8.2.2  ready in 5829 ms
   2:13:11 PM [vite] src/hierarchy.ts changed, restarting server...
   2:13:13 PM [vite] server restarted.
   ```

   `devWatchIgnored` ([`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts)) excludes only
   `data/`, `docs/`, `evals/` and a peer's worktrees.
3. The restart loads the config from a **uniquely named** temp file, so the module registry cannot
   dedupe it. Every server module is evaluated a second time, with new empty Maps. `server.close()`
   destroys the open sockets — but nothing cancels the in-flight `handleApi` promise, so the model
   call keeps going and keeps being billed.
4. The new copy hands the job back out. `ready()` → `loadFromDisk` → `sweepStopped` sees
   `status: "running"` on disk and rewrites it to `queued`, on the premise *"this process has just
   started, so nothing on disk can have work happening against it."* The process had not started.
   Only the module had.
5. About eight seconds later the browser asks again. Its `POST /api/jobs/:id/advance` was severed by
   the socket destroy; `jobEngine.step`'s catch waits `IDLE_MS = 8000` and re-POSTs
   ([`src/web/jobEngine.ts`](../../src/web/jobEngine.ts)). The observed gaps — 9.3, 5.6, 8.3, 8.0,
   6.0, 9.0, 5.0, 61.0, 12.0 seconds — are that, with a second tab explaining the sub-8s ones and a
   lull in editing explaining the 61.
6. Nothing stops the abandoned runs. Each old copy's `fenced()` reads *its own* Maps, where its own
   attempt is still live, so it never raises `StaleAttemptError`. Each finished its call, was billed,
   and wrote a complete terminal job record over the same file. Last writer wins — `spya-p38nga.json`
   ends at 14:15:43.981, ten milliseconds after the run that started at 14:07:31.768, and its step's
   `startedAt` is that run's too.

The `AbortController` that could have stopped any of them was in the discarded copy's `aborts` map,
so **Stop reached nothing after a save either.** Same cause, quieter symptom.

## Why the first two readings were wrong

**"A retry loop."** `runId` is minted once per `collectSpend()`
([`src/ai-spend.ts`](../../src/ai-spend.ts)) and `collectSpend` wraps a step exactly once
(`runStep`, [`src/jobs.ts`](../../src/jobs.ts)) — which the `labels` rows sharing their parent's
`runId` independently confirm. All eleven calls carry **distinct `runId`s**, so each is a separate
granted `claim()`, not a retry inside one. And they overlap in wall clock: `spya-zf0bgj`'s eleven
started 17:48:10 → 17:53:23 and the first did not finish until 17:53:27. The SDK is built with
`maxRetries: 0` ([`src/messages-stream.ts`](../../src/messages-stream.ts)) — *"one record, one
call"* — and [`src/hierarchy.ts`](../../src/hierarchy.ts) has no loop around its `streamMessage`.

**"Truncation."** Five of the eleven came back at 32,913 / 26,856 / 25,748 / 47,605 / 21,830 output
tokens, well under the 52,225 ceiling. And the same afternoon, at 08:29, the tiny `read` article ran
its structure call **six times, all six fine, all six billed** — $0.30 for a $0.05 step, on a job
that then failed for an unrelated reason. The storm needs no failure and no length. That is why it
had never been noticed: **duplicated work produces the same right answer**, so on a successful ingest
the only trace is a number in a ledger nobody reads.

| job | slug | structure calls | on those calls | how they came back |
|---|---|---|---|---|
| `spya-v2f7b3` | read (08:29) | **6** | $0.30 | **all six fine** |
| `spya-p38nga` | towards-a-theory-of-bugs (14:05) | 10 | $4.81 | 6 at the ceiling, 3 below, 1 `error` |
| `spya-zf0bgj` | towards-a-theory-of-bugs (17:48) | 11 | **$5.43** | 6 at the ceiling, 5 below |
| `spya-gv99gh` | towards-a-theory-of-bugs (17:53) | 2 | $0.82 | 1 at the ceiling, 1 below |
| `spya-ug2qtq` | towards-a-theory-of-bugs (13:51) | **1** | $0.32 | one call, 269s, no storm |

`spya-ug2qtq` is the control: same article, same afternoon, one call. The difference between the rows
is how much anybody was editing.

**Keeping one call from each group and calling the rest waste, this cost $9.62** of the $11.36 those
four jobs spent — and that is the whole ledger, 565 rows, a few days of one laptop's development. The
question that produces it is one line (*more than one `runId` for one `(jobId, step)`*) and nobody
had ever asked it.

## The class

**A safety property asserted in a comment and enforced by nothing** — and falsified not by a race in
the code but by a fact about how the code is run.

[`src/store/jobs-fs.ts`](../../src/store/jobs-fs.ts) said, correctly and prominently:

> **One process.** The index is this process's memory and the single-running rule is a variable in
> it… Across processes it is not a fence at all. Nothing here pretends otherwise.

Every word of that is true and it still did not hold, because it said *process* and meant *module*,
and the day the API became a Vite config dependency those stopped being the same thing. The comment
was honest about the limitation it knew about and silent about the one that arrived later — which is
what a comment does, being a statement rather than a check.

Two smaller members of the same family are worth naming beside it, because both were also true once:

- `sweepStopped`'s *"this process has just started"* — a premise, never checked.
- `aborts`'s *"a second instance has no function to interrupt"* — true of a second machine, false of
  a second copy in this process, where the function is right there and still running.

## Which commit

The claim arrived with **`c109658`** (2026-08-27, *"Take the queue out of one process's memory, and
put a claim where the Map was"*), which put the fence in a module-scope `Map`. It replaced a `p-queue`
whose concurrency-1 promise was equally module-scope, so nothing regressed — the hole is as old as the
queue and was inherited rather than introduced.

What made it expensive was **`ceec42f`** (2026-08-30, *"One claim walks the whole job"*): after it, a
duplicate claimant runs the whole ingest rather than one step. The storms are all from that day
onwards. Nothing since touched it, and `c42c940` says as much — *"the filesystem branch is untouched
and is still what every laptop runs."*

## Why the 2026-08-26 fix did not cover it

[260826a-toc-max-tokens.md](260826a-toc-max-tokens.md) is about the same stage on the same article
and is not this bug. It fixed *what one truncation says and whether Retry is offered*, and its model
of the world — *"a retry is a new job"* — is true. A `failureKind` that hides a button cannot help
when the duplication happens before anything fails, in another copy of the module, to calls that
mostly succeed.

The truncation half was fixed separately by Greg the same evening in **`fb82dc8`**, which took the
structure call from `effort: "high"` to `"medium"` because *"the reasoning did not overrun its
reservation; it expanded to fill the ceiling."* Two symptoms on one stage, three unrelated causes —
the tiling failure in `0062f74` was a third — and that commit message says so, which is the reason
nobody stopped looking after it.

## What changed

[`src/process-state.ts`](../../src/process-state.ts): state whose duplication is a correctness bug
gets a `globalThis` key and therefore the lifetime of the process. Two callers, and each is a lock
rather than a cache:

- **`QueueState`** in [`src/store/jobs-fs.ts`](../../src/store/jobs-fs.ts) — the index, the attempt
  tokens, the work keys, the forgotten set, the write queue, and the two scalars `loaded` and
  `writeCounter`. `loaded` has to be there or the new copy re-runs `loadFromDisk`, which is the sweep
  that hands the job away; `writeCounter` has to be there or two copies mint the same `.pid.N.tmp`
  name for one job. They stay *properties of the shared object* — destructuring a primitive the way
  the Maps are destructured would copy the value into each copy and restore the bug with every test
  still green. GPT Sol caught that before it could happen.
- **`aborts`** in [`src/jobs.ts`](../../src/jobs.ts), so a Stop reaches a step an earlier copy
  started.

A restart is now a **pause rather than a duplicate**: the new copy is told `busy`, the old copy still
holds the claim, its writes still pass the fence, and the ingest finishes normally. Which is why the
obvious-looking companion fix — *abort the in-flight step when the server restarts* — was deliberately
**not** done. It looks like the money-saver and it is the opposite: it would throw away a call that is
about to be useful.

## What would have caught it

Ranked by what they cost against what they are worth.

1. **A test that two copies of the module cannot both claim one job**, which is now
   [`tests/two-servers-one-queue.test.ts`](../../tests/two-servers-one-queue.test.ts).
   `vi.resetModules()` plus a fresh import is not a simulation of the restart — it is the same event.
   Cheap, deterministic, and red against the real unfixed code rather than against a mutation. The
   companion for the other half is *"lets a Stop from a reloaded copy of this module reach the running
   step"* in [`tests/jobs-walk.test.ts`](../../tests/jobs-walk.test.ts), which exists because the
   store test cannot fail if `aborts` stays module-local.
2. **Reading the ledger for duplicates at all.** Every one of these storms is one SQL-shaped question
   — *more than one `runId` for one `(jobId, step)`* — and nobody had ever asked it, on 565 rows. The
   two big ones were found by eye three days later; the six on `read` were never found at all until
   this. That question belongs in whatever cost reporting
   [260902g](../plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md) builds.
3. **Treating a comment that states an invariant as a bug report.** *"One process"* had been read by
   several agents, this one included, as a description of a limitation. It was a description of an
   assumption, and the honest response to an assumption written in prose is to ask what enforces it.

## What this did not fix

- **The ledger cannot tell a wasted call from a useful one.** `outcome` in
  [`src/ai-spend.ts`](../../src/ai-spend.ts) is `"ok" | "error" | "aborted"` and means *the HTTP call
  completed*. Ten discarded responses are ten `"ok"` rows, and the six duplicate `read` calls are
  indistinguishable from one. Deliberately untouched — cost tracking is being worked on elsewhere and
  this belongs with it.
- **Two OS processes over one `data/` are still unfenced**, which the adapter has always said. `ps
  aux` on 2026-09-02 shows three `vite` servers from this checkout, and `spya-zf0bgj` and
  `spya-gv99gh` were both active on the same slug at once on 2026-08-30 — which `activeForSlug` is
  meant to make impossible. GPT Sol's reading is that this turns a possible eleven-call storm into a
  possible three-call one, and that the answer is to make `npm run dev` use Postgres by default or to
  refuse a second files-mode server. Both change how every agent on this box works, so both are
  Greg's call rather than something to fold into a bug fix.
- **Eleven more of the same class are still in the tree**, and they are named rather than moved. The
  full list, and what each one's duplication costs, is in
  [the plan](../plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md) — the two
  worth knowing here are [`src/store/ai-calls-fs.ts`](../../src/store/ai-calls-fs.ts)'s `writing`,
  the ledger's own append mutex, whose duplication can corrupt the file this bug was diagnosed from;
  and the four stores that say *"read-modify-write serialised per process"* in those words
  ([`src/comments.ts`](../../src/comments.ts), [`src/chat.ts`](../../src/chat.ts),
  [`src/searches.ts`](../../src/searches.ts),
  [`src/referee-criteria-store.ts`](../../src/referee-criteria-store.ts)), where the cost is a silent
  lost update of the reader's own comment or chat turn. Found by GPT Sol reviewing this fix; left
  alone because the ledger is another workstream's, `src/routes.ts` has a split in flight, and a
  promise chain kept for the life of the process is a chain one rejection can wedge for the life of
  the process — which is a question per site, and a separate piece of work.
- **An expired lease does not prove nobody is still spending.** Abort is cooperative and `walkClaim`
  explicitly handles a step that ignores its signal, so after an expiry the job can be terminalised,
  Retry pressed, and the new job's calls overlap the old computation still unwinding — overlapping
  spend on one article under different job ids. Under Postgres that is the whole of the residue;
  `claimIn`'s `update jobs … where status = 'queued'` means a second copy of anything is simply told
  `busy`.

## See also

- [260826a-toc-max-tokens.md](260826a-toc-max-tokens.md) — the same stage, the same article, a
  different bug
- [260902j](../plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md) — the plan,
  the options passed over, and GPT Sol's review of it
- [ingest-queue.md](../project/ingest-queue.md) — the claim, the lease, and what each adapter enforces
- [silent-success.md](../reusable/silent-success.md) — the family this belongs to: work that succeeded
  loudly, several times, at the same thing
