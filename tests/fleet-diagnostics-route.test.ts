/**
 * `GET /api/diagnostics` through `makeDiagnosticsRoute`, the composition
 * `server.ts` calls, with only its leaf readers injected — so nothing here
 * imports `server.ts` (which binds a port) or touches `~/.overseer`: the store
 * is a scratch directory named by `OVERSEER_STORE_DIR` in an injected env.
 *
 * What it holds: the three bundle facts stay three (the start one is the value
 * captured once; the disk one is read per request), every clock that has never
 * happened is `never` with a reason rather than a null, a relative store
 * override is `unknown` rather than a guess, and — over a store the REAL daemon
 * wrote — the daemon's start stamp is the one its checkpoint's instance wrote.
 * Every answer goes through the client's parser, so the route and the parser
 * cannot drift apart without this failing.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseDiagnosticsSummary } from "../tools/fleet/diagnostics-parse.js";
import { DIAGNOSTICS_PATH, makeDiagnosticsRoute, storePathOf, type DiagnosticsReaders } from "../tools/fleet/routes-diagnostics.js";
import { STORE_PROBE_FILES } from "../tools/fleet/store-probe.js";
import type { BuildStampReading, DiagnosticsSummary, StartRevision } from "../tools/fleet/wire.js";
import { runOverseer } from "../tools/overseer/daemon.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import { rawFixture } from "./overseer-fixtures.js";

const NOW = new Date("2026-09-10T15:00:00.000Z");
const SERVER_SHA = "6e2b9d4f1a0c83e7b5d2f9a1c4e7b0d3f6a9c2e5";
const DISK_SHA = "c1d2e3f4a5b60718293a4b5c6d7e8f9011223344";
const DAEMON_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-diagnostics-route-test-"));
  roots.push(root);
  return root;
}

const START: StartRevision = { kind: "known", sha: SERVER_SHA, dirty: false, readAt: "2026-09-10T14:00:00.000Z" };
const AT_START: BuildStampReading = { kind: "stamp", stamp: { kind: "known", sha: SERVER_SHA, dirty: false, readAt: "2026-09-10T13:00:00.000Z", builtAt: "2026-09-10T13:00:00.000Z" } };
const ON_DISK: BuildStampReading = { kind: "stamp", stamp: { kind: "known", sha: DISK_SHA, dirty: false, readAt: "2026-09-10T14:30:00.000Z", builtAt: "2026-09-10T14:30:00.000Z" } };

function readers(over: Partial<DiagnosticsReaders> = {}): DiagnosticsReaders {
  return {
    now: () => NOW,
    instance: "srv-test-1",
    start: START,
    bundleAtStart: AT_START,
    bundleOnDisk: () => ON_DISK,
    collector: () => ({ attemptedAt: "2026-09-10T14:59:00.000Z", collectedAt: "2026-09-10T14:58:00.000Z", lastError: null }),
    healthCollectedAt: () => "2026-09-10T14:59:30.000Z",
    env: { OVERSEER_STORE_DIR: tempRoot() },
    ...over,
  };
}

type Answer = { handled: boolean; status: number; headers: Record<string, string>; raw: string };

function call(r: DiagnosticsReaders, url = DIAGNOSTICS_PATH, method = "GET"): Answer {
  const answer: Answer = { handled: false, status: 0, headers: {}, raw: "" };
  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      answer.status = code;
      answer.headers = headers ?? {};
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) answer.raw += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return res;
    },
  };
  answer.handled = makeDiagnosticsRoute(r).handle({ method, url, headers: {} } as IncomingMessage, res as unknown as ServerResponse);
  return answer;
}

function summaryOf(answer: Answer): DiagnosticsSummary {
  const parsed = parseDiagnosticsSummary(JSON.parse(answer.raw));
  if (parsed.kind !== "summary") throw new Error(`the client parser refused the route's own answer: ${parsed.why}`);
  return parsed.summary;
}

describe("GET /api/diagnostics", () => {
  it("answers 200 JSON, no-store, and the client's parser accepts it", () => {
    const answer = call(readers());
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(200);
    expect(answer.headers).toEqual({ "content-type": "application/json", "cache-control": "no-store" });
    const summary = summaryOf(answer);
    expect(summary).toMatchObject({ schema: 1, composedAt: NOW.toISOString(), dashboard: { instance: "srv-test-1", start: START } });
  });

  it("keeps the bundle the server started with apart from the one on disk, and reads the disk one per request", () => {
    let reads = 0;
    const r = readers({
      bundleOnDisk: () => {
        reads += 1;
        return ON_DISK;
      },
    });
    const first = summaryOf(call(r));
    call(r);
    expect(reads).toBe(2);
    expect(first.dashboard.bundleAtStart).toEqual(AT_START);
    expect(first.dashboard.bundleOnDisk).toEqual(ON_DISK);
  });

  it("a clock that has never happened is `never` with a reason, and an error is carried in words", () => {
    const summary = summaryOf(
      call(readers({ collector: () => ({ attemptedAt: null, collectedAt: null, lastError: "tmux timed out" }), healthCollectedAt: () => null })),
    );
    expect(summary.collector.attempted.kind).toBe("never");
    expect(summary.collector.collected.kind).toBe("never");
    expect(summary.collector.lastError).toEqual({ kind: "error", message: "tmux timed out" });
    expect(summary.health.kind).toBe("never");
    const clear = summaryOf(call(readers()));
    expect(clear.collector.attempted).toEqual({ kind: "at", at: "2026-09-10T14:59:00.000Z" });
    expect(clear.collector.lastError).toEqual({ kind: "none" });
    expect(clear.health).toEqual({ kind: "at", at: "2026-09-10T14:59:30.000Z" });
  });

  it("probes exactly the allow-listed store files, in order, in the store the env names", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), `${JSON.stringify({ schema: 2 })}\n`);
    const summary = summaryOf(call(readers({ env: { OVERSEER_STORE_DIR: root } })));
    expect(summary.store.path).toEqual({ kind: "override", label: `OVERSEER_STORE_DIR=${root}`, path: root });
    expect(summary.store.files.kind).toBe("probed");
    if (summary.store.files.kind !== "probed") return;
    expect(summary.store.files.files.map((f) => f.name)).toEqual(STORE_PROBE_FILES.map((t) => (typeof t === "string" ? t : t.name)));
    expect(summary.store.files.files[0]).toMatchObject({ name: "current.json", state: "present", schema: 2 });
  });

  it("the store path says which: the default is labelled ~/.overseer, a relative override is unknown and nothing is probed", () => {
    expect(storePathOf({})).toMatchObject({ kind: "default", label: "~/.overseer" });
    expect(storePathOf({ OVERSEER_STORE_DIR: "   " })).toMatchObject({ kind: "default", label: "~/.overseer" });
    const summary = summaryOf(call(readers({ env: { OVERSEER_STORE_DIR: "relative/store" } })));
    expect(summary.store.path.kind).toBe("unknown");
    expect(summary.store.files.kind).toBe("unknown");
    expect(summary.daemon.kind).toBe("unknown");
  });

  it("an empty store: the daemon's start is unknown because no checkpoint names an instance", () => {
    const summary = summaryOf(call(readers()));
    expect(summary.daemon.kind).toBe("unknown");
    if (summary.daemon.kind === "unknown") expect(summary.daemon.why).toContain("checkpoint");
  });

  it("is read-only, and answers only its own path", () => {
    const post = call(readers(), DIAGNOSTICS_PATH, "POST");
    expect(post.status).toBe(405);
    expect(post.headers["allow"]).toBe("GET, HEAD");
    expect(call(readers(), `${DIAGNOSTICS_PATH}/more`).status).toBe(404);
    expect(call(readers(), "/api/recovery").handled).toBe(false);
    expect(call(readers(), `${DIAGNOSTICS_PATH}?x=1`).status).toBe(200);
    const head = call(readers(), DIAGNOSTICS_PATH, "HEAD");
    expect(head.status).toBe(200);
    expect(head.raw).toBe("");
  });

  it("a reader that throws is a 500 with the reason, not a crash", () => {
    const answer = call(
      readers({
        collector: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(answer.status).toBe(500);
    expect(answer.raw).toContain("boom");
    expect(parseDiagnosticsSummary(JSON.parse(answer.raw)).kind).toBe("unreadable");
  });
});

describe("over a store the real daemon wrote", () => {
  it("the daemon's start stamp is the one its checkpoint's instance recorded", async () => {
    const root = tempRoot();
    let ms = Date.parse("2026-09-10T14:00:00.000Z");
    const revision: StartRevision = { kind: "known", sha: DAEMON_SHA, dirty: false, readAt: "2026-09-10T14:00:00.000Z" };
    const payload = (json: JsonValue): SourceMessage => ({ kind: "payload", via: "sse", atMs: 0, json });
    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: () => new Date(ms),
      tickMs: 5,
      log: () => undefined,
      revision,
      bootId: () => "0e5d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c",
      source: async function* () {
        yield payload(rawFixture("session-new-before"));
        ms += 1000;
        yield payload(rawFixture("session-new-after"));
      },
    });
    expect(outcome.kind).toBe("stopped");
    const summary = summaryOf(call(readers({ env: { OVERSEER_STORE_DIR: root } })));
    expect(summary.daemon).toMatchObject({ kind: "stamped", revision });
    const checkpoint = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(join(root, "current.json"), "utf8"))) as {
      heartbeat: { instanceId: string };
    };
    if (summary.daemon.kind === "stamped") expect(summary.daemon.instanceId).toBe(checkpoint.heartbeat.instanceId);
  });
});
