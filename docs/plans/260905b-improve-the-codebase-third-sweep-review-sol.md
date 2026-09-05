**Not ready.** The source escape changes and dependency update are sound, but the plan’s headline is not supported at the strength asserted, the NUL guard is materially incomplete, and three copy assertions became weaker.

## A. Plan document

1. **The headline is overstated.** At [260905b…md:9](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/plans/260905b-improve-the-codebase-third-sweep.md:9), the caveat addresses only the inflated 55% rate. It does not validate the claimed specific/general pattern.

   There are three confounds:

   - Selecting only postmortems containing an open recommendation excludes postmortems whose general recommendations all landed. That selection can create the association being claimed.
   - An incident fix normally exists before its postmortem is written. “The incident-shaped fix always lands” is therefore largely structural, not a result of this census.
   - Generalising recommendations are usually newer, larger, and explicitly future work. Age and effort are plausible explanations not separated from “shape.”

   More importantly, the table at [lines 272–281](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/plans/260905b-improve-the-codebase-third-sweep.md:272) shows only aggregate statuses. It shows no classification of the 74 recommendations as incident-shaped or class-shaped, so the asserted pattern cannot be derived from it. No retained 74-row census was present in the tree. That conflicts directly with the method’s requirement that counts be “shown, not summarised” at [improve-the-codebase.md:194–207](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/reusable/improve-the-codebase.md:194).

   This is especially important because an earlier postmortem rejected a superficially similar postmortem-wide pattern after spot-checking counterexamples: [260903e…md:60–69](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/postmortems/260903e-three-attempts-to-build-a-control-for-recorded-not-fixed.md:60).

   Either retain an item-level appendix with source, status evidence, shape, age, and effort, then show a cross-tab; or soften the conclusion to: “This open-enriched search found 41 unbuilt candidates, many of them generalising checks; six were independently revalidated.” The census count may be proved; the causal/pattern conclusion is currently a hypothesis.

2. **Stage 2 is not scored as the method requires.** The table at [lines 296–305](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/plans/260905b-improve-the-codebase-third-sweep.md:296) contains size only, not comparative value and risk. Therefore choosing `(d)` second is not distinguishable from convenience winning. Starting with `(b)` is justified because it underpins future lint rules. Starting with `(d)` ahead of the customer-impacting `(a)` or security-boundary `(c)` needs an explicit value/risk case.

3. **Item `(f)` was not revalidated against today’s tree.** The plan repeats the postmortem’s old “three call sites” estimate at [line 305](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/plans/260905b-improve-the-codebase-third-sweep.md:305), but there are now **11 production call sites** outside the definition. Several billing and store callers possess only an owner id, so supplying a project is a real seam change, not an obviously small refactor. Moreover, the postmortem’s later conclusion says the more useful open fix is a deploy-time identity check, at [260828f…md:208–220](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/postmortems/260828f-admin-id-was-the-local-one.md:208). Re-scope this item before scheduling it.

