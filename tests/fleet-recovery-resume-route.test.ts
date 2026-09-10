/**
 * `POST /api/recovery/resume` through `makeRecoveryResumeRoute`, the
 * composition `server.ts` calls, with only the store root and the clock
 * injected — so the request leaf is Stage 1's real one, writing real files in a
 * temp store, and `recovery.json` is read through the real `recovery-feed.ts`.
 *
 * What it proves: the CSRF defence (`checkRequest`) runs before anything is
 * read or written; a bad body writes nothing; `already-requested` and
 * `already-launched` write nothing; and the route claims its one path and no
 * other, so `/api/recovery` stays the inventory's.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { RECOVERY_RESUME_DIR } from "../tools/overseer/recovery-resume-request.js";
import { RECOVERY_RESUME_PATH, makeRecoveryResumeRoute, type RecoveryResumeRouteDeps } from "../tools/fleet/routes-recovery-resume.js";

const NOW = new Date("2026-09-10T15:00:00.000Z");
const HOST = "127.0.0.1:8799";
const CANDIDATE = "rc-0123456789abcdef0123";
const CONVERSATION = "b7e2d4a9-5c31-4f86-9a0e-3d8c6f1b2e75";
const SEEN = { checkedAt: "2026-09-10T14:58:00.000Z", conversationId: CONVERSATION, dir: "/work/resume-me" };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-recovery-resume-route-"));
  dirs.push(dir);
  return dir;
}

type Answer = { handled: boolean; status: number; headers: Record<string, string>; json: Record<string, unknown> | null; ended: Promise<void> };

function sameOrigin(over: Record<string, string | undefined> = {}): Record<string, string> {
  const headers: Record<string, string | undefined> = { host: HOST, origin: `http://${HOST}`, "content-type": "application/json", ...over };
  return Object.fromEntries(Object.entries(headers).filter((e): e is [string, string] => e[1] !== undefined));
}

async function call(
  root: string,
  opts: { method?: string; url?: string; headers?: Record<string, string>; body?: string; deps?: Partial<RecoveryResumeRouteDeps> } = {},
): Promise<Answer> {
  let done!: () => void;
  const answer: Answer = { handled: false, status: 0, headers: {}, json: null, ended: new Promise<void>((resolve) => (done = resolve)) };
  let raw = "";
  const res = {
    writeHead(code: number, headers?: Record<string, string>) {
      answer.status = code;
      answer.headers = headers ?? {};
      return res;
    },
    end(chunk?: string) {
      raw += chunk ?? "";
      answer.json = raw === "" ? null : (JSON.parse(raw) as Record<string, unknown>);
      done();
      return res;
    },
  };
  const req = Object.assign(Readable.from(opts.body === undefined ? [] : [Buffer.from(opts.body)]), {
    method: opts.method ?? "POST",
    url: opts.url ?? RECOVERY_RESUME_PATH,
    headers: opts.headers ?? sameOrigin(),
  });
  answer.handled = makeRecoveryResumeRoute({ root: () => root, now: () => NOW, ...opts.deps }).handle(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  if (answer.handled) await answer.ended;
  return answer;
}

const body = (over: Record<string, unknown> = {}): string => JSON.stringify({ candidateId: CANDIDATE, seen: SEEN, ...over });

/** Every file the leaf has written, anywhere under its directory. */
function written(root: string): string[] {
  try {
    return (readdirSync(join(root, RECOVERY_RESUME_DIR), { recursive: true }) as string[]).filter((p) => p.endsWith(".json"));
  } catch {
    return [];
  }
}

function pending(root: string): string[] {
  try {
    return readdirSync(join(root, RECOVERY_RESUME_DIR, "pending")).filter((p) => p.endsWith(".json"));
  } catch {
    return [];
  }
}

