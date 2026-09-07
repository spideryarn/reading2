Verdict: build it with the changes below. Stage 1 is sound; Stages 2–4 need design corrections before implementation.

### Findings

**F1 — P1 — established: Stage 3 violates the process-state contract.**

(a) The plan proposes a module-level tally and observer registry ([plan:162](</home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/docs/plans/260907e-small-uncontested-postmortem-preventions-batch.md:162>)). The architecture explicitly requires process-wide mutable state to use `processSingleton`, because Vite re-evaluation creates parallel module instances ([architecture.md:370](</home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/docs/project/architecture.md:370>)). Counts can split, registrations can disappear, or callbacks can duplicate across reloads.

The premise driving this complexity is also wrong: there are 13 call expressions under `src/`, not 37; 17 across `src/`, `scripts/`, and `evals`. All shipping stage commands already run through the queue/server machinery, so the claimed request-versus-stage-CLI destination split does not exist there.

(b) Remove the tally and global observer. The smallest design is one safe structured log event directly at the repair seam, containing only `source`, `removed`, and outcome. `src/log.ts` already guarantees logging cannot throw. If retaining “no logger import” is non-negotiable, use an explicit callback parameter at the 17 real non-test call sites rather than mutable registration.

(c) A cache-busted double-import/HMR test would expose split state or duplicate observers. An exact AST call inventory would have caught the erroneous 37-call premise.

**F2 — P1 — reasoned: the observer can turn a repaired answer back into a failed answer.**

(a) The plan does not require observer exceptions to be contained. A callback invoked after successful repair could throw, discarding an otherwise valid paid response—the precise kind of telemetry-changing-behaviour failure that `src/log.ts` structurally prevents.

(b) Specify that notification is non-throwing and test it. Direct use of the wrapped logger from F1 already supplies this guarantee; otherwise surround observer invocation and discard its failure.

(c) Register an observer that throws, feed `{"a":1,}`, and assert `parseJsonAnswer` still returns `{a:1}`.

**F3 — P2 — established: Stage 2 preserves two status mechanisms instead of removing one.**

(a) The proposed exemption list is unnecessary because it results from sweeping unrelated local translations. `ArticleNotFound` is translated locally in `sendExport` ([routes.ts:763](</home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/routes.ts:763>)); `EmbeddingFailure` is locally sanitised into an `httpError` ([routes.ts:919](</home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/routes.ts:919>)). Neither belongs to the generic catch’s class-to-status map.

Inside the generic catch, `err.status` is already first and authoritative, making the `CommentIdTaken` and `NotAnExplanation` branches unreachable ([routes.ts:6418](</home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/routes.ts:6418>)). The postmortem itself says to delete those branches when next touching the function. The plan instead institutionalises them and adds a third list to synchronise the first two.

(b) Give `ChatConflict` `readonly status = 409`, remove its named `mayPassThrough` branch, delete the three class-specific branches from the generic catch, and make the static guard prohibit class-specific `instanceof` status mappings in that catch. Local translations remain outside its scope, with no exemptions.

(c) The guard should fail on the historical 2026-08-28 catch containing the three branches, fail when a new branch is added, and stay green when an unrelated local `instanceof` translation is added.

The historical reconstruction otherwise supports the plan: at `5fc17431`, both comment classes lacked `status`, were thrown by the raw Postgres comment store, and the guard at that commit allowed neither. The proposed cross-check would have gone red. The current five executable `instanceof` expressions and the table’s reachability claims are complete; I found no alternative class-name status mapping in `routes.ts`.

**F4 — P2 — established: Stage 3 does not count “model answers repaired.”**

(a) It counts successful parser invocations. Those differ in both directions:

- The repair removes commas even when another syntax error remains. The probe `{"a": nope,}` produced `removed: 1` and then threw `MalformedJson`; the plan records nothing.
- Stored hierarchy-expansion answers are parsed again on resume ([hierarchy-deepen.ts:1353](</home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/hierarchy-deepen.ts:1353>)).
- A final refused expansion is parsed once by `parseExpansionAnswer` and again by `readRefusedShape` ([hierarchy-deepen.ts:1496](</home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/hierarchy-deepen.ts:1496>), [hierarchy-expand.ts:755](</home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/hierarchy-expand.ts:755>)).

