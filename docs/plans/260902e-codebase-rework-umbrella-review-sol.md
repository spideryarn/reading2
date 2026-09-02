## Verdict

The prioritisation is not right. The plan defers a code-confirmed race, misses another Tier 0 defect, resurrects an abstraction explicitly rejected by the previous review, and overvalues the migration-config tidy-up. Stage 1 was chosen for convenience, not value.

## Findings

1. **High confidence — 0.1 is a real, reachable Tier 0 bug, and “pending reproduction” is a dodge.**

The opening effect starts `load()` while `useStepJob` can call the same function when a job completes. `useJobs` deliberately drains completions after commit. Nothing orders those requests, so a newer completion response can land before an older opening response, which then overwrites it: [useIdeas.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/useIdeas.ts:97), [useIdeas.ts:135](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/useIdeas.ts:135), [useIdeas.ts:142](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/useIdeas.ts:142), [useJobs.ts:259](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/useJobs.ts:259).

Glossary’s comments describe precisely why a completion refresh must not join or lose to an opening request: [useGlossary.ts:103](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/useGlossary.ts:103). More decisively, wave 2 already concluded that the race is reachable and supplied the deterministic test recipe: [wave 2:225](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/plans/260828aj-simplification-wave-2.md:225), [wave 2:239](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/plans/260828aj-simplification-wave-2.md:239). The umbrella’s claim that reachability is merely a new subagent assertion is therefore false: [umbrella:54](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/plans/260902e-codebase-rework-umbrella-what-is-worth-doing-next.md:54).

Reproduction is still required before fixing it, but it is the first action inside Tier 0—not grounds for doing Tier 1 first.

The count is also wrong. `useStepJob` itself lists eight surfaces, not seven: [useStepJob.ts:31](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/useStepJob.ts:31). `Tweets.tsx` has the same unguarded opening load and completion reload: [Tweets.tsx:133](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/Tweets.tsx:133), [Tweets.tsx:184](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/Tweets.tsx:184), [Tweets.tsx:209](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/Tweets.tsx:209). The actual result is **seven of eight surfaces exposed**.

2. **High confidence — the map missed a smaller, immediately fixable Tier 0 defect.**

`PATCH /api/chat/:slug/:threadId` destructures the result of `readBody()` without first checking it is an object: [routes.ts:6360](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:6360). A body of JSON `null` is valid, but destructuring it throws `TypeError`; the generic handler maps that to 500: [routes.ts:5435](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:5435).

The adjacent search PATCH documents this exact failure class and explicitly warns that it remains latent in other PATCH routes: [routes.ts:6400](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:6400). Search has a regression test; chat does not: [routes.test.ts:1274](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/tests/routes.test.ts:1274).

This is the best genuinely small first stage: red route test, object validation, green. Effort S, value medium, risk low.

3. **High confidence — Tier 2.3 contradicts the prior decision it claims to follow.**

The umbrella says the design is settled and calls for `stageCall / articleSystem`: [umbrella:134](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/plans/260902e-codebase-rework-umbrella-what-is-worth-doing-next.md:134). Wave 2’s reviewed conclusion was the opposite:

> Build `articleSystem` in `article-prompt.ts`. Do not build `stage-call.ts` or `stageCall`.

See [wave 2:193](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/plans/260828aj-simplification-wave-2.md:193).

The ten `streamMessage` calls are not one genre. `labels` caches a batch prefix; `hierarchy` supplies a prebuilt system/user pair; the other eight put a rendered article first, using either `articleText` or `articleWithIds`. Counting API calls is not proof of a shared abstraction.

Retain only the narrow `articleSystem` candidate and re-verify its current callers. Delete `stageCall` from the map. This is the clearest place where the skill’s anti-overengineering guidance failed to affect its own first run.

4. **High confidence — the original Stage 1 was the wrong cluster.**

The original 1.1 parity test would have preserved three copies. The current work correctly changed course and merged them beside the existing hash query, but the umbrella itself admits that the planned fix was wrong: [umbrella:65](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/plans/260902e-codebase-rework-umbrella-what-is-worth-doing-next.md:65). That is a useful correction, but it also disproves the claim that every finding was verified before scoring.

Item 1.2 is overvalued. The live migration command already imports the two constants and passes them directly to `migrate()`: [db-migrate.ts:249](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/scripts/db-migrate.ts:249). The remaining copy is in [drizzle.config.ts:30](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/drizzle.config.ts:30), while `npm run db:migrate` runs the custom script, not Drizzle Kit: [package.json:36](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/package.json:36). The config also deliberately has no credentials.

