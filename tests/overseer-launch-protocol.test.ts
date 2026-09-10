/**
 * The launch protocol under fault injection (plan 260910f § D4, D7, and the
 * review dispositions F1, F2, F4, F5, F7, F9, F12, suspicion 3).
 *
 * ## The harness
 *
 * A WORLD is a real launch store, a real admission owner and a fake launcher,
 * each wrapped so that it can DIE at a named point: the wrapper does the real
 * thing (or not, for a `before-` point), then throws `Crash` and marks the world
 * dead, after which every call on it throws too. That is what a crash leaves —
 * exactly the bytes on the disk at that instant, however many catch blocks the
 * code between has — so the protocol's own error handling cannot turn a crash
 * into a tidy failure that writes one more line.
 *
 * Then the world is killed, a fresh one is opened FROM THE DISK, reconciled,
 * and asserted on.
 *
 * ## Every row asserts four numbers, and two of them are counted independently
 *
 * `invocations` is the fake launcher's own call count. `effects` is counted
 * from a file the launcher appends to as its external effect — not from any
 * counter the protocol could share (F12). `held` is what the owner, reopened
 * from its own disk, answers. And the state is the reopened journal's. A no-op
 * launcher must fail the first post-invocation row, and a test below shows it
 * does.
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import type { BootIdentity } from "../tools/fleet/execution-identity.js";
import type { BehaviourHash } from "../tools/overseer/jobs.js";
import { ADMISSION_DIR, ADMISSION_JOURNAL, openLocalAdmission, type AdmissionClass, type AdmissionOwner, type LocalAdmission } from "../tools/overseer/launch-admission.js";
import { EXIT_FILE, INTENT_FILE, START_FILE, artefactText, identityOf, readArtefacts, type ProcessProbe } from "../tools/overseer/launch-artefacts.js";
import {
  CORRELATION_ID_PATTERN,
  composeLaunchProtocol,
  correlationIdOf,
  occurrenceIdOf,
  pinOf,
  reconcile,
  recoveryOrigin,
  replayJournal,
  reservationKeyOf,
  resolveHistory,
  scheduleOrigin,
  usesTmux,
  type CorrelationId,
  type LaunchEvent,
  type LaunchJournal,
  type LaunchOccurrenceId,
  type LaunchParts,
  type LaunchProtocol,
  type LaunchRecord,
  type Launcher,
  type LauncherAnswer,
  type LauncherKind,
  type PlanRequest,
  type RunSpec,
} from "../tools/overseer/launch-protocol.js";
import { LAUNCHES_DIR, LAUNCH_JOURNAL, MATERIAL_FILE, OCCURRENCES_DIR, openLaunchStore, type LaunchStore } from "../tools/overseer/launch-store.js";

/* ------------------------------------------------------------------ *
 * The harness.
 * ------------------------------------------------------------------ */

class Crash extends Error {
  constructor(point: string) {
    super(`crashed at ${point}`);
  }
}

type LauncherMode =
  /** Creates its external effect (a "session"), writes start.json, stays alive. */
  | "writes-start"
  /** Effect, start.json, then exit.json — the child finished before anyone looked. */
  | "exits-at-once"
  /** Only the external effect; start.json never comes. */
  | "effect-only"
  | "refuses"
  | "throws-after-effect"
  /** Claims `started` and does nothing — the F12 negative control. */
  | "no-op";

type CrashPoint =
  | { readonly at: "before-append" | "after-append"; readonly kind: LaunchEvent["kind"] }
  | { readonly at: "after-material" | "after-intent" | "owner-after-reserve" | "owner-after-release" | "launcher-after-effect" | "launcher-after-start" };

/** What survives across worlds: the disk, and the fake machine's processes, boot and tmux. */
type Shared = {
  readonly root: string;
  mode: LauncherMode;
  invocations: number;
  received: Buffer[];
  /** The run spec each invocation was handed (Stage 2). */
  runs: (RunSpec | null)[];
  /** At each invocation: the journal's last line ON DISK, and whether intent.json was there. */
  atInvocation: { lastKind: string | null; intentPresent: boolean }[];
  procs: Map<number, number>;
  bootId: string;
  bootReadable: boolean;
  procReadable: boolean;
  tmuxReadable: boolean;
};

const SUPERVISOR_PID = 4242;
const SUPERVISOR_TICKS = 777;

/** What a job shell's exit.json says: how the child ended, and no judgement of it (Stage 2's shape). */
const SHELL_EXIT_0 = { ending: { kind: "exited", code: 0 }, verdict: null, usageLimit: null, permissionDenials: null, answer: null, transcript: null } as const;
const shellExit = (code: number) => ({ ...SHELL_EXIT_0, ending: { kind: "exited" as const, code } });

let tick = Date.parse("2026-09-10T12:00:00.000Z");
const now = (): Date => {
  tick += 1000;
  return new Date(tick);
};

const roots: string[] = [];
const worlds = new Set<World>();

