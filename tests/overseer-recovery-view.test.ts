/**
 * The recovery view, the derived dispositions, retention and the CLI —
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § Stage 2 (§2 dispositions, §4 the view, §5 dismissal).
 *
 * Pure halves are driven with hand-built records; the evidence pass runs
 * against a temp `projects/` directory and an injected `stat` and `hostname`,
 * so nothing here reads this box's home. The daemon-driven cases (a reboot
 * through the real parser, gate, differ and store) are in
 * tests/overseer-daemon-recovery.test.ts.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { stat as realStat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { main as recoveryCli } from "../scripts/overseer-recovery.js";
import { slugifyDir } from "../tools/fleet/transcript.js";
import { identityOf, sessionKey, type OverseerEvent } from "../tools/overseer/diff.js";
import type { ObservedRow } from "../tools/overseer/observation.js";
import { RECOVERY_INBOX_DIR } from "../tools/overseer/recovery-inbox.js";
import {
  buildRecoveryView,
  classifyRecord,
  recoveryEvidence,
  RECOVERY_PAGE_SIZE,
  RECOVERY_TRANSCRIPT_PROJECT_DIR_LIMIT,
  type EvidenceDeps,
  type InventoryTrust,
} from "../tools/overseer/recovery-view.js";
import {
  deriveDispositions,
  emptyRecoveryFold,
  foldRecovery,
  pruneResolved,
  recoveryIndexOf,
  RECOVERY_RESOLVED_RETENTION_MS,
  type RecoveryCandidateId,
  type RecoveryDisappearance,
  type RecoveryFold,
  type RecoveryLastSeen,
  type RecoveryRecord,
} from "../tools/overseer/recovery.js";
import { EVENTS_FILE, foldEvents, type RegisterEntry } from "../tools/overseer/store.js";

type FullRecord = Extract<RecoveryRecord, { oversize: false }>;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-recovery-view-test-"));
  roots.push(root);
  return root;
}

/** Conversations and a claim, minted for this file. */
const CONV_A = "995533d4-a6b1-411b-bcfb-8ae3f5c70c88";
const CONV_B = "da63f151-e209-4084-8900-151b73f4df1d";
const CLAIM_C = "7599ca9a-5718-4a9f-afa9-f864e60af268";

const TOKEN_ONE = "ri-view-boot:5100:11";
const TOKEN_TWO = "ri-view-boot:5200:22";

const DIR = "/srv/ri-view/primary";
const HOST = "ri-view-host";

function row(id: string, name: string, claim: string | null, changes: Partial<ObservedRow> = {}): ObservedRow {
  return {
    id,
    name,
    execution: { kind: "unknown", cause: "not-reported", why: "written by hand for this test" },
    title: null,
    repo: "spideryarn/reading2",
    worktree: null,
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: DIR },
    startedAt: "2026-09-10T08:00:00.000Z",
    paneId: "%9",
    panePid: 5100,
    claimedConversationId: claim,
    question: null,
    status: { kind: "idle" },
    ...changes,
  };
}

/** A row with a verified execution holding `conversation` under `token` (`boot:pid:ticks`). */
function liveRow(id: string, name: string, conversation: string, token: string, changes: Partial<ObservedRow> = {}): ObservedRow {
  const [boot, pid, ticks] = token.split(":");
  return row(id, name, conversation, {
    execution: {
      kind: "verified",
      token: { boot: boot as string, pid: Number(pid), startTicks: Number(ticks) },
      harness: "claude-code",
      conversation: { kind: "verified", id: conversation },
    },
    ...changes,
  });
}

function entryOf(r: ObservedRow, at = "2026-09-10T08:30:00.000Z"): RegisterEntry {
  const event: OverseerEvent = { kind: "session-seen", at, tmuxServerPid: 411001, key: sessionKey(identityOf(r)), identity: identityOf(r), row: r };
  const register = foldEvents([event], new Map());
  const entry = register.get(sessionKey(identityOf(r)));
  if (entry === undefined) throw new Error("the fold made no entry");
  return entry;
}

