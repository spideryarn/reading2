# A timeout that bounded the child and not the wrapper

`npx tsx scripts/run-claude.ts --timeout-minutes 5` returned after **fifteen minutes**, and said
`claude timed out after 5m and was killed` when it did.

Found 2026-09-06 while smoke-testing the new Claude wrapper, in code the Codex wrapper had been
using since 2026-08-24.

## What actually happened

The watchdog worked perfectly. At five minutes it sent SIGTERM to the child's process group, waited
five seconds, and sent SIGKILL. `claude` died on schedule.

What did not happen for another ten minutes was the promise settling, because it settles on
[`'close'`](../../scripts/subagent-cli.ts), and **`'close'` is not "the child exited" — it is "every
holder of the child's stdio pipes has let go"**. `claude` had left a helper running, detached into
its own process group, holding the inherited stdout. The group kill never reached it (that is what
"its own process group" means), so the wrapper sat waiting on a pipe belonging to a process it had
never heard of.

The comment above that line was right about its own subject and silent about this:

```ts
child.on('close', (status, signal) => {   // 'close', not 'exit', so stdio is flushed first
```

Choosing `'close'` over `'exit'` *is* correct — `'exit'` can fire with output still buffered, and a
wrapper that truncated the last few lines of a review would be worse than one that waited. The
defect was that the wait it bought had no bound.

## The class

**A wait that is bounded for the thing you named and unbounded for the thing you meant.** The
timeout was written, tested and documented as "the run cannot take longer than N", and what it
actually guaranteed was "the *child process* cannot run longer than N". Every test asked the second
question:
[`tests/run-codex.test.ts`](../../tests/run-codex.test.ts) spawns a stand-in that ignores SIGTERM
and even one that spawns a grandchild — but the grandchild is in the same process group, so the
group kill collects it and `'close'` fires on time. The one arrangement that breaks it — a
grandchild in a *different* group — is exactly the one no test built, because it is the arrangement
you only think of after you have seen it.

Related, and the reason it stayed invisible: **the error message named the flag rather than the
clock.** `timed out after 5m` is `args.timeoutMinutes` interpolated into a string; it is printed
whether the kill took five minutes or fifty. A message that had said `after 15m2s (limit 5m)` would
have been a bug report on its first occurrence.

## Which commit introduced it

The spawn core landed with `scripts/run-codex.ts` on 2026-08-24 and moved unchanged into
`scripts/subagent-cli.ts` on 2026-09-06. So **every codex review since 24 August has had this hole**,
and a `codex exec` run that leaves an MCP stdio server behind would have hit it. Nobody noticed,
which is its own data point: it needs a *timeout* and a *leaked detached child* in the same run.

## The fix

`'exit'` — which fires when the child itself goes, whatever else holds the pipe — starts a bounded
wait for the flush:

```ts
child.on('exit', (status, signal) => {
  closeGrace = setTimeout(() => { flush(); finish({ status, signal, … }); }, GRACE_MS);
});
```

In the ordinary case `'close'` lands microseconds later and clears it, so nothing changes. In the
leaked-helper case we lose whatever that helper would have written, which was never the child's
output anyway. Five seconds, the same grace the kill sequence already uses.

## What would have caught the class

Ranked by ease and value:

1. **A test with a grandchild in its own process group.** Now
   [`tests/run-claude.test.ts`](../../tests/run-claude.test.ts) § *returns when the timeout says so,
   even with a leaked helper holding the pipe*: `spawn("sleep", ["120"], {detached: true, stdio:
   [..., "inherit", "inherit"]})`. It fails in 121 s against the old code and passes in 12 s against
   the new one — measured both ways before this was written down. One test, and it is the whole
   difference between "the child is bounded" and "the call is bounded".
2. **Make the message quote the clock, not the flag.** Any error that reports a duration should
   report the *measured* one, with the limit alongside it. This is cheap, and it converts a silent
   failure into a loud one everywhere, not just here.
3. **Ask, of every wait: what am I actually waiting on, and who else can hold it?** `'close'`,
   `await`ing a lock, a `join()`, a health check that polls a port — each has a subject that is not
   quite the subject you have in mind. The three-word version is
   [silent-success.md](../reusable/silent-success.md)'s: the check agreed with the code because they
   shared an assumption.

## The same bug three more times, found by the reviewer

The fix above went to GPT Sol with the rest of the work, and it came back with three more instances
of the identical shape — each one a bound that covered the thing it named and not the thing it
meant. That is worth more than the original bug: one instance is a mistake, four is a blind spot.

- **A settled promise is not an exited process.** `finish()` resolved on the forced grace, but the
  read streams belong to *us*, and while a leaked helper holds the other end they are open handles
  keeping node alive. A successful run against a stand-in that left a 20-second helper behind
  printed `Done —` and then sat there for the rest of it. Invisible on the timeout path, because
  `fail()` calls `process.exit`. Fixed by destroying the streams when we force-settle.
- **The capture overflow disarmed the bound.** Hitting the 64 MiB cap called `stopTimers()`, which
  cleared the forced settle along with the kill timers — so an overflow whose pipe was held by a
  helper waited for the helper. Fixed by clearing only the kill timers there, and arming the bound
  instead of cancelling it.
- **Two grace periods in series.** The watchdog waited five seconds before SIGKILL; the forced
  settle then started *another* five from the child's exit, so a timed-out run returned at
  timeout + 10s while every doc said timeout + grace. Measured at 10.1 s for a 100 ms timeout.
  Fixed by making the kill and the settlement share one deadline — now 11.0 s for a 6 s timeout,
  measured against a child that ignores SIGTERM *and* leaks a helper, which is the combination
  where they stacked.

The fourth fix is the one to keep in mind next time: **ask what the bound is a bound on.** The
timeout bounded the child; `'close'` bounded the pipes; `finish()` bounded the promise; the process
was bounded by none of them.

## Loose end

The run that exposed this was itself odd — `claude` entered an
`api_retry … max_retries: 10, error: "unknown"` loop after two successful tool calls and never came
out. That is upstream and unexplained; it is written down here only because it is what held the
child alive long enough for the real defect to show.
