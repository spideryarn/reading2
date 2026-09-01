# Review the revised plan before it is built

Nothing here is built yet. You reviewed the *design questions* behind this on 2026-08-31 and your
answer is folded in. Since then a second model (Fable) pressure-tested the plan against Greg's
instruction to do this "in the cleanest, long-term-best way (which could include refactoring)", and
the plan changed shape: from six independent patches to one refactor plus four smaller stages.

**Read `docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md` in full**, then the
code it names. Your job is to find what is wrong with it *before* an agent starts building.

## What changed since your last answer, and what I want you to check

**Stage 1 became a refactor.** Your answer said "move the driver to the application shell". Fable
argued the incremental reading of that is incoherent — a shell driver must *discover* jobs before it
can drive them, so "move `drive`, leave the poll with the cards" ends in two pollers and two accounts
of one list. So stage 1 is now: a module-scope singleton `src/web/jobEngine.ts` owning the poll
timer, the jobs snapshot, the visibility rules and the `drive()` loops, with `useJobs` reduced to a
`useSyncExternalStore` subscriber plus the action methods.

1. **Is that the right call, or is it over-building?** Say plainly whether you would ship the
   singleton or the smaller thing, and what the smaller thing would actually be if you would.
2. **Module-scope singleton vs React context.** Fable's argument against a provider is that
   `App()` is a chain of early returns with no persistent shell component, so a provider means
   restructuring every route branch, and its whole purpose would be never to unmount — which React
   grants only by accident of reconciliation. Is that reasoning sound? Is there a third option?
3. **The `onFinished` replay hazard.** Today every `useJobs` mount owns an `announced` ref and a
   first-poll baseline. With one engine, a late-mounting subscriber replays historical `done`s unless
   each keeps its own baseline. Fable calls this "the real cost and the place a review should stare".
   Stare at it. `src/web/useStepJob.ts` and the glossary/ideas/quotes/tweets surfaces depend on it.
   What is the correct semantics, and what is the test that pins it?
4. **The visibility rules.** `useJobs.ts` has three, each of which was a bug first: `drive` continues
   while hidden, the poll pauses, a hidden `poke` still makes one reconciliation request. Which of
   these is most likely to be silently lost in the move, and what would catch it?
5. **`start()`/`stop()` and 401.** The engine cannot poll unconditionally (a signed-out landing page
   would 401-loop), so it starts from a `useEffect` keyed on `user`. Is that the right seam? What
   does a mid-session 401 have to do, and what happens on sign-out with a job still running?

## The other stages, briefly

Stage 2 — `failExpired` settles a `cancelling=true` row as `cancelled` not `error`/INTERRUPTED;
`requestCancel` grows an expired-lease branch that goes straight to `cancelled` and **must null
`draftRevisionId`** (Fable's catch — the running branch deliberately leaves it, and
`sweepAbandonedDrafts` would spare that draft for ever). Plus the matching fs-adapter branch.

Stage 3 — `failExpired(now?, owner?)`, owner-scoped, called from `listJobs()` only when the list
already contains a `running` job. Not inside the adapter's `list()`.

Stage 4 — `src/job-state.ts` mapping `Job` to a **display** state, never taking lease timestamps,
because `Job` on the wire carries no lease.

Stage 5 — elapsed time from `JobStep.startedAt`, distinct copy per state, the 409 naming its job,
and saying the browser dependency out loud.

6. **Is the stage ordering right, and is each stage a genuinely safe stopping point?** If the job
   were abandoned after stage 2, or after stage 3, is what landed coherent on its own?
7. **Stage 3's candidate test.** Fable argues it must be "any running job" rather than "any expired
   lease", because the app-level `Job` cannot see leases. Agreed? And is the claim right that an
   indexed `WHERE` matching zero rows costs nothing worth gating on?
8. **What is still missing, and what will this break that nobody has named?** Be specific about
   files and functions.

## Facts you can rely on

- Production is Vercel, no cron, one function; `pump()` in `src/jobs.ts` returns early on `VERCEL`,
  so the browser is the only thing calling `/advance`.
- `LEASE_MS = 760_000`; the claimant self-aborts at `LEASE_MS - DEADLINE_MARGIN_MS` = 740s; the
  platform kill is 800s.
- `failExpired` currently has exactly one caller, `advanceJob`, and is a single global `UPDATE` over
  `status='running' AND lease_expires_at < now()`.
- `jobWorthRetrying` has just moved from `AddArticle.tsx` to `src/job-failure.ts` in a peer's
  in-flight work.
- No migration is needed: `cancelling` and `lease_expires_at` both exist.
- Several agents share this working tree, so `src/jobs.ts`, `src/messages.ts` and
  `src/web/AddPage.tsx` currently carry other people's uncommitted work.

Be concrete, name files and functions, and where you disagree with Fable say so directly.
