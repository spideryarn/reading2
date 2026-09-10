import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADMISSION_POLICY_VERSION,
  decideAdmission,
  FIXED_RUN_PEAK_BYTES,
  PER_WORKER_PEAK_BYTES,
  readMemorySnapshot,
  readReserveBytes,
  resolveParallelWorkers,
  type MemorySnapshot,
} from "../vitest-admission.js";
import {
  admissionPayload,
  explainAdmission,
  parseAdmissionRequest,
  type AdmissionRouteDeps,
} from "../tools/fleet/routes-admission.js";
import type { AdmissionPayload, AdmissionRequest } from "../tools/fleet/wire.js";

const dirs: string[] = [];
const previousOverride = process.env.VITEST_MAX_WORKERS;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (previousOverride === undefined) delete process.env.VITEST_MAX_WORKERS;
  else process.env.VITEST_MAX_WORKERS = previousOverride;
});

function tempFile(name: string, contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-admission-"));
  dirs.push(dir);
  const file = join(dir, name);
  if (contents !== undefined) writeFileSync(file, contents);
  return file;
}

function request(kind: AdmissionRequest["kind"] = "test"): AdmissionRequest {
  return { kind, cost: "heavy", owner: null, requestedAtClientMs: 1_789_000_000_000 };
}

function linux(availableBytes: number): MemorySnapshot {
  return { kind: "linux", availableBytes, swapTotalBytes: 0, swapFreeBytes: 0 };
}

function values(over: Partial<Parameters<typeof explainAdmission>[0]> = {}): Parameters<typeof explainAdmission>[0] {
  return {
    snapshot: linux(FIXED_RUN_PEAK_BYTES + 10 * PER_WORKER_PEAK_BYTES),
    reserveBytes: 1,
    nominalWorkers: 2,
    policyVersion: ADMISSION_POLICY_VERSION,
    request: request(),
    ...over,
  };
}

function routeDeps(over: Partial<AdmissionRouteDeps> = {}): AdmissionRouteDeps {
  return {
    nowMs: () => 1_789_000_000_000,
    readMemorySnapshot: () => linux(FIXED_RUN_PEAK_BYTES + 10 * PER_WORKER_PEAK_BYTES),
    readReserveBytes: () => 1,
    resolveParallelWorkers: () => 2,
    policyVersion: ADMISSION_POLICY_VERSION,
    ...over,
  };
}

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

