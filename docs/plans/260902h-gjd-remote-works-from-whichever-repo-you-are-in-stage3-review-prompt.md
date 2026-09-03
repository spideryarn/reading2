# Code review: Stage 3 (and the Stage 2 fixes) of "gjd-remote works from whichever repo you are in"

Read-only. Your Stage 2 review's seven blockers were all reportedly fixed; the plan's Log and the
commit messages since `269c7ef` carry finding → change → reddening-test tables. Check three of
them yourself, chosen by you, rather than trusting the tables.

## Read

1. The plan: `docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md` — "GPT Sol's
   plan review, and what changed", "Open questions for Greg — answered" (pre-ticking is now
   decided: the model's proposal IS the starting state), "Stage 3", "Stage 4", the guard table, the
   Log. Your Stage 2 review: `…-stage2-review-sol.md`.
2. The scoped diff since your Stage 2 review:
   `/private/tmp/claude-501/-Users-greg-dev-spideryarn-reading2/eaf11bc0-8303-409a-abea-7789226536e6/scratchpad/stage3.diff`.
3. New modules in full: `scripts/gjd-remote-flow.ts` + `tests/gjd-remote-flow.test.ts` (the clone
   transaction script, the checkout probe, the box-config read protocol, the setup spec diff, the
   gate matrices, log reconciliation — tests run the real shell scripts);
   `scripts/gjd-remote-envpolicy.ts` + `tests/gjd-remote-envpolicy.test.ts` (Stage 4's pure half,
   not yet wired: names-only extraction, the proposal request/parse, the checklist planner and
   guard re-application, the saved policy file).
4. In `scripts/gjd-remote.ts`: `resolveOrExplain`, `resolveTargetForSession`, `ensureRemoteCheckout`,
   `cloneVerified`, `cloneThenSetUp`, `previewSetup`, `foundGate`/`sayFoundSetupStatus`, `runSetup`,
   `setupGate`, `reportAfterAttach`, `reconcileSetupLog`, `readBoxConfig`/`localSpec`/`diffSetupSpec`,
   `setupReadScript`/`readSetupState`, `cmdClone`, `cmdSetup`, `cmdNewClaude`/`cmdNewShell`, `main()`.
5. `scripts/gjd-remote-setup.ts` (fd 9 closed for the command; PIPESTATUS; slug/dir/inode in the
   verdict) and `tests/gjd-remote-setup.test.ts`.
6. Gateway edits: `src/ai-call.ts` (`env-proposal` job, a new `ToolAiJob` arm), `src/models.ts`.

## Live evidence (2026-09-02, throwaway `gregdetre/gjdutils`, box left clean)

- No TTY ⇒ NotInteractive naming `clone` and `setup`, nothing cloned. pty + `y` ⇒ cloned via a staging sibling; box has no config ⇒ "cloned, but no setup known", clone stays, no session. `--repo` from `/tmp` ⇒ "setup command unknown until cloned".
- found + never-run ⇒ yellow line, session starts, `ls` shows REPO. found + success ⇒ silent, session. config-changed / failed ⇒ yellow, session. in-progress with lock held ⇒ refused, no session.
- Concurrent clone of the same destination ⇒ "another clone of that destination is running", nothing touched. Re-clone at the same path after a success ⇒ old status archived; a restored old status ⇒ `wrong-checkout` naming both inodes. `--no-attach` then `--status` ⇒ terminal record written once.
- This repo's own `doctor` now fails `setup status` with "the box and this laptop disagree about source ('npm-convention' vs 'config')" — the box's `spideryarn2` checkout predates `.gjd-remote/config.toml`. Recorded as honest.

## Questions

1. **Pick three Stage 2 findings and verify the fix yourself** (the transaction script under a
   held lock; the `mkdir`-reserved staging and the `rmdir`-only cleanup; the spec diff on a changed
   script body; the box-read sentinel; the fd 9 closure; the inode-bound verdict; `noflock`).
2. **The session gate.** `foundGate` warns and proceeds on `never-run`/`failed`/`config-changed`
   (held for Greg; the plan says why). Given that, is there any path where a session starts in a
   tree that is mid-clone, mid-setup, or was refused by `resolveTarget` for another command? Trace
   `resolveTargetForSession` → `cloneThenSetUp` → session creation for the failure points, and
   for what happens on Ctrl-C at each prompt (exit 130, nothing mutated — true after the clone?).
3. **Two prompts or one.** The re-confirmation fires when the cloned commit's spec differs from the
   laptop's or was never known. Is "differs" computed on the normalised spec? Can the shown command
   and the run command still diverge (e.g. the box's `package.json` setup body when the laptop's
   config names a command explicitly)?
4. **The clone transaction script** as an adversary: `flock` held by a stale process; a staging
   dir left by a crash; a destination that appears between re-resolve and rename; `mv -T -n` on a
   filesystem that lacks `-n`; the inode comparison across the rename on the same filesystem.
5. **Stage 4's pure half**, before it is wired: `parseProposal` fail-closed — any input that yields
   a partial proposal? `planChecklist` with `preTick: "proposal"`: which classes are ticked, and is
   `unknown` unticked? `applyGuards` after selection: can a disabled item reach `send`?
   `writePolicy`: the agent deliberately omitted a post-rename `chmod 0600` because it made the
   mode test vacuous; is the mode still guaranteed (temp opened `0600` with `O_EXCL`), including
   under a permissive umask? The all-sinks sentinel test: name a sink it does not cover.
6. **The gateway job**: `env-proposal` on `QUICK_MODEL_OPENROUTER` with `require_parameters: true`
   and `response_format` — correct for OpenRouter's routing, and does the exhaustive-map test set
   actually cover the new arm? The CLI must open `withLedger("cli")`: is there anything in
   `src/cli-ledger.ts` that would make a CLI run from ANOTHER repo's cwd persist the row somewhere
   surprising (the filesystem ledger path, `SPIDERYARN_STORE`)?
7. **Tests that cannot go red**, in `gjd-remote-flow.test.ts` and `gjd-remote-envpolicy.test.ts`.
8. Anything you would refuse to merge — and separately, is Stage 1–3 as a whole fit to land on
   `dev` now, ahead of Stage 4's wiring?

Numbered findings with severity (blocker / should-fix / nit), file:function, what is wrong, the
concrete change. Then the three you would fix first. No files or remote state may be changed.
