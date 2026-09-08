# Review request: the fixes to S2's P0 and five P1s

**This is a narrowly scoped check of specific fixes, not a new review.** You reviewed this stage
already and found one P0, five P1s and two P2s
([260908b-s2-code-review-sol.md](260908b-s2-code-review-sol.md)). All eight were addressed. Your job
is to judge **whether each fix actually closes the finding it was written for**, and whether any of
them introduced something worse.

**Discovery is closed.** Do not open new lines of enquiry into parts of this stage that your earlier
review passed. If you see something genuinely serious outside the fixes, say so in one line at the
end under "outside scope" — but the body of this review is the eight fixes.

## What to read

Repository `spideryarn2`, this worktree, at revision `001deace`. The fixes are the diff from
`17dc0bca` to `001deace` in these files only:

- `tools/overseer/observation.ts`, `tools/overseer/admissible.ts`, `tools/overseer/diff.ts`
- `tests/overseer-observation.test.ts`, `tests/overseer-diff.test.ts`, `tests/overseer-fixtures.ts`
- `tests/fixtures/overseer-snapshots/README.md` and the two new `waiting-*.json` fixtures

Context: `docs/plans/260908b-overseer-store-and-clock.md` § "S2's review" and § "The order,
reconsidered". Your original review is the specification.

## What was done, per finding

- **S2-01 (P0)** — `diff()` now returns
  `DiffOutcome = {kind:"diffed"; events; baseline: AdmissibleSnapshot} | {kind:"held"; why: HoldReason; reason: string}`.
  The next snapshot is reachable as `baseline` **only** on the `diffed` arm, so a caller cannot
  advance the baseline past a held snapshot without a cast. Held when `tmuxServerPid === null && rows.length > 0`;
  an empty fleet with a null generation is still diffed and still advances.
  **Only `next` is guarded, deliberately** — the claim is that a bad `previous` is unreachable once
  baselines come only from `diffed`, and that guarding it would have no escape, because a baseline
  restored from an older store could stall the history permanently. **Test that claim.**
  Observability lives on the `held` arm rather than in a new event, on the grounds that every
  `OverseerEvent` arm is about one session and a session-less arm would make the union incoherent.
- **S2-02** — one `safeInteger` helper. Both pids positive safe integers or null; `refreshMs`
  positive; `tookMs` and `waiting.secondsLeft` non-negative. Domains read off the producer.
- **S2-03** — implied deadline with a **10-second** tolerance, not key material. The number is
  empirical and the reasoning changed twice; see § below.
- **S2-04** — a local `ObservedUnknownStatus` discriminated union. The token is **required** on
  `unrecognised-agent-status` and **refused** on every other cause. The required direction is a
  deliberate strictness bet: a future producer setting that cause without a token fails the whole
  snapshot loudly.
- **S2-05** — equal clocks now compare `rows`, `tmuxServerPid` and `tookMs`, and `reject` naming the
  disagreement. **`health` and `refreshMs` are deliberately excluded** because health is re-probed on
  its own schedule and is carried verbatim precisely because it is not interpreted here. **Judge that
  exclusion** — the counter-argument is that it is the same silence from the other side.
- **S2-06** — `meta.dir` absolute and ≤ 4096; `meta.repo` must satisfy the producer's grammar.
  `isRepoValue` is **repeated rather than imported**, because every import in this directory is
  `import type`. That drift risk is flagged in a comment; say whether the trade is right.
- **S2-07** — `ClaimedConversationId` deleted. `AdmissibleSnapshot` is
  `FreshSnapshot & {readonly [ADMISSIBLE]: "admissible"}` where `ADMISSIBLE` is an unexported
  `declare const … unique symbol`, so the shape cannot be written outside `admissible.ts`. One cast,
  in `bless()`.
- **S2-08** — stated on `diff()` and in the fixtures README.

## The S2-03 tolerance, because the reasoning is the interesting part

The orchestrating agent first told the implementer the tolerance must **exceed collection jitter**
(~70s). That was wrong: jitter **cancels**, because the producer derives `secondsLeft` from a real
deadline, so `collectedAt` and `secondsLeft` move together. Measured over six consecutive live
collections, the implied deadline held to **72 milliseconds**, including across a **130-second gap
where a collection was missed entirely**.

The implementer then identified the term that *can* move the deadline, which neither of us had named:
the difference in **collection duration** between two snapshots, since the countdown is read early in
a run and `collectedAt` is stamped at its end — 95 ms in the new capture, ~2.1 s in the older one,
~5 s worst case from the README's 5.7–11.0 s range. Hence 10 s.

**Is 10 s right, and is the failure mode of getting it wrong understood in both directions?** A
mutation raising it back to 120 s left the entire suite green until a test was added that moves the
deadline by 14.9 s.

## Severity scale — use exactly these

**P0** a wrong result or break nothing would catch · **P1** a real defect or an expensive-to-undo
design choice · **P2** worth fixing, survives without it · **P3** preference.

Give every finding an ID, a severity, a `file:line`, and the concrete sequence that produces a bad
outcome. For each of the eight, state plainly: **closed**, **partly closed**, or **not closed**.

## Constraints

- **Do not change any file.** Read-only. You may run
  `npx vitest run tests/overseer-observation.test.ts tests/overseer-diff.test.ts` — it needs nothing
  outside the tree.
- Three other agents are editing this worktree concurrently, in `tools/overseer/work.ts`,
  `tools/overseer/store.ts`'s callers and new daemon files. Ignore them; they are not this review.

## My own suspicions, last

- The `held` arm may have moved the problem rather than solved it: nothing yet *consumes* `held`, so
  a daemon that ignores the arm gets the old behaviour with extra ceremony. Does the type actually
  prevent that, or only discourage it?
- Guarding only `next` and not `previous` is an argument about reachability, and reachability
  arguments rot. Is there a sequence that reaches `diff()` with a `previous` whose generation is null?
- Requiring `reportedStatus` on `unrecognised-agent-status` makes the parser stricter than the
  producer's own guarantee. If the producer ever emits that cause without a token, the Overseer stops
  recording the whole fleet. Is that the right direction for a tool whose bar is "correct and
  unavailable beats plausible and up", or is it that principle applied one step too far?
