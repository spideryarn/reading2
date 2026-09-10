import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { ADMISSION_POLICY_VERSION, FIXED_RUN_PEAK_BYTES, PER_WORKER_PEAK_BYTES } from "../vitest-admission.js";
import { makeAdmission } from "../tools/fleet/admission-wiring.js";
import { ADMISSION_PATH, admissionRoute, type AdmissionRouteDeps } from "../tools/fleet/routes-admission.js";
import type { AdmissionRefusalJournal } from "../tools/fleet/wire.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function deps(over: Partial<AdmissionRouteDeps> = {}): AdmissionRouteDeps {
  return {
    nowMs: () => 1_789_000_000_000,
    readMemorySnapshot: () => ({
      kind: "linux",
      availableBytes: FIXED_RUN_PEAK_BYTES + 10 * PER_WORKER_PEAK_BYTES,
      swapTotalBytes: 0,
      swapFreeBytes: 0,
    }),
    readReserveBytes: () => 1,
    resolveParallelWorkers: () => 2,
    policyVersion: ADMISSION_POLICY_VERSION,
    readRefusals: () => ({ kind: "read", entries: [], unparseableLines: 0 }),
    ...over,
  };
}

function get(
  route: ReturnType<typeof admissionRoute>,
  url: string,
  method = "GET",
): { handled: boolean; status: number; headers: Record<string, string>; body: Record<string, unknown> | null } {
  let status = 0;
  let headers: Record<string, string> = {};
  let raw = "";
  const res = {
    writeHead(code: number, nextHeaders: Record<string, string>) {
      status = code;
      headers = nextHeaders;
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) raw = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return res;
    },
  };
  const handled = route.handle(
    { method, url, headers: {} } as unknown as import("node:http").IncomingMessage,
    res as unknown as import("node:http").ServerResponse,
  );
  return { handled, status, headers, body: raw === "" ? null : (JSON.parse(raw) as Record<string, unknown>) };
}

describe("GET /api/admission", () => {
  it("handles the exact path with a query string", () => {
    const answer = get(admissionRoute(deps()), `${ADMISSION_PATH}?kind=test`);
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(200);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(answer.body?.schema).toBe(1);
  });

  const journalArms: AdmissionRefusalJournal[] = [
    { kind: "read", entries: [], unparseableLines: 0 },
    { kind: "directory-absent" },
    { kind: "unreadable", why: "the journal file was denied" },
  ];

  it.each(journalArms)("carries the journal's $kind arm independently of the forecast", (journal) => {
    const answer = get(admissionRoute(deps({ readRefusals: () => journal })), ADMISSION_PATH);
    expect(answer.status).toBe(200);
    expect(answer.body?.journal).toEqual(journal);
    expect(answer.body?.outcome).toMatchObject({ kind: "would-admit" });
  });

  it("answers a suffix under the admission prefix with the explicit 404 arm", () => {
    const answer = get(admissionRoute(deps()), `${ADMISSION_PATH}/x`);
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(404);
    expect(answer.body).toEqual({ error: "route-not-found", why: `no such route: ${ADMISSION_PATH}/x` });
    expect(answer.body).not.toHaveProperty("schema");
    expect(answer.body).not.toHaveProperty("kind");
  });

  it("refuses a write method before asking any admission reader", () => {
    const read = () => {
      throw new Error("a read-only route tried to read for POST");
    };
    const answer = get(
      admissionRoute(
        deps({
          readMemorySnapshot: read,
          readReserveBytes: read,
          resolveParallelWorkers: read,
        }),
      ),
      ADMISSION_PATH,
      "POST",
    );

    expect(answer.status).toBe(405);
    expect(answer.headers.allow).toBe("GET, HEAD");
    expect(answer.body).toEqual({
      error: "method-not-allowed",
      why: "this admission route is read-only; use GET or HEAD",
    });
  });

  it("supports HEAD without sending the forecast body", () => {
    const answer = get(admissionRoute(deps()), ADMISSION_PATH, "HEAD");
    expect(answer.status).toBe(200);
    expect(answer.body).toBeNull();
  });

  it("suppresses HEAD bodies on error responses too", () => {
    const notFound = get(admissionRoute(deps()), `${ADMISSION_PATH}/x`, "HEAD");
    const internalError = get(
      admissionRoute(
        deps({
          nowMs: () => {
            throw new Error("clock exploded");
          },
        }),
      ),
      ADMISSION_PATH,
      "HEAD",
    );

    expect(notFound.status).toBe(404);
    expect(notFound.body).toBeNull();
    expect(internalError.status).toBe(500);
    expect(internalError.body).toBeNull();
  });

  it("returns false for a different route", () => {
    const answer = get(admissionRoute(deps()), "/api/state");
    expect(answer.handled).toBe(false);
    expect(answer.status).toBe(0);
    expect(answer.body).toBeNull();
  });

  it("turns an unexpected payload failure into a stated 500 answer", () => {
    const answer = get(
      admissionRoute(
        deps({
          nowMs: () => {
            throw new Error("clock exploded");
          },
        }),
      ),
      ADMISSION_PATH,
    );
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(500);
    expect(answer.body).toEqual({
      error: "internal-error",
      why: "building the admission answer threw: clock exploded",
    });
  });
});

