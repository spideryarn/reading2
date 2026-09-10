/**
 * **WHAT AGENTS CLAIMED, JOINED WITH WHO THE REGISTER KNOWS** — the one
 * judgement behind the Claims section. Plan 260910e, Stage 3a.
 *
 * Pure: no I/O and no clock of its own. The route reads `reports.jsonl`, the
 * inbox and the checkpoint, and hands the already-read results here.
 *
 * ## Every row is a claim, and the types say so
 *
 * A row names who `claimedBy` it and what was said. Nothing here derives a
 * state from a report — no done, ready, landed, stuck or contradicts — and a
 * later claim is only a later claim (GPT Sol's WR-P9): `laterClaim` points at
 * it and infers nothing from the two kinds. A correction is shown only where a
 * report said `corrects`, which the fold already attributed.
 *
 * ## Unreported is not idle, and not "the register is unreadable"
 *
 * Every session in the checkpoint's register — the full raw register, as
 * `decisions-view.ts` resolves it, not the dashboard's capped list — gets its
 * latest claim or `unreported`, which means only that nothing was said. When
 * the checkpoint cannot be used, the sessions take a different SHAPE rather
 * than an empty register: otherwise "nobody has reported" and "we could not
 * tell who exists" would render alike.
 */
import {
  addCounts,
  type BoundedCount,
  type ExecutionComparison,
  type InboxListing,
  type ReportActor,
  type ReportClaim,
  type ReportCorrection,
  type ReportJob,
  type ReportProblem,
  type ReportRow,
  type ReportsView,
} from "../overseer/reports.js";
import type { CheckedArtefact } from "./artefact-ref.js";
import { projectDecisionCheckpoint, type DecisionCheckpointInput } from "./decisions-view.js";

/** How many claims the page gets, newest first; the rest are counted, never silently dropped. */
export const RECENT_CLAIMS_LIMIT = 200;

export type ProjectedClaim = {
  readonly eventId: string;
  readonly claimedBy: ReportActor;
  readonly submittedAt: string;
  readonly receivedAt: string;
  readonly execution: ExecutionComparison;
  readonly job: ReportJob;
  readonly summary: string;
  readonly artefacts: readonly CheckedArtefact[];
  readonly corrects: string | null;
  readonly correctedBy: ReportCorrection | null;
  /** The next claim by the same reporter, or null. Never read as a disagreement. */
  readonly laterClaim: string | null;
} & (ReportClaim | { readonly kind: "decision"; readonly decisionId: string });

export type ProjectedClaimed = { readonly kind: "claimed"; readonly claims: number; readonly latest: ProjectedClaim };

export type ProjectedSessionClaims =
  | {
      readonly name: string;
      readonly register: "in-register";
      readonly latest: { readonly kind: "unreported" } | ProjectedClaimed;
    }
  /** Listed only because it said something: a reused name, or a session the register has let go. */
  | { readonly name: string; readonly register: "not-in-register"; readonly latest: ProjectedClaimed };

export type ProjectedSessions =
  | { readonly kind: "joined-with-register"; readonly rows: readonly ProjectedSessionClaims[] }
  | {
      readonly kind: "register-unavailable";
      readonly why: string;
      /** Sessions that reported. Who has NOT reported cannot be told without the register. */
      readonly reported: readonly { readonly name: string; readonly latest: ProjectedClaimed }[];
    };

/**
 * What the inbox reader counted, as the page gets it. Each count is the
 * reader's own, `atLeast` when a directory was read only to its cap — never the
 * length of the list it parsed, which is shorter by design.
 */
export type InboxCounts = {
  /** Submitted and not yet recorded: inbox files plus prepared reports mid-flight. */
  readonly inFlight: BoundedCount;
  readonly refused: BoundedCount;
  /** How big the never-emptied quarantine has grown. Its path stays on the server. */
  readonly quarantine: { readonly count: BoundedCount; readonly oldestMovedAt: string | null };
};

export function inboxCounts(inbox: InboxListing): InboxCounts {
  return {
    inFlight: addCounts(inbox.inFlight.count, inbox.processing.count),
    refused: inbox.refused.count,
    quarantine: { count: inbox.quarantine.count, oldestMovedAt: inbox.quarantine.oldestMovedAt },
  };
}

