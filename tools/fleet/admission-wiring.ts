/**
 * The admission composition in one importable place.
 *
 * `server.ts` cannot be imported without binding its live port. Keeping the
 * real readers and the route together here lets a join test drive the same
 * construction production mounts, rather than rebuilding a second set of deps
 * that could stay green after the server's wire was cut.
 */
import { readRefusals } from "../../admission-journal.js";
import {
  ADMISSION_POLICY_VERSION,
  decideAdmission,
  readMemorySnapshot,
  readReserveBytes,
  resolveParallelWorkers,
} from "../../vitest-admission.js";
import { readProcRows, startCensusTask } from "./admission-census.js";
import { admissionRoute, type AdmissionRouteDeps } from "./routes-admission.js";
import type { AdmissionCensusState } from "./wire.js";

const CENSUS_CADENCE_MS = 30_000;

type AdmissionCensus = {
  read(): AdmissionCensusState;
  stop(): void;
};

function unstartedCensus(startedAtMs: number): AdmissionCensus {
  const state: AdmissionCensusState = { kind: "not-yet-computed", label: "observed", startedAtMs };
  return { read: () => state, stop: () => undefined };
}

export type Admission = {
  deps: AdmissionRouteDeps;
  route: ReturnType<typeof admissionRoute>;
  stop(): void;
};

export function makeAdmission(options: {
  nowMs?: (() => number) | undefined;
  meminfoPath?: string | undefined;
  reserveFile?: string | undefined;
  workersFile?: string | undefined;
  journalDir?: string | undefined;
  census?: AdmissionCensus | undefined;
  readRows?: Parameters<typeof startCensusTask>[0]["readRows"] | undefined;
  cadenceMs?: number | undefined;
  autostart?: boolean | undefined;
} = {}): Admission {
  const nowMs = options.nowMs ?? (() => Date.now());
  const census =
    options.census ??
    (options.autostart === false
      ? unstartedCensus(nowMs())
      : startCensusTask({
          readRows: options.readRows ?? (() => readProcRows()),
          cadenceMs: options.cadenceMs ?? CENSUS_CADENCE_MS,
          nowMs,
        }));
  const deps: AdmissionRouteDeps = {
    nowMs,
    readMemorySnapshot: () => readMemorySnapshot(options.meminfoPath),
    readReserveBytes: () => readReserveBytes(options.reserveFile),
    resolveParallelWorkers: () => resolveParallelWorkers(options.workersFile),
    policyVersion: ADMISSION_POLICY_VERSION,
    readRefusals: () => readRefusals({ dir: options.journalDir }),
    readCensus: () => census.read(),
    decideAdmission,
  };
  return { deps, route: admissionRoute(deps), stop: () => census.stop() };
}
