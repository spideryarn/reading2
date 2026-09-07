# Review this plan before anything is built

You are reviewing a **plan**, not code. Nothing has been implemented. The most valuable thing you
can tell me is that the plan is wrong, or that it should not be done at all.

## What to read

Working tree at `/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain`, branch
`worktree-api-dispatch-by-domain`. `src/routes.ts` is byte-identical to `origin/dev` at `d4b503b4`
(verified: `git diff d4b503b4 HEAD -- src/routes.ts` is empty), so every line number is live.

- **The plan**, untracked, at `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`.
- **The subject**: `src/routes.ts:6555–8180` — `serveAuthenticatedApi`; caller `serveApi` at
  `:6277`, awaiting at `:6401`.
- **The prior decision I am partly following and partly overriding**:
  `docs/plans/260906h-improve-the-codebase-fourth-sweep.md:564–599` (§ T3.1).
- **The sibling**: `src/public/routes.ts`, which runs a real data-driven table.
- **The constraint that worries me most**: `tests/cacheable-covers-artefact-routes.test.ts:105–140`.
- Also: `docs/postmortems/260901a-the-route-the-query-string-hid.md`,
  `docs/project/admin.md:86–96`, `tests/routes.test.ts:569–575` and `:2078–2335`,
  `tests/owner-isolation.test.ts:1299–1327`, `tests/public-dispatch.test.ts:126–270`,
  `tests/the-query-string-does-not-decide-the-route.test.ts:137`.

## Background

Greg asked whether any large files should be refactored and told me to run the job autonomously. He
named `serveAuthenticatedApi` and proposed a **route table**.

This repository rejected a route table three times, most recently the day before this plan, settling
on per-domain `Promise<boolean>` functions instead (260906h § T3.1). GPT 6 Astra, asked
independently, argued for an ordered table with no boolean protocol. Fable, asked only about scope,
argued for per-area modules contributing ordered slices.

**I have settled that fork myself**, and the plan's § *The shape, and the fork that had to be
settled* gives the reasoning: an ordered list of static entries, grouped by domain inside one array,
gates outside it, no boolean return. My argument is that 260906h's objection is to a *data-driven*
table (behaviour derived from data, as in `src/public/routes.ts`) and that an ordered list of
closures is not that; and that a `Promise<boolean>` protocol would create fourteen instances of the
fallthrough hazard this repo already documented at `src/public/routes.ts:361`.

**Tell me if that reasoning is wrong**, in any direction — including that I should have built what
Greg asked for, or that I should not touch this at all given 260905b records splitting `routes.ts`
as *"Tier 3, Greg's call, and already refused"*.

## What I want from you

1. **Is the settled shape right, and is my reading of 260906h fair to it?** I am overriding a
   decision made yesterday by an agent that had surveyed the whole tree. If that override is wrong,
   say so plainly.

2. **Stage 1 is the crux: a route/method matrix test that does not exist and has been asked for four
   times.** Its design is Astra's: an AST-derived structural manifest from the frozen original as
   the universal oracle, plus differential branch-entry execution over a finite corpus for
   executable counterexamples. Read the stage and tell me where it is wrong or insufficient. In
   particular: is the structural manifest genuinely sufficient to establish selection equivalence
   for all path strings, given the gates are preserved and matchers are pure? What does that
   argument assume that is not true here?

3. **Verify the claim the plan leans on hardest**, because if it is wrong the mutation controls are
   wrong: that **there are no competing same-method endpoint guards**, and that both documented
   overlaps (`/api/library/search` vs the shelf `:slug`, `/api/chat/:slug/live-tool` vs the thread
   `:id`) are resolved by the method rather than by the order — so swapping the library guards is an
   **equivalent mutation** and useless as a positive control. I verified the two pairs by hand;
   I have not verified the universal claim. Check it across all 81 guards.

4. **Constraints 1–9 in the plan.** Are any wrong, and what is missing? Especially [DECODE]
   (body-read vs slug-decode order differs per route, so no single decoding policy preserves both),
   [LIFETIME] (streaming handlers must stay awaited; the spend collector depends on it at `:6246`),
   and [RETURN] (`similar` `:7477` and `projection` `:7515` return `withSpendAttribution(...)` from
   an inner block rather than ending in a top-level `return;`).

5. **Is the 404-not-405 claim right** — method mismatch on a matching path falls through to `:8177`,
   and there is no 405 anywhere on this surface?

6. **Staging.** Is "stage 1 alone is a defensible finish" right? And is the plan's decision to
   re-judge after two domains, rather than run through all fourteen, the right shape — given the
   domains touching the module-scope lock registries (`:1010`, `:3800`, `:3970`, `:4211`) are harder
   than the rest?

## Ground rules

- **Do not modify any file.** Read and reason only.
- Your sandbox has no network, not even loopback. Anything needing Postgres is mine to run — say
  what you want run and I will hand you raw output. Do not assert a test result you could not
  execute. You *may* run a test needing nothing outside the tree, and a finding you reproduced
  outranks one you reasoned to.
- Severity and an ID on every finding: **P0** breaks security or correctness, **P1** would cause a
  real bug or make the plan fail, **P2** is a judgement call, **P3** is a nit.
- The project prefers boring, simple over easy, simplest version first. A proposal adding a
  framework or dependency will be rejected.
- If your honest answer to "should this be done" is no, lead with that.

## My own suspicions, last so they do not anchor you

- That stage 1 is most of the value and stage 3 is optional.
- That the merge-collision argument, which is the main remaining justification, proves too much.
- That extracting a domain touching the lock registries is materially harder than one that does not,
  and that "one domain per commit" understates the difference.
- That I may be over-trusting Astra's AST inventory (81 guards, 67 matchers, 27 nested) because it
  matched my own cruder `awk` count. Both could share an assumption.
