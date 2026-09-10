/**
 * One projection for both the Decisions page and the terminal.
 *
 * These tests keep absence as data, not a plausible zero, and exercise the
 * execution-token join that prevents a reused session name looking live.
 */
import { describe, expect, test } from "vitest";

import {
  executionRefFor,
  isSameRunAsLastVerified,
  projectDecisions,
  type DecisionCheckpointInput,
  type RegisterEntryView,
} from "../tools/fleet/decisions-view.js";
import {
  DECISIONS_SCHEMA,
  type DecisionProblem,
  type DecisionRecord,
  type DecisionView,
  type ExecutionRef,
} from "../tools/overseer/decisions.js";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const TOKEN_A = "boot-a:42001:711";
const TOKEN_B = "boot-b:42002:712";

function record(
  id: string,
  decidedAt: string,
  over: Partial<DecisionRecord> = {},
): DecisionRecord {
  return {
    id,
    recordedBy: "overseer",
    class: "decision",
    question: `Question for ${id}?`,
    options: [
      { name: "Stop", tradeoffs: "Leaves the work for later." },
      { name: "Continue", tradeoffs: "Uses capacity now." },
    ],
    chose: { option: "Continue", note: null },
    why: "The work is already specified.",
    advisers: ["nobody"],
    bearsOn: { sessions: [], plan: null },
    decidedAt,
    supersedes: null,
    supersededBy: null,
    reviewed: false,
    reviewedAt: null,
    reviewNote: null,
    reversed: false,
    reversedAt: null,
    reversedWhy: null,
    touches: [],
    author: { kind: "legacy-unrecorded" },
    consequence: "not-recorded",
    reversibility: "not-recorded",
    domain: "not-recorded",
    recommendation: { kind: "not-recorded" },
    evidence: { kind: "not-recorded" },
    gregAsked: "not-recorded",
    confidence: "not-recorded",
    ...over,
  };
}

function view(records: readonly DecisionRecord[], problems: readonly DecisionProblem[] = []): DecisionView {
  return {
    schema: DECISIONS_SCHEMA,
    records,
    problems,
    version: { events: records.length, lastEventId: records.length === 0 ? null : "event-tail" },
  };
}

function entry(name: string, token: string | null): RegisterEntryView {
  return {
    name,
    verifiedExecution:
      token === null ? null : { token, since: "2026-09-09T10:00:00.000Z" },
  };
}

function checkpoint(
  register: readonly RegisterEntryView[] = [],
  over: Record<string, unknown> = {},
): DecisionCheckpointInput {
  const writtenAt = "2026-09-09T11:59:30.000Z";
  return {
    kind: "json",
    json: {
      schema: 2,
      writtenAt,
      lastGoodSnapshotAt: writtenAt,
      snapshotStaleAfterMs: 300_000,
      heartbeat: {
        pid: 41000,
        instanceId: "instance-decisions-test",
        startedAt: "2026-09-09T10:00:00.000Z",
        lastTickAt: writtenAt,
        ticks: 12,
      },
      scheduler: { kind: "unknown", why: "not configured", at: writtenAt },
      register: register.map((item, index) => ({
        /* `key` IS NOT DECORATION HERE. A real `RegisterEntry` has always carried
           one — checked against the live `~/.overseer/current.json` on 2026-09-10,
           where all 19 entries had it — and since work evidence landed it is the
           join the projection uses to hang a pane's work reading on an entry. An
           entry without one cannot be joined, so the projection refuses it, and
           these fixtures omitted it until that refusal made them fail. */
        key: `$${index + 1} claims:conversation-${index + 1}`,
        name: item.name,
        tmuxId: `$${index + 1}`,
        lastStatusKey: "working",
        statusSince: { kind: "observed", at: "2026-09-09T11:00:00.000Z" },
        verifiedExecution: item.verifiedExecution,
      })),
      ...over,
    },
  };
}

