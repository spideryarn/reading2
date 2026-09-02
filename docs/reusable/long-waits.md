# Waiting a long time

Parent: [README.md](README.md)

You need to pause for hours — a slow external job, a scheduled retry, "check the deploy after
lunch" — and resume where you left off. Several mechanisms look like they do this and they fail in
different ways, so pick deliberately.

**Everything below was measured**, not read off a doc page: Claude Code 2.1.258 on the Hetzner box,
2026-09-02, with `BASH_MAX_TIMEOUT_MS` and `BASH_DEFAULT_TIMEOUT_MS` both unset. Re-measure if you
are on a different version or a machine with those set — the numbers are version-specific and
nothing keeps this page in step with them.

## What each mechanism actually gives you

| Mechanism | Limit | Survives the session ending? |
|---|---|---|
| `Bash`, foreground | **600 s, hard** — the `timeout` parameter maxes at 600000 ms | n/a |
| `Bash`, `run_in_background: true` | no cap found; verified to 22 min | no |
| `Monitor`, default | `timeout_ms` maxes at 3600000 ms — **one hour** | no |
| `Monitor`, `persistent: true` | no timeout; runs to `TaskStop` or session end | no |
| `ScheduleWakeup` (`/loop` dynamic mode) | clamped to **[60, 3600] s** per hop | no |
| `CronCreate`, one-shot | any future wall-clock time; **fires a prompt back into this session** | no — in-memory, and `durable` does nothing |
| `at now + Nh` | unbounded | **yes** |
| `setsid`-detached child | unbounded; reparents to pid 1 | **yes** |

Two things fall out of that table.

**The one-hour cap is real, but it is not on bash.** It belongs to `Monitor.timeout_ms` and to
`ScheduleWakeup`. Background bash has no such cap, and a `sleep`-first command backgrounded
explicitly is not exempt from anything — a bare `sleep 780 && echo` ran to completion.

**Only two of them outlive the session.** Everything Claude Code tracks dies when Claude exits, so
`at` and `setsid` are the only ones you can promise.

## Choosing

**Resume this conversation, with its context, in four hours** — a one-shot `CronCreate` at the target
time. It is the only mechanism that does this; the others wake a *process*, not a thread of thought.
It fires only while the REPL is idle.

**Pair it with a second wake-up.** Add a `persistent` `Monitor` that emits at the same time. The two
must not share a parent process, because the failure that costs the most here is the one where
"still waiting" and "silently died" produce identical output — [silent-success.md](silent-success.md)
is this exact shape, and a wait is unusually good at hiding in it.

**If the session or the machine might not last** — neither of the above helps. Use `at now + 4 hours`
running `claude -p --resume <session-id> "…"`, or a cloud Routine via `/schedule`, which needs no
local machine at all.

**Never a foreground `sleep`.** That one genuinely is capped, at 600 seconds, and it is the likeliest
explanation when somebody reports a long wait "cancelled after about ten minutes".

## A note on the ten-minute story

The claim that background bash is killed at ten minutes circulated here for a couple of days and was
written into an agent's memory as fact. It is wrong. Four variants — a script, a `setsid` detachment,
a compound containing `sleep 1200`, and a bare `sleep`-first command — all ran past twenty minutes on
2026-09-02.

The original report was almost certainly a *foreground* call hitting its 600-second ceiling, which
rounds to "about ten minutes" in the retelling. It survived because confirming a background job
*started* was treated as evidence it could *survive*, and because the belief was written down, which
looks like verification and is not — [written-down-is-not-checked.md](written-down-is-not-checked.md).

The measurements above stop at 22 minutes. They do not show that a background job survives four
hours; they show only that nothing kills it at ten. If you are betting real work on a multi-hour
wait, use `at`, which does not depend on the answer.
