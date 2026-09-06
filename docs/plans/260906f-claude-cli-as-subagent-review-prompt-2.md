# Review 2: the Claude subagent wrapper, after your seven findings

Repo: `/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent` (a git
worktree of the spideryarn repo), branch `worktree-claude-cli-as-subagent`. TypeScript + ESM, `tsx`,
vitest.

## The candidate

Live pre-commit, same base as round 1: `e78bfc0a388495adacd79fc1334ad474619480a2`
scoped paths: `scripts/run-codex.ts`, `src/spend-declarations.ts`,
`tests/no-undeclared-spend.test.ts`, `docs/reusable/README.md`,
`docs/reusable/codex-cli-as-subagent.md`
**Landed as `e8f00815`**, which carries the fixes for this round's findings too — so the tree this
review saw is that commit minus its round-2 changes.

untracked (new — read them directly, a pathspec cannot name them):
`scripts/subagent-cli.ts`, `scripts/run-claude.ts`, `tests/run-claude.test.ts`,
`docs/reusable/claude-cli-as-subagent.md`,
`docs/plans/260906f-claude-cli-as-subagent.md`,
`docs/postmortems/260906e-a-timeout-that-bounded-the-child-and-not-the-wrapper.md`

Start with `scripts/run-claude.ts` (the credential half and `main`), then
`scripts/subagent-cli.ts` § `runChild`. That is where to begin, not the limit of scope.

## Previous findings

| ID | Finding, verbatim | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | inherited provider controls override `--auth subscription` | fixed | Reproduced here for Bedrock and Vertex. `CLAUDE_CODE_USE_BEDROCK/_VERTEX/_FOUNDRY` are dropped from the child environment (`PROVIDER_SELECTORS`), `--pass-env` brings one back. Plus the preflight you asked for: `probeAuth` runs `claude auth status --json` under the child's exact env and cwd, and the status line reports what it said rather than what we passed. |
| F2 | `write` settings can put the stripped credential back | fixed, but not the way you proposed | `--restricted` was **not** added to `write`: the project's own hooks (this repo has a `PreToolUse` guard on Bash) are worth more on a run that edits the tree than the settings-file hardening is, and `--restricted` also drops `AGENTS.md`. Closed by the F1 preflight instead, which reads the settings files and so sees exactly the case you demonstrated. Say if you think that is not enough. |
| F3 | `--auth env` reports the wrong credential when several exist | fixed | Reproduced: with both set, `authMethod: oauth_token`. Order corrected, and nothing relies on the order any more — the probe reports what was chosen. |
| F4 | `--auth env` with no env credential can spend the subscription | fixed | `parseArgs` refuses. And `authConflict` refuses after the probe when the CLI says a `--auth env` run will use the `claude.ai` login anyway. |
| F5 | output/log aliasing silently destroys the transcript | fixed | Both paths resolved before the run; `samePath` compares resolved strings and, when both exist, inode+device. Refused before anything is spawned. Test: *refuses to write the answer over the transcript*. |
| F6 | malformed result metadata fails open | fixed | Success now requires `is_error === false` **and** `subtype === 'success'`. Both files are written before classification, so a refused run still leaves its partial answer on disk. |
| F7 | `--quiet` documentation and test claim are false | fixed | Doc reworded; there is now a `--quiet` test. |

Also, a fact from round 1 worth knowing because it changed the design: an exported
`ANTHROPIC_API_KEY` did **not** displace the login on this machine (`authMethod: claude.ai`),
because Claude Code stores per-key approval. So `--auth subscription` was renamed `--auth machine` —
"withholding the key is how you prefer the subscription", inherited from the codex wrapper, is not
true of this CLI.

Treat all of that as unreviewed code written by someone else, and spend most of the run on what has
changed since.

## What else changed, that you have not seen

**A bug in the shared spawn core, found by the first real end-to-end run and fixed.**
`--timeout-minutes 5` returned after fifteen minutes: `'close'` waits for every holder of the
child's stdio pipes, and a helper the child leaves behind *in its own process group* survives the
group kill and holds one. `'exit'` now starts a bounded (`GRACE_MS`) wait for the flush. Reproduced
at 121 s against a 6 s timeout before the fix and 11 s after; there is a test, and it was run
against a mutation to watch it go red. The timeout error now quotes the measured duration rather
than the flag. Write-up:
`docs/postmortems/260906e-a-timeout-that-bounded-the-child-and-not-the-wrapper.md`.

This is the highest-value thing to attack: it is in code both wrappers share, and it is a change to
process lifecycle made under time pressure. **Is the `'exit'` grace correct in every ordering** —
a child that exits normally with a large buffered tail, a child killed by the watchdog, a spawn
failure, a capture overflow, `--stream` (codex only, where stdio is inherited and `'close'` behaves
differently)? Can it truncate real output? Can it double-settle?

Also new since round 1: `src/spend-declarations.ts` and `tests/no-undeclared-spend.test.ts` gained
entries for `scripts/run-claude.ts` (a repo guard that refuses a file which can reach a paid
provider unless it is registered in both places).

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. `npx vitest run
tests/run-claude.test.ts` (37 tests) and `tests/run-codex.test.ts` (69) both pass here, and
`npm run typecheck` is clean. No network at all, so nothing can call the real `claude` or `codex`.
Nested `npx tsx` may hit `listen EPERM`; `node --import tsx <script>` works, as you found.

## Attack it

The invariant: **make the wrapper report a success that isn't one, leak the transcript into the
caller's context, spend or name the wrong credential, or return later than `--timeout-minutes`.**

For each finding: an ID continuing from F8, a severity (P0/P1/P2/P3), established or reasoned, then
(a) what shows it fails its own claim — the input or mutation I can run, or the exact reachable
source path — and (b) the smallest change that closes it. A finding with no (a) goes last.

Severity by consequence: **P0** data loss, exploitable security, incorrect charging, or the thing
broadly unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose defect. A
doc defect that will cause a P1 to ship is not a P3 because it is made of prose.

Refuse only on an **established** P0 or P1, and name what established it.

## My own suspicions — read last

- The `'exit'` handler and the `'close'` handler can both fire; `finish()` guards with `settled`,
  but is there an ordering where the grace timer settles *before* legitimate buffered output has
  been captured — a child that exits having written 10 MB that node has not drained yet?
- `probeAuth` spawns a second process on every run. Does it change the failure surface — a machine
  where `claude auth status` hangs, an extra 0.3 s, a `--dry-run` that now spawns something?
- `authConflict` only refuses `--auth env` + `claude.ai`. Is there a second combination that bills
  an account the caller did not ask for?
- The doc's new credential table states four measured facts about a CLI that will change. Is any
  sentence there stronger than the measurement behind it?
