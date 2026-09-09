/**
 * The one judgement behind both renderings of delegated decisions.
 *
 * This module performs no I/O. The CLI reads `current.json` through the
 * Overseer's store parser; the fleet route reads it through `loadCheckpoint`.
 * Both hand the already-read result here, so the intentional two-reader seam
 * does not become two definitions of fresh, live, pending, or recent.
 *
 * The full raw register is projected rather than the dashboard's capped status
 * register. A name outside that cap is still present, and calling it missing
 * would be a fact invented by presentation code.
 */
import { projectOverseerStatus } from "./overseer-status.js";
import { isExecutionTokenText } from "./execution-token.js";
import type {
  DecisionRecord,
  DecisionView,
  ExecutionRef,
} from "../overseer/decisions.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;

export type RegisterEntryView = {
  readonly name: string;
  readonly verifiedExecution: {
    readonly token: string;
    readonly since: string;
  } | null;
};

export type CheckpointFreshness =
  | { readonly kind: "current" }
  | { readonly kind: "unavailable"; readonly why: string };

/** The three filesystem outcomes shared by both checkpoint readers. */
export type DecisionCheckpointInput =
  | { readonly kind: "json"; readonly json: unknown }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly why: string };

export type DecisionCheckpoint =
  | { readonly kind: "current" }
  | { readonly kind: "unavailable"; readonly why: string };

export type ResolvedDecisionCheckpoint =
  | {
      readonly kind: "current";
      readonly register: readonly RegisterEntryView[];
    }
  | { readonly kind: "unavailable"; readonly why: string };

export type ProjectedSessionState =
  | { readonly kind: "live" }
  | { readonly kind: "ended-or-replaced" }
  | {
      readonly kind: "unavailable";
      readonly why:
        | { readonly kind: "checkpoint-unavailable" }
        | { readonly kind: "execution-unavailable"; readonly detail: string };
    };

export type ProjectedSession = {
  readonly name: string;
  readonly state: ProjectedSessionState;
};

export type ProjectedDecision = {
  readonly record: DecisionRecord;
  readonly ageMs: number;
  readonly pendingReview: boolean;
  readonly sessions: readonly ProjectedSession[];
};

export type DecisionAggregates =
  | {
      readonly kind: "counts";
      readonly notYetReviewed: number;
      readonly trailingSevenDays: {
        readonly decisions: number;
        readonly reviews: number;
        readonly reversals: number;
      };
    }
  | { readonly kind: "unavailable"; readonly why: string };

export type DecisionsProjection = {
  readonly composedAt: string;
  readonly checkpoint: DecisionCheckpoint;
  readonly aggregates: DecisionAggregates;
  readonly records: readonly ProjectedDecision[];
  readonly problems: DecisionView["problems"];
};

/** What the register says about one name, given an already-read checkpoint. */
export function executionRefFor(
  name: string,
  register: readonly RegisterEntryView[],
  freshness: CheckpointFreshness,
): ExecutionRef {
  if (freshness.kind === "unavailable") {
    return { kind: "unavailable", why: freshness.why };
  }
  const matches = register.filter((entry) => entry.name === name);
  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length > 1) {
    return {
      kind: "unavailable",
      why: `session ${name} is ambiguous in the register (${matches.length} entries)`,
    };
  }
  const verified = matches[0]?.verifiedExecution;
  if (verified === null || verified === undefined) {
    return {
      kind: "unavailable",
      why: `the register has no verified execution for session ${name}`,
    };
  }
  return { kind: "verified", token: verified.token, since: verified.since };
}

