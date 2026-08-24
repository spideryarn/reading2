# Codex CLI as a subagent

How to hand agentic work — reading code, editing files, running commands, reporting back — to
OpenAI's models by driving the **Codex CLI** from another coding agent.

This matters most on **Claude Code**, whose Task tool can only dispatch Claude models. Shelling out
to `codex exec` is how you get a GPT-backed agent that actually participates in the work: a
different model family reviewing a change catches different bugs, and delegating implementation is
cheaper per unit of work than doing it in the orchestrator.

The canonical path is the wrapper script [`scripts/run-codex.ts`](../../scripts/run-codex.ts).
Use it rather than calling `codex exec` yourself — see [Why a wrapper](#why-a-wrapper).

> **Provenance.** Adapted 2026-08-24 from `coding-agent-instructions/docs/CODEX_CLI_AS_SUBAGENT.md`
> in the MindstoneRebel repo, cut down to the parts that travel (that doc is wired into a
> CHIEF_ENGINEER workflow, a model roster and a report schema that don't exist here). Every claim
> below was re-verified against **codex-cli 0.146.0** on macOS; the original was written against
> v0.135.0 and one of its central safety claims no longer holds — see
> [the approval-policy trap](#the-approval-policy-trap).

## When to use it

- **Independent review by a different model family.** Different priors, different blind spots.
- **Delegated implementation** of a well-scoped editing task.
- **Isolated "go figure this out and report back"** investigations that don't need the
  orchestrator's running context.

Not worth it when the task needs the orchestrator's full conversation context, or when a
same-family subagent would do — the handoff has real overhead.

## Setup (once per machine)

```bash
codex --version                 # already installed?
brew install codex              # or: npm install -g @openai/codex
```

Then authenticate — the calling agent can't do this for you:

- `codex login` — interactive OAuth against a ChatGPT subscription. Tokens land in
  `~/.codex/auth.json` (`CODEX_HOME` moves the directory).
- `export CODEX_API_KEY=sk-…` — pay-as-you-go, better for headless use. Note OpenAI advises
  **against** `OPENAI_API_KEY` as a job-level env var in repos that run untrusted code; `codex exec`
  doesn't read it anyway.

Verify with a cheap round trip:

```bash
npx tsx scripts/run-codex.ts --model gpt-5.6-luna --effort low --prompt "Reply with exactly: OK" --print
```

## Quick start

```bash
# read-only investigation — the answer is left in a file whose path is printed
npx tsx scripts/run-codex.ts --prompt "Summarise how src/extract.ts assigns block ids"

# delegated implementation — writes are an explicit opt-in; commit or stash first
npx tsx scripts/run-codex.ts --sandbox workspace-write \
  --prompt-file /tmp/task.md --output /tmp/codex-answer.md
```

Flags: `--model` · `--prompt` / `--prompt-file` · `--sandbox` (default `read-only`) · `--effort`
(default `high`) · `--repo-dir` · `--timeout-minutes` (default 30) · `--output` · `--activity-log` ·
`--stream` · `--print` · `--dry-run`.

The script is quiet by default: it prints the output path and a status line, **not** Codex's answer.
Read the output file deliberately afterwards. That is the point — see
[context flooding](#3-context-flooding) below.

## Why a wrapper

Three failure modes are real, and all three are the kind a documented gotcha doesn't reliably
prevent — an agent that has read the warning still forgets it. The wrapper makes them impossible by
construction, because there is no unsafe knob to forget.

### 1. The stdin hang

`codex exec` appends stdin to the prompt as a `<stdin>` block whenever fd 0 is a non-TTY that stays
open — **even when the prompt is passed as a positional argument**. An orchestrator shelling out
leaves exactly that: an inherited open pipe. Codex prints `Reading additional input from stdin...`
and blocks forever waiting for an EOF that never comes. Verified still true on 0.146.0: a `spawn`
with `stdio: ['pipe', …]` was still alive 25 seconds into a one-word prompt.

There is no `--no-stdin` flag. The fix is to close fd 0 — `stdio[0] = 'ignore'` from Node,
`< /dev/null` from a POSIX shell. Closing it is what matters, not the `/dev/null` path literally.

> You will still see `Reading additional input from stdin...` in the log even when fd 0 is closed.
> That's fine — it prints the message, gets an immediate EOF, and carries on.
>
> The one exception: if you're *deliberately* feeding a prompt too large for argv through stdin,
> don't close fd 0 — redirect a **finite** file that EOFs (`codex exec - < prompt.txt`). The bug is
> an open pipe with no EOF, not stdin as such.

### 2. No hard timeout

`spawnSync`'s `timeout` sends a signal and then blocks waiting for the child to exit, so a child
that ignores SIGTERM wedges you anyway. The wrapper uses async `spawn` plus a real watchdog:
SIGTERM → 5s grace → SIGKILL, applied to the **whole process group** (Codex is spawned `detached`,
so it leads its own group). Without the group kill, a timeout leaves every MCP stdio server Codex
started orphaned to init, alive indefinitely.

Verified: a stand-in child that ignores SIGTERM and spawns a grandchild was killed at
timeout + grace, grandchild included.

### 3. Context flooding

Codex's *hidden reasoning* never comes back to you — that's the token-economics win. But Codex also
streams an **activity log**: every command it ran, together with that command's full stdout — file
contents, grep hits, build output. A high-effort review reading dozens of files emits tens of
thousands of tokens of it, and an orchestrator's subprocess call swallows all of it into context.

The wrapper captures that log to a file and prints only its path, so the caller ingests three lines.
The final answer goes to Codex's `-o` file, so it isn't double-counted either. Pass `--stream` when
a *human* is watching a terminal; leave it off for orchestrated runs.

If you ever do run raw `codex exec` from an orchestrator, redirect it
(`codex exec … > /tmp/codex.log 2>&1`) and read only the `-o` file.

## Read-only vs write — the safety switch

`--sandbox read-only` (the default) · `workspace-write` · `danger-full-access`.

`workspace-write` lets Codex create and edit anything under the working directory and run routine
local commands; it still blocks network writes and out-of-workspace writes (extend with
`--add-dir`). `danger-full-access` removes all confinement — container or VM only, never a dev
machine.

### The approval-policy trap

**`--sandbox read-only` on its own is not a boundary.** Codex's sandbox is only authoritative when
`approval_policy = "never"`. Under `on-request` the model can *escalate past the sandbox* — and if
the local config names an automated approver (`approvals_reviewer`, as a ChatGPT-desktop install
sets up), the escalation is granted with no human anywhere in the loop.

Observed directly on 0.146.0: a run with `--sandbox read-only`, dispatched from a machine whose
`~/.codex/config.toml` set `approvals_reviewer = "guardian_subagent"`, reported
`approval: on-request` in its header and cheerfully created the file it had been asked for.

```
--sandbox read-only                             → wrote the file   ✗
--sandbox read-only  -c approval_policy=never   → refused          ✓
--sandbox read-only  -c approval_policy=on-request  → wrote the file   ✗
```

So `-c approval_policy=never` is **hardcoded into the wrapper's argv** rather than left as an
option. `codex exec`'s own built-in default *is* `never` (a run with `--ignore-user-config` refuses
correctly) — but the user's config file silently overrides it, and you can't assume anything about
the config on the machine you're dispatching from. Pass it explicitly, always. `never` doesn't make
Codex more permissive: a blocked operation simply returns its failure to the model.

### Commit before you let it write

`workspace-write` edits land **directly in your working tree**, interleaved with whatever
uncommitted work is already there. Before any write-capable run:

1. **Commit or stash**, so `git diff` afterwards shows exactly what Codex did and nothing else.
2. For parallel or higher-risk runs, dispatch into a **git worktree** on its own branch.
3. **Review the diff.** Codex's output is a proposal, not a trusted commit.

> A `workspace-write` run inside a *linked* git worktree can edit but cannot `git commit`: the
> sandbox blocks `.git/worktrees/<wt>/index.lock`, which lives outside the writable root. The run
> reports the commit step as failed and still leaves valid edits — verify the diff and commit from
> outside.

## Reviewing what it writes back

One failure mode worth naming, because a cross-family reviewer catches it and same-family review
often doesn't: **over-applied exhaustiveness**. Asked to make a `switch` exhaustive or to clear a
type error, GPT/Codex tends to add an `assertNever` or a throwing `default` on the union. That's
right only for a **closed, locally-owned** union. For unions that are open at runtime — events off a
stream or IPC, values built from `as`-cast JSON, plugin payloads, anything whose producer can ship a
new variant independently — an exhaustive `assertNever` converts an unknown-but-harmless variant
into a crash. The compiler is happy, because the *type* claims the union is closed.

So: flag any added `assertNever` or throwing `default` on a union that crosses a runtime boundary,
and run the actual test suite over a Codex diff rather than trusting a green type-check.

## Picking the model and effort

As of 2026-08-24 the Codex CLI offers:

| Model | Use |
|---|---|
| `gpt-5.6-sol` | frontier agentic coding — hard reviews, gnarly implementation |
| `gpt-5.6-terra` | balanced, everyday work |
| `gpt-5.6-luna` | fast and cheap — smoke tests, mechanical edits, quick opinions |
| `gpt-5.5`, `gpt-5.4` | previous generation; still selectable |

`gpt-5.4-mini` is deprecated in favour of `gpt-5.6-luna`. Availability differs between
ChatGPT-subscription auth and API-key auth, and a model that 400s under one may work under the
other — check `~/.codex/models_cache.json` or just try it, rather than trusting a hardcoded list.

Reasoning effort is the config key `model_reasoning_effort`, values
`minimal | low | medium | high | xhigh`. There is **no CLI flag** — it's set with `-c`, which the
wrapper does for you via `--effort`. At `high`/`xhigh` a substantial task can run 20–40 minutes, so
expect long silences. A trivial `low` run round-trips in about 10 seconds.

Defaults for the whole machine go in `~/.codex/config.toml`, per-project ones in
`.codex/config.toml`:

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
```

## Raw `codex exec` — the escape hatch

For a human in a shell, or when you need a flag the wrapper doesn't expose:

```bash
codex exec \
  --model gpt-5.6-sol \
  -c model_reasoning_effort="high" \
  -c approval_policy="never" \
  --sandbox workspace-write \
  --cd /path/to/repo \
  --skip-git-repo-check \
  -o /tmp/codex_last.txt \
  -- "Implement X." \
  < /dev/null
```

Both the `-c approval_policy="never"` and the `< /dev/null` are load-bearing; the `--` stops a
prompt beginning with `-` from being read as a flag.

Flags worth knowing (verified on 0.146.0):

- `-m` / `--model`, `-s` / `--sandbox`, `-C` / `--cd`, `--add-dir`, `--skip-git-repo-check`
- `-c key=value` — config override; the value is parsed as TOML, falling back to a literal string
- `-o` / `--output-last-message <path>` — write just the final message to a file. The easiest
  "give me the answer" path, and the CLI writes it outside the sandbox, so a read-only reviewer
  never needs write access to report.
- `--json` — NDJSON event stream on stdout (`thread.started`, `turn.*`, `item.*`, `error`);
  progress goes to stderr, so piping stdout stays clean.
- `--output-schema <file.json>` — enforce a JSON Schema on the final response. Unreliable when MCP
  tools are active ([openai/codex#15451](https://github.com/openai/codex/issues/15451)) — validate
  it yourself.
- `--ignore-user-config` — ignore `~/.codex/config.toml` (auth still resolves). Useful for
  reproducing a run without the local machine's plugins, MCP servers and approval settings.
- `--ephemeral` — don't persist the session.
- `codex exec` has **no** `-a` / `--ask-for-approval`; that's interactive-mode only. Control it with
  `-c approval_policy=…` as above.

There is also a `codex exec review` subcommand that runs a code review against the current repo, and
`codex exec resume --last "…"` / `resume <SESSION_ID>` for multi-turn (sessions persist as JSONL
under `~/.codex/sessions/`; capture the id from the `--json` `thread.started` event).

> **Don't use the `codex-plugin-cc` Claude Code plugin for load-bearing work.** Its dispatched
> subagent relays the verdict through a Claude wrapper, which has been observed both to go idle
> without relaying anything and — worse — to answer with its *own* Claude analysis when the Codex
> child hadn't returned, silently turning a cross-family review into a same-family one. The
> file-based path here rules that out by construction: the verdict lands in a file you read.

## Gotchas

- **Read-only is the default, but only `approval_policy=never` enforces it.** See
  [above](#the-approval-policy-trap).
- **Background `codex exec` hangs unless fd 0 is closed.** See [above](#1-the-stdin-hang).
- **Auth is a human setup step** — the calling agent can't `codex login` for you.
- **Don't pipe Codex's raw stdout back in as a prompt.** It's a prompt-injection vector as soon as
  Codex echoes file or user content. Use `-o` and parse deliberately.
- **`listen EPERM` on a tsx IPC pipe.** A `workspace-write` run that itself shells out to `npx tsx`
  can fail with `listen EPERM … /tmp/…/*.pipe`. That's a sandbox artefact, not a code failure — the
  sandbox blocks the named pipe tsx opens for IPC. Re-run the validation in your own shell, or
  invoke it as `node --import tsx …`.
- **Stale-looking answers.** A run occasionally returns something that reads as an answer to a
  *previous* prompt. The wrapper writes a fresh temp `-o` file per run and never resumes a session,
  so it isn't output reuse on this side; the likely causes are upstream. Treat such an answer as
  suspect, re-run with a textually distinct prompt, and never let a single Codex pass carry a
  load-bearing claim ("X is already implemented", "this is safe") without a second check.
- **Cost.** A runaway high-effort run burns quota fast. The wrapper caps any single run at
  `--timeout-minutes`.

## Sources

- [Codex CLI reference](https://developers.openai.com/codex/cli/reference) ·
  [non-interactive mode](https://developers.openai.com/codex/noninteractive) ·
  [config](https://developers.openai.com/codex/config-reference) ·
  [models](https://developers.openai.com/codex/models) ·
  [auth](https://developers.openai.com/codex/auth)
- [openai/codex releases](https://github.com/openai/codex/releases)
- Everything under [Why a wrapper](#why-a-wrapper) and
  [the approval-policy trap](#the-approval-policy-trap) was verified by direct experiment on
  codex-cli 0.146.0, 2026-08-24, not taken from docs.
