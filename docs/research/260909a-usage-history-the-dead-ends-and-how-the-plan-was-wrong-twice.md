# The usage-history dead ends: how one plan was wrong twice before it was built

**Status as of 2026-09-09: complete, and the plan it belongs to is
[260909b](../plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md).** This doc holds the
options weighed and the dead ends; the plan holds what we are actually building. It was split out
because keeping the two together *caused bugs*: GPT Sol's round-2 review found two live
contradictions in the plan (a decision saying a lock was unnecessary while a stage still specified
one; a rulings table saying one thing about multi-account while the appendix said the opposite) and
attributed both to the forensic narrative burying the executable requirements.

That is the lesson worth carrying: **a plan that keeps its own history inline stops being readable
as a specification, and the contradictions hide in the seam.** A plan is a record, but it is a record
*of the decision*, not a diary of reaching it.

## Dead end 1: the dashboard should write the history

**Believed for about two hours. Wrong, and the reason it was believed was worse than the conclusion.**

The plan's original decisive argument was:

> "The module seam is one-way. `tools/overseer/` imports from `tools/fleet/` in eight places;
> nothing under `tools/fleet/` imports `tools/overseer/`. A daemon-side writer wanting
> `projectUsage` — which lives in `tools/fleet/` — is exactly the thing that breaks it."

Both halves are false:

- `tools/fleet/health-history.ts:81-82` imports `../overseer/jsonl.js` and `../overseer/lock.js`, and
  says so in its own header at line 531: *"The lock is `tools/overseer/lock.ts`'s, imported, not a
  copy."*
- `grep -rn 'from "\.\./fleet/' tools/overseer/` returns ~17 hits — mostly `import type` from
  `wire.js`, plus value imports of `pane.js`, `claude-argv.js`, `attempt-clock.js`.

**The actual rule is weight and the store cycle, not direction.** `tools/fleet/attention.ts`'s header
records the real constraint: a fleet module importing `readCheckpoint` would close a cycle *and* drag
the Overseer's usage/memory/diff/lock/log modules into the process you reach for when something else
is broken. `jsonl.ts` and `lock.ts` cross freely because they import only `node:*`.

### How it got in, from both ends

The claim arrived in a message from session `260908f-roadmap-usage`, which had grepped
`tools/overseer/` for imports of `tools/fleet/`, found eight, and **concluded about both
directions** without running the reverse grep. This session then wrote it into a plan as *reason #1*
because it was plausible and matched a rule already half-believed.

So one one-directional check became a two-directional conclusion, twice, from opposite ends of a
single chain. The fix is not "be careful". It is, in that session's own words:

> Name the scope you actually searched inside the sentence that reports the result.

"Nothing in `tools/overseer/` imports X" is a claim a reader can size. "The seam is one-way" is one
they cannot. Both sessions retracted; neither had shipped anything depending on it.

**This belongs in `docs/project/overseer-direction.md`**, and the plan's final stage proposes it as a
before/after for Greg, because that file's wording is a rule.

## Dead end 2: dedupe the history on the checkpoint's `writtenAt`

Caught before a line was written, by the same peer. `TICK_MS = 30_000` and the checkpoint is
rewritten on **every tick**, so `writtenAt` advances every 30 seconds whether or not a usage pass
ran. Deduping on it would have produced ~2,880 lines/day for ~288 real readings, ~90% duplicates —
and would have blurred exactly the collector failures the series exists to show.

