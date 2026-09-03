## Verdict

Request changes before building.

The sweep itself is worthwhile, but the plan’s central causal story is not supported by the spot-check, and the proposed `DEFECT:` convention is weaker than the behaviour it would replace. I would keep a small set of confirmed fixes, split out the design questions, and remove Stage 4’s convention.

## Findings ranked by impact

1. **Blocker — the claimed “top item lands; lower items never do” pattern is false.**
2. **Blocker — a positive test asserting defective behaviour is not a mitigation.**
3. **High — partial block-ID loss needs an anchor-aware policy, not a generic partial-loss alarm.**
4. **High — Stage 1 mixes confirmed chores with distinct lifecycle/product decisions.**
5. **High — the reported test flake does reproduce here; the plan records an unsupported explanation.**
6. **Medium — content extraction belongs in a dedicated next plan, but “next weekly sweep” is precisely another paper deferral.**

## 1. Central empirical claim: reject

My four spot-checks produced a mixed picture, not a positional one.

| Postmortem | What is built now |
|---|---|
| [`260902c`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/docs/postmortems/260902c-a-test-whose-evidence-was-one-laptop.md:87>) | All five ranked recommendations landed. The follow-up plan explicitly says stages 1–5 landed, and the code has the shared artefact list, tracked-corpus coverage, detached-HEAD test, forced-gate work, and gitignored-link ban. |
| [`260901d`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md:161>) | #1 remains open, #3 landed, #4 remains open. That is the inverse of the claimed pattern: a lower recommendation landed while the top one did not. |
| [`260903c-cache`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/docs/postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md:183>) | The long-term fix and all five ranked preventions appear open. The later-only call remains, the unit test still pins the one-sided predicate, and the batched eval still does not judge cache reads. |
| [`260827b`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/docs/postmortems/260827b-health-check-green-while-uploads-dead.md:274>) | The later build-time sentinel did land; the static environment-contract check did not. Even this postmortem is not clean evidence for “lower items essentially never land.” |

Therefore:

- “The first recommendation often lands” may be true.
- “The failure is positional” and “deferred items essentially never land” are not established.
- “Do items 2-and-below in the same commit or not at all” does not follow from the evidence.

The full ~50-row census needs to be preserved with explicit definitions of “recommendation,” “top-ranked,” “built,” and follow-up cutoff. Otherwise remove the numerical and causal claims at [plan line 106](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/docs/plans/260903e-sweep-recorded-rather-than-fixed-defects.md:106>).

There is also an immediate self-contradiction: Stage 2 proposes the lower test-count guard from `260830d`, while that postmortem’s two explicitly named long-term fixes remain open. `params.ts` still value-imports component modules, and `api.ts` still subscribes at module load. See [`260830d`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/docs/postmortems/260830d-a-constant-that-dragged-in-the-shelf.md:89>) and [`params.ts`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/web/params.ts:26>).

## 2. Stage 1: split it

The organising principle is descriptive, not operational. These changes do not share a seam, test strategy, reviewer, or rollback boundary.

I would split it as follows:

- **Data/safety fixes:** `db-export`, `pgCommentStore`, `keepTheOriginal`.
- **Layout fix:** CSS/JS breakpoint, with its browser verification.
- **Streaming lifecycle audit:** separate work, after deciding which streams should survive panel closure.

The plan has correctly withdrawn `recentHistory`; it should remain out. The existing behaviour is an explicit decision with a positive test, not an overlooked sibling fix. [`recentHistory`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/converse.ts:1164>) deliberately keeps stopped text and drops interrupted text.

The five SSE hooks are also not one mechanical omission. In particular, [`useChat`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/web/useChat.ts:357>) says the controller and stream outlive the hook on purpose so a pending stop still reaches the server. Aborting it on unmount would reverse a documented behaviour. `useClaims` prevents stale writes but lets the old stream continue; that may be a leak, but it is a different lifecycle decision. Audit the five individually and explicitly exclude `useChat` unless its controller contract changes.

The breakpoint item is genuine and well specified. It deserves its own small UI stage rather than being bundled with database and PDF correctness.

## 3. Partial block-ID loss: protect consequences, not the proxy

The existing comment is half right:

- `carried < before.size` is an objective fact.
- It is **not objectively a defect**.

A legitimate article edit, deleted paragraph, changed extraction result, or substantially rewritten block can all remove an old ID. Refusing every partial loss would make normal source changes impossible and conflict with the principle that a missing anchor is safer than a wrongly attached one.

Conversely, “one of 139 survived” is obviously too weak a success criterion. [`assertIdsCarried`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/blocks.ts:1466>) proves the matcher ran at least once; it does not prove reader-owned anchors survived.

The threshold-free policy is:

1. Compute the old IDs absent from the candidate revision.
2. Intersect them with IDs actually referenced by persisted reader data—comments, notes, highlights, questions, and any other anchored records.
3. If the intersection is empty, permit publication and retain the carried/minted measurement.
4. If one or more real reader anchors would detach, refuse automatic publication and surface an explicit review/override describing the affected records.

That has no guessed percentage: zero affected reader anchors versus at least one.

