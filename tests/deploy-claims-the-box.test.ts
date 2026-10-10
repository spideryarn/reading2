/**
 * **While a deploy holds the release lock, its test run has the box.** Every
 * other run takes one worker; the deploy's own run takes half the machine.
 * docs/plans/261010j-deploy-test-run-claims-the-box.md.
 *
 * The decision is a pure function, so each case is a state this machine is not
 * in. The two impure edges — where the lock is, and whether its holder is alive
 * — are tested against files made here, never the real lock: writing that would
 * stop a real deploy and slow every other suite on the box.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, expect, test, vi } from "vitest";

import { liveReleaseLockHolder, RELEASE_LOCK_FILE, releaseLockPath } from "../scripts/release-lock.js";
import type { LockHolder } from "../scripts/lockfile.js";
import {
  DEPLOY_YIELD_WORKERS,
  decideRunWorkers,
  deployTestWorkers,
  resolveRunWorkers,
} from "../vitest-admission.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), "deploy-claims-the-box-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const DEPLOY: LockHolder = { pid: 4242, since: "2026-10-10T17:10:00.000Z", token: "t" };

test("with no deploy running, a run takes what it would have taken", () => {
  expect(decideRunWorkers({ nominal: 2, explicit: false, deploy: null })).toEqual({ kind: "as-asked", workers: 2 });
});

test("while a deploy runs, every other run drops to one worker and says why", () => {
  const d = decideRunWorkers({ nominal: 2, explicit: false, deploy: DEPLOY });
  expect(d).toEqual({ kind: "yielding-to-deploy", workers: DEPLOY_YIELD_WORKERS, wouldHave: 2, deploy: DEPLOY });
  expect(DEPLOY_YIELD_WORKERS).toBe(1);
});

test("a run already at one worker is not described as yielding", () => {
  expect(decideRunWorkers({ nominal: 1, explicit: false, deploy: DEPLOY })).toEqual({ kind: "as-asked", workers: 1 });
});

test("an explicit VITEST_MAX_WORKERS is not overruled — that is how the deploy's own run gets its share", () => {
  expect(decideRunWorkers({ nominal: 8, explicit: true, deploy: DEPLOY })).toEqual({ kind: "as-asked", workers: 8 });
});

test("resolveRunWorkers reads the override before the cap consumes it", () => {
  vi.stubEnv("VITEST_MAX_WORKERS", "5");
  expect(resolveRunWorkers(() => DEPLOY).workers).toBe(5);
  expect(process.env.VITEST_MAX_WORKERS).toBeUndefined();
});

test("resolveRunWorkers yields to a live deploy when nothing was asked for explicitly", () => {
  vi.stubEnv("VITEST_MAX_WORKERS", undefined);
  // Whatever this machine's own number, the yield is to one worker.
  expect(resolveRunWorkers(() => DEPLOY).workers).toBe(1);
});

test.each(["", " \n"])("an empty VITEST_MAX_WORKERS of %o still yields to a live deploy", (empty) => {
  vi.stubEnv("VITEST_MAX_WORKERS", empty);
  const deploy = vi.fn(() => DEPLOY);
  expect(resolveRunWorkers(deploy).workers).toBe(1);
  expect(deploy).toHaveBeenCalledOnce();
  expect(process.env.VITEST_MAX_WORKERS).toBeUndefined();
});

test("the deploy's own run asks for half the machine, more than the box's crowded-machine file", () => {
  expect(deployTestWorkers()).toBe(Math.max(2, Math.floor(availableParallelism() / 2)));
  expect(deployTestWorkers()).toBeGreaterThan(DEPLOY_YIELD_WORKERS);
});

test("the deploy passes that number to its suite, which is what exempts it from the yield", () => {
  // Read rather than run: the gate cannot run a suite from inside a suite. The
  // sentence names the line to look for if this goes red.
  const deploy = readFileSync(path.join(ROOT, "scripts/deploy.ts"), "utf8");
  expect(deploy).toMatch(/VITEST_MAX_WORKERS: String\(deployTestWorkers\(\)\)/);
});

test("the lock is looked for in the shared git directory, from a worktree as from the primary", () => {
  const file = releaseLockPath(ROOT);
  expect(path.basename(file)).toBe(RELEASE_LOCK_FILE);
  // A worktree's own `.git` is a file; the lock must be beside the primary's objects.
  expect(path.dirname(file)).not.toMatch(/[/\\]worktrees[/\\]/);
  expect(readFileSync(path.join(path.dirname(file), "HEAD"), "utf8")).toMatch(/^ref: |^[0-9a-f]{40}/);
});

test("no lock file means no deploy", () => {
  expect(liveReleaseLockHolder(path.join(scratch, "absent.lock"))).toBeNull();
});

test("a lock whose holder is alive is a deploy in progress", () => {
  const file = path.join(scratch, "live.lock");
  writeFileSync(file, `${process.pid}\n2026-10-10T17:10:00.000Z\ntok\n`);
  expect(liveReleaseLockHolder(file)).toEqual({ pid: process.pid, since: "2026-10-10T17:10:00.000Z", token: "tok" });
});

test("a lock left by a killed deploy does not hold every later run at one worker", () => {
  const file = path.join(scratch, "dead.lock");
  writeFileSync(file, `999999999\n2026-10-10T17:10:00.000Z\ntok\n`);
  expect(liveReleaseLockHolder(file, () => false)).toBeNull();
});