afterEach(() => {
  for (const world of worlds) world.kill();
  worlds.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function newShared(mode: LauncherMode = "writes-start"): Shared {
  const root = mkdtempSync(join(tmpdir(), "overseer-launch-protocol-"));
  roots.push(root);
  return { root, mode, invocations: 0, received: [], runs: [], atInvocation: [], procs: new Map(), bootId: "boot-one", bootReadable: true, procReadable: true, tmuxReadable: true };
}

const effectsLog = (shared: Shared): string => join(shared.root, "effects.log");
const sessionPath = (shared: Shared, correlationId: string): string => join(shared.root, "sessions", correlationId);
const journalPath = (shared: Shared): string => join(shared.root, LAUNCHES_DIR, LAUNCH_JOURNAL);

/** External effects, counted from the launcher's own log — never from the protocol (F12). */
function effectsOf(shared: Shared): number {
  return existsSync(effectsLog(shared)) ? readFileSync(effectsLog(shared), "utf8").split("\n").filter((line) => line !== "").length : 0;
}

function lastKindOnDisk(shared: Shared): string | null {
  if (!existsSync(journalPath(shared))) return null;
  const lines = readFileSync(journalPath(shared), "utf8").split("\n").filter((line) => line !== "");
  const last = lines.at(-1);
  return last === undefined ? null : (JSON.parse(last) as { kind: string }).kind;
}

function bootOf(shared: Shared): BootIdentity {
  return shared.bootReadable ? { read: true, id: shared.bootId } : { read: false, cause: "boot-identity-unreadable", why: "the test made it unreadable" };
}

function probeOf(shared: Shared, pid: number): ProcessProbe {
  if (!shared.procReadable) return { kind: "unreadable", why: "the test made /proc unreadable" };
  const ticks = shared.procs.get(pid);
  return ticks === undefined ? { kind: "no-such-process" } : { kind: "ticks", ticks };
}

type WorldOptions = {
  readonly crash?: CrashPoint;
  readonly refuseAppend?: LaunchEvent["kind"];
  readonly launchers?: readonly LauncherKind[];
  /** The owner's release answers `unavailable` with this reason, and releases nothing. */
  readonly ownerReleaseFails?: string;
};

type World = {
  readonly parts: LaunchParts;
  readonly protocol: LaunchProtocol;
  readonly store: LaunchStore;
  readonly owner: LocalAdmission;
  kill(): void;
};

function world(shared: Shared, options: WorldOptions = {}): World {
  const opened = openLaunchStore({ root: shared.root, now });
  if (!opened.ok) throw new Error(`store refused: ${JSON.stringify(opened.refusal)}`);
  const ownerOpened = openLocalAdmission({ root: shared.root, now });
  if (!ownerOpened.ok) throw new Error(`owner refused: ${JSON.stringify(ownerOpened.refusal)}`);
  const store = opened.store;
  const realOwner = ownerOpened.owner;
  const crash = options.crash;
  let dead = false;
  let closed = false;
  const die = (point: string): never => {
    dead = true;
    throw new Crash(point);
  };
  const alive = (): void => {
    if (dead) throw new Crash("after death");
  };

  const journal: LaunchJournal = {
    status: () => store.status(),
    fold: () => store.fold(),
    attemptDir: (id, attempt) => store.attemptDir(id, attempt),
    append(event) {
      alive();
      if (options.refuseAppend === event.kind) return { ok: false, why: "the test refused this append" };
      if (crash?.at === "before-append" && crash.kind === event.kind) die(`before ${event.kind}`);
      const wrote = store.append(event);
      if (wrote.ok && crash?.at === "after-append" && crash.kind === event.kind) die(`after ${event.kind}`);
      return wrote;
    },
    writeMaterial(id, bytes) {
      alive();
      const wrote = store.writeMaterial(id, bytes);
      if (crash?.at === "after-material") die("after material");
      return wrote;
    },
    readMaterial(id) {
      alive();
      return store.readMaterial(id);
    },
    writeIntent(id, attempt, intent) {
      alive();
      const wrote = store.writeIntent(id, attempt, intent);
      if (crash?.at === "after-intent") die("after intent");
      return wrote;
    },
  };

  const owner: AdmissionOwner = {
    ownerId: realOwner.ownerId,
    reserve(key, cls) {
      alive();
      const grant = realOwner.reserve(key, cls);
      if (crash?.at === "owner-after-reserve") die("owner after reserve");
      return grant;
    },
    lookup(key) {
      alive();
      return realOwner.lookup(key);
    },
    release(key, because) {
      alive();
      if (options.ownerReleaseFails !== undefined) return { kind: "unavailable", why: options.ownerReleaseFails };
      const answer = realOwner.release(key, because);
      if (crash?.at === "owner-after-release") die("owner after release");
      return answer;
    },
    inventory() {
      alive();
      return realOwner.inventory();
    },
  };

  const launcherOf = (kind: LauncherKind): Launcher => ({
    kind,
    launch(input): LauncherAnswer {
      alive();
      shared.invocations += 1;
      shared.received.push(Buffer.from(input.material.bytes));
      shared.runs.push(input.run);
      shared.atInvocation.push({ lastKind: lastKindOnDisk(shared), intentPresent: existsSync(join(input.artefactDir, INTENT_FILE)) });
      const mode = shared.mode;
      if (mode === "refuses") return { kind: "refused-before-effect", why: "the fake launcher refused before doing anything" };
      if (mode === "no-op") return { kind: "started", detail: "did nothing at all" };
      appendFileSync(effectsLog(shared), `${input.correlationId}\n`);
      if (mode !== "exits-at-once") {
        mkdirSync(join(shared.root, "sessions"), { recursive: true });
        writeFileSync(sessionPath(shared, input.correlationId), "");
      }
      if (crash?.at === "launcher-after-effect") die("launcher after effect");
      if (mode === "throws-after-effect") throw new Error("the fake launcher broke after its effect");
      if (mode === "effect-only") return { kind: "started", detail: "session created" };
      writeFileSync(
        join(input.artefactDir, START_FILE),
        artefactText({ v: 1, kind: "start", correlationId: input.correlationId, pid: SUPERVISOR_PID, startTicks: SUPERVISOR_TICKS, bootId: shared.bootId, tmuxPane: "%1", at: now().toISOString() }),
      );
      shared.procs.set(SUPERVISOR_PID, SUPERVISOR_TICKS);
      if (crash?.at === "launcher-after-start") die("launcher after start");
      if (mode === "exits-at-once") {
        writeFileSync(
          join(input.artefactDir, EXIT_FILE),
          artefactText({ v: 1, kind: "exit", correlationId: input.correlationId, ...SHELL_EXIT_0, at: now().toISOString() }),
        );
        shared.procs.delete(SUPERVISOR_PID);
      }
      return { kind: "started", detail: "session created" };
    },
  });

  const kinds = options.launchers ?? ["tmux", "headless"];
  const launchers: Partial<Record<LauncherKind, Launcher>> = {};
  for (const kind of kinds) launchers[kind] = launcherOf(kind);

  const parts: LaunchParts = {
    journal,
    owner,
    launchers,
    evidence: {
      artefacts: (dir, correlationId) => readArtefacts(dir, correlationId),
      identity: (start) => identityOf(start, { boot: () => bootOf(shared), probe: (pid) => probeOf(shared, pid) }),
      boot: () => bootOf(shared),
      tmux: (correlationId) => {
        if (!shared.tmuxReadable) return { kind: "cannot-tell", why: "the tmux server did not answer (test)" };
        return existsSync(sessionPath(shared, correlationId)) ? { kind: "found", sessionId: "$7" } : { kind: "absent" };
      },
    },
    now,
  };
  const made: World = {
    parts,
    protocol: composeLaunchProtocol(parts),
    store,
    owner: realOwner,
    kill() {
      dead = true;
      if (closed) return;
      closed = true;
      store.close();
      realOwner.close();
      worlds.delete(made);
    },
  };
  worlds.add(made);
  return made;
}

/** Kill a world and open a fresh one from the same disk. */
function restart(shared: Shared, old: World, options: WorldOptions = {}): World {
  old.kill();
  return world(shared, options);
}

const RUN: RunSpec = { timeoutMinutes: 30, access: "review" };

/** A tmux plan carries no run spec; a wrapper plan must (Stage 2 — the union makes the pairing a type error). */
function request(
  candidate = "cand-a",
  material = "Summarise the plan, then stop.\n",
  launcherKind: LauncherKind = "tmux",
  run: RunSpec = RUN,
  admissionClass: AdmissionClass = "claude-session",
): PlanRequest {
  const common = { origin: recoveryOrigin(candidate), material, admissionClass };
  return launcherKind === "tmux" ? { ...common, launcherKind } : { ...common, launcherKind, run };
}

const idOf = (req: PlanRequest): LaunchOccurrenceId => occurrenceIdOf(req.origin);

function recordOf(w: World, id: LaunchOccurrenceId): LaunchRecord {
  const record = w.store.fold().occurrences.get(id);
  if (record === undefined) throw new Error(`${id} is not in the journal`);
  return record;
}

function heldOf(w: World, id: LaunchOccurrenceId): 0 | 1 {
  return w.owner.lookup(reservationKeyOf(id)).kind === "reserved" ? 1 : 0;
}

type Row = { invocations: number; effects: number; held: 0 | 1; state: LaunchRecord["state"] | "absent" };

function rowOf(shared: Shared, w: World, id: LaunchOccurrenceId): Row {
  const record = w.store.fold().occurrences.get(id);
  return { invocations: shared.invocations, effects: effectsOf(shared), held: heldOf(w, id), state: record === undefined ? "absent" : record.state };
}

function expectRow(shared: Shared, w: World, id: LaunchOccurrenceId, row: Row): void {
  expect(rowOf(shared, w, id)).toEqual(row);
}

function ownerLines(shared: Shared): { kind: string }[] {
  return readFileSync(join(shared.root, ADMISSION_DIR, ADMISSION_JOURNAL), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { kind: string });
}

function reconcileOk(w: World): void {
  const run = w.protocol.reconcile();
  expect(run.kind).toBe("reconciled");
}

/* ------------------------------------------------------------------ *
 * D4's crash table, one test per row.
 * ------------------------------------------------------------------ */

describe("D4: a crash at every boundary, then reopen and reconcile", () => {
  test("after material.txt, before planned: nothing in the journal; the next plan rewrites it and launches once", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "after-material" } });
    first.protocol.launchOccurrence(req);
    expect(existsSync(join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, idOf(req), MATERIAL_FILE))).toBe(true);
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "absent" });
    expect(w.protocol.launchOccurrence(req).kind).toBe("invoked");
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "observed-running" });
  });

  test("after planned: the owner holds nothing, reconciliation leaves it planned, and the next launch takes one slot", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "after-append", kind: "planned" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "planned" });
    expect(w.protocol.launchOccurrence(req).kind).toBe("invoked");
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "launching" });
  });

  test("the owner granted and the reply was lost: lookup recovers it, no second slot, nothing launched", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "owner-after-reserve" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "planned" });
    reconcileOk(w);
    // reserved (found on lookup) → failed-before-launch (restarted before launching) → released.
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "failed-before-launch" });
    const kinds = w.store.fold().occurrences.get(idOf(req));
    expect(kinds?.reservation.kind).toBe("released");
    expect(ownerLines(shared).map((line) => line.kind)).toEqual(["reserved", "released"]);
  });

  test("the lost reply, recovered by the next launch instead: the same slot comes back and one launch happens", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "owner-after-reserve" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    expect(w.protocol.launchOccurrence(req).kind).toBe("invoked");
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "launching" });
    expect(ownerLines(shared).map((line) => line.kind)).toEqual(["reserved"]);
  });

  test("after reserved: nothing external happened, so failed-before-launch and release; a recovery occurrence may be re-offered", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "after-append", kind: "reserved" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "failed-before-launch" });
    const record = recordOf(w, idOf(req));
    expect(record.state === "failed-before-launch" ? record.proof : null).toBe("restarted-before-launching");
    // Re-offered: the same occurrence, attempt 1 (no attempt was ever recorded).
    const again = w.protocol.launchOccurrence(req);
    expect(again.kind === "invoked" ? again.correlationId : null).toBe(`${idOf(req)}-a1`);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "launching" });
  });

  test("after intent.json, before launching: as after reserved; the intent is an orphan", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "after-intent" } });
    first.protocol.launchOccurrence(req);
    expect(existsSync(join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, idOf(req), "a1", INTENT_FILE))).toBe(true);
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "failed-before-launch" });
  });

  test("after launching, before the invocation: no evidence → outcome-unknown, reservation held, never relaunched", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "after-append", kind: "launching" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "outcome-unknown" });
    expect(w.protocol.launchOccurrence(req).kind).toBe("not-launchable");
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "outcome-unknown" });
  });

  test("the launcher's external effect, before start.json: the tmux probe finds the session → observed-running", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "launcher-after-effect" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "observed-running" });
    const record = recordOf(w, idOf(req));
    expect(record.state === "observed-running" ? record.evidence : null).toEqual({ kind: "tmux-session", sessionId: "$7" });
  });

  test("the launcher's external effect, then the session vanished with no start.json: outcome-unknown, held", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "launcher-after-effect" } });
    first.protocol.launchOccurrence(req);
    unlinkSync(sessionPath(shared, `${idOf(req)}-a1`));
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "outcome-unknown" });
  });

  test("start.json written before the journal heard, supervisor alive → observed-running", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "launcher-after-start" } });
    first.protocol.launchOccurrence(req);
    unlinkSync(sessionPath(shared, `${idOf(req)}-a1`)); // so the identity, not tmux, is what answers
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "observed-running" });
    const record = recordOf(w, idOf(req));
    expect(record.state === "observed-running" ? record.evidence.kind : null).toBe("start-artefact");
  });

  test("F1: start.json, and the supervisor is gone on the same boot with no exit.json → outcome-unknown, NOT completed, held", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "launcher-after-start" } });
    first.protocol.launchOccurrence(req);
    shared.procs.clear(); // the job shell was SIGKILLed; its claude may well be running
    unlinkSync(sessionPath(shared, `${idOf(req)}-a1`));
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "outcome-unknown" });
  });

  test("F1: a reused pid (different start tick) is gone, and still only outcome-unknown", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "launcher-after-start" } });
    first.protocol.launchOccurrence(req);
    shared.procs.set(SUPERVISOR_PID, SUPERVISOR_TICKS + 5000);
    unlinkSync(sessionPath(shared, `${idOf(req)}-a1`));
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "outcome-unknown" });
  });

  test("start.json, and the machine rebooted → completed (rebooted), released", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "launcher-after-start" } });
    first.protocol.launchOccurrence(req);
    shared.bootId = "boot-two";
    shared.procs.clear();
    unlinkSync(sessionPath(shared, `${idOf(req)}-a1`));
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 0, state: "completed" });
    const record = recordOf(w, idOf(req));
    expect(record.state === "completed" ? record.evidence : null).toEqual({ kind: "rebooted", recordedBootId: "boot-one", currentBootId: "boot-two" });
  });

  test("a reboot is provable from intent.json alone, when no start.json was ever written", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "after-append", kind: "launching" } });
    first.protocol.launchOccurrence(req);
    shared.bootId = "boot-two";
    const w = restart(shared, first);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "completed" });
  });

  test("the child exited before first collection: exit.json → completed with its code, released", () => {
    const shared = newShared("exits-at-once");
    const req = request();
    const w = world(shared);
    expect(w.protocol.launchOccurrence(req).kind).toBe("invoked");
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 0, state: "completed" });
    const record = recordOf(w, idOf(req));
    expect(record.state === "completed" ? record.evidence : null).toEqual({ kind: "exit-record", ...SHELL_EXIT_0 });
  });

  test("after completed, before the release: the next reconciliation releases", () => {
    const shared = newShared("exits-at-once");
    const req = request();
    const first = world(shared, { crash: { at: "after-append", kind: "completed" } });
    first.protocol.launchOccurrence(req);
    first.protocol.reconcile();
    const w = restart(shared, first);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "completed" });
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 0, state: "completed" });
    expect(recordOf(w, idOf(req)).reservation.kind).toBe("released");
  });

  test("after the owner released, before released was recorded: lookup says none, so released is recorded", () => {
    const shared = newShared("exits-at-once");
    const req = request();
    const first = world(shared, { crash: { at: "owner-after-release" } });
    first.protocol.launchOccurrence(req);
    first.protocol.reconcile();
    const w = restart(shared, first);
    expect(recordOf(w, idOf(req)).reservation.kind).toBe("held");
    reconcileOk(w);
    const reservation = recordOf(w, idOf(req)).reservation;
    expect(reservation.kind === "released" ? reservation.ownerSaid : null).toBe("none-on-lookup");
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 0, state: "completed" });
  });

  test("the owner restarting loses nothing: it reopens from its own disk and every lookup still answers", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared);
    first.protocol.launchOccurrence(req);
    reconcileOk(first);
    const w = restart(shared, first);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "observed-running" });
    writeFileSync(
      join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, idOf(req), "a1", EXIT_FILE),
      artefactText({ v: 1, kind: "exit", correlationId: `${idOf(req)}-a1` as CorrelationId, ...shellExit(3), at: now().toISOString() }),
    );
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 0, state: "completed" });
  });
});

