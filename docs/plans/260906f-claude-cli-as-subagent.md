# Calling the Claude CLI as a subagent

Greg, 2026-09-06:

> We have a `docs/reusable/codex-cli-as-subagent.md`. We want a corresponding
> `claude-cli-as-subagent.md` … Ideally we should be able to call it from Claude or Codex, and on a
> gjd-remote box.

The doc is [../reusable/claude-cli-as-subagent.md](../reusable/claude-cli-as-subagent.md) and the
wrapper it documents is [`scripts/run-claude.ts`](../../scripts/run-claude.ts). This file is the
record of the decisions behind them, and of what was actually measured.

## Where it came from

The starting point was `coding-agent-instructions/docs/CLAUDE_CODE_CLI_AS_SUBAGENT.md` in the
MindstoneRebel repo — the same source the codex doc was cut down from. Most of it did not survive
the trip, for two reasons:

- Half of it is CHIEF_ENGINEER: a `dispatch-claude-subagent.ts` that stamps schema-valid reports
  into `subagent_reports/`, a model roster, a selector, a `--capability` contract, a billing-class
  resolver. None of that exists here.
- The other half was written against an older CLI. Its central flags (`--tools` as the whole access
  story, `--no-session-persistence` as a default, `--permission-mode plan` for a read-only run) are
  no longer the shape of the problem on 2.1.263 — and `--tools` in particular turns out to leave a
  hole big enough to migrate a database through.

So the doc was rewritten from measurement, and only its *structure* is inherited.

## What was decided, and the simpler thing passed over

**A wrapper, not just a doc.** The simpler option was prose: "here are the eight flags, use them".
It was rejected for the reason the codex wrapper exists — three of the four traps below fail
*silently*, and a documented gotcha is the thing this repo has the most evidence against. The
wrapper makes them impossible instead.

**Extract the shared core rather than copy it.** `run-codex.ts` already held the spawn with fd 0
closed, the process-group watchdog, the capture cap, the environment denylist and the answer
capping — about 250 lines of subtle, tested code. Copying it into `run-claude.ts` was the easy
option and would have been a second place for each guarantee to quietly stop holding, so those
blocks moved to [`scripts/subagent-cli.ts`](../../scripts/subagent-cli.ts) and `run-codex.ts` keeps
its old exported names as thin adapters. `tests/run-codex.test.ts` is unchanged and its 69 tests
still pass, which is the evidence that the move was a move.

**No credential fallback.** The codex wrapper runs the whole prompt again on the other credential
when the first is spent. Not copied: a spent OpenAI credential is an unmissable `ERROR:` line in
codex's log, and no equivalent Claude failure has been observed here. A retry triggered by a guess
is a second full-price run. `--auth env` is the manual lever.

**`--access`, not `--sandbox`.** Codex's word promises a kernel boundary. Claude Code has none —
this is tool policy inside one process — so borrowing the word would have been the doc lying in a
single syllable.

**Three profiles, not a capability matrix.** MindstoneRebel's version gates elevation on declared
capabilities (`run-tests`, `web`, `code-write`) paired with tool lists. Here: `read-only`, `review`,
`write`, each one line to explain. The capability matrix is the right design when a workflow
executor picks the route; it is over-built when a human or an agent types the flag.

## What was measured (claude-cli 2.1.263, macOS, 2026-09-06)

Every one of these was a real run; the ones that matter are quoted in the doc.

