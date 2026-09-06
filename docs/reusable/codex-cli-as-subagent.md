# Codex CLI as a subagent

How to hand agentic work — reading code, editing files, running commands, reporting back — to
OpenAI's models by driving the **Codex CLI** from another coding agent.

This matters most on **Claude Code**, whose Task tool can only dispatch Claude models. Shelling out
to `codex exec` is how you get a GPT-backed agent that actually participates in the work: a
different model family reviewing a change catches different bugs, and delegating implementation is
cheaper per unit of work than doing it in the orchestrator.

The canonical path is the wrapper script [`scripts/run-codex.ts`](../../scripts/run-codex.ts).
Use it rather than calling `codex exec` yourself — see [Why a wrapper](#why-a-wrapper). Its mirror
image is [claude-cli-as-subagent.md](claude-cli-as-subagent.md), for reaching Opus from something
that is not a Claude session; the two wrappers share a spawn core.

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

### The house workflow in this repo

Specific to this project; the rest of the doc travels. **Every plan under `docs/plans/` goes to GPT
Sol before it is built, and the code built from it goes back for a second review.**

```bash
npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 \
  --prompt-file <review-prompt> --output <review-answer>
```

Read-only, in the background, and give it three quarters of an hour. The tree is read-only, but the
reviewer *can* run one test file or a tsx script — see [the review profile](#the-review-profile) —
so say so in the prompt, and say how: `npx vitest run tests/<one>.test.ts` and
`node --import tsx <script>`, not `npm test` or `npm run typecheck`, which the sandbox still stops.
Until 2026-09-02 it could not, and fifteen reviews in a row were reasoning rather than
reproduction — every attempt to run a test is in their activity logs, dying on `EROFS`.

**But only a test that needs nothing outside the tree.** The profile has *no network at all*, not
even loopback, so anything touching Postgres or a local service skips or fails however it is
invoked, and `data/` is not writable either. Those are **the orchestrator's to run**, handing over
the raw output — not the reviewer's. Promising "you can run a test file" without that caveat is how
a review comes back with five Postgres assertions quietly skipped.

**Weight the second review higher than the first — higher, not instead.** A plan-stage review reads
prose, so it can only catch what the prose says. It cannot find a `PATCH` handler that writes one
field and then rejects the request — that bug does not exist until somebody writes it. Reviewing the
plan and calling the job done is reviewing the half where the bugs are not.

But the plan review is where a design error is still cheap, and it is the round most likely to find
something you could not have. On 2026-09-02 it returned "not ready" and was right four times over —
one of its findings was that a list the plan proposed deriving mechanically would have fed HTML to a
JSON parser. Building that and tearing it out at code review would have cost a stage.

**Hand it the evidence, not only the prose** — the scoped diff, the results file, the script that
produced a number. The most useful finding is often about the experiment rather than the conclusion,
and a reviewer given only the conclusion cannot make it. **Name that evidence durably**: a revision
range, or a base SHA plus scoped paths plus an explicit untracked-file list — never a `/tmp` path,
which is unreadable tomorrow and gone on the next machine.
[review-prompt-template.md](review-prompt-template.md) is the whole shape of the message, including
the severity scale and why your own suspicions go last.

**Check each finding yourself before acting on it.** Some of them are wrong. Fold what survives into
the plan, and add its questions to the ones for Greg.

**If you can write the question, write the fix before you send it.** On 2026-09-02 four rounds all
returned rejections, and *three of the four headline findings were suspicions already written into
the prompt* — "can this loop pass while checking nothing?", "`existsSync` is weak", a list of `GIT_*`
variables that might leak. Sol confirmed each. A round spent confirming what you already suspected
is a round not spent on what nobody saw. Turn "is X weak?" into "X now does Y — break it."

**Ask for the mutation, not for a patch.** For each finding, ask for *(a)* the input under which the
current code fails its own claim, something you can run, and *(b)* the smallest change that closes
it, as a code block. Rank by (a): a finding with no (a) is an opinion, and goes last. Then the
implementer's rule is **apply (a) first and watch it go red**, apply (b), watch (a) get caught, and
report per finding *reproduced / could not reproduce / disagree*. Never apply a (b) whose (a) you
could not make fail.

Don't ask for the patch itself. It means a write-capable run in your working tree, and on the next
pass the reviewer checks that its own patch was *applied* rather than whether it was *right*. Nobody
gets invested in a mutation, which is what makes it the guardrail.

**On a second pass, say what is new.** *"Previous findings are at `<file>`; treat their fixes as
unreviewed code written by someone else, and spend most of the run on what has changed since."*

**And check that a verdict actually arrived** — exit 0, *and* read the answer file, because a review
that returned nothing looks exactly like a review that found nothing. This is
[silent-success.md](silent-success.md) with a subprocess in it; the several ways it happens are under
[Gotchas](#gotchas). `retrying with CODEX_API_KEY` on stdout is the fallback working, not a failure.

**Assume intermittent, not down.** The commonest way a run returns nothing is an `HTTP 404` from the
responses endpoint, and it comes and goes: on 2026-09-03 it failed twice five minutes apart and then
worked later the same day. So retry before concluding the reviewer is unavailable — and if it really
is, say plainly that the review could not run rather than committing as though it had found nothing.

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

`CODEX_API_KEY` **takes precedence over a logged-in `~/.codex/auth.json`** rather than being ignored
because one exists — verified 2026-08-26 on 0.149.1, where a subscription that was out of credits ran
fine as soon as the key was set for the one command. So the two are a fallback pair, and a
credits-exhausted subscription doesn't have to stop a run.

### Which credential a run spends

Since 2026-08-26 the wrapper decides that, with `--auth`:

| Mode | What runs |
|---|---|
| `subscription-first` (**default**) | the subscription; if that credential is spent, the whole run again with the key |
| `key-first` | the key, or the subscription if no key is set — one attempt. The behaviour before this flag existed |
| `subscription-only` | the subscription, never the key — one attempt |

The subscription goes first because it is already paid for. There is no codex flag for this: codex
prefers `CODEX_API_KEY` whenever the variable is set, so **"prefer the subscription" is implemented
by withholding the key** — `childEnv(…, useCodexKey: false)` — and the fallback is a second full
run with it put back.

### When it actually falls back

**Positive evidence, every time.** The bar is a credential phrase in codex's own `ERROR:` lines and
nothing else clears it — `isCredentialFailure` matches out-of-credits (both spellings), rate and
usage limits, 401 and 429, anchored the way `authHint` is. Unanchored, it would retry any run that
happened to `cat` this very page.

Three things never fall back, and each was a deliberate narrowing:

- **A timeout, a capture overflow, a missing binary.** Not the account's fault. A 45-minute review
  that times out would otherwise spend another 45 minutes timing out again.
- **A streamed run** (`--stream`), which handed both channels to the terminal and so captured no
  evidence at all. The first version read that as "no log, so fall back on any failure", which is
  backwards: *no evidence is a reason not to spend the second credential.* A human is watching a
  `--stream` run by definition, and they can re-run it.
- **A write-capable run** (`workspace-write`, `danger-full-access`), whatever the log says. Attempt
  2 starts fresh and runs the whole prompt again over attempt 1's half-finished edits. Whether that
  is recoverable is a judgement about the diff, so it belongs to whoever reads it. The failure
  message says so and names `--auth key-first`, because otherwise it looks exactly like a run
  `--auth` was never going to help.

**Exit 0 with an empty, whitespace-only or missing `-o` file** is a failure rather than an answer —
see [the gotcha below](#gotchas) — but it falls back only on the same evidence as anything else.
It used to fall back unconditionally, on the reasoning that an exit code of 0 tells you nothing;
true, but the log does, and the one time this was actually observed the credit error was right
there in it. So the unconditional branch only ever added false retries. GPT Sol's finding.

`--pass-env CODEX_API_KEY` is **rejected**: `--pass-env` is applied after the denylist sweep, so it
would hand the key to an attempt that had asked for the subscription — which then spends the key,
reports the subscription, and "falls back" to the credential it was already using. Every observable
thing about that run is wrong and none of it looks wrong. Also GPT Sol's.

Two more things worth knowing:

- **A dead first credential costs about 12 seconds**, measured 2026-08-26: five
  `ERROR: Reconnecting... n/5` lines and then the real reason. That is the standing tax on every
  run while the subscription is dry. `--auth key-first` skips it.
- **The retry is announced on stdout** (`the ChatGPT subscription could not run this — retrying
  with CODEX_API_KEY`) and the final status line names the credential that produced the answer. A
  run that quietly cost twice what you expected is the whole risk of doing this automatically.

Both attempts' activity goes into one log file, banner-separated (`=== attempt 1, the ChatGPT
subscription ===`), and a silent attempt still gets its banner — a log holding only attempt 1 reads
exactly like a run that never retried.

The honest gap: `ERROR:` is a log level, not proof of provenance. A command codex runs could print
`ERROR: 429` of its own and buy itself one wasted retry. Given the three exclusions above, the worst
case is a read-only run repeated once, so this is not worth a provenance mechanism — but it is why
the bar is codex's ERROR lines rather than the whole log.

**In this repo, put it in `.env.local`.** The wrapper loads that file itself, via the same
[`src/env.ts`](../../src/env.ts) every other script here uses, so nothing has to be exported first
and an agent doesn't have to know the trick. The import is dynamic, and *only* a missing module is
ignored — anything else the loader throws is rethrown, because a half-built environment surfaces
downstream as an auth failure pointing at the wrong thing. See
[setup-dev.md § Secrets](../project/setup-dev.md#secrets).

> **`.env.local` beats anything the shell exported**, since 2026-08-26. So a dead `CODEX_API_KEY`
> there cannot be got round from the calling shell — use `--auth` rather than trying to unset the
> variable. The [escape hatch](#raw-codex-exec-the-escape-hatch) equivalent is
> `env -u CODEX_API_KEY codex exec …`, carrying the wrapper's three guarantees by hand:
> `< prompt.md` (a finite file that EOFs), a `timeout`, and `> some.log 2>&1` so the activity log
> lands in a file and only the `-o` answer is read.

### What codex is allowed to see

Loading `.env.local` puts **every** secret this repo owns into the wrapper's own process, and
`spawn` hands its whole environment to the child unless told otherwise. That matters more than it
looks: codex runs shell commands on the model's instruction, their stdout becomes the activity log,
and the model can quote that log back in its final answer — which we print. A single `env` in a
debugging tool call is enough to move an unrelated production database URL into a file and then
into the caller's context. Nothing about that needs the model to be adversarial.

So the child environment is **deny-by-default on the variable's name**, by three rules, and
`CODEX_API_KEY` is re-added afterwards so exactly one credential crosses on purpose:

| Rule | Matched | Words |
|---|---|---|
| unambiguous words | anywhere in the name | `SECRET` `PASSWORD` `PASSWD` `CREDENTIAL` `APIKEY` `JWT` `BEARER` `_PWD` `KUBECONFIG` `NETRC` |
| ambiguous words | whole `_`-delimited segments | `KEY` `TOKEN` `AUTH` `COOKIE` `PRIVATE` `DSN` `SIGNATURE` |
| credential-bearing values | whole name | `DATABASE_URL` and friends, `*_URI`, `*_PROXY` |

Two rules rather than one because the word decides which: a segment boundary everywhere would lose
`PGPASSWORD` and `CI_JOB_JWT`, and substring matching everywhere would eat `AUTHOR`. `SSH_AUTH_SOCK`
goes — a path rather than a secret, but it hands over the ssh agent.

`--pass-env NAME` (repeatable) brings a named variable back for an MCP server that needs a token of
its own, or for a `workspace-write` run that has to push. Each crossing is then visible in the
command line.

A denylist is a guess about names, and the honest failure mode is a credential named something none
of these rules anticipated. Treat it as reducing the blast radius rather than as a boundary.

A denylist rather than an allowlist because codex needs a large and unenumerable slice of the
environment — `PATH`, `HOME`, `TMPDIR`, `LANG`, the npm and XDG variables, whatever a plugin wants —
and an allowlist would break in ways nobody could predict from reading it.

This was **not** a risk the `.env.local` load created out of nothing. A developer's shell routinely
exports credentials for unrelated projects, and before this those crossed too.

#### It is not sufficient, and here is the measurement

Codex's shell tool runs a **login** shell, which sources `~/.zprofile` and `~/.zshrc`. If those
export secrets — and on this machine, 2026-08-26, they export `OPENROUTER_API_KEY` and
`OPENAI_API_KEY` — the profile puts back what the wrapper took out, and nothing the wrapper can do
from outside prevents it:

```
env -i PATH=… HOME=… bash -lc 'env | grep -c "OPENROUTER\|OPENAI_API_KEY"'   → 0
env -i PATH=… HOME=… zsh  -lc 'env | grep -c "OPENROUTER\|OPENAI_API_KEY"'   → 2
```

Asked to run `env | grep -c OPENROUTER`, a live codex run under the sanitised environment answered
`1`. So the honest claim is narrow: **the wrapper stops itself from being the leak** — the
`.env.local` it loads for `CODEX_API_KEY` does not travel — and on a machine whose shell profile is
clean, that is the whole of it. Where the profile exports secrets, the fix is the profile. Keep
credentials in per-project `.env` files that a tool loads deliberately, rather than exported to
every process you or anything you run ever starts.

`ZDOTDIR` pointed at an empty directory would stop zsh reading those files, and is deliberately not
done here: it also drops the PATH edits and version-manager setup that codex needs to run anything,
so it trades a leak for a class of failures that are much harder to diagnose.

Two account-level failures — out of credits, and not logged in — arrive as a bare `exit 1` with the
reason buried in the activity log the caller has just been told not to read. The wrapper matches
those two and adds a one-line hint to its error, quoting none of the log around them.

It matches only on codex's own `ERROR:` lines, and only on a non-zero exit. The activity log is
mostly *the contents of files codex read*, so an unanchored search reads the repo's prose back to
itself — this very page contains the string "out of credits", and a run that failed for some other
reason after merely opening it would have been told to go and buy credits it already had. A
confident wrong hint is worse than no hint.

Verify with a cheap round trip:

```bash
npx tsx scripts/run-codex.ts --model gpt-5.6-luna --effort low --prompt "Reply with exactly: OK" --print
```

## Quick start

```bash
# read-only investigation — the answer is printed, the activity log is not
npx tsx scripts/run-codex.ts --prompt "Summarise how src/extract.ts assigns block ids"

# delegated implementation — writes are an explicit opt-in; commit first, and prefer a worktree
npx tsx scripts/run-codex.ts --sandbox workspace-write \
  --prompt-file /tmp/task.md --output /tmp/codex-answer.md
```

Flags: `--model` · `--prompt` / `--prompt-file` · `--sandbox` (default `review`) · `--effort`
(default `high`) · `--auth` (default `subscription-first`) · `--repo-dir` · `--timeout-minutes`
(default 30) · `--output` · `--activity-log` · `--stream` · `--print` · `--quiet` ·
`--max-print-chars` (default 20,000) · `--pass-env` · `--dry-run`.

### What reaches the caller's context

The split is the whole reason the wrapper exists, so it is worth stating exactly:

| | Where it goes |
|---|---|
| Codex's hidden reasoning | nowhere — it never leaves OpenAI |
| The **activity log** (every command Codex ran, plus that command's full stdout) | **a file**, whose path is printed |
| The **final answer** | **stdout**, capped at `--max-print-chars`, and a file |
| Status (model, effort, sandbox, the two paths) | stdout, two or three lines |

So a caller gets the answer and roughly a hundred tokens of overhead, and the hundreds of kilobytes
of file dumps and grep hits stay on disk where you can go and read them if you want to. Measured on
a stand-in run: **488 KB of activity log → 354 bytes on stdout**, and that is asserted in
[`tests/run-codex.test.ts`](../../tests/run-codex.test.ts) rather than left as a claim.

A very long answer is truncated in the middle — keeping the opening *and* the tail, since a reviewer
puts the verdict last — with a line saying how much was cut and where the full text is. `--print`
lifts the cap; `--quiet` prints paths alone; `--stream` sends everything to the terminal for a human
to watch and is wrong for an orchestrated run (and is therefore rejected in combination with either
of the other two, since neither can be honoured once both streams are inherited).

**Safe by default, not by construction.** Unlike the stdin and timeout guarantees, this one has two
deliberate ways out — `--stream` and `--print` — and both are unbounded. Everything else is capped,
including things that aren't the answer: an answer file over 4 MiB is excerpted with two bounded
reads rather than slurped (the `-o` file had no equivalent of the activity log's 64 MiB capture cap,
and codex's final message being small *in practice* is exactly what would have kept that untested),
and `--dry-run` caps the prompt it echoes, which with `--prompt-file` is unbounded text too.

## Why a wrapper

Three failure modes are real, and all three are the kind a documented gotcha doesn't reliably
prevent — an agent that has read the warning still forgets it. The first two the wrapper makes
impossible by construction: there is no knob for them at all. The third is safe by default with two
named escape hatches, which is the most you can do for a thing whose whole point is sometimes to be
watched by a human.

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

The wrapper captures that log to a file and prints only its path. The answer itself *is* printed —
that's what you asked for, and making the caller shell out a second time to `cat` it buys nothing —
but capped, so a runaway answer can't do what the activity log would have. Pass `--stream` when a
*human* is watching a terminal; leave it off for orchestrated runs.

`--stream` gives up one more guarantee than it looks like, and this is the whole of it: it hands
codex the caller's own descriptors, so the wrapper no longer owns the pipes and cannot let go of
them. A helper the run leaves behind — detached into its own process group, past the group kill —
then holds the *caller's* stdout open after the wrapper has exited, and a script capturing that
output waits for it (measured 2026-09-06, GPT Sol). Every other mode bounds this; `--stream` cannot
without owning and re-emitting both streams, which is the one thing it exists not to do. So it stays
as it is, and stays wrong for an orchestrated run for a second reason.

If you ever do run raw `codex exec` from an orchestrator, redirect it
(`codex exec … > /tmp/codex.log 2>&1`) and read only the `-o` file.

## Read-only vs write — the safety switch

`--sandbox review` (the default) · `read-only` · `workspace-write` · `danger-full-access`.

`workspace-write` lets Codex create and edit anything under the working directory and run routine
local commands; it still blocks network writes and out-of-workspace writes (extend with
`--add-dir`). `danger-full-access` removes all confinement — container or VM only, never a dev
machine.

### The review profile

`read-only` means it: no writes anywhere, and on 2026-09-02 the activity logs of fifteen Sol
reviews on this box showed what that costs. Every attempt to run a test died — vitest on
`node_modules/.vite-temp`, where it bundles its config (`EROFS`), and tsx on the IPC pipe it opens
under `/tmp` (`listen EPERM`). Plain `tsc --noEmit`, grep and `git diff` worked, so the reviews
were type-checked reasoning, never a reproduction, and the house rule — *apply (a) and watch it go
red* — was one the reviewer could not follow.

`review` is codex's own answer to that: a **named permissions profile**, a `[permissions.<name>]`
table with per-path rules, which the wrapper selects with `-c default_permissions=review` in place
of `--sandbox`. The table is checked in at [`.codex/config.toml`](../../.codex/config.toml): read
everywhere, write to `/tmp` and to the three cache directories under `node_modules`, and nothing
else. The same file also sets `default_permissions = ":workspace"`, because codex requires a
top-level default as soon as a `[permissions]` table exists: without it every `codex` in the
checkout — a human's interactive session included — exits 1 before the model. The wrapper
overrides it with `review` or an explicit `--sandbox`, and neither is loosened by it.
Measured under the profile, first with `codex sandbox` (the sandbox with no model in it, free)
and then with a real `codex exec`:

| | `read-only` | `review` | `workspace-write` |
|---|---|---|---|
| `touch src/x` | refused | **refused** | written |
| `npx vitest run tests/<one>.test.ts` | `EROFS` | **14 passed** | passes |
| `node --import tsx scripts/typecheck.ts` | `EPERM` | **runs** | runs |
| `npx tsc --noEmit` | runs | runs | runs |
| `npm run typecheck` (the tsx CLI) | `EPERM` | `EPERM` | `EPERM` |
| `npm test`, the whole suite | no | no | no |

The last two rows are the honest limits **of this profile**, and it is worth knowing why, because
the reason is not the one this doc gave until 2026-09-04. Both follow from the profile's **network**
policy, which `review` does not grant at all — not the internet, not loopback; `curl
http://127.0.0.1:…` exits 7. With the network proxy off, enabling direct networking permitted both
the tsx unix socket and the Postgres connection; no allowlisted configuration tested delivered
those two. So run scripts as `node --import tsx <script>`, which opens no socket. Neither limit
matters for a review: one red test file is the reproduction, a green suite is the implementer's
job, and **the Postgres half is the orchestrator's to run and hand over.**

> This paragraph used to say the tsx CLI's unix socket "is denied in every mode" and that a
> `unix_sockets` rule did not change it. That was wrong, and it mattered: it read as a property of
> the sandbox, so nobody looked again. It is a property of *this profile*. See
> [What network would buy](#what-network-would-buy-and-why-the-profile-does-not-grant-it).

### What network would buy, and why the profile does not grant it

Measured 2026-09-04 on 0.152.1, mostly with `codex sandbox`, which runs a command under a profile
**with no model in it and at no cost** — the cheap way to settle any question on this page. Point
`CODEX_HOME` at a directory holding a throwaway `config.toml` and you can test a profile without
touching the repo's. **Run it from a host shell**: from inside a sandboxed review it aborts before
executing anything (`failed to open synthetic bubblewrap mount registry lock … Read-only file
system`, exit 101), because bubblewrap will not nest. The full configurations, commands and raw
output are in
[the plan](../plans/260904e-give-the-cross-family-reviewer-the-right-freedoms.md#what-was-measured-2026-09-04-codex-cli-01521-hetzner-box);
what follows is the conclusion.

| Profile | `curl` external | `curl` loopback | `npm run typecheck` | a real Postgres test |
|---|---|---|---|---|
| `review` (what is checked in) | ✗ exit 7 | ✗ exit 7 | ✗ `EPERM` | ✗ |
| `[permissions.X.network] enabled = true` | 200 | 200 | **passes, 1266 files** | **16/16 passed** |
| the same `+ features.network_proxy` and a loopback allowlist | ✗ blocked | 200 | ✗ `EPERM` | ✗ 5 of 16 failed |
| the same again with `network.mode = "full"` | ✗ blocked | 200 | ✗ `EPERM` | ✗ 5 of 16 failed |

Row 2 is the temptation: turn network on and the reviewer can typecheck the repo and reproduce a
Postgres finding against a real database, which is where most of this codebase's bugs live.

Rows 3 and 4 are why we don't take the middle road. Codex *does* have a host allowlist —
`features.network_proxy = true` plus a `[permissions.<name>.network.domains]` table of
`"host" = "allow"` — and it works as an allowlist. But **turning the proxy on is what re-denies the
unix socket**, so typecheck dies again; and a client that does not speak SOCKS never arrives, since
the proxy is reached through `ALL_PROXY=socks5h://…` — the Postgres driver gets
`connect ECONNREFUSED 127.0.0.1:1`. `network.mode = "full"` does not change either. So for **these two
capabilities** the choice is binary — direct networking or neither of them. Networking as such is
not binary: the row above has loopback HTTP returning 200 while external access is blocked, which
is a real allowlist doing exactly what it says. It just doesn't buy what a reviewer needs.

**We take no network.** With `"/" = "read"`, a network-capable reviewer is a process that can read
`.env.local` — including a production `DATABASE_URL` — and make outbound requests, moments after
reading a corpus of untrusted article prose. Nothing about that requires the model to be
adversarial. Deny rules exist and work (`"/path" = "none"`, globs included), but they do not save
it: denying `.env*` stops the suite reading `DATABASE_URL` and so removes the capability you turned
network on for, and denying `~/.codex` stops codex executing its own binary.

The cost we accept is real — the reviewer reasons about Postgres rather than reproducing it. Pay it
by running that suite yourself and handing over the raw output.

It is a relaxation of what the reviewer can *run*, not of what it can *change*: the sandbox still
refuses a write to anything git tracks, so nothing in [Commit before you let it write](#commit-before-you-let-it-write)
applies, and a `review` run is retried on the other credential exactly as a `read-only` one is.
The profile is not `workspace-write` under another name, and the reason not to reach for that
instead is the reason the whole review design gives: a reviewer that can edit the tree is a
reviewer that will fix the finding rather than hand back the mutation.

Three traps in codex's side of it, all hit while measuring:

- **A profile needs an explicit `"/" = "read"`.** Without it bwrap cannot even exec the codex
  binary under `~/.codex`, and the failure is a bare `execvp … No such file or directory`.
- **`-c` cannot express the rules.** `-c 'permissions.review.filesystem."/tmp"="write"'` keeps the
  quotes in the path and fails as *must be absolute*, so the table lives in a config file, and the
  right one is the repo's own `.codex/config.toml` — every agent's run finds it there, whichever
  machine, and the `:workspace_roots` token keeps the paths relative to the checkout. A repo without
  the table gets codex's `default_permissions requires a [permissions] table` at exit 1, in the
  log nobody reads; the wrapper checks for the header first and refuses in one line, naming
  `--sandbox read-only` as the way to run there anyway.
- **A table on disk is not enough — the checkout has to be trusted.** Codex reads a project's
  `.codex/config.toml` only when `$CODEX_HOME/config.toml` names that directory, or one above
  it, as a trusted project. Anywhere else it skips the file *in silence*. So in a fresh clone —
  a new box, a repo cloned to a new path — selecting `review` fails exactly as though the table
  were missing, while the wrapper's own check has read it off disk and agreed it is there. Trust
  the checkout root once and its subdirectories and worktrees inherit it:

  ```toml
  [projects."/absolute/path/to/checkout"]
  trust_level = "trusted"
  ```

  It cannot be passed on the command line — `-c 'projects."/abs".trust_level="trusted"'` does
  not compose — so this is a line somebody adds to their own config. The wrapper cannot prevent
  it, but it recognises the failure and prints that stanza with the path filled in.

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

1. **Commit first**, so `git diff` afterwards shows exactly what Codex did and nothing else. This
   line used to say "commit *or stash*", and where agents share a checkout that is the most
   destructive suggestion in this file — the work it hides belongs to people who are not in the
   room, and one agent did it to seventeen others' files on 2026-08-30. If you cannot commit because
   the tree holds somebody's half-finished work, use a worktree.
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

## Four ways the second opinion gets wasted

Every one of these happened here, and none of them looked like a mistake at the time.

**Relay the findings verbatim.** Do not renumber, merge, split or reorder them around what you found
most interesting. On 2026-08-28 Sol refused a stage with four findings; the implementer's brief was
written in my own structure, promoting a sub-paragraph of finding 1 into its own item. Four went in
and four came out, so nothing looked missing — but finding 3, a P1 about a tombstone not migrated
when the server renames a thread, was gone. The agent never had it, fixed the other three, and the
next review opened with *"This is the previous blocker unchanged."* **The count matching is what
makes this hard to catch.**

**Don't pre-empt a delegated check.** When the instruction is "use a subagent to check X, and if so
do Y", wait for the subagent rather than running the check yourself in parallel and acting on your
own answer. The second opinion is the point, and it is worth most exactly where the first one is
confident; overlapping the work leaves you with one opinion wearing two hats. On 2026-08-28 that
deleted three untracked scratch files, and the subagent's report — arriving afterwards — disagreed
about one of them, correctly.

**Argument length is not evidence.** In stage 2 of the public-links work I overrode the design's
"answer 500 when a database read fails" with 200, and argued it in a brief and again in the code's
own header. The whole case rested on one sentence — *a 5xx replaces our application with Vercel's
error page* — which is false; the handler writes the shell body whatever status it chose. Sol found
it in one line. Several paragraphs of real reasoning downstream of one assumed fact **feel** checked,
and nobody audits the premise of a well-built argument, including its author. Test the load-bearing
fact first.

**Write down the result you cannot use.** When an experiment refuses to reproduce what you are
demonstrating, "my harness is broken" is usually right — and noting the anomaly anyway costs one
line. On 2026-08-29 a failed reproduction of the shared-index corruption *was the control*: plain
`git add` heals the staleness, so the bug reproduces only with private-index commits. That was the
fact four sessions had spent six hours needing. A result whose value is to somebody else is the one
that gets dropped.

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
wrapper does for you via `--effort`. A misspelt value is **not** an error: `-c
model_reasoning_effort=hgih` parses as a perfectly good TOML string and the run quietly proceeds at
the model's own default effort, so the wrapper validates the value itself before spawning. At `high`/`xhigh` a substantial task can run 20–40 minutes, so
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
- **`listen EPERM` on a tsx IPC pipe.** Any sandboxed run that shells out to `npx tsx` or an
  `npm run` script built on it fails with `listen EPERM … /tmp/tsx-…/*.pipe` — in every mode we
  actually use, `workspace-write` included, measured 2026-09-02. That's a sandbox artefact, not a
  code failure: the tsx CLI listens on a unix socket and the sandbox denies it **whenever the
  profile denies network**, which is every profile here (2026-09-04 —
  [why](#what-network-would-buy-and-why-the-profile-does-not-grant-it)). Invoke the script as
  `node --import tsx …`, which opens no socket, or re-run the validation in your own shell.
- **Stale-looking answers.** A run occasionally returns something that reads as an answer to a
  *previous* prompt. The wrapper writes a fresh temp `-o` file per run and never resumes a session,
  so it isn't output reuse on this side; the likely causes are upstream. Treat such an answer as
  suspect, re-run with a textually distinct prompt, and never let a single Codex pass carry a
  load-bearing claim ("X is already implemented", "this is safe") without a second check.
- **Cost.** A runaway high-effort run burns quota fast. The wrapper caps any single run at
  `--timeout-minutes`.
- **Running out of credit is the commonest failure, and it wears several disguises.** The two auth
  paths word it differently and both are matched (`Your workspace is out of credits` for a
  subscription, `You have no credits remaining` for API-key billing — the hint knew only the first
  until 2026-08-26, a list written from one example). It usually arrives as exit 1 with the reason
  buried in the activity log, which is why the wrapper lifts that phrase into its own error and
  names the log path; the real reason appears *after* five `ERROR: Reconnecting... n/5` lines, so
  the first thing in the log is not the cause. Both credentials can be dry at once, so
  `--auth subscription-first` tries both, at ~12s on the dead one — confirm a verdict arrived rather
  than assuming the fallback worked. A dead key in `.env.local` cannot be overridden from the shell;
  use `--auth`, not an unset. And the error hint names *which* account, so it takes the credential
  as an argument — it used to hedge, and sent people to top up a full key while the empty one sat
  elsewhere.
- **Raw `codex exec` runs out of credit and exits _zero_, having written no `-o` file at all.**
  The wrapper checks that the answer file exists, is non-empty *and is not just whitespace*
  (`existsSync` alone passed on the zero-byte file a killed run leaves behind; a size check alone
  passes on a lone newline), and reports exit-0-with-no-answer as a failure rather than an answer.
  The escape hatch has none of that. Observed
  2026-08-26 on 0.149.1: a `--sandbox read-only` review read ~279,000 tokens, compacted its
  context, hit `ERROR: Your workspace is out of credits`, and ended `exit=0` with the answer path
  never created. A caller checking only the status code learns nothing, and a caller that
  `cat`s a missing file into a doc records silence as agreement. **Always test that the answer
  file exists and is non-empty**, not just that the command succeeded.
- **Any *other* exit 1** means reading the log before assuming the wrapper or the prompt is at fault.
- **Codex cites code as absolute `/Users/…/file.ts:148`, usually as a markdown link.** Leave them
  alone, or make them code spans. This bullet used to say to rewrite them repo-relative, and on
  2026-09-02 following it put 48 broken links into two review docs and reddened the deploy gate:
  `src/x.ts:148` is not a file at *any* prefix, because of the `:148`, and a path written from the
  repo root resolves wrongly from `docs/plans/` besides. Its premise was wrong too — a link checker
  that skips absolute targets never flagged the originals, so the advice turned something silent
  into something loud.

  A repo may then exempt the citation shape from its link checker, as this one did the same
  afternoon (`3f23a94`, a trailing `:<line>` is what marks a citation). **That settles the gate, not
  the reader**: a link nobody can follow is still a link nobody can follow, and it will be followed
  by somebody eventually. Prefer the code span; do not go back to relative links because the test
  stopped objecting.
- **A login shell undoes environment sanitising.** Codex's shell tool sources `~/.zprofile` and
  `~/.zshrc`, so anything they export reaches codex whatever the wrapper passes. Measured above.
- **Don't export `OPENAI_API_KEY`.** `codex exec` doesn't read it (it wants `CODEX_API_KEY`), so it
  buys nothing, and an exported secret lands in the environment of every subprocess an agent
  spawns — including its own transcript.

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