/* ------------------------------------------------------------------ *
 * F7: the release after failed-before-launch and after disposed.
 * ------------------------------------------------------------------ */

describe("F7: a terminal or disposition record licenses the release, across a crash on either side of the owner", () => {
  test("after failed-before-launch, before the release", () => {
    const shared = newShared("refuses");
    const req = request();
    const first = world(shared, { crash: { at: "after-append", kind: "failed-before-launch" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 0, held: 1, state: "failed-before-launch" });
    // No new attempt while the reservation is unsettled.
    shared.mode = "writes-start";
    expect(w.protocol.launchOccurrence(req).kind).toBe("not-launchable");
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 0, held: 0, state: "failed-before-launch" });
  });

  test("after failed-before-launch and the owner's release, before released", () => {
    const shared = newShared("refuses");
    const req = request();
    const first = world(shared, { crash: { at: "owner-after-release" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    expect(recordOf(w, idOf(req)).reservation.kind).toBe("held");
    reconcileOk(w);
    const reservation = recordOf(w, idOf(req)).reservation;
    expect(reservation.kind === "released" ? reservation.ownerSaid : null).toBe("none-on-lookup");
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 0, held: 0, state: "failed-before-launch" });
  });

  function stuck(shared: Shared, req: PlanRequest): World {
    const first = world(shared, { crash: { at: "after-append", kind: "launching" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    reconcileOk(w);
    expect(recordOf(w, idOf(req)).state).toBe("outcome-unknown");
    return w;
  }
  const disposal = (id: LaunchOccurrenceId, requestId = "dispose-one") => ({ occurrenceId: id, actor: "greg", requestId, decision: "not-running" as const, why: "checked the box by hand" });

  test("after disposed, before the release", () => {
    const shared = newShared();
    const req = request();
    const w0 = stuck(shared, req);
    const dying = restart(shared, w0, { crash: { at: "after-append", kind: "disposed" } });
    dying.protocol.dispose(disposal(idOf(req)));
    const w = restart(shared, dying);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "outcome-unknown" });
    // The replayed request is already applied — and that alone does not release it.
    expect(w.protocol.dispose(disposal(idOf(req)))).toEqual({ kind: "already-applied", requestId: "dispose-one" });
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "outcome-unknown" });
    const reservation = recordOf(w, idOf(req)).reservation;
    expect(reservation.kind === "released" ? reservation.licence : null).toEqual({ kind: "disposed", requestId: "dispose-one" });
  });

  test("after disposed and the owner's release, before released", () => {
    const shared = newShared();
    const req = request();
    const w0 = stuck(shared, req);
    const dying = restart(shared, w0, { crash: { at: "owner-after-release" } });
    dying.protocol.dispose(disposal(idOf(req)));
    const w = restart(shared, dying);
    expect(recordOf(w, idOf(req)).reservation.kind).toBe("held");
    reconcileOk(w);
    const reservation = recordOf(w, idOf(req)).reservation;
    expect(reservation.kind === "released" ? reservation.ownerSaid : null).toBe("none-on-lookup");
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "outcome-unknown" });
  });

  test("dispose refuses what it may not touch", () => {
    const shared = newShared("exits-at-once");
    const w = world(shared);
    const req = request();
    w.protocol.launchOccurrence(req);
    reconcileOk(w);
    expect(w.protocol.dispose(disposal(idOf(req))).kind).toBe("refused"); // completed
    expect(w.protocol.dispose(disposal(idOf(request("never-planned")))).kind).toBe("refused");
  });
});

/* ------------------------------------------------------------------ *
 * The rest of Stage 1's red list.
 * ------------------------------------------------------------------ */

describe("identity and idempotence (D2, F5)", () => {
  test("a duplicate plan returns the existing record and appends nothing", () => {
    const shared = newShared();
    const w = world(shared);
    const req = request();
    const first = w.protocol.plan(req);
    const lines = readFileSync(journalPath(shared), "utf8");
    const second = w.protocol.plan(req);
    expect(first.kind === "planned" && first.created).toBe(true);
    expect(second.kind === "planned" && !second.created).toBe(true);
    expect(readFileSync(journalPath(shared), "utf8")).toBe(lines);
  });

  test("the same id with different material or a different launcher is a conflict, and writes nothing", () => {
    const shared = newShared();
    const w = world(shared);
    w.protocol.plan(request());
    const lines = readFileSync(journalPath(shared), "utf8");
    expect(w.protocol.plan(request("cand-a", "a different prompt")).kind).toBe("conflict");
    expect(w.protocol.plan(request("cand-a", "Summarise the plan, then stop.\n", "headless")).kind).toBe("conflict");
    expect(w.protocol.launchOccurrence(request("cand-a", "a different prompt")).kind).toBe("conflict");
    expect(readFileSync(journalPath(shared), "utf8")).toBe(lines);
    expect(shared.invocations).toBe(0);
  });

  test("a duplicate recovery origin — two taps — is one occurrence and one launch", () => {
    const shared = newShared();
    const w = world(shared);
    const req = request("candidate-tapped-twice");
    expect(w.protocol.launchOccurrence(req).kind).toBe("invoked");
    expect(w.protocol.launchOccurrence(req).kind).toBe("not-launchable");
    reconcileOk(w);
    expect(w.protocol.launchOccurrence(req).kind).toBe("not-launchable");
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "observed-running" });
  });

  test("the scheduler's OccurrenceKey is an origin: stable ids and correlation ids in the D2 shape", () => {
    const key = { jobId: "fixture-dry-run", scheduledAt: "2026-09-10T12:00:00.000Z", behaviourHash: "abcdef012345" as BehaviourHash };
    const id = occurrenceIdOf(scheduleOrigin(key));
    expect(id).toMatch(/^lo-[0-9a-f]{20}$/);
    expect(occurrenceIdOf(scheduleOrigin(key))).toBe(id);
    expect(occurrenceIdOf(scheduleOrigin({ ...key, scheduledAt: "2026-09-10T12:30:00.000Z" }))).not.toBe(id);
    expect(occurrenceIdOf(recoveryOrigin("fixture-dry-run"))).not.toBe(id);
    expect(`${id}-a1`).toMatch(CORRELATION_ID_PATTERN);
  });

  test("F5: material tampered after planned is caught before launching; nothing is invoked and the slot is released", () => {
    const shared = newShared();
    const w = world(shared);
    const req = request();
    w.protocol.plan(req);
    writeFileSync(join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, idOf(req), MATERIAL_FILE), "rm -rf ~\n");
    const outcome = w.protocol.launchOccurrence(req);
    expect(outcome.kind === "failed-before-launch" ? outcome.proof : outcome.kind).toBe("material-mismatch");
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "failed-before-launch" });
  });

  test("F5: the launcher is handed the verified bytes off the disk", () => {
    const shared = newShared();
    const w = world(shared);
    const req = request("cand-bytes", "Exactly these bytes. ✓\n");
    w.protocol.launchOccurrence(req);
    expect(shared.received).toHaveLength(1);
    expect(shared.received[0]?.equals(Buffer.from("Exactly these bytes. ✓\n", "utf8"))).toBe(true);
  });
});

