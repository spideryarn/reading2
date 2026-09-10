/**
 * `GET /api/reports` — the production composition, driven through injected
 * readers, and the real mount in `server.ts`. Plan 260910e, Stage 3a.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  MAX_REPORTS_INPUT_BYTES,
  MAX_REPORTS_RESPONSE_BYTES,
  REPORTS_PATH,
  makeReportsRoute,
  type ReportsRouteReaders,
} from "../tools/fleet/routes-reports.js";
import { RECENT_CLAIMS_LIMIT } from "../tools/fleet/reports-view.js";
import {
  INBOX_DIR,
  foldReports,
  readInbox,
  type InboxListing,
  type ReportEvent,
  type ReportProblem,
  type ReportsRead,
} from "../tools/overseer/reports.js";
import type { ReportsFeed } from "../tools/fleet/wire.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-09-10T12:00:00.000Z");

function event(index: number, over: Record<string, unknown> = {}): ReportEvent {
  return {
    schema: 1,
    eventId: randomUUID(),
    submittedAt: new Date(NOW.getTime() - (10_000 - index) * 1000 - 500).toISOString(),
    receivedAt: new Date(NOW.getTime() - (10_000 - index) * 1000).toISOString(),
    kind: "progress",
    actor: { kind: "session", name: "work-reports" },
    observedExecution: null,
    execution: { unverifiable: "the submitter could not observe its own execution" },
    job: { plan: null, queueItem: null, occurrence: null },
    summary: `claim ${index}`,
    artefacts: [],
    corrects: null,
    ...over,
  } as ReportEvent;
}

function reportsRead(events: readonly ReportEvent[], problems: readonly ReportProblem[] = []): ReportsRead {
  return { kind: "reports", path: "/tmp/fake/reports.jsonl", view: foldReports(events, problems) };
}

function inbox(inFlight = 0, refused = 0, quarantine: InboxListing["quarantine"] = QUIET_QUARANTINE): InboxListing {
  return {
    inFlight: {
      items: Array.from({ length: inFlight }, () => ({ eventId: randomUUID(), submission: null, why: "not parsed in this test" })),
      count: { exact: inFlight },
    },
    processing: { items: [], count: { exact: 0 } },
    refused: {
      items: Array.from({ length: refused }, () => ({ eventId: randomUUID(), refusedAt: NOW.toISOString(), why: "a test refusal" })),
      count: { exact: refused },
    },
    skippedEntries: { exact: 0 },
    quarantine,
  };
}

const QUIET_QUARANTINE: InboxListing["quarantine"] = { path: "/tmp/fake/report-quarantine", count: { exact: 0 }, oldestMovedAt: null };

function readers(read: ReportsRead, over: Partial<ReportsRouteReaders> = {}): ReportsRouteReaders {
  return {
    reportFileSize: () => ({ path: "/tmp/fake/reports.jsonl", sizeBytes: 0 }),
    readReports: () => read,
    readInbox: () => inbox(),
    loadCheckpoint: () => ({ kind: "absent" }),
    now: () => NOW,
    ...over,
  };
}

function call(given: ReportsRouteReaders, url = REPORTS_PATH, method = "GET") {
  let status = 0;
  let headers: Record<string, string> = {};
  let raw = "";
  const res = {
    writeHead(code: number, next?: Record<string, string>) {
      status = code;
      headers = next ?? {};
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) raw += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return res;
    },
  };
  const handled = makeReportsRoute(given).handle({ method, url, headers: {} } as IncomingMessage, res as unknown as ServerResponse);
  return { handled, status, headers, raw, body: raw === "" ? null : (JSON.parse(raw) as ReportsFeed) };
}

describe("the arms", () => {
  it("never-written carries what is waiting in the inbox, so a daemon that is not draining shows", () => {
    const answer = call(
      readers({ kind: "never-written", path: "/tmp/fake/reports.jsonl" }, { readInbox: () => inbox(2, 1) }),
    ).body;
    expect(answer).toMatchObject({
      schema: 2,
      kind: "never-written",
      composedAt: NOW.toISOString(),
      inFlight: { exact: 2 },
      refused: { exact: 1 },
      quarantine: { count: { exact: 0 }, oldestMovedAt: null },
    });
    expect(answer === null || "recent" in answer).toBe(false);
  });

  it("carries the quarantine's size and its oldest entry's age on both arms that count the inbox, but not its path", () => {
    const oldest = "2026-09-07T12:00:00.000Z";
    const quarantine: InboxListing["quarantine"] = { path: "/tmp/fake/report-quarantine", count: { exact: 12 }, oldestMovedAt: oldest };
    const never = call(readers({ kind: "never-written", path: "/tmp/fake/reports.jsonl" }, { readInbox: () => inbox(0, 0, quarantine) }));
    const recorded = call(readers(reportsRead([event(1)]), { readInbox: () => inbox(0, 0, quarantine) }));
    for (const answer of [never, recorded]) {
      expect(answer.body).toMatchObject({ quarantine: { count: { exact: 12 }, oldestMovedAt: oldest } });
      expect(answer.raw).not.toContain("/tmp/fake/report-quarantine");
    }
  });

  it("carries unreadable as the reader's refusal, never as an empty log", () => {
    const answer = call(readers({ kind: "unreadable", why: "reports.jsonl is gone but reports.created is not", path: "/x" })).body;
    expect(answer).toEqual({
      schema: 2,
      kind: "unreadable",
      composedAt: NOW.toISOString(),
      why: "reports.jsonl is gone but reports.created is not",
    });
  });

  it("refuses an oversized file before reading it", () => {
    const readReports = vi.fn<() => ReportsRead>(() => reportsRead([]));
    const answer = call(
      readers(reportsRead([]), {
        reportFileSize: () => ({ path: "/tmp/fake/reports.jsonl", sizeBytes: MAX_REPORTS_INPUT_BYTES + 1 }),
        readReports,
      }),
    ).body;
    expect(MAX_REPORTS_INPUT_BYTES).toBe(8 * 1024 * 1024);
    expect(answer).toMatchObject({ schema: 2, kind: "oversized-file", sizeBytes: MAX_REPORTS_INPUT_BYTES + 1, limitBytes: MAX_REPORTS_INPUT_BYTES });
    expect(readReports).not.toHaveBeenCalled();
  });

  it("answers with claims, newest first, the counts, the problems, and the register's own arm", () => {
    const first = event(1);
    const second = event(2, { actor: { kind: "overseer" }, execution: null });
    const problem: ReportProblem = { kind: "unreadable-line", why: "line 3 is not a report", eventId: null };
    const answer = call(readers(reportsRead([first, second], [problem]), { readInbox: () => inbox(1, 4) })).body;
    expect(answer?.kind).toBe("reports");
    if (answer?.kind !== "reports") throw new Error("unreachable");
    expect(answer.schema).toBe(2);
    expect(answer.recent.map((row) => row.eventId)).toEqual([second.eventId, first.eventId]);
    expect(answer.recent[0]?.claimedBy).toEqual({ kind: "overseer" });
    expect(answer.inFlight).toEqual({ exact: 1 });
    expect(answer.refused).toEqual({ exact: 4 });
    expect(answer.problems).toEqual([problem]);
    expect(answer.sessions).toMatchObject({ kind: "register-unavailable", why: "the Overseer checkpoint is absent" });
  });
});

describe("the ceilings", () => {
  it("caps recent claims at 200 and counts what it withheld", () => {
    expect(RECENT_CLAIMS_LIMIT).toBe(200);
    const events = Array.from({ length: 205 }, (_, index) => event(index));
    const answer = call(readers(reportsRead(events))).body;
    if (answer?.kind !== "reports") throw new Error("unreachable");
    expect(answer.recent).toHaveLength(200);
    expect(answer.recentWithheld).toBe(5);
    expect(answer.recent[0]?.eventId).toBe(events[204]?.eventId);
  });

  it("withholds claims to stay under 2 MiB, counting UTF-8 bytes, and keeps the count exact", () => {
    // Wider than the parser allows, on purpose: the route bounds what it is handed.
    const events = Array.from({ length: 150 }, (_, index) => event(index, { summary: `${index}:${"🕸️".repeat(4_000)}` }));
    const answer = call(readers(reportsRead(events)));
    if (answer.body?.kind !== "reports") throw new Error("unreachable");
    expect(MAX_REPORTS_RESPONSE_BYTES).toBe(2 * 1024 * 1024);
    expect(Buffer.byteLength(answer.raw, "utf8")).toBeLessThanOrEqual(MAX_REPORTS_RESPONSE_BYTES);
    expect(answer.body.recentWithheld).toBeGreaterThan(0);
    expect(answer.body.recent.length + answer.body.recentWithheld).toBe(150);
  });

  it("says so when the mandatory context alone is over the limit, rather than truncating it", () => {
    const problems: ReportProblem[] = Array.from({ length: 30_000 }, (_, index) => ({
      kind: "unreadable-line",
      why: `line ${index} is not a report: ${"broken".repeat(20)}`,
      eventId: null,
    }));
    const answer = call(readers(reportsRead([], problems)));
    expect(answer.body?.kind).toBe("unreadable");
    expect(answer.raw).toContain("2097152");
    expect(Buffer.byteLength(answer.raw, "utf8")).toBeLessThanOrEqual(MAX_REPORTS_RESPONSE_BYTES);
  });
});

describe("the mount", () => {
  it("answers only its exact path", () => {
    const given = readers(reportsRead([]));
    expect(call(given).handled).toBe(true);
    expect(call(given, `${REPORTS_PATH}?x=1`).status).toBe(200);
    expect(call(given, `${REPORTS_PATH}/../secrets`).status).toBe(404);
    expect(call(given, "/api/decisions").handled).toBe(false);
  });

  it("is read-only on purpose, and every inline refusal says schema 2", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const answer = call(readers(reportsRead([])), REPORTS_PATH, method);
      expect(answer.status).toBe(405);
      expect(answer.headers["allow"]).toBe("GET, HEAD");
      expect(answer.raw).toContain("read-only on purpose");
      expect(answer.raw).toContain("scripts/overseer.ts report");
      expect(JSON.parse(answer.raw)).toMatchObject({ schema: 2, kind: "unreadable" });
    }
    expect(JSON.parse(call(readers(reportsRead([])), `${REPORTS_PATH}/x`).raw)).toMatchObject({ schema: 2 });
  });

  it("sends no body for HEAD", () => {
    const answer = call(readers(reportsRead([])), REPORTS_PATH, "HEAD");
    expect(answer.status).toBe(200);
    expect(answer.raw).toBe("");

    const failed = call(
      readers(reportsRead([]), {
        readInbox: () => {
          throw new Error("EACCES on report-inbox");
        },
      }),
      REPORTS_PATH,
      "HEAD",
    );
    expect(failed.status).toBe(500);
    expect(failed.raw).toBe("");

    const missing = call(readers(reportsRead([])), `${REPORTS_PATH}/missing`, "HEAD");
    expect(missing.status).toBe(404);
    expect(missing.raw).toBe("");
  });

  it("turns a reader that throws into a loud answer, not an empty one", () => {
    const answer = call(readers(reportsRead([]), { readInbox: () => { throw new Error("EACCES on report-inbox"); } }));
    expect(answer.status).toBe(500);
    expect(answer.body).toMatchObject({ schema: 2, kind: "unreadable" });
    expect(answer.raw).toContain("EACCES on report-inbox");
  });
});

describe("a flooded inbox, read by the real reader", () => {
  it("answers with the capped arm — at least, never a partial count that reads as exact", () => {
    const root = mkdtempSync(join(tmpdir(), "spideryarn-reports-flood-"));
    try {
      const inboxDir = join(root, INBOX_DIR);
      mkdirSync(inboxDir, { recursive: true });
      for (let i = 0; i < 5000; i += 1) writeFileSync(join(inboxDir, `${randomUUID()}.json`), "{}");
      const read = (): InboxListing => readInbox(root);
      const never = call(readers({ kind: "never-written", path: join(root, "reports.jsonl") }, { readInbox: read })).body;
      expect(never).toMatchObject({ kind: "never-written", inFlight: { atLeast: 1000 } });
      const recorded = call(readers(reportsRead([event(1)]), { readInbox: read })).body;
      if (recorded?.kind !== "reports") throw new Error("unreachable");
      expect(recorded.inFlight).toEqual({ atLeast: 1000 });
      expect(recorded.refused).toEqual({ exact: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("server.ts wiring", () => {
  const source = stripComments(readFileSync(join(REPO, "tools", "fleet", "server.ts"), "utf8"));

  it("mounts the reports route in its request path, outside comments", () => {
    expect(source).toContain("reportsApiRoute.handle(req, res)");
  });

  it("answers a real request through the server.ts request composition, from the store root", async () => {
    const storeRoot = mkdtempSync(join(tmpdir(), "spideryarn-reports-server-"));
    const previous = {
      FLEET_BIND: process.env.FLEET_BIND,
      FLEET_HEALTH_DIR: process.env.FLEET_HEALTH_DIR,
      FLEET_HOLDS_DIR: process.env.FLEET_HOLDS_DIR,
      FLEET_READINESS_DIR: process.env.FLEET_READINESS_DIR,
      OVERSEER_DECISIONS_DIR: process.env.OVERSEER_DECISIONS_DIR,
      OVERSEER_STORE_DIR: process.env.OVERSEER_STORE_DIR,
    };
    process.env.FLEET_BIND = "127.0.0.1";
    process.env.FLEET_HEALTH_DIR = join(storeRoot, "health");
    process.env.FLEET_HOLDS_DIR = join(storeRoot, "holds");
    process.env.FLEET_READINESS_DIR = join(storeRoot, "readiness");
    process.env.OVERSEER_DECISIONS_DIR = join(storeRoot, "decisions");
    process.env.OVERSEER_STORE_DIR = join(storeRoot, "overseer");

    let handler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
    vi.doMock("node:http", async () => {
      const actual = await vi.importActual<typeof import("node:http")>("node:http");
      return {
        ...actual,
        createServer: (next: (req: IncomingMessage, res: ServerResponse) => void) => {
          handler = next;
          const fake = {
            on: () => fake,
            listen: (_port: number, _bind: string, ready: () => void) => {
              ready();
              return fake;
            },
          };
          return fake;
        },
      };
    });
    // Keep the collection loop from starting: this test owns request composition only.
    vi.doMock("../tools/fleet/refresh.js", async () => {
      const actual = await vi.importActual<typeof import("../tools/fleet/refresh.js")>("../tools/fleet/refresh.js");
      return { ...actual, refreshOnce: () => new Promise<never>(() => {}) };
    });

    try {
      await import("../tools/fleet/server.js");
      expect(handler).not.toBeNull();
      let status = 0;
      let raw = "";
      const response = {
        setHeader() {},
        writeHead(code: number) {
          status = code;
          return response;
        },
        end(chunk?: string | Buffer) {
          if (chunk !== undefined) raw += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          return response;
        },
      };
      const mounted = handler as unknown as (req: IncomingMessage, res: ServerResponse) => void;
      // A Host, because handler() refuses a request that names none (260910f).
      mounted(
        { method: "GET", url: REPORTS_PATH, headers: { host: "127.0.0.1:8787" } } as IncomingMessage,
        response as unknown as ServerResponse,
      );

      expect(status).toBe(200);
      const answer = JSON.parse(raw) as ReportsFeed;
      expect(answer.kind).toBe("never-written");
      if (answer.kind === "never-written") expect(answer.why).toContain(join(storeRoot, "overseer"));
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      vi.doUnmock("node:http");
      vi.doUnmock("../tools/fleet/refresh.js");
      rmSync(storeRoot, { recursive: true, force: true });
    }
  });
});
