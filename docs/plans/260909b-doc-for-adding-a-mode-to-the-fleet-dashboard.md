# A doc for adding a mode (tab) to the fleet dashboard

Up: [plans.md](../project/plans.md).

**Status: stage 1 written, Sol review pending.**

Greg, 2026-09-08:

> add a doc for adding new modes to the web-dashboard

Four sessions were adding tabs to [`tools/fleet/`](../../tools/fleet/)'s dashboard on the night of
2026-09-08 — `usage-limits-tab`, `recent-messages-tab`, `deploys-tab` and `overseer-tab-messaging` —
and each was working the mechanism out from the code. This doc is the thing they should have been
able to read. The deliverable is one project doc,
[fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md), and one signpost line under
[dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md).

## The simpler option passed over

**Adding a "how to add a mode" section to
[overseer-direction.md](../project/overseer-direction.md)** rather than a new file. Refused: that
doc is 1,400 lines about *where the Overseer is going*, and it owns the seam between the actor and
its face. A procedure with a checklist in it would be the only present-tense recipe in a document
that is otherwise entirely future tense, and it is the thing a new session needs first — so it wants
its own line under the entry point, findable by name. The reading view's counterpart,
[new-mode.md](../project/new-mode.md), settled the same question the same way on 2026-09-03.

**Also passed over: fixing the mechanism.** `MODE_ICONS` and `MODE_TIPS` being in `Dock.tsx` while
`MODES` and `MODE_LABELS` are in `mode.ts` means four registrations in two files, one of which
(`Dock.tsx`'s header) advertises itself as needing no edits when a mode arrives. That is a real
cost and the brief says not to pay it tonight — three sessions are live in those two files. It is
written into the doc as a known cost and goes to the Overseer in the debrief.

## Stages

### Stage 1 — read the mechanism, ask the four sessions, write the doc

- [x] Read `mode.ts`, `Dock.tsx`, `App.tsx`, `HealthPanel.tsx`, `routes-health-history.ts`,
      `state.ts`, `types.ts`'s `FleetState`, `fit.ts`, `tests/fleet-web.test.tsx` § the modes /
      the bottom bar, `tests/fleet-imports.test.ts`, `tests/fleet-compile-guards.test.ts`.
- [x] Confirmed the fleet dashboard has no doc of its own: `docs/project/` has
      `overseer-direction.md` (the direction), `overseer.md` (the runbook) and
      `overseer-queue.md`, and `hetzner-remote-server-box.md` for the box it runs on. None of them
      says how to add a tab.
- [x] Asked all four sessions by `SendMessage` what tripped them. Three answered
      (`overseer-tab-messaging`, `recent-messages-tab`, `usage-limits-tab`); `deploys-tab` had been
      running 21 seconds when asked and did not. Their answers are quoted and attributed in the doc
      and are the best content in it.
- [x] Wrote `docs/project/fleet-dashboard-modes.md` with one parent line under
      `dev-and-deployment-overview.md` and a link back up.
- [ ] `npm test tests/doc-links.test.ts`, `npm run typecheck`, GPT Sol review.

**What the three peers said that the brief did not know**, and which shaped the doc:

1. *Four registrations, two files, and the type system catches three of them* — `usage-limits-tab`.
2. *A second tab landing the same night merges cleanly and silently; typecheck on the POST-merge
   tree is the only check* — `usage-limits-tab`, relayed independently by `recent-messages-tab`.
3. *Reading and writing arrive by two different routes, and the write seam is invisible from the
   panel* — `overseer-tab-messaging`. This is the biggest single omission from the brief's own
   checklist, which described the read path only.
4. A measured byte budget for a fan-out tab — `recent-messages-tab`: ~60 ms and ~3 MB of disk read
   per refresh over 21 rows, for 14 kB of text.

**One question the doc answers that nobody had ruled on**: whether a `MODE_TIPS` string describes
the artefact or the gesture. Answered from the three tips already in the file plus
[tooltips.md](../project/tooltips.md)'s rule, not from Greg — flagged as such in the debrief.

### Stage 2 — Sol review, then land

- [ ] `npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high` on the doc plus the diff.
- [ ] Merge `origin/dev`, commit by name, `git push origin HEAD:dev`.
