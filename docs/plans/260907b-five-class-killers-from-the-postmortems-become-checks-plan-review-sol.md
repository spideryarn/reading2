The plan is not ready unchanged. Stage 4 is behaviorally equivalent, and Stages 1 and 3 are basically sound. Stage 2 does not prevent its cited incident, and Stage 5 misses a case the postmortem explicitly treats as load-bearing.

## Blocking findings

1. Stage 2 guards the wrong boundary.

The actual incident added `purify.addHook(...)` in `src/web/sanitize.ts` ([postmortem:16](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/postmortems/260904d-a-presentation-rule-inside-the-sanitiser-broke-the-one-policy-invariant.md:16)). The proposed rule exempts that exact file ([plan:151](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/plans/260907b-five-class-killers-from-the-postmortems-become-checks.md:151)), and it still owns the instance as `const purify = DOMPurify(window)` ([src/web/sanitize.ts:66](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/web/sanitize.ts:66)). The same line could therefore be reintroduced tomorrow and the new rule would say nothing.

The claim “you cannot call `addHook` without an instance, which you get from `dompurify`” ([plan:157](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/plans/260907b-five-class-killers-from-the-postmortems-become-checks.md:157)) overlooks that both exempt bindings retain an instance after calling `installArticlePolicy`. Conversely, a harmless type-only import elsewhere would be rejected even though it grants no instance.

The postmortem already says the real class-killer is parity/idempotence, and that those tests caught the incident immediately; it explicitly describes an `addHook` lint rule as narrow and not built ([postmortem:81](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/postmortems/260904d-a-presentation-rule-inside-the-sanitiser-broke-the-one-policy-invariant.md:81)).

My recommendation: either drop Stage 2 as already covered, or describe it honestly as “prevent a fourth DOMPurify binding,” not as closing the `addHook`/one-policy class. If the desired rule is literally “no `.addHook` outside `sanitize-policy.ts`,” scan that spelling directly—but acknowledge the same narrowness the postmortem does.

2. Stage 5 silently permits the postmortem’s lone diff3 marker.

The plan conditions both `=======` and `|||||||` on an opening or closing marker in the same file ([plan:313](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/plans/260907b-five-class-killers-from-the-postmortems-become-checks.md:313)), then states only the lone-`=======` blind spot ([plan:317](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/plans/260907b-five-class-killers-from-the-postmortems-become-checks.md:317)).

That is incomplete. The existing journal suite specifically tests a half-finished resolution leaving only `||||||| base` ([tests/migration-journal.test.ts:311](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/migration-journal.test.ts:311)), and the production detector’s comment calls that case out ([scripts/migration-ledger.ts:680](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/migration-ledger.ts:680)). “A real conflict always brings the opening marker” is false for the class under discussion: interrupted or partial resolution.

Use this trade instead:

- `<`, `>`, and `|` markers always fail.
- `=` fails when the file also contains `<`, `>`, or `|`.
- Accept only the genuinely lone `=======` blind spot for Markdown/setext safety.

Also add the existing CRLF case to Stage 5’s tests. If the implementation uses `git grep` with “space or end of line,” a bare `=======\r\n` may not satisfy `$`; the existing journal detector deliberately splits on `/\r?\n/` and pins CRLF ([tests/migration-journal.test.ts:320](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/migration-journal.test.ts:320)).

## Stage 5 false positives

The measurements are correct today: 3,935 tracked files, 30 files under the unanchored pattern, and zero column-zero matches.

That does not establish a durable zero-false-positive rule:

- A Markdown fence quoting a conflict normally puts the markers at column zero. It will fail even though it is documentation. With 1,541 tracked Markdown files and 4,180 column-zero fences, this is a foreseeable case, not an edge fantasy.
- Captured model output or a raw conflict fixture can legitimately contain a complete marker block.
- Unified `.diff`/`.patch` files are generally safe because hunk content has a `+`, `-`, or space prefix. Raw fragments stored as fixtures are not.
- Repeated `<`, `>`, or `|` can be ASCII art/dividers. Less common than `=`, but legitimate.
- `git grep -I` does not mean “all binary files are skipped.” It currently reads the tracked PDF at `evals/pdf/much-harder/source.pdf` as text and reports its column-zero `<<`/`>>` lines. A future ASCII-heavy PDF containing seven could trip the gate.

The simplest policy is to reserve column-zero Git-marker spellings in tracked files and document how quotations must be written: indent them, prefix them as a diff, entity-encode them, or construct them with `repeat()`. Trying to parse Markdown fences, HTML, patches, and captured-output formats would be over-building.

The accepted lone-`=======` blind spot is defensible. It does not trade away the actual incident: the contemporaneous commit message says the journal contained `<<<<<<< HEAD`, as does [database.md:638](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/project/database.md:638). The strongest verification is:

```bash
git show -s --format=%B 4b0163c9
```

The broken journal itself was uncommitted, so Git history cannot independently recover its bytes.

## Stage 4 equivalence

The five-state table is correct for reachable calls with nonempty blocks and a tree.

- Metadata composes the hash check at [src/store/pg.ts:2544](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/pg.ts:2544) with `run?.status === "done"` at [src/store/pg.ts:2782](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/pg.ts:2782).
- Publication checks no row, status, then hash in that order at [src/store/pg-revisions.ts:1651](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/pg-revisions.ts:1651).