Also, “destroys reader data” is imprecise. The comment identity remains stored; it becomes detached from current prose. That is serious, but the distinction matters when choosing refuse versus recovery UI.

I would replace Stage 3 item 2 with a design stage for this anchor-aware publication check. Do not ship a generic Sentry event for every partial loss: ordinary article changes would turn it into noise. If the anchor intersection is too large for this sweep, leave the current behaviour unchanged until that design is ready.

## 4. Convention: reject `DEFECT:` tests

A positive test asserting today’s wrong answer has backwards pressure:

- It remains green while the defect harms readers.
- It goes red when somebody fixes the defect.
- It converts a known defect into suite-approved expected behaviour.

That is not merely pressure-neutral; it risks normalising the defect.

The proposed candidate demonstrates the problem. [`collect-assets.ts`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/src/collect-assets.ts:52>) has a process-global concurrency gate admitting two requests. It may make up to 400 attempts over time, but it cannot “burst ~400 requests at one host.” The existing test already proves only two leave after the deadline and that the gate drains to zero. A `DEFECT:` test here would institutionalise a defect that has not been demonstrated.

A better rule is:

> A deferred live defect must either be fixed, be explicitly accepted as a product limitation, or emit a harm-coupled signal into a channel with a named consumer and action.

Important details:

- A log line is not observable merely because it exists.
- A Sentry breadcrumb may never be seen unless another event occurs.
- The signal must correspond to the harmful consequence, not merely a proxy.
- A test should always assert the intended behaviour. If known-failing tests are ever wanted, they belong in an explicitly reported non-gating lane—not as green assertions of wrong output.

For this alpha, I would build no new universal machinery yet. Fix the confirmed defects, distinguish defects from accepted limitations in postmortems, and revisit tooling only after two or three real deferrals reveal a common executable shape.

## 5. Scope: too broad as written

I would reduce this plan to:

1. `db-export` target resolution and `Target:` output.
2. `pgCommentStore` export guard.
3. `keepTheOriginal` cache validation.
4. The breakpoint fix.
5. The quiz `overCap` diagnostic, only if it reaches an actually monitored failure signal.
6. Correct the stale build-sentinel prose.

Move elsewhere:

- SSE lifecycle: separate audit/design.
- Partial block-ID loss: dedicated anchor-aware design.
- Collected-test count: reconsider after fixing the import chain; an exact count is likely maintenance tax.
- `DEFECT:` tests and reusable convention edits: drop.
- Conflict markers and Biome config detection: a small tooling plan, unless they are genuinely trivial additions to an existing check.

Content extraction should **not** be added as another stage. It is large and already has two substantial spikes. But it should become the next named plan, not “top of the next weekly sweep.” The measured degradation affects the flagship tree and zoom feature, and [the project doc](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/docs/project/content-extraction.md:134>) says nothing reports it. If priorities force a choice, I would do content extraction before the new defect-convention machinery.

## 6. Falsified assertions and the test run

Confirmed:

- `db-export.ts` lacks the shared target-resolution/`Target:` treatment.
- `pgCommentStore` is raw at its own export and wrapped at the composition root.
- `keepTheOriginal` accepts any non-empty `raw.json`.
- The 832–843px breakpoint disagreement is real.
- The quiz failure diagnostic omits `overCap`.
- The cache predicate remains later-only.

Falsified or not established:

- The postmortem failure is positional.
- Lower recommendations have essentially never landed.
- The five SSE hooks all require the same unmount fix.
- `collect-assets` can burst roughly 400 requests concurrently at one host.
- A positive `DEFECT:` test is an executable mitigation.

I ran:

```text
npx vitest run tests/step-failure-seam.test.ts
```

twice. Both runs produced **5 failed, 2 passed**, not 7/7. I also selected the first test alone; it still failed.

The failures included:

- Two “no file on disk for job” failures.
- Declared `MODEL_REFUSED` returning the generic `[jb-step-again]` sentence.
- Expected `failureKind: "blocked"` returning `undefined`.
- A stopped run ending as `"error"` rather than `"cancelled"`.

Caveat: this review harness cannot write to the checkout, so the two disk-persistence failures are likely environment-induced. The test itself is not hermetic: it drives public `enqueue/getJob` store selection but then inspects the filesystem under `data/` directly at [`step-failure-seam.test.ts:109`](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/tests/step-failure-seam.test.ts:109>). That also makes it questionable under the repo’s required Postgres testing mode.

I therefore do **not** agree with [the plan’s flake paragraph](</home/greg/code/spideryarn2/.claude/worktrees/worktree-recorded-not-fixed/docs/plans/260903e-sweep-recorded-rather-than-fixed-defects.md:132>). “Contention is likeliest” is unsupported, and recording that conjecture in prose is this plan’s own anti-pattern.

Record the exact commit, environment, commands, passing and failing signatures; then make the test hermetic or provide a repeatable stress command. Until it passes in an ordinary writable worktree and the semantic failures are explained, the plan cannot say it did not reproduce.

In short: the motivating observation is right, but the plan has turned it into an unsupported positional theory and a backwards test convention. Keep the sweep; discard those two pieces.