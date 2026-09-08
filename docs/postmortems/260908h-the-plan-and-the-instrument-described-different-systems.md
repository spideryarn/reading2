# The plan and the instrument described different systems

Up: [postmortems.md](../project/postmortems.md). Nothing broke, nobody was paged, and no code was
wrong. That is why it is worth a file: the same hands will do it again somewhere nothing is watching.

**The incident, in one line.** For a whole evening on 2026-09-08 I argued about a box running four to
eight agents while writing plans for a box running twenty to thirty-five — and neither the arguing
nor the planning noticed, because the two never had to meet.

## What happened

[260908g](../plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md) is a
plan for an Overseer supervising *"a fleet of 20–35 coding agents"*, with Greg's stated goal of
*"many dozens"*. Every design argument in it — the deferral queue, the staggered broadcast, the
scheduler's cadence, the whole case for rate over ceiling — is an argument about crowding.

Separately, I built a sampler to answer a narrower question for the fleet dashboard's owner: how many
sessions can a `resource-broadcast` actually reach? It ran from 20:56, produced 147 samples, and saw
between **four and eight** agents. I reported means and tails off it, corrected my own claims twice
against it, and sent it to a peer who **cancelled a stage** on the strength of it and then held it
again.

At no point did anyone ask whether eight agents was the system the plan was about.

The answer, reconstructed afterwards from `~/.overseer/events.jsonl` — 599 events, none unreadable,
spanning 08:32 to 21:11 — is that the box peaked at **33 live tmux sessions at 12:35, of which 15
were shells: eighteen agents.** Not a spike; it sat above twenty sessions for much of the day. The
sampler's whole run was the quietest 73 minutes of the day, hours after the peak, and every number
drawn from it was conditioned on a regime nobody had checked was representative.

## The real root cause

Not "I sampled at the wrong time". Sampling at the wrong time is what happens when nothing tells you
what the right time is.

The cause is that **the plan's premise and the instrument's population were never required to
agree.** The plan says 20–35 in prose. The sampler reports `agents=7` in a log line. Both are
correct, both are readable, and nothing anywhere computes the difference or complains about it. The
premise lives in a document that no code reads, and the measurement lives in a file that no document
reads, so the contradiction had no surface to appear on.

Worse, the instrument was **built after the interesting regime had passed**. The sampler could not
have measured the peak, because it did not exist at 12:35. So the one reading that would have shown
the mismatch was structurally unavailable to the thing whose job was to find it.

## The class: a plan and an instrument that describe different systems

Name it in a sentence: **the document states the regime, the measurement samples a different one, and
nothing forces them to meet.**

It is not a sampling error, which is a claim about variance within one population. Here there are two
populations and the mismatch is categorical. It is adjacent to
[a check that answers a weaker question](260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md)
but distinct: that is one artefact answering the wrong question, this is two artefacts each answering
their own question correctly while disagreeing about the subject.

Its signature is comfort. Every individual number was defensible, every caveat was written down, and
the reasoning above each was careful — which is exactly why nine hours passed. **A wrong number gets
challenged; a right number about the wrong system does not.**

## Which commit introduced it

None, and that is part of the finding. `git log -S "20–35"` finds the premise entering
`docs/project/overseer-direction.md` and `docs/project/overseer.md` as prose, and the sampler was
never committed at all — it lived in a scratchpad, which is correct for a throwaway instrument and
is also why nothing could ever have joined the two.

The nearest thing to a culprit is that **the premise was never a number in a file anything reads.**

## The fix that is right for the long term

The shipped fix was to measure the peak once, by hand, and write it into the plan. That is the patch,
not the design.

The long-term fix is that **the premise should be a measurement with a date on it, not an
adjective.** `docs/project/overseer-direction.md` should carry *"peak concurrent agents observed: 18,
2026-09-08"* rather than *"20–35"*, and the Overseer — which already reads the register every
fifteen seconds and already has a store — is the obvious thing to maintain it. It is one number, it
is already in the data, and it would have made this postmortem impossible to need.

## What would have caught it, ranked by ease against value

1. **Ask "is this sample representative?" before reporting a mean.** Costs one sentence and would
   have caught it at 20:56, before any of it reached a peer. It is a habit, not a mechanism, and it
   is the one I actually failed. **Being adopted.**
2. **A peak-agents figure in the direction doc, dated.** One line, derivable from a log that already
   exists, and it turns the premise from an adjective into something a reader can contradict. Cheap
   and worth doing — it is written up as a candidate for Stage 3c, which is already touching this
   area.
3. **Have the Overseer record daily peak concurrency into the store.** The right long-term home, and
   it makes the premise self-maintaining. Not free, and it should wait until something needs it more
   than this postmortem does.
4. Instrument the box continuously and retain history so any future question can be asked backwards —
   **rejected.** The health history already does a version of this and did not help, because it
   records *pressure* rather than *population*. Adding a second general-purpose recorder is a large
   answer to a problem that one number solves.

## The second instance, in this file's own instrument, four hours later

Written the same night, because it is the strongest evidence the class is real and the weakest
possible excuse.

The sampler above reads `~/.overseer/last-snapshot.json`, which the **Overseer daemon** writes. At
22:36:52Z the daemon was stopped for a planned restart, the relaunch was blocked, and the file simply
stopped changing. The sampler went on reading it every thirty seconds and **emitting readings**.

Ten rows, 23:36:10 to 23:40:40, every one identical:

