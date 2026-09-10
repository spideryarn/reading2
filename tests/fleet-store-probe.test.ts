/**
 * `probeStoreFiles` — what each file in a store directory looks like from the
 * outside: there or not, how big, how old, which schema it declares, and
 * whether an append-only log ends mid-line.
 *
 * The cases that matter are the ones a careless probe would collapse: absent is
 * not unreadable, a file that declares no schema is not one whose schema could
 * not be read, and a log caught between an append's first byte and its newline
 * is TORN, which is different from corrupt. Scratch directories only.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { JSONL_TAIL_BYTES, probeStoreFiles } from "../tools/fleet/store-probe.js";

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
    writeFileSync(join(root, "here.json"), `${JSON.stringify({ schema: 3 })}\n`);
    const probes = probeStoreFiles(root, ["missing.json", "here.json"], NOW);
    expect(probes.map((p) => p.name)).toEqual(["missing.json", "here.json"]);
    expect(probes[0]).toEqual({ name: "missing.json", state: "absent" });
    expect(probes[1]).toMatchObject({ state: "present", format: "json", schema: 3, tornTail: null });
  });

  test("size and age come from the file, against the clock given", () => {
    const root = tempRoot();
    const path = join(root, "a.json");
    const text = `${JSON.stringify({ schema: 1, pad: "x".repeat(10) })}\n`;
    writeFileSync(path, text);
    const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60_000);
    utimesSync(path, tenMinutesAgo, tenMinutesAgo);
    const [probe] = probeStoreFiles(root, ["a.json"], NOW);
    expect(probe).toMatchObject({ state: "present", bytes: Buffer.byteLength(text), mtimeAgeMs: 10 * 60_000 });
  });

  test("a JSON file with no schema field declares none; one that does not parse is null, not none", () => {
    const root = tempRoot();
    writeFileSync(join(root, "plain.json"), `${JSON.stringify({ pid: 1 })}\n`);
    writeFileSync(join(root, "broken.json"), "{ not json");
    writeFileSync(join(root, "odd.json"), `${JSON.stringify({ schema: "2" })}\n`);
    const [plain, broken, odd] = probeStoreFiles(root, ["plain.json", "broken.json", "odd.json"], NOW);
    expect(plain).toMatchObject({ state: "present", schema: "none-declared" });
    expect(broken).toMatchObject({ state: "present", schema: null });
    // A schema that is not a number is not a schema this probe can compare.
    expect(odd).toMatchObject({ state: "present", schema: null });
  });

  test("a JSONL file's schema is its last COMPLETE line's, and a missing final newline is a torn tail", () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "log.jsonl"),
      `${JSON.stringify({ schema: 1, at: "2026-09-10T11:00:00.000Z" })}\n${JSON.stringify({ schema: 2, at: "2026-09-10T11:30:00.000Z" })}\n{"schema":3,"at":"2026-09-10T11:5`,
    );
    const [probe] = probeStoreFiles(root, ["log.jsonl"], NOW);
    expect(probe).toMatchObject({ state: "present", format: "jsonl", schema: 2, tornTail: true, lastLineAt: "2026-09-10T11:30:00.000Z" });
  });

  test("a whole JSONL file is not torn", () => {
    const root = tempRoot();
    writeFileSync(join(root, "log.jsonl"), `${JSON.stringify({ kind: "x", at: "2026-09-10T11:00:00.000Z" })}\n`);
    const [probe] = probeStoreFiles(root, ["log.jsonl"], NOW);
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
    writeFileSync(join(root, "big.jsonl"), text);
    const [probe] = probeStoreFiles(root, ["big.jsonl"], NOW);
    expect(probe).toMatchObject({ state: "present", schema: 7, tornTail: false, bytes: Buffer.byteLength(text) });
  });

  test("an empty JSONL file declares nothing readable and is not torn", () => {
    const root = tempRoot();
    writeFileSync(join(root, "empty.jsonl"), "");
    const [probe] = probeStoreFiles(root, ["empty.jsonl"], NOW);
    expect(probe).toMatchObject({ state: "present", bytes: 0, schema: null, tornTail: false });
  });

  test("a file of another kind is sized and aged, and its contents are not guessed at", () => {
    const root = tempRoot();
    writeFileSync(join(root, "overseer.lock"), `${JSON.stringify({ pid: 1 })}\n`);
    const [probe] = probeStoreFiles(root, ["overseer.lock"], NOW);
    expect(probe).toMatchObject({ state: "present", format: "other", schema: null, tornTail: null });
  });

  test("a name that is a directory, or cannot be opened, is unreadable with the reason", () => {
    const root = tempRoot();
    mkdirSync(join(root, "dir.json"));
    const locked = join(root, "locked.json");
    writeFileSync(locked, "{}\n");
    chmodSync(locked, 0o000);
    const [dir, lockedProbe] = probeStoreFiles(root, ["dir.json", "locked.json"], NOW);
    expect(dir).toMatchObject({ state: "unreadable" });
    if (dir?.state === "unreadable") expect(dir.why).toContain("not a file");
    // root can read a 000 file; on any other user this is unreadable.
    if (process.getuid?.() !== 0) expect(lockedProbe).toMatchObject({ state: "unreadable" });
  });
});
