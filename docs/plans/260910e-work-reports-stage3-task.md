# Stage 3 tasks — the dashboard's claims and the doc (3a), then decision reports (3b) (plan 260910e)

Stage 3 is split in two so it can run beside the second Stage 1 review: **3a touches no Stage 1 file**
and runs now; **3b edits `tools/overseer/reports.ts` and `scripts/overseer.ts`**, so it waits until that
review's fixes are committed.

You are implementing one of them in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/work-reports`.
Work only there. Read the plan `docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md`
in full (the design section is the reviewed spec; the Stage 1 and Stage 2 status paragraphs say what the
builders decided), then `AGENTS.md` § Writing code. Read the landed code rather than re-deriving it:
`tools/overseer/reports.ts` (types, `readReports`, `foldReports`, `readInbox`, the drain's four steps),
`tools/fleet/artefact-ref.ts`, the schema-2 `tools/overseer/decisions.ts`, `tools/fleet/decisions-view.ts`,
`tools/fleet/routes-decisions.ts`, `tools/fleet/web/src/decisions-client.ts`, `tools/fleet/web/src/DecisionsPanel.tsx`.

---

## Stage 3a — the dashboard's claims, and the doc

**A GPT Sol review of Stage 1 is running in this worktree at the same time and may edit**
`tools/overseer/reports.ts`, `report-artefacts.ts`, `report-identity.ts`, `daemon.ts`, `notes.ts`,
`scripts/overseer.ts`, `tools/fleet/artefact-ref.ts` and the Stage 1 tests. Do not edit any of them; read
them freely (their exported types may gain a field — re-read before you rely on one).

1. **`tools/fleet/reports-view.ts`** — pure, no I/O: `projectReports(read, inbox, checkpoint, now)` →
   - `sessions`: every session in the checkpoint's register (the full raw register, as
     `decisions-view.ts` uses it — not the dashboard's capped list), each with its latest claim or
     `unreported`; plus sessions that reported but are not in the register, marked so;
   - `recent`: claims newest-first, capped at 200, with how many were withheld;
   - `inFlight` and `refused` counts from the inbox listing; `problems` from the fold;
   - the checkpoint's own availability arm, so "every session is unreported" and "the register could
     not be read" can never look alike.
   Every row is typed as a claim (`claimedBy`), carries the execution comparison, artefacts with checks,
   `correctedBy`, and nothing that says done, ready, landed, or contradicts. A later claim is only a
   later claim.
2. **`tools/fleet/routes-reports.ts`** — `GET /api/reports` (HEAD too), read-only: 405 for anything else,
   with a sentence in the style of `routes-decisions.ts`. Arms `never-written | reports | unreadable |
   oversized-file`, payload `schema: 1`, an 8 MiB input ceiling checked with `statSync` before reading,
   a 2 MiB response ceiling with withheld rows counted. `makeReportsRoute(readers)` with injectable
   readers (`reportFileSize`, `readReports`, `readInbox`, `loadCheckpoint`, `now`); the report root is the
   store root (`storeRoot()`).
3. **`tools/fleet/server.ts`** — one import and one `handle` line beside `decisionsApiRoute`. Re-read the
   file immediately before editing; `action-receipts` edits routes near it. Two lines, nothing else.
4. **`tools/fleet/wire.ts`** — one block **appended at the end**: `ReportsFeed` and its row types.
5. **`tools/fleet/web/src/reports-client.ts`** — like `decisions-client.ts`: strict parser, timeout,
   `no-answer` arm, an injectable request leaf.
6. **`tools/fleet/web/src/DecisionsPanel.tsx`** — a **Claims** section below the decisions, fed by its own
   `reportsApi` prop (default `httpReportsApi`), mounted without touching `App.tsx`. First the sessions:
   latest claim, or **"unreported — nothing said"** (styled neutrally: it is not idle, stuck or failed).
   Then recent claims: "claimed by <actor>", the kind, the summary as text, the execution comparison in
   words ("same run as the register's", "a different run from the register's", "could not verify: …"),
   artefacts via `artefactHref` / `describeArtefactCheck`, revision lists with **"not stated"** when
   empty, and "corrected by …". The existing search box filters claims too. Never a pill that reads like
   a state for a claim's kind.
7. **`docs/project/work-reports.md`** — for agents and for Greg: what a report is (a claim, never a
   state or a permission), the four kinds and when to use each, the exact commands (copy them from
   `scripts/overseer.ts --help`, do not invent flags), what the daemon does and when a report appears
   (and that the daemon must be running a build that includes the drain), where Greg reads them (the
   Claims section, `overseer reports`), what it deliberately does not do (grant anything, infer state,
   read transcripts), and the limits (self-declared actor; nothing defends against a process running as
   the same Unix user). Link the plan and the proposals file
   `docs/plans/260910e-work-reports-convention-proposals.md`. Add one line under
   `docs/project/dev-and-deployment-overview.md` beside the `overseer.md` lines, and a link back up
   ("Every doc has a parent"). `tests/doc-links.test.ts` must pass: an em dash in a heading slugs to
   ONE hyphen.

**Tests first, red then green**: projection (unreported for a register session with no claim; a
reported-but-unregistered session; latest per session; a correction shown as attributed; no inference
from kinds; register unreadable is its own arm); the route's arms, both ceilings, 405, HEAD; the client
accepting a payload and refusing a malformed one and one with `schema: 2`; the panel rendering
"unreported — nothing said", "claimed by", "not stated", a link only for an on-dev artefact, and a summary
containing `javascript:` as text; `tests/doc-links.test.ts`. Mint fresh uuids (`tests/fixture-ids.test.ts`).

**Gates**: your test files, `tests/fleet-decisions-panel.test.tsx`, `tests/doc-links.test.ts`,
`npm run build:fleet` then `tests/fleet-decisions-route.test.ts`, `npm run typecheck` (read the exit
code), `npx biome lint <files you touched>`. Not the full suite. **Do not commit.** Files you may touch:
the seven above and their new tests. Anything else: stop and say so.

---

## Stage 3b — a session's decision into `decisions.jsonl`

(Dispatched after the second Stage 1 review lands. Files: `tools/overseer/reports.ts`,
`scripts/overseer.ts`, `docs/project/work-reports.md` (its `report decision` section only), and the
reports tests.)

### First: bound the inbox enumeration (the Stage 1 review's condition for landing)

Read `docs/plans/260910e-work-reports-stage1-review-r2-sol.md` § Directory listing bound. Today every
pass does `readdirSync` + a `stat` per entry + a sort over the whole inbox, synchronously, inside the
daemon — so a runaway writer with 100 000 files stalls the whole Overseer, heartbeat included. Slicing
after `readdirSync` does not bound it. Build the smallest real bound:

- iterate the inbox lazily with `opendirSync` / `readSync`, and stop after a fixed number of directory
  entries per pass (a new `DrainLimits.scanEntries`, default 1 000), closing the handle in `finally`;
- among the entries read, order the valid candidates oldest-first as today, and say in the outcome when
  the scan cap was hit ("order is approximate beyond the first N entries");
- so a hostile prefix of permanently invalid entries cannot starve valid submissions, **move** entries
  that can never become a report — a name that is not `<uuid>.json` or `.tmp-<uuid>`, a directory, a
  symlink, a file with more than one hard link — into a sibling `report-quarantine/` (a `rename`, which
  moves a symlink itself and never its target), keeping at most the newest 200 there and deleting the
  rest, and count them. Leave the choice of whether an oversize or name≠id file is quarantined or
  refused as it is today (they are already refused, which removes them).
- Tests, red first: a flood of 5 000 invalid entries ahead of one valid submission ⇒ within a bounded
  number of passes the valid one is recorded and the pass never reads more than `scanEntries` entries;
  quarantine keeps the newest 200; a symlink in the inbox is moved and its target untouched; the cap
  message appears when hit.

### Then: decision reports

- A `decision` submission's `draft` is validated with the schema-2 decision parser. Stage 2 exported no
  `DecisionDraft` type; build one in `reports.ts` from `ASSESSMENT_FIELDS` plus the schema-1 content
  fields (class, question, options, chose, why, advisers, bearsOn, supersedes), form the event with
  `envelope("daemon", { commandId: "report:<eventId>" })`, and pass it through `parseEventDetailed` so
  the refusal names the field. `appendEvents` refuses any event its own parser would refuse, and since
  Sol's WR-S2-2 it accepts an exact replay of an already-written prepared event. Only the attribution
  matrix overseer→overseer, greg→greg, daemon→session parses (WR-S2-1). Refuse the submission when the
  actor is not a session ("the Overseer and Greg record decisions with `overseer-decisions add`").
- In step [1], freeze into `report-processing/<id>.json`: `decisionId` (`mintId()`), `decidedAt` (= the
  drain's `receivedAt`), `author: { kind: "session", name, execution }` where `execution` is the
  `ExecutionRef` the register gives for that name at receipt, the evidence checks, and the whole prepared
  `decided` event with `by: "daemon"` and `commandId: "report:<eventId>"`.
- Step [2] appends exactly those bytes with `appendEvents([event], { root: decisionsRoot(env) })`
  (honour `OVERSEER_DECISIONS_DIR`). `ok` ⇒ continue; `locked` ⇒ transient, leave pending;
  `command-conflict` / `would-break` / `unreadable` / `refused` ⇒ refuse the submission with that reason
  (the processing record goes to `report-refused/` in the same atomic way Stage 1 refuses).
- The report written in step [3] carries `decisionId` only. `scripts/overseer.ts report decision --file`
  stops refusing; check `overseer-decisions template`'s shape (minus `author`) is what it accepts.
- Tests, red first: a session decision lands in both logs joined by `report:<eventId>`; it is pending
  review; a crash after step [2] and before [3] re-drains to exactly one decision and one report even
  though the fake register and checker now answer differently; `locked` leaves it pending and writes
  nothing; an Overseer-actor decision submission is refused; `OVERSEER_DECISIONS_DIR` is where it lands;
  the decision's evidence checks equal the report's.

---

Report back briefly: files changed; each test and whether you saw it red first; gate results with exit
codes; decisions you made; anything left undone. Conclusions, not file contents.
