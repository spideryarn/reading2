/**
 * `recovery.json` at the fleet boundary: every arm, the ordering, the
 * first-page cap, and the failures that must never become an empty list.
 *
 * The fixtures are the daemon's own shapes (tools/overseer/store.ts §
 * `recoveryFileText`, recovery-view.ts), written by hand here because this
 * suite is about the fleet's validator, not the daemon. The drill in
 * tests/fleet-recovery-wiring.test.ts is the file the real daemon writes.
 */
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync, type Stats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KNOWN_RECOVERY_SCHEMA,
  MAX_RECOVERY_INPUT_BYTES,
  RECOVERY_FILE,
  RECOVERY_FIRST_PAGE,
  loadRecoveryFile,
  projectRecovery,
  type RecoveryFileLoad,
} from "../tools/fleet/recovery-feed.js";
import { parseRecoveryFeed } from "../tools/fleet/web/src/recovery-client";
import type { RecoveryFeed } from "../tools/fleet/wire.js";

const COMPOSED = "2026-09-10T15:00:00.000Z";
const CONVERSATION = "7d2e91c4-3b8a-4f06-a5d1-c9e04b7f2a63";
const CLAIM = "e4b07a19-6c2d-4e8f-913a-5f8d2c7b0e41";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleet-recovery-feed-"));
  dirs.push(dir);
  return dir;
}

type Json = Record<string, unknown>;

function rawRecord(id: string, at: string, over: Json = {}): Json {
  return {
    id,
    key: `$${id.length} none`,
    name: `session-${id}`,
    at,
    origin: "journal",
    resolution: { disposition: "unresolved" },
    oversize: false,
    entry: {
      key: `$${id.length} none`,
      meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: `/work/${id}` },
      worktree: null,
      lastSeenAlive: "2026-09-10T13:00:00.000Z",
      lastStatusKey: "working",
    },
    lastSeen: { statusKey: "working", title: null, harness: "claude-code", executionToken: "b:1:2", conversation: null, collectedAt: "2026-09-10T13:00:00.000Z" },
    disappearance: { goneWhy: "tmux-server-changed", observation: "run x collection 1", generation: "changed", bootChanged: true, producerRun: "changed", watched: true, hostBootId: null },
    ...over,
  };
}

function checked(transcript: Json = { kind: "no-conversation", why: "none" }): Json {
  return {
    kind: "checked",
    dir: { kind: "exists", path: "/work/x" },
    worktree: { kind: "none" },
    transcript,
    lastActivity: { at: "2026-09-10T13:00:00.000Z", source: "register-floor" },
    resume: { kind: "not-supported", why: "no verified execution was seen, so the harness is not known" },
  };
}

function item(record: Json, classification: Json | null, evidence: Json | null = checked()): Json {
  return { id: record["id"], key: record["key"], name: record["name"], at: record["at"], resolution: record["resolution"], classification, evidence };
}

function file(records: Json[], view: Json | null, over: Json = {}): Json {
  return {
    schema: 1,
    writtenAt: "2026-09-10T14:59:00.000Z",
    cursor: { events: 10, bytes: 1000 },
    bootId: "boot",
    replay: { kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 1000 },
    overflow: 0,
    records,
    overflowIds: [],
    pending: [],
    appliedRequests: [],
    view,
    ...over,
  };
}

function view(page: Json[], inventory: Json = { kind: "trusted", collectedAt: "2026-09-10T14:58:00.000Z", observation: "run y collection 2", rows: 3 }): Json {
  return { checkedAt: "2026-09-10T14:58:30.000Z", inventory, page, olderCount: 0 };
}

function project(json: unknown): RecoveryFeed {
  return projectRecovery({ kind: "json", path: "/store/recovery.json", json }, COMPOSED);
}

function published(feed: RecoveryFeed): Extract<RecoveryFeed, { kind: "published" }> {
  if (feed.kind !== "published") throw new Error(`expected published, got ${JSON.stringify(feed)}`);
  // EVERY PUBLISHED PROJECTION IN THIS FILE MUST SATISFY THE BROWSER'S
  // WHOLE-PAYLOAD CONTRACT (Sol's F30). A rule the client refuses that this
  // projection produces would be a page saying "no answer" over a good index.
  expect(parseRecoveryFeed(JSON.parse(JSON.stringify(feed)))).toEqual(feed);
  return feed;
}

