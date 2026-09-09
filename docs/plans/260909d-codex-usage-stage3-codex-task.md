# Implement stage 3: persist the Codex reading into `usage.jsonl`

You built stage 2 (`tools/overseer/codex-usage.ts`) and applied a round of review findings to it. This
is stage 3: getting that reading onto disk, once per pass, beside the Claude one.

Work in this checkout (git worktree, branch `worktree-codex-usage`). The tree is committed and clean, so
`git diff` afterwards is exactly your work. **Do not commit**; I read the diff and commit from outside.

## Read first

1. **`docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md`** —
   **stage 3 is your specification.** It is detailed, and it was written after a review round that
   found the obvious implementation races shutdown. Read stage 3 completely before writing anything.
2. **`tools/fleet/usage-history-record.ts`** — the record and its contract. **Read the whole header.**
   It explains why a number is never stored without the instant that validates it, why validity is
   adjudicated once at collection time and never re-adjudicated, and why a line this build cannot read
   keeps its position rather than being dropped. Those rules apply to the Codex field too.
3. **`docs/project/usage-history.md`** — the feature this extends, especially § "What the chart may not
   claim".
4. **`tools/fleet/usage-history-from-report.ts`** — the mapping seam, and the module your new mapping
   sits beside.
5. **`tools/fleet/usage-history-wiring.ts`** — the join, and its header on why the composition is a
   function rather than a paragraph of `scripts/overseer.ts`.

## What to build

### 1. The record (`tools/fleet/usage-history-record.ts`)

- A `CodexObservation` type and an optional `codex?:` field on `UsageHistoryLine`.
- **Do not bump `SUMMARY_SCHEMA`.** The plan explains at length why: the decoder accepts only exact
  equality, so a bump turns every line already on disk into `unsupported`, which by this module's own
  contract breaks the series positionally. The existing 24 hours of Claude history would go dark to buy
  a field it does not use.
- **Validate `codex` independently in the decoder.** The decoder currently checks the envelope and then
  *casts*; that is fine for what exists but not for a field being added now. A malformed Codex blob must
  degrade to `unknown` **without discarding a valid Claude observation in the same line**. One bad
  field must not cost the other account's reading.
- **`LINE_SCHEMA`'s comment** says it is bumped when the line's shape changes. This changes the shape
  additively and deliberately does not bump, so add one sentence defining a bump as a *breaking* change.
  Leaving it as written would make the next person's correct reading of the comment produce the wrong
  decision.
- **Six absences must stay distinguishable.** They are listed in stage 3 of the plan. `codex` is written
  on **every** pass from here on, so an absent key means "the writer predates the field" and nothing
  else.

### 2. The mapping (`tools/fleet/usage-history-from-report.ts`)

`CodexUsageReading` → `CodexObservation`, in the style of the `cacheObservationOf` / `scanObservationOf`
functions already there. Preserve the two bucket fields you added in the fix round
(`spendControlReached`, `individualLimit`) — a persisted record that drops them recreates the exact
P1 the review found.

### 3. The join (`scripts/overseer.ts`, composition root only)

**This is the part with the trap in it, and stage 3 of the plan spells out the fix.** In short: do not
collect inside `onPass`. `safeOnPass` deliberately does not await what the callback returns, and
shutdown waits on `usageRunning`, so an async collection started there can land on a closed writer.

Instead collect inside `usageOptions.run()`, which the daemon already awaits into `usageRunning`.
The current line is at `scripts/overseer.ts:916`:

```ts
...(usageOff ? {} : { usage: { run: () => collectUsage(), onPass: usageRetention.onPass } }),
```

Use `Promise.allSettled` so a Codex failure cannot turn a good Claude pass into `collector-failed`, and
rethrow a Claude rejection so a genuinely failed pass still reads as failed. Stash the Codex reading for
the synchronous `onPass` to pick up.

**Touch nothing else in `scripts/overseer.ts`.** Not `buildProgram()`, not the `Parsed` union, not
`help()`, not `usageLines()` — that last one is stage 4.

### 4. Tests

- Encode/decode, covering **all six absences** and a malformed-Codex-keeps-Claude case.
- A size check: the record stays well under `MAX_LINE_BYTES`.
- **A test for the no-overlap invariant, and it must mutate the composition root.** The stash is only
  safe because the daemon refuses to overlap passes (`if (usageRunning !== null) return`), so `onPass`
  is always called inside the same `run`'s continuation. An injected fake cannot see whether the real
  things are wired together — `tests/fleet-usage-history-wiring.test.ts` already drives the **real
  daemon** against a scratch store and reads the bytes back off disk, which is the pattern to follow
  and extend.

Red first, as before: make each test fail for the reason it names before you make it pass.

## Constraints

- Files you may change: `tools/fleet/usage-history-record.ts`,
  `tools/fleet/usage-history-from-report.ts`, `tools/fleet/usage-history-wiring.ts` if the mapping needs
  it, `scripts/overseer.ts` (composition root only), and the corresponding tests. Plus
  `tools/overseer/codex-usage.ts` and `tools/fleet/wire.ts` if a type genuinely needs to move.
- **Nothing under `tools/fleet/web/` and nothing in `UsagePanel.tsx`.** That is stage 4.
- **Do not import `scripts/subagent-cli.ts` or anything reaching `src/env.ts` from a file under
  `tools/`.** `tests/fleet-imports.test.ts` computes its closure over every file under `tools/` and
  forbids `src/env.ts` there. This is not hypothetical — it is what reddened the suite in stage 2.
- No new dependency.

## How to run things

- `npx vitest run tests/<one>.test.ts` works, and so does `node --import tsx <script>`.
- **`npm run typecheck` and `npm test` do not** — the sandbox denies the socket they need. I run those.
- **No network.** Do not attempt a live reading.

## What to report

- The shape you settled on for `CodexObservation`, and how the six absences are represented.
- Red-then-green evidence for the no-overlap wiring test in particular — that is the one guarding the
  stash, and it is the one most likely to be written so it cannot fail.
- Anything in stage 3's specification that is wrong, ambiguous or impossible. My briefs have contained
  at least one wrong instruction per round so far, and you have caught them; keep doing that.
- Anything stage 4 will get wrong as the plan writes it. You already flagged that stage 4 must display
  values above 100 unchanged and clamp only the bar width — tell me anything else of that kind.
- Anything you could not check.
