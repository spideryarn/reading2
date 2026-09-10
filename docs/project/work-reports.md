# Work reports: what an agent claimed

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md).

A work report is one line an agent (or the Overseer, or Greg) puts on the record: *I made progress*,
*I am blocked*, *I decided this*, *I finished*. The daemon records it, stamps when it arrived, checks the
artefacts it names, and compares the reporter's Claude run with the one the register knows. Greg reads
them in the **Claims** section of the fleet dashboard's Decisions tab, or with `overseer reports`.

The point is to see what an agent **claimed**, and which decisions were made, with links to the real
artefacts, without a model reading every transcript and without a report ever granting anything. The
design and its reviews are in plan
[260910e](../plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md). How the convention
is meant to reach agents, which is not yet switched on, is in
[the proposals](../plans/260910e-work-reports-convention-proposals.md).

## A report is a claim

Never a state, and never a permission. Nothing reads a report and moves a queue item, marks work
landed, unblocks a gate or reviews a decision. On the page every row says *claimed by …*. A later claim
is only a later claim: a `progress` after a `completed` may be work picked back up, and nothing infers a
disagreement from the two kinds. A claim is changed only by an explicit correction (`--corrects`), which
leaves the earlier row as it was and marks it *corrected by …*.

A `completed` report's revision lists are what the agent **said** it reviewed, tested and merged. An
empty list reads **"not stated"**, never "not reviewed".

## The four kinds, and when to use each

- **`progress`**: a stage finished, a milestone reached. Name what you produced with `--artefact`.
- **`blocked`**: you are waiting on somebody or something. `--on` says who or what (`greg`, `peer`,
  `review`, `environment`, `other`), and `--needs` says what would unblock you.
- **`completed`**: the work is over. `--ending` is one of `finished`, `done-enough` or
  `important-work-left`. Name only the revisions you actually reviewed, tested or merged. Leave the
  others out; that reads as "not stated", not as a failure.
- **`decision`**: a decision you took that outlives your branch. `--file` takes what
  `npx tsx scripts/overseer-decisions.ts template` prints, filled in; it has no `author`, because the
  daemon stamps your session with the run the register has verified for it. The template's `evidence`
  list is moved into the report's artefacts beside any `--artefact`, so each reference is checked once
  and the decision and the report agree about it. On the daemon's next pass it becomes **one entry in
  the decision record** (`$OVERSEER_DECISIONS_DIR`, or `~/.overseer`), recorded `by: daemon` with
  command id `report:<eventId>`, and **one `decision` report** carrying only that decision's id. It
  arrives pending review like every other decision: nothing a session says reviews it. If the decision
  record is busy it waits for the next pass; if the record refuses it, the report is refused with the
  record's reason. Only a session reports a decision this way — `--as overseer` and `--as greg` are
  refused, and the Overseer and Greg keep using `overseer-decisions add`.

## The commands

From `npx tsx scripts/overseer.ts --help`:

```
npx tsx scripts/overseer.ts report progress --summary <text> [--artefact <spec>] [--plan <path>] [--queue-item <id>] [--corrects <eventId>] [--session <name>] [--as <who>]
npx tsx scripts/overseer.ts report blocked --summary <text> [--artefact <spec>] [--plan <path>] [--queue-item <id>] [--corrects <eventId>] [--session <name>] [--as <who>] --on <what> --needs <text>
npx tsx scripts/overseer.ts report completed --summary <text> [--artefact <spec>] [--plan <path>] [--queue-item <id>] [--corrects <eventId>] [--session <name>] [--as <who>] --ending <ending> [--reviewed <sha>] [--tested <sha>] [--merged <sha>]
npx tsx scripts/overseer.ts report decision --summary <text> [--artefact <spec>] [--plan <path>] [--queue-item <id>] [--corrects <eventId>] [--session <name>] [--as <who>] --file <json|->
npx tsx scripts/overseer.ts reports [--session <name>] [--kind <kind>] [--search <text>] [--event <id>] [--json]
```

- `--artefact` is `commit:<sha>`, `path:<repo-relative path>`, `decision:<dec-id>` or `queue:<qi-id>`,
  and may be repeated. `--reviewed`, `--tested` and `--merged` may be repeated too.
