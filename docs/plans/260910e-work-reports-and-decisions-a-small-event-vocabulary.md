# Work reports and decisions: a small event vocabulary

Roadmap stage: [260908f § Stage: Work reports and decisions](260908f-overseer-and-fleet-improvement-roadmap.md#stage-work-reports-and-decisions--a-small-event-vocabulary).
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
- **The daemon's store** — `tools/overseer/store.ts`, one writer enforced by an `O_EXCL` lock. Its
  event log is **disposable**: one bad line in a replay means a cold start, and losing it costs history
  only.
- **`jsonl.ts`** (repair and append) and **`lock.ts`** (exclusion), which decisions already share.
- **The register's verified execution** per session (`RegisterEntry.verifiedExecution`), and
  `executionRefFor` in `decisions-view.ts`, which turns a name into `verified | not-found | unavailable`.

## The design

### Reports go in their own log, written only by the daemon

`~/.overseer/reports.jsonl` (same root and override as the store). **Not `events.jsonl`**, for two
reasons: the store's replay rule (one bad line ⇒ cold start) and its disposability are right for a
derivation of the live fleet and wrong for original input an agent cannot re-send; and a new event kind
there would make every older daemon build start cold on reading it.

**Clients submit; the daemon writes.** The roadmap asks that the daemon stay the single writer and that
clients submit to the owner. The daemon has no socket and should not grow one for this, so submission is
a file drop — the pattern `reconcile-jobs` already uses (a file the daemon consumes):

```
agent / Overseer / Greg                         daemon (single writer)
───────────────────────                         ──────────────────────
overseer report <kind> …                        every 30 s: drainReports(register)
  validate strictly                               for each inbox file (oldest first, ≤ 50):
  mint eventId (uuid)                               parse strictly — unknown kind ⇒ refused/
  write report-inbox/.tmp-<id>                      duplicate id, same bytes ⇒ drop the file
  rename → report-inbox/<id>.json   ─────────▶      duplicate id, other bytes ⇒ refused/
  print id + "submitted, not yet recorded"          verify each artefact (found / not-found / unchecked)
                                                    resolve execution from the live register
overseer reports                                    [decision] append decided event to decisions.jsonl
  recorded rows (reports.jsonl)                                 (commandId = report:<id>, idempotent)
  + "submitted, not yet recorded" (inbox)           append report to reports.jsonl, fsync  (reports.lock)
  + refused submissions and why                     unlink the inbox file
```

Every crash point replays safely: the decisions append is idempotent on its command id, the report
append is skipped when its event id is already in the log with the same payload, and the inbox file is
removed last. A refused submission moves to `report-inbox/refused/` beside a `.why` file, kept to the
newest 200, and `overseer reports` lists them — a refusal must never look like a report still in
flight, nor like nothing having been sent.

The drain holds `reports.lock` (via `lock.ts`) while it appends, so a botched second daemon cannot
interleave, and the CLI has no code path that opens `reports.jsonl` for writing.

### The record

```ts
type ReportKind = "progress" | "blocked" | "decision" | "completed";
type ReportActor = { kind: "session"; name: string } | { kind: "overseer" } | { kind: "greg" };

type ArtefactRef =
  | { kind: "commit"; sha: string }          // 7–40 hex
  | { kind: "path"; path: string }           // repo-relative, no "..", no leading "/", ≤ 300 chars
  | { kind: "decision"; id: string }         // dec-xxxxxxxx
  | { kind: "queue-item"; id: string };      // qi-xxxxxxxx
type ArtefactCheck = { state: "found" } | { state: "not-found" } | { state: "unchecked"; why: string };

type ReportEvent = {
  schema: 1; eventId: string /* uuid, minted by the submitter */;
  submittedAt: string; receivedAt: string /* the daemon's clock */;
  kind: ReportKind; actor: ReportActor;
  execution: ExecutionRef | null;            // resolved by the daemon at receipt; null unless a session
  job: { plan: string | null; queueItem: string | null; occurrence: { jobId: string; scheduledAt: string } | null };
  summary: string;                           // ≤ 1000 chars, no control characters, never interpreted
  artefacts: { ref: ArtefactRef; check: ArtefactCheck }[];   // ≤ 20
  corrects: string | null;                   // an earlier eventId this report corrects
} & (
  | { kind: "progress" }
  | { kind: "blocked"; on: "greg" | "peer" | "review" | "environment" | "other"; needs: string }
  | { kind: "completed"; ending: "finished" | "done-enough" | "important-work-left";
      revisions: { reviewed: string[]; tested: string[]; merged: string[] } }
  | { kind: "decision"; decisionId: string }  // a pointer; the content lives in decisions.jsonl
);
```

**Every report is a claim, and the types say so.** The projection calls rows `claims`, the page says
*"claimed by work-reports"*, and nothing downstream turns a report into a state: there is no
READY/LANDED/GATED machine, no permission, no queue transition. A `completed` report's revision lists
are what the agent *said*; an empty list renders **"not stated"**, never "not reviewed".

**`actor` is a self-declaration**, exactly as `by` is in the decision record. What makes a session's
report checkable is `execution`: the daemon resolves the name against its live register at receipt.
A report is **stale** when its `submittedAt` is earlier than the register's verified `since` for that
name — it was written by an earlier run of a reused name — and is kept and labelled, never dropped.

**Artefacts are checked, not trusted, and not refused.** A reference to a commit or file that does not
exist is itself informative — it is a discrepancy Greg should see — so the report is kept with that
reference marked `not-found at receipt`. The *shape* is refused (a path with `..`, a control
character, a sha that is not hex). Links are built by us from those validated fields — a GitHub commit
or `blob/dev/<path>` URL, a `#decision-<id>` anchor — never from the summary text, which is rendered
as text.

**Corrections are new events.** `--corrects <eventId>` names what a later report corrects; the fold
never edits the earlier row, it marks it *corrected by <id>, by <actor>, at <time>*. Without an
explicit `corrects`, a later claim from the same session that disagrees (a `progress` after a
`completed`) makes the earlier one show *a later claim from this session disagrees*. Either way both
rows stay, attributed.

### Decisions: extend the one record, and how the two logs reconcile

The roadmap wants decisions in a searchable, bounded log with consequence, reversibility,
product/technical, alternatives, recommendation, author, consulted reviewer, evidence and whether Greg
was asked — ranked by consequence and reversibility, with confidence at most an annotation. The brief
says to extend the existing record rather than add a second one.

**Schema 2 of `decided`** adds, required on every new event:

| field | values | notes |
|---|---|---|
| `author` | `{kind:"overseer"}` \| `{kind:"greg"}` \| `{kind:"session", name, execution}` | who **decided**; `by` stays who **recorded the line** |
| `consequence` | `high` \| `medium` \| `low` | ranks first |
| `reversibility` | `easy` \| `costly` \| `one-way` | ranks second |
| `domain` | `product` \| `technical` | |
| `recommendation` | text or null | what the author recommends if Greg looks again |
| `evidence` | `{ref, check}[]` (the report artefact type) | |
| `gregAsked` | `no` \| `asked-and-answered` \| `asked-awaiting` | |
| `confidence` | `high` \| `medium` \| `low` \| null | annotation only; never sorts |

Alternatives and the consulted reviewer already exist (`options`, `advisers`).

- **Schema 1 lines stay readable and are never migrated.** They fold with `author: overseer` (the V1
  invariant made explicit) and the new fields as *not recorded*. For ranking, *not recorded* counts as
  `high` and `one-way` — unknown must not sort below known-small.
- **An older reader cannot misread a new line**: schema-2 lines fail its `schema === 1` check and
  appear as an unreadable-line problem, which is loud, rather than as an Overseer decision, which would
  be the gate-1 failure.
- **Who writes `decisions.jsonl`**: the `overseer-decisions` CLI for the Overseer and Greg, as today;
  and the daemon's drain for a session's `decision` report. Both go through `appendEvents` under
  `decisions.lock`. This file was never single-writer, and it stays that way.
- **The reconciliation in one line**: a session's decision is *one* `decided` event in
  `decisions.jsonl` (the content, reviewed and reversed there, by Greg only) *and* one `decision`
  report in `reports.jsonl` pointing at it (so that session's timeline of claims is complete). The
  command id `report:<eventId>` joins them, and is what makes the two appends replay-safe.
- Only Greg's `reviewed`/`reversed` count, unchanged. A session's decision is pending review exactly
  as an Overseer one is.

**Ranking**: pending decisions sort by consequence, then reversibility, then newest `decidedAt`. The
server orders; the panel still does not sort.

**Searchable**: `overseer-decisions list --search <text> [--domain] [--consequence] [--author]`, and a
client-side filter box on the tab over the rows the route already bounds.

### Unreported sessions show as unreported

The reports projection joins the register: every session the checkpoint knows gets its latest claim, or
**unreported**. Unreported is not idle, stuck or failed; it means nothing was said.

### The reporting convention reaches agents through proposals, not edits

What I build: the CLI, and `docs/project/work-reports.md` saying when and how to report. What I do
**not** edit, and propose through the Overseer instead:

1. **A paragraph for the Overseer's dispatch briefs** (its runbook is not mine) — controlled jobs first,
   as the roadmap says.
2. **The standing jobs' prompts.** Changing a `what` changes its pinned hash, and re-pinning is Greg's
   by design (`standing-jobs.ts` § AUTHORISED_HASHES). So: proposed wording and the new hash.
3. **Any AGENTS.md rule** is Greg's before/after edit; only proposed wording.

## Simpler options passed over

- **Reports as new kinds in `events.jsonl`.** One log fewer, but it makes original input disposable and
  puts untrusted text on the path whose one bad line cold-starts the register.
- **The CLI appends `reports.jsonl` directly under a lock**, as `overseer-decisions` does. Simpler by a
  drain, and exactly what the roadmap asks us not to do: the daemon owning the file is what lets it
  stamp `receivedAt` and resolve `execution` from the register it holds, rather than trusting the
  submitter for both.
- **A second decision log for agents' decisions.** Refused by the brief, and rightly: two logs are two
  answers to "what was decided".
- **Refusing a report whose artefact is missing.** Loses the claim, which is the thing worth seeing.
- **A new dashboard tab.** Six places in three files and another agent in `App.tsx`; the claims section
  goes inside the Decisions tab instead.

## Stages

Implementation is by Opus subagents (the brief: Codex is the tighter budget). GPT Sol reviews the plan
once and each stage once, `--effort high --timeout-minutes 30`; a second round is announced to the
Overseer first.

### Stage 1 — the reports log, the inbox, the drain and the CLI

- [ ] `tools/overseer/reports.ts`: types, strict parser for submissions and for events, `submitReport`
  (temp + rename), `drainReports` (injected clock, register, artefact checker, decision appender),
  `readReports` with the three arms and an init marker, `foldReports` (duplicates, conflicts,
  corrections, disagreement, stale execution) returning problems rather than throwing.
- [ ] `tools/overseer/report-artefacts.ts`: the real checker — `git cat-file -e` in the daemon's
  checkout with a timeout, `existsSync` under the repo root, decision ids from `readDecisions`, queue
  ids from the queue reader; any failure to look is `unchecked`, never `not-found`.
- [ ] `scripts/overseer.ts`: `report <kind>` and `reports [--session] [--kind] [--search] [--json]`.
  Session name defaults to the tmux session (`tmux display-message -p '#S'`) when `$TMUX` is set, else
  `--session` or `--as overseer|greg` is required.
- [ ] `tools/overseer/daemon.ts`: one optional `reports?: { intervalMs?, drain(register) }`, on its own
  interval, errors contained into a note. Composed in `scripts/overseer.ts run`.
- [ ] Tests red first: duplicate submission (same bytes ⇒ one row; other bytes ⇒ refused), stale
  execution, untrusted artefact text (`..`, control characters, `javascript:`), unknown event kind,
  nonexistent artefact (kept, `not-found`), contradictory later report (kept, attributed correction),
  crash between append and unlink (no second row), a refused submission visible in `reports`.

### Stage 2 — decisions schema 2

- [ ] `decisions.ts`: schema 2 `decided` with the fields above; schema 1 still parsed and folded.
- [ ] `overseer-decisions.ts`: `template` prints schema 2; `add` requires the new fields; `list
  --search/--domain/--consequence/--author`.
- [ ] `decisions-view.ts`: ranking; the author and the new fields on the projection.
- [ ] `wire.ts` `DecisionWireRecord` gains the fields; `decisions-client.ts` parses them;
  `DecisionsPanel.tsx` shows author, consequence, reversibility, domain, evidence links, Greg-asked.
- [ ] Tests: v1 lines still fold; v2 round-trip; ranking with unknowns ranked high; an old-schema
  reader refuses a v2 line loudly.

### Stage 3 — decision reports, the dashboard's claims, and the convention

- [ ] The drain routes a `decision` report into `decisions.jsonl` (command id `report:<eventId>`,
  `author: session`), then the pointer into `reports.jsonl`. Replay tests at each crash point.
- [ ] `tools/fleet/reports-view.ts` (pure projection, joined with the register ⇒ unreported),
  `routes-reports.ts` (`GET /api/reports`, read-only, byte-bounded like decisions), one line in
  `server.ts`, a block appended to `wire.ts`, a client, and a **Claims** section in the Decisions tab
  with a search box.
- [ ] `docs/project/work-reports.md` (signposted from `dev-and-deployment-overview.md`), and the three
  proposals sent to the Overseer.

## Needs Greg (to be confirmed in the debrief)

- The schema-2 decision fields are a stored shape; the enums above are my defaults.
- Wording for the standing-job prompts (re-pin) and any AGENTS.md rule.

## Status

Plan written 2026-09-10; not yet reviewed.