describe("execution identity", () => {
  test("the same verified token identifies only the same run as the last verification", () => {
    const stored: ExecutionRef = {
      kind: "verified",
      token: TOKEN_A,
      since: "2026-09-09T09:00:00.000Z",
    };
    const projected = projectDecisions(
      view([
        record("dec-aaaaaaa2", "2026-09-09T10:00:00.000Z", {
          bearsOn: { sessions: [{ name: "same-run", execution: stored }], plan: null },
        }),
      ]),
      checkpoint([entry("same-run", TOKEN_A)]),
      NOW,
    );
    expect(isSameRunAsLastVerified(stored, { ...stored, since: "2026-09-09T10:00:00.000Z" })).toBe(true);
    expect(projected.records[0]?.sessions[0]?.state).toEqual({
      kind: "same-run-as-last-verified",
      since: "2026-09-09T10:00:00.000Z",
    });
  });

  test("a changed token is ended-or-replaced, never the same run by name alone", () => {
    const stored: ExecutionRef = {
      kind: "verified",
      token: TOKEN_A,
      since: "2026-09-09T09:00:00.000Z",
    };
    const current: ExecutionRef = {
      kind: "verified",
      token: TOKEN_B,
      since: "2026-09-09T11:00:00.000Z",
    };
    expect(isSameRunAsLastVerified(stored, current)).toBe(false);

    const projected = projectDecisions(
      view([
        record("dec-aaaaaaa2", "2026-09-09T09:00:00.000Z", {
          bearsOn: { sessions: [{ name: "reused", execution: stored }], plan: null },
        }),
      ]),
      checkpoint([entry("reused", TOKEN_B)]),
      NOW,
    );
    expect(projected.records[0]?.sessions).toEqual([
      expect.objectContaining({ name: "reused", state: { kind: "ended-or-replaced" } }),
    ]);
  });

  test("not-found and unavailable stay distinct and neither can identify the same run", () => {
    const current = [entry("no-token", null)];
    expect(executionRefFor("missing", current, { kind: "current" })).toEqual({ kind: "not-found" });
    expect(executionRefFor("no-token", current, { kind: "current" })).toEqual({
      kind: "unavailable",
      why: "the register has no verified execution for session no-token",
    });
    expect(
      executionRefFor("missing", current, {
        kind: "unavailable",
        why: "the checkpoint is unreadable",
      }),
    ).toEqual({ kind: "unavailable", why: "the checkpoint is unreadable" });
    expect(isSameRunAsLastVerified({ kind: "not-found" }, { kind: "not-found" })).toBe(false);
    expect(
      isSameRunAsLastVerified(
        { kind: "unavailable", why: "could not look then" },
        { kind: "unavailable", why: "could not look now" },
      ),
    ).toBe(false);
  });

  test("an unreadable checkpoint makes every session unavailable and names the cause once at the top", () => {
    const projected = projectDecisions(
      view([
        record("dec-aaaaaaa2", "2026-09-09T10:00:00.000Z", {
          bearsOn: {
            sessions: [
              { name: "first", execution: { kind: "verified", token: TOKEN_A, since: "2026-09-09T09:00:00.000Z" } },
              { name: "second", execution: { kind: "not-found" } },
            ],
            plan: null,
          },
        }),
      ]),
      { kind: "unreadable", why: "current.json is not JSON" },
      NOW,
    );
    expect(projected.checkpoint).toEqual({
      kind: "unavailable",
      why: "the Overseer checkpoint is unreadable: current.json is not JSON",
    });
    expect(projected.records[0]?.sessions.map((session) => session.state)).toEqual([
      { kind: "unavailable", why: { kind: "checkpoint-unavailable" } },
      { kind: "unavailable", why: { kind: "checkpoint-unavailable" } },
    ]);
    expect(JSON.stringify(projected).match(/current\.json is not JSON/g)).toHaveLength(1);
  });

  test("an absent checkpoint is its own top-level arm", () => {
    const projected = projectDecisions(
      view([
        record("dec-aaaaaaa2", "2026-09-09T10:00:00.000Z", {
          bearsOn: {
            sessions: [{ name: "gone", execution: { kind: "not-found" } }],
            plan: null,
          },
        }),
      ]),
      { kind: "absent" },
      NOW,
    );
    expect(projected.checkpoint).toEqual({
      kind: "unavailable",
      why: "the Overseer checkpoint is absent",
    });
    expect(projected.records[0]?.sessions[0]?.state).toEqual({
      kind: "unavailable",
      why: { kind: "checkpoint-unavailable" },
    });
  });

  test("a checkpoint beyond its own staleness bound is unavailable, not current", () => {
    const stored: ExecutionRef = { kind: "verified", token: TOKEN_A, since: "2026-09-09T09:00:00.000Z" };
    const projected = projectDecisions(
      view([
        record("dec-aaaaaaa2", "2026-09-09T10:00:00.000Z", {
          bearsOn: { sessions: [{ name: "stale-name", execution: stored }], plan: null },
        }),
      ]),
      checkpoint([entry("stale-name", TOKEN_A)], {
        lastGoodSnapshotAt: "2026-09-09T11:54:59.999Z",
        snapshotStaleAfterMs: 300_000,
      }),
      NOW,
    );
    expect(projected.checkpoint).toEqual(expect.objectContaining({ kind: "unavailable", why: expect.stringMatching(/stale/i) }));
    expect(projected.records[0]?.sessions[0]?.state).toEqual({
      kind: "unavailable",
      why: { kind: "checkpoint-unavailable" },
    });
  });

  test("a checkpoint more than two seconds in the future is unavailable and names its clock", () => {
    const future = "2026-09-09T12:00:02.001Z";
    const projected = projectDecisions(
      view([record("dec-aaaaaaa2", "2026-09-09T10:00:00.000Z")]),
      checkpoint([], { writtenAt: future, lastGoodSnapshotAt: future }),
      NOW,
    );
    expect(projected.checkpoint).toEqual({
      kind: "unavailable",
      why: "the Overseer checkpoint was written 2s in the future; its clock is ahead of this server",
    });
  });

  test("a future writtenAt is a clock error even when the snapshot instant looks current", () => {
    /* The gap the first version of this left: it checked `lastGoodSnapshotAt`
       alone, so a checkpoint written a day ahead whose snapshot read `now` was
       accepted as current — and it is the future `writtenAt` that would then
       authorise future-dated `verifiedExecution.since` values inside it. GPT
       Sol reproduced this exact fixture against the first fix. */
    const projected = projectDecisions(
      view([record("dec-aaaaaaa3", "2026-09-09T10:00:00.000Z")]),
      checkpoint([], { writtenAt: "2026-09-10T12:00:00.000Z", lastGoodSnapshotAt: "2026-09-09T12:00:00.000Z" }),
      NOW,
    );
    expect(projected.checkpoint).toEqual(
      expect.objectContaining({ kind: "unavailable", why: expect.stringMatching(/written .* in the future/) }),
    );
  });

  test("tolerates up to two seconds of checkpoint clock skew", () => {
    const future = "2026-09-09T12:00:02.000Z";
    const projected = projectDecisions(
      view([record("dec-aaaaaaa2", "2026-09-09T10:00:00.000Z")]),
      checkpoint([], { writtenAt: future, lastGoodSnapshotAt: future }),
      NOW,
    );
    expect(projected.checkpoint).toEqual({ kind: "current" });
  });

  test("a malformed current execution makes the checkpoint unavailable rather than claiming replacement", () => {
    const projected = projectDecisions(
      view([
        record("dec-aaaaaaa2", "2026-09-09T10:00:00.000Z", {
          bearsOn: {
            sessions: [
              {
                name: "broken-token",
                execution: { kind: "verified", token: TOKEN_A, since: "2026-09-09T09:00:00.000Z" },
              },
            ],
            plan: null,
          },
        }),
      ]),
      checkpoint([entry("broken-token", "not-an-execution-token")]),
      NOW,
    );
    expect(projected.checkpoint).toEqual(
      expect.objectContaining({ kind: "unavailable", why: expect.stringMatching(/unreadable verified execution/i) }),
    );
    expect(projected.records[0]?.sessions[0]?.state).toEqual({
      kind: "unavailable",
      why: { kind: "checkpoint-unavailable" },
    });
  });
});