/** A minimal `recovery.json` holding the candidate, with a `resume` field whose request for it is `state`. */
function writeIndex(root: string, state: Record<string, unknown>): void {
  const key = "$4 none";
  const record = {
    id: CANDIDATE,
    key,
    name: "session-resume-me",
    at: "2026-09-10T14:00:00.000Z",
    origin: "journal",
    resolution: { disposition: "unresolved" },
    oversize: false,
    entry: { key, meta: { version: 1, kind: "claude", dir: SEEN.dir }, worktree: null, lastSeenAlive: "2026-09-10T13:00:00.000Z", lastStatusKey: "working" },
    lastSeen: null,
    disappearance: { goneWhy: "tmux-server-changed", generation: "changed", bootChanged: true, producerRun: "changed", watched: true },
  };
  const resume = {
    schema: 1,
    writtenAt: "2026-09-10T14:59:00.000Z",
    launcher: { kind: "wired" },
    gate: null,
    pace: { kind: "free" },
    requests: [{ candidateId: CANDIDATE, name: "session-resume-me", state }],
    previews: [],
    pendingOverflow: 0,
  };
  const json = { schema: 1, writtenAt: "2026-09-10T14:59:00.000Z", replay: { kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, overflow: 0, records: [record], view: null, resume };
  writeFileSync(join(root, "recovery.json"), JSON.stringify(json));
}

const LAUNCH = { occurrenceId: "lo-1", state: "observed-running", attempt: 1, reservationHeld: false, disposed: false, endedAt: null, completion: null };

describe("G18: a candidate the readable index does not hold is refused before anything is written", () => {
  it("a valid id absent from recovery.json's records: 409 no such interrupted record, and no request file", async () => {
    const root = tempRoot();
    writeIndex(root, { kind: "refused", requestedAt: "2026-09-10T14:50:00.000Z", refusedAt: "2026-09-10T14:51:00.000Z", why: "the directory is gone" });
    const absent = "rc-ffffffffffffffffffff";
    const answer = await call(root, { body: body({ candidateId: absent }) });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ ok: false });
    expect(String(answer.json?.["why"])).toContain("no such interrupted record");
    expect(written(root)).toEqual([]);
    // The candidate it does hold is still queued.
    expect((await call(root, { body: body() })).status).toBe(202);
  });

  it("no index, or one that cannot be read, stops nothing: membership is not known, and the daemon revalidates", async () => {
    expect((await call(tempRoot(), { body: body() })).status).toBe(202);
    const root = tempRoot();
    writeFileSync(join(root, "recovery.json"), "{not json");
    expect((await call(root, { body: body() })).status).toBe(202);
  });
});

