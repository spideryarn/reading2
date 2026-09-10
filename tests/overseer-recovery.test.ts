/**
 * The recovery journal's pure half, and the store's handling of it —
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § Stage 1.
 *
 * The daemon-driven cases (a reboot through the real parser, gate, differ and
 * store) are in tests/overseer-daemon-recovery.test.ts. This file is the
 * candidate rule, the id, the fold, the caps, and the one-time derivation over
 * logs written before the event existed — the last through `openStore` against
 * hand-written logs, because the shapes that matter there (a batch that emptied
 * the register, a gone whose session was never seen) are easier to state
 * exactly than to drive a daemon into.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { identityOf, sessionKey, type GoneReason, type OverseerEvent, type SessionKey } from "../tools/overseer/diff.js";
import type { ObservedRow } from "../tools/overseer/observation.js";
import { buildRecoveryView, evidenceDeps, type RecoveryView } from "../tools/overseer/recovery-view.js";
import {
  emptyRecoveryFold,
  foldRecovery,
  needsCandidate,
  RECOVERY_RESOLVED_RETENTION_MS,
  RECOVERY_UNRESOLVED_CAPACITY,
  withRecoveryCandidates,
  type CandidateContext,
  type RecoveryCandidateEvent,
  type RecoveryCandidateId,
  type RecoveryFold,
} from "../tools/overseer/recovery.js";
import { EVENTS_FILE, foldEvents, openStore, type OverseerStore, type RegisterEntry } from "../tools/overseer/store.js";

const RECOVERY_FILE = "recovery.json";

const roots: string[] = [];
const opened: OverseerStore[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-recovery-test-"));
  roots.push(root);
  return root;
}

function mustOpen(root: string): OverseerStore {
  const result = openStore({ root });
  if (!result.ok) throw new Error(`the store would not open: ${JSON.stringify(result.refusal)}`);
  opened.push(result.store);
  return result.store;
}

function close(store: OverseerStore): void {
  store.close();
  const index = opened.indexOf(store);
  if (index >= 0) opened.splice(index, 1);
}

/** Two tmux generations, minted for this file. */
const G1 = 311001;
const G2 = 311002;

/** Conversation claims, minted for this file. */
const CLAIM_A = "6f0c2d8e-3b41-4a7e-9d15-2c8b7e4f1a90";
const CLAIM_B = "a2e9b7c4-5d18-4f63-8e2a-9b0d4c6f7e31";

function row(id: string, name: string, claim: string | null, changes: Partial<ObservedRow> = {}): ObservedRow {
  return {
    id,
    name,
    execution: { kind: "unknown", cause: "not-reported", why: "written by hand for this test" },
    title: null,
    repo: "spideryarn/reading2",
    worktree: null,
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    startedAt: "2026-09-10T08:00:00.000Z",
    paneId: "%7",
    panePid: 4100,
    claimedConversationId: claim,
    question: null,
    status: { kind: "idle" },
    ...changes,
  };
}

function seen(r: ObservedRow, at: string, tmuxServerPid: number | null): OverseerEvent {
  return { kind: "session-seen", at, tmuxServerPid, key: sessionKey(identityOf(r)), identity: identityOf(r), row: r };
}

function gone(r: ObservedRow, at: string, tmuxServerPid: number | null, why: GoneReason): OverseerEvent {
  return { kind: "tmux-session-gone", at, tmuxServerPid, key: sessionKey(identityOf(r)), identity: identityOf(r), name: r.name, why };
}

const ROW_A = row("$41", "alpha-ri", CLAIM_A);
const ROW_B = row("$42", "beta-ri", CLAIM_B);
const ROW_SHELL = row("$43", "shell-ri", null, { status: { kind: "shell", busy: false } });

function registerOf(...events: OverseerEvent[]): Map<SessionKey, RegisterEntry> {
  return foldEvents(events, new Map());
}

function context(changes: Partial<CandidateContext> = {}): CandidateContext {
  return {
    observation: "run e4d2b6f0 collection 1",
    tmuxServerPid: null,
    baseline: {
      rows: [ROW_A, ROW_B],
      collectedAt: "2026-09-10T09:00:00.000Z",
      observation: "run 3a9c1e7b collection 9",
    },
    producerRun: "changed",
    bootChanged: false,
    hostBootId: "ri-unit-boot",
    ...changes,
  };
}

