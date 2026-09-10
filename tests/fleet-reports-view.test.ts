/**
 * The reports projection (plan 260910e, Stage 3a): pure, joined with the full
 * register, and never turning a claim into a state.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { projectReports, RECENT_CLAIMS_LIMIT } from "../tools/fleet/reports-view.js";
import type { DecisionCheckpointInput } from "../tools/fleet/decisions-view.js";
import { foldReports, type InboxListing, type ReportEvent, type ReportsView } from "../tools/overseer/reports.js";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const TOKEN = "boot-rrrr:5151:9000";

function checkpoint(names: readonly string[], over: Record<string, unknown> = {}): DecisionCheckpointInput {
  const writtenAt = "2026-09-10T11:59:30.000Z";
  return {
    kind: "json",
    json: {
      schema: 2,
      writtenAt,
      lastGoodSnapshotAt: writtenAt,
      snapshotStaleAfterMs: 300_000,
      heartbeat: {
        pid: 41500,
        instanceId: "instance-reports-view-test",
        startedAt: "2026-09-10T10:00:00.000Z",
        lastTickAt: writtenAt,
        ticks: 7,
      },
      scheduler: { kind: "unknown", why: "not configured", at: writtenAt },
      register: names.map((name, index) => ({
        key: `$${index + 1} claims:conversation-reports-${index + 1}`,
        name,
        tmuxId: `$${index + 1}`,
        lastStatusKey: "working",
        statusSince: { kind: "observed", at: "2026-09-10T11:00:00.000Z" },
        verifiedExecution: { token: TOKEN, since: "2026-09-10T10:00:00.000Z" },
      })),
      ...over,
    },
  };
}

let clock = 0;
function event(over: Record<string, unknown> = {}): ReportEvent {
  clock += 1;
  return {
    schema: 1,
    eventId: randomUUID(),
    submittedAt: new Date(NOW.getTime() - (1_000 - clock) * 1000 - 500).toISOString(),
    receivedAt: new Date(NOW.getTime() - (1_000 - clock) * 1000).toISOString(),
    kind: "progress",
    actor: { kind: "session", name: "work-reports" },
    observedExecution: TOKEN,
    execution: "same-verified-run",
    job: { plan: null, queueItem: null, occurrence: null },
    summary: `claim ${clock}`,
    artefacts: [],
    corrects: null,
    ...over,
  } as ReportEvent;
}

const NO_QUARANTINE: InboxListing["quarantine"] = { path: "/tmp/fake/report-quarantine", count: { exact: 0 }, oldestMovedAt: null };
const EMPTY_INBOX: InboxListing = {
  inFlight: { items: [], count: { exact: 0 } },
  processing: { items: [], count: { exact: 0 } },
  refused: { items: [], count: { exact: 0 } },
  skippedEntries: { exact: 0 },
  quarantine: NO_QUARANTINE,
};

function view(events: readonly ReportEvent[]): ReportsView {
  return foldReports(events);
}

describe("the register join", () => {
  test("a register session with no claim is unreported, and one with claims shows its latest", () => {
    const first = event();
    const second = event({ kind: "blocked", on: "review", needs: "a second pair of eyes" });
    const projection = projectReports(view([first, second]), EMPTY_INBOX, checkpoint(["work-reports", "quiet-one"]), NOW);
    expect(projection.sessions).toEqual({
      kind: "joined-with-register",
      rows: [
        {
          name: "work-reports",
          register: "in-register",
          latest: { kind: "claimed", claims: 2, latest: expect.objectContaining({ eventId: second.eventId, laterClaim: null }) },
        },
        { name: "quiet-one", register: "in-register", latest: { kind: "unreported" } },
      ],
    });
  });

  test("a session that reported but is not in the register is listed, and marked so", () => {
    const stranger = event({ actor: { kind: "session", name: "gone-now" } });
    const projection = projectReports(view([stranger]), EMPTY_INBOX, checkpoint(["quiet-one"]), NOW);
    if (projection.sessions.kind !== "joined-with-register") throw new Error("unreachable");
    expect(projection.sessions.rows).toEqual([
      { name: "quiet-one", register: "in-register", latest: { kind: "unreported" } },
      { name: "gone-now", register: "not-in-register", latest: { kind: "claimed", claims: 1, latest: expect.objectContaining({ eventId: stranger.eventId }) } },
    ]);
  });

  test("the Overseer and Greg are claimants, not sessions", () => {
    const overseer = event({ actor: { kind: "overseer" }, observedExecution: null, execution: null });
    const projection = projectReports(view([overseer]), EMPTY_INBOX, checkpoint([]), NOW);
    expect(projection.sessions).toEqual({ kind: "joined-with-register", rows: [] });
    expect(projection.recent.map((row) => row.claimedBy)).toEqual([{ kind: "overseer" }]);
  });

  test.each([
    ["absent", { kind: "absent" } as DecisionCheckpointInput],
    ["unreadable", { kind: "unreadable", why: "EACCES" } as DecisionCheckpointInput],
    ["stale", checkpoint(["work-reports", "quiet-one"], { writtenAt: "2026-09-10T10:00:00.000Z", lastGoodSnapshotAt: "2026-09-10T10:00:00.000Z" })],
  ])("a register that cannot be read (%s) is its own arm, and nobody is called unreported", (_what, input) => {
    const said = event();
    const projection = projectReports(view([said]), EMPTY_INBOX, input, NOW);
    expect(projection.sessions.kind).toBe("register-unavailable");
    if (projection.sessions.kind !== "register-unavailable") throw new Error("unreachable");
    expect(projection.sessions.why).not.toBe("");
    expect(projection.sessions.reported).toEqual([
      { name: "work-reports", latest: { kind: "claimed", claims: 1, latest: expect.objectContaining({ eventId: said.eventId }) } },
    ]);
    expect(JSON.stringify(projection)).not.toContain("unreported");
  });
});

describe("claims stay claims", () => {
  test("a correction is shown as attributed, and the corrected row is not edited", () => {
    const wrong = event({ summary: "all green" });
    const fix = event({ actor: { kind: "greg" }, observedExecution: null, execution: null, corrects: wrong.eventId, summary: "two reds" });
    const projection = projectReports(view([wrong, fix]), EMPTY_INBOX, checkpoint(["work-reports"]), NOW);
    const shown = projection.recent.find((row) => row.eventId === wrong.eventId);
    expect(shown?.summary).toBe("all green");
    expect(shown?.correctedBy).toEqual({ eventId: fix.eventId, actor: { kind: "greg" }, at: fix.receivedAt });
    expect(projection.recent.find((row) => row.eventId === fix.eventId)?.corrects).toBe(wrong.eventId);
  });

  test("a later claim is only a later claim: no inference from kinds", () => {
    const done = event({ kind: "completed", ending: "finished", revisions: { reviewed: [], tested: [], merged: [] } });
    const again = event({ kind: "progress", summary: "picked it back up" });
    const projection = projectReports(view([done, again]), EMPTY_INBOX, checkpoint(["work-reports"]), NOW);
    const earlier = projection.recent.find((row) => row.eventId === done.eventId);
    expect(earlier?.correctedBy).toBeNull();
    expect(earlier?.laterClaim).toBe(again.eventId);
    expect(earlier?.kind).toBe("completed");
    expect(Object.keys(earlier ?? {}).sort()).toEqual(
      [
        "artefacts", "claimedBy", "corrects", "correctedBy", "ending", "eventId", "execution", "job", "kind",
        "laterClaim", "receivedAt", "revisions", "submittedAt", "summary",
      ].sort(),
    );
    expect(JSON.stringify(projection)).not.toMatch(/"(done|ready|landed|contradicts|state|status)"/);
  });

  test("each row carries the execution comparison and its checked artefacts as recorded", () => {
    const artefacts = [
      { ref: { kind: "commit", sha: "f9970832" }, check: { state: "on-dev" } },
      { ref: { kind: "path", path: "docs/nope.md" }, check: { state: "not-found" } },
    ];
    const said = event({ execution: "different-verified-run", artefacts });
    const [row] = projectReports(view([said]), EMPTY_INBOX, checkpoint(["work-reports"]), NOW).recent;
    expect(row?.execution).toBe("different-verified-run");
    expect(row?.artefacts).toEqual(artefacts);
  });
});

describe("recent, counts and problems", () => {
  test("recent is newest first, capped at 200, with the rest counted", () => {
    const events = Array.from({ length: RECENT_CLAIMS_LIMIT + 3 }, () => event());
    const projection = projectReports(view(events), EMPTY_INBOX, checkpoint([]), NOW);
    expect(projection.recent).toHaveLength(200);
    expect(projection.recentWithheld).toBe(3);
    expect(projection.recent[0]?.eventId).toBe(events.at(-1)?.eventId);
    expect(projection.recent.at(-1)?.eventId).toBe(events[3]?.eventId);
  });

  test("in-flight counts both the inbox and the half-recorded, refused counts refusals, problems come from the fold", () => {
    const inbox: InboxListing = {
      inFlight: { items: [{ eventId: randomUUID(), submission: null, why: "unreadable" }], count: { exact: 1 } },
      processing: { items: [{ eventId: randomUUID(), event: null, why: "being recorded" }], count: { exact: 1 } },
      refused: {
        items: [
          { eventId: randomUUID(), refusedAt: NOW.toISOString(), why: "a" },
          { eventId: randomUUID(), refusedAt: NOW.toISOString(), why: "b" },
        ],
        count: { exact: 2 },
      },
      skippedEntries: { exact: 0 },
      quarantine: NO_QUARANTINE,
    };
    const lonely = event({ corrects: randomUUID() });
    const projection = projectReports(foldReports([lonely]), inbox, checkpoint([]), NOW);
    expect(projection.inFlight).toEqual({ exact: 2 });
    expect(projection.refused).toEqual({ exact: 2 });
    expect(projection.problems.map((problem) => problem.kind)).toEqual(["invalid-correction"]);
    expect(projection.composedAt).toBe(NOW.toISOString());
  });

  test("the counts come from the reader's counts, not the lengths of the lists it parsed, and a capped one stays capped", () => {
    const inbox: InboxListing = {
      ...EMPTY_INBOX,
      // 200 parsed of at least 1000 seen: the list is not the count.
      inFlight: { items: [{ eventId: randomUUID(), submission: null, why: "unreadable" }], count: { atLeast: 1000 } },
      processing: { items: [], count: { exact: 1 } },
      refused: { items: [], count: { exact: 3 } },
      quarantine: { path: "/tmp/fake/report-quarantine", count: { atLeast: 1000 }, oldestMovedAt: "2026-09-07T12:00:00.000Z" },
    };
    const projection = projectReports(foldReports([]), inbox, checkpoint([]), NOW);
    expect(projection.inFlight).toEqual({ atLeast: 1001 });
    expect(projection.refused).toEqual({ exact: 3 });
    expect(projection.quarantine).toEqual({ count: { atLeast: 1000 }, oldestMovedAt: "2026-09-07T12:00:00.000Z" });
  });
});
