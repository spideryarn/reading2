/**
 * `probeStoreFiles` — what each file in a store directory looks like from the
 * outside: there or not, how big, how old, which schema it declares, and
 * whether an append-only log ends mid-line.
 *
 * The cases that matter are the ones a careless probe would collapse: absent is
 * not unreadable, a file that declares no schema is not one whose schema could
 * not be read, and a log caught between an append's first byte and its newline
 * is TORN, which is different from corrupt.
 *
 * And, since the dashboard runs it per request (plan 260910f, Sol's F8): only
 * names on its fixed allow-list are probed, a symbolic link or a non-regular
 * file is reported and never followed or opened, a JSON file past the byte
 * ceiling is sized and aged with its schema unknown and the reason given, and
 * a JSONL log is read only from its bounded tail. Scratch directories only.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { JSON_MAX_BYTES, JSONL_TAIL_BYTES, STORE_PROBE_FILES, probeStoreFiles, readStoreTail } from "../tools/fleet/store-probe.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fleet-store-probe-test-"));
  roots.push(root);
  return root;
}

const NOW = new Date("2026-09-10T12:00:00.000Z");

describe("probeStoreFiles", () => {
  test("an absent file is absent, one entry per name, in the order asked", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), `${JSON.stringify({ schema: 3 })}\n`);
    const probes = probeStoreFiles(root, ["recovery.json", "current.json"], NOW);
    expect(probes.map((p) => p.name)).toEqual(["recovery.json", "current.json"]);
    expect(probes[0]).toEqual({ name: "recovery.json", state: "absent" });
    expect(probes[1]).toMatchObject({ state: "present", format: "json", schema: 3, tornTail: null, schemaUnread: null });
  });

  test("size and age come from the file, against the clock given", () => {
    const root = tempRoot();
    const path = join(root, "current.json");
    const text = `${JSON.stringify({ schema: 1, pad: "x".repeat(10) })}\n`;
    writeFileSync(path, text);
    const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60_000);
    utimesSync(path, tenMinutesAgo, tenMinutesAgo);
    const [probe] = probeStoreFiles(root, ["current.json"], NOW);
    expect(probe).toMatchObject({ state: "present", bytes: Buffer.byteLength(text), mtimeAgeMs: 10 * 60_000 });
  });

  test("a JSON file with no schema field declares none; one that does not parse is null, not none, and says why", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), `${JSON.stringify({ pid: 1 })}\n`);
    writeFileSync(join(root, "recovery.json"), "{ not json");
    writeFileSync(join(root, "schedule.json"), `${JSON.stringify({ schema: "2" })}\n`);
    const [plain, broken, odd] = probeStoreFiles(root, ["current.json", "recovery.json", "schedule.json"], NOW);
    expect(plain).toMatchObject({ state: "present", schema: "none-declared", schemaUnread: null });
    expect(broken).toMatchObject({ state: "present", schema: null });
    if (broken?.state === "present") expect(broken.schemaUnread).toContain("not a JSON object");
    // A schema that is not a number is not a schema this probe can compare.
    expect(odd).toMatchObject({ state: "present", schema: null });
    if (odd?.state === "present") expect(odd.schemaUnread).toContain("not a number");
  });

  test("a JSONL file's schema is its last COMPLETE line's, and a missing final newline is a torn tail", () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "events.jsonl"),
      `${JSON.stringify({ schema: 1, at: "2026-09-10T11:00:00.000Z" })}\n${JSON.stringify({ schema: 2, at: "2026-09-10T11:30:00.000Z" })}\n{"schema":3,"at":"2026-09-10T11:5`,
    );
    const [probe] = probeStoreFiles(root, ["events.jsonl"], NOW);
    expect(probe).toMatchObject({ state: "present", format: "jsonl", schema: 2, tornTail: true, lastLineAt: "2026-09-10T11:30:00.000Z" });
  });

  test("a whole JSONL file is not torn", () => {
    const root = tempRoot();
    writeFileSync(join(root, "events.jsonl"), `${JSON.stringify({ kind: "x", at: "2026-09-10T11:00:00.000Z" })}\n`);
    const [probe] = probeStoreFiles(root, ["events.jsonl"], NOW);
    expect(probe).toMatchObject({ state: "present", schema: "none-declared", tornTail: false, lastLineAt: "2026-09-10T11:00:00.000Z" });
  });

  test("a JSONL file can name its schema field something else", () => {
    const root = tempRoot();
    writeFileSync(join(root, "usage.jsonl"), `${JSON.stringify({ lineSchema: 1, recordedAt: "2026-09-10T11:00:00.000Z" })}\n`);
    const [probe] = probeStoreFiles(root, [{ name: "usage.jsonl", schemaField: "lineSchema" }], NOW);
    expect(probe).toMatchObject({ state: "present", schema: 1, lastLineAt: "2026-09-10T11:00:00.000Z" });
  });

  test("a large JSONL file is read from its tail only, and the window's first partial line is not mistaken for a record", () => {
    const root = tempRoot();
    const line = (n: number): string => `${JSON.stringify({ schema: 1, n, pad: "y".repeat(200) })}\n`;
    let text = "";
    for (let n = 0; text.length < JSONL_TAIL_BYTES * 3; n += 1) text += line(n);
    text += `${JSON.stringify({ schema: 7, at: "2026-09-10T11:59:00.000Z" })}\n`;
    writeFileSync(join(root, "events.jsonl"), text);
    const [probe] = probeStoreFiles(root, ["events.jsonl"], NOW);
    expect(probe).toMatchObject({ state: "present", schema: 7, tornTail: false, bytes: Buffer.byteLength(text) });
  });

  test("an empty JSONL file declares nothing readable, says so, and is not torn", () => {
    const root = tempRoot();
    writeFileSync(join(root, "daemon.jsonl"), "");
    const [probe] = probeStoreFiles(root, ["daemon.jsonl"], NOW);
    expect(probe).toMatchObject({ state: "present", bytes: 0, schema: null, tornTail: false });
    if (probe?.state === "present") expect(probe.schemaUnread).toContain("no complete line");
  });

  test("a file of another kind is sized and aged, and its contents are not guessed at", () => {
    const root = tempRoot();
    writeFileSync(join(root, "overseer.lock"), `${JSON.stringify({ pid: 1 })}\n`);
    const [probe] = probeStoreFiles(root, ["overseer.lock"], NOW);
    expect(probe).toMatchObject({ state: "present", format: "other", schema: null, tornTail: null });
  });

  test("a name that is a directory, or cannot be opened, is unreadable with the reason", () => {
    const root = tempRoot();
    mkdirSync(join(root, "attention.json"));
    const locked = join(root, "cli-state.json");
    writeFileSync(locked, "{}\n");
    chmodSync(locked, 0o000);
    const [dir, lockedProbe] = probeStoreFiles(root, ["attention.json", "cli-state.json"], NOW);
    expect(dir).toMatchObject({ state: "unreadable" });
    if (dir?.state === "unreadable") expect(dir.why).toContain("a directory, not a regular file");
    // root can read a 000 file; on any other user this is unreadable.
    if (process.getuid?.() !== 0) expect(lockedProbe).toMatchObject({ state: "unreadable" });
  });
});

describe("the per-request contract (Sol's F8)", () => {
  test("a name off the fixed allow-list is sized and aged but its contents are never read; a path is refused outright", () => {
    const root = tempRoot();
    writeFileSync(join(root, "secrets.json"), `${JSON.stringify({ schema: 1 })}\n`);
    const [odd, outside, dot] = probeStoreFiles(root, ["secrets.json", "../current.json", ".."], NOW);
    // schema 1 is IN the file; a probe that read it would say so.
    expect(odd).toMatchObject({ state: "present", format: "other", schema: null, tornTail: null });
    if (odd?.state === "present") expect(odd.schemaUnread).toContain("not on this probe's allow-list");
    expect(outside).toMatchObject({ state: "unreadable" });
    if (outside?.state === "unreadable") expect(outside.why).toContain("not a plain file name");
    expect(dot).toMatchObject({ state: "unreadable" });
    // Off the list, a symlink is still reported and not followed.
    const elsewhere = tempRoot();
    writeFileSync(join(elsewhere, "t.json"), "{}\n");
    symlinkSync(join(elsewhere, "t.json"), join(root, "linked.json"));
    const [linked] = probeStoreFiles(root, ["linked.json"], NOW);
    expect(linked).toMatchObject({ state: "unreadable" });
  });

  test("every name in STORE_PROBE_FILES is on the allow-list, and the list is the store's file set", () => {
    const root = tempRoot();
    const probes = probeStoreFiles(root, STORE_PROBE_FILES, NOW);
    expect(probes.every((p) => p.state === "absent")).toBe(true);
    expect(probes.map((p) => p.name)).toContain("daemon.jsonl");
    expect(probes.map((p) => p.name)).toContain("current.json");
  });

  test("a symbolic link is reported and NOT followed, even when its target is a readable store file", () => {
    const root = tempRoot();
    const elsewhere = tempRoot();
    writeFileSync(join(elsewhere, "target.json"), `${JSON.stringify({ schema: 2 })}\n`);
    symlinkSync(join(elsewhere, "target.json"), join(root, "current.json"));
    const [probe] = probeStoreFiles(root, ["current.json"], NOW);
    expect(probe).toMatchObject({ state: "unreadable" });
    if (probe?.state === "unreadable") expect(probe.why).toContain("symbolic link");
    // A dangling link is a link too, not an absent file.
    symlinkSync(join(elsewhere, "nowhere.json"), join(root, "recovery.json"));
    const [dangling] = probeStoreFiles(root, ["recovery.json"], NOW);
    expect(dangling).toMatchObject({ state: "unreadable" });
  });

  test("a FIFO is reported without being opened — opening one for reading would block the request", () => {
    const root = tempRoot();
    execFileSync("mkfifo", [join(root, "events.jsonl")]);
    const [probe] = probeStoreFiles(root, ["events.jsonl"], NOW);
    expect(probe).toMatchObject({ state: "unreadable" });
    if (probe?.state === "unreadable") expect(probe.why).toContain("not a regular file");
  });

  test("a JSON file past the byte ceiling is sized and aged, and its schema is unknown BECAUSE it is too large", () => {
    const root = tempRoot();
    const text = `${JSON.stringify({ schema: 2, pad: "z".repeat(JSON_MAX_BYTES) })}\n`;
    writeFileSync(join(root, "current.json"), text);
    const [probe] = probeStoreFiles(root, ["current.json"], NOW);
    expect(probe).toMatchObject({ state: "present", bytes: Buffer.byteLength(text), schema: null });
    if (probe?.state === "present") expect(probe.schemaUnread).toContain("too large to read in a request");
  });

  test("readStoreTail returns only the bounded final chunk, and says when it started mid-file", () => {
    const root = tempRoot();
    const text = `${"a".repeat(5000)}\n${"b".repeat(100)}\n`;
    writeFileSync(join(root, "daemon.jsonl"), text);
    const read = readStoreTail(root, "daemon.jsonl", 200);
    expect(read.kind).toBe("read");
    if (read.kind !== "read") return;
    expect(read.tail.byteLength).toBe(200);
    expect(read.windowed).toBe(true);
    expect(read.bytes).toBe(Buffer.byteLength(text));
    expect(read.tail.toString("utf8").endsWith(`${"b".repeat(100)}\n`)).toBe(true);
  });

  test("readStoreTail refuses the same things the probe does", () => {
    const root = tempRoot();
    const elsewhere = tempRoot();
    writeFileSync(join(elsewhere, "x.jsonl"), "{}\n");
    symlinkSync(join(elsewhere, "x.jsonl"), join(root, "daemon.jsonl"));
    expect(readStoreTail(root, "daemon.jsonl", 1024).kind).toBe("unreadable");
    expect(readStoreTail(root, "anything.jsonl", 1024).kind).toBe("unreadable");
    expect(readStoreTail(root, "events.jsonl", 1024)).toEqual({ kind: "absent" });
  });
});