function lastSeen(changes: Partial<RecoveryLastSeen> = {}): RecoveryLastSeen {
  return {
    statusKey: "working",
    title: null,
    harness: "claude-code",
    executionToken: TOKEN_ONE,
    conversation: { kind: "verified", id: CONV_A },
    observation: "run 3a9c1e7b collection 4",
    collectedAt: "2026-09-10T08:59:00.000Z",
    ...changes,
  };
}

const INTERRUPTED: RecoveryDisappearance = {
  goneWhy: "absent-from-snapshot",
  observation: "run e4d2b6f0 collection 1",
  generation: "changed",
  bootChanged: false,
  producerRun: "changed",
  watched: true,
  hostBootId: "ri-view-host-boot",
};

let serial = 0;
function record(changes: Partial<FullRecord> & { entry?: RegisterEntry | null } = {}): FullRecord {
  serial += 1;
  const entry = changes.entry === undefined ? entryOf(row("$51", "alpha-view", CONV_A)) : changes.entry;
  return {
    id: `rc-${serial.toString(16).padStart(20, "0")}` as RecoveryCandidateId,
    key: entry?.key ?? (sessionKey(identityOf(row("$51", "alpha-view", CONV_A))) as FullRecord["key"]),
    name: entry?.name ?? "alpha-view",
    at: "2026-09-10T09:00:00.000Z",
    origin: "journal",
    resolution: { disposition: "unresolved" },
    oversize: false,
    entry,
    lastSeen: lastSeen(),
    disappearance: INTERRUPTED,
    ...changes,
  };
}

const TRUSTED_EMPTY: InventoryTrust = { kind: "trusted", rows: [], collectedAt: "2026-09-10T09:01:00.000Z", observation: "run e4d2b6f0 collection 2" };

function trusted(rows: readonly ObservedRow[]): InventoryTrust {
  return { kind: "trusted", rows, collectedAt: "2026-09-10T09:01:00.000Z", observation: "run e4d2b6f0 collection 2" };
}