That copy should probably import the constants directly, but its value is **low**, not medium-high. A parity test would check an mostly inactive relationship and could falsely imply the live migration call is protected.

There is also a process breach: the skill and engineering-manager both require review before implementation—[skill:109](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/reusable/improve-the-codebase.md:109), [engineering-manager.md:23](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/reusable/engineering-manager.md:23)—yet the umbrella is untracked while the source-hash implementation is already in the working tree.

5. **High confidence — the `routes.ts` split is materially underplanned.**

“Structurally one export and one importer” is false: [umbrella:143](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/plans/260902e-codebase-rework-umbrella-what-is-worth-doing-next.md:143). The module exposes 13 symbols, including test seams such as `serveAuthenticatedApi`, parsers, heartbeat helpers and concurrency helpers; 47 test files import route symbols.

A route/method matrix protects only dispatch. It does not protect:

- The request-wide owner and spend scopes: [routes.ts:5265](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:5265).
- Authentication, monitoring identity and error/logging boundaries: [routes.ts:5569](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:5569).
- Order-sensitive overlaps such as `/library/search` versus a valid `search` slug: [routes.ts:5617](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:5617).
- Resource-owned process state such as `answering`, `streaming`, `searching` and `refereeing`: [routes.ts:746](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:746), [routes.ts:1686](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:1686), [routes.ts:3102](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/routes.ts:3102).

**Medium-confidence judgment:** splitting it is probably worthwhile, but a matrix does not turn it into a low-risk “pure extraction.” It should remain Tier 3 until the plan inventories exported seams, shared state, wrapper boundaries and overlapping routes. Then extract one resource family per green commit while retaining the outer request envelope.

6. **High confidence — the map is incomplete in predictable ways.**

The semantic sweeps were limited to `src/`: [umbrella:7](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/plans/260902e-codebase-rework-umbrella-what-is-worth-doing-next.md:7). That underweights operational code such as `scripts/gjd-remote.ts` (2,721 lines, 22 commits in 90 days), `scripts/deploy.ts` (1,514/14), and `scripts/deploy-checks.ts` (1,085/13).

Even inside `src/`, the map misses an unusually explicit candidate: `App.tsx` says five timeline effects duplicate five Ideas rules, that every rule has previously been wrong, and that a shared hook is the intended follow-up: [App.tsx:3044](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/src/web/App.tsx:3044). That belongs in Tier 2 and is a much better starting seam for App than “split a 4,734-line file.”

Static sweeps also systematically miss timing behavior. The race itself demonstrates that. A rework audit needs at least one pass through unresolved prior-review findings and behavior-oriented tests, not just source greps and complexity.

## Better order

I would reorder the work as follows:

1. Fix the malformed chat PATCH as a small red-first Tier 0 stage.
2. Reproduce the same-slug read race using wave 2’s existing test recipe; promote it unequivocally.
3. Plan the narrow sequencing mechanism already proven by Glossary, accounting for all eight surfaces. Do not generalise their response state.
4. Land the now-correct source-hash merge.
5. Directly deduplicate the Drizzle config constants, but score it low.
6. Reconsider only `articleSystem`; reject `stageCall`.
7. Write a separate routes-split plan with the larger prerequisite set above.

## Skill assessment

The skill has a strong bar, but the first run broke its most important rules: count the whole genre, verify before scoring, prove drift, and put live defects first: [skill:50](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/reusable/improve-the-codebase.md:50), [skill:79](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/reusable/improve-the-codebase.md:79), [skill:90](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/reusable/improve-the-codebase.md:90).

It needs three enforceable additions:

- Record audit scope and excluded directories.
- Give every finding a separate evidence state: reproduced, code-proved, or hypothesis. Tier and confidence must not be conflated.
- Require a reachable call path or deterministic reproduction before assigning correctness value, and require the first stage to address the highest confirmed tier unless risk explicitly vetoes it.

It should also delete the generic stage/review/doc-update material that repeats `engineering-manager.md`; [skill:114](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/reusable/improve-the-codebase.md:114) and [skill:151](/home/greg/code/spideryarn2/.claude/worktrees/routes-split/docs/reusable/improve-the-codebase.md:151) mostly restate their parent. Keep only the rework-specific traps.

I could not execute Vitest in this read-only sandbox because Vite attempts to write `node_modules/.vite-temp`. The race and malformed-body conclusions are therefore based on direct control-flow proof and the repository’s prior reviewed analysis, not a fresh executed reproduction.