# Code review: Stage 2 of "gjd-remote works from whichever repo you are in"

Read-only review of built code. Your Stage 1 review's four blockers were all fixed (a table of
finding → change → reddening test is in the commit `5d97008`'s message and the plan's Log); check
two of them yourself at random rather than taking that on trust.

## Read

1. The plan: `docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md` — "GPT Sol's
   plan review, and what changed", "Stage 2", "Stage 3" (what comes next, so you can judge whether
   the seams left for it are right), the guard table, and the Log.
2. The scoped diff since your Stage 1 review, at
   `/private/tmp/claude-501/-Users-greg-dev-spideryarn-reading2/eaf11bc0-8303-409a-abea-7789226536e6/scratchpad/stage2.diff`
   (gjd-remote.ts, gjd-remote-setup.ts, gjd-remote-repo.ts, gjd-remote-prompt.ts, the box doc).
3. The whole of `scripts/gjd-remote-setup.ts` and `tests/gjd-remote-setup.test.ts` — the job script
   is run for real under bash in those tests, with a python `flock` shim on macOS.
4. In `scripts/gjd-remote.ts`: `cmdClone` and its helpers (`cloneIntoPlace`, `sweepStaging`,
   `whichRepoToClone`), `doctorBox`/`doctorRepo`/`mcpOutcome`/`setupStatusLine`, `promptStreams`,
   `main()`'s catch, `boxConfigScript`/`readBoxConfig`/`authoritativeConfig`, `setupReadScript`/
   `readSetupState`, `cmdSetup`, `setupGate`, `confirmSetupStarted`, `reportAfterAttach`,
   `saySetupVerdict`, `inventory()`/`sshRun()`, `metaFlags()`, `assertSameRepo()`, `namedDir()`.
5. `scripts/gjd-remote-config.ts` `requireCommand` (bounded now) and `scripts/gjd-remote-log.ts`
   `formatLine` (allowlisted now).

## Evidence gathered live on the box (2026-09-02), all from the worktree

- `clone gregdetre/gjdutils`: `Cloning into '/home/greg/code/.gjd-remote-staging-gjdutils-f0ce7ec7'` then moved; `resolve --repo gregdetre/gjdutils` ⇒ found; after `rm -rf` ⇒ absent.
- `clone gregdetre/gjdutils --name gjdutils-two </dev/null` with the twin present ⇒ NotInteractive refusal, exit 1, nothing cloned. On a pty: No ⇒ "nothing cloned" exit 0; EOF ⇒ "cancelled, nothing changed" exit 130.
- `doctor --dir /home/greg/code/spideryarn2` ⇒ HEAD/origin/mcp pass; `push-env --dir /home/greg` ⇒ refused "not a git checkout"; `new-shell` from `/tmp` with `GJD_REMOTE_REPO` set ⇒ refused, session count unchanged.
- `setup --status` for this repo ⇒ never-run + remedy, exit 1; `doctor` ⇒ `✗ setup status … nothing has ever set it up`, 1 of 20 failed (honest: Spideryarn's setup has not been run through the tool; `npm ci` under ten live sessions was not attempted).
- On the gjdutils throwaway with a hand-written `.gjd-remote/config.toml` on the box: no config ⇒ "no setup known"; `echo hello && node --version` ⇒ success, log contains the token, `ls` shows the setup session with REPO `gregdetre/gjdutils`; command changed ⇒ `config-changed` naming both hashes; `exit 3` ⇒ `failed … exit 3`; `--force` started a second and third run while earlier panes were still open (after the fd-9 fix); `kill` by name worked for setup sessions. Box left as found.
- The lock finding: the job used to `exec bash -l` with fd 9 open so the lock outlived the work; fixed with `exec 9>&-` before the exec, with a test that takes the lock from outside while the pane process is alive (watched red first).

## Questions

1. **The clone transaction.** `cloneIntoPlace`: is the verify-then-`mv -T` actually atomic against a concurrent `clone` of the same repo, and against Stage 3's `new-claude` running the inventory mid-clone? Does `sweepStaging` ever remove a directory it did not create (the prefix guard)? Can a staging dir with the right origin still reach `resolveRemoteCheckout` by any path?
2. **Config authority.** `authoritativeConfig` compares RESOLVED commands (box vs laptop) and refuses on difference. Is comparing commands enough, or must it compare the config text (a `check` present on one side only; a warning on one side)? Is reading the config from the box's checkout via `base64` round-trip fail-closed on every path (`GJDBOXERR`, cut stream, non-UTF-8)?
3. **The setup job.** Read `setupJobScript` as an adversary: a `setup` command that itself calls `tmux`, `flock`, or writes the status path; `set -o pipefail` inside a subshell — does the exit code of the COMMAND (not `tee`) reach the status file? `env -i` — anything on the box (`/usr/bin/node`, npm's prefix, `claude`) that this PATH loses? The `started` status written before the command: what does a laptop that reads it during the run conclude, and is `in-progress` decided by the lock or by the file?
4. **`setupGate` and `--force`.** Enumerate the verdict × lock matrix and say which cells are wrong. Can `--force` start a run over a genuinely running one?
5. **`reportAfterAttach`.** After the user detaches, the status is read ONCE. A status file naming another attempt, or `started`, or absent: what is printed and logged, and is anything logged as `success` that was not?
6. **`doctor`.** With the repo half now able to fail on `setup status`, does `doctor` exit non-zero for a repo nobody has set up — and is that right for THIS repo's box checkout, which was set up by hand before the tool existed? Should there be a way to say "set up out of band" (a `--mark-set-up`?), or is red-until-you-run-it the honest answer?
7. **Seams for Stage 3.** `onNotFound()`'s `absent` branch will become: confirm → `cloneIntoPlace` → `authoritativeConfig` (box copy) → re-confirm if it differs from what was shown → `cmdSetup`'s body → session only on `success`. Which of those functions need to be reshaped so Stage 3 reuses them rather than copying? Name the exact seams.
8. **Tests that cannot go red**, in `tests/gjd-remote-setup.test.ts` and the new rows of
   `tests/gjd-remote-repo.test.ts`.
9. Anything you would refuse to merge.

Numbered findings with severity (blocker / should-fix / nit), file:function, what is wrong, the
concrete change. Then the three you would fix first. No files or remote state may be changed.