describe("reading the file: the arms before any shape", () => {
  it("absent when there is no file, with the path and a sentence, and no list", async () => {
    const root = tempRoot();
    const load = await loadRecoveryFile(root);
    expect(load).toEqual({ kind: "absent", path: join(root, RECOVERY_FILE) });
    const feed = projectRecovery(load, COMPOSED);
    expect(feed.kind).toBe("absent");
    expect(feed).not.toHaveProperty("records");
  });

  it("unreadable for an empty file, for bytes that are not JSON, and for a directory in the file's place", async () => {
    const empty = tempRoot();
    writeFileSync(join(empty, RECOVERY_FILE), "  \n");
    expect(await loadRecoveryFile(empty)).toMatchObject({ kind: "unreadable", why: expect.stringMatching(/empty/) });

    const garbage = tempRoot();
    writeFileSync(join(garbage, RECOVERY_FILE), "{not json");
    expect(await loadRecoveryFile(garbage)).toMatchObject({ kind: "unreadable", why: expect.stringMatching(/not JSON/) });

    const directory = tempRoot();
    mkdirSync(join(directory, RECOVERY_FILE));
    const load = await loadRecoveryFile(directory);
    expect(load.kind).toBe("unreadable");
    expect(projectRecovery(load, COMPOSED)).not.toHaveProperty("records");
  });

  it("refuses an oversized file before reading it", async () => {
    const root = tempRoot();
    const path = join(root, RECOVERY_FILE);
    writeFileSync(path, "");
    // Sparse: the size is what is checked, and it is checked before any read.
    truncateSync(path, MAX_RECOVERY_INPUT_BYTES + 1);
    const load = await loadRecoveryFile(root);
    expect(load).toEqual({ kind: "oversized", path, sizeBytes: MAX_RECOVERY_INPUT_BYTES + 1, limitBytes: MAX_RECOVERY_INPUT_BYTES });
    const feed = projectRecovery(load, COMPOSED);
    expect(feed).toMatchObject({ kind: "oversized", sizeBytes: MAX_RECOVERY_INPUT_BYTES + 1, limitBytes: MAX_RECOVERY_INPUT_BYTES });
    expect(feed).not.toHaveProperty("records");
  });

  it("a file that grows after its size is checked is refused as oversized, and never read past one byte over the limit (F27)", async () => {
    const root = tempRoot();
    const path = join(root, RECOVERY_FILE);
    writeFileSync(path, JSON.stringify(file([], null)));
    const probe = await open(path, "r");
    const proto = Object.getPrototypeOf(probe) as FileHandle;
    await probe.close();
    const realStat = proto.stat as (this: FileHandle) => Promise<Stats>;
    const realRead = proto.read as (this: FileHandle, ...args: unknown[]) => Promise<{ bytesRead: number }>;
    let grown = 0;
    let bytesRead = 0;
    // THE RACE, MADE DETERMINISTIC: the size is taken, and then the file grows
    // (sparse, so this costs no disk) before anything reads it.
    const stat = vi.spyOn(proto as unknown as { stat(): Promise<Stats> }, "stat").mockImplementation(async function (this: FileHandle) {
      const stats = await realStat.call(this);
      truncateSync(path, MAX_RECOVERY_INPUT_BYTES + 4096);
      grown += 1;
      return stats;
    });
    const read = vi
      .spyOn(proto as unknown as { read(...args: unknown[]): Promise<{ bytesRead: number }> }, "read")
      .mockImplementation(async function (this: FileHandle, ...args: unknown[]) {
        const result = await realRead.apply(this, args);
        bytesRead += result.bytesRead;
        return result;
      });
    try {
      const load = await loadRecoveryFile(root);
      expect(grown).toBeGreaterThan(0);
      expect(load).toMatchObject({ kind: "oversized", path, limitBytes: MAX_RECOVERY_INPUT_BYTES });
      if (load.kind === "oversized") expect(load.sizeBytes).toBeGreaterThan(MAX_RECOVERY_INPUT_BYTES);
      expect(bytesRead).toBeLessThanOrEqual(MAX_RECOVERY_INPUT_BYTES + 1);
    } finally {
      stat.mockRestore();
      read.mockRestore();
    }
  });

  it("resolves the store from OVERSEER_STORE_DIR at call time, and a relative one is unreadable rather than a throw", async () => {
    const root = tempRoot();
    writeFileSync(join(root, RECOVERY_FILE), JSON.stringify(file([], null)));
    vi.stubEnv("OVERSEER_STORE_DIR", root);
    expect((await loadRecoveryFile()).kind).toBe("json");
    vi.stubEnv("OVERSEER_STORE_DIR", "relative/store");
    expect(await loadRecoveryFile()).toMatchObject({ kind: "unreadable", why: expect.stringMatching(/absolute/) });
  });
});

