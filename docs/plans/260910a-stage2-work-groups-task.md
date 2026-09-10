# Stage 2 task: a read side over the Overseer's `checkpoint.work`, grouped for a history

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/resource-history` (a linked git worktree),
branch `worktree-resource-history`. TypeScript + ESM, run with `tsx`, tested with vitest
(`npx vitest run tests/<file>.test.ts`). Internal fleet dashboard for one always-on Linux box that
runs many coding-agent sessions at once. No untrusted users.

**Read first, in this order:**

1. `docs/plans/260910a-resource-history-what-was-running-when-load-rose.md` — the plan. §§ "The
   stored shape", "Where the reading comes from" and "Attribution uncertainty" are this stage's
   spec.
2. `tools/fleet/overseer-status.ts` — especially `readCheckpointFeeds`, `projectOverseerStatus`,
   `resolveWork`, `paneWorkFitsScan`, `parsePaneWork`, `projectRegister`. **The whole design of this
   stage is that `resolveWork` already does the hard part.**
3. `tools/fleet/wire.ts` — `PaneJob`, `PaneWork`, `OverseerWork`, `OverseerRegisterWork`, and the
   end of the file where recent types were appended.
4. `tools/overseer/work.ts` and `tools/overseer/work-reading.ts` — the producer. Read them to
   understand what the readings mean; **do not change them.**

## What to build

### 1. A fourth projection out of the one checkpoint read

`readCheckpointFeeds` currently returns `{ attention, overseer, usage }`, all three out of one
`loadCheckpoint`. Add `work`, a `WorkFeed`.

**It must come from the SAME `resolveWork` call `projectRegister` already uses, not a second one.**
Two calls could disagree only if the input changed, and the input cannot change within one read — but
the reason to share is stronger than efficiency: `resolveWork` refuses a scan that does not belong to
the register's accepted inventory, and a second, independently-parameterised call is exactly how a
future edit makes the history show a scan the register rejected. Restructure
`projectOverseerStatus` so the resolved work is available to the composer, or move the resolve up
into `readCheckpointFeeds`'s `json` case — your call, but say in a comment why the sharing is a
correctness property, in the register of the surrounding file.

`WorkFeed` mirrors the other three feeds' shapes: `checkpoint-absent`, `checkpoint-unreadable`
(carrying `why`), and a published arm carrying the grouped result. Follow whatever the other three do
rather than inventing a fourth vocabulary.

### 2. `tools/fleet/work-groups.ts` — a pure leaf

One exported function and the types it needs. No I/O, no `Date.now()`, no knowledge of the
checkpoint's file format: it takes the already-resolved pane map and returns the stored shape.

```ts
export type StoredWorkGroup = {
  /** The Overseer's session key. Names a SESSION, never a command line. */
  session: string;
  /** The recogniser's id, as a plain string — the Overseer's vocabulary. */
  recogniser: string;
  /** Job processes with that recogniser under that pane, at the scanned instant. */
  jobs: number;
  /** The oldest of those jobs' starts, or null when the kernel could not say. */
  oldestStartedAt: string | null;
  /** How long the longest had run AS AT `scannedAt`, not as at now. Null when unknown. */
  longestRanForMs: number | null;
};

export type StoredWork =
  | { kind: "unavailable"; why: string }
  | {
      kind: "scan";
      /** When the kernel was read. NOT the sample's own clock. */
      scannedAt: string;
      groups: StoredWorkGroup[];
      /** How many groups the cap dropped. Zero is the ordinary case. */
      groupsDropped: number;
      /** The uncertainty, as counts. */
      panes: { work: number; none: number; cannotTell: number };
    };

