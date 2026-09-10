/**
 * **The one parser of `schedule.json`** — plan 260910e § D7.
 *
 * The CLI, the fleet route and the browser all read the daemon's preview
 * through `tools/fleet/schedule-parse.ts`, so what it refuses is what every
 * surface refuses. Three properties matter and each has a test:
 *
 * - **it never throws** — a card must not blank the page, and a CLI line must
 *   not take down `overseer status`;
 * - **an unknown kind is that ROW's own `unreadable` arm**, never the file's and
 *   never a different kind — a newer daemon adding a verdict must not make an
 *   older reader drop every job, nor draw the new one as something it is not;
 * - **instants are range-checked**, not just finiteness-checked
 *   (fleet-dashboard-modes.md § Absence is stated: `1e300` is finite).
 *
 * No id in this file is a uuid (`tests/fixture-ids.test.ts`).
 */
import { describe, expect, test } from "vitest";

import { parseSchedulePreview, SCHEDULE_PREVIEW_SCHEMA } from "../tools/fleet/schedule-parse.js";
import type { SchedulePreview, SchedulePreviewJob } from "../tools/fleet/wire.js";

const JOB: SchedulePreviewJob = {
  jobId: "parse-fixture-job",
  resourceClass: "claude-session",
  dispatch: { kind: "dry-run", why: "a fixture" },
  verdict: { kind: "not-yet-eligible", sentence: "never run; first eligible at 2026-09-10T14:00:00.000Z", next: { kind: "first-eligible", at: "2026-09-10T14:00:00.000Z" } },
  lastAttempt: { kind: "never" },
  schedule: { everyMs: 86_400_000, launcherLeaseMs: 3_600_000, initialDelayMs: 7_200_000 },
  sessionTimeout: "not built",
  sessionNoOverlap: "not enforced",
  prompt: "reply one line",
  behaviourHash: { kind: "computed", hash: "465648545712" },
  authorisedHash: "465648545712",
  documents: [
    {
      path: "tools/overseer/schedule-fixture.md",
      pinned: { kind: "pinned", sha256: "e".repeat(64) },
      current: { kind: "read", sha256: "e".repeat(64), when: "this-checkpoint" },
      changed: "no",
    },
  ],
};

const SECOND: SchedulePreviewJob = {
  ...JOB,
  jobId: "parse-fixture-rule",
  resourceClass: "in-process-rule",
  dispatch: { kind: "live" },
  verdict: { kind: "unauthorised", sentence: "moved", drift: ["rules.ts: pinned aaaaaaaa…, now bbbbbbbb…"], next: { kind: "none", why: "not until it is re-pinned" } },
  lastAttempt: {
    kind: "finished",
    occurrenceId: "parse-fixture-rule@2026-09-10T11:00:00.000Z#28d1f83b8a42",
    reservedAt: "2026-09-10T11:00:00.000Z",
    finishedAt: "2026-09-10T11:00:03.000Z",
    outcome: { kind: "exited", code: 0 },
    meaning: "a rule runs inside the daemon",
  },
  documents: [],
};

const PREVIEW: SchedulePreview = {
  schema: 1,
  writtenAt: "2026-09-10T12:00:00.000Z",
  instanceId: "parse-fixture-instance",
  list: { kind: "given", listRevision: "abcdef012345" },
  capabilities: { session: false, rules: false },
  arming: { kind: "none", why: "not armed" },
  history: { kind: "intact" },
  headline: { kind: "off", why: "not armed", at: "2026-09-10T12:00:00.000Z" },
  missedRunPolicy: { kind: "one-run", sentence: "runs once" },
  caveat: "as of writtenAt",
  jobs: [JOB, SECOND],
};

/** A deep copy the test may vandalise, so no test leaks an edit into another. */
function copy(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(PREVIEW)) as Record<string, unknown>;
}

function jobsOf(value: Record<string, unknown>): Record<string, unknown>[] {
  return value["jobs"] as Record<string, unknown>[];
}

describe("a file the daemon wrote reads back as exactly what it wrote", () => {
  test("every field survives, and each job is a `job` row", () => {
    const parsed = parseSchedulePreview(copy());
    expect(parsed.kind).toBe("preview");
    if (parsed.kind !== "preview") return;
    const { jobs, ...rest } = parsed.preview;
    const { jobs: _written, ...expected } = PREVIEW;
    expect(rest).toEqual(expected);
    expect(jobs).toEqual([
      { kind: "job", job: JOB },
      { kind: "job", job: SECOND },
    ]);
    expect(SCHEDULE_PREVIEW_SCHEMA).toBe(1);
  });
});

