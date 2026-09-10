/**
 * The local admission owner (plan 260910f § D5, F2, F8).
 *
 * Every assertion that matters here is about what a SECOND owner, opened from
 * the same bytes, answers — because the lost-reply recovery the protocol relies
 * on is "ask again with the same key after a restart", and an owner that only
 * remembers in memory passes every single-process test.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  ADMISSION_DIR,
  ADMISSION_JOURNAL,
  asReservationKey,
  openLocalAdmission,
  type LocalAdmission,
  type Lookup,
  type ReservationKey,
} from "../tools/overseer/launch-admission.js";

const roots: string[] = [];
const opened = new Set<LocalAdmission>();

afterEach(() => {
  for (const owner of opened) owner.close();
  opened.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-launch-admission-"));
  roots.push(root);
  return root;
}

let tick = Date.parse("2026-09-10T12:00:00.000Z");
const now = (): Date => {
  tick += 1000;
  return new Date(tick);
};

function open(root: string, capacity?: number): LocalAdmission {
  const result = openLocalAdmission(capacity === undefined ? { root, now } : { root, now, capacity });
  if (!result.ok) throw new Error(`open refused: ${JSON.stringify(result.refusal)}`);
  opened.add(result.owner);
  return result.owner;
}

function close(owner: LocalAdmission): void {
  owner.close();
  opened.delete(owner);
}

function key(text: string): ReservationKey {
  const k = asReservationKey(text);
  if (k === null) throw new Error(`${text} is not a key`);
  return k;
}

const journalOf = (root: string): string => join(root, ADMISSION_DIR, ADMISSION_JOURNAL);
const linesOf = (root: string): Record<string, unknown>[] =>
  readFileSync(journalOf(root), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const A = key("lo-aaaaaaaaaaaaaaaaaaaa");
const B = key("lo-bbbbbbbbbbbbbbbbbbbb");
const C = key("lo-cccccccccccccccccccc");

describe("reserve, lookup, release", () => {
  test("reserving one key twice is one slot and one line", () => {
    const root = tempRoot();
    const owner = open(root);
    const first = owner.reserve(A, "claude-session");
    const second = owner.reserve(A, "claude-session");
    expect(first).toEqual({ kind: "reserved", slot: "claude-session#1", ownerId: "local-admission" });
    expect(second).toEqual(first);
    expect(linesOf(root).filter((line) => line["kind"] === "reserved")).toHaveLength(1);
  });

  test("a second key waits at capacity one, and waiting writes nothing and reserves nothing", () => {
    const root = tempRoot();
    const owner = open(root);
    owner.reserve(A, "claude-session");
    const grant = owner.reserve(B, "claude-session");
    expect(grant.kind).toBe("wait");
    expect(linesOf(root)).toHaveLength(1);
    expect(owner.lookup(B)).toEqual({ kind: "none" });
  });

  test("capacity two hands out two different slots", () => {
    const root = tempRoot();
    const owner = open(root, 2);
    const a = owner.reserve(A, "claude-session");
    const b = owner.reserve(B, "claude-session");
    expect(a.kind === "reserved" && b.kind === "reserved" && a.slot !== b.slot).toBe(true);
    expect(owner.reserve(C, "claude-session").kind).toBe("wait");
  });

  test("release is idempotent and writes its licence down once", () => {
    const root = tempRoot();
    const owner = open(root);
    owner.reserve(A, "claude-session");
    expect(owner.release(A, { kind: "terminal", state: "completed" })).toEqual({ kind: "released" });
    expect(owner.release(A, { kind: "terminal", state: "completed" })).toEqual({ kind: "was-not-held" });
    const released = linesOf(root).filter((line) => line["kind"] === "released");
    expect(released).toHaveLength(1);
    expect(released[0]?.["because"]).toEqual({ kind: "terminal", state: "completed" });
    expect(owner.lookup(A)).toEqual({ kind: "none" });
    // And the slot is free again.
    expect(owner.reserve(B, "claude-session").kind).toBe("reserved");
  });

  test("lookup answers only reserved or none — a wait is not a reservation (F8)", () => {
    const root = tempRoot();
    const owner = open(root);
    owner.reserve(A, "claude-session");
    owner.reserve(B, "claude-session"); // waits
    const lookups: Lookup[] = [owner.lookup(A), owner.lookup(B), owner.lookup(C)];
    expect(lookups.map((one) => one.kind)).toEqual(["reserved", "none", "none"]);
    const one = owner.lookup(B);
    // @ts-expect-error — `wait` is not a Lookup arm, so this comparison cannot compile.
    expect(one.kind === "wait").toBe(false);
  });

  test("a key that is not a reservation key is refused, not reserved", () => {
    const owner = open(tempRoot());
    expect(owner.reserve("Not A Key" as ReservationKey, "claude-session").kind).toBe("refused");
  });
});

describe("durability", () => {
  test("state survives a reopen: the same slot comes back, and the class is still full", () => {
    const root = tempRoot();
    const first = open(root);
    const grant = first.reserve(A, "claude-session");
    close(first);
    const second = open(root);
    expect(second.lookup(A)).toEqual(grant);
    expect(second.reserve(A, "claude-session")).toEqual(grant);
    expect(second.reserve(B, "claude-session").kind).toBe("wait");
    expect(linesOf(root).filter((line) => line["kind"] === "reserved")).toHaveLength(1);
  });

  test("one writer: a second owner on the same directory is refused", () => {
    const root = tempRoot();
    open(root);
    const second = openLocalAdmission({ root, now });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.refusal.reason).toBe("already-running");
  });

  test("a relative root is refused", () => {
    const result = openLocalAdmission({ root: "relative/admission", now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("relative-root");
  });

  test("the directory is private", () => {
    const root = tempRoot();
    open(root);
    expect(statSync(join(root, ADMISSION_DIR)).mode & 0o777).toBe(0o700);
  });

  test("a torn last line is truncated on open and the table is intact", () => {
    const root = tempRoot();
    const first = open(root);
    first.reserve(A, "claude-session");
    close(first);
    appendFileSync(journalOf(root), '{"v":1,"kind":"rese');
    const second = open(root);
    expect(second.repair.torn).toBe(true);
    expect(second.status()).toEqual({ kind: "whole", lines: 1 });
    expect(second.lookup(A).kind).toBe("reserved");
    second.release(A, { kind: "terminal", state: "completed" });
    close(second);
    expect(open(root).status()).toEqual({ kind: "whole", lines: 2 });
  });
});

describe("history-lost, and the attributed way out (F2, F11)", () => {
  function seed(root: string, lines: readonly (string | Record<string, unknown>)[]): void {
    mkdirSync(join(root, ADMISSION_DIR), { recursive: true, mode: 0o700 });
    writeFileSync(journalOf(root), `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`);
  }
  const at = "2026-09-10T11:00:00.000Z";
  const reserved = (k: string, slot = "claude-session#1"): Record<string, unknown> => ({ v: 1, kind: "reserved", at, key: k, cls: "claude-session", slot });
  const released = (k: string): Record<string, unknown> => ({ v: 1, kind: "released", at, key: k, because: { kind: "terminal", state: "completed" } });

  test.each([
    ["an interior line that is not JSON", ["{not json", reserved(B)], 1],
    // F14: a blank record is a record that does not parse, not a gap to skip.
    ["a blank interior line", [reserved(A), ""], 2],
    ["a blank first line", [""], 1],
    ["an unknown schema", [{ ...reserved(A), v: 2 }], 1],
    ["an unknown kind", [reserved(A), { v: 1, kind: "borrowed", at, key: A }], 2],
    ["an unexpected field", [{ ...reserved(A), extra: true }], 1],
    ["a release of a key nobody holds", [released(A)], 1],
    ["a second reservation of a held key", [reserved(A), reserved(A, "claude-session#2")], 2],
    ["one slot given to two keys", [reserved(A), reserved(B)], 2],
    ["a history reset after the first line", [reserved(A), { v: 1, kind: "history-reset", at, actor: "greg", requestId: "r1", why: "x", preservedAs: "p", lostAt: { line: 1, why: "x" }, carried: [] }], 2],
  ] as const)("%s is history-lost, and nothing after it is folded", (_name, lines, atLine) => {
    const root = tempRoot();
    seed(root, [...lines, reserved(C, "claude-session#9")]);
    const owner = open(root);
    const status = owner.status();
    expect(status.kind).toBe("history-lost");
    if (status.kind === "history-lost") expect(status.atLine).toBe(atLine);
    expect(owner.lookup(C).kind).toBe("unavailable");
  });

  test("a lost owner refuses to reserve and cannot answer a lookup, a release or an inventory", () => {
    const root = tempRoot();
    seed(root, [reserved(A), "garbage"]);
    const owner = open(root);
    expect(owner.reserve(B, "claude-session").kind).toBe("refused");
    expect(owner.lookup(A).kind).toBe("unavailable");
    expect(owner.release(A, { kind: "terminal", state: "completed" }).kind).toBe("unavailable");
    expect(owner.inventory().kind).toBe("unavailable");
  });

  test("resolveHistory preserves the old journal byte-for-byte and carries every reservation it can still see", () => {
    const root = tempRoot();
    // A is held before the hole; B is reserved AFTER it, so only the salvage sees it.
    seed(root, [reserved(A), "{torn in the middle", reserved(B, "claude-session#2")]);
    const before = readFileSync(journalOf(root));
    const owner = open(root);
    expect(owner.resolveHistory({ actor: "greg", requestId: "resolve-1", why: "", acceptHiddenLaunchRisk: true })).toEqual({ ok: false, why: "the request gives no reason" });
    const resolved = owner.resolveHistory({ actor: "greg", requestId: "resolve-1", why: "a disk hiccup", acceptHiddenLaunchRisk: true });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(readFileSync(join(root, ADMISSION_DIR, resolved.preservedAs)).equals(before)).toBe(true);
    expect(resolved.carried.map((one) => one.key).sort()).toEqual([A, B]);
    const fresh = linesOf(root);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.["kind"]).toBe("history-reset");
    expect(owner.status().kind).toBe("whole");
    expect(owner.lookup(B)).toEqual({ kind: "reserved", slot: "claude-session#2", ownerId: "local-admission" });
    expect(owner.release(A, { kind: "disposed", requestId: "dispose-a" })).toEqual({ kind: "released" });
    close(owner);
    const reopened = open(root);
    expect(reopened.status()).toEqual({ kind: "whole", lines: 2 });
    expect(reopened.lookup(A).kind).toBe("none");
    expect(reopened.lookup(B).kind).toBe("reserved");
  });

  test("resolveHistory is refused when the history is whole", () => {
    const owner = open(tempRoot());
    expect(owner.resolveHistory({ actor: "greg", requestId: "resolve-2", why: "nothing wrong", acceptHiddenLaunchRisk: true }).ok).toBe(false);
  });
});