Thus one model answer can be counted repeatedly, while an unsuccessful repair attempt is omitted.

(b) For a small Stage 3, define and name the metric honestly as a **parse-repair invocation**, with `outcome: "accepted" | "still-invalid"`. If the desired metric is genuinely model-answer incidence, instrumentation must move to the fresh model-call seam and distinguish fresh answers from checkpoints; that is a larger stage.

(c) Add cases for trailing-comma-only, trailing-comma-plus-another-error, cached reparse, and the refused-expansion double parse.

**F5 — P2 — established: Stage 4 would not have caught its named incident.**

(a) `SUPABASE_SERVICE_ROLE_KEY` was already in `EXPECTED` at `4dcc580`, before `src/store/blobs.ts` began reading it. It remained there at `2405408`. A membership test therefore stays green across the introducing commit. The bug was that a reported variable changed from optional to required without gaining a `breaks` consequence, not that its name was missing.

This directly contradicts the postmortem and plan claim that the proposed test “would have gone red at `2405408`.”

(b) Keep Stage 4 only as the narrower and still useful “source environment reads must be inventoried” guard, and correct the historical claim. Catching the original class requires deriving requiredness from one declaration or testing the fallback seam under production conditions; that is not this small static check.

(c) Running the proposed membership algorithm against the before/after historical blobs is the control that exposes this.

**F6 — P2 — established: Stage 4 misses 16 current environment names.**

(a) The planned AST sweep covers `process.env.X` but not computed reads. The tree has:

- 27 real direct-property names—not 28; `SPIDERYARN_` is only the comment false positive already identified.
- 12 model override names read through `process.env[envVar]`.
- `SPIDERYARN_DEEPEN_HIERARCHY`, `SPIDERYARN_DEEPEN_REASK`, and `SPIDERYARN_DEEPEN_RECORDS`, read through constants.
- `SPIDERYARN_JOB_CONCURRENCY`, likewise read through a constant.

So the proposed “every environment read” check sees 27 of 43 statically enumerable names. The omitted job-concurrency and model overrides affect shipping behaviour.

(b) Inspect all `process.env` member expressions. Resolve computed string literals, module-local string constants, and the values of `MODEL_ENV_VAR`; fail closed on any computed expression the test cannot enumerate. The generic helper accesses in `fetch.ts` and `vercel-health.ts` need explicit treatment tied to their callers, not a permanent location exemption.

Also decide every new `breaks` value in the plan before building it. “Report-only or a real entry; decided at build time” leaves possible public-health 503 behaviour outside this review.

(c) Positive controls should name at least `SPIDERYARN_JOB_CONCURRENCY` and one model override, plus a fixture containing an unresolvable `process.env[something()]` that must fail.

### Checks and non-findings

- Stage 1’s exact three `Error → unknown` edits pass all TypeScript projects: 1,527 files covered, no casts or override workarounds. The AST assertion is the honest red-first test because TypeScript itself permits reverting the parameter to `Error`; the test is what preserves the stronger local type.
- All 13 `parseJsonAnswer` calls under `src/` currently pass literal, project-authored `source` strings. I found no current payload leak through that field. Outside `src/`, one eval builds a source from an eval label, not article content.
- The parser repair is reachable: `{"a":1,}` repaired successfully in a throwaway harness.
- `tests/parse-json.test.ts` could not start in this read-only tree because its fixture setup creates `data/_test-parse-json`; all 65 tests were skipped before assertions.
- The supposedly reverted Stage 1 spike is still present as working-copy modifications in the three boundary files. I did not review or alter those edits.

Build Stage 1. Replace Stage 2’s synchroniser with one canonical status mechanism. Redesign Stage 3 without global mutable registration and define its event precisely. Keep Stage 4 only after narrowing its claim and covering computed environment reads.