4. **The bundle conclusion is too categorical.** The measurement supports “ample headroom today,” not “growth is not a risk,” particularly while the 2,946-versus-4,413 trace discrepancy is unexplained at [lines 51–58](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/plans/260905b-improve-the-codebase-third-sweep.md:51). The 250 MB standard limit is current, although Vercel now also offers an opt-in large-functions beta. [Vercel’s limits documentation](https://vercel.com/docs/functions/limitations).

5. **Workspace state:** despite [line 412](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/plans/260905b-improve-the-codebase-third-sweep.md:412), `HEAD` remains `f1ee632f`; all Stage 1 files are uncommitted. That sentence becomes true once the proposed commit exists, but the user-facing claim that it is already committed is currently false. `origin/dev` has also moved, including changes to `evals/hierarchy-structure/run.ts`.

## B. Stage 1 changes

1. **The NUL guard is incomplete while claiming comprehensive coverage.** [no-raw-nul-bytes.test.ts:51–60](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/tests/no-raw-nul-bytes.test.ts:51) omits, among other things:

   - 14 current `evals/**/*.mts` source files
   - six current `.mjs` scripts/evaluators
   - root JSON/JSONC such as `package.json` and `biome.jsonc`
   - HTML, shell, TOML, YAML, and SQL authored files

   The `SOURCE_FILES.length > 500` assertion at [line 81](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/tests/no-raw-nul-bytes.test.ts:81) does not guard this: the docs glob alone leaves enough files for the test to pass if an entire code glob disappears. Either enumerate all authored text extensions with explicit capture/media exclusions, or assert a witness file from every intended directory/extension group.

2. **The `grep` account is factually wrong on this machine.** Reconstructing the old `useIllustrated.ts` and running GNU grep 3.11 produced:

   ```text
   grep: …/useIllustrated.ts: binary file matches
   exit=0
   ```

   Therefore “No match, no warning” at [plan line 86](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/plans/260905b-improve-the-codebase-third-sweep.md:86), “grep goes silent” at [test line 2](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/tests/no-raw-nul-bytes.test.ts:2), and “returns nothing” at [test line 72](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/tests/no-raw-nul-bytes.test.ts:72) should be corrected. It suppresses the matching line and breaks consumers expecting `file:line`; it does not make the file wholly undiscoverable. The review-command rejection remains strong independent evidence.

   The check is still worth keeping. Git permits NULs, and Biome misses the template-literal cases. There is no credible need for a raw NUL in authored TS/JS/Markdown when an escape is equivalent; binary and captured fixtures can remain explicit exclusions.

3. **T1.4 draws the line in the wrong place.** `expect(host.textContent).toContain(SHARING_PERSONALISED)` at [access-sharing.test.tsx:365](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/tests/access-sharing.test.tsx:365) is textually longer but epistemically weaker. The component and test now import the same value. Changing the constant from “may have been” to an unjustified categorical claim changes both sides and remains green, despite the test’s stated requirement that the unknown case hedge.

   The same concern applies to:

   - `SHARING_RIGHTS_CONFIRM` at [line 290](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/tests/access-sharing.test.tsx:290): the requirement is that the owner affirm a right to share.
   - `SHARING_NOT_PERSONALISED` at [line 371](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/tests/access-sharing.test.tsx:371): the requirement is the definite “none were” claim.

   `SHARING_INVENTORY_UNKNOWN` is more defensible because the same test independently asserts that publishing is unavailable, but it still no longer pins the promised explanation. Keep constant assertions for wiring, and retain short semantic assertions for the load-bearing meaning.

4. **The Sentry documentation replacement is incorrect.** [sentry-error-monitoring.md:30–35](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/docs/project/sentry-error-monitoring.md:30) says “a call per streaming route,” but several routes contain a second capture for persistence failure. It then recommends `grep -c captureFailure src/routes.ts`; that prints **14**, because it counts the import, while there are 13 call expressions. The replacement has traded one stale count for a command that reports the wrong count today.

5. **The store comment is narrowly accurate but is the wrong repair.** `ChatStore` and `SearchStore` do have selectable Postgres implementations in `index.ts`. But [contracts.ts:29–41](/home/greg/code/spideryarn2/.claude/worktrees/sweep-260905b/src/store/contracts.ts:29) retains another decaying wiring statement, then explains in prose that such prose decays. The file now contains roughly 15 store interfaces, so preserving the archaeology beneath “three seams” is less useful than deleting the stale inventory and describing the stable category. The history already has a proper home in this plan.

6. **The package update is correct.** Only `stripe-target.ts` directly imports `pg-connection-string`; three scripts import that module. The plan’s “four other scripts and `src/env.ts` import it” is inaccurate dependency-graph wording, but declaring the direct dependency is right. The lockfile already contained version 2.14.0 transitively, so only the root dependency entry needed changing. `npm ci --ignore-scripts --dry-run` reported “up to date.”

7. **The sanitisation edit is safe.** The old UTF-8 bytes decode to U+009F before JavaScript parses the regex; the new escape denotes the same character. Both classes match exactly U+0000–001F and U+007F–009F. Astral characters become surrogate pairs without `u`, and neither surrogate lies in those ranges; lone surrogates also cannot match. Adding `u` would not change equivalence. I independently compared every UTF-16 code unit U+0000–FFFF and found zero disagreements. The original U+0000–2FFF experiment was not exhaustive over surrogates, but the transformation itself is sound.

Verification completed:

- Focused tests: 206 passed.
- Broader related suites: 160 passed, 13 Postgres tests skipped because sandbox access was unavailable.
- Typecheck: all three projects clean via the underlying runner.
- Lockfile dry-run: clean.
- Lint showed only the acknowledged two `noControlCharactersInRegex` errors and existing complexity notices.