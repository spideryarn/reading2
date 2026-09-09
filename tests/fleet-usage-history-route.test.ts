/**
 * `GET /api/usage/history` — the payload, tested without a socket.
 *
 * The interesting half of this route is `usageHistoryPayload`, which is pure
 * given a store. The rest is the same gzip-and-404 shell as the health route.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WINDOW_HOURS,
  MAX_WINDOW_HOURS,
  recorderHealthOf,
  usageHistoryPayload,
  windowHoursFrom,
} from "../tools/fleet/routes-usage-history.js";
import { LIVE_FILE, openUsageHistoryForRead, type UsageHistoryReader } from "../tools/fleet/usage-history.js";
import { SUMMARY_SCHEMA, type UsageHistoryLine } from "../tools/fleet/usage-history-record.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "usage-route-"));
  dirs.push(dir);
  return dir;
}

const T0 = Date.parse("2026-09-09T00:00:00.000Z");

/**
 * A record, with the APPEND instant a realistic distance after the collection
 * instant.
 *
 * The first version of this helper set them equal, which is precisely the
 * coincidence that hid GPT Sol's H1: a real pass is stamped `collectedAt` when
 * it starts and appended 13-16 seconds later, because the transcript scan takes
 * that long. Every recorder-health test passed against a fixture in which the
 * distinction did not exist.
 */
const SCAN_MS = 15_000;

function line(atMs: number, nextDueMs = 300_000): UsageHistoryLine {
  return {
    lineSchema: 1,
    summarySchema: SUMMARY_SCHEMA,
    recordedAt: new Date(atMs + SCAN_MS).toISOString(),
    nextDueMs,
    pass: {
      kind: "pass",
      collectedAt: new Date(atMs).toISOString(),
      accountUuid: "acct-A",
      cache: { kind: "attributed", accountUuid: "acct-A", fetchedAt: new Date(atMs).toISOString(), windows: [] },
      scan: { conclusive: true, why: null, incidents: [] },
      publication: { decision: "take-fresh", why: "finished" },
    },
  };
}

function storeWith(lines: UsageHistoryLine[]): UsageHistoryReader {
  const dir = tempDir();
  writeFileSync(join(dir, LIVE_FILE), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return openUsageHistoryForRead(dir);
}

function deps(store: UsageHistoryReader | null, nowMs: number) {
  return { store, refreshMs: 60_000, nowMs: () => nowMs };
}

describe("the hours parameter", () => {
  it("defaults, clamps, and never returns NaN", () => {
    expect(windowHoursFrom("/api/usage/history")).toBe(DEFAULT_WINDOW_HOURS);
    expect(windowHoursFrom("/api/usage/history?hours=48")).toBe(48);
    expect(windowHoursFrom("/api/usage/history?hours=99999")).toBe(MAX_WINDOW_HOURS);
    /* Junk is the default, not an error: this is a chart, and refusing to draw
       because a query string was odd helps nobody. */
    for (const bad of ["abc", "-1", "0", "", "NaN", "Infinity"]) {
      expect(windowHoursFrom(`/api/usage/history?hours=${bad}`), bad).toBe(DEFAULT_WINDOW_HOURS);
    }
  });
});

describe("the payload", () => {
  it("carries the whole envelope Stage 5 needs, so the chart never reaches back", () => {
    /* GPT Sol's G11: if the route ships only what today's test asks for, the
       chart has to change the contract to draw its axis — or compute the window
       from the browser clock and misplace history under skew. */
    const payload = usageHistoryPayload(deps(storeWith([line(T0)]), T0 + 60_000), 24);
    expect(payload.kind).toBe("history");
    if (payload.kind !== "history") return;
    for (const key of [
      "schema",
      "windowHours",
      "fromMs",
      "toMs",
      "samples",
      "predecessor",
      "holes",
      "earliestAt",
      "rotated",
      "unreadableLines",
      "unsupportedLines",
      "recorder",
      "refreshMs",
    ]) {
      expect(payload, `missing ${key}`).toHaveProperty(key);
    }
    /* The window is stamped by the SERVER's clock, so a drifted browser cannot
       manufacture a missing hour. */
    expect(payload.toMs).toBe(T0 + 60_000);
    expect(payload.fromMs).toBe(T0 + 60_000 - 24 * 60 * 60 * 1000);
  });

  it("reports an EMPTY store as an empty history, not as a broken one", () => {
    /* And it claims no "since" it cannot know: an empty file has no first line,
       process start moves the claim on every restart, and the checkpoint's own
       instant may predate the recorder by days. `earliestAt` is null and the
       page says "nothing recorded yet" from that. */
    const payload = usageHistoryPayload(deps(openUsageHistoryForRead(tempDir()), T0), 24);
    expect(payload.kind).toBe("history");
    if (payload.kind !== "history") return;
    expect(payload.samples).toEqual([]);
    expect(payload.earliestAt).toBeNull();
    expect(payload.rotated).toBe(false);
    expect(payload.recorder).toEqual({ lastRecordedAt: null, expectedEveryMs: null, overdueByMs: null });
  });

  it("says the store is unreadable rather than pretending it is empty", () => {
    /* The distinction the whole file turns on. An empty store means nothing has
       happened; an unreadable one means we cannot say. */
    const payload = usageHistoryPayload(deps(null, T0), 24);
    expect(payload.kind).toBe("unreadable");
    if (payload.kind !== "unreadable") return;
    expect(payload.why).toMatch(/not the same as nothing having happened/);
  });

  it("converts holes to ISO and keeps them positional", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, LIVE_FILE),
      `${JSON.stringify(line(T0))}\n{not json\n${JSON.stringify(line(T0 + 300_000))}\n`,
    );
    const payload = usageHistoryPayload(deps(openUsageHistoryForRead(dir), T0 + 400_000), 24);
    if (payload.kind !== "history") throw new Error("unreadable");
    expect(payload.unreadableLines).toBe(1);
    expect(payload.holes).toEqual([
      { afterAt: new Date(T0).toISOString(), beforeAt: new Date(T0 + 300_000).toISOString() },
    ]);
  });
});

