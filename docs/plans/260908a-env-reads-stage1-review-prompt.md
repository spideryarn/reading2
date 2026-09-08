# Review built code, before it is committed: Stage 1 of the environment-read inventory

The repo is at `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`, branch
`worktree-env-names-literal`.

## The candidate — live, pre-commit

Base commit `7981430a` (which added only the three plan documents). Nothing else is committed, so
`git diff 7981430a -- <paths>` is the change for the tracked files, and the two new files are
untracked — **a diff command alone shows you nothing for those, read them directly**:

**Modified (tracked):**

- `src/env.ts` — `pinnedNames` parses a string; `loadEnvLocal` reads `process.env.SPIDERYARN_ENV_PINNED`
  literally and passes the set as a required 4th argument to `applyEnvFile`; `chooseTargetUrl` takes
  two URL strings rather than two environment records.
- `src/jobs.ts` — the read is literal; `CONCURRENCY_ENV` **deleted**; two comments reworded.
- `src/hierarchy-deepen.ts` — three reads literal; the three `*_ENV` consts kept.
- `src/fetch.ts` — `seen(name, value)`; the two reads literal at the call site.
- `src/web/lib/supabase.ts` — `required` indexes an ordinary object built from two literal reads.
- `src/vercel-health.ts` — one comment reworded (a stale `CONCURRENCY_ENV` reference).
- `tests/env.test.ts`, `tests/library-log-volume.test.ts` — signature changes only.

**Untracked — read these directly:**

- `tests/helpers/env-reads.ts` — the sweep. 971 lines, 685 non-comment.
- `tests/env-reads-are-literal.test.ts` — the gate. 389 lines, 28 assertions.

Start with `tests/helpers/env-reads.ts`, then the test, then `src/env.ts`. That is a reading order,
not a scope limit.

## What it is, and the history you need

`docs/postmortems/260827b-health-check-green-while-uploads-dead.md` item 1 asked for a static check
that every environment variable read under `src/` is accounted for in `src/vercel-health.ts`'s
`EXPECTED`. **You have refused two previous attempts**, most recently on 2026-09-07, across two
rounds and nine established P1s — every one of the same class: an environment read *silently
skipped* rather than refused. Those reviews are `docs/plans/260907e-stage4-review-sol.md` and
`-sol-2.md`; the parked 1,754-line candidate is `docs/plans/260907e-stage4-candidate.ts.txt`.

**You then designed this one.** `docs/plans/260908a-design-prompt-sol.md` is your own design answer
from earlier tonight, and `docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md`
is the plan built from it. **Do not defer to either.** A design you proposed in prose is exactly the
thing most likely to be wrong once it meets the tree, and I would rather you contradict yourself now
than agree with yourself into a third failure.

This is **Stage 1 only**: every read under `src/` is one of two literal shapes or one of five pinned
mechanisms. **The inventory — every collected name accounted for in `EXPECTED` or an allowlist — is
Stage 2 and is deliberately not asserted yet.** Do not report its absence as a finding.

## Run it yourself

Your sandbox has no network and no Postgres. This test needs neither:

- `npx vitest run tests/env-reads-are-literal.test.ts` — please run it, and **attack the assertions
  rather than trusting the green.**
- `npm run typecheck` is clean (I ran it).
- The database-backed tests are mine to run and I ran them one at a time: `tests/env.test.ts` (20),
  `tests/stage2c-raw-bytes.test.ts` (23), `tests/hierarchy-deepen-wave.test.ts` (42),
  `tests/unit-lane-has-no-database.test.ts`, `tests/deepen-eval.test.ts`,
  `tests/private-lane-survives-a-module-reset.test.ts`,
  `tests/store-boots-without-inherited-credentials.test.ts`, `tests/library-log-volume.test.ts`,
  `tests/google-availability.test.ts` — all green after the change.
- Red-first evidence is in the plan doc; the sweep named eight refused sites before the `src/`
  changes, and those eight are exactly the sites then changed.

## What I want, in order

1. **Find a read this sweep does not see.** That is the whole game and it is what beat both previous
   attempts. Write the file, run it through `sweepEnvReads`, and show me a spelling that is neither
   counted nor refused. The controls in the test name sixteen; find a seventeenth.
2. **Attack the five mechanism contracts.** Each pins a file plus an enclosing function. Can a name
   enter or leave one without the contract noticing? `src/sanitize-policy.ts` is the one I am least
   comfortable with — it is a **defence** (`docs/project/security-map.md`), nobody may edit it, and
   its contract must both permit the `globalThis` alias and force its three names into the inventory.
3. **The behaviour changes in `src/`.** `chooseTargetUrl` decides which database a command writes to.
   `applyEnvFile`'s new required `pinned` argument replaces a value it used to find itself. Is any of
   this a behaviour change rather than a refactor? Read `docs/project/database.md` and
   `docs/project/supabase-local.md` on what `DATABASE_URL` and `SPIDERYARN_ENV_PINNED` are for.
4. **Which assertions would still pass if the thing were broken?** Especially the positive controls
   and the constant-agreement table.
5. **The prose.** The plan doc and the source comments make factual claims about the tree and about
   what was measured. Any claim that is not true of what is in front of you is a finding.

## Severity — put one on every finding, with an ID (`P0-1`, `P1-1`, …)

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Say plainly if it is fine. End with a verdict: land as is / land with these changes / do not land.

## My own suspicions — already mine, worth less, spend most of the run elsewhere

- **The helper is 685 non-comment lines against a 250-line budget**, and the previous attempt died of
  exactly this growth. The author's own account: ~227 lines are `usesOf` plus three per-file rules,
  which is the least generalisable part; ~85 lines it would defend as "easier to write than to leave
  out", of which the clearest deletion candidate is a `gitNames.size !== 4` check that guards nothing
  the inventory needs. Tell me what you would cut, and whether cutting it opens a hole.
- **`applyEnvFile`'s rule is a syntactic proxy**: "the index property must be *spelled* `name`",
  rather than resolving the binding. That is deliberate — resolving it is the scope analysis this
  design deleted — but it means a shadowed `name` inside that function would pass. Is that reachable?
- **The controls live in `mkdtempSync`, not `tests/fixtures/`**, because one of them must not parse
  and an unparseable `.ts` in the repo would be a red typecheck rather than this gate speaking. Their
  relative paths therefore begin `../`, so no `src/…` contract can match one. I think that is right;
  say if it hides something.
- `src/jobs.ts`'s `CONCURRENCY_ENV` was **deleted** rather than kept-and-guarded, because after
  literalisation nothing imported it. `DEEPEN_ENV` could not be, because `evals/deepen/run.ts`
  imports it. Is the asymmetry right?
