# The Overseer, and orchestrating the agent fleet: the history moved out of the reference doc

Moved verbatim from [docs/project/overseer-direction.md](../project/overseer-direction.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

## Status

Status as of 2026-09-08 evening: **both exist; one of them has not yet run where it will live.**
`tools/fleet/` serves a live page on the box and the tailnet, with per-session status and the pending
question for blocked sessions. `tools/overseer/` is built — the store, the clock, the differ, the
daemon and the work classifier.

**Half of that sentence retired itself at 16:04 the same evening, and the half that did not is the
interesting one.** The retiring condition set here was *"events are accumulating in
`~/.overseer/events.jsonl` under a unit that is `enabled`"*, and it was two conditions wearing one
sentence. The first is now met: `~/.overseer/` holds 161 KB of `events.jsonl` and a `current.json`
written minutes ago, against the real store root rather than a scratch one. The second is not:
`systemctl is-active overseer.service fleet-dashboard.service` prints `inactive` twice, because both
are running under `tmux`. **So nothing survives a reboot yet**, and what retires the rest of this
paragraph is a unit that is `enabled` — not a process that happens to be up. [260908b](260908b-overseer-store-and-clock.md) is the plan and holds
the evidence.

## What the Overseer is

**Autonomy, widened by Greg the same evening.** This page said until then that the Overseer *"may
dispatch scheduled jobs unattended, and nothing more"* — his choice from four options, the others
being observe-and-notify-only, steering live sessions, and pausing/killing. **That is superseded.**
Handed a proposed list to confirm, he took all of it and added to it:

The widened list, in Greg's words, remains in
[overseer-direction.md § What the Overseer is](../project/overseer-direction.md#what-the-overseer-is).

## Two tenses: the seam between the Overseer and the dashboard

The source contract remains in
[overseer-direction.md § Two tenses](../project/overseer-direction.md#two-tenses-the-seam-between-the-overseer-and-the-dashboard).

**This paragraph used to end *"and falls back to its own `collect()` only when the server is
unreachable"*, and that has not been true since the plan removed it** — corrected 2026-09-08 after
the sentence was quoted in a review and then checked against the code.

### The seam is a file, not a function — `~/.overseer/current.json`

Written 2026-09-08, once the Overseer existed and the sentence *"the Overseer writes a current-state
file, the dashboard reads and renders it"* stopped being a plan and became something that needed a
shape.

The file table remains in
[overseer-direction.md § The seam is a file](../project/overseer-direction.md#the-seam-is-a-file-not-a-function-overseercurrentjson).

**This table said "four files" until 2026-09-08 12:15, and `last-snapshot.json` was the one missing**
— the file that exists precisely so a restart does not re-announce all 21 sessions as new. It is the
daemon's private working state rather than part of the seam, which is why it was easy to leave out
and why it is listed anyway: a reader deciding what `~/.overseer` contains should not have to discover
a fifth file by running `ls`.

**And it said "five files" until 2026-09-08 evening, when `attention.json` turned out to be the sixth**
— found by the Baseline census of plan [260908f](260908f-overseer-and-fleet-improvement-roadmap.md).
Same class as the omission above and the same cure: it is the attention pass's private memory rather
than part of the seam, so nothing outside the daemon reads it, and it is listed for exactly the reason
`last-snapshot.json` is.

## Attention, and who the Overseer is really watching

### `idle` is the bug: the vocabulary describes the pane, not the work

The invisible-question problem remains in
[overseer-direction.md § `idle` is the bug](../project/overseer-direction.md#idle-is-the-bug-the-vocabulary-describes-the-pane-not-the-work).

**And the measurement that turns that last sentence into a number, 2026-09-08.** The fleet dashboard
agent investigated which permission mode sessions actually start in, and the answer was a coin flip:
**28 auto, 7 default across `gjd-remote` launches since 09-06** — two sessions launched 25 seconds
apart from identical generated job scripts came up in opposite modes. A `default`-mode session runs
normally until its first unapprovable call — a `git fetch`, a `git log`, `npm run worktree:setup`, an
MCP read, so within the first minute of almost any brief here — and then waits for somebody who is
asleep. **Longest single stalls: 7.38h, 6.34h, 5.75h, 5.35h, 5.33h, 4.30h — 34.9 agent-hours since
Sunday**, independently reproducing an earlier finding of 41.6 agent-hours since 09-01. The longest
stall in *any* always-auto session over three days is **21 minutes**.

**And the fix landed, measured 2026-09-08 12:20 — 35 `auto`, 1 `default`, against 28/7 before.**

**The measurement is worth more than the flag, because a flag being present is not a fleet being in
auto mode.** Every transcript touched in the previous six hours was read for its **last**
`permissionMode` checkpoint — the current mode, not the launch mode, so a session converted mid-life
is counted where it actually is. **36 of 78 carried one**, which is the positive control: a probe that
found none would be broken rather than reporting a clean fleet
([silent-success.md](../reusable/silent-success.md)). And the single `default` is not a
counter-example — a 17-line *"Reply with the single word: pong"* probe from 05:44 that never went
through the launcher at all. **Nothing launched by `gjd-remote` came up in `default`.**

## The backlog, after the wide review

### Built, tested, and called from nothing but its own tests

The two uncalled mechanisms are described in
[overseer-direction.md § Built, tested](../project/overseer-direction.md#built-tested-and-called-from-nothing-but-its-own-tests).

**One of the two is now closed**: the work classifier gained its caller on 2026-09-10 — see
[§ Where the work reading now lives](../project/overseer-direction.md#where-the-work-reading-now-lives-and-the-four-things-it-may-not-claim).
It sat built-and-uncalled for two days, which is roughly how long the class takes to become invisible.