describe("the schema and the records", () => {
  it("an unknown schema says what it saw and what it knows, and shows no records", () => {
    const feed = project({ ...file([rawRecord("rc-a", "2026-09-10T14:00:00.000Z")], null), schema: 2 });
    expect(feed).toMatchObject({ kind: "unsupported-schema", saw: "2", known: KNOWN_RECOVERY_SCHEMA });
    expect(feed).not.toHaveProperty("records");
    expect(project({ ...file([], null), schema: undefined })).toMatchObject({ kind: "unsupported-schema", saw: "nothing" });
  });

  it("a malformed record refuses the whole file, naming it — never a shorter list", () => {
    const good = rawRecord("rc-good", "2026-09-10T14:00:00.000Z");
    const broken = rawRecord("rc-broken", "2026-09-10T14:01:00.000Z", { disappearance: { goneWhy: "x", generation: "sideways" } });
    const feed = project(file([good, broken], null));
    expect(feed.kind).toBe("unreadable");
    expect(feed).toMatchObject({ why: expect.stringMatching(/records\[1\]/) });
    expect(feed).not.toHaveProperty("records");
  });

  it("a journal record with no entry is malformed; a legacy stub with none is not", () => {
    expect(project(file([rawRecord("rc-a", "2026-09-10T14:00:00.000Z", { entry: null })], null)).kind).toBe("unreadable");
    const legacy = published(project(file([rawRecord("rl-a", "2026-09-10T14:00:00.000Z", { entry: null, origin: "legacy", lastSeen: null })], null)));
    expect(legacy.records[0]).toMatchObject({ origin: "legacy", entry: null, lastSeen: null });
  });

  it("an oversize stub keeps its address and says so", () => {
    const stub = { id: "rc-big", key: "$9 none", name: "big", at: "2026-09-10T14:00:00.000Z", origin: "journal", resolution: { disposition: "unresolved" }, oversize: true };
    const feed = published(project(file([stub], null)));
    expect(feed.records[0]).toMatchObject({ id: "rc-big", oversize: true, entry: null, disappearance: null, state: { kind: "unchecked" } });
  });

  it("a published index with no records is the one real empty list", () => {
    const feed = published(project(file([], null)));
    expect(feed.records).toEqual([]);
    expect(feed).toMatchObject({ total: 0, unresolved: 0, olderCount: 0 });
  });
});

