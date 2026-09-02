Verdict: **refuse to merge**. Stage 1–3 is not fit to land on `dev` yet. The normal clone/setup path is substantially improved, but three safety contracts remain breakable.

## Findings

1. **Blocker — [`foundGateDecision` / `sayFoundSetupStatus`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-flow.ts:431): session admission is not synchronized with setup.**

   A `success` verdict proceeds even while the setup lock is held. `never-run`, `failed`, and `config-changed` also proceed when held; only `in-progress + held` refuses. There are real `success + held` windows before `"started"` is written and after the terminal verdict is written. Unreadable status also warns and proceeds.

   Even fixing those cases leaves a TOCTOU gap between the gate and `tmux new-session`: another setup can acquire the lock there.

   Concrete change: create the tmux session through a box-side helper that acquires the setup lock non-blockingly, re-reads and validates status under that lock, starts the session, then releases it. Treat held locks and unreadable status as refusal.

2. **Blocker — [`setupSpec` / `setupConfigSha256`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-flow.ts:288): the normalized setup specification omits execution inputs.**

   `scriptSha256` is recorded only when `source === "script"` and `packageSetup` only for `"npm-convention"`. If config explicitly names `./.gjd-remote/setup` or an npm wrapper, changes to that body compare equal.

   The specific laptop-explicit-config versus box-npm-convention example is detected because `source` differs. Two explicit configs naming the same wrapper are not.

   The durable setup hash has the same problem: it hashes only command and check, so later script/package-body changes need not produce `config-changed`.

   Concrete change: define one canonical spec fingerprint containing every execution input, independent of how the command was selected. Store that fingerprint in the setup verdict and revalidate it inside the locked setup job before execution.

3. **Blocker — [`wrongCheckout` / clone status reconciliation](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-flow.ts:527): inode binding fails open when the old verdict lacks an inode.**

   The comparison runs only when both inodes exist. A legacy/restored success verdict without an inode is therefore accepted for a new checkout. This becomes reachable when stale-status archival returns `stuck`: clone proceeds while the old status remains.

   Concrete change: when the current checkout inode is known, a terminal verdict without its own inode must be `unbound`/`wrong-checkout`, requiring setup again. A stuck archive must prevent a later session from treating the clone as ready.

4. **Should-fix — [`cloneThenSetUp` / top-level cancellation](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote.ts:1320): the Ctrl-C message is false after cloning.**

   Ctrl-C at the first prompt exits 130 with nothing changed. At the re-confirmation prompt, the checkout has already been cloned and status may have been archived, yet the global handler still says `cancelled, nothing changed`.

   Concrete change: carry cancellation phase/state and report: “clone remains; setup and session were not started.”

5. **Should-fix — [`applyGuards`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-envpolicy.ts:495): contradictory duplicate checklist rows can put a name in both `refused` and `send`.**

   The last duplicate controls the lookup map, but the second pass sends each non-disabled duplicate. Normal scanning deduplicates, but the exported seam does not enforce that invariant.

   Concrete change: reject duplicate names or canonicalize once before both refusal and send computation. Prefer re-evaluating the underlying guard predicates rather than trusting `item.disabled`.

6. **Should-fix — gateway and sink tests prove structure, not wiring.**

   `env-proposal` correctly uses the quick OpenRouter model, `response_format`, and `require_parameters: true`; OpenRouter documents that `require_parameters` filters to providers supporting all supplied parameters, including structured-response parameters. [OpenRouter routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection)

   The exhaustive maps include the new arm, but the actual-wire test loop omits it. The env-policy test merely checks that `defaultProposalCall` is a function. The “all sinks” sentinel does not cover stdout/stderr, CLI logging, the spend row, or the eventual SSH payload.

   Concrete change: exercise the default proposal call through a stub transport and ledger, asserting job/model/provider/response format and exactly one ledger row; add a wired CLI-to-SSH integration test.