describe("classification, first match wins", () => {
  test("an inventory that cannot be trusted makes the record unknown, whatever rows it would have matched", () => {
    const untrusted: InventoryTrust = { kind: "untrusted", why: "the latest payload was refused: the dashboard's last collection failed" };
    const result = classifyRecord(record(), untrusted);
    expect(result.kind).toBe("unknown");
    expect(result.why).toContain("refused");
  });

  test("a record with no surviving entry is unknown, and says so", () => {
    const result = classifyRecord(record({ entry: null, origin: "legacy", lastSeen: null }), TRUSTED_EMPTY);
    expect(result).toMatchObject({ kind: "unknown" });
    expect(result.why).toContain("no register entry survives");
  });

  test("already-live: the same verified conversation under the same token is the same run, never gone", () => {
    const result = classifyRecord(record(), trusted([liveRow("$7", "alpha-view", CONV_A, TOKEN_ONE)]));
    expect(result).toMatchObject({ kind: "already-live", sameRun: true });
  });

  test("already-live: the same verified conversation under a different token is a resumption", () => {
    const result = classifyRecord(record(), trusted([liveRow("$8", "elsewhere", CONV_A, TOKEN_TWO)]));
    expect(result).toMatchObject({ kind: "already-live", sameRun: false });
  });

  test("already-live prefers the previous token regardless of row order, and does not invent a resumption without that token", () => {
    const oldRun = liveRow("$8", "old-run", CONV_A, TOKEN_ONE);
    const newRun = liveRow("$9", "new-run", CONV_A, TOKEN_TWO);
    for (const rows of [
      [newRun, oldRun],
      [oldRun, newRun],
    ]) {
      expect(classifyRecord(record(), trusted(rows))).toMatchObject({ kind: "already-live", sameRun: true, row: { tmuxId: "$8" } });
    }
    expect(classifyRecord(record({ lastSeen: lastSeen({ executionToken: null }) }), trusted([newRun]))).toMatchObject({
      kind: "already-live",
      sameRun: null,
    });
  });

  test("a conflicting reading's observed conversation is the verified one; its claim is not", () => {
    const conflicting = record({ lastSeen: lastSeen({ conversation: { kind: "conflicting", claimed: CLAIM_C, observed: CONV_A } }) });
    expect(classifyRecord(conflicting, trusted([liveRow("$7", "x", CONV_A, TOKEN_ONE)])).kind).toBe("already-live");
    expect(classifyRecord(conflicting, trusted([liveRow("$7", "x", CLAIM_C, TOKEN_ONE)])).kind).not.toBe("already-live");
  });

  test("present-but-unmatched: same name and dir, no verified matching conversation, and the live row's facts are shown", () => {
    const unverified = record({ lastSeen: lastSeen({ conversation: null, harness: null, executionToken: null }) });
    const result = classifyRecord(unverified, trusted([row("$99", "alpha-view", null)]));
    expect(result.kind).toBe("present-but-unmatched");
    if (result.kind !== "present-but-unmatched") return;
    expect(result.row).toMatchObject({ tmuxId: "$99", name: "alpha-view", dir: DIR });
  });

  test("present-but-unmatched: the same claim on a row that does not verify it", () => {
    const result = classifyRecord(record(), trusted([row("$98", "renamed", CONV_A)]));
    expect(result.kind).toBe("present-but-unmatched");
  });

  test("ended-before-reboot: only a watched last observation of no-claude or an idle shell establishes it", () => {
    for (const statusKey of ["no-claude", "shell:false"]) {
      const ended = classifyRecord(record({ lastSeen: lastSeen({ statusKey }) }), TRUSTED_EMPTY);
      expect(ended.kind).toBe("ended-before-reboot");
    }
    const busyShell = classifyRecord(record({ lastSeen: lastSeen({ statusKey: "shell:true" }) }), TRUSTED_EMPTY);
    expect(busyShell.kind).toBe("interrupted");
    // Sol's F4: a gap nobody watched cannot say what the session was doing.
    const unwatched = classifyRecord(
      record({ lastSeen: lastSeen({ statusKey: "no-claude" }), disappearance: { ...INTERRUPTED, watched: false } }),
      TRUSTED_EMPTY,
    );
    expect(unwatched.kind).toBe("unknown");
  });

  test("interrupted needs a changed world; unverifiable counts only when the dashboard run changed too (Sol's F1)", () => {
    expect(classifyRecord(record(), TRUSTED_EMPTY).kind).toBe("interrupted");
    const reboot = record({ disappearance: { ...INTERRUPTED, generation: "unverifiable", producerRun: "changed" } });
    expect(classifyRecord(reboot, TRUSTED_EMPTY).kind).toBe("interrupted");
    for (const producerRun of ["same", "cannot-tell"] as const) {
      const killServer = record({ disappearance: { ...INTERRUPTED, generation: "unverifiable", producerRun } });
      const result = classifyRecord(killServer, TRUSTED_EMPTY);
      expect(result.kind).toBe("unknown");
      expect(result.why).not.toBe("");
    }
    const dashboardRestart = record({ disappearance: { ...INTERRUPTED, generation: "same", producerRun: "changed" } });
    expect(classifyRecord(dashboardRestart, TRUSTED_EMPTY).kind).toBe("unknown");
  });
});