describe("the run spec (Stage 2): pinned with the plan, part of F5, handed to the launcher", () => {
  const all = ["tmux", "headless", "tmux-headless"] as const;

  test("a wrapper launch hands the launcher its run spec, and intent.json and the planned line record it", () => {
    const shared = newShared();
    const w = world(shared, { launchers: all });
    const req = request("cand-run", "m\n", "tmux-headless", { timeoutMinutes: 12, access: "read-only" });
    expect(w.protocol.launchOccurrence(req).kind).toBe("invoked");
    expect(shared.runs).toEqual([{ timeoutMinutes: 12, access: "read-only" }]);
    const intent = JSON.parse(readFileSync(join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, idOf(req), "a1", INTENT_FILE), "utf8")) as { run: unknown; launcherKind: unknown };
    expect(intent.run).toEqual({ timeoutMinutes: 12, access: "read-only" });
    expect(intent.launcherKind).toBe("tmux-headless");
    expect(recordOf(w, idOf(req)).run).toEqual({ timeoutMinutes: 12, access: "read-only" });
  });

  test("a tmux launch has no run spec, all the way down", () => {
    const shared = newShared();
    const w = world(shared, { launchers: all });
    w.protocol.launchOccurrence(request("cand-tmux"));
    expect(shared.runs).toEqual([null]);
    expect(recordOf(w, idOf(request("cand-tmux"))).run).toBeNull();
  });

  test("plan refuses a wrong pairing or a spec it cannot honour, and writes nothing", () => {
    const shared = newShared();
    const w = world(shared, { launchers: all });
    const common = { origin: recoveryOrigin("cand-bad"), material: "m\n", admissionClass: "claude-session" as const };
    const bad: unknown[] = [
      { ...common, launcherKind: "tmux", run: RUN },
      { ...common, launcherKind: "headless" },
      { ...common, launcherKind: "tmux-headless", run: { timeoutMinutes: 0, access: "review" } },
      { ...common, launcherKind: "tmux-headless", run: { timeoutMinutes: 2.5, access: "review" } },
      { ...common, launcherKind: "tmux-headless", run: { timeoutMinutes: 100_000, access: "review" } },
      { ...common, launcherKind: "tmux-headless", run: { timeoutMinutes: 5, access: "admin" } },
      { ...common, launcherKind: "tmux-headless", run: { timeoutMinutes: 5, access: "review", extra: true } },
    ];
    for (const one of bad) expect(w.protocol.plan(one as PlanRequest).kind, JSON.stringify(one)).toBe("refused");
    expect(existsSync(journalPath(shared)) ? readFileSync(journalPath(shared), "utf8") : "").toBe("");
  });

  test("F5: the same id with a different run spec is a conflict, and writes nothing", () => {
    const shared = newShared();
    const w = world(shared, { launchers: all });
    w.protocol.plan(request("cand-spec", "m\n", "tmux-headless", { timeoutMinutes: 10, access: "review" }));
    const lines = readFileSync(journalPath(shared), "utf8");
    expect(w.protocol.plan(request("cand-spec", "m\n", "tmux-headless", { timeoutMinutes: 11, access: "review" })).kind).toBe("conflict");
    expect(w.protocol.plan(request("cand-spec", "m\n", "tmux-headless", { timeoutMinutes: 10, access: "write" })).kind).toBe("conflict");
    expect(w.protocol.plan(request("cand-spec", "m\n", "headless", { timeoutMinutes: 10, access: "review" })).kind).toBe("conflict");
    expect(w.protocol.plan(request("cand-spec", "m\n", "tmux-headless", { timeoutMinutes: 10, access: "review" })).kind).toBe("planned");
    expect(readFileSync(journalPath(shared), "utf8")).toBe(lines);
  });

  test("a tmux-headless launch is looked for in tmux, like a tmux one: a session carrying the id is running", () => {
    const shared = newShared("effect-only");
    const w = world(shared, { launchers: all });
    const req = request("cand-th", "m\n", "tmux-headless");
    w.protocol.launchOccurrence(req);
    reconcileOk(w);
    const record = recordOf(w, idOf(req));
    expect(record.state).toBe("observed-running");
    expect(record.state === "observed-running" ? record.evidence : null).toEqual({ kind: "tmux-session", sessionId: "$7" });
  });
});

describe("failed-before-launch versus a launch that may have happened", () => {
  test("a launcher that refuses before any effect: failed-before-launch, released at once, and a re-offer is attempt 2", () => {
    const shared = newShared("refuses");
    const w = world(shared);
    const req = request();
    const outcome = w.protocol.launchOccurrence(req);
    expect(outcome.kind === "failed-before-launch" ? outcome.proof : outcome.kind).toBe("launcher-refused");
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 0, held: 0, state: "failed-before-launch" });
    shared.mode = "writes-start";
    const again = w.protocol.launchOccurrence(req);
    expect(again.kind === "invoked" ? again.correlationId : null).toBe(`${idOf(req)}-a2`);
    expectRow(shared, w, idOf(req), { invocations: 2, effects: 1, held: 1, state: "launching" });
  });

  test("a launcher that throws after its effect: left launching, reconciled from evidence, never retried", () => {
    const shared = newShared("throws-after-effect");
    const w = world(shared);
    const req = request();
    const outcome = w.protocol.launchOccurrence(req);
    expect(outcome.kind === "invoked" ? outcome.launcher : outcome.kind).toBe("threw");
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "launching" });
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "observed-running" });
    shared.mode = "writes-start";
    expect(w.protocol.launchOccurrence(req).kind).toBe("not-launchable");
    expect(shared.invocations).toBe(1);
  });

  test("a launcher that throws and leaves no evidence: outcome-unknown", () => {
    const shared = newShared("throws-after-effect");
    const w = world(shared);
    const req = request();
    w.protocol.launchOccurrence(req);
    unlinkSync(sessionPath(shared, `${idOf(req)}-a1`));
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "outcome-unknown" });
  });

  test("outcome-unknown holds its reservation through ten reconciliations and never re-invokes", () => {
    const shared = newShared();
    const req = request();
    const first = world(shared, { crash: { at: "after-append", kind: "launching" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    reconcileOk(w);
    const bytes = readFileSync(journalPath(shared), "utf8");
    for (let n = 0; n < 10; n += 1) {
      reconcileOk(w);
      expect(w.protocol.launchOccurrence(req).kind).toBe("not-launchable");
    }
    expect(readFileSync(journalPath(shared), "utf8")).toBe(bytes);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "outcome-unknown" });
  });
});

describe("F9: the prefix is one synchronous function", () => {
  test("launching is on the disk, and intent.json beside it, at the instant the launcher runs", () => {
    const shared = newShared();
    const w = world(shared);
    w.protocol.launchOccurrence(request());
    expect(shared.atInvocation).toEqual([{ lastKind: "launching", intentPresent: true }]);
  });

  test("a launching append that does not land invokes nothing, and reconciliation reads the journal as never launched", () => {
    const shared = newShared();
    const req = request();
    const w = world(shared, { refuseAppend: "launching" });
    expect(w.protocol.launchOccurrence(req).kind).toBe("not-launched");
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "reserved" });
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "failed-before-launch" });
  });

  test("launchOccurrence answers synchronously — there is no promise to interleave with", () => {
    const shared = newShared();
    const w = world(shared);
    const outcome: unknown = w.protocol.launchOccurrence(request());
    expect(outcome instanceof Promise).toBe(false);
    expect(typeof (outcome as { then?: unknown }).then).toBe("undefined");
  });

  test("a process that holds no launcher of the kind is refused before any slot is taken", () => {
    const shared = newShared();
    const w = world(shared, { launchers: ["headless"] });
    const req = request();
    expect(w.protocol.launchOccurrence(req).kind).toBe("refused");
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "planned" });
  });

  test("admission waits once per reason, and the waiting occurrence launches when the slot comes free", () => {
    const shared = newShared("exits-at-once");
    const w = world(shared);
    shared.mode = "writes-start";
    const first = request("cand-first");
    const second = request("cand-second");
    w.protocol.launchOccurrence(first);
    for (let n = 0; n < 3; n += 1) expect(w.protocol.launchOccurrence(second).kind).toBe("waiting");
    const waits = readFileSync(journalPath(shared), "utf8").split("\n").filter((line) => line.includes('"waiting-admission"'));
    expect(waits).toHaveLength(1);
    writeFileSync(
      join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, idOf(first), "a1", EXIT_FILE),
      artefactText({ v: 1, kind: "exit", correlationId: `${idOf(first)}-a1` as CorrelationId, ...SHELL_EXIT_0, at: now().toISOString() }),
    );
    reconcileOk(w);
    expect(w.protocol.launchOccurrence(second).kind).toBe("invoked");
    expect(heldOf(w, idOf(first))).toBe(0);
    expect(heldOf(w, idOf(second))).toBe(1);
  });
});

describe("F4: evidence by precedence, and cannot-tell never moves a record on its own", () => {
  function launched(shared: Shared, req: PlanRequest): World {
    const first = world(shared, { crash: { at: "after-append", kind: "launching" } });
    first.protocol.launchOccurrence(req);
    return restart(shared, first);
  }
  const startFor = (shared: Shared, id: LaunchOccurrenceId): void =>
    writeFileSync(
      join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, id, "a1", START_FILE),
      artefactText({ v: 1, kind: "start", correlationId: `${id}-a1` as CorrelationId, pid: SUPERVISOR_PID, startTicks: SUPERVISOR_TICKS, bootId: shared.bootId, tmuxPane: null, at: now().toISOString() }),
    );
  const exitFor = (shared: Shared, id: LaunchOccurrenceId): void =>
    writeFileSync(
      join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, id, "a1", EXIT_FILE),
      artefactText({
        v: 1,
        kind: "exit",
        correlationId: `${id}-a1` as CorrelationId,
        ending: { kind: "signalled", signal: "SIGTERM" },
        verdict: { kind: "failed", cause: "timeout", why: "killed after its timeout" },
        usageLimit: false,
        permissionDenials: null,
        answer: null,
        transcript: null,
        at: now().toISOString(),
      }),
    );

  test.each([
    [
      "tmux cannot tell",
      (s: Shared) => {
        s.tmuxReadable = false;
      },
    ],
    [
      "the boot id is unreadable",
      (s: Shared) => {
        s.bootReadable = false;
      },
    ],
    ["start.json is unreadable", (s: Shared, id: LaunchOccurrenceId) => writeFileSync(join(s.root, LAUNCHES_DIR, OCCURRENCES_DIR, id, "a1", START_FILE), "{half")],
    ["exit.json is unreadable", (s: Shared, id: LaunchOccurrenceId) => writeFileSync(join(s.root, LAUNCHES_DIR, OCCURRENCES_DIR, id, "a1", EXIT_FILE), "{half")],
    [
      "/proc is unreadable for a recorded supervisor",
      (s: Shared, id: LaunchOccurrenceId) => {
        startFor(s, id);
        s.procReadable = false;
      },
    ],
  ] as const)("%s: the record stays launching and the reservation stays held", (_name, breakIt) => {
    const shared = newShared();
    const req = request();
    const w = launched(shared, req);
    breakIt(shared, idOf(req));
    const bytes = readFileSync(journalPath(shared), "utf8");
    const run = w.protocol.reconcile();
    expect(run.kind === "reconciled" ? run.reports.map((one) => one.did) : null).toEqual(["held"]);
    expect(readFileSync(journalPath(shared), "utf8")).toBe(bytes);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "launching" });
  });

  test("a valid exit.json wins even when /proc, tmux and the boot id are all unavailable", () => {
    const shared = newShared();
    const req = request();
    const w = launched(shared, req);
    startFor(shared, idOf(req));
    exitFor(shared, idOf(req));
    shared.tmuxReadable = false;
    shared.procReadable = false;
    shared.bootReadable = false;
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "completed" });
  });

  test("a live identity wins even when tmux cannot tell", () => {
    const shared = newShared();
    const req = request();
    const w = launched(shared, req);
    startFor(shared, idOf(req));
    shared.procs.set(SUPERVISOR_PID, SUPERVISOR_TICKS);
    shared.tmuxReadable = false;
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "observed-running" });
  });

  test("an owner that cannot answer holds a licensed release rather than guessing", () => {
    const shared = newShared("exits-at-once");
    const req = request();
    const first = world(shared, { crash: { at: "after-append", kind: "completed" } });
    first.protocol.launchOccurrence(req);
    first.protocol.reconcile();
    first.kill();
    appendFileSync(join(shared.root, ADMISSION_DIR, ADMISSION_JOURNAL), "{an interior hole}\n");
    appendFileSync(join(shared.root, ADMISSION_DIR, ADMISSION_JOURNAL), `${JSON.stringify({ v: 1, kind: "reserved", at: "2026-09-10T12:00:00.000Z", key: "lo-ffffffffffffffffffff", cls: "claude-session", slot: "claude-session#9" })}\n`);
    const w = world(shared);
    const run = w.protocol.reconcile();
    expect(run.kind === "reconciled" ? run.reports.map((one) => one.did) : null).toEqual(["held"]);
    expect(recordOf(w, idOf(req)).reservation.kind).toBe("held");
  });
});