function candidatesIn(events: readonly OverseerEvent[]): RecoveryCandidateEvent[] {
  return events.flatMap((e) => (e.kind === "recovery-candidate" ? [e] : []));
}

function fresh(): RecoveryFold {
  return emptyRecoveryFold({ kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, null);
}

describe("which disappearances get a candidate — every one except a watched, same-world close", () => {
  // The plan's table, row by row.
  test.each([
    ["a session ends while the box carries on", "same", "same", true, false],
    ["the tmux server is replaced", "changed", "changed", true, true],
    ["the first empty snapshot after a reboot", "unverifiable", "changed", true, true],
    ["tmux kill-server under a running dashboard", "unverifiable", "same", true, true],
    ["the last session closes and tmux exits", "unverifiable", "same", true, true],
    ["a reboot where tmux gets the same pid (boot id)", "changed", "changed", true, true],
    ["the dashboard restarts and a session ends meanwhile", "same", "changed", true, true],
    ["the daemon was down", "same", "cannot-tell", false, true],
    // Not in the plan's table, and settled here: an UNSTAMPED producer under a
    // readable, unchanged tmux generation is as well placed as it was before
    // stamps existed, so its ordinary closes are ordinary.
    ["an ordinary close under an unstamped producer", "same", "cannot-tell", true, false],
  ] as const)("%s", (_label, generation, producerRun, watched, expected) => {
    expect(needsCandidate({ generation, producerRun, watched })).toBe(expected);
  });
});

describe("withRecoveryCandidates", () => {
  const at = "2026-09-10T09:05:00.000Z";

  test("puts each candidate immediately before its gone, carrying the register's final entry", () => {
    const register = registerOf(seen(ROW_A, "2026-09-10T08:30:00.000Z", G1), seen(ROW_B, "2026-09-10T08:30:00.000Z", G1));
    const batch = [gone(ROW_A, at, G1, "absent-from-snapshot"), gone(ROW_B, at, G1, "absent-from-snapshot")];
    const out = withRecoveryCandidates(batch, register, context());
    expect(out.map((e) => e.kind)).toEqual(["recovery-candidate", "tmux-session-gone", "recovery-candidate", "tmux-session-gone"]);
    const [first] = candidatesIn(out);
    expect(first?.entry).toEqual(register.get(sessionKey(identityOf(ROW_A))));
    expect(first?.at).toBe(at);
    expect(first?.disappearance).toEqual({
      goneWhy: "absent-from-snapshot",
      observation: "run e4d2b6f0 collection 1",
      generation: "unverifiable",
      bootChanged: false,
      producerRun: "changed",
      watched: true,
      hostBootId: "ri-unit-boot",
    });
    expect(first?.lastSeen?.collectedAt).toBe("2026-09-10T09:00:00.000Z");
    expect(first?.lastSeen?.statusKey).toBe("idle");
  });

  test("an ordinary close gets none", () => {
    const register = registerOf(seen(ROW_A, "2026-09-10T08:30:00.000Z", G1));
    const out = withRecoveryCandidates([gone(ROW_A, at, G1, "absent-from-snapshot")], register, context({ tmuxServerPid: G1, producerRun: "same" }));
    expect(out.map((e) => e.kind)).toEqual(["tmux-session-gone"]);
  });

  test("a candidate is only ever built from an entry the register still holds", () => {
    const out = withRecoveryCandidates([gone(ROW_A, at, G1, "absent-from-snapshot")], new Map(), context());
    expect(out.map((e) => e.kind)).toEqual(["tmux-session-gone"]);
  });

  test("with no baseline it is unwatched and has no last sighting", () => {
    const register = registerOf(seen(ROW_A, "2026-09-10T08:30:00.000Z", G1));
    const out = withRecoveryCandidates([gone(ROW_A, at, G1, "absent-from-snapshot")], register, context({ baseline: null, tmuxServerPid: G1, producerRun: "cannot-tell" }));
    const [candidate] = candidatesIn(out);
    expect(candidate?.disappearance.watched).toBe(false);
    expect(candidate?.lastSeen).toBeNull();
  });

  test("a changed boot id makes the generation changed whatever the pids say", () => {
    const register = registerOf(seen(ROW_A, "2026-09-10T08:30:00.000Z", G1));
    const out = withRecoveryCandidates([gone(ROW_A, at, G1, "tmux-server-changed")], register, context({ tmuxServerPid: G1, producerRun: "changed", bootChanged: true }));
    const [candidate] = candidatesIn(out);
    expect(candidate?.disappearance.generation).toBe("changed");
    expect(candidate?.disappearance.bootChanged).toBe(true);
  });

  test("the last sighting is the verified run, and the title is capped at 200 characters", () => {
    const verified = row("$41", "alpha-ri", CLAIM_A, {
      title: "t".repeat(300),
      execution: {
        kind: "verified",
        token: { boot: "ri-unit-tok", pid: 5150, startTicks: 77 },
        harness: "claude-code",
        conversation: { kind: "verified", id: CLAIM_A },
      },
      status: { kind: "working" },
    });
    const register = registerOf(seen(verified, "2026-09-10T08:30:00.000Z", G1));
    const out = withRecoveryCandidates(
      [gone(verified, at, G1, "absent-from-snapshot")],
      register,
      context({
        baseline: {
          rows: [verified],
          collectedAt: "2026-09-10T09:00:00.000Z",
          observation: "run 3a9c1e7b collection 9",
        },
      }),
    );
    const [candidate] = candidatesIn(out);
    expect(candidate?.lastSeen).toEqual({
      statusKey: "working",
      title: "t".repeat(200),
      harness: "claude-code",
      executionToken: "ri-unit-tok:5150:77",
      conversation: { kind: "verified", id: CLAIM_A },
      observation: "run 3a9c1e7b collection 9",
      collectedAt: "2026-09-10T09:00:00.000Z",
    });
  });
});

describe("the id: the previous run plus the collection that removed it, never the arrival time", () => {
  const register = registerOf(seen(ROW_A, "2026-09-10T08:30:00.000Z", G1));
  const idAt = (at: string, observation: string): RecoveryCandidateId => {
    const [candidate] = candidatesIn(withRecoveryCandidates([gone(ROW_A, at, G1, "absent-from-snapshot")], register, context({ observation })));
    if (candidate === undefined) throw new Error("expected a candidate");
    return candidate.id;
  };

  test("the same disappearance noticed at two different instants is one id", () => {
    expect(idAt("2026-09-10T09:05:00.000Z", "run e4d2b6f0 collection 1")).toBe(idAt("2026-09-10T09:07:00.000Z", "run e4d2b6f0 collection 1"));
  });

  test("two collections removing the same run are two ids", () => {
    expect(idAt("2026-09-10T09:05:00.000Z", "run e4d2b6f0 collection 1")).not.toBe(idAt("2026-09-10T09:05:00.000Z", "run e4d2b6f0 collection 2"));
  });
});

describe("foldRecovery", () => {
  const at = "2026-09-10T09:05:00.000Z";
  const register = registerOf(seen(ROW_A, "2026-09-10T08:30:00.000Z", G1), seen(ROW_B, "2026-09-10T08:30:00.000Z", G1));
  const batch = (observation: string, ...rows: ObservedRow[]): OverseerEvent[] =>
    withRecoveryCandidates(
      rows.map((r) => gone(r, at, G1, "absent-from-snapshot")),
      register,
      context({ observation }),
    );

  test("keep-first by id: the same candidate folded twice is one record", () => {
    const fold = fresh();
    const [candidate, removal] = batch("run e4d2b6f0 collection 1", ROW_A);
    if (candidate === undefined || removal === undefined) throw new Error("expected a pair");
    foldRecovery([candidate, removal], fold);
    foldRecovery([candidate, removal], fold);
    expect([...fold.records.keys()]).toEqual([(candidate as RecoveryCandidateEvent).id]);
  });

  test("the pending merge: a candidate whose predecessor never saw its gone is the same disappearance, and the first id is kept", () => {
    // The crash: the first candidate's line is whole and its gone was torn and
    // truncated. The restart re-derives the gone from a LATER collection, so
    // under a different id.
    const fold = fresh();
    const [tornEra] = batch("run e4d2b6f0 collection 1", ROW_A);
    if (tornEra === undefined) throw new Error("expected a candidate");
    foldRecovery([tornEra], fold);
    const rederived = batch("run e4d2b6f0 collection 2", ROW_A);
    foldRecovery(rederived, fold);
    expect([...fold.records.keys()]).toEqual([(tornEra as RecoveryCandidateEvent).id]);
    // And once the gone has landed, the next disappearance of that key is new.
    const later = batch("run e4d2b6f0 collection 3", ROW_A);
    foldRecovery(later, fold);
    expect(fold.records.size).toBe(2);
  });

  test("any other event for the key ends the wait, so a later disappearance is not swallowed", () => {
    const fold = fresh();
    const [orphan] = batch("run e4d2b6f0 collection 1", ROW_A);
    if (orphan === undefined) throw new Error("expected a candidate");
    foldRecovery([orphan, seen(ROW_A, "2026-09-10T09:06:00.000Z", G1)], fold);
    foldRecovery(batch("run e4d2b6f0 collection 4", ROW_A), fold);
    expect(fold.records.size).toBe(2);
  });

  test("a newer unchanged sighting ends the wait even when it emitted no session event", () => {
    const fold = fresh();
    const [orphan] = batch("run e4d2b6f0 collection 1", ROW_A);
    if (orphan === undefined) throw new Error("expected a candidate");
    foldRecovery([orphan], fold);

    // The identical row was accepted alive after the orphan, so diff emitted
    // nothing for it. Its later disappearance carries the newer baseline
    // collection as the only durable proof that these are two disappearances.
    const later = withRecoveryCandidates(
      [gone(ROW_A, "2026-09-10T09:15:00.000Z", G1, "absent-from-snapshot")],
      register,
      context({
        observation: "run e4d2b6f0 collection 3",
        baseline: {
          rows: [ROW_A],
          collectedAt: "2026-09-10T09:10:00.000Z",
          observation: "run e4d2b6f0 collection 2",
        },
      }),
    );
    foldRecovery(later, fold);

    expect(fold.records.size).toBe(2);
  });

  test("a disposition resolves a record once; a second, an unknown id, and a repeated request are ignored", () => {
    const fold = fresh();
    const events = batch("run e4d2b6f0 collection 1", ROW_A, ROW_B);
    foldRecovery(events, fold);
    const [a, b] = candidatesIn(events);
    if (a === undefined || b === undefined) throw new Error("expected two candidates");
    const dismiss = (id: RecoveryCandidateId, requestId: string): OverseerEvent => ({
      kind: "recovery-disposition",
      at: "2026-09-10T10:00:00.000Z",
      id,
      disposition: "dismissed",
      evidence: { requestId, why: "checked by hand" },
    });
    expect(foldRecovery([dismiss(a.id, "req-ri-1")], fold)).toBe(true);
    expect(foldRecovery([dismiss(a.id, "req-ri-2")], fold)).toBe(false);
    expect(foldRecovery([dismiss("rc-00000000000000000000" as RecoveryCandidateId, "req-ri-3")], fold)).toBe(false);
    expect(foldRecovery([dismiss(b.id, "req-ri-1")], fold)).toBe(false);
    expect(fold.records.get(a.id)?.resolution).toEqual({ disposition: "dismissed", at: "2026-09-10T10:00:00.000Z", evidence: { requestId: "req-ri-1", why: "checked by hand" } });
    expect(fold.records.get(b.id)?.resolution).toEqual({ disposition: "unresolved" });
  });
});

describe("the recovery parser accepts every shape this stage has written", () => {
  test("a pre-review candidate without lastSeen.observation still replays", () => {
    const root = tempRoot();
    const original = [
      seen(ROW_A, "2026-09-10T08:30:00.000Z", G1),
      ...withRecoveryCandidates(
        [gone(ROW_A, "2026-09-10T09:05:00.000Z", G1, "absent-from-snapshot")],
        registerOf(seen(ROW_A, "2026-09-10T08:30:00.000Z", G1)),
        context(),
      ),
    ];
    const written = JSON.parse(JSON.stringify(original)) as Array<Record<string, unknown>>;
    const candidate = written.find((event) => event["kind"] === "recovery-candidate");
    if (candidate === undefined || typeof candidate["lastSeen"] !== "object" || candidate["lastSeen"] === null) {
      throw new Error("expected a candidate with a last sighting");
    }
    delete (candidate["lastSeen"] as Record<string, unknown>)["observation"];
    writeFileSync(join(root, EVENTS_FILE), written.map((event) => `${JSON.stringify(event)}\n`).join(""));

    const store = mustOpen(root);
    expect(store.opening.start.kind).toBe("rebuilt");
    expect(store.recovery.records.size).toBe(1);
  });

  test("a pre-review recovery file with id-only pending entries restores", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.append([seen(ROW_A, "2026-09-10T08:30:00.000Z", G1)]);
    const [candidate] = withRecoveryCandidates(
      [gone(ROW_A, "2026-09-10T09:05:00.000Z", G1, "absent-from-snapshot")],
      store.register,
      context(),
    );
    if (candidate?.kind !== "recovery-candidate") throw new Error("expected a candidate");
    store.append([candidate]);
    store.checkpoint({ lastGoodSnapshotAt: null, tick: false });
    close(store);

    const path = join(root, RECOVERY_FILE);
    const file = JSON.parse(readFileSync(path, "utf8")) as {
      records: Array<{ lastSeen?: Record<string, unknown> | null }>;
      pending: Array<{ key: string; id: RecoveryCandidateId }>;
    };
    for (const record of file.records) {
      if (record.lastSeen !== null && record.lastSeen !== undefined) delete record.lastSeen["observation"];
    }
    file.pending = file.pending.map(({ key, id }) => ({ key, id }));
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);

    const reopened = mustOpen(root);
    expect(reopened.opening.recovery.kind).toBe("restored");
    expect(reopened.recovery.records.size).toBe(1);
  });
});

