# A doc for adding a mode (tab) to the fleet dashboard

Up: [plans.md](../project/plans.md).

**Status: finished. Both stages done, Sol-reviewed, on `dev`.**

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
- [x] Asked all four sessions by `SendMessage` what tripped them. All four answered —
      `overseer-tab-messaging`, `recent-messages-tab` and `usage-limits-tab` before the first push,
      `deploys-tab` afterwards, having read the landed doc. Their answers are quoted and attributed
      in the doc and are the best content in it.
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
5. *The import allowlist is a design-time question, not a gate you meet at the end* —
   `deploys-tab`, which found `src/changelog.ts` already parsing the file its tab is about and
   could not use it. Verified: `src/changelog.ts` exists and appears **zero** times in
   `tests/fleet-imports.test.ts`'s allowlist. This became the doc's first section on data, ahead of
   the pushed-vs-on-demand choice, because it comes first in time. It also supplied the rule that a
   second reader of a product artefact must be tested against the **real committed file** rather
   than a fixture, since only that can go red on a day nobody touched the branch.

**One question the doc answers that nobody had ruled on**: whether a `MODE_TIPS` string describes
the artefact or the gesture. Answered from the three tips already in the file plus
[tooltips.md](../project/tooltips.md)'s rule, not from Greg — flagged as such in the debrief.

**One error the doc shipped with, and its correction.** The first version said a clean merge is not
evidence but *"the `Record` types are"*. That is false for the case that matters most: `Mode` is
`(typeof MODES)[number]`, so a merge dropping a mode from the array **and** its three maps typechecks
perfectly and the tab is simply gone. Typecheck catches a *half*-added mode, never a fully removed
one. Found by `deploys-tab` and GPT Sol on 2026-09-09, after the doc had landed on `dev`; the fix is
an explicit `expect(MODES).toContain("yours")`, now the first of the four assertions the doc asks
for. The Overseer's quoted ruling carries the same overstatement and is left verbatim with the
correction stated after it — a quote is not ours to silently repair.

**And a second, in the rule the doc borrowed from `deploys-tab`.** "Test against the real committed
file" was quoted from a check that asserted *one version per non-blank line*; Sol showed that passes
while the two readers disagree about every field. The doc now says to compare the readers field by
field — and states the thing that makes that possible, that `fleet-imports.test.ts` walks the graph
rooted at `tools/` rather than `tests/`, so a **test-only** import of the product parser is legal.

Both are the same class: an assertion that looks sufficient, is cheap to write, and cannot go red in
the case it was written for. Which is [silent-success.md](../reusable/silent-success.md), again.

### Stage 2 — Sol review, then land

**Status: done.** Sol reviewed at effort high, EXIT=0, answer fresh. **No P0; seven P1 and four P2,
and it answered "No" to the conclusion check** — a session reading only the doc could not then have
added a working tab. All findings applied.

- [x] Sol review. The review ran against the doc two commits before the one that landed, so each
      finding was checked against the current text rather than applied blind — several were already
      fixed by the peer corrections.
- [x] Applied, plus the five queued peer findings.
- [x] `doc-links` 14/14; merged `origin/dev`; pushed.

**The finding nobody else had, and the reason the conclusion was "No":** a **sixth** registration, in
a **third** file. `.dock-modes { flex: 3 0 auto }` under `@media (pointer: coarse)` hard-codes the
mode count as a share weight, so a fourth mode gets four buttons three shares against Refresh's one.
Verified: it still said `3` after `deploys` landed. No type and no test can see it, and the symptom
is proportion rather than breakage. That is now a row in the registration table and an item in
§ What this costs.

**The structural finding, which made the doc shorter rather than longer.** Sol's P2 on
`documentation-policy.md`: the doc retold implementation instead of signposting it, and *the retelling
is exactly where it drifted*. Both of its factual P1s were in retold detail —

- *"collected every 60 s"* — `FLEET_REFRESH_MS` is the wait **after** each pass finishes, so the real
  gap is longer (the chart code reckons ~73 s);
- *"no read inside the collection loop"* — **false as stated**; the collector already reads every
  pane, health, and the Overseer checkpoint. The true rule is narrower: do not add a new per-session
  transcript or disk fan-out to the refresh path.

**Three more claims that were wrong rather than imprecise:**

- *"A panel taking pushed state never fetches"* — `HealthPanel` takes a pushed prop **and** mounts
  `HealthHistory`, which fetches. The choice is per **datum**, not per panel. Replaced with an
  end-to-end path table, which is also Sol's proposed fix for the checklist being unable to carry an
  on-demand or write-backed mode to completion.
- *"A tab that does anything is two files"* — a new on-demand read needs a route, a `server.ts`
  mount, a client seam, an `App.tsx` injection and the panel; a panel reusing `ActionsUi` needs no
  new client at all.
- *"Switching a tab spends nothing"* — Box health mounts `HealthHistory`, which calls its route
  immediately and then polls. The doc had used this to justify the tooltip register, so the
  justification changed with it.

And one accessibility claim corrected: a screen-reader user gets the button's `aria-label`, not "the
label and the icon" — the icon is `aria-hidden` and the tip is mounted only while open, so **no
persistent copy of the card's text exists** in the accessibility tree.

**The pattern across the whole job.** Every error this doc shipped was reasoned from reading the
source; every correction came from somebody who ran the case — three peers and Sol. Two of them were
the *same sentence* corrected in opposite directions before a measurement settled it narrower than
either. That is [silent-success.md](../reusable/silent-success.md) applied to prose, and it is the
argument for the queue item suggested to the Overseer: sweep the fleet suites for guards that survive
mutation of the thing they guard.
