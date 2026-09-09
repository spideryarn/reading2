# The Overseer's queue

Up: [overseer.md](overseer.md), whose gate 3 ends *"nothing dispatched that Greg did not queue"*. This
file is the queue's slow lane: work Greg has approved in principle but deferred, kept here so a lull
has something to fill it with and so a good idea does not have to be re-found. Being on this list is
the authorisation gate 3 asks for; being *near the top* is not an instruction to start — the Overseer
still checks the box, the usage window and what is already running before it dispatches anything, and
still asks Greg about anything that outlives the branch.

> Let's defer the Spideryarn product improvements for now. Write an overseer-queue.md (or similar)
> as a kind of todo list for future work (when there's a lull) … Focus for now on improvements to the
> Overseer and overseer-web-dashboard.
>
> — Greg, 2026-09-08

> **This table is still the queue, and a machine-readable one is being built beside it.**
> [260909b](../plans/260909b-queued-ideas-mode-the-overseer-queue-as-ndjson.md) turns it into an
> append-only NDJSON file with a CLI (`npx tsx scripts/overseer-queue.ts --help`) and, later, a
> dashboard mode — because Greg asked to reorder, edit and see the wait from his phone. **Nothing has
> been cut over: this file is what gate 3 reads until `overseer.md` says otherwise**, and that switch
> is one approved change rather than a migration, so that there is never a moment with two sources of
> authorisation. What the new file adds is a test to replace *"is it in the queue?"*, which stops
> being enough once the Overseer can write the queue: an item goes out only if the file read cleanly,
> **Greg** authorised it, he authorised **the revision it now says**, it is still queued, and it is
> not waiting on him.

**How to use it.** Take an item only when the current focus has nothing dispatchable — every live
stage is either running or blocked on Greg — and the box and usage window have room. Move the item to
[the decision log](../plans/260908i-overseer-decision-log-for-the-two-astra-plans.md) when it is
dispatched, with the session name. Items are grouped by the plan that holds their detail; this file
holds the one-line reason and the product question each one is waiting on, not the stages.

## Deferred on 2026-09-08: the Spideryarn product plan

All sixteen clusters of
[260908f-prioritised-spideryarn-codebase-improvements.md](../plans/260908f-prioritised-spideryarn-codebase-improvements.md),
deferred whole by Greg so the fleet can focus on the Overseer and dashboard. The plan's own order
and its first-batch recommendation (A, the first B stage, C, D, P) still stand when this is picked up.
Four clusters wait on a product answer as well as a lull; the Overseer put the defaults to Greg on
2026-09-08 and he chose to defer rather than decide, so **ask again before dispatching those four**.

| Cluster | One line | Waiting on |
|---|---|---|
| A — opening reads overwriting later actions | gate Run/Find/Save until the opening read settles, or reconcile | Greg: submit gate vs reconciliation |
| B — contain failures in independently mounted modes | wrap Debate first, then an honest inventory of the rest | a lull |
| C — carry a glossary question into chat | "Ask in chat" opens an editable question about the term | Greg: fresh conversation vs existing draft |
| D — Knip without a fresh build | stop `vite.api.config.ts` evaluating the client shell at load | a lull; no product question |
| E — stream the glossary's two lookups | stream the unsaved answer first, then the saved one | a lull |
| F — figures at a readable resolution | trial a ~1,280px `srcset` candidate under the existing caps | Greg: trial it, or defer F |
| G — finish the route-table migration | Comments slice next, with its stream-lifetime oracle first | a lull; coordinate with the slice's owner |
| H — one binary-response writer | six header set-sites, six deliberate differences to keep | a relevant route slice |
| I — retire the obsolete revision alias | 13 test imports to repoint, then delete | a lull; XS |
| J — one retry predicate for Search and criteria | share the decision, not the row | the next retry-rule edit |
| K — one missing-key check for seven readers | leave the five distinct contracts alone | the next gateway edit |
| L — unknown-throw mapper investigation | XS, may end with no change | a lull |
| M — keyboard access to a passage's terms | try jumping to the glossary row before building a list | Greg: which interaction, or defer M |
| N — retain PDF item boundaries through scoring | fidelity experiment before any heuristic change | a lull; L-sized |
| O — operate abandoned-draft retention | per-article sweep on step start; no remote run without asking | a lull; the remote run is Greg's |
| P — reader study protocol | doc only; Greg runs the study | a lull |

## Improvements the Overseer noticed but may not originate

Gate 3 says a job of the Overseer's own devising is a proposal, not a dispatch. These are proposals.
Greg promotes one by saying so, and then it moves up into a plan.

- **A real decision log** in the store, written by a CLI, rendered by the dashboard's assumptions
  page — gate 1 is kept by hand until then ([overseer.md § gate 1](overseer.md#1-never-hide-who-decided)).
- **Local-time display in the usage and status commands.** Greg moves between London and Athens, so
  a reset time printed only in UTC is a subtraction he has to do at midnight; print both zones.
- **A sweep of the fleet suites for guards that cannot fail.** On the night of 2026-09-08/09 five
  independent sessions found the same class in `tools/fleet/` tests: an assertion cheap to write that
  cannot go red in the case it was written for — a source grep that passes with the mount commented
  out (`tests/fleet-health-wiring.test.ts`), a `Record<Mode,…>` type that cannot see a whole mode
  removed, a diff-and-grep mutation check blind to a reversion, a `planCompleted` flag that could only
  be true, a page-wide "must not contain" that fails for the wrong reason. Five patches were made; the
  property that produced them was not looked for. [silent-success.md](../reusable/silent-success.md)
  is the doc; the sweep is one session, read-only first, listing every guard with the mutation that
  should red it and whether it does. Proposed by the Overseer from the `dashboard-modes-doc` session's
  count, 2026-09-09.
- **`routes-health-history.ts` reads and gzips synchronously in its handler**, and the dashboard is one
  Node process, so a slow read there stalls every session, action and heartbeat. Found by GPT Sol
  reviewing the Deploys tab, which had copied the shape. Settle whether the exemplar is clean before
  the modes doc holds it up as one. 2026-09-09.
- **Read production's own build stamps from the Deploys tab.** `/build.json` and `/api/health` name the
  sha actually serving, token-free, and `deploy.ts` already cross-checks them; the tab could then say
  which commits on `main` are in the serving build and which are not (a failed build leaves `main`
  advanced with nothing serving). An outbound call from the dashboard, with unavailable/malformed/
  disagreeing arms and a cache that never delays the recorded list — specified in
  [260909b-deploys-tab](../plans/260909b-deploys-tab-most-recent-production-deploys.md) § The honest
  sentence. Needs Greg's yes. 2026-09-09.
- **`tests/fleet-health-wiring.test.ts` mount guard passes with the mount commented out** — the needle
  survives inside the `//`. Assert against comment-stripped lines, as `fleet-deploys-route` now does.
  It stands behind a feature that shipped dead once. 2026-09-09.
- **`.dock-modes { flex: 3 0 auto }` under `@media (pointer: coarse)` hard-codes the mode count** as a
  share weight, wrong since the fourth tab landed; no type or test can see it and the symptom is
  proportion, not breakage. Found by GPT Sol reviewing `fleet-dashboard-modes.md`. 2026-09-09.
