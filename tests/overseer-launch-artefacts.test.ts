/**
 * The launch artefacts: the strict reader, the protocol's intent writer, and
 * the identity check (plan 260910f § D6/D7, F1, F11).
 *
 * The reader is the contract Stage 2's writers must round-trip through, so the
 * tests here are mostly about what it REFUSES: a record that is nearly right is
 * the one that would otherwise be read as evidence.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { readBootIdentity, readProcessStart, type BootIdentity } from "../tools/fleet/execution-identity.js";
import {
  EXIT_FILE,
  INTENT_FILE,
  MAX_ARTEFACT_BYTES,
  START_FILE,
  artefactText,
  identityOf,
  machineIdentity,
  probeProcess,
  readArtefacts,
  writeIntentFile,
  type ExitRecord,
  type LaunchIntent,
  type ProcessProbe,
  type StartRecord,
} from "../tools/overseer/launch-artefacts.js";
import { correlationIdOf, occurrenceIdOf, pinOf, recoveryOrigin } from "../tools/overseer/launch-protocol.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-launch-artefacts-"));
  roots.push(root);
  return root;
}

const ID = occurrenceIdOf(recoveryOrigin("artefact-candidate"));
const CID = correlationIdOf(ID, 1);
const OTHER_CID = correlationIdOf(occurrenceIdOf(recoveryOrigin("someone-else")), 1);
const AT = "2026-09-10T12:00:00.000Z";

const intent: LaunchIntent = {
  v: 1,
  kind: "intent",
  correlationId: CID,
  occurrenceId: ID,
  attempt: 1,
  launcherKind: "tmux",
  material: pinOf(Buffer.from("the prompt")),
  bootId: "boot-one",
  at: AT,
};
const start: StartRecord = { v: 1, kind: "start", correlationId: CID, pid: 4242, startTicks: 777, bootId: "boot-one", tmuxPane: "%3", at: AT };
const exit: ExitRecord = { v: 1, kind: "exit", correlationId: CID, ending: { kind: "exited", code: 0 }, timedOut: false, answer: null, at: AT };

describe("the reader", () => {
  test("the protocol's intent writer round-trips through the reader; the other two are absent", () => {
    const dir = tempDir();
    writeIntentFile(dir, intent);
    expect(readArtefacts(dir, CID)).toEqual({ intent: { kind: "present", record: intent }, start: { kind: "absent" }, exit: { kind: "absent" } });
  });

  test("start and exit records in every ending shape are read back exactly", () => {
    const dir = tempDir();
    writeFileSync(join(dir, START_FILE), artefactText(start));
    const endings: ExitRecord[] = [
      exit,
      { ...exit, ending: { kind: "signalled", signal: "SIGTERM" }, timedOut: true },
      { ...exit, ending: { kind: "supervisor-failed", why: "spawn ENOENT" } },
      { ...exit, answer: { path: "/tmp/answer.md", bytes: 12, sha256: "a".repeat(64), usable: true } },
    ];
    for (const one of endings) {
      writeFileSync(join(dir, EXIT_FILE), artefactText(one));
      const read = readArtefacts(dir, CID);
      expect(read.start).toEqual({ kind: "present", record: start });
      expect(read.exit).toEqual({ kind: "present", record: one });
    }
  });

  const refusals: readonly [string, string, string][] = [
    ["not JSON", START_FILE, "{half"],
    ["an unknown field", START_FILE, JSON.stringify({ ...start, extra: 1 })],
    ["a missing field", START_FILE, JSON.stringify({ ...start, startTicks: undefined })],
    ["another launch's correlation id", START_FILE, JSON.stringify({ ...start, correlationId: OTHER_CID })],
    ["the wrong kind", START_FILE, JSON.stringify({ ...start, kind: "exit" })],
    ["a fractional pid", START_FILE, JSON.stringify({ ...start, pid: 1.5 })],
    ["a date that is not toISOString's", START_FILE, JSON.stringify({ ...start, at: "2026-09-10" })],
    ["an exit ending this version does not know", EXIT_FILE, JSON.stringify({ ...exit, ending: { kind: "vanished" } })],
    ["an answer with a bad hash", EXIT_FILE, JSON.stringify({ ...exit, answer: { path: "/a", bytes: 1, sha256: "nope", usable: true } })],
    ["another launch's exit", EXIT_FILE, JSON.stringify({ ...exit, correlationId: OTHER_CID })],
    ["an intent whose correlation id is not its occurrence's attempt", INTENT_FILE, JSON.stringify({ ...intent, attempt: 2 })],
    ["a record larger than any launch record", START_FILE, JSON.stringify({ ...start, tmuxPane: "x".repeat(MAX_ARTEFACT_BYTES) })],
  ];
  test.each(refusals)("%s is unreadable, never evidence", (_name, file, text) => {
    const dir = tempDir();
    writeFileSync(join(dir, file), text);
    const read = readArtefacts(dir, CID);
    const got = file === START_FILE ? read.start : file === EXIT_FILE ? read.exit : read.intent;
    expect(got.kind).toBe("unreadable");
  });

  test("a read that fails for any reason but ENOENT is unreadable, not absent", () => {
    const read = readArtefacts("/nowhere", CID, () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    expect(read.intent.kind).toBe("unreadable");
    expect(read.start.kind).toBe("unreadable");
    expect(read.exit.kind).toBe("unreadable");
  });
});

describe("the identity check (F1: it is about the supervisor, and cannot-tell is never gone)", () => {
  const boot = (id: string): (() => BootIdentity) => () => ({ read: true, id });
  const probe = (answer: ProcessProbe): ((pid: number) => ProcessProbe) => () => answer;

  test.each([
    ["the same process", boot("boot-one"), probe({ kind: "ticks", ticks: 777 }), "alive"],
    ["a reused pid", boot("boot-one"), probe({ kind: "ticks", ticks: 900 }), "gone"],
    ["no such process", boot("boot-one"), probe({ kind: "no-such-process" }), "gone"],
    ["a reboot", boot("boot-two"), probe({ kind: "ticks", ticks: 777 }), "other-boot"],
    ["an unreadable stat", boot("boot-one"), probe({ kind: "unreadable", why: "EACCES" }), "cannot-tell"],
    ["an unreadable boot id", (): BootIdentity => ({ read: false, cause: "boot-identity-unreadable", why: "gone" }), probe({ kind: "ticks", ticks: 777 }), "cannot-tell"],
  ] as const)("%s → %s", (_name, bootPort, probePort, expected) => {
    expect(identityOf(start, { boot: bootPort, probe: probePort }).kind).toBe(expected);
  });

  const statLine = (ticks: number): string => ["4242 (a (tricky) name)", "S", "1", ...Array.from({ length: 17 }, () => "0"), String(ticks), "5"].join(" ");

  test("probeProcess reads the start tick through execution-identity's parser, brackets in the name and all", () => {
    expect(probeProcess(4242, () => statLine(777), () => true)).toEqual({ kind: "ticks", ticks: 777 });
  });

  test("ENOENT is proof of absence only when the kernel agrees", () => {
    const enoent = (): string => {
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    };
    expect(probeProcess(4242, enoent, () => false)).toEqual({ kind: "no-such-process" });
    // hidepid: the stat file is hidden and the process exists.
    expect(probeProcess(4242, enoent, () => true).kind).toBe("unreadable");
    const eacces = (): string => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    expect(probeProcess(4242, eacces, () => false).kind).toBe("unreadable");
  });

  test.skipIf(process.platform !== "linux")("on this machine: this process is alive, and a reaped child is gone", () => {
    const bootNow = readBootIdentity();
    expect(bootNow.read).toBe(true);
    if (!bootNow.read) return;
    const own = readProcessStart(process.pid);
    expect(own.read).toBe(true);
    if (!own.read) return;
    expect(identityOf({ pid: process.pid, startTicks: own.ticks, bootId: bootNow.id }, machineIdentity)).toEqual({ kind: "alive" });
    const child = spawnSync("true");
    expect(typeof child.pid).toBe("number");
    expect(identityOf({ pid: child.pid, startTicks: 1, bootId: bootNow.id }, machineIdentity).kind).toBe("gone");
  });

  test("the /proc readers are execution-identity's, imported rather than rewritten (F11)", () => {
    const source = readFileSync(fileURLToPath(new URL("../tools/overseer/launch-artefacts.ts", import.meta.url)), "utf8");
    expect(source).toMatch(/import \{[^}]*readBootIdentity[^}]*readProcessStart[^}]*\} from "\.\.\/fleet\/execution-identity\.js"/);
    expect(source).not.toContain('lastIndexOf(")")');
  });
});