The replacement (`collectedAt`, the reading's own clock) was the right answer to the question as
posed. It then became **unnecessary rather than wrong** when the writer moved to the daemon, which
knows when a reading happened instead of having to infer it.

Worth noticing: the better design *removed a correctness question* instead of answering it. The trap
survives in a new place, though — anything hooked to the checkpoint **write** rather than to the
collection **pass** reproduces the same bug, which is why the plan carries a test whose only job is
to fail if that comes back.

## Dead end 3: store the card's projection

"Not the raw checkpoint" was right, on measurement: the live `usage` blob is 61,122 bytes of which
`rateLimits` is 96%, and 140 hits collapse to 9 incident clusters — a 14× reduction. A raw history
would also copy `transcriptPath` (project and worktree names) and API error prose into a long-lived
file nothing prunes, which is a privacy argument rather than a size one.

But **"therefore store the UI's projection" was a leap**, and Sol refused it twice. A UI type is not
a durable format; it is not versioned independently of the component that renders it; and it carries
things the chart does not need (every conversation UUID, re-serialised every five minutes) while
lacking things the chart does (a merge contract across samples). The plan now specifies a
purpose-built record instead.

## Dead end 4: an independent writer lock for the history file

Copied from `~/.fleet-health/` without asking whether it was needed. Sol's G4: two simultaneous
starts can elect **different winners** — process A wins `usage-history/writer.lock`, process B wins
the main Overseer lock, A exits because it cannot be the daemon, and B runs with a permanently
read-only history handle. Nothing is written until another restart.

The Overseer's existing daemon lock already guarantees one writer. The second election bought
nothing and could deadlock the feature silently.

## The rulings, in full

Both reviews are kept as artefacts:
[round 1](../plans/260909b-usage-limits-tab-plan-review-sol-r1.md) (13 findings, six P0, verdict
*reframed*) and [round 2](../plans/260909b-usage-limits-tab-plan-review-sol-r2.md) (13 findings,
five P0, verdict *reframed again*). **Nothing was overruled in either round.**

### Round 1 — what each finding changed

| ID | Ruling |
|---|---|
| F1 | Accepted. Render-time expiry would erase valid history: a 70% reading valid at 10:00 and resetting at 12:00 becomes "expired" when the chart is opened at 18:00. Current state and history need different clocks. **The best finding in either round.** |
| F2 | Accepted in substance. The incident model was genuinely unpinned; pinned against `d2e37fe4` once that landed. |
| F3 | Accepted. The throw arm has no `collectedAt`, so there is no universal source instant. |
| F4 | Accepted and promoted — then **partly reversed in round 2 by G1**, which found I had over-applied it. |
| F5 | Confirmed a retraction already made (dead end 1). |
| F6 | Accepted in substance; its crash path recurred in a new form as G3/G5. |
| F7 | Accepted. The rotation cap was sized on a real 6.8 KB line while copying a 64 KiB legal maximum. |
| F8 | Accepted, and I had the health precedent backwards: it types its *writer* and loosens only on read. |
| F9 | Accepted. Five concurrency invariants named rather than inherited — **two of which G4 then deleted as unnecessary.** |
| F10 | Accepted. Scan-absence and recorder-absence are two layers. |
| F11 | Accepted; **G9 then showed the fix was insufficient.** |
| F12 | Accepted. |
| F13 | Accepted; the stage order was inverted so the tab comes first. |

### Round 2 — what each finding changed

| ID | Sev | Ruling |
|---|---|---|
| G1 | P0 | **Accepted, and it undoes my own favourite idea.** A publication decision is not an unusable observation: the cache reading is independent of the transcript scan, so a fresh 80% is a valid point even when the scan was inconclusive. Record independent observations, not a "discarded" arm. |
| G2 | P0 | Accepted. A stable id is not a merge contract — the same incident is *richer* on later passes. Merge rules specified, and the persisted incident narrowed. |
| G3 | P0 | Accepted. Health's `status()` works because writer and route share a process; ours do not. Taking the weakest honest option: derive "the recorder is overdue" from the records. |
| G4 | P0 | Accepted. The second writer election is removed (dead end 4). |
| G5 | P0 | Accepted. A throwing `onPass` inside `.then()` becomes a false collector failure and can kill the daemon. |
| G6 | P1 | Accepted. A type-only stage cannot round-trip bytes; it becomes a codec stage. `checkpointSchema` dropped as synthetic provenance. |
| G7 | P0 | Accepted. "Tagged and skipped" would let the chart connect across history it could not read. |
| G8 | P1 | Accepted. The cadence field was promised in prose and absent from the record. |
| G9 | P2 | Accepted. Both clocks step together, so `recordedAt` alone detects nothing. |
| G10 | P1 | Accepted. The appendix still contradicted the round-1 ruling. |
| G11 | P1 | Accepted. The route envelope is pinned in the stage that builds it. |
| G12 | P2 | Accepted. "Freeze at write time" is wrong; it is **collection** time — a 40-second scan can cross the reset boundary. |
| G13 | P3 | Accepted — this document exists because of it. |

## What this cost, and whether it was worth it

Two review rounds and roughly three hours of planning, no code. Against that:

- a P0 that would have silently erased most of every chart older than five hours (F1);
- a rotation cap that would have discarded half the day it promised (F7);
- a lock that could have left the recorder permanently read-only after an unlucky restart, with no
  way to find out (G4);
- a callback that could have terminated the Overseer daemon (G5);
- a stage order that put two invisible stages ahead of the only thing Greg asked to see (F13).

None of these would have been found by building the first design and reviewing the code, because each
is a property of the *format* or the *lifecycle* — the things a code review sees only after they are
expensive to change.

The counter-argument, which should be said too: a simpler feature would not have needed this. The
current-reading tab is an afternoon's work and has survived both reviews untouched. Everything above
is the cost of *the last 24 hours*, and it is worth knowing that the history half of this request was
roughly ten times the design work of the half Greg would notice first.

---

Up: [research.md](../project/research.md)
