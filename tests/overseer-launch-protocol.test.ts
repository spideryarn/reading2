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
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import type { BootIdentity } from "../tools/fleet/execution-identity.js";
import type { BehaviourHash } from "../tools/overseer/jobs.js";
import { ADMISSION_DIR, ADMISSION_JOURNAL, openLocalAdmission, type AdmissionOwner, type LocalAdmission } from "../tools/overseer/launch-admission.js";
import { EXIT_FILE, INTENT_FILE, START_FILE, artefactText, identityOf, readArtefacts, type ProcessProbe } from "../tools/overseer/launch-artefacts.js";
import {
  CORRELATION_ID_PATTERN,
  composeLaunchProtocol,
  occurrenceIdOf,
  recoveryOrigin,
  reservationKeyOf,
  resolveHistory,
  scheduleOrigin,
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
  return { root, mode, invocations: 0, received: [], atInvocation: [], procs: new Map(), bootId: "boot-one", bootReadable: true, procReadable: true, tmuxReadable: true };
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

type WorldOptions = { readonly crash?: CrashPoint; readonly refuseAppend?: LaunchEvent["kind"]; readonly launchers?: readonly LauncherKind[] };

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
          artefactText({ v: 1, kind: "exit", correlationId: input.correlationId, ending: { kind: "exited", code: 0 }, timedOut: false, answer: null, at: now().toISOString() }),
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

function request(candidate = "cand-a", material = "Summarise the plan, then stop.\n", launcherKind: LauncherKind = "tmux"): PlanRequest {
  return { origin: recoveryOrigin(candidate), material, launcherKind, admissionClass: "claude-session" };
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
    expect(record.state === "completed" ? record.evidence : null).toEqual({ kind: "exit-record", ending: { kind: "exited", code: 0 }, timedOut: false, answer: null });
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
      artefactText({ v: 1, kind: "exit", correlationId: `${idOf(req)}-a1` as CorrelationId, ending: { kind: "exited", code: 3 }, timedOut: false, answer: null, at: now().toISOString() }),
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
      artefactText({ v: 1, kind: "exit", correlationId: `${idOf(first)}-a1` as CorrelationId, ending: { kind: "exited", code: 0 }, timedOut: false, answer: null, at: now().toISOString() }),
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
      artefactText({ v: 1, kind: "exit", correlationId: `${id}-a1` as CorrelationId, ending: { kind: "signalled", signal: "SIGTERM" }, timedOut: true, answer: null, at: now().toISOString() }),
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
    expect(carried.get(idOf(hidden))).toEqual({ occurrenceId: idOf(hidden), lastSeen: null, ownerHeld: { slot: "claude-session#1" } });
    expect(carried.get(idOf(visible))?.lastSeen).toBe("planned");
    expect(resolved.reset.artefactDirs).toContain(idOf(hidden));

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
  const LAUNCH_FILES = new Set(["launch-protocol.ts", "launch-store.ts", "launch-admission.ts", "launch-artefacts.ts"].map((name) => join("tools", "overseer", name)));
  const IMPORTS_LAUNCH = /from\s+["'][^"']*\/launch-(?:protocol|store|admission|artefacts)(?:\.js)?["']/;

  function walk(dir: string, into: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, into);
      else if (/\.tsx?$/.test(entry.name)) into.push(full);
    }
  }

  test("no production file outside the launch modules imports them — launchOccurrence has no caller", () => {
    const files: string[] = [];
    for (const top of ["tools", "scripts", "src", "api", "evals"]) if (existsSync(join(REPO, top))) walk(join(REPO, top), files);
    const importers = files.map((file) => relative(REPO, file)).filter((file) => IMPORTS_LAUNCH.test(readFileSync(join(REPO, file), "utf8")));
    // THE DETECTOR WORKS: it sees the launch modules importing each other.
    expect(importers).toContain(join("tools", "overseer", "launch-store.ts"));
    expect(importers.filter((file) => !LAUNCH_FILES.has(file))).toEqual([]);
  });
});