The omitted cases do not reveal a behavioral disagreement:

- `inputHash` cannot be null or undefined in a stored row: the column is `NOT NULL` ([schema.ts:2258](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/db/schema.ts:2258)).
- An empty-string hash is permitted by the database but cannot equal `hashBlocks`, which always returns 16 hex characters ([source-hash.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/source-hash.ts:114)).
- `NO_INPUT_HASH` is `"unstamped"` and therefore differs.
- A second hierarchy row is impossible because `(revisionId, stepName)` is the primary key ([schema.ts:2289](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/db/schema.ts:2289)); `runs[0]` is safe.
- Metadata represents zero blocks as `blocksHash = null` and returns false. Publication returns early with “no blocks” or “no tree” before computing hierarchy currency ([pg-revisions.ts:1600](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/store/pg-revisions.ts:1600)).

Amend the plan to say `hierarchyCurrency` accepts a non-null `blocksHash: string`, and that each caller retains its no-block/no-tree preconditions. The current claim “nothing changes for any article” then holds. Without that signature constraint, the five-row table is not by itself a complete proof.

The discriminated result is reasonable, not over-built. One wording is overstated: adding a fifth `why` forces the exhaustive publication switch to change, but the metadata caller reading only `.current` does not need to change.

## Stage 1

The placement argument is right. `useStepJob.ts` imports `jobWorthRetrying` from the shared module ([useStepJob.ts:59](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/src/web/useStepJob.ts:59)), and the client boundary explicitly requires shared modules to remain leaves ([client-imports.test.ts:605](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/client-imports.test.ts:605)). Importing `src/log.ts` there would violate that design and force the browser graph to resolve Pino/Node machinery.

Extracting `declaredFailure` and warning in `jobs.ts` is the best small shape. Splitting `jobWorthRetrying` into another leaf merely to make `job-failure.ts` server-only would be larger.

The call-site count is overstated: the current tracked tree has 33 textual occurrences across 10 files, representing 32 calls in two production files and eight test files—not approximately 50 across ten test files. The conclusion remains right: changing every caller’s return shape is needless churn.

The red-test description needs one clarification. A pure `job-failure.test.ts` test cannot prove cancellation suppresses the warning, because cancellation is decided in `runStep`, and `runStep` is private. Either exercise the real job path with a recording logger, or remove “a cancel logs nothing” from what that unit test claims. Testing only an exported warning helper would not prove the production placement invokes it only on the non-cancel branch.

## Stage 2 probe design

Do not write an untracked probe into the shared checkout. The repo’s existing Biome fixture documents that exact first attempt as unacceptable debris and explains why the replacement is tracked ([biome-live-probe.ts:12](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/tests/fixtures/biome-live-probe.ts:12)). It can race another agent’s lint or the same test in another process, and a killed test leaves it behind.

A cleaner live-config proof needs no new temporary file:

- Configure `noRestrictedImports` globally.
- Turn it off only for the legitimate binding files.
- Run `biome lint --only=style/noRestrictedImports` against one legitimate importer. Biome’s `--only` re-enables a rule disabled by a path override; I verified that behavior against the existing `noFocusedTests` override.
- Assert the specific `noRestrictedImports` diagnostic, checked-file count, and exit behavior.

Alternatively, make the targeted Biome invocation a dedicated `scripts/check.ts` gate and perform the one-time red manually. Remember that ordinary `npm run lint` is advisory in `npm run check`; without the Vitest wrapper or a dedicated gate, an error-level restricted import still does not fail the overall check.

## Stage 3

The two-route design works for top-level Portal features:

- `Record<keyof Stripe.BillingPortal.Configuration.Features, …>` forces an SDK-added feature into the compile-time inventory. The installed SDK currently declares exactly five.
- `Object.keys(live.features)` compared with that same inventory catches a feature returned by the API before the SDK knows it.

Derive the runtime known-key set from the `Record`; do not maintain a second array.

The unknown-key check is safe with existing nested fields that `portalDrift` deliberately does not compare. It sees only top-level feature names. For example, Stripe’s `payment_method_update` also carries `payment_method_configuration`, while the current code compares only `enabled` ([stripe-setup.ts:954](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/scripts/stripe-setup.ts:954)); that will not become false drift. State explicitly that this guard is exhaustive over feature names, not over every field inside each feature.

## Over-building and minor corrections

- Stage 2’s whole-repo Biome subprocess plus a write/delete probe is the clearest over-build.
- Stage 3 does not need two separate synthetic compiler demonstrations; one mutation proving that an added `Features` key makes the `Record` incomplete is enough.
- Stage 4 should use a helper truth table plus the existing metadata/publication integration tests. Building a new framework to run the same five cases through both database call sites would be disproportionate.
- The stated stage order says `(d), (a), (c), (e)` ([plan:64](/home/greg/code/spideryarn2/.claude/worktrees/worktree-class-killers/docs/plans/260907b-five-class-killers-from-the-postmortems-become-checks.md:64)), while the headings and brief use `(d), (c), (a), (e)`. Fix the contradiction.

No files were changed.