/** A projects directory, a stat that sees the directories named, and a host name. */
function deps(projectsDir: string, dirs: readonly string[] = []): EvidenceDeps {
  return {
    projectsDir,
    hostname: () => HOST,
    stat: async (path: string) => {
      if (dirs.includes(path)) return { isDirectory: () => true, isFile: () => false, mtimeMs: Date.parse("2026-09-10T07:00:00.000Z") };
      if (path.startsWith(projectsDir)) return realStat(path);
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
  };
}

function writeTranscript(projectsDir: string, dir: string, conversation: string, mtimeIso: string): string {
  const slugDir = join(projectsDir, slugifyDir(dir));
  mkdirSync(slugDir, { recursive: true });
  const path = join(slugDir, `${conversation}.jsonl`);
  writeFileSync(path, `${JSON.stringify({ type: "user", message: { content: "hello" } })}\n`);
  const at = new Date(mtimeIso);
  utimesSync(path, at, at);
  return path;
}

describe("evidence", () => {
  test("a missing directory is a missing directory: the record stays interrupted and unresolved", async () => {
    const r = record();
    const evidence = await recoveryEvidence(r, deps(tempRoot()));
    expect(evidence.kind).toBe("checked");
    if (evidence.kind !== "checked") return;
    expect(evidence.dir).toMatchObject({ kind: "missing", path: DIR });
    expect(classifyRecord(r, TRUSTED_EMPTY).kind).toBe("interrupted");
    expect(r.resolution).toEqual({ disposition: "unresolved" });
  });

  test("an existing directory, and legacy metadata that recorded none", async () => {
    const present = await recoveryEvidence(record(), deps(tempRoot(), [DIR]));
    expect(present.kind === "checked" && present.dir.kind).toBe("exists");
    const legacyRow = row("$52", "legacy-view", null, { meta: { version: "legacy" } });
    const legacy = await recoveryEvidence(record({ entry: entryOf(legacyRow) }), deps(tempRoot()));
    expect(legacy.kind === "checked" && legacy.dir.kind).toBe("not-recorded");
  });

  test("transcript absent: not-found with its reason, and resume is not-supported, saying why", async () => {
    const evidence = await recoveryEvidence(record(), deps(tempRoot(), [DIR]));
    if (evidence.kind !== "checked") throw new Error("expected evidence");
    expect(evidence.transcript).toMatchObject({ kind: "not-found", under: "verified", reason: "no-transcript-file" });
    expect(evidence.resume.kind).toBe("not-supported");
    if (evidence.resume.kind === "not-supported") expect(evidence.resume.why).toContain("transcript");
  });

  test("a valid Claude transcript under the launch directory's slug: found, with its mtime, and resume is supported", async () => {
    const projects = tempRoot();
    const path = writeTranscript(projects, DIR, CONV_A, "2026-09-10T09:30:00.000Z");
    const evidence = await recoveryEvidence(record(), deps(projects, [DIR]));
    if (evidence.kind !== "checked") throw new Error("expected evidence");
    expect(evidence.transcript).toMatchObject({ kind: "found", path, conversationId: CONV_A, mtime: "2026-09-10T09:30:00.000Z" });
    expect(evidence.resume).toMatchObject({ kind: "supported", conversationId: CONV_A, transcriptPath: path });
    // The later of the register's floor and the transcript's mtime.
    expect(evidence.lastActivity).toEqual({ at: "2026-09-10T09:30:00.000Z", source: "transcript" });
  });

  test("a transcript relocated to a worktree slug by EnterWorktree is found by the scan, and resume is supported", async () => {
    const projects = tempRoot();
    const path = writeTranscript(projects, `${DIR}/.claude/worktrees/ri-relocated`, CONV_A, "2026-09-10T09:40:00.000Z");
    const evidence = await recoveryEvidence(record(), deps(projects, [DIR]));
    if (evidence.kind !== "checked") throw new Error("expected evidence");
    expect(evidence.transcript).toMatchObject({ kind: "found", path, via: "scan" });
    expect(evidence.resume.kind).toBe("supported");
  });

  test("a transcript scan stops at its project-directory bound and says it cannot tell", async () => {
    const projects = tempRoot();
    for (let i = 0; i <= RECOVERY_TRANSCRIPT_PROJECT_DIR_LIMIT; i += 1) {
      mkdirSync(join(projects, `project-${i.toString().padStart(3, "0")}`));
    }
    const evidence = await recoveryEvidence(record(), deps(projects, [DIR]));
    if (evidence.kind !== "checked") throw new Error("expected evidence");
    expect(evidence.transcript.kind).toBe("cannot-tell");
    expect(evidence.resume.kind).toBe("not-supported");
  });

  test("only a claim survives: a transcript under it is shown as unverified, and resume stays not-supported", async () => {
    const projects = tempRoot();
    writeTranscript(projects, DIR, CONV_A, "2026-09-10T09:30:00.000Z");
    const claimOnly = record({ lastSeen: lastSeen({ conversation: { kind: "unverifiable", claimed: CONV_A, why: "no ps" } }) });
    const evidence = await recoveryEvidence(claimOnly, deps(projects, [DIR]));
    if (evidence.kind !== "checked") throw new Error("expected evidence");
    expect(evidence.transcript).toMatchObject({ kind: "found-under-claim", claimedConversationId: CONV_A });
    expect(evidence.resume.kind).toBe("not-supported");
    // An unverified transcript is not evidence of activity: the floor stands.
    expect(evidence.lastActivity.source).toBe("register-floor");
  });

  test("a shell session is manual, with the host and the directory, and makes no resume claim", async () => {
    const shellRow = row("$53", "shell-view", null, { status: { kind: "shell", busy: true }, meta: { version: 1, kind: "shell", repo: "spideryarn/reading2", dir: DIR } });
    const shell = record({
      entry: entryOf(shellRow),
      lastSeen: lastSeen({ statusKey: "shell:true", harness: null, executionToken: null, conversation: null }),
    });
    const evidence = await recoveryEvidence(shell, deps(tempRoot(), [DIR]));
    if (evidence.kind !== "checked") throw new Error("expected evidence");
    expect(evidence.resume).toEqual({ kind: "manual", host: HOST, dir: DIR, why: expect.any(String) as string });
    expect(evidence.transcript.kind).toBe("no-conversation");
  });

  test("a Codex run is not-supported: resume is not wired for it in v1", async () => {
    const codex = record({ lastSeen: lastSeen({ harness: "codex-interactive" }) });
    const evidence = await recoveryEvidence(codex, deps(tempRoot(), [DIR]));
    if (evidence.kind !== "checked") throw new Error("expected evidence");
    expect(evidence.resume.kind).toBe("not-supported");
    if (evidence.resume.kind === "not-supported") expect(evidence.resume.why).toContain("v1");
  });

  test("a worktree name is display text: recorded only when the directory is under .claude/worktrees/<name>", async () => {
    const inside = row("$54", "wt-view", null, { worktree: "ri-wt", meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: `${DIR}/.claude/worktrees/ri-wt` } });
    const outside = row("$55", "wt-view-2", null, { worktree: "ri-wt", meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: DIR } });
    const a = await recoveryEvidence(record({ entry: entryOf(inside) }), deps(tempRoot()));
    const b = await recoveryEvidence(record({ entry: entryOf(outside) }), deps(tempRoot()));
    expect(a.kind === "checked" && a.worktree.kind).toBe("recorded");
    expect(b.kind === "checked" && b.worktree.kind).toBe("not-recorded");
  });
});