export const MAX_GROUPS = 30;
```

Rules, each of which should be a comment explaining itself, not just an implementation:

- **One group per `(session key, recogniser)`.** Two `codex exec` processes under one pane are one
  group with `jobs: 2`, never two rows.
- **Ranking, for the cap**: most jobs first, then longest `longestRanForMs` first, then session key
  ascending so the order is deterministic and a test can pin it. `groupsDropped` counts what the cap
  removed — **never truncate silently**; a capped list that does not say so is a truncation that
  reads as an exhaustive list, which this repo has done before.
- **`panes` counts every pane in the map**, by arm: `work`, `none`, `cannotTell`. These three must
  sum to the map's size, and there should be a test asserting that, because it is the sentence the
  page prints as its uncertainty.
- **A `cannot-tell` pane contributes no group and is never rendered as idle.** It is counted and
  nothing else.
- **`unavailable` always carries a `why`** — the resolver's own words, never a manufactured one, and
  never an empty `groups: []`. An empty scan and an unavailable scan are different facts and only one
  of them means "we looked and found nothing running".
- **No clock arithmetic.** `longestRanForMs` is the max of the jobs' own `ranForMs`, which the
  producer froze at the read; do not recompute it from `startedAt` and anything. `wire.ts`'s comment
  on `PaneJob.ranForMs` says why (a stale daemon turns eighteen observed minutes into
  seventy-eight claimed ones).
- **`oldestStartedAt` is the min of the non-null `startedAt`s**, and stays `null` when they are all
  null. A group whose starts are partly known keeps the known minimum and must not imply the unknown
  ones were later.

### 3. Types in `wire.ts`

`StoredWorkGroup`, `StoredWork` and `WorkFeed` cross the server/browser boundary, so they belong in
`wire.ts` per its own header. **Types only, appended at the end** — other sessions are editing that
file right now, so keep the diff to an append. `work-groups.ts` may import the types from `wire.ts`
and export the functions; follow whatever `usage-feed.ts` does with `UsageFeed`, which is the closest
precedent.

## The tests to write, and to see red first

New file `tests/fleet-work-groups.test.ts` for the pure grouping, and additions to
`tests/fleet-overseer-status.test.ts` for the feed — that is the suite that already drives
`readCheckpointFeeds` against a temporary checkpoint, and its fixture style is the one to copy.
(`tests/fleet-usage-card.test.tsx`, `fleet-overseer-panel.test.tsx`, `fleet-web.test.tsx` and
`fleet-work-evidence-e2e.test.tsx` also call it; check whether any of them needs updating, and do not
create a second checkpoint fixture helper.)

**Do not copy a uuid out of an existing test file into a new one.** `tests/fixture-ids.test.ts`
fails if any uuid appears in two test files, and it reds the whole suite rather than one file. Mint
fresh ones.

Write each test, run it, **watch it fail for the right reason**, then implement. A test that was
never red proves nothing — this repo has a doc about it, `docs/reusable/silent-success.md`.

1. **One job with several descendants → exactly one group with `jobs: 1`.** This is the roadmap's
   own named case and it is about not double-counting a wrapper plus its leaf. Build a `PaneWork` of
   kind `work` with one job at depth 8 and an `inspected` count well above it.
2. **Two jobs of the same recogniser under one pane → one group, `jobs: 2`**, with
   `longestRanForMs` the larger and `oldestStartedAt` the earlier.
3. **Two different recognisers under one pane → two groups.**
4. **A `cannot-tell` pane** is counted in `panes.cannotTell`, contributes no group, and does not
   change `panes.work`.
5. **A `none` pane** with a high `inspected` count is counted in `panes.none` and contributes no
   group — the difference between "a bare pane" and "twenty-five processes, none recognised" must
   survive.
6. **The counts sum to the number of panes**, on a mixed map.
7. **The cap**: more than `MAX_GROUPS` groups yields exactly `MAX_GROUPS` and a `groupsDropped` equal
   to the remainder, with the *kept* ones being the top of the documented ranking.
8. **Partly-unknown starts**: a group whose jobs have one known and one null `startedAt` keeps the
   known one and reports `longestRanForMs` from the job that had one.
9. **All-null starts** → `oldestStartedAt: null`, `longestRanForMs: null`. Not zero.
10. **Through the feed**: a checkpoint whose `work` is `probe-failed` gives `unavailable` carrying
    the daemon's own `why`; a checkpoint written before work scans existed (no `work` key at all)
    gives `unavailable` saying so; a checkpoint whose scan belongs to a different inventory gives
    `unavailable` rather than a scan. Drive these through `readCheckpointFeeds` against a temporary
    checkpoint file, the way the existing checkpoint tests do — find them and copy their fixture
    style rather than inventing one.
11. **`work` and `overseer` agree**: on one checkpoint, if the `overseer` feed's register says the
    work is unavailable, the `work` feed is unavailable too, and with the same reason. This is the
    test that would catch a second, independently-parameterised `resolveWork`.

## Constraints

- **Do not change anything under `tools/overseer/`.** The daemon's write path is out of bounds for
  this stage; read it freely.
- **Do not restart or kill anything.** The fleet dashboard on port 8787 and the Overseer daemon are
  live and other people are relying on them.
- **Do not commit**, and do not run `git` commands that change state. I will read your diff and
  commit it.
- **Do not touch** `tools/fleet/routes-actions.ts`, `tools/fleet/routes-new.ts`, `scripts/`, or any
  readiness file. Two other agents are working in `tools/fleet/` concurrently; keep the diff to the
  files named above.
- `npm run check` and `npm test` take about 25 minutes on this box — **do not run them**. Run the
  focused suites only. I run the full gates.
- Match the surrounding house style: heavy explanatory headers that say *why*, discriminated unions
  rather than bags of optionals, an explicit "could not tell" arm rather than a null that could be
  read as a zero, and no silent fallbacks. Read two or three neighbouring modules first and write
  like them.

## When you are done

List every file you changed, say which tests you wrote and the exact command that runs them, and
paste the final run's summary lines. If you concluded that part of this brief is wrong, say so
plainly rather than working around it — the plan is three hours old and the code is not.
