# Review prompt: is the evidence in 260909b sound?

You are GPT Sol, reviewing for a different model family than the one that wrote this. This is a
**research and proposal** stage, not a code change: there is no diff to review except one new
planning document. So the thing worth your effort is not style — it is **whether the factual claims
are true**, because every one of them is a claim that *nobody has built something*, and each false
one would send an agent to build a feature that already exists.

## What to read

- `docs/plans/260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md`
  — the document under review. Its census table is the output.
- `docs/project/overseer-direction.md` — the direction it serves.
- `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` — the existing census it must not
  contradict. Its "Shipped / built-not-wired / proposed" table is the authority on status.
- The code it cites, under `tools/fleet/` and `tools/overseer/`.

You may run a single test file (`npx vitest run tests/<one>.test.ts`) or a tsx script
(`node --import tsx <script>`). You may not run `npm test` or `npm run typecheck`, and you have no
network.

## What I want from you, in priority order

### 1. Attack the "nobody built this" claims

The census asserts, for each row, that something does not exist. Each of these is falsifiable by a
grep you can run. **Please try to falsify them**, and tell me which survive:

- **S2** — "no draft persistence anywhere in `tools/fleet/web/src/`". I searched for `localStorage`,
  `sessionStorage`, `draft`. Is there another mechanism I would have missed — an IndexedDB wrapper,
  a state hook that persists, a form library, anything in `NewSessionPanel.tsx` or `useActions.ts`?
- **S4** — "`Option` in `SessionParts.tsx` renders every dialog choice identically, so *yes, once*
  and *yes, and auto-approve for the session* are the same button". Is there styling or a
  scope-detection path elsewhere that distinguishes them? Check `tools/fleet/pane.ts`'s option
  parsing too — if the *parser* already classifies grant scope, the gap is only in the renderer and
  the item is much cheaper than I have costed it.
- **X1** — "nothing on the page says which revision it is"; I searched the client for `revision`,
  `buildSha`, `__BUILD`. Is a build stamp reaching the page by another route — a vite `define`, an
  env var, a header, something in `server.ts` or `state.ts`?
- **S1** — "`classifyPaneWork` and `probeProcessTable` have zero non-test callers". Confirm or
  refute, including dynamic or string-keyed dispatch.
- **O1 / O2** — the decision log and a proposal-review surface are "not built". `overseer.md:51` and
  `:240-246` say so in prose; is there code that contradicts the prose?

### 2. Attack the measurement, which is the load-bearing claim

The plan claims: `whereLine` (`tools/fleet/web/src/view.ts:259-262`) drops a null worktree; 14 of 18
live rows carried `worktree: null` with `meta.dir` at the shared primary checkout; but the Claude
process's `/proc/<pid>/cwd` says a worktree for 8 of those 14, so the page renders a misleading
answer. The probe is `scratchpad/dash-cwd-probe.sh` (outside the repo; its logic is described in the
plan — one level of `pgrep -P`, first three children, `readlink /proc/<pid>/cwd`).

Questions I actually want answered:

- Is `meta.dir` really the *launch* directory rather than a live one? Find where it is produced
  (`tools/fleet/collect.ts`, `scripts/gjd-remote-tmux.ts`) and say whether it is ever refreshed.
- Is `row.worktree` derived from `meta.dir`, or independently? If it is derived, is `null` the
  correct rendering for a primary-checkout session, and is my complaint really about `whereLine` at
  all or about the collector?
- **Is a child's `cwd` actually the right oracle?** A Claude session's `cwd` after `EnterWorktree`
  is my positive control, but I only looked one level down at three children. Name the way this
  probe is wrong. In particular: is there a case where the agent is legitimately working in the
  primary and a transient child (a `git` in a worktree, an `npm` in a subdir) would make it look
  otherwise? If so, the finding is weaker than stated and I want to know now.
- The plan says the `readlink` should ride on the per-pane `/proc` read that
  `260908f-roadmap-exec-identity` is landing rather than adding a second pass. Is that sound, or
  does it couple two things that should stay apart?

### 3. Check the conclusions, not only the workings

The plan's conclusion is *"these thirteen things are unbuilt and unowned, and the four best are
S2, L1, L2 and X1."* Is that conclusion supported by what is written above it? Say so if the
evidence supports a different shortlist, or if an item I ranked low is obviously the most valuable
thing on the list. **I would rather be told the ranking is wrong now than after something is built.**

### 4. Anything you would refuse to build

If one of these items is a bad idea on technical grounds — it cannot be made reliable, it duplicates
a mechanism, it will rot — say so plainly. Subtraction is a valid review outcome.

## What not to spend effort on

Prose style, the document's structure, and anything owned by another session tonight (the plan lists
twelve owners; those rows are excluded by construction and are not yours to re-rank).

## Format

Findings as P0 / P1 / P2, each with the file and line you checked and what you ran. If a claim
survives your attack, say so explicitly — "checked, stands" is as useful to me as a refutation, and
a review that returns only complaints tells me nothing about the rest.
