/**
 * The launch journal (plan 260910f § D1, F2, F11).
 *
 * The failure this store exists to refuse is a PLAUSIBLE history: a journal
 * that replays into a fold that looks fine and is wrong about what is in
 * flight. So most tests here write bytes to the disk by hand — the shapes the
 * code would never write — and assert that the next open refuses to fold past
 * them, rather than that the code writes the right thing.
 */
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { readArtefacts } from "../tools/overseer/launch-artefacts.js";
import {
  correlationIdOf,
  occurrenceIdOf,
  pinOf,
  recoveryOrigin,
  reservationKeyOf,
  type LaunchEvent,
  type LaunchOccurrenceId,
} from "../tools/overseer/launch-protocol.js";
import { LAUNCHES_DIR, LAUNCH_JOURNAL, MATERIAL_FILE, OCCURRENCES_DIR, openLaunchStore, type LaunchStore } from "../tools/overseer/launch-store.js";

const roots: string[] = [];
const opened = new Set<LaunchStore>();
afterEach(() => {
  for (const store of opened) store.close();
  opened.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-launch-store-"));
  roots.push(root);
  return root;
}

let tick = Date.parse("2026-09-10T12:00:00.000Z");
const now = (): Date => {
  tick += 1000;
  return new Date(tick);
};
const T0 = "2026-09-10T11:00:00.000Z";

function open(root: string): LaunchStore {
  const result = openLaunchStore({ root, now });
  if (!result.ok) throw new Error(`open refused: ${JSON.stringify(result.refusal)}`);
  opened.add(result.store);
  return result.store;
}
function close(store: LaunchStore): void {
  store.close();
  opened.delete(store);
}

const journalOf = (root: string): string => join(root, LAUNCHES_DIR, LAUNCH_JOURNAL);
const idOf = (candidate: string): LaunchOccurrenceId => occurrenceIdOf(recoveryOrigin(candidate));

function planned(candidate: string, material = `material for ${candidate}`): LaunchEvent {
  const origin = recoveryOrigin(candidate);
  return { v: 1, kind: "planned", occurrenceId: occurrenceIdOf(origin), at: T0, origin, material: pinOf(Buffer.from(material)), launcherKind: "tmux", admissionClass: "claude-session" };
}
function reserved(id: LaunchOccurrenceId): LaunchEvent {
  return { v: 1, kind: "reserved", occurrenceId: id, at: T0, reservationKey: reservationKeyOf(id), slot: "claude-session#1", ownerId: "local-admission", how: "granted" };
}
function launching(id: LaunchOccurrenceId, attempt = 1, correlationId = correlationIdOf(id, attempt)): LaunchEvent {
  return { v: 1, kind: "launching", occurrenceId: id, at: T0, attempt, correlationId, artefactDir: `/srv/overseer/launches/o/${id}/a${attempt}` };
}
function disposed(id: LaunchOccurrenceId, requestId: string): LaunchEvent {
  return { v: 1, kind: "disposed", occurrenceId: id, at: T0, actor: "greg", requestId, decision: "not-running", why: "checked by hand" };
}

function seed(root: string, lines: readonly (string | object)[]): void {
  mkdirSync(join(root, LAUNCHES_DIR), { recursive: true, mode: 0o700 });
  writeFileSync(journalOf(root), `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`);
}

const A = idOf("cand-a");
const B = idOf("cand-b");

describe("opening", () => {
  test("creates private directories and takes the one lock", () => {
    const root = tempRoot();
    open(root);
    expect(statSync(join(root, LAUNCHES_DIR)).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, LAUNCHES_DIR, OCCURRENCES_DIR)).mode & 0o777).toBe(0o700);
    const second = openLaunchStore({ root, now });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.refusal.reason).toBe("already-running");
  });

  test("a relative root is refused", () => {
    const result = openLaunchStore({ root: "relative/root", now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("relative-root");
  });
});