describe("F2: history-lost refuses to plan, and Greg's attributed resolution is the way out", () => {
  test("a holed journal refuses plan and launch, and reconciliation only reports", () => {
    const shared = newShared();
    const w0 = world(shared);
    w0.protocol.plan(request("cand-before"));
    w0.kill();
    appendFileSync(journalPath(shared), "{a hole}\n");
    const w = world(shared);
    expect(w.protocol.plan(request("cand-new")).kind).toBe("refused");
    expect(w.protocol.launchOccurrence(request("cand-new")).kind).toBe("refused");
    expect(w.protocol.reconcile().kind).toBe("history-lost");
    expect(shared.invocations).toBe(0);
  });

  test("a hole hiding an occurrence whose slot only the owner remembers: carried, refused re-plans, freed only by its dispose", () => {
    const shared = newShared();
    const hidden = request("cand-hidden");
    const visible = request("cand-visible");
    const w0 = world(shared);
    w0.protocol.launchOccurrence(hidden);
    reconcileOk(w0);
    w0.protocol.plan(visible);
    w0.kill();
    // Every line about the hidden occurrence becomes one unreadable line.
    const lines = readFileSync(journalPath(shared), "utf8").split("\n").filter((line) => line !== "");
    const kept = lines.filter((line) => !line.includes(idOf(hidden)));
    writeFileSync(journalPath(shared), `${["{unrecoverable", ...kept].join("\n")}\n`);
    const before = readFileSync(journalPath(shared));

    const w = world(shared);
    expect(w.protocol.plan(request("cand-fresh")).kind).toBe("refused");
    const resolution = { actor: "greg", requestId: "resolve-launches", why: "the journal was corrupted by a full disk", acceptHiddenLaunchRisk: true } as const;
    const resolved = resolveHistory({ journal: w.store, owner: w.owner, now }, resolution);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(readFileSync(join(shared.root, LAUNCHES_DIR, resolved.reset.preservedAs)).equals(before)).toBe(true);
    const carried = new Map(resolved.reset.carried.map((entry) => [entry.occurrenceId, entry]));
    expect(carried.get(idOf(hidden))).toEqual({ occurrenceId: idOf(hidden), lastSeen: null, ownerHeld: { slot: "claude-session#1" }, origin: null, plannedAt: null });
    expect(carried.get(idOf(visible))).toMatchObject({ lastSeen: "planned", origin: visible.origin });

    // Neither carried occurrence is ever planned again; a new one waits behind the hidden slot.
    expect(w.protocol.plan(hidden).kind).toBe("refused");
    expect(w.protocol.plan(visible).kind).toBe("refused");
    const fresh = request("cand-fresh");
    expect(w.protocol.launchOccurrence(fresh).kind).toBe("waiting");
    reconcileOk(w);
    expect(heldOf(w, idOf(hidden))).toBe(1); // reconciliation never frees it on its own

    const disposed = w.protocol.dispose({ occurrenceId: idOf(hidden), actor: "greg", requestId: "dispose-hidden", decision: "ended", why: "no such session on the box" });
    expect(disposed.kind).toBe("disposed");
    expect(heldOf(w, idOf(hidden))).toBe(0);
    expect(w.protocol.launchOccurrence(fresh).kind).toBe("invoked");
    expect(shared.invocations).toBe(2);
  });

  test("a hole hiding an occurrence whose slot was already released: its artefact directory alone carries it, and it never launches again (F15)", () => {
    const shared = newShared("exits-at-once");
    const gone = request("cand-artefacts-only");
    const w0 = world(shared);
    expect(w0.protocol.launchOccurrence(gone).kind).toBe("invoked");
    reconcileOk(w0);
    // Completed and released: the owner holds nothing for it any more.
    expectRow(shared, w0, idOf(gone), { invocations: 1, effects: 1, held: 0, state: "completed" });
    expect(existsSync(join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, idOf(gone), "a1", EXIT_FILE))).toBe(true);
    w0.kill();
    // Every line about it disappears behind one unreadable first line.
    const lines = readFileSync(journalPath(shared), "utf8").split("\n").filter((line) => line !== "");
    const kept = lines.filter((line) => !line.includes(idOf(gone)));
    expect(kept).toEqual([]);
    writeFileSync(journalPath(shared), "{unrecoverable\n");

    const w = world(shared);
    const resolution = { actor: "greg", requestId: "resolve-artefacts-only", why: "the journal lost its head in a disk fault", acceptHiddenLaunchRisk: true } as const;
    const resolved = resolveHistory({ journal: w.store, owner: w.owner, now }, resolution);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.reset.carried).toEqual([{ occurrenceId: idOf(gone), lastSeen: null, ownerHeld: null, origin: null, plannedAt: null }]);
    expect(w.store.fold().carried.has(idOf(gone))).toBe(true);

    // Not a fresh occurrence restarting at a1, where the old exit.json could release the new slot.
    const again = w.protocol.launchOccurrence(gone);
    expect(again.kind).toBe("refused");
    expect(shared.invocations).toBe(1);
    expect(effectsOf(shared)).toBe(1);
    expect(heldOf(w, idOf(gone))).toBe(0);
  });

  test("resolution waits for the owner: an owner that lost its own history is resolved first", () => {
    const shared = newShared();
    const w0 = world(shared);
    w0.protocol.plan(request());
    w0.kill();
    appendFileSync(journalPath(shared), "{a hole}\n");
    mkdirSync(join(shared.root, ADMISSION_DIR), { recursive: true });
    appendFileSync(join(shared.root, ADMISSION_DIR, ADMISSION_JOURNAL), "{another hole}\n");
    const w = world(shared);
    const resolved = resolveHistory({ journal: w.store, owner: w.owner, now }, { actor: "greg", requestId: "resolve-early", why: "both broke", acceptHiddenLaunchRisk: true });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.why).toMatch(/admission owner's history first/);
  });
});

/* ------------------------------------------------------------------ *
 * Stage 1b: Sol's F16–F19, the fields and operations the two consumers
 * asked for, and the per-class hold condition.
 * ------------------------------------------------------------------ */

type DiskLine = { readonly kind: string; readonly at: string } & Record<string, unknown>;

function linesOnDisk(shared: Shared): DiskLine[] {
  return readFileSync(journalPath(shared), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as DiskLine);
}

function atOf(shared: Shared, kind: string): string {
  const line = linesOnDisk(shared).find((one) => one.kind === kind);
  if (line === undefined) throw new Error(`no ${kind} line on the disk`);
  return line.at;
}

/** The launched side's exit.json for attempt 1, as a job shell writes it. */
function endAttempt(shared: Shared, id: LaunchOccurrenceId, code = 0): void {
  writeFileSync(
    join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, id, "a1", EXIT_FILE),
    artefactText({ v: 1, kind: "exit", correlationId: `${id}-a1` as CorrelationId, ...shellExit(code), at: now().toISOString() }),
  );
}

function scheduleRequest(jobId: string): PlanRequest {
  return {
    origin: scheduleOrigin({ jobId, scheduledAt: "2026-09-10T12:00:00.000Z", behaviourHash: "abcdef012345" as BehaviourHash }),
    material: "the scheduled prompt\n",
    admissionClass: "claude-session",
    launcherKind: "tmux",
  };
}

describe("F16: evidence is read from this store's own attempt directory, never from a path in the journal", () => {
  test("a journal carried to another root does not read the first root's exit.json, and keeps its slot", () => {
    const first = newShared();
    const req = request("cand-f16-carried-journal");
    const dying = world(first, { crash: { at: "after-append", kind: "launching" } });
    dying.protocol.launchOccurrence(req);
    dying.kill();
    const second = newShared();
    cpSync(join(first.root, LAUNCHES_DIR), join(second.root, LAUNCHES_DIR), { recursive: true });
    cpSync(join(first.root, ADMISSION_DIR), join(second.root, ADMISSION_DIR), { recursive: true });
    // The FIRST root's attempt ends; the second root's copy of it does not.
    endAttempt(first, idOf(req));
    const w = world(second);
    reconcileOk(w);
    expectRow(second, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "outcome-unknown" });
  });
});