describe("the view, and the states that are not a list", () => {
  it("view null: every record is unchecked, 'not yet checked by this daemon', and still shown", () => {
    const records = [rawRecord("rc-a", "2026-09-10T14:00:00.000Z"), rawRecord("rc-b", "2026-09-10T14:01:00.000Z")];
    const feed = published(project(file(records, null)));
    expect(feed.view.kind).toBe("not-yet-checked");
    expect(feed.records).toHaveLength(2);
    for (const record of feed.records) expect(record.state).toMatchObject({ kind: "unchecked", why: expect.stringMatching(/not yet checked by this daemon/) });
  });

  it("an untrusted inventory carries its sentence on the view, once, and every record is unknown", () => {
    const records = [rawRecord("rc-a", "2026-09-10T14:00:00.000Z"), rawRecord("rc-b", "2026-09-10T14:01:00.000Z")];
    const why = "the current inventory cannot be trusted: no inventory has been accepted in this daemon's life yet";
    const page = records.map((r) => item(r, { kind: "unknown", why }));
    const feed = published(project(file(records, view(page, { kind: "untrusted", why: "no inventory has been accepted in this daemon's life yet" }))));
    expect(feed.view).toEqual({ kind: "checked", checkedAt: "2026-09-10T14:58:30.000Z", inventory: { kind: "untrusted", why: "no inventory has been accepted in this daemon's life yet" } });
    expect(feed.records.every((r) => r.state.kind === "classified" && r.state.classification.kind === "unknown")).toBe(true);
  });

  it("a malformed view is its own state over unchecked records; it does not refuse the records", () => {
    const records = [rawRecord("rc-a", "2026-09-10T14:00:00.000Z")];
    const feed = published(project(file(records, view([item(records[0] as Json, { kind: "a-new-class", why: "x" })]))));
    expect(feed.view).toMatchObject({ kind: "unreadable", why: expect.stringMatching(/a-new-class/) });
    expect(feed.records[0]?.state).toMatchObject({ kind: "unchecked", why: expect.stringMatching(/could not be read/) });
  });

  it("a record newer than the view's pass is unchecked, not dropped", () => {
    const older = rawRecord("rc-old", "2026-09-10T14:00:00.000Z");
    const newer = rawRecord("rc-new", "2026-09-10T14:59:00.000Z");
    const feed = published(project(file([older, newer], view([item(older, { kind: "interrupted", why: "the host rebooted while this session was running" })]))));
    expect(feed.records.map((r) => [r.id, r.state.kind])).toEqual([
      ["rc-old", "classified"],
      ["rc-new", "unchecked"],
    ]);
  });

  it("the replay state and the overflow count pass through", () => {
    const feed = published(project(file([], null, { replay: { kind: "not-run", why: "the log is over the replay ceiling", retry: "whole" }, overflow: 7, overflowIds: [] })));
    expect(feed.replay).toEqual({ kind: "not-run", why: "the log is over the replay ceiling" });
    expect(feed.overflow).toBe(7);
  });

  it("every transcript arm survives, cannot-tell and found-under-claim as themselves", () => {
    const arms: Json[] = [
      { kind: "found", conversationId: CONVERSATION, path: "/p/a.jsonl", via: "slug-guess", mtime: "2026-09-10T13:30:00.000Z" },
      { kind: "found-under-claim", claimedConversationId: CLAIM, path: "/p/b.jsonl", mtime: null, why: "unverified: found under the tmux environment's claim, which outlives its conversation" },
      { kind: "not-found", under: "verified", conversationId: CONVERSATION, reason: "no-transcript-file", why: "looked everywhere" },
      { kind: "cannot-tell", under: "claim", conversationId: CLAIM, why: "the transcript search stopped after 2000 project directories" },
      { kind: "no-conversation", why: "the session carried neither a verified conversation nor a claim" },
    ];
    const records = arms.map((_, i) => rawRecord(`rc-t${i}`, `2026-09-10T14:0${i}:00.000Z`));
    const page = records.map((r, i) => item(r, { kind: "interrupted", why: "x" }, checked(arms[i])));
    const feed = published(project(file(records, view(page))));
    const kinds = feed.records.map((r) => (r.state.kind === "classified" && r.state.evidence.kind === "checked" ? r.state.evidence.transcript.kind : null));
    expect(kinds.sort()).toEqual(["cannot-tell", "found", "found-under-claim", "no-conversation", "not-found"]);
  });

  it("a transcript arm this reader does not know makes the view unreadable, not a guess", () => {
    const records = [rawRecord("rc-a", "2026-09-10T14:00:00.000Z")];
    const page = [item(records[0] as Json, { kind: "interrupted", why: "x" }, checked({ kind: "maybe", why: "?" }))];
    expect(published(project(file(records, view(page)))).view.kind).toBe("unreadable");
  });
});