describe("append and replay", () => {
  test("what is appended is what a second store folds", () => {
    const root = tempRoot();
    const first = open(root);
    expect(first.append(planned("cand-a"))).toEqual({ ok: true });
    expect(first.append({ v: 1, kind: "waiting-admission", occurrenceId: A, at: T0, why: "full" })).toEqual({ ok: true });
    close(first);
    const second = open(root);
    expect(second.status()).toEqual({ kind: "whole" });
    const record = second.fold().occurrences.get(A);
    expect(record?.state).toBe("waiting-admission");
    expect(record?.state === "waiting-admission" ? record.why : null).toBe("full");
  });

  test("an illegal event is refused without writing a byte", () => {
    const root = tempRoot();
    const store = open(root);
    store.append(planned("cand-a"));
    const size = statSync(journalOf(root)).size;
    expect(store.append(launching(A)).ok).toBe(false); // launching needs reserved
    expect(store.append(reserved(B)).ok).toBe(false); // never planned
    expect(statSync(journalOf(root)).size).toBe(size);
  });

  test("a torn last line is truncated on open, and the next append starts its own line", () => {
    const root = tempRoot();
    seed(root, [planned("cand-a")]);
    appendFileSync(journalOf(root), '{"v":1,"kind":"reser');
    const store = open(root);
    expect(store.repair.torn).toBe(true);
    expect(store.status()).toEqual({ kind: "whole" });
    expect(store.append(reserved(A))).toEqual({ ok: true });
    close(store);
    const again = open(root);
    expect(again.status()).toEqual({ kind: "whole" });
    expect(again.fold().occurrences.get(A)?.state).toBe("reserved");
  });
});

describe("a journal that cannot be replayed whole is history-lost, with nothing folded past the hole (F11)", () => {
  const cases: readonly [string, readonly (string | object)[], number][] = [
    ["an interior line that is not JSON", [planned("cand-a"), "{garbage"], 2],
    // F14: a blank record is a record that does not parse, not a gap to skip.
    ["a blank interior line", [planned("cand-a"), ""], 2],
    ["a blank first line", [""], 1],
    ["an unknown schema", [{ ...planned("cand-a"), v: 2 }], 1],
    ["an unknown kind", [planned("cand-a"), { v: 1, kind: "teleported", occurrenceId: A, at: T0 }], 2],
    ["a known kind missing a field", [{ ...planned("cand-a"), material: undefined }], 1],
    ["an unexpected field", [{ ...planned("cand-a"), note: "hi" }], 1],
    ["an id that is not the hash of its origin", [{ ...planned("cand-a"), occurrenceId: B }], 1],
    ["a conflicting duplicate plan", [planned("cand-a"), planned("cand-a", "different material")], 2],
    ["a release before any reservation", [planned("cand-a"), { v: 1, kind: "released", occurrenceId: A, at: T0, licence: { kind: "terminal", state: "completed" }, ownerSaid: "released" }], 2],
    ["launching without a reservation", [planned("cand-a"), launching(A)], 2],
    ["a first attempt numbered two", [planned("cand-a"), reserved(A), launching(A, 2)], 3],
    ["another occurrence's correlation id", [planned("cand-a"), reserved(A), launching(A, 1, correlationIdOf(B, 1))], 3],
    ["observed-running straight from reserved", [planned("cand-a"), reserved(A), { v: 1, kind: "observed-running", occurrenceId: A, at: T0, attempt: 1, evidence: { kind: "tmux-session", sessionId: "$1" } }], 3],
    [
      "one request id applied twice",
      [planned("cand-a"), reserved(A), launching(A), disposed(A, "req-dup"), planned("cand-b"), reserved(B), launching(B), disposed(B, "req-dup")],
      8,
    ],
    ["a history reset after the first line", [planned("cand-a"), { v: 1, kind: "history-reset", at: T0, actor: "greg", requestId: "r", why: "w", preservedAs: "p", lostAt: { line: 1, why: "x" }, acknowledgement: "x", carried: [] }], 2],
  ];
  test.each(cases)("%s", (_name, lines, atLine) => {
    const root = tempRoot();
    const after = planned("cand-after-the-hole");
    seed(root, [...lines, after]);
    const store = open(root);
    const status = store.status();
    expect(status.kind).toBe("history-lost");
    if (status.kind === "history-lost") expect(status.atLine).toBe(atLine);
    expect(store.fold().occurrences.has(idOf("cand-after-the-hole"))).toBe(false);
    expect(store.append(planned("cand-new")).ok).toBe(false);
  });
});

