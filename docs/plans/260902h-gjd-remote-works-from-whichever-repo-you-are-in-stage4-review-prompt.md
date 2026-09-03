# Landing review: Stages 1–4 of "gjd-remote works from whichever repo you are in"

Read-only. This is the review before the branch lands on `dev`. Your Stage 3 review's three
blockers were fixed and the fixes are wired into the CLI; Stage 4 (`push-env` for a repo with no
typed policy) is built and proved live. Decide whether the whole is fit to land, and if not, what
exactly stops it.

## Read

1. The plan `docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md` — especially
   "Open questions for Greg — answered" (Greg decided pre-ticking from the model's proposal; the
   found-checkout gate still warns for never-run/failed/config-changed), the Stage 3 and 4 sections,
   the guard table, and the Log (every live result is there). Your Stage 3 review:
   `…-stage3-review-sol.md`. The spike that changed the model choice:
   `docs/research/260902b-env-key-proposal-spike.md`.
2. The scoped diff since your Stage 3 review:
   `/private/tmp/claude-501/-Users-greg-dev-spideryarn-reading2/eaf11bc0-8303-409a-abea-7789226536e6/scratchpad/stage4.diff`.
3. In `scripts/gjd-remote.ts`: `sayFoundSetupStatus`, `startUnderAdmission`, `setUpTheClone`,
   `cloneThenSetUp`, `runSetup` (takes a `SetupSpec`), `expectedConfigSha`, `readSetupState`,
   `envRoute`, `pushEnvByChecklist`, `localityVerdict`, `sendEnvPayload`, `main()`.
4. `scripts/gjd-remote-flow.ts` (`sessionAdmissionScript`, `parseAdmission`, `foundGateDecision`,
   `setupFingerprint`, `setupSpec`, the `CloneOutcome` `stale-stuck` arm) and its tests;
   `scripts/gjd-remote-setup.ts` (`expectFiles`, `toolFailure: "config-changed"`, the inode arms)
   and its tests; `scripts/gjd-remote-envpolicy.ts` (`applyGuards` re-evaluating predicates,
   duplicates rejected, `PROPOSAL_MODEL`, no `temperature`) and its tests, including the stubbed
   transport + real `withLedger` test; `scripts/gjd-remote-env.ts` (`buildEnvPayload(text,
   allowance)`, the by-value postgres-URL guard).

## Live evidence (2026-09-02, throwaway `gregdetre/gjdutils`, box left clean each time)

- Setup status recorded with the v2 fingerprint; changing only the script body ⇒ `config-changed`; the job on the box carries the re-derivation under the lock.
- During a `sleep 45` setup: `new-shell` refused, "holds the box-side lock", tmux count unchanged; afterwards a session; `new-claude` by origin admitted and killed.
- Ctrl-C at the re-confirmation prompt after the clone: exit 130, "the clone at … remains; setup and the session were not started".
- `push-env` on a repo with no policy: `asking anthropic/claude-sonnet-5`, `Spent: $0.0085 over 1 model call(s)`, reasons per row; the two hard-guarded rows greyed out; `a` took 6 of 8; box file six names, `600 greg`, read back; policy `0600` in a `0700` dir. Second run: "no new keys since the saved policy — skipping the model". No terminal ⇒ NotInteractive. `--all --yes </dev/null` ⇒ wrote with no prompt. `npm run cost` shows the `env-proposal` rows.
- A bug found by the second live run and fixed: hard-guarded names are never in the policy, so they counted as "new" forever and re-triggered the model on every push; blocked names are now excluded from that comparison.
- After your Stage 3 review, one more change by the orchestrator: a status read that fails over ssh now REFUSES the session (it used to print a yellow line and start one with no ticket); `--dir` is the bypass.

## Questions

1. **Admission.** Trace `sayFoundSetupStatus` → `startUnderAdmission` for every arm: is there still a way to start a session in a repo checkout without the box-side lock-and-compare? (Known and documented: `--dir`.) Is the `expect` bytes comparison sound when the status file is absent (`expect: null`) and a setup starts between the read and the admission?
2. **Fingerprint.** One `setupFingerprint` for prompt diff, durable status and in-job re-derivation: any producer still on the old command hash? Does `expectFiles` reach the job in every path (`runSetup` from `cmdSetup` AND from `setUpTheClone`)?
3. **push-env's two routes.** Can a repo other than `spideryarn/reading2` ever hit the typed route, or the reverse? Does `buildEnvPayload(text, allowance)` with the checklist allowance apply the by-value postgres guard to a key the user ticked? Where does a VALUE from the target's `.env.local` go, function by function, from `readFileSync` to the ssh payload — name every variable that holds one and confirm none is logged, thrown, or handed to the model.
4. **The saved policy and the model.** `readPolicy` mismatch on `repo` ⇒ what happens? A policy file with a name not in the current `.env.local` (a key removed) ⇒ ignored or pushed empty? `--none --save` ⇒ an empty policy: does the next run then ask the model again (approved is empty, everything is "new")? Is that right?
5. **The ledger.** `withLedger("cli")` around one call from another repo's cwd: where does the row land, and does `npm run cost` from THIS repo see it? Is anything about the target repo (its slug, its key names) written into the spend row?
6. **Docs.** Read the new sections of `docs/project/hetzner-remote-server-box.md` and the `push-env` HELP text as a stranger: is anything there now untrue given the code?
7. **Tests that cannot go red** in the diff's new tests.
8. **Land or not.** If not, the exact list. If yes, what to watch on the first real use for hellozenno (Stage 5 is next: `gjd-remote new-claude` from `/Users/greg/dev/hellozenno`, whose `.gjd-remote/setup` makes a venv, inits a submodule, and runs `npm ci --prefix frontend`).

Numbered findings with severity (blocker / should-fix / nit), file:function, what is wrong, the
concrete change. Then the three you would fix first. No files or remote state may be changed.
