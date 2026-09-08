# Review request: stage S3, the Overseer's store

A **code** review of one landed stage: the durable store the whole Overseer rests on.

## What to read

Repository `spideryarn2`, this worktree, at revision `001deace`. The stage is two new files:

- `tools/overseer/store.ts` (1081 lines) — the whole stage.
- `tests/overseer-store.test.ts` (728 lines, 35 tests).

Context, in this order:

- `docs/plans/260908b-overseer-store-and-clock.md` — the plan. § "S3 — the store", § "Appending
  safely, which is not the same as appending atomically", § "One daemon, enforced", § "What resume
  actually needs, and what it can never get back", and § "The order, reconsidered", which carries the
  constraint that shaped this stage.
- `docs/project/overseer-direction.md` — § "The store", and § "A higher bar for robustness here
  than elsewhere, and its ceiling". **The ceiling is the more important half** and it is new.
- The types it consumes: `tools/overseer/diff.ts` (`OverseerEvent`, `statusKey`),
  `tools/overseer/observation.ts` (`ObservedRow`).

## What this is for

The Overseer is a daemon that will watch ~36 Claude Code agent sessions in tmux on a Hetzner box and
record what they do over time. **Nothing on this box durably records what is running today** —
session identity lives only in the tmux environment and a reboot erases it. This store is that
record.

The hazard the design is organised around is not crashing but **plausible wrongness**: a history that
reads correctly and is false.

**And the constraint that shaped it, from the box's owner:** the fallback for this whole system is
`ssh` and a terminal, and it is complete. So this is a convenience with a manual fallback, not
infrastructure — which rules out *"state that only this process knows how to reconstruct"*. The store
is therefore **disposable**: missing, empty or truncated, the Overseer starts cold, says so, and
runs. Never refuses to start, never needs a repair step. **Judge the code against that**, including
whether it is disposable in the case that actually happens here, which is a file cut off mid-line by
an OOM kill.

## The design calls, and what I most want judged

1. **Is the torn-write recovery actually correct?** Truncate-to-newline happens once at open, before
   the first append — the claim being that a reader which merely *skips* bad lines leaves the
   corruption for the next reader to rediscover. Is there a sequence — tear, restart, append, append,
   read — that loses a good event or keeps a bad one? Try to find one.
2. **Is the single-writer lock sound?** `acquireLock` closes the common race with a read-back, and
   `ownership()` re-checks the lock file before **every** write, turning "two daemons forever" into
   "the loser stops at its next tick". **Two deliberate calls to judge:** an *unreadable* lock file
   **refuses rather than takes over** ("a lock naming nobody is not proof"); and **pid reuse is
   accepted** — a stale lock whose pid was reused reads as held and the next start refuses, on the
   grounds that a refusal is one `rm` from fixed while a stolen live lock is two writers producing a
   plausible history. Are those the right directions?
3. **`foldEvents` is exported and the register is a fold of the log.** That is what is meant to make
   disposability a property of the code rather than a promise: a rejected checkpoint costs a replay,
   not a fleet. Does it hold? Is there state in the checkpoint that the log cannot reconstruct?
4. **`opening.start` is three arms — `cold | rebuilt | resumed`** — because a daemon that replayed a
   thousand events has a baseline and must not announce itself as cold. Is the distinction drawn in
   the right place?
5. **The caller never supplies the register**: `checkpoint()` takes it from the store's own fold, so a
   caller cannot write a checkpoint that disagrees with the log. Is that enforced by the types or only
   by the shape of the API?
6. **The store validates events read back off disk only shallowly** — kind in a total
   `Record<OverseerEvent["kind"], true>`, plus `at`/`key`/`identity` — because `observation.ts`
   exports no row parser and the store is not a trust boundary: we wrote the bytes. Is that reasoning
   sound, or is a file on disk that anyone with a shell can edit a trust boundary after all?
7. **Is anything here not worth having?** Reducing this stage is a legitimate finding. It is 1081
   lines for a JSONL file and a checkpoint.

## Known and deliberate — do not re-report

- **JSONL, not SQLite.** Greg's "start simple". The named condition that would change it is a read
  that has to scan history to answer a page load.
- **Events, not samples** — 36 sessions sampled every minute is ~52k rows a day of mostly nothing.
- **The register stores `lastStatusKey` + `statusSince`, never the status object**, because
  `waiting.secondsLeft` is the field that made 51 of 53 status comparisons differ meaninglessly.
- **`lastSeenAlive` is a floor, not a reading**, and is documented as such: with events-not-samples an
  idle session emits nothing for hours.
- **Tick count is per-instance and resets on restart**, since a counter that survives cannot tell a
  day of smooth running from two hundred restarts.
- `store.ts` imports `statusKey` from `diff.ts` **at runtime** — the only non-`import type` in this
  directory, breaking that property deliberately, because re-deriving the canonical key here would be
  a second definition of the rule.

## Evidence, so you need not take my word

Red-first: with the three design calls stubbed, **11 tests failed**, each naming its behaviour.
Then 35/35 green. Run outside vitest:

```
open 1: Started COLD (no-checkpoint): no baseline and no history, so the next
        snapshot will look like the whole fleet starting at once.
open 2: An Overseer is already running (pid 1461487 on spideryarn-box, since
        2026-09-08T05:59:37.498Z). Refusing to start a second one.
--- after the tear --- ..."working"}}}\n{\"kind\":\"session-seen\",\"at\":\"2026-09-08T10:01:0"
open 3: Resumed from a checkpoint written 2026-09-08T05:59:37.509Z, 0 events
        replayed past its cursor. A torn final line of 47 bytes was truncated.
events read back: session-seen@10:00:00, session-seen@10:02:00, session-seen@10:03:00
unreadable lines: 0
```

**Mutations: 15 applied, 15 caught**, and each mutation asserts its anchor occurs exactly once so a
no-op says `NO-OP` rather than going green. Two survived the first sweep and both were real gaps:
the checkpoint written straight to its final path — now caught by asserting the **inode changes**,
the observable difference between rename-replace and write-in-place; and a **relative `meta.dir`**
accepted in a checkpoint, which is your own S2-06 arriving on the recovery path it was always about.

## Severity scale — use exactly these

**P0** a wrong result or break nothing would catch · **P1** a real defect or an expensive-to-undo
design choice · **P2** worth fixing, survives without it · **P3** preference.

Give every finding an ID, a severity, a `file:line`, and the concrete sequence of events that
produces a bad outcome.

## Constraints

- **Do not change any file.** Read-only review. You may run
  `npx vitest run tests/overseer-store.test.ts` — it needs nothing outside the tree and writes only
  to temp directories it creates.
- **Do not touch `~/.overseer/`.**
- Other agents are editing this worktree concurrently, adding daemon files under `tools/overseer/`
  and working in `tools/overseer/work.ts`. Ignore them; they are not this review.

## My own suspicions, last

- **`current.json` is ~2 KB per session pretty-printed** — ~70 KB rewritten every tick at 36
  sessions. That is fine today and it is also the number that decides when rotation or SQLite
  matters, alongside `readEvents` reading the whole log. Is there a cliff nearer than I think?
- The disposability claim may be weaker than it sounds: an *unreadable lock file* refuses to start,
  which is the one place the store is **not** disposable. Is that the right exception, and is it the
  only one?
- 1081 lines is a lot. I suspect some of it is defending against inputs the daemon cannot produce.
