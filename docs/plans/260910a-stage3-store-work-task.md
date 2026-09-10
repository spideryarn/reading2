# Stage 3 task: write the work summary down beside the health sample it belongs to

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/resource-history` (a linked git worktree),
branch `worktree-resource-history`. TypeScript + ESM, run with `tsx`, tested with vitest
(`npx vitest run tests/<file>.test.ts`). Internal fleet dashboard for one always-on Linux box.

**Read first, in this order:**

1. `docs/plans/260910a-resource-history-what-was-running-when-load-rose.md` — the plan.
   §§ "The stored shape", "The cadence, and its arithmetic" and "Where it is written" are the spec,
   including the two paragraphs in bold, which are the two things most likely to be got wrong.
2. `tools/fleet/health-history.ts` — the whole file, and its header twice. **The four states it
   separates are the design, and this stage must not flatten any of them.** Pay particular attention
   to `append`, `MAX_LINE_BYTES`, the `sample-omitted` arm and why it exists, `MAX_FILE_BYTES` and
   the rotation invariant, `parseSampleLine`, and `StoredReport`'s comment about version boundaries.
3. `tools/fleet/health-wiring.ts` — the composition root, and its header about the test that did not
   catch the dead feature.
4. `tools/fleet/work-groups.ts` and the `work` feed on `readCheckpointFeeds` — **Stage 2's output,
   which lands before this stage starts.** Read what it actually produces rather than what the plan
   said it would.
5. `tools/fleet/refresh.ts` — read `refreshOnce` to see when `retainHealth` is called and why it is
   where it is. **Do not modify this file.**

## What to build

### 1. `work` on the sample — `tools/fleet/health-history.ts`

Add an optional `work?: StoredWork` to the **`reading` arm only** of `HealthSample`, and parse it
back in `parseSampleLine`. `StoredWork` is Stage 2's type, from `wire.ts`.

Three separate states must stay separate, and a comment must say so:

| what it is | how it is written | what it means |
|---|---|---|
| not a work turn | no `work` key | the cadence did not call for one; nothing was attempted |
| a work turn that failed | `work: {kind:"unavailable", why}` | we asked and could not be told, and here is why |
| no sample at all | the line is absent | a gap in the record — the store's existing fourth state |

A fourth, `work: {kind:"scan", groups: []}`, is **"we looked and found no recognised work running"**
and is a real answer, distinct from all three above. Make sure the parse round-trips it and does not
normalise an empty `groups` into anything else.

**On the version boundary:** a sample written by yesterday's build has no `work` key at all, and must
parse exactly as it does today. `StoredReport`'s comment is the precedent for how this file treats
bytes that crossed a version boundary — read it before deciding how strictly to validate.

### 2. The size rule — the thing to get right

`append` refuses a line over `MAX_LINE_BYTES` and writes a `sample-omitted` record in its place,
**losing the health reading for that turn**. That is correct when the reading itself is too big. It
would be badly wrong here: a decoration must never cost us the measurement.

So:

- Bound the work summary at the point of building it, not at the point of writing (Stage 2's
  `MAX_GROUPS`).
- In `append`, if a line carrying `work` exceeds `MAX_LINE_BYTES`, **retry once with `work` removed**
  before the existing `sample-omitted` path may run.
- When that happens, **say so on disk** — the sample that is written must carry a stated fact that
  its work summary was dropped and why, not simply be missing one. A dropped summary that looks
  identical to "not a work turn" is a silent loss, and this file's whole history is about not having
  those. Use whatever shape fits the existing vocabulary; `work: {kind:"unavailable", why: "…"}` is
  the obvious candidate and costs nothing.
- Set `failure` on the retention status the way the oversized path already does, so the page can say
  it.

### 3. The cadence — `tools/fleet/health-wiring.ts`

`makeHealthRetention` gains an injected dep for reading work, defaulting to the real checkpoint read,
plus a clock. `retainHealth` decides whether this turn is due.

- `WORK_EVERY_MS = 5 * 60_000`, exported from `health-history.ts` (the browser imports it too, so it
  belongs beside the record it describes, not in the wiring).
- The cadence state lives **in the wiring, not the store** — the store must not grow an opinion about
  how often work is interesting.
- It starts unset, so **the first turn after a restart carries a work summary**. That is deliberate:
  a restart is exactly when somebody wants to know what was running. Write the reason down.
- If the append refused to write at all (locked out, poisoned, or it threw), the cadence state must
  not record a successful write — otherwise a read-only dashboard silently stops trying.
- **`refresh.ts` is not touched.** If you find yourself needing to change it, stop and say why in
  your answer instead.

### 4. The route, only if it needs it

`tools/fleet/routes-health-history.ts` serves the samples. Check whether the browser can already tell
the expected work spacing from what the payload carries; if not, add `WORK_EVERY_MS` to the payload
rather than letting the browser hardcode five minutes. Do not otherwise change the route's shape, and
do not add server-side bucketing or averaging — the route's header explains at length why that is
refused outright.

## The tests to write, and to see red first

Add to `tests/fleet-health-history.test.ts` and `tests/fleet-health-wiring.test.ts`; check
`tests/fleet-health-history-route.test.ts` if you touch the route. Write each test, run it, **watch
it fail for the right reason**, then implement — `docs/reusable/silent-success.md`.

1. **A work turn and a non-work turn.** Two appends inside `WORK_EVERY_MS` of each other: the first
   carries `work`, the second does not. One at `WORK_EVERY_MS` later carries it again.
2. **The first turn after a restart carries one**, with no history of a previous write.
3. **A sample with no `work` key parses**, unchanged, exactly as it does today — the version
   boundary. Write the line by hand rather than through `append`, so the test is about the bytes.
4. **`{kind:"scan", groups: []}` round-trips** and is not turned into `unavailable` or dropped.
5. **`{kind:"unavailable", why}` round-trips** with its `why` intact.
6. **The oversize retry**: an oversized `work` on an otherwise-fine reading writes the reading, with
   a stated dropped-summary fact, and **does not** produce a `sample-omitted`. Assert on the bytes on
   disk, not only on the return value.
7. **A genuinely oversized reading still produces `sample-omitted`** — the existing behaviour must be
   untouched when the reading is the thing that is too big. Add this even if a test already covers
   it, driven through the new code path.
8. **A refused append does not advance the cadence**: with the store locked out, two consecutive
   turns both attempt a work summary rather than the second skipping.
9. **Expired history**: a work summary whose sample has rotated out of the window is simply not
   returned by `read` — assert this rather than assuming it, because it is the roadmap's own named
   case and the whole point is that a 20-minute history must not imply 24 hours.
10. **The wiring is the one the server uses.** `tests/fleet-health-wiring.test.ts` exists because a
    test that built its own store would have stayed green with the route unmounted. Whatever you add
    must drive `makeHealthRetention`, not a hand-built store.

## Constraints

- **Do not change anything under `tools/overseer/`**, and do not change what the daemon writes.
- **Do not restart or kill anything.** The dashboard on port 8787 and the Overseer daemon are live.
- **Do not commit**, and do not run `git` commands that change state.
- **Do not touch** `tools/fleet/refresh.ts`, `routes-actions.ts`, `routes-new.ts`, `scripts/`, or any
  readiness file. Other agents are working in `tools/fleet/` concurrently.
- `npm run check` and `npm test` take about 25 minutes on this box — **do not run them.** Run the
  focused suites only.
- Match the house style: explanatory headers that say *why*, discriminated unions over bags of
  optionals, an explicit "could not tell" arm rather than a null that reads as a zero, and no silent
  fallbacks or defaults.

## When you are done

List every file you changed, the tests you wrote and the exact command that runs them, and the final
run's summary lines. Say explicitly whether the oversize retry is covered by a test you watched fail
first. If part of this brief turns out to be wrong against the code, say so plainly rather than
working around it.
