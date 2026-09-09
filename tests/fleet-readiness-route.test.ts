/**
 * **The readiness composition and its route.**
 *
 * The point of this file is the join. `tests/fleet-readiness.test.ts` proves the
 * store, the parsers and the verdict each work; this proves they are wired to
 * each other and to the same directory — which is the thing that was missing
 * when the sibling feature shipped a dead route past three green unit tests
 * (see the header of `health-wiring.ts`).
 *
 * So these drive `makeReadinessRetention()` itself, the same function
 * `server.ts` calls, rather than assembling the pieces a second way.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readinessPayload, readinessRoute, READINESS_PATH } from "../tools/fleet/routes-readiness.js";
import {
  makeReadinessRetention,
  sessionNameForLog,
  WINDOW_HOURS,
  type ReadinessSnapshot,
} from "../tools/fleet/readiness-wiring.js";
import { openReadinessStore } from "../tools/fleet/readiness-store.js";
import { MODES, MODE_LABELS } from "../tools/fleet/web/src/mode.js";
import type { FinishedRecord } from "../tools/fleet/readiness.js";

const SHA = "1111111111111111111111111111111111111111";

function record(over: Partial<FinishedRecord> = {}): FinishedRecord {
  return {
    schema: 1,
    runId: "aabbccddeeff",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    pid: process.pid,
    host: hostname(),
    procStartToken: null,
    cwd: "/repo",
    check: "test",
    scope: "full",
    commandLine: "vitest run",
    treeAtStart: { kind: "known", sha: SHA, branch: "dev", dirty: false },
    source: "wrapper",
    state: "finished",
    at: new Date().toISOString(),
    durationMs: 1000,
    outcome: "pass",
    exit: 0,
    counts: { kind: "vitest", files: null, tests: null },
    treeAtEnd: { kind: "known", sha: SHA, branch: "dev", dirty: false },
    logPath: null,
    why: null,
    ...over,
  };
}

describe("the readiness composition", () => {
  let dir: string;
  let primary: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "readiness-wiring-"));
    primary = mkdtempSync(join(tmpdir(), "readiness-primary-"));
    mkdirSync(join(primary, "logs", "tmux-jobs"), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(primary, { recursive: true, force: true });
  });

  const retention = (over: { liveSessions?: () => { names: Set<string> } | { why: string } } = {}) =>
    makeReadinessRetention({
      primary,
      dir,
      liveSessions: over.liveSessions ?? (() => ({ names: new Set<string>() })),
    });

  it("reads back a record written through the very store it opened", () => {
    /* The join `health-wiring.ts` exists for: a route mounted against a
       different store instance, or a different directory, would pass every unit
       test and show nothing. */
    const opened = openReadinessStore(dir);
    if (opened.kind !== "open") throw new Error(opened.why);
    opened.store.put(record());

    const snapshot = retention().collect();
    expect(snapshot.readings).toHaveLength(1);
    expect(snapshot.readings[0]?.state).toBe("pass");
    expect(snapshot.diagnostics.storeRefused).toBeNull();
  });

  it("counts a store that would not open as unreadable, not as a quiet day", () => {
    /* The one state where NOTHING is being recorded must not render like a day
       on which nothing happened. */
    const broken = makeReadinessRetention({ primary, dir: "relative/nope" });
    const snapshot = broken.collect();
    expect(snapshot.diagnostics.storeRefused).not.toBeNull();
    expect(snapshot.verdict.kind).toBe("unknown");
    expect(snapshot.verdict.kind === "unknown" && snapshot.verdict.why).toContain("could not be read");
  });

  it("says why liveness is unknown rather than calling every scanned run void", () => {
    /* An empty session set would say every session is gone, which turns the
       whole board void in one stroke on a box where tmux happened to be busy. */
    const snapshot = retention({ liveSessions: () => ({ why: "tmux said no" }) }).collect();
    expect(snapshot.diagnostics.tmuxWhy).toBe("tmux said no");
  });

  it("carries its diagnostics whether or not anything went wrong", () => {
    const snapshot = retention().collect();
    expect(snapshot.diagnostics.checkoutsScanned).toBeGreaterThanOrEqual(1);
    expect(snapshot.diagnostics.scanTruncated).toBe(false);
    expect(snapshot.diagnostics.unreadableLogs).toEqual([]);
  });

  it("takes a log's tmux session name from its filename", () => {
    expect(sessionNameForLog("/repo/logs/tmux-jobs/rt-sol5-0529-3642036.log")).toBe("rt-sol5-0529-3642036");
    expect(sessionNameForLog("bare")).toBe("bare");
  });

  it("merges store records and scanned logs into one list, oldest first", () => {
    const opened = openReadinessStore(dir);
    if (opened.kind !== "open") throw new Error(opened.why);
    opened.store.put(record());

    const log = join(primary, "logs", "tmux-jobs", "someone-else.log");
    writeFileSync(log, "\n> spideryarn@1.0.0 typecheck\n> tsx scripts/typecheck.ts\n\nEXIT=0\n");
    const when = new Date(Date.now() - 30 * 60 * 1000);
    utimesSync(log, when, when);
    writeFileSync(join(primary, "package.json"), JSON.stringify({ scripts: { typecheck: "tsx scripts/typecheck.ts" } }));

    const snapshot = retention().collect();
    const kinds = snapshot.readings.map((r) => `${r.record.check}/${r.record.source}`);
    expect(kinds).toContain("test/wrapper");
    expect(kinds).toContain("typecheck/tmux-log");
    const times = snapshot.readings.map((r) => r.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("the readiness route", () => {
  const snapshot: ReadinessSnapshot = {
    collectedAt: "2026-09-09T05:00:00.000Z",
    readings: [],
    verdict: { kind: "unknown", why: "nothing yet", sha: null, evidence: [] },
    dev: { kind: "unknown", why: "no git here", observedAt: "2026-09-09T05:00:00.000Z" },
    diagnostics: {
      unreadableRecords: [],
      unreadableLogs: [],
      unreadableRoots: [],
      scanTruncated: false,
      rootsTruncated: false,
      logsSkippedForBudget: 0,
      dedupedAgainstWrapper: 0,
      checkoutsScanned: 1,
      storeRefused: null,
      tmuxWhy: null,
    },
  };

  it("says the snapshot does not exist yet, rather than serving an empty one", () => {
    /* "We have not looked" and "there is nothing there" draw the same blank page
       unless the payload keeps them apart. */
    const payload = readinessPayload({ snapshot: () => null, windowHours: WINDOW_HOURS, refreshMs: 60_000 });
    expect(payload.kind).toBe("unavailable");
    expect(payload.kind === "unavailable" && payload.why).toContain("has not finished");
  });

  it("serves the snapshot it is given, with the window and the refresh interval", () => {
    const payload = readinessPayload({ snapshot: () => snapshot, windowHours: 24, refreshMs: 60_000 });
    expect(payload.kind).toBe("readiness");
    expect(payload.kind === "readiness" && payload.collectedAt).toBe(snapshot.collectedAt);
    /* The page needs the refresh interval to say whether the RIGHT-HAND EDGE is
       overdue — the gap that is happening now, which no reading can record. */
    expect(payload.kind === "readiness" && payload.refreshMs).toBe(60_000);
  });

  const fakeRes = () => {
    const chunks: string[] = [];
    let status = 0;
    return {
      res: {
        writeHead(code: number) {
          status = code;
        },
        end(body?: string | Buffer) {
          if (body !== undefined) chunks.push(body.toString());
        },
      } as unknown as import("node:http").ServerResponse,
      status: () => status,
      body: () => chunks.join(""),
    };
  };

  it("answers its own exact path and declines everything else", () => {
    const route = readinessRoute({ snapshot: () => snapshot, windowHours: 24, refreshMs: 60_000 });

    const mine = fakeRes();
    expect(route.handle({ url: READINESS_PATH, headers: {} } as never, mine.res)).toBe(true);
    expect(mine.status()).toBe(200);

    const other = fakeRes();
    expect(route.handle({ url: "/api/state", headers: {} } as never, other.res)).toBe(false);
  });

  it("refuses a path that merely starts with its own, rather than widening", () => {
    const route = readinessRoute({ snapshot: () => snapshot, windowHours: 24, refreshMs: 60_000 });
    const sub = fakeRes();
    expect(route.handle({ url: `${READINESS_PATH}/../secrets`, headers: {} } as never, sub.res)).toBe(true);
    expect(sub.status()).toBe(404);
  });

  it("keeps the query string out of the path match", () => {
    const route = readinessRoute({ snapshot: () => snapshot, windowHours: 24, refreshMs: 60_000 });
    const q = fakeRes();
    expect(route.handle({ url: `${READINESS_PATH}?hours=6`, headers: {} } as never, q.res)).toBe(true);
    expect(q.status()).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * The tab's own registrations.
 * ------------------------------------------------------------------ */

/**
 * **A merge can remove all five registrations at once and still typecheck.**
 *
 * `Mode` is derived FROM `MODES`, so the `Record<Mode, …>` maps that catch a
 * half-added mode cannot see a mode removed from every one of them together —
 * which is exactly what a merge does when two sessions add tabs to the same
 * array. `docs/project/fleet-dashboard-modes.md` § When several sessions add a
 * tab at once, and the Overseer's standing rule: add your own entries with your
 * panel, never touch another's, and assert your own here.
 *
 * The mount in `App.tsx` is the fifth place and the one nothing else checks: a
 * mode registered in all four with no arm there compiles, draws a button,
 * switches the hash, and shows an empty page.
 */
describe("the readiness mode's registrations", () => {
  it("is in MODES, so the Dock draws it and the hash keeps it", () => {
    expect(MODES).toContain("readiness");
  });

  it("has a label, which is the one place it is spelled for a person", () => {
    expect(MODE_LABELS["readiness"]).toBe("Readiness");
  });

  it("is mounted in App.tsx, which no type can check", () => {
    /* A source check, the same kind `tests/fleet-web.test.tsx` uses for the
       other modes: the alternative is a button that switches to a blank page. */
    const app = readFileSync(join(__dirname, "..", "tools", "fleet", "web", "src", "App.tsx"), "utf8");
    expect(app).toContain('mode === "readiness"');
    expect(app).toContain("<ReadinessPanel");
  });

  it("has an icon and a tip in the Dock", () => {
    const dock = readFileSync(join(__dirname, "..", "tools", "fleet", "web", "src", "Dock.tsx"), "utf8");
    expect(dock).toMatch(/readiness:\s*\w+,/);
    expect(dock).toContain('head: "Readiness"');
  });

  it("is served by a route the server actually mounts", () => {
    /* The other half of the same worry, one layer down: `server.ts` cannot be
       imported by a test — it binds port 8787 — so the line that calls
       `readinessApi.handle` is checked by reading it. */
    const server = readFileSync(join(__dirname, "..", "tools", "fleet", "server.ts"), "utf8");
    expect(server).toContain("readinessApi.handle(req, res)");
    expect(server).toContain("refreshReadiness()");
  });
});