- The reporter defaults to the tmux session the command runs in. Outside tmux, say who with
  `--session <name>`, or `--as overseer` / `--as greg`; giving both `--session` and `--as` is refused.
- The summary is one line of at most 1000 characters; `--needs` at most 500. Control characters and
  bidirectional overrides are refused anywhere, not stripped.

## What happens after you submit

The command validates the report with the same parser the daemon uses, writes it into
`report-inbox/` in the Overseer's store (`$OVERSEER_STORE_DIR`, or `~/.overseer`), and prints its id and
**"submitted, not yet recorded"**. It is not on the record yet.

The daemon (`npx tsx scripts/overseer.ts run`) drains that inbox every 30 seconds: it checks the
artefacts, compares the run, stamps `receivedAt`, and appends the report to `reports.jsonl`. **The
daemon must be running a build that includes the drain.** An older daemon leaves submissions sitting in
the inbox, and the Claims section then shows them as *submitted, not yet recorded* beside an empty log.
`overseer reports --event <id>` says where one report has got to.

Invalid input is **refused**: a reason is written to `report-refused/`, and `overseer reports` lists it.
A failure that says nothing about the input, such as a checker that could not run, leaves the report
**pending** for the next pass. The details, including what a pass is bounded by and how a crash
mid-pass is replayed, are in `tools/overseer/reports.ts` § `drainReports`.

An inbox entry that can never become a report — a stray name, a directory, a symlink, a hard-linked
file — is moved, unread, into `report-quarantine/`. **The quarantine is never emptied
automatically:** the daemon only ever moves things into it, and never lists or deletes them. It grows
until somebody looks at it and then deletes it. The Claims section says how many entries it holds
and how old the oldest is, and `overseer reports` says the same and prints its path. On a flooded
inbox, every count reads *at least*, because each directory is read only to its first 1 000 entries.

What the daemon adds, once, at receipt:

- **The run.** The reporter's own Claude run token, compared with the register's verified run for that
  name: *same run as the register's*, *a different run from the register's* (a reused name, or a
  register still holding an older run), or *could not verify* with the reason. Absence is never read
  as a match.
- **The artefacts.** Each is checked, not trusted, and a missing one is kept: *on dev*, *found on the
  box, not on dev*, *found* (a decision or queue item), *not found at receipt*, or *not checked* with
  why. Only an *on dev* commit or path, or a found decision, becomes a link.

## Where Greg reads them

- **The Claims section**, below the decisions on the dashboard's Decisions tab. Sessions come first:
  every session in the Overseer's register with its latest claim, or **"unreported — nothing said"**,
  which is not idle, stuck or failed. A session that reported but is not in the register is listed
  and marked so. If the register cannot be read, the section says so, and nobody is called
  unreported. Then recent claims, newest first, with who claimed each, the run comparison, artefacts,
  revision lists and corrections. The Decisions tab's search box filters these claims too.
- **`npx tsx scripts/overseer.ts reports`**: recorded claims, then what is in flight, then what was
  refused and why. `--session`, `--kind`, `--search`, `--event` and `--json` narrow it.

## What it deliberately does not do

- **Grant anything.** A report never approves, unblocks, reviews, re-queues or re-pins. Only Greg's own
  `reviewed` event in the decision record reviews a decision.
- **Infer state.** No done, ready or landed status, and no "contradicts" from two kinds in a row.
- **Read transcripts.** Nothing here runs a model over what a session said. A session that never reports
  is shown as unreported, which is honest, not an error.

## The limits

- **`actor` is a self-declaration.** `--session work-reports` is not proof. The run comparison is the
  evidence, and it can only say *same*, *different* or *could not verify*.
- **Nothing defends against a process running as the same Unix user.** It could write `reports.jsonl`
  directly. This is the same governance-not-OS-boundary line the decision record draws for `by`.

## Where the code is

`tools/overseer/reports.ts` (the parser, the inbox, the drain, the fold), `scripts/overseer.ts` (the
commands, and the daemon's wiring), `tools/fleet/reports-view.ts` (the projection joined with the
register), `tools/fleet/routes-reports.ts` (`GET /api/reports`, read-only), and
`tools/fleet/web/src/DecisionsPanel.tsx` (the Claims section).