describe("POST /api/recovery/resume: queues one request through the leaf", () => {
  it("a same-origin JSON POST answers 202 queued, and exactly one pending file appears, from the dashboard, with what was seen", async () => {
    const root = tempRoot();
    const answer = await call(root, { body: body() });
    expect(answer.status).toBe(202);
    expect(answer.json).toEqual({ ok: true, outcome: "queued", candidateId: CANDIDATE });
    const files = pending(root);
    expect(files).toHaveLength(1);
    const request = JSON.parse(readFileSync(join(root, RECOVERY_RESUME_DIR, "pending", files[0] as string), "utf8")) as Record<string, unknown>;
    expect(request).toMatchObject({ candidateId: CANDIDATE, actor: "dashboard", requestedAt: NOW.toISOString(), seen: SEEN });
    expect(answer.headers["content-type"]).toBe("application/json");
    expect(answer.headers["cache-control"]).toBe("no-store");
  });

  it("a second tap answers 200 already-requested and writes nothing more", async () => {
    const root = tempRoot();
    expect((await call(root, { body: body() })).status).toBe(202);
    const second = await call(root, { body: body() });
    expect(second.status).toBe(200);
    expect(second.json).toEqual({ ok: true, outcome: "already-requested", candidateId: CANDIDATE });
    expect(pending(root)).toHaveLength(1);
    expect(written(root)).toHaveLength(1);
  });

  it("a request the projection shows pending answers already-requested and writes nothing", async () => {
    const root = tempRoot();
    writeIndex(root, { kind: "pending", position: 1, requestedAt: "2026-09-10T14:50:00.000Z", actor: "cli", why: "waiting for the gate", until: null });
    const answer = await call(root, { body: body() });
    expect(answer.json).toEqual({ ok: true, outcome: "already-requested", candidateId: CANDIDATE });
    expect(written(root)).toEqual([]);
  });

  const launchedStates: [string, Record<string, unknown>][] = [
    [
      "launched",
      {
        kind: "launched",
        requestedAt: "2026-09-10T14:50:00.000Z",
        launch: LAUNCH,
        verification: { inventoryResumed: false, observedRunning: true, transcriptGrew: false, sessionLineSeen: false },
        waitingFor: "the inventory to see it",
      },
    ],
    ["resumed", { kind: "resumed", requestedAt: "2026-09-10T14:50:00.000Z", launch: LAUNCH, verifiedAt: "2026-09-10T14:55:00.000Z" }],
    ["needs-greg", { kind: "needs-greg", requestedAt: "2026-09-10T14:50:00.000Z", launch: { ...LAUNCH, state: "outcome-unknown" }, why: "unknown", disposeCommand: "dispose lo-1" }],
    [
      "ended-unverified",
      { kind: "ended-unverified", requestedAt: "2026-09-10T14:50:00.000Z", launch: { ...LAUNCH, state: "completed", completion: { kind: "rebooted" } }, how: "the box rebooted" },
    ],
    ["disposed", { kind: "disposed", requestedAt: "2026-09-10T14:50:00.000Z", launch: { ...LAUNCH, disposed: true } }],
  ];
  for (const [name, state] of launchedStates) {
    it(`a candidate the projection shows ${name} answers 200 already-launched and writes nothing`, async () => {
      const root = tempRoot();
      writeIndex(root, state);
      const answer = await call(root, { body: body() });
      expect(answer.status).toBe(200);
      expect(answer.json).toEqual({ ok: true, outcome: "already-launched", candidateId: CANDIDATE });
      expect(written(root)).toEqual([]);
    });
  }

  it("a refused request in the projection does not stop a new one: Resume is offered again", async () => {
    const root = tempRoot();
    writeIndex(root, { kind: "refused", requestedAt: "2026-09-10T14:50:00.000Z", refusedAt: "2026-09-10T14:51:00.000Z", why: "the directory is gone" });
    const answer = await call(root, { body: body() });
    expect(answer.status).toBe(202);
    expect(pending(root)).toHaveLength(1);
  });

  it("an index it cannot read does not stop a request: the daemon revalidates, and the route is only a courtesy", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "recovery.json"), "{not json");
    expect((await call(root, { body: body() })).status).toBe(202);
    expect(pending(root)).toHaveLength(1);
  });

  it("the leaf's refusal is 409 with its reason", async () => {
    const root = tempRoot();
    const answer = await call(root, { body: body(), deps: { writeResumeRequest: () => ({ kind: "refused", why: "the pending directory is not a directory" }) } });
    expect(answer.status).toBe(409);
    expect(answer.json).toEqual({ ok: false, why: expect.stringMatching(/not a directory/) });
  });

  it("a leaf that throws is a 500 with the reason, not a hang", async () => {
    const root = tempRoot();
    const answer = await call(root, {
      body: body(),
      deps: {
        pendingFor: () => {
          throw new Error("disk on fire");
        },
      },
    });
    expect(answer.status).toBe(500);
    expect(answer.json).toEqual({ ok: false, why: expect.stringMatching(/disk on fire/) });
  });
});

describe("the CSRF defence runs first: nothing is written without it", () => {
  const refusals: [string, Record<string, string>, number][] = [
    ["a missing Origin", sameOrigin({ origin: undefined }), 403],
    ["a foreign Origin", sameOrigin({ origin: "http://evil.example" }), 403],
    ["the literal Origin null", sameOrigin({ origin: "null" }), 403],
    ["a cross-site fetch", sameOrigin({ "sec-fetch-site": "cross-site" }), 403],
    ["a form's content type", sameOrigin({ "content-type": "application/x-www-form-urlencoded" }), 415],
    ["text/plain, which a form can also send", sameOrigin({ "content-type": "text/plain" }), 415],
  ];
  for (const [name, headers, status] of refusals) {
    it(`refuses ${name} with ${status}, and writes nothing`, async () => {
      const root = tempRoot();
      const answer = await call(root, { headers, body: body() });
      expect(answer.status).toBe(status);
      expect(answer.json).toMatchObject({ ok: false, why: expect.any(String) });
      expect(written(root)).toEqual([]);
    });
  }
});