export type ReportsProjection = InboxCounts & {
  readonly composedAt: string;
  readonly sessions: ProjectedSessions;
  /** Newest first, at most `RECENT_CLAIMS_LIMIT`. */
  readonly recent: readonly ProjectedClaim[];
  readonly recentWithheld: number;
  readonly problems: readonly ReportProblem[];
};

function actorKey(actor: ReportActor): string {
  return actor.kind === "session" ? `session:${actor.name}` : actor.kind;
}

/** The fields a reader needs, listed rather than spread, so nothing the daemon stamps for itself leaks through. */
function claimOf(row: ReportRow, laterClaim: string | null): ProjectedClaim {
  const e = row.event;
  const head = {
    eventId: e.eventId,
    claimedBy: e.actor,
    submittedAt: e.submittedAt,
    receivedAt: e.receivedAt,
    execution: e.execution,
    job: e.job,
    summary: e.summary,
    artefacts: e.artefacts,
    corrects: e.corrects,
    correctedBy: row.correctedBy,
    laterClaim,
  };
  switch (e.kind) {
    case "progress":
      return { ...head, kind: e.kind };
    case "blocked":
      return { ...head, kind: e.kind, on: e.on, needs: e.needs };
    case "completed":
      return { ...head, kind: e.kind, ending: e.ending, revisions: e.revisions };
    case "decision":
      return { ...head, kind: e.kind, decisionId: e.decisionId };
    default: {
      const never: never = e;
      throw new Error(`unhandled report kind ${JSON.stringify(never)}`);
    }
  }
}

export function projectReports(
  view: ReportsView,
  inbox: InboxListing,
  checkpoint: DecisionCheckpointInput,
  now: Date,
): ReportsProjection {
  /* The log's order is the order the daemon received them in: it is the only
     writer. So "latest" and "later" are positions, not timestamps a submitter
     chose. */
  const rows = view.rows;
  const laterByEvent = new Map<string, string | null>();
  const nextByActor = new Map<string, string>();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const event = rows[index]?.event;
    if (event === undefined) continue;
    const key = actorKey(event.actor);
    laterByEvent.set(event.eventId, nextByActor.get(key) ?? null);
    nextByActor.set(key, event.eventId);
  }
  const claims = rows.map((row) => claimOf(row, laterByEvent.get(row.event.eventId) ?? null));

  const bySession = new Map<string, { claims: number; latest: ProjectedClaim; position: number }>();
  claims.forEach((claim, position) => {
    if (claim.claimedBy.kind !== "session") return;
    const seen = bySession.get(claim.claimedBy.name);
    bySession.set(claim.claimedBy.name, { claims: (seen?.claims ?? 0) + 1, latest: claim, position });
  });
  const claimedOf = (name: string): ProjectedClaimed | null => {
    const seen = bySession.get(name);
    return seen === undefined ? null : { kind: "claimed", claims: seen.claims, latest: seen.latest };
  };
  /** Sessions with claims, newest latest-claim first. */
  const reportedNewestFirst = (keep: (name: string) => boolean): { name: string; latest: ProjectedClaimed }[] =>
    [...bySession.entries()]
      .filter(([name]) => keep(name))
      .sort((a, b) => b[1].position - a[1].position)
      .map(([name, seen]) => ({ name, latest: { kind: "claimed", claims: seen.claims, latest: seen.latest } }));

  const resolved = projectDecisionCheckpoint(checkpoint, now);
  let sessions: ProjectedSessions;
  if (resolved.kind === "current") {
    // A name twice in the register is one row here: this join is by name, as a report's actor is.
    const names = [...new Set(resolved.register.map((entry) => entry.name))];
    const inRegister = new Set(names);
    sessions = {
      kind: "joined-with-register",
      rows: [
        ...names.map((name): ProjectedSessionClaims => ({
          name,
          register: "in-register",
          latest: claimedOf(name) ?? { kind: "unreported" },
        })),
        ...reportedNewestFirst((name) => !inRegister.has(name)).map(
          (row): ProjectedSessionClaims => ({ name: row.name, register: "not-in-register", latest: row.latest }),
        ),
      ],
    };
  } else {
    sessions = { kind: "register-unavailable", why: resolved.why, reported: reportedNewestFirst(() => true) };
  }

  const newestFirst = [...claims].reverse();
  const recent = newestFirst.slice(0, RECENT_CLAIMS_LIMIT);
  return {
    composedAt: now.toISOString(),
    sessions,
    recent,
    recentWithheld: newestFirst.length - recent.length,
    ...inboxCounts(inbox),
    problems: view.problems,
  };
}