describe("what it does not know, it says it does not know — per row", () => {
  test("A VERDICT KIND THIS BUILD DOES NOT KNOW makes that row unreadable, and only that row", () => {
    const value = copy();
    const first = jobsOf(value)[0] as Record<string, unknown>;
    first["verdict"] = { kind: "paused-by-greg", sentence: "a newer daemon's verdict", next: { kind: "due-now" } };
    const parsed = parseSchedulePreview(value);
    if (parsed.kind !== "preview") throw new Error(`expected a preview, got ${parsed.kind}`);
    const [bad, good] = parsed.preview.jobs;
    expect(bad).toEqual({ kind: "unreadable", jobId: "parse-fixture-job", why: expect.stringContaining("paused-by-greg") });
    // THE OTHER ROW IS UNTOUCHED — one unknown kind must not take the list with it.
    expect(good).toEqual({ kind: "job", job: SECOND });
  });

  test("an attempt state it does not know is the row's unreadable arm too, never a guess at `never`", () => {
    const value = copy();
    (jobsOf(value)[1] as Record<string, unknown>)["lastAttempt"] = { kind: "paused", occurrenceId: "x" };
    const parsed = parseSchedulePreview(value);
    if (parsed.kind !== "preview") throw new Error("expected a preview");
    expect(parsed.preview.jobs[1]).toEqual({ kind: "unreadable", jobId: "parse-fixture-rule", why: expect.stringContaining("paused") });
    expect(parsed.preview.jobs[0]).toEqual({ kind: "job", job: JOB });
  });

  test("a next-run kind it does not know, and a row with no id, are unreadable rows", () => {
    const value = copy();
    const jobs = jobsOf(value);
    (jobs[0] as Record<string, unknown>)["verdict"] = { kind: "waiting", sentence: "s", next: { kind: "whenever" } };
    delete (jobs[1] as Record<string, unknown>)["jobId"];
    const parsed = parseSchedulePreview(value);
    if (parsed.kind !== "preview") throw new Error("expected a preview");
    expect(parsed.preview.jobs.map((row) => row.kind)).toEqual(["unreadable", "unreadable"]);
    expect(parsed.preview.jobs[1]).toEqual({ kind: "unreadable", jobId: null, why: expect.any(String) });
  });

  test("a schema this build does not read is its own answer, not an unreadable file", () => {
    const value = copy();
    value["schema"] = 2;
    expect(parseSchedulePreview(value)).toEqual({ kind: "unsupported-schema", schema: 2 });
  });

  test("anything that is not a preview at all is unreadable, with a reason, and nothing throws", () => {
    for (const json of [null, 42, "schedule", [], {}, { schema: "1" }]) {
      const parsed = parseSchedulePreview(json);
      expect(parsed.kind).toBe("unreadable");
      if (parsed.kind === "unreadable") expect(parsed.why.length).toBeGreaterThan(0);
    }
  });

  test("a top-level field it cannot read makes the FILE unreadable — a headline kind it does not know included", () => {
    const value = copy();
    value["headline"] = { kind: "paused", why: "w", at: "2026-09-10T12:00:00.000Z" };
    expect(parseSchedulePreview(value).kind).toBe("unreadable");
    const other = copy();
    other["list"] = { kind: "given" };
    expect(parseSchedulePreview(other).kind).toBe("unreadable");
  });
});

describe("instants are range-checked, not just finiteness-checked", () => {
  test("a number where an instant belongs, even a finite one, is refused", () => {
    // `1e300` is finite, and `new Date(1e300).toISOString()` throws — the
    // obvious guard that cannot go red in its own case.
    const value = copy();
    value["writtenAt"] = 1e300;
    expect(parseSchedulePreview(value).kind).toBe("unreadable");
  });

  test("an instant past the representable range is refused, and so is a date that is not an ISO instant", () => {
    for (const writtenAt of ["+275760-09-13T00:00:00.001Z", "2026-09-10", "tomorrow", "2026-13-40T99:99:99.000Z"]) {
      const value = copy();
      value["writtenAt"] = writtenAt;
      expect(parseSchedulePreview(value).kind, writtenAt).toBe("unreadable");
    }
  });

  test("an instant inside one row, out of range, makes that row unreadable", () => {
    const value = copy();
    (jobsOf(value)[0] as Record<string, unknown>)["verdict"] = {
      kind: "not-yet-eligible",
      sentence: "s",
      next: { kind: "first-eligible", at: "+275760-09-13T00:00:00.001Z" },
    };
    const parsed = parseSchedulePreview(value);
    if (parsed.kind !== "preview") throw new Error("expected a preview");
    expect(parsed.preview.jobs.map((row) => row.kind)).toEqual(["unreadable", "job"]);
  });

  test("a duration that is not a sane number of milliseconds makes its row unreadable", () => {
    for (const everyMs of [1e300, -1, 1.5, Number.NaN, "6h"]) {
      const value = copy();
      ((jobsOf(value)[0] as Record<string, unknown>)["schedule"] as Record<string, unknown>)["everyMs"] = everyMs;
      const parsed = parseSchedulePreview(value);
      if (parsed.kind !== "preview") throw new Error("expected a preview");
      expect(parsed.preview.jobs[0]?.kind, String(everyMs)).toBe("unreadable");
    }
  });
});
