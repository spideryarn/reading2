# Partial observations do not prove health or failure duration

Review of `31c8e5e50c467ea2f372a962f48cdec619c87a9e` found watchdog paths that
reported `ok` despite unreadable inputs, and readiness messages that claimed a
failure duration their observations did not establish. Reader impact was not
established. The introducing commit aimed to detect another silently stopped
pacer after production had gone 17 hours undeployed; see the
[plan](../plans/261008e-watchdog-alarms-for-a-stopped-pacer-and-production-lagging-dev.md).

## The class: a partial observation promoted into a complete operational claim

The input types preserved uncertainty, but the combined verdict discarded it.
An unaskable tmux session became absent, a fresh heartbeat concealed an unknown
session, and a small trunk gap concealed unreadable readiness records. A fetch
that succeeded without updating a ref under a narrowed remote fetch mapping
likewise became evidence that the ref was fresh.

The temporal variant promoted “no pass in a 72-hour search window” into
“undeployable for at least 72 hours.” One failure an hour ago produced that
sentence. Time since a recorded pass is also not time since failure: dev can
remain ready until a later change or failed rerun. Applying a commit's final
verdict to its entire history additionally erased earlier ready intervals.

## Why nothing went red

The readiness-unknown test supplied a 20-hour trunk gap, which was already
unhealthy; it never tested a caught-up or young gap. No tests drove the tmux
reader. A temporal test explicitly asserted the unsupported 72-hour claim.
The Git fixture used an ordinary fetch mapping for both branches.

Eight added regression assertions failed before the fixes, including the
scratch repository reporting zero undeployed commits when one was present.
Subprocess stdin is ignored explicitly so these tests can run in the review
sandbox, where Node's unused piped stdin produces `EPERM`.

## The repair and the countermeasures, ranked by ease against value

1. **Exercise an unreadable input while the others are healthy.** Implemented
   for the combined verdicts and at the tmux command boundary. Command errors
   now establish absence only when the response actually proves absence.
2. **Fetch into explicit destinations.** Implemented and tested with a narrowed
   remote mapping. The watchdog leaves `FETCH_HEAD` alone, retries once, and
   reports unknown if refresh fails.
3. **Make time claims carry an observation boundary.** Implemented by replaying
   the shared readiness verdict over chronological prefixes, which keeps sticky
   failures and whole-check semantics. Two claims come out of it. The current
   head's red time is a lower bound from its ongoing observed red interval.
   "Undeployable for about N hours" is measured from when the last ready commit
   *stopped* counting: when it failed a rerun, or when the loop first ran
   another commit (dev had moved), never from when it passed. With no ready
   commit in the window the line says exactly that, not a duration. Only the
   exact runner path counts.

   **One part of the review's fix was itself an over-correction, and was
   undone.** It made a head the loop had not yet reached `unknown`, and the
   check `unknown` with it. That is the ordinary state for the half hour after
   every push, so the watchdog would have failed after every push and the alarm
   would have meant nothing. A head with no verdict yet is now `unsettled`: the
   line says so, and the check stays `ok` within the threshold. Only an input
   that could not be read (the store, the primary checkout) makes it `unknown`.
   The same class runs the other way: an alarm that fires on ordinary states is
   a check reporting something its evidence does not show.
4. **Extend the query window.** Rejected: seven days of sparse observations
   still would not prove seven days of continuous failure.
5. **Add a new readiness database and head-transition history.** Rejected for
   this alarm: a qualified lower bound serves it without inventing a second
   store. Exact red duration across different dev heads would need that history;
   this repair deliberately does not claim it.

The long-term rule is to earn each operational claim from the evidence that
supports it. A type containing `unknown` does not ensure a final verdict respects
it; a search window does not ensure observations cover it.