describe("the view", () => {
  test("the first page: unresolved first, newest disappearance first, then resolved; one clock; olderCount", async () => {
    const fold: RecoveryFold = emptyRecoveryFold({ kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, null);
    const unresolved = Array.from({ length: RECOVERY_PAGE_SIZE + 1 }, (_, i) =>
      record({ at: new Date(Date.parse("2026-09-10T00:00:00.000Z") + i * 60_000).toISOString() }),
    );
    const resolved = record({
      at: "2026-09-11T00:00:00.000Z",
      resolution: { disposition: "dismissed", evidence: { requestId: "ri-view-req", why: "checked by hand" }, at: "2026-09-11T00:01:00.000Z" },
    });
    for (const r of [...unresolved, resolved]) fold.records.set(r.id, r);
    const view = await buildRecoveryView(recoveryIndexOf(fold), TRUSTED_EMPTY, { ...deps(tempRoot()), now: () => new Date("2026-09-11T01:00:00.000Z") });
    expect(view.checkedAt).toBe("2026-09-11T01:00:00.000Z");
    expect(view.page).toHaveLength(RECOVERY_PAGE_SIZE);
    expect(view.olderCount).toBe(2);
    expect(view.page[0]?.at).toBe(unresolved[RECOVERY_PAGE_SIZE]?.at);
    expect(view.page.every((item) => item.resolution.disposition === "unresolved")).toBe(true);
    expect(view.page[0]?.classification?.kind).toBe("interrupted");
    expect(view.inventory).toMatchObject({ kind: "trusted" });
  });
});

describe("derived dispositions", () => {
  test("superseded: two candidates for one verified conversation leave the older one superseded, naming the newer", () => {
    const fold = emptyRecoveryFold({ kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, null);
    const older = record({ at: "2026-09-10T09:00:00.000Z" });
    const newer = record({ at: "2026-09-10T10:00:00.000Z", entry: entryOf(row("$61", "alpha-view-again", CONV_A)) });
    fold.records.set(older.id, older);
    fold.records.set(newer.id, newer);
    const events = deriveDispositions(recoveryIndexOf(fold), null, "2026-09-10T10:05:00.000Z");
    expect(events).toEqual([
      { kind: "recovery-disposition", at: "2026-09-10T10:05:00.000Z", id: older.id, disposition: "superseded", evidence: { by: newer.id } },
    ]);
  });

  test("a claim alone never supersedes", () => {
    const fold = emptyRecoveryFold({ kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, null);
    const claimOnly = { conversation: { kind: "unverifiable" as const, claimed: CONV_B, why: "no ps" }, harness: null, executionToken: null };
    const older = record({ at: "2026-09-10T09:00:00.000Z", lastSeen: lastSeen(claimOnly), entry: entryOf(row("$62", "b1", CONV_B)) });
    const newer = record({ at: "2026-09-10T10:00:00.000Z", lastSeen: lastSeen(claimOnly), entry: entryOf(row("$63", "b2", CONV_B)) });
    fold.records.set(older.id, older);
    fold.records.set(newer.id, newer);
    expect(deriveDispositions(recoveryIndexOf(fold), null, "2026-09-10T10:05:00.000Z")).toEqual([]);
  });

  test("resumed: a live verified execution with the same conversation and a different token, both tokens recorded; applied once", () => {
    const fold = emptyRecoveryFold({ kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, null);
    const r = record();
    fold.records.set(r.id, r);
    const live = [liveRow("$70", "alpha-view", CONV_A, TOKEN_TWO)];
    const events = deriveDispositions(recoveryIndexOf(fold), live, "2026-09-10T10:05:00.000Z");
    expect(events).toEqual([
      {
        kind: "recovery-disposition",
        at: "2026-09-10T10:05:00.000Z",
        id: r.id,
        disposition: "resumed",
        evidence: { previousToken: TOKEN_ONE, token: TOKEN_TWO, conversationId: CONV_A },
      },
    ]);
    foldRecovery(events, fold);
    expect(deriveDispositions(recoveryIndexOf(fold), live, "2026-09-10T10:06:00.000Z")).toEqual([]);
  });

  test("the same token is not a resumption, and no inventory is no evidence", () => {
    const fold = emptyRecoveryFold({ kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, null);
    const r = record();
    fold.records.set(r.id, r);
    expect(deriveDispositions(recoveryIndexOf(fold), [liveRow("$70", "alpha-view", CONV_A, TOKEN_ONE)], "2026-09-10T10:05:00.000Z")).toEqual([]);
    expect(deriveDispositions(recoveryIndexOf(fold), null, "2026-09-10T10:05:00.000Z")).toEqual([]);
  });
});

describe("retention", () => {
  test("resolved records older than 30 days leave the index; unresolved never do; the pending wait is untouched", () => {
    const fold = emptyRecoveryFold({ kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 }, null);
    const nowMs = Date.parse("2026-11-01T00:00:00.000Z");
    const oldAt = new Date(nowMs - RECOVERY_RESOLVED_RETENTION_MS - 60_000).toISOString();
    const recentAt = new Date(nowMs - RECOVERY_RESOLVED_RETENTION_MS + 60_000).toISOString();
    const dismissed = (at: string) => ({ disposition: "dismissed" as const, evidence: { requestId: `ri-${at}`, why: "done" }, at });
    const oldResolved = record({ at: "2026-09-01T00:00:00.000Z", resolution: dismissed(oldAt) });
    const recentResolved = record({ at: "2026-09-01T00:00:00.000Z", resolution: dismissed(recentAt) });
    const ancientUnresolved = record({ at: "2026-01-01T00:00:00.000Z" });
    for (const r of [oldResolved, recentResolved, ancientUnresolved]) fold.records.set(r.id, r);
    fold.pending.set(oldResolved.key, { id: oldResolved.id, lastSeenObservation: "run x collection 1", lastSeenAt: null });

    expect(pruneResolved(fold, nowMs)).toBe(true);
    expect([...fold.records.keys()].sort()).toEqual([recentResolved.id, ancientUnresolved.id].sort());
    expect(fold.pending.get(oldResolved.key)?.id).toBe(oldResolved.id);
    expect(pruneResolved(fold, nowMs)).toBe(false);
  });
});

describe("the CLI", () => {
  function out(): { lines: string[]; write: (line: string) => void } {
    const lines: string[] = [];
    return { lines, write: (line: string) => lines.push(line) };
  }

  test("dismiss writes one request file into the inbox, named by a fresh request id, and touches neither events.jsonl nor recovery.json", async () => {
    const root = tempRoot();
    writeFileSync(join(root, EVENTS_FILE), "");
    writeFileSync(join(root, "recovery.json"), "{}\n");
    const before = { events: readFileSync(join(root, EVENTS_FILE)), recovery: readFileSync(join(root, "recovery.json")) };
    const sink = out();
    const code = await recoveryCli(["dismiss", "rc-0123456789abcdef0123", "--why", "looked at it by hand"], { root, out: sink.write });
    expect(code).toBe(0);
    const inbox = join(root, RECOVERY_INBOX_DIR);
    const files = readdirSync(inbox);
    expect(files).toHaveLength(1);
    const [file] = files;
    expect(file).toMatch(/^[0-9a-f-]{36}\.json$/);
    const request = JSON.parse(readFileSync(join(inbox, file as string), "utf8")) as Record<string, unknown>;
    expect(request).toMatchObject({ kind: "dismiss", id: "rc-0123456789abcdef0123", why: "looked at it by hand", requestId: (file as string).slice(0, 36) });
    expect(readFileSync(join(root, EVENTS_FILE))).toEqual(before.events);
    expect(readFileSync(join(root, "recovery.json"))).toEqual(before.recovery);
    expect(statSync(join(root, EVENTS_FILE)).size).toBe(0);
  });

  test("dismiss refuses without a sentence, and writes nothing", async () => {
    const root = tempRoot();
    const sink = out();
    expect(await recoveryCli(["dismiss", "rc-0123456789abcdef0123"], { root, out: sink.write })).not.toBe(0);
    expect(existsSync(join(root, RECOVERY_INBOX_DIR))).toBe(false);
  });

  test("list gives the exact overflow count and says those records survive only in events.jsonl (Sol's F10)", async () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "recovery.json"),
      `${JSON.stringify({
        schema: 1,
        writtenAt: "2026-09-10T12:00:00.000Z",
        cursor: { events: 0, bytes: 0 },
        bootId: null,
        replay: { kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 0 },
        overflow: 3,
        records: [],
        overflowIds: ["rc-00000000000000000001", "rc-00000000000000000002", "rc-00000000000000000003"],
        pending: [],
        appliedRequests: [],
        view: null,
      })}\n`,
    );
    const sink = out();
    expect(await recoveryCli(["list"], { root, out: sink.write })).toBe(0);
    const text = sink.lines.join("\n");
    expect(text).toContain("3 ");
    expect(text).toContain("events.jsonl");
    expect(text).not.toContain("rc-00000000000000000001");
  });

  test("list with no recovery.json says so rather than printing an empty list", async () => {
    const root = tempRoot();
    const sink = out();
    expect(await recoveryCli(["list"], { root, out: sink.write })).not.toBe(0);
    expect(sink.lines.join("\n")).toContain("recovery.json");
  });
});
