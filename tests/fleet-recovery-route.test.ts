/**
 * `GET /api/recovery` through `makeRecoveryRoute`, the composition `server.ts`
 * calls, with only its leaf readers injected — so nothing here touches
 * `~/.overseer`, and the real projection runs on every answer.
 *
 * The status codes and headers are pinned against `routes-decisions`, the
 * route this one is modelled on, by calling both rather than restating either.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import { makeDecisionsRoute, type DecisionsRouteReaders } from "../tools/fleet/routes-decisions.js";
import type { RecoveryFileLoad } from "../tools/fleet/recovery-feed.js";
import { RECOVERY_PATH, makeRecoveryRoute, type RecoveryRouteReaders } from "../tools/fleet/routes-recovery.js";

const NOW = new Date("2026-09-10T15:00:00.000Z");

type Answer = { handled: boolean; status: number; headers: Record<string, string>; raw: string; ended: Promise<void> };

function recorder(): { res: ServerResponse; answer: Answer } {
  let done!: () => void;
  const answer: Answer = { handled: false, status: 0, headers: {}, raw: "", ended: new Promise<void>((resolve) => (done = resolve)) };
  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      answer.status = code;
      answer.headers = headers ?? {};
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) answer.raw += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      done();
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, answer };
}

function readers(load: () => Promise<RecoveryFileLoad>): RecoveryRouteReaders {
  return { load, now: () => NOW };
}

async function call(load: () => Promise<RecoveryFileLoad>, url = RECOVERY_PATH, method = "GET"): Promise<Answer> {
  const { res, answer } = recorder();
  answer.handled = makeRecoveryRoute(readers(load)).handle({ method, url, headers: {} } as IncomingMessage, res);
  if (answer.handled) await answer.ended;
  return answer;
}

const published = (): Promise<RecoveryFileLoad> =>
  Promise.resolve({
    kind: "json",
    path: "/store/recovery.json",
    json: { schema: 1, writtenAt: null, replay: { kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, overflow: 0, records: [], view: null },
  });

function decisionsAnswer(url: string, method: string): Answer {
  const { res, answer } = recorder();
  const stub = { now: () => NOW } as unknown as DecisionsRouteReaders;
  answer.handled = makeDecisionsRoute(stub).handle({ method, url, headers: {} } as IncomingMessage, res);
  return answer;
}

describe("GET /api/recovery", () => {
  it("answers 200 JSON, no-store, with the projected feed", async () => {
    const answer = await call(published);
    expect(answer.status).toBe(200);
    expect(answer.headers).toEqual({ "content-type": "application/json", "cache-control": "no-store" });
    expect(JSON.parse(answer.raw)).toMatchObject({ schema: 1, kind: "published", composedAt: NOW.toISOString(), records: [] });
  });

  it("the same headers as /api/decisions on a successful answer", async () => {
    const answer = await call(published);
    // decisions' 200 header set, from its source of truth rather than restated.
    const { res, answer: theirs } = recorder();
    const stub: DecisionsRouteReaders = {
      decisionFileSize: () => null,
      readDecisions: () => ({ kind: "never-written" }) as ReturnType<DecisionsRouteReaders["readDecisions"]>,
      loadCheckpoint: () => ({ kind: "absent" }),
      now: () => NOW,
    };
    makeDecisionsRoute(stub).handle({ method: "GET", url: "/api/decisions", headers: {} } as IncomingMessage, res);
    expect(theirs.status).toBe(200);
    expect(answer.headers).toEqual(theirs.headers);
  });

  it("carries every failure arm through as itself, never as an empty list", async () => {
    for (const load of [
      { kind: "absent", path: "/store/recovery.json" },
      { kind: "unreadable", why: "EACCES" },
      { kind: "oversized", path: "/store/recovery.json", sizeBytes: 2, limitBytes: 1 },
    ] as RecoveryFileLoad[]) {
      const answer = await call(() => Promise.resolve(load));
      const body = JSON.parse(answer.raw) as Record<string, unknown>;
      expect(answer.status).toBe(200);
      expect(body["kind"]).toBe(load.kind);
      expect(body).not.toHaveProperty("records");
    }
  });

  it("HEAD answers the headers and no body", async () => {
    const answer = await call(published, RECOVERY_PATH, "HEAD");
    expect(answer.status).toBe(200);
    expect(answer.raw).toBe("");
  });

  it("a query string is still this route", async () => {
    expect((await call(published, `${RECOVERY_PATH}?t=1`)).status).toBe(200);
  });

  it("a reader that throws is a 500 with the reason, not a hang", async () => {
    const answer = await call(() => Promise.reject(new Error("disk on fire")));
    expect(answer.status).toBe(500);
    expect(JSON.parse(answer.raw)).toMatchObject({ kind: "unreadable", why: expect.stringMatching(/disk on fire/) });
  });

  it("answers the handler at once and reads afterwards: the request thread does not wait on the disk", async () => {
    let release!: (load: RecoveryFileLoad) => void;
    const pending = new Promise<RecoveryFileLoad>((resolve) => (release = resolve));
    const { res, answer } = recorder();
    const handled = makeRecoveryRoute(readers(() => pending)).handle({ method: "GET", url: RECOVERY_PATH, headers: {} } as IncomingMessage, res);
    expect(handled).toBe(true);
    expect(answer.status).toBe(0);
    release({ kind: "absent", path: "/store/recovery.json" });
    await answer.ended;
    expect(answer.status).toBe(200);
  });
});

describe("only GET: the statuses and headers match routes-decisions", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    it(`${method} is 405 with Allow, exactly as /api/decisions answers it`, async () => {
      let reads = 0;
      const answer = await call(() => {
        reads += 1;
        return published();
      }, RECOVERY_PATH, method);
      const theirs = decisionsAnswer("/api/decisions", method);
      expect(answer.status).toBe(405);
      expect(answer.status).toBe(theirs.status);
      expect(answer.headers).toEqual(theirs.headers);
      expect(answer.headers["allow"]).toBe("GET, HEAD");
      expect(reads).toBe(0);
    });
  }

  it("a path under the route is 404, exactly as /api/decisions answers one", async () => {
    const answer = await call(published, `${RECOVERY_PATH}/dismiss`);
    const theirs = decisionsAnswer("/api/decisions/review", "GET");
    expect(answer.status).toBe(404);
    expect(answer.status).toBe(theirs.status);
    expect(answer.headers).toEqual(theirs.headers);
  });

  it("does not claim a path that is not its own", async () => {
    const answer = await call(published, "/api/decisions");
    expect(answer.handled).toBe(false);
  });
});