describe("the fields that must agree, agree (F29): one record's evidence never lands on another", () => {
  const A_AT = "2026-09-10T14:00:00.000Z";
  const B_AT = "2026-09-10T14:05:00.000Z";
  const interrupted: Json = { kind: "interrupted", why: "the host rebooted while this session was running" };
  const dismissed: Json = { disposition: "dismissed", at: B_AT, evidence: { requestId: "req-f29", why: "checked by hand" } };

  function pair(): [Json, Json] {
    const a = rawRecord("rc-a", A_AT);
    const bKey = `$2 claims:${CLAIM}`;
    const b = rawRecord("rc-b", B_AT, { key: bKey, name: "session-b-elsewhere", entry: { ...(rawRecord("rc-b", B_AT)["entry"] as Json), key: bKey } });
    return [a, b];
  }

  it("a record whose entry.key names another session makes the file unreadable, as the store's own parser does", () => {
    // rawRecord's entry.key is "$4 none"; the record now says "$1 none".
    const feed = project(file([rawRecord("rc-a", A_AT, { key: "$1 none" })], null));
    expect(feed.kind).toBe("unreadable");
    expect(feed).toMatchObject({ why: expect.stringMatching(/entry\.key/) });
    expect(feed).not.toHaveProperty("records");
  });

  it("a view item carrying another record's key, name, time or resolution makes the view unreadable, and every record unchecked", () => {
    const [a, b] = pair();
    const mutants: [string, Json][] = [
      ["key", { key: b["key"] }],
      ["name", { name: b["name"] }],
      ["at", { at: b["at"] }],
      ["resolution", { resolution: dismissed, classification: null, evidence: null }],
    ];
    for (const [field, over] of mutants) {
      const page = [{ ...item(a, interrupted), ...over }, item(b, { kind: "unknown", why: "nobody watched it go" })];
      const feed = published(project(file([a, b], view(page))));
      expect(feed.view, field).toMatchObject({ kind: "unreadable" });
      for (const r of feed.records) expect(r.state.kind, field).toBe("unchecked");
    }
  });

  it("a view that lists one id twice is unreadable, never last-one-wins", () => {
    const [a, b] = pair();
    const page = [item(a, interrupted), item(a, { kind: "unknown", why: "nobody watched it go" }), item(b, interrupted)];
    expect(published(project(file([a, b], view(page)))).view).toMatchObject({ kind: "unreadable", why: expect.stringMatching(/twice/) });
  });

  it("a view item for a record the index does not hold is unreadable", () => {
    const [a] = pair();
    const page = [item(a, interrupted), item(rawRecord("rc-ghost", B_AT), interrupted)];
    expect(published(project(file([a], view(page)))).view.kind).toBe("unreadable");
  });

  it("an unresolved item carries both its classification and its evidence; a resolved one carries neither", () => {
    const [a] = pair();
    const done = rawRecord("rc-done", B_AT, { resolution: dismissed });
    const broken: Json[][] = [
      [item(a, interrupted, null), item(done, null, null)],
      [item(a, null, checked()), item(done, null, null)],
      [item(a, null, null), item(done, null, null)],
      [item(a, interrupted), item(done, interrupted, null)],
      [item(a, interrupted), item(done, null, checked())],
    ];
    for (const [index, page] of broken.entries()) {
      expect(published(project(file([a, done], view(page)))).view.kind, `case ${index}`).toBe("unreadable");
    }
    const lawful = published(project(file([a, done], view([item(a, interrupted), item(done, null, null)]))));
    expect(lawful.view.kind).toBe("checked");
  });

  it("an item written before its record was resolved is the view lagging the fold: the record shows resolved, and the view is still read", () => {
    // Reachable: `appendDerived` appends a disposition, and the next
    // checkpoint writes the fold with the view the store already held
    // (daemon.ts § appendDerived, store.ts § checkpoint). The record's own
    // resolution wins, so the lagging item's classification is used by nothing.
    const [a, b] = pair();
    const resumed = { disposition: "resumed", at: B_AT, evidence: { previousToken: "b:1:2", token: "b:3:4", conversationId: CONVERSATION } };
    const page = [item(a, interrupted), item(b, interrupted)];
    const feed = published(project(file([{ ...a, resolution: resumed }, b], view(page))));
    expect(feed.view.kind).toBe("checked");
    expect(feed.records.find((r) => r.id === "rc-a")?.state).toMatchObject({ kind: "resolved", resolution: { disposition: "resumed" } });
    expect(feed.records.find((r) => r.id === "rc-b")?.state).toMatchObject({ kind: "classified", classification: { kind: "interrupted" } });
  });
});

