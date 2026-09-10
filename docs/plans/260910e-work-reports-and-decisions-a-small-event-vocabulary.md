# Work reports and decisions: a small event vocabulary

Roadmap stage: [260908f § Stage: Work reports and decisions](260908f-overseer-and-fleet-improvement-roadmap.md#stage-work-reports-and-decisions-a-small-event-vocabulary).
Queue item `qi-evwdxpkf`, dispatched by the Overseer as session `work-reports` on 2026-09-10.

## What this is for

Greg wants to see **what an agent claimed** — progress, blocked, a decision, completed — and **which
decisions were made**, with links to the real artefacts, without a model reading every transcript and
without a report ever granting anything. Today an agent's claims live only in its transcript and its
debrief message, and the decision record (260909e) holds only decisions the Overseer wrote down.

Acceptance, from the roadmap: *Greg can inspect what an agent claimed and which decision was made, with
links to actual artifacts. No model pass over all transcripts and no automatic authority from a
report.*

## What already exists, and is reused

- **The decision record** — `tools/overseer/decisions.ts` (append-only events, strict per-event parser,
  fold that alone decides what counts as reviewed, init marker so a lost file never reads as empty,
  its own lock), `scripts/overseer-decisions.ts` (`template`, `add --file --by`), the projection
  `tools/fleet/decisions-view.ts`, the route `routes-decisions.ts`, and the **Decisions** tab.
- **The daemon's store** — `tools/overseer/store.ts`, one writer enforced by an `O_EXCL` lock on
  `overseer.lock`. Its event log is **disposable**: one bad line in a replay means a cold start, and
  losing it costs history only.
- **`jsonl.ts`** (repair and append) and **`lock.ts`** (exclusion), which decisions already share.
- **The register's verified execution** per session (`RegisterEntry.verifiedExecution`, a token and a
  `since` that is a floor, not a start time) and `executionRefFor` in `decisions-view.ts`.
- **`tools/fleet/execution-identity.ts`** — `readBootIdentity`, `readProcessStart`, `parseProcStat`:
  enough for a process to name the Claude execution it is running under.

## The design

### Reports go in their own log, written only by the daemon

`~/.overseer/reports.jsonl` (same root and override as the store). **Not `events.jsonl`**: the store's
replay rule (one bad line ⇒ cold start) and its disposability are right for a derivation of the live
fleet and wrong for original input an agent cannot re-send, and a new event kind there would make every
older daemon start cold.

**Clients submit; the daemon writes.** The daemon has no socket and should not grow one for this, so
submission is a file drop — the pattern `reconcile-jobs` already uses. Sol agreed this is the simplest
durable owner-submission design, including when the daemon is down for hours.

```
submitter (agent / Overseer / Greg)            daemon (single writer — it holds overseer.lock)
───────────────────────────────────            ────────────────────────────────────────────────
overseer report <kind> …                       every 30 s, synchronously, one pass at a time:
  validate strictly (same parser the daemon       list report-inbox/: only regular files named <uuid>.json,
  uses)                                            opened O_NOFOLLOW, fstat regular, ≤ 16 KiB, name = eventId
  observe its own execution token                  (anything else: counted and left, never read)
  mint eventId (uuid)                            [1] prepare once: parse, check artefacts, compare token with
  write report-inbox/.tmp-<id> (wx, fsync)           the register, stamp receivedAt, and for a decision mint
  rename → report-inbox/<id>.json  ───────▶          decisionId + decidedAt ⇒ write processing/<id>.json atomically
  print id + "submitted, not yet recorded"       [2] decision only: append the prepared decided event
                                                     to decisions.jsonl (exact bytes; command id report:<id>)
overseer reports                                 [3] append the prepared report to reports.jsonl, fsync
  recorded rows · in-flight inbox items ·        [4] unlink processing/<id>.json, then the inbox file
  refused submissions and why                    a processing/ file found at the start of a pass is replayed
                                                 from [2] with its frozen bytes — nothing is re-derived
```