7. **Should-fix — several flow tests cannot demonstrate their stated regression.**

   In [`gjd-remote-flow.test.ts`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/tests/gjd-remote-flow.test.ts):

   - The held-lock test uses an always-failing fake `flock` and does not assert all destinations/status/staging remain unchanged.
   - The destination-race test creates the destination before execution, not between recheck and rename.
   - The clone-failure cleanup test leaves an empty directory, so recursive deletion would also pass.
   - The archive test checks only that the old path vanished; deletion passes.
   - The inode happy path does not prove the pre/post comparison exists.
   - Gate tests omit `success + held` and corrupt-status + held.
   - The `noflock` matrix injects the state directly; it does not test the producer’s probe ordering.
   - Explicit-config wrapper-body changes are untested.
   - `isStagingBasename` is tested but unused in production.

   Add mutation sentinels, barrier-controlled race tests, a non-empty failed clone, archive-content assertions, and producer-to-consumer tests.

8. **Nit — [`parseProposal`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/gjd-remote-any-repo/scripts/gjd-remote-envpolicy.ts:156) is safely partial but its contract says otherwise.**

   `{ "keys": [] }` succeeds for non-empty input. Omitted names stay unticked, so this is fail-safe, but it contradicts “never partial.”

   Concrete change: either require exactly one decision per requested name or document that omission means “no proposal”.

## Three Stage 2 fixes independently checked

I checked the generated shell and tests themselves, rather than relying on the Log tables:

1. The clone transaction acquires `flock` before its transaction mutations.
2. Staging is reserved with `mkdir`; failure cleanup uses only `rmdir`, preserving non-empty crash evidence.
3. Setup closes fd 9 for both the command and `tee`; the test has the command attempt to take the lock while an outside observer confirms the supervisor still holds it.

I did not execute the suites because the request forbids any file changes; these tests create temporary filesystem state.

## Session and clone traces

For normal origin-based sessions:

- Absent checkout → clone prompt → transactional clone → optional second prompt → setup → re-resolve → gate → session.
- Clone/setup failures stop before session creation.
- Ambiguous or blocked resolution remains refused.
- Explicit `--dir` is an escape hatch: it skips identity and setup gating, so it can point directly at a staging or otherwise unverified tree. That should be documented prominently or brought under the same gate.

Clone adversarial cases:

- A live/stale process still holding `flock`: refused; a leftover lock file alone is harmless.
- Crash-left staging directory: preserved and normally bypassed by a new randomized name.
- Destination appearing before the locked recheck: refused.
- Destination appearing afterward: safety depends on `mv -n` being true no-replace. Current upstream GNU `mv` uses `RENAME_NOREPLACE`, but the script does not verify that primitive; on a weaker implementation, the inode check detects some failures only after the attempted move. [GNU coreutils source](https://github.com/coreutils/coreutils/blob/master/src/mv.c), [coreutils portability warning](https://github.com/coreutils/coreutils/blob/master/NEWS)
- Same-filesystem rename preserves the staged `.git` inode, so the comparison itself is sound.

## Stage 4 specifics

With `preTick: "proposal"`, only `local-dev-only` and `shared-provider-key` proposals are ticked. Production/signing, infrastructure-destroying, unknown, missing, and disabled entries remain unticked.

`writePolicy`’s mode reasoning is sound: an `O_EXCL` temp opened as `0600` cannot become more permissive under umask, and same-directory rename preserves its mode. The final exact-mode check remains useful.

The CLI ledger is rooted in Spideryarn configuration, not the caller repository’s cwd: filesystem mode writes under Spideryarn’s configured ledger path; Postgres mode writes to the configured Spideryarn store. That is consistent, but should be explicit in the Stage 4 contract.

## Fix first

1. Make session creation and setup-state validation one lock-coupled operation.
2. Use a complete canonical setup fingerprint for prompting, execution, and durable status.
3. Fail closed on missing inode binding and stuck stale-status archival.

No files or remote state were changed.