describe("F19: an other-boot identity reading is conclusive on its own", () => {
  test("it completes the attempt (rebooted) even when the separate boot read fails, using the reading's own boot ids", () => {
    const req = request("cand-f19-other-boot");
    const id = idOf(req);
    const correlationId = correlationIdOf(id, 1);
    const at = "2026-09-10T00:00:00.000Z";
    const replayed = replayJournal(
      [
        { v: 1, kind: "planned", occurrenceId: id, at, origin: req.origin, material: pinOf(Buffer.from("x")), launcherKind: "tmux", run: null, admissionClass: "claude-session" },
        { v: 1, kind: "reserved", occurrenceId: id, at, reservationKey: reservationKeyOf(id), slot: "claude-session#1", ownerId: "local-admission", how: "granted" },
        { v: 1, kind: "launching", occurrenceId: id, at, attempt: 1, correlationId },
      ].map((line) => JSON.stringify(line)),
    );
    expect(replayed.status).toEqual({ kind: "whole" });
    const decisions = reconcile(
      replayed.fold,
      {
        attemptDir: (occurrence, attempt) => `/a-store/launches/o/${occurrence}/a${attempt}`,
        artefacts: () => ({
          intent: { kind: "absent" },
          start: { kind: "present", record: { v: 1, kind: "start", correlationId, pid: 42, startTicks: 7, bootId: "boot-recorded", tmuxPane: null, at } },
          exit: { kind: "absent" },
        }),
        identity: () => ({ kind: "other-boot", recorded: "boot-recorded", current: "boot-now" }),
        boot: () => ({ read: false, cause: "boot-identity-unreadable", why: "one transient read failed (test)" }),
        tmux: () => ({ kind: "absent" }),
        lookup: () => ({ kind: "reserved", slot: "claude-session#1", ownerId: "local-admission" }),
      },
      at,
    );
    expect(decisions).toMatchObject([{ kind: "record", event: { kind: "completed", evidence: { kind: "rebooted", recordedBootId: "boot-recorded", currentBootId: "boot-now" } } }]);
  });
});

describe("F17: a released record still answers to the owner's truth", () => {
  test("an owner journal repaired to show a released key as reserved is released again, under the record's own licence, with no new journal line", () => {
    const shared = newShared("exits-at-once");
    const req = request("cand-f17-resurrected");
    const w0 = world(shared);
    w0.protocol.launchOccurrence(req);
    reconcileOk(w0);
    expectRow(shared, w0, idOf(req), { invocations: 1, effects: 1, held: 0, state: "completed" });
    w0.kill();
    // The owner's release line is the hole; resolving the owner's history carries the salvaged key as held.
    const ownerPath = join(shared.root, ADMISSION_DIR, ADMISSION_JOURNAL);
    const ownerText = readFileSync(ownerPath, "utf8").split("\n").filter((line) => line !== "");
    expect(ownerText.map((line) => (JSON.parse(line) as { kind: string }).kind)).toEqual(["reserved", "released"]);
    writeFileSync(ownerPath, `${ownerText[0]}\n{the release line, lost\n`);
    const w = world(shared);
    expect(w.owner.resolveHistory({ actor: "greg", requestId: "resolve-owner-f17", why: "a disk fault in the owner's journal", acceptHiddenLaunchRisk: true }).ok).toBe(true);
    expect(heldOf(w, idOf(req))).toBe(1);
    const journalBefore = readFileSync(journalPath(shared), "utf8");
    reconcileOk(w);
    expect(heldOf(w, idOf(req))).toBe(0);
    expect(readFileSync(journalPath(shared), "utf8")).toBe(journalBefore);
    expect(ownerLines(shared).at(-1)).toMatchObject({ kind: "released", because: { kind: "terminal", state: "completed" } });
    // The class is free again.
    expect(w.protocol.launchOccurrence(request("cand-f17-next")).kind).toBe("invoked");
  });
});

describe("endedAt: the instant the occurrence ended, never moved by the release after it", () => {
  test("completed, then released later", () => {
    const shared = newShared("exits-at-once");
    const req = request("cand-ended-completed");
    const w = world(shared);
    w.protocol.launchOccurrence(req);
    reconcileOk(w);
    const record = recordOf(w, idOf(req));
    expect(record.reservation.kind).toBe("released");
    expect(record.state === "completed" ? record.endedAt : null).toBe(atOf(shared, "completed"));
    expect(record.updatedAt).toBe(atOf(shared, "released"));
    expect(atOf(shared, "completed")).not.toBe(atOf(shared, "released"));
    // And the same after a replay.
    const again = recordOf(restart(shared, w), idOf(req));
    expect(again.state === "completed" ? again.endedAt : null).toBe(atOf(shared, "completed"));
  });

  test("failed-before-launch, then released", () => {
    const shared = newShared("refuses");
    const req = request("cand-ended-failed");
    const w = world(shared);
    w.protocol.launchOccurrence(req);
    const record = recordOf(w, idOf(req));
    expect(record.reservation.kind).toBe("released");
    expect(record.state === "failed-before-launch" ? record.endedAt : null).toBe(atOf(shared, "failed-before-launch"));
    expect(record.updatedAt).toBe(atOf(shared, "released"));
    expect(atOf(shared, "failed-before-launch")).not.toBe(atOf(shared, "released"));
  });
});

describe("launchingAt: the launching line's instant, carried by its attempt", () => {
  test("survives observed-running, completed and released unchanged", () => {
    const shared = newShared();
    const req = request("cand-launching-at");
    const w = world(shared);
    w.protocol.launchOccurrence(req);
    const launchingAt = atOf(shared, "launching");
    const currentOf = (record: LaunchRecord) => ("current" in record ? record.current : null);
    expect(currentOf(recordOf(w, idOf(req)))?.launchingAt).toBe(launchingAt);
    reconcileOk(w);
    expect(recordOf(w, idOf(req)).state).toBe("observed-running");
    expect(currentOf(recordOf(w, idOf(req)))?.launchingAt).toBe(launchingAt);
    endAttempt(shared, idOf(req));
    reconcileOk(w);
    const ended = recordOf(w, idOf(req));
    expect(ended.state).toBe("completed");
    expect(ended.reservation.kind).toBe("released");
    expect(currentOf(ended)?.launchingAt).toBe(launchingAt);
    expect(ended.attempts.map((one) => one.launchingAt)).toEqual([launchingAt]);
    expect(ended.updatedAt).not.toBe(launchingAt);
  });
});

describe("resumeOccurrence: drive the stored, pinned record — no re-plan, no request", () => {
  test("a waiting occurrence resumes to invoked without its caller re-supplying the material", () => {
    const shared = newShared();
    const w = world(shared);
    const first = request("cand-resume-first");
    const second = request("cand-resume-second", "the pinned prompt, and only this\n");
    expect(w.protocol.launchOccurrence(first).kind).toBe("invoked");
    expect(w.protocol.launchOccurrence(second).kind).toBe("waiting");
    endAttempt(shared, idOf(first));
    reconcileOk(w);
    const resumed = w.protocol.resumeOccurrence(idOf(second));
    expect(resumed.kind).toBe("invoked");
    expect(shared.invocations).toBe(2);
    expect(shared.received.at(-1)?.equals(Buffer.from("the pinned prompt, and only this\n", "utf8"))).toBe(true);
  });

  test("a planned occurrence resumes too", () => {
    const shared = newShared();
    const w = world(shared);
    const req = request("cand-resume-planned");
    w.protocol.plan(req);
    expect(w.protocol.resumeOccurrence(idOf(req)).kind).toBe("invoked");
  });

  test.each([
    [
      "launching",
      (shared: Shared, req: PlanRequest): World => {
        shared.mode = "effect-only";
        const w = world(shared);
        w.protocol.launchOccurrence(req);
        return w;
      },
    ],
    [
      "completed",
      (shared: Shared, req: PlanRequest): World => {
        shared.mode = "exits-at-once";
        const w = world(shared);
        w.protocol.launchOccurrence(req);
        reconcileOk(w);
        return w;
      },
    ],
    [
      "outcome-unknown",
      (shared: Shared, req: PlanRequest): World => {
        const first = world(shared, { crash: { at: "after-append", kind: "launching" } });
        first.protocol.launchOccurrence(req);
        const w = restart(shared, first);
        reconcileOk(w);
        return w;
      },
    ],
  ] as const)("a %s occurrence is refused, and nothing is invoked", (state, build) => {
    const shared = newShared();
    const req = request(`cand-resume-refused-${state}`);
    const w = build(shared, req);
    expect(recordOf(w, idOf(req)).state).toBe(state);
    const invocations = shared.invocations;
    const bytes = readFileSync(journalPath(shared), "utf8");
    const outcome = w.protocol.resumeOccurrence(idOf(req));
    expect(outcome.kind === "not-launchable" ? outcome.state : outcome.kind).toBe(state);
    expect(shared.invocations).toBe(invocations);
    expect(readFileSync(journalPath(shared), "utf8")).toBe(bytes);
  });

  test("an unknown id, and a lost history, are refused", () => {
    const shared = newShared();
    const w0 = world(shared);
    expect(w0.protocol.resumeOccurrence(idOf(request("cand-never-planned"))).kind).toBe("refused");
    const req = request("cand-resume-lost");
    w0.protocol.plan(req);
    w0.kill();
    appendFileSync(journalPath(shared), "{a hole}\n");
    const w = world(shared);
    expect(w.protocol.resumeOccurrence(idOf(req)).kind).toBe("refused");
    expect(shared.invocations).toBe(0);
  });
});