```
agents=5 agent_reachable=1 agent_working=4 … ratio1=0.1875
```

**One instant, reported ten times as a time series** — and it would have run all night. Nothing about
those rows looks wrong. They parse, they are well formed, the counts are consistent, and
`reachable=1 of 5` is precisely the tail case the series was being used to argue about. **The
fabricated data supported my own position.** The summariser I had already written takes min, max and
mean, and would have absorbed them without a murmur.

The cause is one missing line: the sampler checked whether the file **parsed** and never whether it
was **fresh**. A stale file parses perfectly. That is the same sentence as
[silent-success.md](../reusable/silent-success.md)'s whole argument, and the same sentence as the
`resets_at` rule in `overseer-direction.md`, and the same sentence as `Pause.overdue`'s *"nothing has
run since"* clause — all of which I had read, quoted and written about **that evening**, in this file
and in the plan.

Fixed: freshness is checked before parsing, and a stale snapshot is now its own row —
`STALE | snapshot last written 302s ago — the daemon is not writing` — never a count.

**What this instance adds to the class.** The first instance was a *sampling window* that did not
match the plan's regime. This one is a *sample* that did not correspond to any moment at all. Both
have the same shape — an instrument confidently describing a system it was not looking at — and the
second happened to somebody who had just finished writing the first one down. **Knowing the class
does not confer immunity to it**, which is an argument for the mechanical countermeasures below over
the habitual one, and a correction to my own ranking: item 1 is the cheapest, and it is also the one
that demonstrably failed twice in one night.

## The third instance, and it makes the first two look mild

Found by a third session, `overseer-tab-messaging`, and confirmed by me against the source and by the
dashboard's owner against the live server.

**The broadcast reaches nobody, and never has.** `boxActionBody`
(`tools/fleet/web/src/actions-client.ts:791`) is the only body builder for box actions and returns
`{actionId, mode, confirm, speaker}` — **no `recipients`**. `broadcastRoute` refuses on
`recipients.length === 0` before it selects anyone:

```
POST /api/actions/box {"actionId":"resource-broadcast","mode":"dry-run",…}
-> {"ok":false,"code":"bad-request","why":"a broadcast needs recipients: send the rows the page is showing…"}
```

So every press of the button is refused **two steps upstream of `drainGate`** — the filter whose
selectivity two sessions spent an evening measuring, arguing about, correcting each other on, and
building a 24-hour instrument for. Nine hours on one side and about five on the other, on **the
selectivity of dead code**.

This is the same class in its purest form. The plan described a *filter*; the instrument measured
*reachability*; the actual behaviour was a *refusal* neither party had looked at. Every number was
real, every caveat was written down, three separate corrections went the honest way, and none of it
bore on the question. **The rigour was entirely downstream of the mistake.**

### What actually found it, and why neither of us could have

Not a better measurement, and not more care. The finder **read the request builder against the route
it posts to** — and that is the one comparison neither of us made, because we both started at the
mechanism we were interested in and reasoned *outwards*. Nobody started at the caller and went *in*.

That is a cheap, general countermeasure and it outranks everything already in my list below:

> **Before measuring anything about a mechanism, trace one real call end to end — from the caller's
> request body to the server's first refusal.** It takes minutes, it needs no instrument, and it
> would have ended all three instances on the first evening.

It generalises past this incident: an instrument attached partway down a chain cannot see that the
chain is severed above it. The measurement will be internally consistent, responsive to real
conditions, and about nothing — **it moves when the box gets busy, which is exactly what makes it
convincing.**

**And the countermeasure has its own failure mode, which the dashboard's owner named** and which
would otherwise have made it useless here:

> The trace has to end at the **first refusal**, not at the first thing that *looks like* the
> mechanism. Had I traced the broadcast and stopped at `drainGate` — the code I was arguing about,
> and the first thing in that path that looks like the answer — I would have confirmed my own model
> and learned nothing.

So *"end to end"* is load-bearing and a reader will be tempted to shorten it to *"trace the call"*.
The stopping rule is the whole difficulty, because the natural place to stop is the thing you already
believe in — which is the original error wearing the countermeasure's clothes. Their verification was
**one `curl` and under a minute**: the difference between the two of us and the session that found it
was not rigour or effort, it was **direction of travel**.

### What survives

The reachability series is still a real quantity: it governs the **drain**, which does run, and it
carries the only measurement anyone has of **peak agent concurrency** (18, 2026-09-08), which is the
premise this whole plan rests on. So the sampler stays running. What it no longer bears on is the
broadcast stage — and the honest statement there is not *"it reaches too few sessions when the box is
busy"* but *"it reaches none, at any load, for a reason unrelated to the rule we were arguing
about."*

## The part that has no countermeasure, and should be said anyway

**There is still no independent source for the peak.** The dashboard's owner reproduced the
reconstruction with a different state machine and got the identical answer — 33 sessions, 15 shells,
18 agents, same timestamp — which confirms the *logic* and not the *data*: we both parsed
`events.jsonl`, and a gap in it is invisible to both methods in exactly the same way.

I looked for a genuinely independent record and there is none. `tmux` keeps no history,
`health.ts`'s attribution counts processes by kind (`vitest`, `vite`, `chrome`, `node`) with no arm
that isolates an agent, and the health history stores pressure rather than population. **Two methods
over one source is weaker than two sources**, and the reason no second source exists is the same
reason the mismatch survived: nobody was measuring the population, because the premise had never been
treated as a claim that could be false.