- **Replay is exact.** Enrichment (`receivedAt`, execution comparison, artefact checks, decision id,
  `decidedAt`) happens once, in [1], and is frozen in `processing/<id>.json`. `appendEvents` is
  idempotent on a command id only when the payload is byte-identical, so every retry must append the
  same bytes, and does. A report already in `reports.jsonl` with identical bytes is skipped.
- **Refused vs pending.** Invalid input (shape, unknown kind, oversized, name ≠ id, a conflicting
  duplicate) is refused: one atomically written `refused/<id>.json` holding the reason and the original
  text, then the inbox file is removed; refused records are kept to the newest 200. **Transient failure**
  (decisions lock held, a checker that could not run) leaves the item pending for the next pass.
- **Bounds per pass**: 50 files, 1 MiB read, 200 artefact probes, 5 s wall clock; the rest waits. The
  pass is synchronous, so two cannot overlap and shutdown cannot interrupt one mid-step.
- **Exclusion** comes from the daemon's own `overseer.lock` — a second daemon never starts — and the
  drain is only ever called by a daemon holding it. No `reports.lock`.
- **The limit, stated**: nothing on this filesystem defends against a hostile process running as the
  same Unix user; it could write `reports.jsonl` directly. This is the same governance-not-OS-boundary
  line the decision record draws for `by`.

### The record

Two shapes, because the submitter must not be trusted for what the daemon stamps:

```ts
type ReportKind = "progress" | "blocked" | "decision" | "completed";
type ReportActor = { kind: "session"; name: string } | { kind: "overseer" } | { kind: "greg" };

// tools/fleet/artefact-ref.ts — a leaf, so the browser can build the same links
type ArtefactRef =
  | { kind: "commit"; sha: string } | { kind: "path"; path: string }
  | { kind: "decision"; id: string } | { kind: "queue-item"; id: string };
type ArtefactCheck =
  | { state: "on-dev" }          // commit is an ancestor of origin/dev; path exists in origin/dev's tree
  | { state: "found-locally" }   // commit object / file (realpath inside the checkout) here, not on dev
  | { state: "found" }           // a decision or queue item that exists in its record
  | { state: "not-found" }
  | { state: "unchecked"; why: string };

type ReportSubmission = {
  schema: 1; eventId: string; submittedAt: string; kind: ReportKind; actor: ReportActor;
  observedExecution: string | null;   // the token the submitter read for its own Claude process
  job: { plan: string | null; queueItem: string | null; occurrence: { jobId: string; scheduledAt: string } | null };
  summary: string; artefacts: ArtefactRef[]; corrects: string | null;
} & (
  | { kind: "progress" }
  | { kind: "blocked"; on: "greg" | "peer" | "review" | "environment" | "other"; needs: string }
  | { kind: "completed"; ending: "finished" | "done-enough" | "important-work-left";
      revisions: { reviewed: string[]; tested: string[]; merged: string[] } }
  | { kind: "decision"; draft: DecisionDraft }      // the schema-2 decision fields, minus author
);

type ReportEvent = Omit<ReportSubmission, "artefacts" | "draft"> & {
  receivedAt: string;
  execution: "same-verified-run" | "different-verified-run" | { unverifiable: string } | null; // null unless a session
  artefacts: { ref: ArtefactRef; check: ArtefactCheck }[];
} & ({ kind: "decision"; decisionId: string } | …the other three unchanged);
```

**Every text field is bounded and clean**: summary ≤ 1000 characters, `needs` ≤ 500, every id, path,
sha, plan and job field to a fixed pattern and length, lists ≤ 20; no control characters, no bidi
overrides, anywhere, in submissions or in decision drafts. The CLI and the drain share one parser.