describe("a bad body is 400 and writes nothing", () => {
  const bodies: [string, string][] = [
    ["bytes that are not JSON", "{candidateId:"],
    ["an empty body", ""],
    ["a list", "[]"],
    ["no seen", JSON.stringify({ candidateId: CANDIDATE })],
    ["a candidate id that is not one", body({ candidateId: "rc-../../etc" })],
    ["a candidate id with a path in it", body({ candidateId: `${CANDIDATE}/x` })],
    ["seen with no conversation", body({ seen: { checkedAt: SEEN.checkedAt, dir: SEEN.dir } })],
    ["seen at a time that is not a timestamp", body({ seen: { ...SEEN, checkedAt: "earlier" } })],
    ["seen in a relative directory", body({ seen: { ...SEEN, dir: "work/x" } })],
  ];
  for (const [name, raw] of bodies) {
    it(`refuses ${name}`, async () => {
      const root = tempRoot();
      const answer = await call(root, { body: raw });
      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({ ok: false, why: expect.any(String) });
      expect(written(root)).toEqual([]);
    });
  }

  it("refuses a body over the cap with 413", async () => {
    const root = tempRoot();
    const answer = await call(root, { body: body({ seen: { ...SEEN, dir: `/${"x".repeat(20_000)}` } }) });
    expect(answer.status).toBe(413);
    expect(written(root)).toEqual([]);
  });
});

describe("its one path, POST only", () => {
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"]) {
    it(`${method} is 405 with Allow: POST, and writes nothing`, async () => {
      const root = tempRoot();
      const answer = await call(root, { method, body: body() });
      expect(answer.status).toBe(405);
      expect(answer.headers["allow"]).toBe("POST");
      expect(written(root)).toEqual([]);
    });
  }

  it("a query string is still this route", async () => {
    expect((await call(tempRoot(), { url: `${RECOVERY_RESUME_PATH}?t=1`, body: body() })).status).toBe(202);
  });

  it("does not claim /api/recovery, or any path that is not exactly its own", async () => {
    for (const url of ["/api/recovery", "/api/recovery?x=1", "/api/recovery/resumes", "/api/recovery/resume/x", "/api/sessions/new"]) {
      expect((await call(tempRoot(), { url, body: body() })).handled, url).toBe(false);
    }
  });

  it("the handler answers at once and does its work afterwards", () => {
    const root = tempRoot();
    const req = Object.assign(Readable.from([Buffer.from(body())]), { method: "POST", url: RECOVERY_RESUME_PATH, headers: sameOrigin() });
    let status = 0;
    const res = {
      writeHead(code: number) {
        status = code;
        return res;
      },
      end() {
        return res;
      },
    };
    const handled = makeRecoveryResumeRoute({ root: () => root, now: () => NOW }).handle(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    expect(handled).toBe(true);
    expect(status).toBe(0);
  });
});

describe("it never launches, and never reads tmux or the launch store", () => {
  it("imports only the leaf, the feed reader, the store root and the request checks", () => {
    const source = readFileSync(fileURLToPath(new URL("../tools/fleet/routes-recovery-resume.ts", import.meta.url)), "utf8");
    const specifiers = [...source.matchAll(/^import[^;]*?from\s+"([^"]+)";/gms)].map((m) => m[1]).sort();
    expect(specifiers).toEqual(["../overseer/recovery-resume-request.js", "./attention.js", "./recovery-feed.js", "./routes-new.js", "./wire.js", "node:http"].sort());
    // The code, not the prose: the header says in words what it never does.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/child_process|tmux|launch-protocol|launch-store|spawn|exec\(/);
  });
});

it("makes its temp stores under the system temp directory, never the live one", () => {
  const root = tempRoot();
  mkdirSync(join(root, "probe"));
  expect(root.startsWith(tmpdir())).toBe(true);
});
