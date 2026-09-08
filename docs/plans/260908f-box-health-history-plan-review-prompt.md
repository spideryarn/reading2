# Review this plan before it is built

You are reviewing a PLAN, not code. Nothing has been written yet. Be adversarial about the design,
and specific about what would go wrong and how.

## The repo and the context you need

`spideryarn2`, on a Hetzner box that runs ~20-40 Claude Code agent sessions in tmux at once. There
is an internal fleet dashboard at `tools/fleet/` — a small `node:http` server plus a React client —
that Greg reads from his phone. It has a "Box health" mode showing load, memory, swap and disk.

This morning that box hit load average 391 on 16 cores with the OOM killer firing, which is why the
health collector exists at all.

The plan under review adds RETENTION and GRAPHS: keep ~24h of health samples and draw them, so Greg
can answer "was there a problem while I was not looking".

## The house rule this work is judged against

Four features in this same tool were built, tested, routed, shipped and DEAD — every part had tests
and none of the joins did. A postmortem written this morning names sixteen instances; ten of them
are "lossy joins", where the producer said the careful thing and the consumer collapsed it. The
canonical example in this codebase: a reading is a discriminated union with an "I could not tell"
arm carrying a `why` string, and a consumer renders it as `0`.

So: **weight findings about joins, and about places a careful distinction gets flattened, above
everything else.**

## Files to read

- `docs/plans/260908f-box-health-history-24h-graphs-and-swap-retention.md` — THE PLAN UNDER REVIEW
- `tools/fleet/health.ts` — the collector. Every reading is a union with an `unknown` arm.
- `tools/fleet/refresh.ts` — one turn of the background loop, and the order within it
- `tools/fleet/server.ts` — the loop, the routes, the module-level `health` variable
- `tools/fleet/state.ts` — the wire shape, and `readAttemptClock` as an example of the house style
- `tools/fleet/web/src/health-view.ts` — `THRESHOLDS` and the tiles
- `tools/fleet/web/src/HealthPanel.tsx` — where the chart will be mounted
- `tools/fleet/web/src/messages-client.ts` — the four-arm client-side reader this plan copies
- `tools/overseer/jsonl.ts` — the append-only discipline the plan reuses
- `tools/overseer/store.ts` — the store the plan copies arguments from and departs from once
- `tools/overseer/daemon.ts` — the other consumer of this data, which declined health history
- `docs/project/orchestrator-direction.md` — the standing direction. Note "Two tenses", which the
  plan deliberately diverges from.
- `docs/reusable/silent-success.md` — the class of bug this whole tool is built against

## Questions I most want answered

1. **The four states table** near the top of the plan is the design. Is it actually four states, or
   have I merged two that matter, or split one that does not? In particular: is inferring "nothing
   was running" from a sample interval sound, given the loop backs off 5x (to 300s) after a failed
   collection — so a legitimately-backed-off loop and a dead server produce similar-looking spacing?
   This feels like the weakest joint in the plan and I would like it attacked.

2. **Storing the `HealthReport` verbatim** vs a narrow projection. I chose verbatim to eliminate a
   write-side mapping. Is that right, or does it create a version problem — a stored report from an
   old build read by a new client — that a narrow, explicitly-versioned sample would not have?

3. **The torn-line divergence.** `tools/overseer/store.ts` refuses to fold across an unparseable
   line and cold-starts instead. I plan to COUNT unparseable lines and carry on, reporting the count
   on the page, on the grounds that a time series has no fold and a skipped line is honestly a gap.
   A peer session asked me not to. Who is right, and is there a case where my version produces a
   confidently wrong picture?

4. **Rotation.** Two files, rotate at 8 MB, reader reads both. The stated invariant is that the cap
   must exceed 24h of samples so that the instant after a rotation the previous file still covers the
   window. Does that invariant hold under every rate — including the pathological one where the
   dashboard restarts in a crash loop and appends a `collector-failed` sample every second?

5. **The append inside `refreshOnce`.** Ordering, failure containment, and whether a synchronous
   filesystem append in that loop can hurt a box that is already thrashing. Should it be async? Is
   there a case where the append blocks long enough to matter?

6. **Anything in the plan that will produce a confident, plausible, WRONG picture on the page.** That
   is the failure mode that matters here; a crash is cheap by comparison.

7. Anything you would cut. The plan should be smaller if it can be.

## Output

A numbered list of findings, most severe first. For each: what breaks, the concrete scenario, and
what to do instead. Say plainly if a decision is fine. Finish with a verdict: build it as-is, build
it with named changes, or rethink.