describe("material and attempt directories", () => {
  test("material is pinned in a private directory and read back byte-for-byte", () => {
    const root = tempRoot();
    const store = open(root);
    const bytes = Buffer.from("Do the thing, then stop. ünïcødé\n", "utf8");
    expect(store.writeMaterial(A, bytes)).toEqual({ ok: true });
    const read = store.readMaterial(A);
    expect(read.ok && read.bytes.equals(bytes)).toBe(true);
    expect(statSync(join(root, LAUNCHES_DIR, OCCURRENCES_DIR, A)).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(root, LAUNCHES_DIR, OCCURRENCES_DIR, A, MATERIAL_FILE)).equals(bytes)).toBe(true);
  });

  test("writeIntent makes a private attempt directory whose intent the strict reader accepts", () => {
    const root = tempRoot();
    const store = open(root);
    const correlationId = correlationIdOf(A, 1);
    const intent = { v: 1, kind: "intent", correlationId, occurrenceId: A, attempt: 1, launcherKind: "headless", material: pinOf(Buffer.from("m")), bootId: null, at: T0 } as const;
    expect(store.writeIntent(A, 1, intent)).toEqual({ ok: true });
    const dir = store.attemptDir(A, 1);
    expect(dir).toBe(join(root, LAUNCHES_DIR, OCCURRENCES_DIR, A, "a1"));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readArtefacts(dir, correlationId).intent).toEqual({ kind: "present", record: intent });
  });

  test("a path that is not an occurrence id is never turned into a directory", () => {
    const store = open(tempRoot());
    expect(store.writeMaterial("../../escape" as LaunchOccurrenceId, Buffer.from("x")).ok).toBe(false);
  });
});

describe("resetHistory (F2)", () => {
  const request = { actor: "greg", requestId: "resolve-store", why: "a corrupted line after a power cut", acceptHiddenLaunchRisk: true } as const;

  test("is refused while the history is whole", () => {
    const store = open(tempRoot());
    expect(store.resetHistory({ request, at: T0, ownerReservations: [] }).ok).toBe(false);
  });

  test("preserves the old journal byte-for-byte, carries what it can see, and starts whole", () => {
    const root = tempRoot();
    const hidden = idOf("cand-only-the-owner-knows");
    // F15: behind the hole, released, so only its artefact directory remembers it.
    const artefactsOnly = idOf("cand-only-the-artefacts-know");
    seed(root, [planned("cand-a"), "{a hole", planned("cand-b")]);
    const before = readFileSync(journalOf(root));
    mkdirSync(join(root, LAUNCHES_DIR, OCCURRENCES_DIR, A), { recursive: true });
    mkdirSync(join(root, LAUNCHES_DIR, OCCURRENCES_DIR, artefactsOnly, "a1"), { recursive: true });
    mkdirSync(join(root, LAUNCHES_DIR, OCCURRENCES_DIR, "not-an-occurrence-id"), { recursive: true });
    const store = open(root);
    const at = "2026-09-10T13:00:00.000Z";
    const reset = store.resetHistory({ request, at, ownerReservations: [{ key: reservationKeyOf(hidden), cls: "claude-session", slot: "claude-session#1" }] });
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(readFileSync(join(root, LAUNCHES_DIR, reset.reset.preservedAs)).equals(before)).toBe(true);
    expect(reset.reset.carried).toEqual(
      [
        { occurrenceId: A, lastSeen: "planned", ownerHeld: null },
        { occurrenceId: B, lastSeen: "planned", ownerHeld: null },
        { occurrenceId: hidden, lastSeen: null, ownerHeld: { slot: "claude-session#1" } },
        { occurrenceId: artefactsOnly, lastSeen: null, ownerHeld: null },
      ].sort((x, y) => x.occurrenceId.localeCompare(y.occurrenceId)),
    );
    expect(reset.reset.lostAt.line).toBe(2);
    const lines = readFileSync(journalOf(root), "utf8").split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}").kind).toBe("history-reset");
    expect(store.status()).toEqual({ kind: "whole" });
    expect(store.append(planned("cand-fresh"))).toEqual({ ok: true });
    // A carried occurrence is never planned again.
    expect(store.append(planned("cand-a")).ok).toBe(false);
    close(store);
    const reopened = open(root);
    expect(reopened.status()).toEqual({ kind: "whole" });
    expect([...reopened.fold().carried.keys()].sort()).toEqual([A, B, hidden, artefactsOnly].sort());
  });

  test("a retry after dying between the link and the replace finds its own link and finishes", () => {
    const root = tempRoot();
    seed(root, [planned("cand-a"), "{a hole"]);
    const store = open(root);
    const at = "2026-09-10T14:00:00.000Z";
    const preservedAs = `${LAUNCH_JOURNAL}.lost-${at.replace(/[^0-9]/g, "")}-${request.requestId}`;
    linkSync(journalOf(root), join(root, LAUNCHES_DIR, preservedAs));
    const reset = store.resetHistory({ request, at, ownerReservations: [] });
    expect(reset.ok).toBe(true);
    expect(store.status()).toEqual({ kind: "whole" });
  });
});