describe("the view recovery.json publishes holds only records the file holds (Sol's F24, the store's half)", () => {
  test("a record inside retention on the view's clock and outside it on the checkpoint's is in neither page nor records", async () => {
    const root = tempRoot();
    const dismissedAt = "2026-09-10T10:00:00.000Z";
    const dismissedMs = Date.parse(dismissedAt);
    let clockMs = Date.parse("2026-09-10T09:00:00.000Z");
    const result = openStore({ root, now: () => new Date(clockMs) });
    if (!result.ok) throw new Error(`the store would not open: ${JSON.stringify(result.refusal)}`);
    const store = result.store;
    opened.push(store);

    store.append([seen(ROW_A, "2026-09-10T08:30:00.000Z", G1), seen(ROW_B, "2026-09-10T08:30:00.000Z", G1)]);
    const batch = withRecoveryCandidates(
      [gone(ROW_A, "2026-09-10T09:05:00.000Z", G1, "absent-from-snapshot"), gone(ROW_B, "2026-09-10T09:05:00.000Z", G1, "absent-from-snapshot")],
      store.register,
      context(),
    );
    store.append(batch);
    const [target, other] = candidatesIn(batch);
    if (target === undefined || other === undefined) throw new Error("expected two candidates");
    store.append([
      { kind: "recovery-disposition", at: dismissedAt, id: target.id, disposition: "dismissed", evidence: { requestId: "ri2f-store-req", why: "checked by hand" } },
    ]);

    // The view pass runs one second inside retention; its checkpoint lands one
    // second outside it.
    const view = await buildRecoveryView(
      store.recovery,
      { kind: "untrusted", why: "no inventory in this test" },
      {
        ...evidenceDeps({
          projectsDir: tempRoot(),
          hostname: () => "ri2f-store-host",
          stat: async (path: string) => {
            const error = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          },
        }),
        now: () => new Date(dismissedMs + RECOVERY_RESOLVED_RETENTION_MS - 1_000),
      },
    );
    expect(view.page.map((item) => item.id)).toContain(target.id);
    clockMs = dismissedMs + RECOVERY_RESOLVED_RETENTION_MS + 1_000;
    expect(store.setRecoveryView(view)).toBe(true);
    expect(store.checkpoint({ lastGoodSnapshotAt: null, tick: false }).ok).toBe(true);

    const file = JSON.parse(readFileSync(join(root, RECOVERY_FILE), "utf8")) as { records: { id: string }[]; view: RecoveryView | null };
    const recordIds = file.records.map((r) => r.id);
    const pageIds = (file.view?.page ?? []).map((item) => item.id);
    expect(recordIds).toEqual([other.id]);
    expect(pageIds).not.toContain(target.id);
    expect(pageIds).toEqual([other.id]);
    expect(file.view?.olderCount).toBe(0);
  });
});