/** Is the run recorded at decision time still the run the register names? */
export function isStillLive(stored: ExecutionRef, current: ExecutionRef): boolean {
  return stored.kind === "verified" && current.kind === "verified" && stored.token === current.token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function iso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Parse only the register fields this projection owns.
 *
 * `projectOverseerStatus` first applies the existing schema, clock, register,
 * and source-deadline policy — including its private one-hour sanity ceiling.
 * Calling it here reuses that policy without copying the constant. This second
 * pass deliberately keeps the uncapped register and adds verified execution,
 * which the status card itself does not consume.
 */
export function projectDecisionCheckpoint(
  input: DecisionCheckpointInput,
  now: Date = new Date(),
): ResolvedDecisionCheckpoint {
  if (input.kind === "absent") {
    return { kind: "unavailable", why: "the Overseer checkpoint is absent" };
  }
  if (input.kind === "unreadable") {
    return { kind: "unavailable", why: `the Overseer checkpoint is unreadable: ${input.why}` };
  }

  const status = projectOverseerStatus(input.json);
  if (status.kind === "checkpoint-absent") {
    return { kind: "unavailable", why: "the Overseer checkpoint is absent" };
  }
  if (status.kind === "checkpoint-unreadable") {
    return { kind: "unavailable", why: `the Overseer checkpoint is unreadable: ${status.why}` };
  }
  if (status.kind === "unsupported-schema") {
    return {
      kind: "unavailable",
      why: `the Overseer checkpoint uses schema ${status.saw}; this build knows ${status.known}`,
    };
  }
  if (status.kind === "not-asked") {
    return { kind: "unavailable", why: "the Overseer checkpoint was not inspected" };
  }

  const projected = status.status;
  if (projected.lastGoodSnapshotAt === null) {
    return { kind: "unavailable", why: "the Overseer checkpoint has no accepted snapshot" };
  }
  if (projected.sourceStaleAfterMs === null) {
    return {
      kind: "unavailable",
      why: "the Overseer checkpoint has no usable snapshot staleness bound",
    };
  }
  const ageMs = now.getTime() - Date.parse(projected.lastGoodSnapshotAt);
  if (ageMs > projected.sourceStaleAfterMs) {
    return {
      kind: "unavailable",
      why:
        `the Overseer checkpoint is stale (${Math.round(ageMs / 1000)}s old; ` +
        `its bound is ${Math.round(projected.sourceStaleAfterMs / 1000)}s)`,
    };
  }
  if (projected.register.kind === "unreadable") {
    return {
      kind: "unavailable",
      why: `the Overseer checkpoint's register is unreadable: ${projected.register.why}`,
    };
  }

  if (!isRecord(input.json) || !Array.isArray(input.json["register"])) {
    return { kind: "unavailable", why: "the Overseer checkpoint's register is not an array" };
  }
  const register: RegisterEntryView[] = [];
  for (const raw of input.json["register"]) {
    if (!isRecord(raw) || typeof raw["name"] !== "string" || raw["name"].trim() === "") {
      return { kind: "unavailable", why: "an entry in the Overseer checkpoint's register has no readable name" };
    }
    const rawExecution = raw["verifiedExecution"];
    if (rawExecution === undefined || rawExecution === null) {
      register.push({ name: raw["name"], verifiedExecution: null });
      continue;
    }
    if (
      !isRecord(rawExecution) ||
      !isExecutionTokenText(rawExecution["token"]) ||
      !iso(rawExecution["since"]) ||
      Date.parse(rawExecution["since"]) > Date.parse(projected.writtenAt)
    ) {
      return {
        kind: "unavailable",
        why: `the Overseer checkpoint has an unreadable verified execution for session ${raw["name"]}`,
      };
    }
    register.push({
      name: raw["name"],
      verifiedExecution: { token: rawExecution["token"], since: rawExecution["since"] },
    });
  }
  return { kind: "current", register };
}

/** Supersession replaces a pending row rather than silently reviewing it. */
export function isPendingReview(record: DecisionRecord): boolean {
  return !record.reviewed && record.supersededBy === null;
}

function sessionState(
  stored: ExecutionRef,
  current: ExecutionRef,
  checkpoint: ResolvedDecisionCheckpoint,
): ProjectedSessionState {
  if (checkpoint.kind === "unavailable") {
    return { kind: "unavailable", why: { kind: "checkpoint-unavailable" } };
  }
  if (stored.kind === "unavailable") {
    return {
      kind: "unavailable",
      why: { kind: "execution-unavailable", detail: stored.why },
    };
  }
  if (current.kind === "unavailable") {
    return {
      kind: "unavailable",
      why: { kind: "execution-unavailable", detail: current.why },
    };
  }
  return isStillLive(stored, current) ? { kind: "live" } : { kind: "ended-or-replaced" };
}

function withinTrailingSevenDays(at: string | null, nowMs: number): boolean {
  if (at === null) return false;
  const time = Date.parse(at);
  return time >= nowMs - SEVEN_DAYS_MS && time <= nowMs;
}

function aggregates(view: DecisionView, nowMs: number): DecisionAggregates {
  if (view.problems.length > 0) {
    const noun = view.problems.length === 1 ? "problem" : "problems";
    return {
      kind: "unavailable",
      why:
        `the decision record has ${view.problems.length} ${noun}; ` +
        "a line could have hidden a decision, review, or reversal",
    };
  }
  return {
    kind: "counts",
    notYetReviewed: view.records.filter(isPendingReview).length,
    trailingSevenDays: {
      decisions: view.records.filter((record) => withinTrailingSevenDays(record.decidedAt, nowMs)).length,
      reviews: view.records.flatMap((record) => record.touches).filter(
        (touch) => touch.kind === "reviewed" && withinTrailingSevenDays(touch.at, nowMs),
      ).length,
      reversals: view.records.flatMap((record) => record.touches).filter(
        (touch) => touch.kind === "reversed" && withinTrailingSevenDays(touch.at, nowMs),
      ).length,
    },
  };
}

/** Project a folded record and one already-read checkpoint into renderable data. */
export function projectDecisions(
  view: DecisionView,
  checkpointInput: DecisionCheckpointInput,
  now: Date = new Date(),
): DecisionsProjection {
  const resolvedCheckpoint = projectDecisionCheckpoint(checkpointInput, now);
  const freshness: CheckpointFreshness =
    resolvedCheckpoint.kind === "current"
      ? { kind: "current" }
      : { kind: "unavailable", why: resolvedCheckpoint.why };
  const register = resolvedCheckpoint.kind === "current" ? resolvedCheckpoint.register : [];
  const nowMs = now.getTime();
  const records = view.records
    .map((record): ProjectedDecision => ({
      record,
      ageMs: Math.max(0, nowMs - Date.parse(record.decidedAt)),
      pendingReview: isPendingReview(record),
      sessions: record.bearsOn.sessions.map((session): ProjectedSession => {
        const current = executionRefFor(session.name, register, freshness);
        return {
          name: session.name,
          state: sessionState(session.execution, current, resolvedCheckpoint),
        };
      }),
    }))
    .sort((a, b) => {
      if (a.pendingReview !== b.pendingReview) return a.pendingReview ? -1 : 1;
      return Date.parse(b.record.decidedAt) - Date.parse(a.record.decidedAt);
    });

  return {
    composedAt: now.toISOString(),
    checkpoint:
      resolvedCheckpoint.kind === "current"
        ? { kind: "current" }
        : { kind: "unavailable", why: resolvedCheckpoint.why },
    aggregates: aggregates(view, nowMs),
    records,
    problems: view.problems,
  };
}