describe("abandon: superseded, from planned or waiting only — and a superseded occurrence never launches", () => {
  test("from planned with a lost reply the owner still holds: the slot is released, and a new origin plans normally", () => {
    const shared = newShared();
    const req = request("cand-abandon-lost-reply");
    const first = world(shared, { crash: { at: "owner-after-reserve" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "planned" });
    expect(w.protocol.abandon(idOf(req), "its next due instant arrived")).toEqual({ kind: "abandoned", reservation: { kind: "released" } });
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "failed-before-launch" });
    const record = recordOf(w, idOf(req));
    expect(record.state === "failed-before-launch" ? [record.proof, record.why, record.attempt] : null).toEqual(["superseded", "its next due instant arrived", null]);
    const next = request("cand-abandon-next-due");
    expect(w.protocol.launchOccurrence(next).kind).toBe("invoked");
    expectRow(shared, w, idOf(next), { invocations: 1, effects: 1, held: 1, state: "launching" });
  });

  test("from waiting-admission", () => {
    const shared = newShared();
    const w = world(shared);
    w.protocol.launchOccurrence(request("cand-abandon-holder"));
    const req = request("cand-abandon-waiting");
    expect(w.protocol.launchOccurrence(req).kind).toBe("waiting");
    expect(w.protocol.abandon(idOf(req), "superseded while it waited")).toEqual({ kind: "abandoned", reservation: { kind: "released" } });
    expect(recordOf(w, idOf(req)).state).toBe("failed-before-launch");
  });

  test("the new proof parses and replays", () => {
    const shared = newShared();
    const w0 = world(shared);
    const req = request("cand-abandon-replays");
    w0.protocol.plan(req);
    w0.protocol.abandon(idOf(req), "no longer wanted");
    const w = restart(shared, w0);
    expect(w.store.status()).toEqual({ kind: "whole" });
    const record = recordOf(w, idOf(req));
    expect(record.state === "failed-before-launch" ? record.proof : null).toBe("superseded");
  });

  test("after abandon, neither launchOccurrence nor resumeOccurrence launches it", () => {
    const shared = newShared();
    const w = world(shared);
    const req = request("cand-abandon-never-again");
    w.protocol.plan(req);
    w.protocol.abandon(idOf(req), "superseded");
    const bytes = readFileSync(journalPath(shared), "utf8");
    const launched = w.protocol.launchOccurrence(req);
    const resumed = w.protocol.resumeOccurrence(idOf(req));
    expect(launched.kind === "not-launchable" ? launched.state : launched.kind).toBe("failed-before-launch");
    expect(resumed.kind === "not-launchable" ? resumed.state : resumed.kind).toBe("failed-before-launch");
    reconcileOk(w);
    expect(readFileSync(journalPath(shared), "utf8")).toBe(bytes);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 0, state: "failed-before-launch" });
  });

  test("from launching is refused, and writes nothing", () => {
    const shared = newShared("effect-only");
    const w = world(shared);
    const req = request("cand-abandon-launching");
    w.protocol.launchOccurrence(req);
    const bytes = readFileSync(journalPath(shared), "utf8");
    expect(w.protocol.abandon(idOf(req), "too late").kind).toBe("refused");
    expect(readFileSync(journalPath(shared), "utf8")).toBe(bytes);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "launching" });
  });

  test("an owner that cannot release answers held with its reason, and reconciliation releases the slot later (F7)", () => {
    const shared = newShared();
    const req = request("cand-abandon-owner-down");
    const first = world(shared, { crash: { at: "owner-after-reserve" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first, { ownerReleaseFails: "the owner's disk is full (test)" });
    const result = w.protocol.abandon(idOf(req), "superseded");
    expect(result).toEqual({ kind: "abandoned", reservation: { kind: "held", why: expect.stringMatching(/disk is full/) } });
    expect(heldOf(w, idOf(req))).toBe(1);
    const later = restart(shared, w);
    reconcileOk(later);
    expect(heldOf(later, idOf(req))).toBe(0);
    expect(ownerLines(shared).at(-1)).toMatchObject({ kind: "released", because: { kind: "terminal", state: "failed-before-launch" } });
  });

  test("an unknown id is refused", () => {
    const w = world(newShared());
    expect(w.protocol.abandon(idOf(request("cand-abandon-unknown")), "x").kind).toBe("refused");
  });
});

describe("G7: tmux is probed for every launcher that lives in tmux, and only those", () => {
  test("usesTmux", () => {
    expect(usesTmux("tmux")).toBe(true);
    expect(usesTmux("tmux-headless")).toBe(true);
    expect(usesTmux("headless")).toBe(false);
  });

  test.each(["tmux", "tmux-headless"] as const)("%s: a session carrying the id and no start.json → observed-running", (kind) => {
    const shared = newShared("effect-only");
    const w = world(shared, { launchers: ["tmux", "headless", "tmux-headless"] });
    const req = request(`cand-g7-${kind}`, "m\n", kind);
    w.protocol.launchOccurrence(req);
    reconcileOk(w);
    const record = recordOf(w, idOf(req));
    expect(record.state === "observed-running" ? record.evidence : record.state).toEqual({ kind: "tmux-session", sessionId: "$7" });
  });

  test("headless: a session file the fake would report is never asked about", () => {
    const shared = newShared("effect-only");
    const w = world(shared, { launchers: ["headless"] });
    const req = request("cand-g7-headless", "m\n", "headless");
    w.protocol.launchOccurrence(req);
    reconcileOk(w);
    expect(recordOf(w, idOf(req)).state).toBe("outcome-unknown");
  });
});

describe("G1: the failed-before-launch outcome says whether its slot was released", () => {
  test("launcher-refused, owner releases: released", () => {
    const shared = newShared("refuses");
    const w = world(shared);
    const outcome = w.protocol.launchOccurrence(request("cand-g1-released"));
    expect(outcome).toMatchObject({ kind: "failed-before-launch", proof: "launcher-refused", reservation: { kind: "released" } });
  });

  test("launcher-refused, owner's release fails: held with its reason, and inspect says the slot is held", () => {
    const shared = newShared("refuses");
    const w = world(shared, { ownerReleaseFails: "the owner's disk is full (test)" });
    const req = request("cand-g1-held");
    const outcome = w.protocol.launchOccurrence(req);
    expect(outcome).toMatchObject({ kind: "failed-before-launch", proof: "launcher-refused", reservation: { kind: "held", why: expect.stringMatching(/disk is full/) } });
    expect(w.protocol.inspect(req.origin)?.reservationHeld).toBe(true);
  });

  test("material-mismatch, owner's release fails: held", () => {
    const shared = newShared();
    const w = world(shared, { ownerReleaseFails: "the owner's disk is full (test)" });
    const req = request("cand-g1-material");
    w.protocol.plan(req);
    writeFileSync(join(shared.root, LAUNCHES_DIR, OCCURRENCES_DIR, idOf(req), MATERIAL_FILE), "not the pinned bytes\n");
    const outcome = w.protocol.launchOccurrence(req);
    expect(outcome).toMatchObject({ kind: "failed-before-launch", proof: "material-mismatch", reservation: { kind: "held" } });
  });

  test("admission-refused holds nothing: released", () => {
    const shared = newShared();
    const first = world(shared);
    first.protocol.plan(request("cand-g1-admission"));
    first.kill();
    // An owner that lost its history refuses to reserve.
    mkdirSync(join(shared.root, ADMISSION_DIR), { recursive: true });
    appendFileSync(join(shared.root, ADMISSION_DIR, ADMISSION_JOURNAL), "{an owner hole}\n");
    const w = world(shared);
    const outcome = w.protocol.launchOccurrence(request("cand-g1-admission"));
    expect(outcome).toMatchObject({ kind: "failed-before-launch", proof: "admission-refused", reservation: { kind: "released" } });
  });
});

describe("G6: inspect and inFlight hand out frozen copies", () => {
  test("a summary is a frozen copy: mutating it reaches neither the fold nor the next answer", () => {
    const shared = newShared("exits-at-once");
    const w = world(shared);
    const req = request("cand-g6-frozen");
    w.protocol.launchOccurrence(req);
    reconcileOk(w);
    const summary = w.protocol.inspect(req.origin);
    expect(summary).toEqual({
      occurrenceId: idOf(req),
      state: "completed",
      attempt: 1,
      reservationHeld: false,
      disposed: false,
      endedAt: atOf(shared, "completed"),
      completion: { kind: "exit", code: 0 },
    });
    expect(() => {
      (summary as { state: string }).state = "planned";
    }).toThrow(TypeError);
    expect(() => {
      (summary?.completion as { code: number }).code = 9;
    }).toThrow(TypeError);
    const list = w.protocol.inFlight("recovery");
    expect(() => (list as unknown[]).push(summary)).toThrow(TypeError);
    expect(recordOf(w, idOf(req)).state).toBe("completed");
    expect(w.protocol.inspect(req.origin)?.completion).toEqual({ kind: "exit", code: 0 });
  });

  test("inspect of an origin never planned is null; a reboot's completion says so", () => {
    const shared = newShared();
    const w0 = world(shared);
    expect(w0.protocol.inspect(recoveryOrigin("cand-g6-never"))).toBeNull();
    const req = request("cand-g6-rebooted");
    const first = restart(shared, w0, { crash: { at: "after-append", kind: "launching" } });
    first.protocol.launchOccurrence(req);
    shared.bootId = "boot-two";
    const w = restart(shared, first);
    reconcileOk(w);
    expect(w.protocol.inspect(req.origin)).toMatchObject({ state: "completed", completion: { kind: "rebooted" }, reservationHeld: false });
  });

  const builders: readonly [string, boolean, (shared: Shared, req: PlanRequest) => World][] = [
    [
      "planned",
      true,
      (shared, req) => {
        const w = world(shared);
        w.protocol.plan(req);
        return w;
      },
    ],
    [
      "waiting-admission",
      true,
      (shared, req) => {
        const w = world(shared);
        w.protocol.launchOccurrence(request("cand-g6-holder"));
        w.protocol.launchOccurrence(req);
        return w;
      },
    ],
    [
      "reserved",
      true,
      (shared, req) => {
        const w = world(shared, { refuseAppend: "launching" });
        w.protocol.launchOccurrence(req);
        return w;
      },
    ],
    [
      "launching",
      true,
      (shared, req) => {
        const w = world(shared);
        w.protocol.launchOccurrence(req);
        return w;
      },
    ],
    [
      "observed-running",
      true,
      (shared, req) => {
        const w = world(shared);
        w.protocol.launchOccurrence(req);
        reconcileOk(w);
        return w;
      },
    ],
    [
      "outcome-unknown",
      true,
      (shared, req) => {
        const first = world(shared, { crash: { at: "after-append", kind: "launching" } });
        first.protocol.launchOccurrence(req);
        const w = restart(shared, first);
        reconcileOk(w);
        return w;
      },
    ],
    [
      "completed, released",
      false,
      (shared, req) => {
        shared.mode = "exits-at-once";
        const w = world(shared);
        w.protocol.launchOccurrence(req);
        reconcileOk(w);
        return w;
      },
    ],
    [
      "completed, still held",
      true,
      (shared, req) => {
        shared.mode = "exits-at-once";
        const first = world(shared, { crash: { at: "after-append", kind: "completed" } });
        first.protocol.launchOccurrence(req);
        first.protocol.reconcile();
        return restart(shared, first);
      },
    ],
    [
      "failed-before-launch, released",
      false,
      (shared, req) => {
        shared.mode = "refuses";
        const w = world(shared);
        w.protocol.launchOccurrence(req);
        return w;
      },
    ],
    [
      "failed-before-launch, still held",
      true,
      (shared, req) => {
        shared.mode = "refuses";
        const w = world(shared, { ownerReleaseFails: "the owner's disk is full (test)" });
        w.protocol.launchOccurrence(req);
        return w;
      },
    ],
  ];
  test.each(builders)("%s: in flight is %s", (name, expected, build) => {
    const shared = newShared();
    const req = request(`cand-g6-${name.replace(/[^a-z]+/g, "-")}`);
    const w = build(shared, req);
    const state = recordOf(w, idOf(req)).state;
    expect(name.startsWith(state)).toBe(true);
    expect(w.protocol.inFlight("recovery").some((one) => one.occurrenceId === idOf(req))).toBe(expected);
    expect(w.protocol.inFlight("schedule").some((one) => one.occurrenceId === idOf(req))).toBe(false);
  });

  test("inFlight is by origin kind", () => {
    const shared = newShared();
    const w = world(shared);
    const scheduled = scheduleRequest("fixture-dry-run");
    w.protocol.plan(scheduled);
    w.protocol.plan(request("cand-g6-recovery"));
    expect(w.protocol.inFlight("schedule").map((one) => one.occurrenceId)).toEqual([occurrenceIdOf(scheduled.origin)]);
    expect(w.protocol.inFlight("recovery").map((one) => one.occurrenceId)).toEqual([idOf(request("cand-g6-recovery"))]);
  });
});