describe("the recovery cursor names only events the fold accepted", () => {
  test("a checkpoint after a refused recovery tail does not advance past the hole", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.append([seen(ROW_A, "2026-09-10T08:30:00.000Z", G1)]);
    store.append(
      withRecoveryCandidates(
        [gone(ROW_A, "2026-09-10T09:05:00.000Z", G1, "absent-from-snapshot")],
        store.register,
        context(),
      ),
    );
    store.checkpoint({ lastGoodSnapshotAt: null, tick: false });
    close(store);
    const recoveryPath = join(root, RECOVERY_FILE);
    const before = JSON.parse(readFileSync(recoveryPath, "utf8")) as { cursor: { events: number; bytes: number } };

    const laterRegister = registerOf(seen(ROW_B, "2026-09-10T09:10:00.000Z", G1));
    const later = withRecoveryCandidates(
      [gone(ROW_B, "2026-09-10T09:15:00.000Z", G1, "absent-from-snapshot")],
      laterRegister,
      context({ observation: "run e4d2b6f0 collection 4" }),
    );
    const eventsPath = join(root, EVENTS_FILE);
    writeFileSync(
      eventsPath,
      `${readFileSync(eventsPath, "utf8")}{not an event}\n${later.map((event) => `${JSON.stringify(event)}\n`).join("")}`,
    );

    const reopened = mustOpen(root);
    expect(reopened.opening.recovery.kind).toBe("not-run");
    reopened.checkpoint({ lastGoodSnapshotAt: null, tick: false });
    close(reopened);

    const after = JSON.parse(readFileSync(recoveryPath, "utf8")) as { cursor: { events: number; bytes: number } };
    expect(after.cursor).toEqual(before.cursor);

    const repaired = readFileSync(eventsPath, "utf8")
      .split("\n")
      .filter((line) => line !== "{not an event}")
      .join("\n");
    writeFileSync(eventsPath, repaired);
    const recovered = mustOpen(root);
    expect(recovered.recovery.replay.kind).toBe("ran");
    expect(recovered.recovery.records.size).toBe(2);
    recovered.checkpoint({ lastGoodSnapshotAt: null, tick: false });
    close(recovered);
    const caughtUp = JSON.parse(readFileSync(recoveryPath, "utf8")) as { cursor: { bytes: number } };
    expect(caughtUp.cursor.bytes).toBe(statSync(eventsPath).size);
  });
});