describe("records and aggregates", () => {
  test("one record problem suppresses the headline and every seven-day count", () => {
    const projected = projectDecisions(
      view(
        [record("dec-aaaaaaa2", "2026-09-09T10:00:00.000Z")],
        [{ kind: "unreadable-line", why: "line 2 is unreadable", eventId: null }],
      ),
      checkpoint(),
      NOW,
    );
    expect(projected.aggregates).toEqual({
      kind: "unavailable",
      why: "the decision record has 1 problem; a line could have hidden a decision, review, or reversal",
    });
    expect(projected.aggregates).not.toHaveProperty("notYetReviewed");
    expect(projected.aggregates).not.toHaveProperty("trailingSevenDays");
  });

  test("sorts pending records first, newest first within pending and reviewed groups", () => {
    const projected = projectDecisions(
      view([
        record("dec-reviewed-old", "2026-09-09T08:00:00.000Z", {
          reviewed: true,
          reviewedAt: "2026-09-09T08:30:00.000Z",
        }),
        record("dec-pending-old", "2026-09-08T08:00:00.000Z"),
        record("dec-reversed-new", "2026-09-09T11:00:00.000Z", {
          reviewed: true,
          reviewedAt: "2026-09-09T11:30:00.000Z",
          reversed: true,
          reversedAt: "2026-09-09T11:30:00.000Z",
        }),
        record("dec-pending-new", "2026-09-09T09:00:00.000Z"),
        record("dec-reviewed-new", "2026-09-09T10:00:00.000Z", {
          reviewed: true,
          reviewedAt: "2026-09-09T10:30:00.000Z",
        }),
      ]),
      checkpoint(),
      NOW,
    );
    expect(projected.records.map((item) => item.record.id)).toEqual([
      "dec-pending-new",
      "dec-pending-old",
      "dec-reversed-new",
      "dec-reviewed-new",
      "dec-reviewed-old",
    ]);
    expect(projected.records.find((item) => item.record.id === "dec-reversed-new")?.pendingReview).toBe(false);
  });

  test("ranks pending by consequence, then reversibility, with not-recorded as its own bucket", () => {
    /* WR-P8: unknown is shown as unknown, never promoted to `high`. It sorts
       after a known high and before a known medium, so a V1 row cannot outrank
       a decision somebody said was high-consequence. */
    const known = (id: string, decidedAt: string, consequence: "high" | "medium" | "low", reversibility: "easy" | "costly" | "one-way") =>
      record(id, decidedAt, { author: { kind: "overseer" }, consequence, reversibility });
    const projected = projectDecisions(
      view([
        record("dec-legacy-newest", "2026-09-09T11:50:00.000Z"),
        known("dec-medium-oneway", "2026-09-09T11:40:00.000Z", "medium", "one-way"),
        known("dec-high-easy-old", "2026-09-09T08:00:00.000Z", "high", "easy"),
        known("dec-high-oneway-old", "2026-09-09T07:00:00.000Z", "high", "one-way"),
        known("dec-low-oneway", "2026-09-09T11:55:00.000Z", "low", "one-way"),
        record("dec-legacy-costly", "2026-09-09T11:59:00.000Z", { consequence: "medium", reversibility: "not-recorded" }),
        known("dec-medium-costly", "2026-09-09T11:58:00.000Z", "medium", "costly"),
        known("dec-reviewed-high", "2026-09-09T11:59:30.000Z", "high", "one-way"),
      ].map((item) =>
        item.id === "dec-reviewed-high" ? { ...item, reviewed: true, reviewedAt: "2026-09-09T11:59:40.000Z" } : item,
      )),
      checkpoint(),
      NOW,
    );
    expect(projected.records.map((item) => item.record.id)).toEqual([
      "dec-high-oneway-old",
      "dec-high-easy-old",
      "dec-legacy-newest",
      "dec-medium-oneway",
      "dec-legacy-costly",
      "dec-medium-costly",
      "dec-low-oneway",
      // The rest keep their existing order: not pending, so consequence does not move them.
      "dec-reviewed-high",
    ]);
  });

  test("confidence never affects the order", () => {
    const ids = (first: "high" | "low" | null, second: "high" | "low" | null) =>
      projectDecisions(
        view([
          record("dec-older-pending", "2026-09-09T09:00:00.000Z", { consequence: "medium", reversibility: "easy", confidence: first }),
          record("dec-newer-pending", "2026-09-09T10:00:00.000Z", { consequence: "medium", reversibility: "easy", confidence: second }),
        ]),
        checkpoint(),
        NOW,
      ).records.map((item) => item.record.id);
    expect(ids("high", "low")).toEqual(["dec-newer-pending", "dec-older-pending"]);
    expect(ids("low", "high")).toEqual(["dec-newer-pending", "dec-older-pending"]);
    expect(ids(null, "high")).toEqual(["dec-newer-pending", "dec-older-pending"]);
  });

  test("uses decidedAt for age and a trailing, bounded seven-day window for each event kind", () => {
    const projected = projectDecisions(
      view([
        record("dec-inside-window", "2026-09-02T12:00:00.000Z", {
          reviewed: true,
          reviewedAt: "2026-09-03T12:00:00.000Z",
          reversed: true,
          reversedAt: "2026-09-04T12:00:00.000Z",
          touches: [
            { kind: "reviewed", at: "2026-09-03T12:00:00.000Z", by: "greg", what: "reviewed" },
            { kind: "reversed", at: "2026-09-04T12:00:00.000Z", by: "greg", what: "reversed" },
          ],
        }),
        record("dec-eight-days", "2026-09-01T11:59:59.999Z", {
          reviewed: true,
          reviewedAt: "2026-09-01T12:00:00.000Z",
          reversed: true,
          reversedAt: "2026-09-01T12:00:00.000Z",
          touches: [
            { kind: "reviewed", at: "2026-09-01T12:00:00.000Z", by: "greg", what: "reviewed" },
            { kind: "reversed", at: "2026-09-01T12:00:00.000Z", by: "greg", what: "reversed" },
          ],
        }),
        record("dec-one-hour", "2026-09-09T11:00:00.000Z"),
      ]),
      checkpoint(),
      NOW,
    );
    expect(projected.composedAt).toBe(NOW.toISOString());
    expect(projected.records.find((item) => item.record.id === "dec-one-hour")?.ageMs).toBe(60 * 60_000);
    expect(projected.aggregates).toEqual({
      kind: "counts",
      notYetReviewed: 1,
      trailingSevenDays: { decisions: 2, reviews: 1, reversals: 1 },
    });
  });
});