describe("(Q2) the per-class hold condition", () => {
  test("a recovery-resume reservation is released on observed-running, and the slot is then free for a second resume", () => {
    const shared = newShared();
    const w = world(shared);
    const first = request("cand-q2-resume-a", "m\n", "tmux", RUN, "recovery-resume");
    const second = request("cand-q2-resume-b", "m\n", "tmux", RUN, "recovery-resume");
    expect(w.protocol.launchOccurrence(first).kind).toBe("invoked");
    expect(w.protocol.launchOccurrence(second).kind).toBe("waiting");
    reconcileOk(w);
    expectRow(shared, w, idOf(first), { invocations: 1, effects: 1, held: 0, state: "observed-running" });
    const reservation = recordOf(w, idOf(first)).reservation;
    expect(reservation.kind === "released" ? reservation.licence : null).toEqual({ kind: "observed-running" });
    expect(w.protocol.launchOccurrence(second).kind).toBe("invoked");
    expect(heldOf(w, idOf(second))).toBe(1);
  });

  test("a claude-session reservation is not: it is held until exit evidence", () => {
    const shared = newShared();
    const w = world(shared);
    const first = request("cand-q2-session-a");
    const second = request("cand-q2-session-b");
    w.protocol.launchOccurrence(first);
    reconcileOk(w);
    expectRow(shared, w, idOf(first), { invocations: 1, effects: 1, held: 1, state: "observed-running" });
    expect(w.protocol.launchOccurrence(second).kind).toBe("waiting");
  });

  test("the two classes do not share a slot", () => {
    const shared = newShared();
    const w = world(shared);
    expect(w.protocol.launchOccurrence(request("cand-q2-mixed-session")).kind).toBe("invoked");
    expect(w.protocol.launchOccurrence(request("cand-q2-mixed-resume", "m\n", "tmux", RUN, "recovery-resume")).kind).toBe("invoked");
  });

  test("a crash between recording observed-running and the owner's release still releases on the next reconcile", () => {
    const shared = newShared();
    const req = request("cand-q2-crash", "m\n", "tmux", RUN, "recovery-resume");
    const first = world(shared, { crash: { at: "after-append", kind: "observed-running" } });
    first.protocol.launchOccurrence(req);
    first.protocol.reconcile();
    const w = restart(shared, first);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "observed-running" });
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 0, state: "observed-running" });
  });

  test("outcome-unknown holds a recovery-resume reservation too", () => {
    const shared = newShared();
    const req = request("cand-q2-unknown", "m\n", "tmux", RUN, "recovery-resume");
    const first = world(shared, { crash: { at: "after-append", kind: "launching" } });
    first.protocol.launchOccurrence(req);
    const w = restart(shared, first);
    reconcileOk(w);
    reconcileOk(w);
    expectRow(shared, w, idOf(req), { invocations: 0, effects: 0, held: 1, state: "outcome-unknown" });
  });

  test("a released recovery-resume that later completes is not released twice", () => {
    const shared = newShared();
    const w = world(shared);
    const req = request("cand-q2-completes", "m\n", "tmux", RUN, "recovery-resume");
    w.protocol.launchOccurrence(req);
    reconcileOk(w);
    endAttempt(shared, idOf(req));
    reconcileOk(w);
    expect(recordOf(w, idOf(req)).state).toBe("completed");
    expect(ownerLines(shared).map((line) => line.kind)).toEqual(["reserved", "released"]);
  });
});

/* ------------------------------------------------------------------ *
 * F12's negative control, and suspicion 3.
 * ------------------------------------------------------------------ */

describe("the harness can fail", () => {
  test("a no-op launcher fails the first post-invocation row (F12)", () => {
    const shared = newShared("no-op");
    const w = world(shared);
    const req = request();
    expect(w.protocol.launchOccurrence(req).kind).toBe("invoked");
    // The protocol's own counter says one invocation; the independent count says no effect.
    expect(() => expectRow(shared, w, idOf(req), { invocations: 1, effects: 1, held: 1, state: "launching" })).toThrow();
    expect(rowOf(shared, w, idOf(req))).toEqual({ invocations: 1, effects: 0, held: 1, state: "launching" });
  });
});

describe("suspicion 3: built, and deliberately not called yet", () => {
  const REPO = fileURLToPath(new URL("..", import.meta.url));
  /** The protocol's modules, and — added deliberately in Stage 2 — the adapters its composition is handed. */
  const LAUNCH_FILES = new Set(["launch-protocol.ts", "launch-store.ts", "launch-admission.ts", "launch-artefacts.ts", "launchers.ts"].map((name) => join("tools", "overseer", name)));
  /** Stage 2's launched side: it writes artefacts, so it imports the artefact module — and nothing else of the protocol. */
  const ARTEFACT_WRITERS = new Set([join("scripts", "launch-dir.ts"), join("scripts", "gjd-remote-launch.ts")]);
  const IMPORTS_LAUNCH = /from\s+["'][^"']*\/launch-(?:protocol|store|admission|artefacts)(?:\.js)?["']/;
  const IMPORTS_BEYOND_ARTEFACTS = /from\s+["'][^"']*\/launch-(?:protocol|store|admission)(?:\.js)?["']/;
  const IMPORTS_LAUNCHERS = /(?:from\s+|import\(\s*)["'][^"']*\/launchers(?:\.js)?["']/;

  function walk(dir: string, into: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, into);
      else if (/\.tsx?$/.test(entry.name)) into.push(full);
    }
  }

  /**
   * **THE ONE PRODUCTION CALLER**, since plan 260910f (scheduled dispatch) Stage
   * B: the scheduler, through the capability it is handed (`TickInput.launch`).
   * It is on this list deliberately, as "built but uncalled" was.
   */
  const CALLERS = new Set([join("tools", "overseer", "scheduler.ts")]);
  /** Every import statement from a protocol module, with whether it is `import type`. `[^;]` spans lines, so a multi-line import is one match. */
  const IMPORT_STATEMENTS = /import\s+(type\s+)?[^;]*?from\s+["'][^"']*\/launch-(?:protocol|store|admission|artefacts)(?:\.js)?["']/g;
  /** Whether a file takes a VALUE from the protocol. A file whose every such import is `import type` can name a record and cannot call anything. */
  const importsLaunchValues = (text: string): boolean => [...text.matchAll(IMPORT_STATEMENTS)].some((match) => match[1] === undefined);

  test("no production file outside the launch modules takes a value from them but the scheduler — the protocol's one caller", () => {
    const files: string[] = [];
    for (const top of ["tools", "scripts", "src", "api", "evals"]) if (existsSync(join(REPO, top))) walk(join(REPO, top), files);
    const importers = files.map((file) => relative(REPO, file)).filter((file) => IMPORTS_LAUNCH.test(readFileSync(join(REPO, file), "utf8")));
    // THE DETECTOR WORKS: it sees the launch modules importing each other, and the writers importing the artefacts.
    expect(importers).toContain(join("tools", "overseer", "launch-store.ts"));
    for (const writer of ARTEFACT_WRITERS) expect(importers).toContain(writer);
    const valueImporters = importers.filter((file) => importsLaunchValues(readFileSync(join(REPO, file), "utf8")));
    // …and it tells a value import from a type-only one, in both directions.
    for (const caller of CALLERS) expect(valueImporters).toContain(caller);
    const typeOnly = join("tools", "overseer", "jobs.ts");
    expect(importers).toContain(typeOnly);
    expect(valueImporters).not.toContain(typeOnly);
    expect(valueImporters.filter((file) => !LAUNCH_FILES.has(file) && !ARTEFACT_WRITERS.has(file) && !CALLERS.has(file))).toEqual([]);
    // A writer reaches the artefact module and nothing past it, so it cannot reach launchOccurrence.
    for (const writer of ARTEFACT_WRITERS) expect(IMPORTS_BEYOND_ARTEFACTS.test(readFileSync(join(REPO, writer), "utf8")), writer).toBe(false);
  });

  test("the composed protocol is functions only, and exactly these: no launcher, journal or owner is reachable from it", () => {
    const w = world(newShared());
    expect(Object.keys(w.protocol).sort()).toEqual(["abandon", "dispose", "inFlight", "inspect", "launchOccurrence", "plan", "reconcile", "resumeOccurrence"]);
    for (const value of Object.values(w.protocol)) expect(typeof value).toBe("function");
  });

  test("nothing outside the protocol's composition calls a launcher adapter — no production file imports launchers.ts", () => {
    const files: string[] = [];
    for (const top of ["tools", "scripts", "src", "api", "evals"]) if (existsSync(join(REPO, top))) walk(join(REPO, top), files);
    // The detector sees the adapters' own module, which names itself in its header; the regex wants an import.
    expect(files.map((file) => relative(REPO, file))).toContain(join("tools", "overseer", "launchers.ts"));
    const importers = files.map((file) => relative(REPO, file)).filter((file) => IMPORTS_LAUNCHERS.test(readFileSync(join(REPO, file), "utf8")));
    expect(importers).toEqual([]);
  });
});
