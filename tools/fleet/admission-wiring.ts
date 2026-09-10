/**
 * The admission composition in one importable place.
 *
 * `server.ts` cannot be imported without binding its live port. Keeping the
 * real readers and the route together here lets a join test drive the same
 * construction production mounts, rather than rebuilding a second set of deps
 * that could stay green after the server's wire was cut.
 */
import {
  ADMISSION_POLICY_VERSION,
  decideAdmission,
  readMemorySnapshot,
  readReserveBytes,
  resolveParallelWorkers,
} from "../../vitest-admission.js";
import { admissionRoute, type AdmissionRouteDeps } from "./routes-admission.js";

export type Admission = {
  deps: AdmissionRouteDeps;
  route: ReturnType<typeof admissionRoute>;
};

export function makeAdmission(options: {
  nowMs?: (() => number) | undefined;
  meminfoPath?: string | undefined;
  reserveFile?: string | undefined;
  workersFile?: string | undefined;
} = {}): Admission {
  const deps: AdmissionRouteDeps = {
    nowMs: options.nowMs ?? (() => Date.now()),
    readMemorySnapshot: () => readMemorySnapshot(options.meminfoPath),
    readReserveBytes: () => readReserveBytes(options.reserveFile),
    resolveParallelWorkers: () => resolveParallelWorkers(options.workersFile),
    policyVersion: ADMISSION_POLICY_VERSION,
    decideAdmission,
  };
  return { deps, route: admissionRoute(deps) };
}