describe("the caps — the evidence is never dropped silently", () => {
  test("a 17 KB candidate goes into the index as an oversize stub, and the event itself is written whole", () => {
    const root = tempRoot();
    const huge = row("$44", "h".repeat(17 * 1024), CLAIM_A);
    const store = mustOpen(root);
    store.append([seen(huge, "2026-09-10T08:30:00.000Z", G1)]);
    const events = withRecoveryCandidates([gone(huge, "2026-09-10T09:05:00.000Z", G1, "absent-from-snapshot")], store.register, context());
    store.append(events);
    const [candidate] = candidatesIn(events);
    if (candidate === undefined) throw new Error("expected a candidate");
    expect(store.recovery.records.get(candidate.id)).toEqual({
      id: candidate.id,
      key: candidate.entry.key,
      name: huge.name,
      at: "2026-09-10T09:05:00.000Z",
      origin: "journal",
      resolution: { disposition: "unresolved" },
      oversize: true,
    });
    const back = candidatesIn(store.readEvents(0).events);
    expect(back).toHaveLength(1);
    expect(back[0]?.entry.name.length).toBe(17 * 1024);
  });

  test("501 unresolved records give overflow 1, with none evicted", () => {
    const fold = fresh();
    const ids: RecoveryCandidateId[] = [];
    for (let i = 0; i < RECOVERY_UNRESOLVED_CAPACITY + 1; i += 1) {
      const r = row(`$${1000 + i}`, `many-${i}`, null);
      const events = withRecoveryCandidates([gone(r, "2026-09-10T09:05:00.000Z", G1, "absent-from-snapshot")], registerOf(seen(r, "2026-09-10T08:30:00.000Z", G1)), context());
      const [candidate] = candidatesIn(events);
      if (candidate === undefined) throw new Error("expected a candidate");
      ids.push(candidate.id);
      foldRecovery(events, fold);
    }
    expect(fold.records.size).toBe(RECOVERY_UNRESOLVED_CAPACITY);
    expect(fold.overflowIds.size).toBe(1);
    for (const id of ids.slice(0, RECOVERY_UNRESOLVED_CAPACITY)) expect(fold.records.has(id)).toBe(true);
    expect(fold.records.has(ids[RECOVERY_UNRESOLVED_CAPACITY] as RecoveryCandidateId)).toBe(false);
  });
});

