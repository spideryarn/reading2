# Narrow check: do the fixes for F40, F41 and F42 actually hold?

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently`, branch
`worktree-delete-article-permanently`. TypeScript + ESM, Postgres via Drizzle (schema `spideryarn`).

**This is not a third round of review. General discovery is closed.** Under this repo's house rule
([docs/reusable/engineering-manager.md](../reusable/engineering-manager.md)) a stage gets two rounds
and then the author decides — but an established P0 or P1 whose *final fix* was not in the round-two
snapshot still gets a narrowly scoped check **of that fix**. That is exactly and only what this is.

You refused Stage C twice. Round one found F20/F21/F22; round two found F40, F41 and F42. This asks
one question: **do the fixes for F40, F41 and F42 hold?**

So please do not open new lines of inquiry into Stage C's design, its tests' style, its comments, or
anything Stage B or Stage D. If something genuinely severe leaps out while you are reading the fix
itself, report it — but number it from **F50**, and say plainly that it is outside the scope you were
asked for. F1–F43 are already issued and must not be reused.

## The candidate

```
git show 0be27422
```

changed paths:

```
git diff --name-only 0be27422^..0be27422
```

The fix lives in two functions:

- `requireWhatTheAllocationLeanedOn` in `src/store/pg-jobs.ts`, called from `enqueueIn` after the
  article lock and before the insert — this is F40 and F41.
- `strandedReservationsQuery` in `src/store/pg-shelf.ts`, called from `destroy` before
  `deleteTerminalJobs` — this is F42.

Supporting: `EnqueueTicket.retryOf` and `EnqueueTicket.adoptedFromJob` (`src/store/jobs.ts`), and
`SlugAllocation`'s queue branch now carrying `holder` (`src/jobs.ts`).

## What the three findings were, in your words

- **F40** — *"an in-flight Retry survives deletion and resurrects the article"*. P1, established.
  `retryJob` reads the old job on the pool; nothing locked it or required it still to exist by the
  time `enqueueIn` inserted.
- **F41** — *"`adopted from:"queue"` can also outlive deletion"*. P1, established. Queue provenance
  recorded only that *a* holder was seen, and that lookup is stale by insert time.
- **F42** — *"Postgres permits a terminal job with an unsettled reservation"*. P0, established.
  `deleteTerminalJobs` would erase the only job-to-reservation provenance and strand a quota slot
  for ever.

## How they were fixed, and the three places we departed from your prescription

The unifying idea: slug allocation lets a request proceed because of **something it saw** — an
article on the shelf, the attempt this retry repeats, or a live job minting this address. Each is a
fact about the moment of the lookup, and the insert happens later. So all three are now re-asked
inside the insert's own transaction, under the same `articles` row lock `destroy` takes.

Departures to judge on their merits:

1. **Existence, not terminal status, for the retried attempt.** You asked us to *"lock and require
   that same-owner **terminal** source job"*. We require only that it still exists. The argument:
   `retryJob` has already refused an attempt that is not terminal, and terminal is absorbing, so a
   status check here could only ever disagree with the check that already ran. Say if that is wrong.
2. **A 409 for the queue case, not the retry's 404.** Nothing the reader named is missing — they
   pasted an address and the job it was joining stopped existing underneath them; asking again works.
   The retry keeps 404 because that is the answer `retryJob` would have given a moment earlier.
3. **The queue-holder check is conditional on the article being absent.** A holder that finished by
   *publishing* leaves an article behind, and joining that is an ordinary shelf adoption. Without the
   condition the guard would refuse legitimate work.

One implementation note, in case you reach for it: `for update of jobs` raises `42601` here, because
drizzle schema-qualifies the table and Postgres wants the bare alias. Plain `for update` is used.

## What to attack

**Only these:**

1. **Is the F40/F41 guard actually inside the window it claims?** It runs after `lockArticleFor` and
   before the insert, in one transaction. Note that when the article has already been deleted,
   `lockArticleFor` matches no row and therefore locks **nothing** — this repo has a postmortem about
   exactly that shape (`docs/postmortems/260901f-a-for-update-that-locks-nothing.md`). We believe the
   serialisation then comes from the `FOR UPDATE` on the attempt row or the holder row instead, which
   `destroy` deletes in its own transaction. **Check that reasoning.** Is there an interleaving where
   neither lock is taken and the insert still lands on a destroyed slug?
2. **Can the guard refuse legitimate work?** Specifically: retrying an ingest that was cancelled
   while still `queued` (which never had an article, and which your original round-one fix would have
   broken); a second paste of a URL whose holder is still live; and a second paste whose holder
   finished by publishing.
3. **Does the F42 guard actually cover the hole you found?** It inner-joins terminal jobs for this
   slug to their `ingest_events` row where both `succeeded_at` and `released_at` are null, `FOR
   UPDATE`, and refuses. Is there a stranded reservation it cannot see — one whose job row is already
   gone, one linked some other way, one where only one of the two timestamps is null?
4. **Does the F42 guard make deletion refusable by something a stranger controls?** It is a new way
   for `destroy` to fail. Confirm it cannot be triggered by another reader.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file and
a script, and build a harness under `/tmp`. **You have no network, not even loopback**, so the
Postgres suites will fail rather than tell you anything — do not spend the run on them.

I have run them, on a recovered box, one file at a time: `tests/article-delete-pg.test.ts` **16/16**
(all the new work lives there, including two race cases and two positive controls),
`tests/store-shelf-pg.test.ts` 35/35, `tests/jobs.test.ts` 65/65,
`tests/one-article-for-one-address.test.ts` 4/4, `tests/owner-isolation.test.ts` 50/50,
`tests/authenticated-api-route-contract.test.ts` 322/322, `npm run typecheck` clean.

The races are made deterministic with a third connection holding the `articles` row — which is where
the enqueue stops — plus an assertion that the enqueue has **not** settled before the barrier
releases, so a test cannot pass on a window it never entered.

## Output

For each of the four questions above: **holds**, or a finding. For a finding give an ID from F50, a
severity, established or reasoned, (a) the input or mutation showing it fails, and (b) the smallest
change that closes it.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**If the three fixes hold, say so plainly and stop.** A short answer is the right answer here; there
is no need to find something. Refuse only on an established P0 or P1 **in these fixes**.

Do not change any file.