| Question | Answer |
|---|---|
| Does an inherited stdin pipe hang `claude -p`, as it does `codex exec`? | No — it waits 3 s, warns, and **appends whatever arrived to the prompt**. `STDIN_TEST` + a pipe saying "append BANANA" → `STDIN_TEST BANANA`. Quieter and worse. |
| Does `--tools Read,Grep,Glob` mean read-only? | **No.** The init event listed `mcp__supabase__execute_sql`, `mcp__supabase__apply_migration`, `mcp__sentry__update_issue`. `--tools` covers built-in tools only. |
| Does `--strict-mcp-config` / `--restricted` remove them? | Both did, here — every MCP server this repo loads comes from a settings file. Both are passed. |
| Can a read-only run write a file? | No: with no `Write` tool and no `Bash`, there is nothing to deny. |
| Does `--permission-mode dontAsk` grant Bash headlessly? | No. `touch x` was denied. Only an `--allowed-tools` rule or `bypassPermissions` grants. |
| Is Bash useless without an allow rule? | No — `ls`, `git log` run unasked; `touch x` and `echo x > f` are denied. The permission layer reads the command, redirection included. |
| Can the reviewer run a test? | Yes, with `--allow 'Bash(npx vitest run:*)'`: 69 passed, 18.6 s. This is the thing the codex review sandbox cannot do. |
| Does `--restricted` confine file reads? | Yes — a `Read` of `~/.claude.json` was denied. |
| What does `--restricted` cost? | **`AGENTS.md`/`CLAUDE.md` do not reach the run.** A non-restricted run quoted the project instructions back; a restricted one had none. |
| Is `subtype` the error signal? | No. An unreachable model id → `subtype: "success"`, `is_error: true`, `terminal_reason: "api_error"`, exit 1. |
| `--max-budget-usd` exceeded? | exit 1, `subtype: "error_max_budget_usd"`, no `result` field at all. |
| Can a `codex exec` run call `claude -p` from inside its sandbox? | **No.** `codex sandbox` under both the `review` and `:workspace` profiles: `curl https://api.anthropic.com` exits 6, DNS unresolved. |
| Does it work on the Hetzner box? | Yes. Same CLI version, its own `claude.ai` login (a different account from the laptop's), and then the wrapper itself — uploaded to the gitignored `uploads/` and run against the box's checkout — returned `Linux x86_64` and the package name, `$0.0134`, 3 turns, transcript to a file. |

## The review, and what it changed

GPT Sol refused the first candidate on 2026-09-06 with seven findings —
[the prompt](260906f-claude-cli-as-subagent-review-prompt.md),
[the answer](260906f-claude-cli-as-subagent-review-sol.md). Four were about the credential and all
four were right; each was reproduced here before it was acted on.

| ID | Finding | What happened |
|---|---|---|
| F1 | An inherited `CLAUDE_CODE_USE_BEDROCK` re-points the run at another provider while the wrapper says "the logged-in account" | Reproduced (Bedrock and Vertex). The three selectors are now dropped from the child environment, `--pass-env` brings one back |
| F2 | `write` omits `--restricted`, so a settings-file `env` entry can put a credential back | Accepted as a real hole and closed by the probe rather than by restricting write: the project's hooks are worth more on a run that edits the tree, and the probe sees the settings files |
| F3 | `ENV_CREDENTIALS` claimed a precedence with `ANTHROPIC_API_KEY` first | Reproduced: `ANTHROPIC_AUTH_TOKEN` wins. Order fixed — and nothing relies on it any more |
| F4 | `--auth env` with none of the three set falls through to the subscription | Refused in `parseArgs` now |
| F5 | `--output x --activity-log x` writes the answer over the transcript, exit 0 | Refused before the run, `samePath` covering the symlink case |
| F6 | `is_error: false` with an error subtype is accepted as success | Both signals required now; the answer file is written before classification so a partial verdict survives |
| F7 | The doc's `--quiet` claim was false | Reworded, and there is a test |

**The measurement that changed the design** was in F3's neighbourhood rather than in F3: an
exported `ANTHROPIC_API_KEY` did **not** displace the login on this machine, because Claude Code
stores per-key approval. So "withholding the key is how you prefer the subscription" — inherited
from the codex wrapper, and written into this one — was simply not true here. `--auth subscription`
became `--auth machine`, and the wrapper now runs `claude auth status --json` under the child's
exact environment and reports what the CLI itself says. Guessing was replaced by asking.

## The bug the smoke test found

The first real end-to-end run after the review took **fifteen minutes on a five-minute timeout**,
and said `timed out after 5m` when it finished. That is a defect in the shared spawn core — so it
had been in `run-codex.ts` since 2026-08-24 — and it is written up in
[../postmortems/260906e-a-timeout-that-bounded-the-child-and-not-the-wrapper.md](../postmortems/260906e-a-timeout-that-bounded-the-child-and-not-the-wrapper.md).
Short version: `'close'` waits for every holder of the child's stdio, a helper detached into its own
process group outlives the group kill, and the error message quoted the flag rather than the clock.
Reproduced at 121 s against a 6 s timeout, fixed, and now 11 s.

## The second review, and what it changed

Sol refused again — [the prompt](260906f-claude-cli-as-subagent-review-prompt-2.md),
[the answer](260906f-claude-cli-as-subagent-review-sol-2.md) — with eleven findings, of which four
were the *same shape* as the timeout bug above and had been sitting in the fix I had just made.
Each was checked here before being acted on.

| ID | Finding | What happened |
|---|---|---|
| F8 | the forced settle resolves the promise but leaves the pipes open, so the *process* stays alive | Fixed: destroy the streams when force-settling. Test measures `spawnSync`'s return, which is the process |
| F9 | a capture overflow calls `stopTimers()`, disarming the bound it just needed | Fixed: overflow clears the kill timers only, and arms the forced settle |
| F10 | `--stream` hands the caller's own descriptors to the child, so a leaked helper holds the *caller's* stdout | Accepted and documented rather than fixed. Owning and re-emitting both streams is the one thing `--stream` exists not to do; it is already documented as wrong for an orchestrated run, and now for this reason too |
| F11 | the two grace periods run in series: timeout + 10s, not timeout + grace | Fixed: kill and settlement share one deadline. Measured 11.0 s for a 6 s timeout against a child that ignores SIGTERM *and* leaks a helper — the combination where they stacked |
| F12 | a missing `is_error` reads as `false`, so `{"subtype":"success","result":"APPROVE"}` was a verdict | Fixed: `is_error !== false`. This disproved F6's claimed guarantee, which I had written down as done |
| F13 | `samePath` cannot see two not-yet-created names under a symlinked parent; and `run-codex.ts` had no check at all | Fixed: one `sameWriteTarget` in the shared module that opens both paths and compares inodes, used by both wrappers |
| F14 | the drop list covered three selectors; `ANTHROPIC_BASE_URL` and `ANTHROPIC_CUSTOM_HEADERS` walked through it | Fixed by prefix: every `ANTHROPIC_*` goes. Confirmed with `strings` on the binary — it reads a dozen more, including `ANTHROPIC_UNIX_SOCKET` and `ANTHROPIC_CONFIG_DIR` |
| F15 | the probe's 30 s sat outside `--timeout-minutes` | Fixed: one deadline starting before the probe, and the child gets what is left |
| F16 | `--auth env` proceeds when the probe fails, which is a paid run on an unknown account | Fixed: `--auth env` fails closed on no answer, on `claude.ai`, and on an unasked-for third-party provider |
| F17 | the status line called the probe's answer "the credential", which a `--restricted` run may not use | Fixed: it says `auth probe:` and the doc says why |
| F18 | the spend register described an account the code no longer picks | Fixed in both places the guard requires |

**F14 is the one I would have kept getting wrong.** I had enumerated three variables from a
measurement and treated the list as the rule. The fix is a prefix, and the general form is: when a
defence is a list of names somebody else controls, the list is the bug.

## What is left

- **A pointer in `AGENTS.md`.** § Delegating names Sol and Fable; whether `run-claude.ts` deserves a
  line there is Greg's call, since that file's wording is a rule.
- **The doc claims `--restricted` removes MCP servers "here"** and says why that is a property of
  this repo's configuration. If a machine ever loads an MCP server from somewhere `--restricted`
  does not reach, `--strict-mcp-config` is still the one doing the work.
