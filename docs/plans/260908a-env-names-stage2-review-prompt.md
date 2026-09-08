# Review: Stage 2 of the environment-variable inventory

You are reviewing **built code**, not a plan. Weight this higher than a plan-stage review: a plan
review cannot find an assertion that is vacuous, a door that is read from the wrong place, or a
justification that is factually false about the tree.

Repo root for this review: `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`
(a git worktree of the Spideryarn repo, branch `dev`). Read files with absolute paths under it.

## The context you need

- The plan: `docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md`.
  Read § *Stage 1 — what actually landed* and § *Stage 2 — what actually landed* (new, written by
  me, and itself in scope for this review — if it claims something the code does not do, say so).
- Stage 1, already landed and reviewed by you five times, is
  `tests/helpers/env-reads.ts` (the sweep, 1067 lines — its header carries the reasoning and the
  declared boundary) and `tests/env-reads-are-literal.test.ts` (the gate). **Stage 1 is out of
  scope except where Stage 2 leans on it wrongly.** Do not re-litigate its package-bridge boundary.

## What Stage 2 is

`tests/env-names-are-inventoried.test.ts` — **new, and the only new file**. It asserts that every
environment name Stage 1's sweep collects under `src/` is accounted for in exactly one of four
doors:

1. `EXPECTED` in `src/vercel-health.ts` (a row's `or` alternative included);
2. the required client build inputs — `missingClientEnv` in `scripts/build-stamp.ts`;
3. a written allowlist in the test file, grouped, one reason per group;
4. `PROD` and `MODE`, Vite compile-time constants, not variables at all.

A name in no door is red. A name in two doors is red, except one declared and pinned overlap. The
reverse also holds: an allowlisted name (or a listed Vite built-in) that nothing under `src/` reads
any more is red, and an `EXPECTED` row nothing reads is red unless `READ_OUTSIDE_SRC` declares why
the platform or an SDK reads it on our behalf (the `ANTHROPIC_API_KEY` category — see
`docs/postmortems/260827b-health-check-green-while-uploads-dead.md` items 1 and 2).

**No `src/` file was changed.** Both previously-unaccounted names (`SPIDERYARN_ORIGINS`,
`VERCEL_PROJECT_PRODUCTION_URL`) went to the allowlist, so `src/vercel-health.ts` was not touched.

## Evidence

- **Red first**, with doors 3 and 4 empty: 32 names named, each with its read site. Output at
  `/tmp/claude-1000/-home-greg-code-spideryarn2/404961e7-a9af-47c9-bf9e-38918ba8ffc4/scratchpad/envlitS2-red-first.txt`.
- **Five mutations of the finished code**, each verified to have actually applied (its diff is
  printed beside its run, and a non-unique match aborts rather than no-opping). Results at
  `.../scratchpad/envlitS2-mutations.txt`. Each failed exactly one assertion.
- `npm run typecheck` clean; `npx biome check` on the new file clean; both stage tests green
  (60 tests).

## What I want you to attack, in this order

1. **Is any assertion vacuous, or green for a reason other than the one it claims?** Every check
   here is "this list is empty", and an empty list is also what a broken derivation produces. In
   particular: `readExpectedTable()` parses `src/vercel-health.ts` syntactically rather than
   importing it — can it silently return fewer rows than the table has, or miss a row shape, in a
   way that makes a name look accounted for or unaccounted for? Can `missingClientEnv({})` stop
   being the right derivation of door 2?
2. **Is any allowlist justification factually false about the current tree?** This is the specific
   failure this port was most likely to reproduce — the reasons come from a parked candidate
   (`docs/plans/260907e-stage4-candidate.ts.txt`, from line ~203) and you yourself found four of its
   groups making a false claim last time. I re-checked all of them and rewrote three; check my
   rewrites too. A reason that is false is worse than no reason.
3. **Are the two door decisions right?** `SPIDERYARN_ORIGINS` (read `.env.example` around line 231
   and `docs/project/security.md` around line 1053) and `VERCEL_PROJECT_PRODUCTION_URL`, both read
   by `ownOrigins()` in `src/sanitize-policy.ts` — which is a **defence** and must not be edited.
   I put both on the allowlist. Argue the other way if you can.
4. **The declared overlap.** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are in both
   `EXPECTED` and the build door. I pinned the intersection exactly rather than tolerating it. Is
   that the right resolution, and is the pin actually two-directional?
5. **The failure message.** A rule set the same night: *the remedy a guard suggests is the part
   people act on, more than the diagnosis*. The message must state the question and name all four
   doors, not suggest a default. Does it, and would a reader who has never seen this plan pick the
   right door from it?
6. Anything else that would let this gate be green over drift.

Give findings as P0/P1/P2/P3 with file and line, and say plainly at the end whether Stage 2 should
land as it stands. **Check your own conclusion against your findings before you write it** — if the
findings are all P2/P3, say so rather than manufacturing a refusal, and if there is a real P0/P1,
do not soften it.