describe("the production composition", () => {
  it("uses the wall clock when production does not inject one", () => {
    const before = Date.now();
    const composed = makeAdmission();
    const composedNow = composed.deps.nowMs();
    const after = Date.now();

    expect(composedNow).toBeGreaterThanOrEqual(before);
    expect(composedNow).toBeLessThanOrEqual(after);
  });

  it("drives injected readers through the same makeAdmission function server.ts calls", () => {
    const composed = makeAdmission({
      nowMs: () => 1_789_000_000_000,
      meminfoPath: "/definitely/not/proc/meminfo",
      reserveFile: "/definitely/no/reserve/file",
      workersFile: "/definitely/no/workers/file",
    });
    const answer = get(composed.route, ADMISSION_PATH);
    expect(answer.status).toBe(200);
    expect(answer.body?.outcome).toMatchObject({ kind: "not-applicable" });
    expect(composed.deps.readMemorySnapshot().kind).toBe("broken");
  });

  it("carries the composed worker-file reader all the way into the route answer", () => {
    const dir = mkdtempSync(join(tmpdir(), "fleet-admission-wiring-"));
    dirs.push(dir);
    const meminfoPath = join(dir, "meminfo");
    const reserveFile = join(dir, "reserve");
    const workersFile = join(dir, "workers");
    writeFileSync(meminfoPath, "MemAvailable: 20000000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n");
    writeFileSync(reserveFile, "1\n");
    writeFileSync(workersFile, "3\n");

    const computedAtMs = 1_789_123_456_789;
    const composed = makeAdmission({ nowMs: () => computedAtMs, meminfoPath, reserveFile, workersFile });
    const answer = get(composed.route, ADMISSION_PATH);

    expect(answer.status).toBe(200);
    expect(answer.body?.outcome).toMatchObject({
      kind: "would-admit",
      nominalWorkers: 3,
      nominalWorkersSource: "machine-default",
    });
    expect(answer.body?.computedAtMs).toBe(computedAtMs);
    expect(answer.body?.policy).toMatchObject({ gateVersion: ADMISSION_POLICY_VERSION });
  });
});

describe("server.ts", () => {
  const source = readFileSync(join(REPO, "tools", "fleet", "server.ts"), "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  it("mounts the admission route in uncommented request-path code", () => {
    expect(code).toContain("if (admission.route.handle(req, res)) return;");
  });

  it("builds the admission composition exactly once", () => {
    expect(code.filter((line) => line.includes("makeAdmission("))).toHaveLength(1);
  });
});

/**
 * **The caller's clock is the caller's, or it is nothing.**
 *
 * `requestedAtClientMs` is documented on the wire as the CALLER's clock, and the
 * plan review that introduced it (F7) asked for exactly that: diagnostic only,
 * never sorted on, with any future ordering field stamped `receivedAtMs` by
 * whatever owns admission. Nothing over HTTP supplies a caller clock today, so
 * the honest value is null.
 *
 * The first version of this route filled it from `deps.nowMs()` — the SERVER's
 * clock — which is a true number under a false label, and the failure is the
 * quiet kind: a later queue reading this field would sort on server time
 * believing it held client time, or believe it had client data it never
 * received. The assertion names the server clock specifically rather than only
 * checking for null, so that refilling the field from any server-side instant
 * goes red instead of passing a looser check.
 */
describe("the caller's clock", () => {
  it("is null over HTTP, and is never the server's clock wearing the caller's name", () => {
    const serverClock = 1_789_000_000_000;
    const answer = get(admissionRoute(deps({ nowMs: () => serverClock })), `${ADMISSION_PATH}?kind=test`);

    const request = answer.body?.request as Record<string, unknown>;
    expect(request.requestedAtClientMs).toBeNull();
    expect(request.requestedAtClientMs).not.toBe(serverClock);
    /* The server's own stamp still has a home, and it is a different field. */
    expect(answer.body?.computedAtMs).toBe(serverClock);
  });

  it("does not invent a caller-declared cost when the HTTP API accepts none", () => {
    const answer = get(admissionRoute(deps()), `${ADMISSION_PATH}?kind=browser&cost=light`);
    const request = answer.body?.request as Record<string, unknown>;

    expect(request.cost).toBeNull();
    expect(request.cost).not.toBe("heavy");
    expect(request.cost).not.toBe("light");
  });
});