**Every report is a claim, and the types say so.** The projection calls rows `claims`, the page says
*"claimed by work-reports"*, and nothing downstream turns a report into a state: no READY/LANDED/GATED
machine, no permission, no queue transition. A `completed` report's revision lists are what the agent
*said*; an empty list renders **"not stated"**, never "not reviewed".

**Execution is compared by token, not by clock** (Sol's WR-P4). The submitter walks its own process
ancestry to the `claude` process and reads `boot:pid:startTicks`; the daemon compares that with the
register's verified token for the named session: equal ⇒ `same-verified-run`, different ⇒
`different-verified-run` (a reused name, or a register still holding an older run — labelled, kept),
no token or no verified entry ⇒ `unverifiable` with the reason. Nothing is ever called current because
a token is absent. `actor` itself stays a self-declaration, as `by` is in the decision record.

**Artefacts are checked, not trusted, and not refused.** A commit or file that does not exist is itself
a discrepancy Greg should see, so the report is kept with that reference `not-found`. The *shape* is
refused. Commits are checked as commits (`git cat-file -e <sha>^{commit}`, `git merge-base
--is-ancestor <sha> origin/dev`), paths against `origin/dev`'s tree and then realpath containment in
the checkout; all through `execFile` with an argv, never a shell. **Links are built only for `on-dev`
artefacts** (GitHub commit, `blob/dev/<percent-encoded segments>`) and for found decisions
(`#decision-<id>`), by one function in `artefact-ref.ts`, from validated fields — never from free text.

**Corrections are explicit** (Sol's WR-P9). `corrects` must name an earlier event, not itself; the
fold never edits the earlier row, it marks it *corrected by <id>, by <actor>, at <time>*. Without
`corrects`, a later claim is just a later claim: the page shows the latest per session and says a
later claim exists, and infers no disagreement from event kinds.

### Decisions: extend the one record, and how the two logs reconcile

**Schema 2 of `decided`** adds, required on every new event:

| field | values | notes |
|---|---|---|
| `author` | `{kind:"overseer"}` \| `{kind:"greg"}` \| `{kind:"session", name, execution}` | who **decided** |
| `consequence` | `high` \| `medium` \| `low` | ranks first |
| `reversibility` | `easy` \| `costly` \| `one-way` | ranks second |
| `domain` | `product` \| `technical` | |
| `recommendation` | text or null | what the author recommends if Greg looks again |
| `evidence` | `{ref, check}[]` | the artefact type above |
| `gregAsked` | `no` \| `asked-answered` \| `asked-awaiting` | **the author's claim**, rendered as such |
| `confidence` | `high` \| `medium` \| `low` \| null | annotation only; never sorts |

`by` stays **who recorded the line**, and gains a third value, `daemon`, for a line the drain copied
from a session's submission — it would be false to say the reasoning Overseer wrote it (Sol's WR-P1).

- **Schema 1 lines are never migrated** and fold with `author: legacy-unrecorded` — not `overseer`,
  because the record's own header says V1 assumptions were made under Greg's standing decision — and
  every new field `not-recorded`.
- **Only a session's decision comes through reports.** The drain refuses a decision submission whose
  actor is `greg` or `overseer`; they keep using `overseer-decisions add`. So the daemon only ever writes
  `by: daemon, author: session`.
- **Nothing an author says changes review.** Only `reviewed`/`reversed` with `by: greg` count,
  unchanged. `gregAsked: asked-answered` is displayed as *"the author says Greg answered"*, never beside
  or in the style of the review state.
- **Both boundaries are bumped** (WR-P2): the event schema, so an old event reader shows an
  unreadable-line problem, and the `/api/decisions` payload schema, so an old browser refuses the
  payload instead of showing a session's decision as "recorded by overseer". Tests pin frozen copies
  of both old parsers.
- **Who writes `decisions.jsonl`**: the `overseer-decisions` CLI (Overseer, Greg) and the daemon's drain
  (sessions), both through `appendEvents` under `decisions.lock`, both honouring
  `OVERSEER_DECISIONS_DIR`. It was never single-writer and stays that way.
- **The reconciliation in one line**: a session's decision is one `decided` event in
  `decisions.jsonl` — the content, reviewed or reversed there by Greg only — and one `decision` report
  in `reports.jsonl` pointing at it, so that session's claims are complete in one place. Command id
  `report:<eventId>` joins them and makes step [2] replay-safe.

**Ranking** (WR-P8): pending decisions sort by consequence `high` → `not-recorded` → `medium` → `low`,
then reversibility `one-way` → `not-recorded` → `costly` → `easy`, then newest `decidedAt`. Unknown is
shown as unknown, never as high. The server orders; the panel still does not sort.

**Searchable**: `overseer-decisions list --search <text> [--domain] [--consequence] [--author]`, and a
client-side filter box over the rows the route already bounds.

### Unreported sessions show as unreported

The reports projection joins the register: every session the checkpoint knows gets its latest claim, or
**unreported**. Unreported is not idle, stuck or failed; it means nothing was said.

### The reporting convention: machinery complete, convention not activated

Sol's WR-P7, accepted: roadmap checkbox 4 is only half met by this plan. I build the CLI, the unreported
rows and `docs/project/work-reports.md`. The convention reaching agents needs three things that are not
mine, proposed through the Overseer:

1. **A paragraph for the Overseer's dispatch briefs** (its runbook is not mine).
2. **The standing jobs' prompts** — changing a `what` changes its pinned hash, and re-pinning is Greg's
   by design (`standing-jobs.ts` § AUTHORISED_HASHES). Proposed wording and the resulting hash.
3. **Any AGENTS.md rule** — Greg's before/after edit. Not needed for the first delivery.

The debrief will say *reporting machinery complete; convention not activated* until those land.

## Simpler options passed over

- **Reports as new kinds in `events.jsonl`.** One log fewer, but it makes original input disposable and
  puts untrusted text on the path whose one bad line cold-starts the register.
- **The CLI appends `reports.jsonl` directly under a lock**, as `overseer-decisions` does. Simpler by a
  drain, and exactly what the roadmap asks us not to do: the daemon owning the file is what lets it
  stamp `receivedAt` and compare execution against the register it holds.
- **Deriving enrichment on every retry** instead of freezing it in `processing/`. One file fewer, and
  it turns a crash between the two appends into a command-id conflict (Sol's WR-P3).
- **A second decision log for agents' decisions.** Two logs are two answers to "what was decided".
- **Refusing a report whose artefact is missing.** Loses the claim, which is the thing worth seeing.
- **Stale by timestamp** (`submittedAt < since`). `since` is a floor, not a start, so it calls a real
  report stale and misses a reused name (WR-P4).
- **A new dashboard tab.** Six places in three files; the claims go in a section of the Decisions tab.

## Stages

Implementation is by Opus subagents (the brief: Codex is the tighter budget). GPT Sol reviews the plan
once and each stage once, `--effort high --timeout-minutes 30`; a second round is announced to the
Overseer first. Stages 1 and 2 run in parallel — their file sets are disjoint, and the one module both
need, `tools/fleet/artefact-ref.ts`, I write first, by hand (it is types, a parser and a link builder).

### Stage 1 — the reports log, the inbox, the drain, the CLI

**Status: built, not yet Sol-reviewed.** Implemented by an Opus subagent from
[the Stage 1 brief](260910e-work-reports-stage1-task.md); `artefact-ref.ts` by the orchestrator. Its
own seven test files: 167 passed, exit 0 (orchestrator's run). What it decided that the plan did not
say, all accepted:

- The three directories are siblings — `report-inbox/`, `report-processing/`, `report-refused/` — not
  subdirectories of the inbox, which a pass would otherwise count as skipped entries every time.
- A re-dropped duplicate is recognised by rebuilding the submission from the recorded event, not by
  comparing stored bytes: the daemon stamps a fresh `receivedAt` on each attempt, so bytes would call
  every honest re-drop a conflict.
- `deferred` (a limit reached) is counted apart from `pending` (a transient failure).
- A report that `corrects` one still waiting in the inbox waits too, rather than being refused.
- A lost log (`reports.created` present, `reports.jsonl` absent or empty) leaves everything pending and
  never recreates the file. The cost: a crash between writing the marker and the first append sticks
  until someone deletes the marker — the same small window the decision record accepts.
- Unknown fields are refused in submissions and in recorded events; the pass's 5 s budget uses the real
  clock, not the injected one.
- Condition `reports` in `notes.ts` (opens on a throwing drain, closes on the next good pass) rather than
  a new note kind.

**Sol's stage review, first run: timed out.** Killed at its 30-minute limit before writing an answer
(`run-codex` EXIT=1). It left partial fixes — exact keys in `artefact-ref.ts`, a before/after `stat`
read around the command line in `report-identity.ts`, hard-link refusal, bounded reads of the
processing and refused records, stopping a pass on any transient failure so the next pass's repair
runs before another append, and bounds that hold for the first item — which the orchestrator read,
tested (170 passed) and committed as unreviewed code; its findings were then recovered from its
activity log into [the first run's answer](260910e-work-reports-stage1-review-sol.md).

**Second run** ([answer](260910e-work-reports-stage1-review-r2-sol.md)), narrowed at the Overseer's
direction to 30 minutes, the first run's fixes and what it had not reached, findings written before
fixing. Three P1s, fixed by the reviewer: stopping a pass on *any* transient failure let one stuck item
starve every later submission — now only a failed append stops a pass (`AppendMayHaveTornTail`); the
wall deadline abandoned a report between probes and restarted it every pass — now it finishes, with
unprobed references `unchecked`; a local path was called `found-locally` when the dev check could not
answer — now `unchecked`. Orchestrator's run after: 172 passed, exit 0. **Verdict: not approved until
the inbox enumeration is bounded** — `readdirSync` over a flooded inbox would stall the daemon's whole
loop. That bound goes into Stage 3b, the next change to `reports.ts`, and Stage 3's review checks it;
the other three were the whole of what a second round was asked to settle, so there is no third round.

Two lessons, for the debrief. A review asked to do too much dies at its wall, and a killed run leaves no
answer — the second one wrote findings first and was fine. And `run-codex` overwrites `--output` with the
run's final message, so a reviewer that writes its findings *into* the answer file loses them; the
recovered text came from the activity log.

Left for Stage 3: `appendDecision` is in the signature but unreached (decisions are refused before step
[2]), so "decisions lock held ⇒ pending" is Stage 3's test. The drain re-reads all of `reports.jsonl`
each pass to index event ids — fine at today's size.

- [x] `tools/fleet/artefact-ref.ts` + its test (orchestrator, by hand, before the stage).
- [x] `tools/overseer/reports.ts`: submission and event parsers, `submitReport`, `drainReports` (the
  four steps, `processing/`, refusals, bounds), `readReports` (three arms, `reports.created` marker),
  `foldReports`. A `decision` submission is refused in this stage with "decision reports are wired in
  stage 3"; the prepare/replay protocol is built generally so stage 3 only adds step [2].
- [x] `tools/overseer/report-artefacts.ts`: the real checker (git via `execFile` argv, timeouts).
- [x] `tools/overseer/report-identity.ts`: the submitter's own execution token from `/proc`.
- [x] `scripts/overseer.ts`: `report <kind>` and `reports`; `run` composes the drain into the daemon.
- [x] `tools/overseer/daemon.ts`: one optional `reports` option on its own interval; errors contained.
- [x] Tests red first: duplicates (same bytes ⇒ one row; other bytes ⇒ refused), execution tokens (same /
  different / unverifiable), untrusted text in every field (control characters, bidi, `..`, oversize),
  unknown kind (CLI and hand-dropped), nonexistent artefact kept `not-found`, explicit correction kept
  and attributed, a later claim not called a contradiction, crash at every step boundary with the
  register and artefacts changed between attempts, daemon-down backlog beyond one pass, non-regular
  inbox entries, name ≠ id, a transient checker failure left pending, lost-log marker.

### Stage 2 — decisions schema 2

**Status: built, not yet Sol-reviewed.** Implemented by an Opus subagent from
[the Stage 2 brief](260910e-work-reports-stage2-task.md). What it decided that the plan did not say,
all accepted:

- `recommendation` and `evidence` are `{kind:"not-recorded"} | {kind:"recorded", value}` — a
  recommendation could literally read "not-recorded", and an empty evidence list is a recorded fact.
  The enums are `X | "not-recorded"`; confidence is `Confidence | null | "not-recorded"`.
- Every new event is schema 2, reviews and reversals included; a review cannot carry `by: "daemon"`
  at the type level. `seed` still writes schema 1 on purpose — stamping schema 2 on a hand-copied V1
  decision would invent its author and consequence.
- Schema-2 bounds on the old text fields too (question 1000, why 4000, option 200/1000, notes 1000–2000,
  ≤ 20 options and sessions); schema-1 lines keep the rules they were written under.
- **`appendEvents` now refuses any event its own parser would refuse** — before, a note with a newline
  was written and read back as an unreadable line. This also protects Stage 3's drain.
- The CLI's `--evidence` checks decision ids against the record; commits, paths and queue items are
  stored `unchecked` because the CLI holds no git checker (Stage 1's could be wired in later).
- Search exists twice — the CLI's in `decisions-view.ts`, the browser's in `decisions-client.ts` — because
  neither can import the other; one test runs both over the same record.
- Each card sits in a wrapper with `id="decision-<id>"` (`Card` takes no id, and `ui.tsx` is not ours).

Not seen in a real browser; jsdom only.

**Sol's stage review** ([answer](260910e-work-reports-stage2-review-sol.md), one round, write-capable):
*ready to land after these fixes*, three fixed in-stage, each red first —

- **WR-S2-1 (P0)**: a hand-written schema-2 line could pair `by: overseer` with `author: greg`, and that
  false attribution reached the fold, route, CLI and panel. Both parsers now admit only the matrix
  overseer→overseer, greg→greg, daemon→session.
- **WR-S2-2 (P1)**: `appendEvents` refused Stage 3's exact replay of a prepared event as a duplicate
  event id before command-id idempotency ran. An already-persisted, command-keyed event with the same
  id, timestamp and payload is now dropped before the preflight fold; a changed payload under the same
  id still fails.
- **WR-S2-3 (P1)**: the schema-2 bounds missed execution tokens and reasons, `chose.option`, command ids
  and long fractional timestamps; verified tokens must now be canonical.

It broke the frozen old event parser on purpose and saw it go red for the right reason, which closes
the never-seen-red gap above. Wider, not fixed and not fixable here: a process running as the same
Unix user can still write a consistent `by: greg, author: greg` line — the governance-not-OS boundary
the record already names.

- [x] `decisions.ts`: schema 2 `decided`; `by` gains `daemon`; schema 1 folds as `legacy-unrecorded`.
- [x] `overseer-decisions.ts`: `template`/`add` at schema 2, `list --search/--domain/--consequence/--author`.
- [x] `decisions-view.ts`: the ranking above.
- [x] `/api/decisions` payload schema 2; `wire.ts` decision types, `routes-decisions.ts`,
  `decisions-client.ts`, `DecisionsPanel.tsx` (author, the new fields, evidence links via
  `artefact-ref.ts`, Greg-asked as the author's claim), a client-side search box.
- [x] Tests: v1 folds; v2 round-trips; each required field refused when missing; no author changes
  review; frozen old event parser and frozen old client parser both refuse the new shapes; ranking with
  `not-recorded`; CLI search and filters; panel links built only from validated fields.

### Stage 3 — decision reports, the dashboard's claims, the convention

**Split in two** so the dashboard work could run beside the second Stage 1 review
([brief](260910e-work-reports-stage3-task.md)).

**3a — built and committed (`c5242a04`), not yet Sol-reviewed.** Opus subagent. The projection keeps
the register's availability in the *shape* of `sessions` — joined with the register, or
register-unavailable with only the sessions that reported — so "everyone is unreported" and "the
register could not be read" cannot look alike. `never-written` carries the inbox counts ("nothing
recorded, 3 submitted" is what a daemon without the drain looks like). Latest and later are by log
position, since the daemon is the only writer. Each claim carries `laterClaim`, the id of the next claim
by the same reporter, shown with no inference. The Overseer and Greg appear in recent claims, not in the
sessions list. One `ArtefactList` builds links for decision evidence and claim artefacts alike. The
search box filters recent claims but never the session rows: hiding an unreported row would hide the one
thing it says. `AGENTS.md`'s entry-point line gained `work-reports.md` — a signpost, which CLAUDE.md says
needs no approval, and which `tests/doc-links.test.ts` reads doc ownership from. jsdom only; not seen in
a real browser.

**3b — built, not yet Sol-reviewed.** Opus subagent. First the inbox-enumeration bound the Stage 1 review
made its condition for landing: each pass iterates the inbox lazily with `opendirSync` and stops after
`scanEntries` (default 1 000) entries, noting "order is approximate beyond the first N entries" when the
cap is hit; anything that can never become a report (a bad name, a directory, a symlink, more than one
hard link) is *moved* to `report-quarantine/`, newest 200 kept, so a hostile prefix cannot fill every
pass's window. Names are read as raw bytes — a non-UTF-8 name cannot be reached by a string path, so it
could otherwise never be moved. Then decision reports: a session's `decision` submission is validated by
building the real `decided` event (`by: daemon`, session author, command id `report:<eventId>`) through
`parseEventDetailed`; step [1] freezes it in `report-processing/`, step [2] appends exactly those bytes,
`locked` stays pending, any other refusal from the record refuses the submission atomically; an
Overseer or Greg actor is refused. The report's `artefacts` are the decision's evidence — probed once, so
the two cannot disagree. `report decision --file` accepts `overseer-decisions template` output as printed.
`makeReportDrain(root, env)` honours `OVERSEER_DECISIONS_DIR`. Seen red first: the flood (5 000 entries,
recorded within six passes), quarantine bounds, symlink moved and its target untouched, both logs joined,
a crash at each of four boundaries re-draining to exactly one of each. Accepted cost: an `unreadable` or
`refused` answer from the decision record — including a filesystem error — refuses the submission rather
than leaving it pending, as the brief said.

**The seam** (orchestrator, a few lines): `tests/fleet-attention.test.ts` asserts the exact set of
Overseer modules `tools/fleet/` may reach. 3a's `reports-view.ts` imported `reports.ts`, whose type-only
import of `store.ts` put nineteen modules over the line. `reports.ts` now declares the two register fields
it reads as a structural `ReportRegister`, and `reports.ts` joins the allowlist with its closure written
out. Typecheck exit 0; nine affected test files, 238 passed.

Known and left for the review to weigh: `readInbox` still lists the whole inbox on every `GET /api/reports`
(the dashboard, not the daemon); pruning a quarantined *directory* is recursive; the daemon logs a pass
that only quarantined nothing.

**Sol's Stage 3 review** ([findings](260910e-work-reports-stage3-review-sol-findings.md),
[answer](260910e-work-reports-stage3-review-sol.md); 3a and 3b together, 30 minutes, findings written to a
separate file first — which is why they survived): **not approved.** Fixed by the reviewer, each red
first: WR-S3-1 (P1) a Sessions row made a completed claim read like the session's state — now "latest:
claimed by …"; WR-S3-2 (P1) failed and 404 HEAD requests sent bodies; WR-S3-3 (P2) two quarantine passes in
one millisecond could delete newer entries. Orchestrator's run after: 9 files, 214 passed. Gate 1 held:
session decisions are frozen before either append, recorded `by: daemon, author: session`, cannot become
reviews, replay exact bytes, leave lock contention pending, and honour `OVERSEER_DECISIONS_DIR`.

Open, and taken by **Stage 3c** ([brief](260910e-work-reports-stage3c-task.md)):

- **WR-S3-4 (P0)**: quarantine pruning deleted old entries with a recursive `rmSync`, so one quarantined
  directory holding a huge tree could wedge the daemon — the failure the inbox bound exists to prevent.
  **Decided: the daemon never deletes from quarantine.** Sol's route was a budgeted, resumable cleanup
  protocol; the simpler one wins because moving an entry into quarantine costs no disk (the writer already
  put it there), so there is nothing for the daemon to reclaim, and deleting someone else's files was never
  its job. This drops "newest 200 kept"; emptying the quarantine is a person's act. Accepted by the Overseer
  as its default pending Greg. **The one cost: the quarantine grows until someone empties it.** So the
  growth shows rather than being silent — the Claims section and `overseer reports` say how many entries
  are quarantined and how old the oldest is (capped like every other count here, "at least" when it is).
- **WR-S3-5 (P1)**: `GET /api/reports` listed and opened the whole inbox, so a flood could block the fleet
  server. Fix: the same capped lazy read, and every count says `{ exact }` or `{ atLeast }` through the
  wire (reports payload schema 2), the client, the panel and the CLI ("AT LEAST …") — never a partial count
  that looks exact.

After 3c, one narrowly scoped Sol check of those two fixes (the P0 was not in the reviewed snapshot),
announced to the Overseer as the sixth run.

- [ ] Step [2] of the drain: a session's decision into `decisions.jsonl`, replay tests at each boundary,
  `OVERSEER_DECISIONS_DIR` honoured, a decisions-lock contention left pending.
- [ ] `tools/fleet/reports-view.ts` (pure, joined with the register ⇒ unreported), `routes-reports.ts`
  (`GET /api/reports`, read-only, byte-bounded like decisions), one line in `server.ts`, a block
  appended to `wire.ts`, a client, and a **Claims** section in the Decisions tab with a search box.
- [ ] `docs/project/work-reports.md`, signposted from `dev-and-deployment-overview.md`; the three
  proposals sent to the Overseer.

## Plan review outcome (GPT Sol, 2026-09-10)

`260910e-work-reports-plan-review-sol.md`: *revise, no P0*, nine findings, all accepted and folded into
the design above — WR-P1 (daemon recorder, legacy author, session-only bridge, Greg-asked as claim),
WR-P2 (API schema bump, frozen old parsers), WR-P3 (submission vs prepared event, frozen `processing/`
replay, `OVERSEER_DECISIONS_DIR`), WR-P4 (token comparison), WR-P5 (inbox bounds, atomic refusals,
`overseer.lock` as the exclusion, the same-user limit), WR-P6 (bounds on every field, on-dev vs local,
encoded links), WR-P7 (convention not activated), WR-P8 (`not-recorded` bucket), WR-P9 (explicit
corrections only, the longer test list). No second plan round: every finding was a missing protocol
detail rather than a wrong direction, and Sol called the ownership design sound.

## Needs Greg (to be confirmed in the debrief)

- The schema-2 decision fields and their enums are a stored shape; the values above are my defaults.
- Wording for the standing-job prompts (re-pin), and whether an AGENTS.md rule is wanted at all.

## Status

Plan reviewed by Sol 2026-09-10 and revised. Stages 1 and 2 next, in parallel.
