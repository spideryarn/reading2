# Review prompt: the built fix for the duplicate-claim cost storm

You are reviewing **built code**, in the Spideryarn repo. You reviewed the plan for this an hour ago
and said BUILD WITH CHANGES; this is the result, with your findings acted on. Be adversarial, and
weight this pass higher than the plan pass — a plan review cannot find a `PATCH` that writes one field
and then rejects the request.

## What changed, in one paragraph

The filesystem job store's mutual exclusion was module-scope state, and Vite restarts the dev server
**in the same process** on every save to a file the server imports, re-evaluating every server module
while the in-flight step keeps running. The new copy swept the `running` job back to `queued` and the
browser started the same eight-minute model call again — eleven times on one job, $5.43. The fix moves
that state to a `globalThis` singleton so it has the lifetime of the process, which is the lifetime
the file always claimed for it. `aborts` in `src/jobs.ts` moved with it, because a Stop after a save
had been reaching an empty map.

## What to read

1. The scoped diff and the two new files, together, in
   `/tmp/claude-1000/-home-greg-code-spideryarn2/055bc66d-d4bf-4794-924f-8c662035fb7e/scratchpad/code-diff.txt`.
   (`git diff HEAD -- src/ tests/` plus the two new files appended in full.)
2. `docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md` — the plan as it
   now stands, including a § *What this does not fix* that quotes your P1 about cross-process spend
   and leaves it as Greg's call.
3. `docs/postmortems/260902c-the-truncation-retry-cost-storm.md`.
4. The files themselves in their surroundings: `src/process-state.ts`, `src/store/jobs-fs.ts`,
   `src/jobs.ts`, `tests/two-servers-one-queue.test.ts`, `tests/jobs-walk.test.ts`,
   `docs/project/ingest-queue.md`.
5. `src/store/pg-jobs.ts`, `src/store/job-fence.ts` for the adapter that does not have this bug.

## The evidence behind it

**The mechanism was measured, not inferred.** On the box, `npx vite --port 5721`, then
`touch src/hierarchy.ts`:

```
2:12:58 PM [vite]   VITE v8.2.2  ready in 5829 ms
2:13:11 PM [vite] src/hierarchy.ts changed, restarting server...
2:13:13 PM [vite] server restarted.
```

**Both halves were watched red and then green**, against the real code and again against a mutation:

- `tests/two-servers-one-queue.test.ts` — three of its four cases fail with the state private to the
  module (`expected 'claimed' to be 'busy'` twice, plus the lease-settlement case). Green with the fix.
- `tests/jobs-walk.test.ts` § *"lets a Stop from a reloaded copy of this module reach the running
  step"* — red in two seconds against `const aborts = new Map(...)`
  (`the Stop must reach the step this copy is running, not only the row: expected false to be true`).
  Green with the fix. This case exists because you pointed out the store test cannot fail if `aborts`
  stays module-local.

**Ledger facts:** `spya-zf0bgj` 11 structure calls / $5.43 (Greg's figure, to the cent);
`spya-p38nga` 10 / $4.81; `spya-gv99gh` 2 / $0.82; `spya-v2f7b3` (the tiny `read` article) **6 calls,
all six `outcome: "ok"` and all six fine** / $0.30; `spya-ug2qtq` 1 call / $0.32, the control.

`npm run typecheck` clean. `npm test`: the failures are the same set as a baseline worktree at HEAD
(`pdf-*`, `block-policy-prompts`, `store-roundtrip`, `store-artefact-manifest`, `db-schema`,
`store-jobs-parity`'s Postgres arm), none of them touched by this change.

## What I want from you

Be concrete, cite file:line, and rank P0/P1/P2.

1. **Is the fence now real, and is it complete?** Is there any remaining path by which two copies of
   `src/store/jobs-fs.ts` in one process can both hold one job — anything still module-scope in that
   file or in `src/jobs.ts` that should have moved and did not? Enumerate the module-scope state in
   both files and say, for each, whether duplication is a correctness bug or merely a cold cache.
   `src/store/live.ts`'s `STORE`, `src/store/artifacts-fs.ts`, `src/store/ai-calls-fs.ts`,
   `src/routes.ts`'s in-flight sets and `src/db/client.ts`'s pool are the ones I did not move — say
   whether any of them is a lock wearing a cache's clothes.
2. **Did anything get worse?** Specifically: (a) a genuine process restart still recovers a `running`
   job via `loadFromDisk`/`sweepStopped` — confirm, because I have removed the *in-place* recovery
   deliberately and want to be sure the real one survives; (b) a job whose claimant's promise really
   did die (an uncaught throw, a killed request) is now held until the lease lapses instead of being
   swept on the next module reload — is 760s of wedge acceptable, and does anything call
   `settleExpired` often enough; (c) vitest: `globalThis` now carries state across `vi.resetModules()`
   and possibly across test files in one worker — is `forgetForTests` in `afterEach` sufficient, and
   can any existing suite be contaminated by a suite that ran before it?
3. **`src/process-state.ts` itself.** Is `Symbol.for` + unchecked cast the right shape? What happens
   when a restart reads a value written by a *different version* of the code — the file being edited
   is the ordinary case — and is the comment's advice ("change the shape the way a stored format is
   changed") enough, or does it need a version tag?
4. **The tests.** Are they honest? Does `vi.resetModules()` + fresh import genuinely reproduce the
   restart, or is there a way they pass for the wrong reason? Is the lease case now asserting the
   right contract (`settleExpired`, then exactly `finished`)? Is the Stop case's 2-second race a
   flake risk on a loaded box? Does changing `fakeStep`'s `body` to take a `StepContext` weaken any
   existing case in `tests/jobs-walk.test.ts`?
5. **The claim I most want challenged.** The plan says aborting the in-flight step on restart would be
   *wrong* now, because with the fence the abandoned run still holds the claim, its writes still pass
   the fence, and the ingest completes normally — so a restart is a pause, not a duplicate. Is that
   actually true end to end? Walk it: `server.close()` destroys the socket, the old copy finishes its
   step, calls `note`/`commit`/`finish` through the *old* module objects which now reference shared
   state, and writes artefacts through `fsStoreSession`. Does anything in that path fail because the
   HTTP response can no longer be written, or because the old copy holds a stale `STEPS` registry?
6. **Anything false** in the plan, the postmortem, or the comments. The comments make historical
   claims and I would rather have them corrected than flattering.

End with a one-line verdict: SHIP, SHIP WITH CHANGES, or STOP.