describe("the order and the first page", () => {
  it("unresolved first, grouped with interrupted first, newest disappearance first within a group, then resolved", () => {
    const t = (m: number): string => `2026-09-10T14:${String(m).padStart(2, "0")}:00.000Z`;
    const liveRow = { tmuxId: "$1", name: "x", dir: null, claimedConversationId: null, statusKey: "working", executionToken: null, conversationId: null };
    const specs: [string, number, Json | null, Json?][] = [
      ["rc-unknown", 50, { kind: "unknown", why: "nobody watched it go" }],
      ["rc-int-old", 10, { kind: "interrupted", why: "x" }],
      ["rc-int-new", 40, { kind: "interrupted", why: "x" }],
      ["rc-ended", 55, { kind: "ended-before-reboot", why: "x", statusKey: "no-claude", observedAt: t(5) }],
      ["rc-live", 58, { kind: "already-live", why: "x", sameRun: true, row: liveRow }],
      ["rc-match", 20, { kind: "present-but-unmatched", why: "x", row: liveRow }],
      ["rc-done", 59, null, { disposition: "dismissed", at: t(59), evidence: { requestId: "req-1", why: "checked by hand" } }],
    ];
    const records = specs.map(([id, m, , resolution]) => rawRecord(id, t(m), resolution === undefined ? {} : { resolution }));
    const page = records.map((r, i) => item(r, specs[i]?.[2] ?? null, specs[i]?.[2] === null ? null : checked()));
    const feed = published(project(file(records, view(page))));
    expect(feed.records.map((r) => r.id)).toEqual(["rc-int-new", "rc-int-old", "rc-match", "rc-unknown", "rc-ended", "rc-live", "rc-done"]);
    expect(feed.records.at(-1)?.state).toMatchObject({ kind: "resolved", resolution: { disposition: "dismissed" } });
    expect(feed).toMatchObject({ total: 7, unresolved: 6 });
  });

  it("caps the first page at 100, keeps the newest, and counts the rest in olderCount", () => {
    const records = Array.from({ length: RECOVERY_FIRST_PAGE + 5 }, (_, i) =>
      rawRecord(`rc-${String(i).padStart(3, "0")}`, new Date(Date.parse("2026-09-10T00:00:00.000Z") + i * 60_000).toISOString()),
    );
    const feed = published(project(file(records, null)));
    expect(feed.records).toHaveLength(RECOVERY_FIRST_PAGE);
    expect(feed.olderCount).toBe(5);
    expect(feed.total).toBe(RECOVERY_FIRST_PAGE + 5);
    expect(feed.records[0]?.id).toBe("rc-104");
    expect(feed.records.some((r) => r.id === "rc-004")).toBe(false);
  });

  it("a resolved record never takes an unresolved one's place on the page", () => {
    const unresolved = Array.from({ length: RECOVERY_FIRST_PAGE }, (_, i) => rawRecord(`rc-u${i}`, new Date(Date.parse("2026-09-01T00:00:00.000Z") + i * 60_000).toISOString()));
    const resolved = rawRecord("rc-resolved-newest", "2026-09-10T14:59:00.000Z", {
      resolution: { disposition: "superseded", at: "2026-09-10T14:59:30.000Z", evidence: { by: "rc-u1" } },
    });
    const feed = published(project(file([resolved, ...unresolved], null)));
    expect(feed.records.every((r) => r.state.kind !== "resolved")).toBe(true);
    expect(feed.olderCount).toBe(1);
  });
});

describe("no failure is an empty list", () => {
  it("every non-published arm carries no records field at all", () => {
    const loads: RecoveryFileLoad[] = [
      { kind: "absent", path: "/s/recovery.json" },
      { kind: "unreadable", why: "EACCES" },
      { kind: "oversized", path: "/s/recovery.json", sizeBytes: 99, limitBytes: 1 },
      { kind: "json", path: "/s/recovery.json", json: [] },
      { kind: "json", path: "/s/recovery.json", json: { schema: 3 } },
      { kind: "json", path: "/s/recovery.json", json: { schema: 1, records: "nope" } },
    ];
    for (const load of loads) {
      const feed = projectRecovery(load, COMPOSED);
      expect(feed.kind).not.toBe("published");
      expect(feed).not.toHaveProperty("records");
    }
  });
});