describe("the gate forecast", () => {
  it("carries the gate's own low-memory refusal, including its nothing-was-verified warning", () => {
    const input = values({ snapshot: linux(0) });
    const gate = decideAdmission(input);
    expect(gate.kind).toBe("refuse");

    const answer = explainAdmission(input);
    expect(answer.outcome).toEqual({ kind: "would-refuse", why: gate.kind === "refuse" ? gate.message : "" });
    expect(answer.outcome.kind === "would-refuse" ? answer.outcome.why : "").toContain(
      "NO TESTS RAN AND NOTHING WAS VERIFIED",
    );
  });

  it("reports an unreadable Linux memory check as the gate's would-refuse, not unknown", () => {
    const reserveBytes = 1024;
    const snapshot = readMemorySnapshot(tempFile("absent-meminfo"));
    const gate = decideAdmission({ nominalWorkers: 2, snapshot, reserveBytes });
    expect(snapshot.kind).toBe("broken");
    expect(gate.kind).toBe("refuse");

    const answer = explainAdmission(values({ snapshot, reserveBytes }));
    expect(answer.outcome).toEqual({ kind: "would-refuse", why: gate.kind === "refuse" ? gate.message : "" });
    expect(answer.outcome.kind === "would-refuse" ? answer.outcome.why : "").toContain("broken check");
  });

  it("reports an absent reserve file as not-applicable", () => {
    const missing = tempFile("absent-reserve");
    const answer = admissionPayload(routeDeps({ readReserveBytes: () => readReserveBytes(missing) }), request());
    expect(answer.outcome.kind).toBe("not-applicable");
  });

  it("reports an empty reserve file as unknown and carries the reader's message", () => {
    const file = tempFile("empty-reserve", "");
    let thrown = "";
    try {
      readReserveBytes(file);
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    const answer = admissionPayload(routeDeps({ readReserveBytes: () => readReserveBytes(file) }), request());
    expect(answer.outcome).toEqual({ kind: "unknown", why: thrown });
    expect(thrown).toContain("exists but is empty");
  });

  it("reports a non-numeric reserve file as unknown and carries the reader's message", () => {
    const file = tempFile("garbage-reserve", "many");
    let thrown = "";
    try {
      readReserveBytes(file);
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    const answer = admissionPayload(routeDeps({ readReserveBytes: () => readReserveBytes(file) }), request());
    expect(answer.outcome).toEqual({ kind: "unknown", why: thrown });
    expect(thrown).toContain("must be a positive number");
  });

  it("reports a bad worker-count file as unknown and carries the reader's message", () => {
    const file = tempFile("garbage-workers", "1.5");
    let thrown = "";
    try {
      resolveParallelWorkers(file);
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    const answer = admissionPayload(
      routeDeps({ resolveParallelWorkers: () => resolveParallelWorkers(file) }),
      request(),
    );
    expect(answer.outcome).toEqual({ kind: "unknown", why: thrown });
    expect(thrown).toContain("must be a whole number of workers");
  });

  it("uses the config's worker-memory-reserve read order when more than one input is broken", () => {
    const order: string[] = [];
    const answer = admissionPayload(
      routeDeps({
        resolveParallelWorkers: () => {
          order.push("workers");
          return 2;
        },
        readMemorySnapshot: () => {
          order.push("memory");
          return { kind: "broken", why: "memory also broke" };
        },
        readReserveBytes: () => {
          order.push("reserve");
          throw new Error("reserve also broke");
        },
      }),
      request(),
    );
    expect(order).toEqual(["workers", "memory", "reserve"]);
    expect(answer.outcome).toEqual({ kind: "unknown", why: "reserve also broke" });
  });

  it("reports would-reduce when the gate's capacity is below the machine's nominal ask", () => {
    const reserveBytes = 1024;
    const snapshot = linux(reserveBytes + FIXED_RUN_PEAK_BYTES + PER_WORKER_PEAK_BYTES);
    const gate = decideAdmission({ nominalWorkers: 3, snapshot, reserveBytes });
    expect(gate.kind).toBe("admit");

    const answer = explainAdmission(values({ snapshot, reserveBytes, nominalWorkers: 3 }));
    expect(answer.outcome.kind).toBe("would-reduce");
    if (answer.outcome.kind === "would-reduce" && gate.kind === "admit") {
      expect(answer.outcome.workers).toBe(gate.workers);
      expect(answer.outcome.capacity).toBe(gate.capacity);
    }
  });

  it("reports would-admit when capacity equals or exceeds the machine's nominal ask", () => {
    const reserveBytes = 1024;
    for (const capacity of [3, 4]) {
      const snapshot = linux(reserveBytes + FIXED_RUN_PEAK_BYTES + capacity * PER_WORKER_PEAK_BYTES);
      const answer = explainAdmission(values({ snapshot, reserveBytes, nominalWorkers: 3 }));
      expect(answer.outcome.kind).toBe("would-admit");
    }
  });

  it("withholds unfamiliar policy prose while retaining the gate's live numbers", () => {
    const gate = decideAdmission(values());
    expect(gate.kind).toBe("admit");

    const answer = explainAdmission(values({ policyVersion: 999 }));
    expect(answer.policy).toEqual({
      gateVersion: 999,
      explanation: null,
      whyWithheld: "this dashboard has no explanation for admission policy v999; the numbers below are live, the wording is withheld",
    });
    expect(answer.outcome).toMatchObject(
      gate.kind === "admit"
        ? { workers: gate.workers, capacity: gate.capacity, availableBytes: gate.availableBytes, reserveBytes: gate.reserveBytes }
        : {},
    );
  });

  it.each(["review", "browser"] as const)("answers %s with not-modelled without calling the gate", (kind) => {
    const gate = vi.fn(() => {
      throw new Error("the vitest cost model was called");
    });
    const read = vi.fn(() => {
      throw new Error("a vitest-only machine input was read");
    });
    const answer = admissionPayload(
      routeDeps({
        readMemorySnapshot: read,
        readReserveBytes: read,
        resolveParallelWorkers: read,
        decideAdmission: gate,
      }),
      request(kind),
    );
    expect(answer.label).toBe("not-modelled");
    expect(answer.outcome).toEqual({
      kind: "not-modelled",
      why: `no measured cost model or launch gate exists for ${kind} work`,
    });
    expect(gate).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves VITEST_MAX_WORKERS while forecasting the machine default", () => {
    const file = tempFile("workers", "3");
    process.env.VITEST_MAX_WORKERS = "7";
    const deps = routeDeps({ resolveParallelWorkers: () => resolveParallelWorkers(file) });

    const answer = admissionPayload(deps, request());

    expect(process.env.VITEST_MAX_WORKERS).toBe("7");
    expect(answer.outcome).toMatchObject({ nominalWorkers: 3, nominalWorkersSource: "machine-default" });
  });

  it("gives two successive forecasts the same machine-default worker ask", () => {
    const file = tempFile("workers", "3");
    process.env.VITEST_MAX_WORKERS = "7";
    const deps = routeDeps({ resolveParallelWorkers: () => resolveParallelWorkers(file) });

    const first = admissionPayload(deps, request());
    const second = admissionPayload(deps, request());

    expect(first).toEqual(second);
    expect(first.outcome).toMatchObject({ nominalWorkers: 3 });
  });

  it("uses only honest labels and carries the command-line override caveat", () => {
    const clientTimedRequest = { ...request(), requestedAtClientMs: 123 };
    const observationOrder: string[] = [];
    const timedDeps = routeDeps({
      resolveParallelWorkers: () => {
        observationOrder.push("workers");
        return 2;
      },
      readMemorySnapshot: () => {
        observationOrder.push("memory");
        return linux(FIXED_RUN_PEAK_BYTES + 10 * PER_WORKER_PEAK_BYTES);
      },
      readReserveBytes: () => {
        observationOrder.push("reserve");
        return 1;
      },
      nowMs: () => {
        observationOrder.push("clock");
        return 1_789_000_000_000;
      },
    });
    const forecasts: AdmissionPayload[] = [
      admissionPayload(timedDeps, clientTimedRequest),
      admissionPayload(routeDeps(), request("review")),
      admissionPayload(routeDeps({ readReserveBytes: () => undefined }), request()),
    ];
    expect(forecasts.flatMap(allStrings)).not.toContain("enforced");
    expect(forecasts[0]?.label).toBe("forecast");
    expect(forecasts[0]?.caveat).toBe(
      "A reduced worker count is the config default; --maxWorkers on the command line overrides it.",
    );
    expect(forecasts[0]).toMatchObject({ computedAtMs: 1_789_000_000_000 });
    expect(forecasts[0]?.request.requestedAtClientMs).toBe(123);
    expect(observationOrder).toEqual(["workers", "memory", "reserve", "clock"]);
  });
});

describe("parseAdmissionRequest", () => {
  it("defaults a URL with no query string to a test forecast", () => {
    expect(parseAdmissionRequest("/api/admission")).toEqual({
      kind: "test",
      cost: "heavy",
      owner: null,
      /* Null rather than an instant: no caller over HTTP supplies a clock, and
         this function does not have one to lend it. See the function's header
         and tests/fleet-admission-route.test.ts § "the caller's clock". */
      requestedAtClientMs: null,
    });
  });

  it("defaults an unknown kind to test", () => {
    expect(parseAdmissionRequest("/api/admission?kind=compile").kind).toBe("test");
  });

  it("accepts the two declared non-test kinds", () => {
    expect(parseAdmissionRequest("/api/admission?kind=review").kind).toBe("review");
    expect(parseAdmissionRequest("/api/admission?kind=browser").kind).toBe("browser");
  });

  it("ignores cost even when it is supplied", () => {
    expect(parseAdmissionRequest("/api/admission?kind=test&cost=light").cost).toBe("heavy");
  });

  it("never throws or returns NaN for junk", () => {
    expect(() => parseAdmissionRequest("%%%not a URL%%%?kind=%E0%A4%A")).not.toThrow();
    const parsed = parseAdmissionRequest("%%%not a URL%%%?kind=%E0%A4%A");
    expect(parsed.kind).toBe("test");
    expect(parsed.requestedAtClientMs).toBeNull();
    expect(Object.values(parsed).some((value) => typeof value === "number" && Number.isNaN(value))).toBe(false);
  });
});