describe("recorder health, derived rather than carried", () => {
  /* The writer is the daemon and this route is the dashboard, in different
     processes. `status()` off a reader handle would say "no failures" because
     this process has never attempted a write — a fabrication. So: is anything
     still being recorded, computed from the records. */

  it("is not overdue while the last record is within its own declared cadence", () => {
    const health = recorderHealthOf(
      [{ kind: "sample", sourceAtMs: T0, line: line(T0) }],
      T0 + 200_000,
    );
    expect(health.lastRecordedAt).toBe(new Date(T0 + SCAN_MS).toISOString());
    expect(health.expectedEveryMs).toBe(300_000);
    expect(health.overdueByMs).toBeNull();
  });

  it("is overdue once the gap exceeds the cadence THE RECORD ITSELF declared", () => {
    /* Not `now - last > 300s`. A daemon running a different interval would
       otherwise have every ordinary gap reported as a failure — a monitor
       crying wolf at its own configuration. */
    const slow = { kind: "sample" as const, sourceAtMs: T0, line: line(T0, 900_000) };
    expect(recorderHealthOf([slow], T0 + 600_000).overdueByMs).toBeNull();
    expect(recorderHealthOf([slow], T0 + 1_000_000).overdueByMs).toBe(100_000 - SCAN_MS);
  });

  it("reads the LAST record in file order, not the largest instant", () => {
    /* A clock that stepped backwards should surface as a regression in the
       series, not be smoothed over here by picking whichever number is biggest.
       Taking the max would hide exactly the condition worth seeing. */
    const health = recorderHealthOf(
      [
        { kind: "sample", sourceAtMs: T0 + 600_000, line: line(T0 + 600_000) },
        { kind: "sample", sourceAtMs: T0, line: line(T0) },
      ],
      T0 + 100_000,
    );
    expect(health.lastRecordedAt).toBe(new Date(T0 + SCAN_MS).toISOString());
  });

  it("measures from the APPEND instant, so a healthy in-flight scan is not overdue", () => {
    /* GPT Sol H1, reproduced against live records: source gaps of 300,000 ms
       against append delays of 13,042-15,693 ms. Measuring from `collectedAt`
       plus the cadence declares the recorder overdue during EVERY healthy scan —
       an alarm that fires on the normal case. */
    const health = recorderHealthOf([{ kind: "sample", sourceAtMs: T0, line: line(T0) }], T0 + 310_000);
    expect(health.lastRecordedAt).toBe(new Date(T0 + SCAN_MS).toISOString());
    expect(health.overdueByMs).toBeNull();
  });

  it("uses the PREDECESSOR when the window holds no samples at all", () => {
    /* GPT Sol H4. If the daemon died 25 hours ago, a 24-hour read returns no
       samples and that record as the predecessor. Computing from `samples` alone
       reported "nothing has ever been recorded" — the exact inverse of the
       truth, on the one screen whose job is to say the recorder stopped. */
    const old = { kind: "sample" as const, sourceAtMs: T0, line: line(T0) };
    const health = recorderHealthOf([], T0 + 25 * 60 * 60 * 1000, old);
    expect(health.lastRecordedAt).toBe(new Date(T0 + SCAN_MS).toISOString());
    expect(health.overdueByMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("keeps the cadence when the newest record is an OMISSION", () => {
    /* GPT Sol H3. An omitted record dropped its cadence, so a store whose newest
       record was one reported `expectedEveryMs: null` for ever — and a recorder
       that then stopped could never be seen to be overdue. */
    const omitted = {
      kind: "omitted" as const,
      sourceAtMs: T0,
      recordedAtMs: T0 + SCAN_MS,
      nextDueMs: 300_000,
      why: "the record could not be written",
    };
    const health = recorderHealthOf([omitted], T0 + 60 * 60 * 1000);
    expect(health.expectedEveryMs).toBe(300_000);
    expect(health.overdueByMs).toBeGreaterThan(0);
  });

  it("says nothing has been recorded, which is not the same as being late", () => {
    /* A fresh box has recorded nothing and is perfectly healthy. */
    expect(recorderHealthOf([], T0)).toEqual({
      lastRecordedAt: null,
      expectedEveryMs: null,
      overdueByMs: null,
    });
  });
});