/*
 * LOGS FROM BEFORE THE EVENT EXISTED. Each is written by hand, with no
 * `recovery.json` and no `current.json`, which is what a store looks like the
 * first time a build with this stage opens it.
 */
function writeLog(root: string, events: readonly OverseerEvent[]): void {
  writeFileSync(join(root, EVENTS_FILE), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

const T0 = "2026-09-01T10:00:00.000Z";
const T1 = "2026-09-01T11:00:00.000Z";
const T2 = "2026-09-01T11:00:05.000Z";
const T3 = "2026-09-01T11:01:10.000Z";

/** Three sessions under G1, then the daemon's own generation-change close-out, then two under G2. */
function tmuxServerChangedLog(): OverseerEvent[] {
  return [
    seen(ROW_A, T0, G1),
    seen(ROW_B, T0, G1),
    seen(ROW_SHELL, T0, G1),
    gone(ROW_A, T1, G1, "tmux-server-changed"),
    gone(ROW_B, T1, G1, "tmux-server-changed"),
    gone(ROW_SHELL, T1, G1, "tmux-server-changed"),
    seen(ROW_A, T1, G2),
    seen(ROW_B, T1, G2),
  ];
}

/** What `goneWhileAway` writes after a reboot: every session closed at one instant, then a new tmux server. */
function goneWhileAwayLog(): OverseerEvent[] {
  return [
    seen(ROW_A, T0, G1),
    seen(ROW_B, T0, G1),
    gone(ROW_A, T2, G1, "absent-from-snapshot"),
    gone(ROW_B, T2, G1, "absent-from-snapshot"),
    seen(ROW_A, T3, G2),
  ];
}

describe("logs that predate the event: a one-time derivation", () => {
  test("derived once and written; the second start restores without scanning; deleting the file derives identical ids", () => {
    const root = tempRoot();
    writeLog(root, tmuxServerChangedLog());
    const first = mustOpen(root);
    expect(first.opening.recovery.kind).toBe("derived");
    const ids = [...first.recovery.records.keys()].sort();
    expect(ids).toHaveLength(3);
    first.checkpoint({ lastGoodSnapshotAt: null, tick: false });
    close(first);
    expect(existsSync(join(root, RECOVERY_FILE))).toBe(true);

    const second = mustOpen(root);
    expect(second.opening.recovery).toEqual({ kind: "restored", eventsReplayed: 0, bytesScanned: 0 });
    expect([...second.recovery.records.keys()].sort()).toEqual(ids);
    close(second);

    rmSync(join(root, RECOVERY_FILE));
    const third = mustOpen(root);
    expect(third.opening.recovery.kind).toBe("derived");
    expect([...third.recovery.records.keys()].sort()).toEqual(ids);
  });

  test("an explicit tmux-server-changed batch gives watched records with the final entry", () => {
    const root = tempRoot();
    writeLog(root, tmuxServerChangedLog());
    const store = mustOpen(root);
    const records = [...store.recovery.records.values()];
    expect(records.map((r) => r.name).sort()).toEqual(["alpha-ri", "beta-ri", "shell-ri"]);
    for (const record of records) {
      if (record.oversize) throw new Error("not oversize");
      expect(record.origin).toBe("legacy");
      expect(record.entry?.tmuxServerPid).toBe(G1);
      expect(record.lastSeen).toBeNull();
      expect(record.disappearance).toMatchObject({ goneWhy: "tmux-server-changed", watched: true, producerRun: "cannot-tell", generation: "changed" });
    }
    expect(store.recovery.replay).toMatchObject({ kind: "ran", worldChanges: 1, derived: 3 });
  });

  test("the goneWhileAway signature is a world change, never proof of an interruption: watched is false", () => {
    const root = tempRoot();
    writeLog(root, goneWhileAwayLog());
    const store = mustOpen(root);
    const records = [...store.recovery.records.values()];
    expect(records).toHaveLength(2);
    for (const record of records) {
      if (record.oversize) throw new Error("not oversize");
      expect(record.disappearance).toMatchObject({ goneWhy: "absent-from-snapshot", watched: false });
    }
  });

  test("a same-pid restart has the same shape and proves nothing, so it derives nothing", () => {
    const root = tempRoot();
    writeLog(root, [seen(ROW_A, T0, G1), gone(ROW_A, T2, G1, "absent-from-snapshot"), seen(ROW_A, T3, G1)]);
    const store = mustOpen(root);
    expect(store.recovery.records.size).toBe(0);
  });

  test("a gone with no surviving entry gives an entry: null stub, not a fabricated one", () => {
    const root = tempRoot();
    // The log began mid-life: beta was never seen.
    writeLog(root, tmuxServerChangedLog().filter((e) => !(e.kind === "session-seen" && e.row.name === "beta-ri" && e.at === T0)));
    const store = mustOpen(root);
    const beta = [...store.recovery.records.values()].find((r) => r.name === "beta-ri");
    if (beta === undefined || beta.oversize) throw new Error("expected a full record for beta");
    expect(beta.entry).toBeNull();
    expect(beta.key).toBe(sessionKey(identityOf(ROW_B)));
  });

  test("a log with no world change gives none, and says so", () => {
    const root = tempRoot();
    writeLog(root, [seen(ROW_A, T0, G1), seen(ROW_B, T0, G1), gone(ROW_A, T1, G1, "absent-from-snapshot")]);
    const store = mustOpen(root);
    expect(store.recovery.records.size).toBe(0);
    expect(store.recovery.replay).toMatchObject({ kind: "ran", worldChanges: 0, derived: 0 });
  });

  test("a gone that already has a live candidate before it is never derived a second time", () => {
    const root = tempRoot();
    const register = registerOf(seen(ROW_A, T0, G1));
    const live = withRecoveryCandidates([gone(ROW_A, T1, G1, "tmux-server-changed")], register, context({ tmuxServerPid: G2 }));
    writeLog(root, [seen(ROW_A, T0, G1), ...live, seen(ROW_A, T1, G2)]);
    const store = mustOpen(root);
    const records = [...store.recovery.records.values()];
    expect(records).toHaveLength(1);
    expect(records[0]?.origin).toBe("journal");
  });

  test("over the ceiling the derivation does not run, and the index says so rather than showing an empty list", () => {
    const root = tempRoot();
    writeLog(root, tmuxServerChangedLog());
    const result = openStore({ root, replayCeilingBytes: 64 });
    if (!result.ok) throw new Error("expected the store to open");
    opened.push(result.store);
    expect(result.store.recovery.replay.kind).toBe("not-run");
    expect(result.store.recovery.records.size).toBe(0);
  });

  test("across a hole the derivation does not run", () => {
    const root = tempRoot();
    writeLog(root, tmuxServerChangedLog());
    const text = readFileSync(join(root, EVENTS_FILE), "utf8").split("\n");
    text.splice(3, 0, "{not an event}");
    writeFileSync(join(root, EVENTS_FILE), text.join("\n"));
    const store = mustOpen(root);
    expect(store.recovery.replay.kind).toBe("not-run");
  });
});
