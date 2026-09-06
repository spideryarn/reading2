Do not merge this as “strictly stronger” yet. The source-wide guard is valuable, but it currently replaces stronger semantic coverage with shallower textual coverage.

1. `messages.test.ts`: finding

The change weakens the old invariant in two concrete ways.

- The old equality covered all 81 `CODE_KINDS` entries. The replacement orphan assertion filters to `ai-` and checks only 34. A bogus `"jb-orphan": "bug"` now passes both tests. Therefore “nothing is unchecked” and “all 81 keys pass” are false at [every-ai-code-is-registered.test.ts:126](/home/greg/code/spideryarn2/.claude/worktrees/sweep-four/tests/every-ai-code-is-registered.test.ts:126).
- `EVERY` represents constructed `ReaderFacingFailure` values and subjects them to kind round-tripping and code uniqueness. The source scan only proves that text resembling `[ai-…]` exists somewhere and resolves non-null.

There is already a consequence: `CLAIMS_UNUSABLE` and `ANSWER_UNUSABLE` are two different sentences sharing `[ai-unusable]` at [referee-claims-run.ts:177](/home/greg/code/spideryarn2/.claude/worktrees/sweep-four/src/referee-claims-run.ts:177) and [referee-criteria-run.ts:453](/home/greg/code/spideryarn2/.claude/worktrees/sweep-four/src/referee-criteria-run.ts:453). That violates the documented “one different sentence, one code” rule, but the new guard passes it.

So: the source scan is a good additional guard, not a replacement. At minimum, preserve the old no-orphan assertion for non-`ai-` entries and explicitly account for external AI failures. Long-term, moving these failures into `messages.ts` as `ReaderFacingFailure` objects is the right direction—but doing so will force the necessary decision to unify the sentence or give the two branches distinct codes. It is not purely mechanical.

2. Are the new tests tautologies?

Not outright, but several assertions admit semantically wrong implementations.

For the AI guard:

- The count and `ai-busy` witness pass if the scanner sees only 26 old files while ignoring every newly added or untracked source file. `git ls-files` specifically misses a new untracked production file before the repo’s pre-commit test run.
- “Resolves every one” passes if every code is incorrectly mapped to `"retry"`. It checks non-null, not the correct kind.
- The orphan check passes when a code appears only in a comment, dead branch, or unused constant. The regex scans comments as well as emitted strings.
- The orphan check ignores every non-`ai-` key.
- The existence assertion at [messages.test.ts:254](/home/greg/code/spideryarn2/.claude/worktrees/sweep-four/tests/messages.test.ts:254) passes if the guard file exists but contains an unrelated or vacuous test.

For the Biome guard:

- The `rage` assertions together prove the correctly named config loaded, but not that all its rules were understood. The behavioral assertion supplies that second dimension.
- The behavioral `not.toContain("noNonNullAssertion")` passes if lint crashes, processes zero files, or changes the diagnostic name. It should also assert `code === 0` and a positive processed-file summary.
- The scratch negative control passes if any present config causes exit 1—for example because it is invalid—not specifically because `noExplicitAny` fired. Assert that `withConfig.out` names `noExplicitAny`.

3. Biome subprocess and cleanup

Acceptable as a toolchain contract test in the normal suite. Ten seconds is material but justified, and this repo’s “unit” lane means “no database,” not “only in-process tests.”

It actually invokes Biome four times: `rage`, the repository probe, and two scratch runs.

The pasted version was unsafe if `writeFileSync` failed after `mkdirSync`. The current workspace version now puts both inside `try`, and `.gitignore` covers the probe, so ordinary assertion/exception cleanup is safe. A hard kill can still leave it behind, and the fixed directory can collide with a concurrent run.

A cheaper and safer shape is:

- Keep `rage`.
- Lint a tiny checked-in TypeScript probe containing a non-null assertion.
- Assert exit 0, “Checked 1 file,” and absence of `noNonNullAssertion`.
- Remove the scratch negative-control test once its mutation evidence has been recorded.

That eliminates runtime writes and two subprocesses while still running inside the repository.

4. `readableDay`: no finding

The second entry point is the right shape. `billing-plan.ts` already owns `readableDate` and the formatting contract; putting the primitive there keeps the invariant beside its existing owner. Both modules are approved shared modules, and the dependency remains inside that closed set.

Moving the format into `messages.ts` would invert the ownership without reducing parts. The invalid-`Date` behavior is preserved.

5. `blockRow`: no behavioral finding

For valid stable block IDs, they agree. `querySelectorAll` returns document order, the map retains the first occurrence, and `querySelector` returns the first occurrence.

Two differences not covered by the comment:

- `blockRow` throws where `CSS.escape` is unavailable; `rowsForBlockIds` still works. The old scroll implementation already had this dependency, so it is not a regression.
- Values outside the block-ID contract, notably U+0000, can differ because `CSS.escape` replaces it while map lookup uses the literal dataset value.

The comment that the browser answers through “an index” at [rows.ts:44](/home/greg/code/spideryarn2/.claude/worktrees/sweep-four/src/web/rows.ts:44) overstates the API. No index is guaranteed; the valid claim is that `querySelector` may stop at the first match.

6. Other discrepancies

- `ai-unusable` registration changes more than bookkeeping: `monitoring-scrub.ts` now treats those messages as authored and may forward their text to Sentry. The two current constants are fixed and safe, and reader-visible retry behavior remains unchanged, but this is still a production classifier/telemetry change.
- The plan says Stage 1 touches six files; the supplied diff touches nine, and the current workspace also includes the probe’s `.gitignore` change.
- No finding on the `knip.jsonc` removal.
- No finding on the `routes.ts` signpost; `serveApi` does set `no-store` before public dispatch.
- No surviving identical `en-GB` formatter found.
- No surviving live-document copy of the escaped block-row selector found; `internal-links.ts` correctly queries a supplied document instead.

Verification: `git diff --check` was clean. Seventy-three relevant tests ran green; this managed review sandbox prevented child `git` processes and workspace writes, so the two subprocess/write-based tests could not be executed under Vitest here. Directly, the pinned `biome rage` reported `biome.jsonc` loaded successfully, and a tracked-file lint completed with exit 0 and “Checked 1 file.”