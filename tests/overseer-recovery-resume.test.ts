/**
 * Gradual recovery's resume pass, below the daemon — plan
 * docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md,
 * Stage 1, with the review dispositions (G1–G10).
 *
 * The leaf's file format, the two new gates, the occurrence table, pace,
 * revalidation, verification, the preview's bounds, the locator's roots and
 * the account port — and `runResumePass` itself with a fake launch port that
 * keeps the protocol's rules. The daemon-driven cases are in
 * tests/overseer-daemon-recovery-resume.test.ts.
 *
 * Every conversation id is minted per run (`randomUUID`), so no uuid literal
 * is shared with another test file (tests/fixture-ids.test.ts).
 */
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { slugifyDir } from "../tools/fleet/transcript.js";
import type { RecoveryResumeAccount } from "../tools/fleet/wire.js";
import { identityOf, sessionKey, type OverseerEvent } from "../tools/overseer/diff.js";
import { accountQuotaGate, healthGate, type AccountUsageSection, type LaunchGate, type StoredAccountUsage } from "../tools/overseer/launch-gate.js";
import type { ObservedRow } from "../tools/overseer/observation.js";
import { isCandidateId } from "../tools/overseer/recovery-inbox.js";
import {
  CANDIDATE_ID_PATTERN,
  listPendingResumeRequests,
  parseResumeRequest,
  pendingFor,
  RECOVERY_RESUME_DIR,
  writeResumeRequest,
} from "../tools/overseer/recovery-resume-request.js";
import {
  decideResume,
  defaultProjectsRoots,
  newPreviewCache,
  occurrenceStep,
  paceOf,
  PREVIEW_HEAD_BYTES,
  PREVIEW_TAIL_BYTES,
  productionAccountPort,
  quotaGateFor,
  QUOTE_MAX_CHARS,
  revalidate,
  RESERVATIONS_TAIL_BYTES,
  RESUME_SPACING_MS,
  RESUME_USAGE_STALE_AFTER_MS,
  readRange,
  runResumePass,
  settledStateOf,
  transcriptAfter,
  transcriptQuotes,
  VERIFY_TAIL_BYTES,
  verificationOf,
  type ReadRange,
  type ResumeAccountPort,
  type ResumeObservation,
  type ResumeOccurrence,
  type Revalidation,
  type RevalidationFacts,
} from "../tools/overseer/recovery-resume.js";
import { evidenceDeps, transcriptLocator, type InventoryTrust } from "../tools/overseer/recovery-view.js";
import type { RecoveryCandidateId, RecoveryDisappearance, RecoveryIndex, RecoveryLastSeen, RecoveryRecord } from "../tools/overseer/recovery.js";
import { foldEvents, type RegisterEntry } from "../tools/overseer/store.js";
import { fakeAccounts, fakePort, liveSpelling, markerLines, mutableClock, storedUsage, usageSection, type FakePort } from "./overseer-recovery-resume-fakes.js";

type FullRecord = Extract<RecoveryRecord, { oversize: false }>;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-recovery-resume-test-"));
  roots.push(root);
  return root;
}

const NOW_ISO = "2026-09-10T10:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const TOKEN_ONE = "ri-resume-boot:7100:11";
const TOKEN_TWO = "ri-resume-boot:7200:22";
const OK_HEALTH = { verdict: { level: "ok" } };

function row(id: string, name: string, claim: string | null, dir: string, changes: Partial<ObservedRow> = {}): ObservedRow {
  return {
    id,
    name,
    execution: { kind: "unknown", cause: "not-reported", why: "written by hand for this test" },
    title: null,
    repo: "spideryarn/reading2",
    worktree: null,
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir },
    startedAt: "2026-09-10T08:00:00.000Z",
    paneId: "%9",
    panePid: 7100,
    claimedConversationId: claim,
    question: null,
    status: { kind: "idle" },
    ...changes,
  };
}

function liveRow(id: string, name: string, conversation: string, token: string, dir: string): ObservedRow {
  const [boot, pid, ticks] = token.split(":");
  return row(id, name, conversation, dir, {
    execution: {
      kind: "verified",
      token: { boot: boot as string, pid: Number(pid), startTicks: Number(ticks) },
      harness: "claude-code",
      conversation: { kind: "verified", id: conversation },
    },
  });
}

function entryOf(r: ObservedRow): RegisterEntry {
  const event: OverseerEvent = { kind: "session-seen", at: "2026-09-10T08:30:00.000Z", tmuxServerPid: 512001, key: sessionKey(identityOf(r)), identity: identityOf(r), row: r };
  const entry = foldEvents([event], new Map()).get(sessionKey(identityOf(r)));
  if (entry === undefined) throw new Error("the fold made no entry");
  return entry;
}

const INTERRUPTED: RecoveryDisappearance = {
  goneWhy: "absent-from-snapshot",
  observation: "run b8e05f3a collection 1",
  generation: "changed",
  bootChanged: true,
  producerRun: "changed",
  watched: true,
  hostBootId: "ri-resume-host-boot",
};

let serial = 0;
/** An interrupted record for `conversation` in `dir`, as the fold would hold it. */
function record(conversation: string, dir: string, name = `resume-${serial + 1}`, changes: Partial<FullRecord> = {}): FullRecord {
  serial += 1;
  const tmuxId = `$${600 + serial}`;
  const entry = entryOf(row(tmuxId, name, conversation, dir));
  const lastSeen: RecoveryLastSeen = {
    statusKey: "working",
    title: `${name} title`,
    harness: "claude-code",
    executionToken: TOKEN_ONE,
    conversation: { kind: "verified", id: conversation },
    observation: "run 7c41d2e9 collection 4",
    collectedAt: "2026-09-10T08:59:00.000Z",
  };
  return {
    id: `rc-${serial.toString(16).padStart(20, "a")}` as RecoveryCandidateId,
    key: entry.key,
    name,
    at: "2026-09-10T09:00:00.000Z",
    origin: "journal",
    resolution: { disposition: "unresolved" },
    oversize: false,
    entry,
    lastSeen,
    disappearance: INTERRUPTED,
    ...changes,
  };
}

function trusted(rows: readonly ObservedRow[] = []): InventoryTrust {
  return { kind: "trusted", rows, collectedAt: "2026-09-10T09:59:00.000Z", observation: "run b8e05f3a collection 9" };
}

function indexOf(records: readonly RecoveryRecord[]): RecoveryIndex {
  return {
    records: new Map(records.map((r) => [r.id, r])),
    overflow: 0,
    bootId: null,
    replay: { kind: "ran", worldChanges: 1, derived: 0, scannedBytes: 0 },
    appliedRequests: new Set(),
  };
}

/** One transcript line, shaped like a real one (read off this box read-only: `type`, `message.content`, `sessionId`, `timestamp`). */
function line(type: "user" | "assistant", text: string, conversation: string, timestamp: string, extra: Record<string, unknown> = {}): string {
  const content = type === "assistant" ? [{ type: "text", text }] : text;
  return `${JSON.stringify({ type, message: { role: type, content }, sessionId: conversation, timestamp, ...extra })}\n`;
}

function writeTranscript(projects: string, dir: string, conversation: string, lines: readonly string[] = []): string {
  const slug = join(projects, slugifyDir(dir));
  mkdirSync(slug, { recursive: true });
  const path = join(slug, `${conversation}.jsonl`);
  const body = lines.length > 0 ? lines : [line("user", "please do the thing", conversation, "2026-09-10T08:10:00.000Z"), line("assistant", "doing it", conversation, "2026-09-10T08:11:00.000Z")];
  writeFileSync(path, body.join(""));
  const at = new Date("2026-09-10T08:12:00.000Z");
  utimesSync(path, at, at);
  return path;
}

function occurrence(candidateId: string, changes: Partial<ResumeOccurrence> = {}): ResumeOccurrence {
  return {
    candidateId: candidateId as RecoveryCandidateId,
    occurrenceId: `lo-${candidateId}`,
    state: "launching",
    attempt: 1,
    reservationHeld: true,
    disposed: false,
    endedAt: null,
    completion: null,
    ...changes,
  };
}

// ═══ The leaf ═════════════════════════════════════════════════════════════════

describe("the request leaf", () => {
  const seen = (dir = "/srv/ri-resume/one") => ({ checkedAt: NOW_ISO, conversationId: randomUUID(), dir });

  test("two taps are two nonce-named files, each whole, and no temp file is left behind", () => {
    const root = tempRoot();
    const id = "rc-0123456789abcdef0123";
    const s = seen();
    const first = writeResumeRequest(root, { candidateId: id, actor: "dashboard", seen: s });
    const second = writeResumeRequest(root, { candidateId: id, actor: "cli", seen: s });
    if (first.kind !== "written" || second.kind !== "written") throw new Error("expected both written");
    expect(first.path).not.toBe(second.path);
    const names = readdirSync(join(root, RECOVERY_RESUME_DIR, "pending")).sort();
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name).toMatch(/^rc-0123456789abcdef0123--[0-9a-f]{32}\.json$/);
      const parsed = parseResumeRequest(readFileSync(join(root, RECOVERY_RESUME_DIR, "pending", name), "utf8"), name);
      expect(parsed.ok).toBe(true);
    }
    expect(pendingFor(root, id)).toEqual({ kind: "pending" });
    expect(pendingFor(root, "rc-ffffffffffffffffffff")).toEqual({ kind: "none" });
  });

  test("bad input is refused before anything is created", () => {
    const root = tempRoot();
    expect(writeResumeRequest(root, { candidateId: "rc-nothex", actor: "cli", seen: seen() }).kind).toBe("refused");
    expect(writeResumeRequest(root, { candidateId: "rc-0123456789abcdef0123", actor: "cli", seen: { ...seen(), dir: "relative/dir" } }).kind).toBe("refused");
    expect(writeResumeRequest(root, { candidateId: "rc-0123456789abcdef0123", actor: "cli", seen: { ...seen(), conversationId: "not-a-uuid" } }).kind).toBe("refused");
    expect(existsSync(join(root, RECOVERY_RESUME_DIR))).toBe(false);
  });

  test("the parser is strict and never throws", () => {
    for (const text of ["", "{", "null", "[]", "42", '{"v":2}', '{"v":1,"candidateId":"rc-0123456789abcdef0123"}', "\u0000\u0001"]) {
      expect(() => parseResumeRequest(text)).not.toThrow();
      expect(parseResumeRequest(text).ok).toBe(false);
    }
    const root = tempRoot();
    const written = writeResumeRequest(root, { candidateId: "rc-0123456789abcdef0123", actor: "cli", seen: seen() });
    if (written.kind !== "written") throw new Error("expected written");
    const text = readFileSync(written.path, "utf8");
    expect(parseResumeRequest(text, "rc-0123456789abcdef0123--" + "0".repeat(32) + ".json").ok).toBe(false);
  });

  test("the candidate id pattern has one copy, and the dismiss inbox uses it", () => {
    for (const id of ["rc-0123456789abcdef0123", "rl-ffffffffffffffffffff", "rc-0123", "rx-0123456789abcdef0123", "RC-0123456789ABCDEF0123"]) {
      expect(isCandidateId(id)).toBe(CANDIDATE_ID_PATTERN.test(id));
    }
  });

  test("the lister: oldest first, junk quarantined, a malformed request refused with why, the scan bounded with an overflow count", async () => {
    const root = tempRoot();
    const pending = join(root, RECOVERY_RESUME_DIR, "pending");
    const late = writeResumeRequest(root, { candidateId: "rc-bbbbbbbbbbbbbbbbbbbb", actor: "cli", seen: seen(), now: new Date("2026-09-10T09:00:05.000Z") });
    const early = writeResumeRequest(root, { candidateId: "rc-aaaaaaaaaaaaaaaaaaab", actor: "cli", seen: seen(), now: new Date("2026-09-10T09:00:01.000Z") });
    if (late.kind !== "written" || early.kind !== "written") throw new Error("expected written");
    writeFileSync(join(pending, "not-a-request.txt"), "x");
    symlinkSync("/etc/hostname", join(pending, `rc-cccccccccccccccccccc--${"c".repeat(32)}.json`));
    writeFileSync(join(pending, `rc-dddddddddddddddddddd--${"d".repeat(32)}.json`), "{ not json");
    writeFileSync(join(pending, ".tmp-1-young"), "being written");
    const listing = await listPendingResumeRequests(root, { nowMs: Date.now(), log: () => {} });
    expect(listing.requests.map((r) => r.request.candidateId)).toEqual(["rc-aaaaaaaaaaaaaaaaaaab", "rc-bbbbbbbbbbbbbbbbbbbb"]);
    expect(readdirSync(join(root, RECOVERY_RESUME_DIR, "junk"))).toHaveLength(2);
    const refused = readdirSync(join(root, RECOVERY_RESUME_DIR, "refused"));
    expect(refused).toEqual([`rc-dddddddddddddddddddd--${"d".repeat(32)}.json`]);
    expect(JSON.parse(readFileSync(join(root, RECOVERY_RESUME_DIR, "refused", refused[0] as string), "utf8")).why).toContain("not JSON");
    // The young temp stays: it may be a writer still writing.
    expect(existsSync(join(pending, ".tmp-1-young"))).toBe(true);

    const flooded = tempRoot();
    for (let i = 0; i < 6; i += 1) writeResumeRequest(flooded, { candidateId: `rc-${String(i).padStart(20, "e")}`, actor: "cli", seen: seen() });
    const bounded = await listPendingResumeRequests(flooded, { nowMs: Date.now(), log: () => {}, scanLimit: 4 });
    expect(bounded.requests).toHaveLength(4);
    expect(bounded.overflow).toBe(2);
  });
});

// ═══ The two new gates ════════════════════════════════════════════════════════

const STALE = RESUME_USAGE_STALE_AFTER_MS;

/**
 * A hand-built section in dev's shape (launch-gate.ts § `AccountUsageSection`),
 * with resets spelled as the live endpoint spells them. `percent` null is a
 * failed read.
 */
function section(percent: number | null, changes: { takenAtMs?: number; resetsAtMs?: number; kind?: "value" | "expired" | "unknown" } = {}): AccountUsageSection {
  const takenAtMs = changes.takenAtMs ?? NOW;
  const resetsAtMs = changes.resetsAtMs ?? NOW + 2 * 60 * 60_000;
  if (percent === null) {
    return { ...usageSection("ri-pool", 0, takenAtMs), providerAccountId: null, reading: { kind: "unknown", why: "usage request failed with HTTP 500" } };
  }
  const built = usageSection("ri-pool", percent, takenAtMs, resetsAtMs);
  if (changes.kind === "expired") {
    return { ...built, providerAccountId: "ri-provider-account", reading: { kind: "windows", windows: [{ kind: "expired", window: "five_hour", resetsAt: liveSpelling(resetsAtMs), why: "reset" }] } } as AccountUsageSection;
  }
  if (changes.kind === "unknown") {
    return { ...built, providerAccountId: "ri-provider-account", reading: { kind: "windows", windows: [{ kind: "unknown", window: "five_hour", why: "no resets_at" }] } } as AccountUsageSection;
  }
  return built;
}

describe("healthGate and accountQuotaGate", () => {
  test("health: critical holds, unknown goes to onUnknown, strained is clear with a note, ok is clear", () => {
    expect(healthGate({ verdict: { level: "critical" } }, "hold").kind).toBe("held");
    expect(healthGate({ verdict: { level: "critical" } }, "clear").kind).toBe("held");
    expect(healthGate({ verdict: { level: "unknown" } }, "hold").kind).toBe("held");
    expect(healthGate(null, "hold").kind).toBe("held");
    expect(healthGate(null, "clear").kind).toBe("clear");
    const strained = healthGate({ verdict: { level: "strained" } }, "hold");
    expect(strained.kind === "clear" && strained.notes.length).toBe(1);
    expect(healthGate(OK_HEALTH, "hold")).toEqual({ kind: "clear", notes: [] });
  });

  test("quota: 100% holds until that window's reset, read from the live endpoint's spelling; 80% holds with no until; below is clear", () => {
    const resetsAtMs = NOW + 90 * 60_000;
    expect(liveSpelling(resetsAtMs)).toMatch(/\.\d{6}\+00:00$/);
    expect(accountQuotaGate(section(100, { resetsAtMs }), NOW, "clear", STALE)).toEqual({
      kind: "held",
      why: "ri-pool has used its 5-hour limit",
      until: new Date(resetsAtMs).toISOString(),
    });
    expect(accountQuotaGate(section(84), NOW, "clear", STALE)).toEqual({ kind: "held", why: "ri-pool is at 84% of its 5-hour limit", until: null });
    expect(accountQuotaGate(section(79), NOW, "hold", STALE)).toEqual({ kind: "clear", notes: [] });
  });

  test("quota: several holds are joined, and until is the latest reset", () => {
    const early = NOW + 60 * 60_000;
    const late = NOW + 5 * 60 * 60_000;
    const both = section(100, { resetsAtMs: early });
    if (both.reading.kind !== "windows") throw new Error("expected windows");
    both.reading.windows.push({ kind: "value", window: "seven_day", utilizationPercent: 100, resetsAt: liveSpelling(late) });
    expect(accountQuotaGate(both, NOW, "clear", STALE)).toEqual({
      kind: "held",
      why: "ri-pool has used its 5-hour limit; ri-pool has used its 7-day limit",
      until: new Date(late).toISOString(),
    });
  });

  test("quota: a past reset, an expired or unknown window, a failed read, no identity, not Claude, or a stale, future or unreadable time are unknown", () => {
    const cases: (AccountUsageSection | null)[] = [
      section(100, { resetsAtMs: NOW - 1000 }),
      section(10, { kind: "expired" }),
      section(10, { kind: "unknown" }),
      section(null),
      { ...section(10), providerAccountId: null } as unknown as AccountUsageSection,
      { ...section(10), family: "codex" } as unknown as AccountUsageSection,
      { ...section(10), takenAt: new Date(NOW - STALE - 1000).toISOString() } as AccountUsageSection,
      { ...section(10), takenAt: new Date(NOW + 6 * 60_000).toISOString() } as AccountUsageSection,
      { ...section(10), takenAt: "not a time" } as AccountUsageSection,
      null,
    ];
    for (const one of cases) {
      expect(accountQuotaGate(one, NOW, "hold", STALE).kind).toBe("held");
      expect(accountQuotaGate(one, NOW, "clear", STALE).kind).toBe("clear");
    }
  });

  test("quotaGateFor: the pinned account's section, by registry name; none, any problem, or no such section is unknown", () => {
    const stored = storedUsage([section(10), { ...section(95), name: "someone-else" }], NOW);
    expect(quotaGateFor(stored, "ri-pool", NOW)).toEqual({ kind: "clear", notes: [] });
    expect(quotaGateFor(stored, "someone-else", NOW).kind).toBe("held");
    expect(quotaGateFor(stored, "nobody", NOW).kind).toBe("held");
    expect(quotaGateFor(storedUsage([section(10)], NOW, ["the account registry would not parse"]), "ri-pool", NOW).kind).toBe("held");
    expect(quotaGateFor({ kind: "none", why: "no usage pass has run yet", at: NOW_ISO }, "ri-pool", NOW).kind).toBe("held");
    expect(quotaGateFor(null, "ri-pool", NOW).kind).toBe("held");
  });
});

// ═══ The occurrence table (G1), pace (G2, G8) and the decision ════════════════

const OK_REVALIDATION: Revalidation = {
  kind: "ok",
  conversationId: "0",
  dir: "/srv/ri",
  transcriptPath: "/srv/ri/t.jsonl",
  size: 10,
  mtimeMs: 1,
  account: { name: "ri-pool", configDir: "/nonexistent/ri-pool-config" },
  record: record(randomUUID(), "/srv/ri"),
};

function decide(changes: Partial<Parameters<typeof decideResume>[0]> = {}): ReturnType<typeof decideResume> {
  return decideResume({
    nowMs: NOW,
    launcher: { kind: "wired" },
    occurrence: null,
    pace: { kind: "free" },
    health: healthGate(OK_HEALTH, "hold"),
    quota: accountQuotaGate(section(10), NOW, "hold", STALE),
    revalidation: OK_REVALIDATION,
    ...changes,
  });
}

describe("the occurrence table (G1)", () => {
  const id = "rc-0000000000000000000a";

  test("none continues into attempt 1; a released, undisposed failed-before-launch into attempt 2", () => {
    expect(decide()).toMatchObject({ kind: "launch", attempt: 1 });
    expect(decide({ occurrence: occurrence(id, { state: "failed-before-launch", reservationHeld: false, attempt: 1 }) })).toMatchObject({ kind: "launch", attempt: 2 });
  });

  test("a failed-before-launch whose slot is still held defers, and says why", () => {
    const decision = decide({ occurrence: occurrence(id, { state: "failed-before-launch", reservationHeld: true }) });
    expect(decision).toMatchObject({ kind: "defer" });
    if (decision.kind === "defer") expect(decision.why).toContain("slot has not been released");
  });

  test("G13: planned and waiting-admission are driven once pace, the gates and revalidation pass; reserved defers with the protocol's state", () => {
    for (const state of ["planned", "waiting-admission"] as const) {
      expect(decide({ occurrence: occurrence(id, { state }) })).toMatchObject({ kind: "drive", occurrence: { state } });
      // Not past a held gate, a refusing revalidation, or pace.
      expect(decide({ occurrence: occurrence(id, { state }), health: healthGate({ verdict: { level: "critical" } }, "hold") }).kind).toBe("defer");
      expect(decide({ occurrence: occurrence(id, { state }), revalidation: { kind: "refuse", why: "the directory is missing" } }).kind).toBe("refuse");
      expect(decide({ occurrence: occurrence(id, { state }), pace: { kind: "spacing", untilMs: NOW + 1000 } }).kind).toBe("defer");
    }
    const reserved = decide({ occurrence: occurrence(id, { state: "reserved" }) });
    expect(reserved.kind).toBe("defer");
    if (reserved.kind === "defer") expect(reserved.why).toContain("reserved");
  });

  test("launching, observed-running, outcome-unknown and completed are settled; so is anything disposed", () => {
    for (const state of ["launching", "observed-running", "outcome-unknown", "completed"] as const) {
      expect(decide({ occurrence: occurrence(id, { state }) }).kind).toBe("settled");
    }
    for (const state of ["planned", "failed-before-launch", "reserved"] as const) {
      expect(occurrenceStep(occurrence(id, { state, disposed: true, reservationHeld: false })).kind).toBe("settled");
    }
  });
});

describe("pace (G2, G8)", () => {
  const me = "rc-0000000000000000000b" as RecoveryCandidateId;
  const other = "rc-0000000000000000000c";
  const base = { candidateId: me, lastVerifiedAtMs: null, nowMs: NOW, nameOf: (id: string) => (id === other ? "the-other-one" : id) };

  test("an undisposed in-flight occurrence that is not verified blocks, and names it", () => {
    const pace = paceOf({ ...base, inFlight: [occurrence(other, { state: "observed-running" })], verified: () => false });
    expect(pace.kind).toBe("blocked");
    if (pace.kind === "blocked") expect(pace.why).toContain("the-other-one to be verified running");
  });

  test("an outcome-unknown blocker names the exact dispose command", () => {
    const pace = paceOf({ ...base, inFlight: [occurrence(other, { state: "outcome-unknown" })], verified: () => false });
    if (pace.kind !== "stuck") throw new Error("expected stuck");
    expect(pace.why).toContain(`scripts/overseer-launches.ts dispose lo-${other} --as not-running`);
  });

  test("G19: a terminal occurrence still holding its reservation is a STUCK blocker with the dispose command — completed or failed, verified or not", () => {
    for (const state of ["completed", "failed-before-launch"] as const) {
      for (const verified of [false, true]) {
        const pace = paceOf({ ...base, inFlight: [occurrence(other, { state, reservationHeld: true })], verified: () => verified });
        expect({ state, verified, kind: pace.kind }).toEqual({ state, verified, kind: "stuck" });
        if (pace.kind !== "stuck") throw new Error("expected stuck");
        expect(pace.disposeCommand).toBe(`npx tsx scripts/overseer-launches.ts dispose lo-${other} --as not-running --why "<what you checked>"`);
        expect(pace.why).toContain(pace.disposeCommand);
      }
    }
    // Released, it is not a blocker at all; disposed, nothing is.
    expect(paceOf({ ...base, inFlight: [occurrence(other, { state: "completed", reservationHeld: false })], verified: () => false })).toEqual({ kind: "free" });
    expect(paceOf({ ...base, inFlight: [occurrence(other, { state: "completed", reservationHeld: true, disposed: true })], verified: () => false })).toEqual({ kind: "free" });
  });

  test("G19: the page state of every terminal occurrence still holding its reservation is needs-greg with the dispose command, even one verified earlier", () => {
    for (const state of ["completed", "failed-before-launch"] as const) {
      for (const verifiedAt of [null, NOW_ISO]) {
        const got = settledStateOf({
          requestedAt: NOW_ISO,
          settledAt: NOW_ISO,
          occurrence: occurrence(other, { state, reservationHeld: true, completion: state === "completed" ? { kind: "exit", code: 0 } : null }),
          verification: { inventoryResumed: false, observedRunning: false, transcriptGrew: false, sessionLineSeen: false },
          verifiedAt,
        });
        expect({ state, verifiedAt, kind: got.kind }).toEqual({ state, verifiedAt, kind: "needs-greg" });
        expect(got.kind === "needs-greg" && got.disposeCommand).toContain(`dispose lo-${other}`);
      }
    }
  });

  test("a disposed blocker releases pace; a verified one gives way to spacing", () => {
    expect(paceOf({ ...base, inFlight: [occurrence(other, { disposed: true })], verified: () => false })).toEqual({ kind: "free" });
    expect(paceOf({ ...base, inFlight: [occurrence(other)], verified: () => true, lastVerifiedAtMs: NOW - 1000 })).toEqual({
      kind: "spacing",
      untilMs: NOW - 1000 + RESUME_SPACING_MS,
    });
    expect(paceOf({ ...base, inFlight: [], verified: () => true, lastVerifiedAtMs: NOW - RESUME_SPACING_MS })).toEqual({ kind: "free" });
  });
});

describe("the gates in the decision", () => {
  const refuse: Revalidation = { kind: "refuse", why: "the directory is missing" };

  test("critical and unknown health defer; a deferred request is never refused, whatever revalidation says", () => {
    for (const health of [{ verdict: { level: "critical" } }, { verdict: { level: "unknown" } }, null]) {
      expect(decide({ health: healthGate(health, "hold"), revalidation: refuse }).kind).toBe("defer");
    }
  });

  test("a limited account defers until its reset; approaching and unknown usage defer", () => {
    const resetsAtMs = NOW + 45 * 60_000;
    const q = (s: AccountUsageSection | null): LaunchGate => accountQuotaGate(s, NOW, "hold", STALE);
    expect(decide({ quota: q(section(100, { resetsAtMs })) })).toMatchObject({ kind: "defer", until: new Date(resetsAtMs).toISOString() });
    expect(decide({ quota: q(section(90)) }).kind).toBe("defer");
    expect(decide({ quota: q(section(null)) }).kind).toBe("defer");
    expect(decide({ quota: q(section(100, { resetsAtMs })), revalidation: refuse }).kind).toBe("defer");
  });

  test("strained and ok pass", () => {
    expect(decide({ health: healthGate({ verdict: { level: "strained" } }, "hold") }).kind).toBe("launch");
    expect(decide().kind).toBe("launch");
  });

  test("with no pinned account there is no quota to judge, and revalidation's refusal stands", () => {
    const manual: Revalidation = { kind: "refuse", why: "manual only: started on the default login" };
    expect(decide({ quota: null, revalidation: manual })).toEqual(manual);
  });

  test("the unwired capability defers and never refuses", () => {
    expect(decide({ launcher: { kind: "unwired", why: "not composed" }, revalidation: refuse })).toMatchObject({ kind: "defer", why: "not composed" });
  });
});

describe("revalidation (§ 2.6 and the dispositions)", () => {
  const conversation = randomUUID();
  const dir = "/srv/ri-resume/revalidation";
  const r = record(conversation, dir, "reval-one");
  const pinned: RecoveryResumeAccount = { kind: "pinned", name: "ri-pool", configDir: "/nonexistent/ri-pool-config" };
  const facts = (changes: Partial<RevalidationFacts> = {}): RevalidationFacts => ({
    request: { v: 1, candidateId: r.id, requestedAt: NOW_ISO, actor: "cli", nonce: "0".repeat(32), seen: { checkedAt: NOW_ISO, conversationId: conversation, dir } },
    record: r,
    inventory: trusted(),
    located: { kind: "found", path: "/srv/t.jsonl", via: "slug-guess", root: "/srv" },
    dir: { kind: "directory" },
    transcript: { kind: "file", size: 5, mtimeMs: 5 },
    account: pinned,
    accountRecheck: { kind: "same" },
    producerCanVerify: true,
    ...changes,
  });

  test("everything current is ok, and carries what revalidation measured", () => {
    expect(revalidate(facts())).toMatchObject({ kind: "ok", conversationId: conversation, dir, size: 5, mtimeMs: 5 });
  });

  test("changed since you looked: seen.dir differs from the current entry", () => {
    const result = revalidate(facts({ request: { ...facts().request, seen: { checkedAt: NOW_ISO, conversationId: conversation, dir: "/srv/elsewhere" } } }));
    expect(result.kind).toBe("refuse");
    if (result.kind === "refuse") expect(result.why).toContain("changed since you looked");
  });

  test("already resumed elsewhere: a live row holds the conversation", () => {
    const result = revalidate(facts({ inventory: trusted([liveRow("$9", "someone-else", conversation, TOKEN_TWO, dir)]) }));
    expect(result.kind === "refuse" && result.why).toContain("already resumed elsewhere");
  });

  test("unknowns stay put: ended-before-reboot and unwatched records are refused; an untrusted inventory defers", () => {
    const ended = record(conversation, dir, "reval-ended", { lastSeen: { ...(r.lastSeen as RecoveryLastSeen), statusKey: "no-claude" } });
    expect(revalidate(facts({ record: ended })).kind).toBe("refuse");
    const unwatched = record(conversation, dir, "reval-unwatched", { disappearance: { ...INTERRUPTED, watched: false } });
    expect(revalidate(facts({ record: unwatched })).kind).toBe("refuse");
    expect(revalidate(facts({ inventory: { kind: "untrusted", why: "the latest collection failed" } })).kind).toBe("defer");
  });

  test("an account that cannot be established is manual only", () => {
    const result = revalidate(facts({ account: { kind: "unknown", reason: "default-login", why: "started on the default login, which gjd-remote cannot relaunch by name" } }));
    expect(result.kind === "refuse" && result.why).toContain("manual only");
  });

  test("a missing directory, and a transcript gone since the preview", () => {
    expect(revalidate(facts({ dir: { kind: "missing", why: "ENOENT" } })).kind).toBe("refuse");
    const gone = revalidate(facts({ transcript: { kind: "missing", why: "ENOENT" } }));
    expect(gone.kind === "refuse" && gone.why).toContain("the transcript is gone since the preview");
  });
});

// ═══ Verification (G2) ════════════════════════════════════════════════════════

describe("verification: all four facts", () => {
  const conversation = randomUUID();
  const launchedAt = "2026-09-10T10:00:00.000Z";
  const attempt = {
    v: 1 as const,
    candidateId: "rc-0000000000000000000d",
    conversationId: conversation,
    transcriptPath: "/srv/t.jsonl",
    transcriptSizeAtLaunch: 100,
    transcriptMtimeAtLaunch: 1000,
    launchedAt,
    verifiedAt: null,
  };
  const resumed = record(conversation, "/srv/v", "verify-one", {
    resolution: { disposition: "resumed", at: launchedAt, evidence: { previousToken: TOKEN_ONE, token: TOKEN_TWO, conversationId: conversation } },
  });
  const objects = (...lines: string[]): Record<string, unknown>[] => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  const after = objects(line("assistant", "back", conversation, "2026-09-10T10:00:30.000Z"));
  /** A reading taken against this attempt's offset (100): `newLines` are the lines that began after it. */
  const reading = (size: number, mtimeMs: number, newLines: Record<string, unknown>[]) => ({ size, mtimeMs, afterOffset: 100, newLines });

  test("resumed, observed running, grown and a new line: verified", () => {
    const v = verificationOf(occurrence(attempt.candidateId, { state: "observed-running" }), resumed, reading(200, 2000, after), attempt);
    expect(v).toEqual({ inventoryResumed: true, observedRunning: true, transcriptGrew: true, sessionLineSeen: true });
  });

  test("a new line in a transcript whose size and mtime did not both move is not growth", () => {
    const v = verificationOf(occurrence(attempt.candidateId, { state: "observed-running" }), resumed, reading(100, 1000, after), attempt);
    expect(v.transcriptGrew).toBe(false);
    expect(v.sessionLineSeen).toBe(true);
  });

  test("only another conversation's line after the offset, a launch not seen running, a record not resumed: each missing", () => {
    const foreign = objects(line("assistant", "other", randomUUID(), "2026-09-10T10:00:30.000Z"));
    expect(verificationOf(occurrence(attempt.candidateId, { state: "observed-running" }), resumed, reading(200, 2000, foreign), attempt).sessionLineSeen).toBe(false);
    expect(verificationOf(occurrence(attempt.candidateId, { state: "launching" }), resumed, reading(200, 2000, after), attempt).observedRunning).toBe(false);
    expect(verificationOf(occurrence(attempt.candidateId, { state: "observed-running" }), record(conversation, "/srv/v"), reading(200, 2000, after), attempt).inventoryResumed).toBe(false);
  });
});

describe("G12: a line counts only when it BEGINS AFTER the byte offset recorded before invocation", () => {
  const conversation = randomUUID();
  const mine = (text: string, at = "2026-09-10T11:00:00.000Z"): string => line("assistant", text, conversation, at);
  const attemptAt = (size: number) => ({
    v: 1 as const,
    candidateId: "rc-0000000000000000000e",
    conversationId: conversation,
    transcriptPath: "/unused",
    transcriptSizeAtLaunch: size,
    transcriptMtimeAtLaunch: 1,
    launchedAt: "2026-09-10T12:00:00.000Z",
    verifiedAt: null,
  });
  const resumed = record(conversation, "/srv/v12", "verify-offset", {
    resolution: { disposition: "resumed", at: NOW_ISO, evidence: { previousToken: TOKEN_ONE, token: TOKEN_TWO, conversationId: conversation } },
  });
  const running = occurrence("rc-0000000000000000000e", { state: "observed-running" });

  async function readAfter(body: string, offset: number) {
    const path = join(tempRoot(), `${conversation}.jsonl`);
    writeFileSync(path, body);
    return transcriptAfter(path, offset);
  }

  test("a line beginning exactly at the offset counts, and needs no timestamp after the launch clock", async () => {
    const before = mine("before, dated far in the future", "2027-01-01T00:00:00.000Z");
    const reading = await readAfter(before + mine("after, dated before the launch clock", "2026-09-10T00:00:00.000Z"), Buffer.byteLength(before));
    expect(verificationOf(running, resumed, reading, attemptAt(Buffer.byteLength(before))).sessionLineSeen).toBe(true);
  });

  test("everything before the offset is ignored, however it is dated, and unrelated growth after it proves nothing", async () => {
    const before = mine("before, dated far in the future", "2027-01-01T00:00:00.000Z");
    const unrelated = `${JSON.stringify({ type: "summary", summary: "x" })}\n${line("assistant", "other", randomUUID(), "2027-01-01T00:00:00.000Z")}`;
    const reading = await readAfter(before + unrelated, Buffer.byteLength(before));
    const v = verificationOf(running, resumed, reading, attemptAt(Buffer.byteLength(before)));
    expect(v.sessionLineSeen).toBe(false);
  });

  test("a line that began before the offset (the file ended mid-line at launch) is not after it", async () => {
    const whole = mine("straddles the offset");
    const reading = await readAfter(whole, 10);
    expect(verificationOf(running, resumed, reading, attemptAt(10)).sessionLineSeen).toBe(false);
  });

  test("an offset before the 64 KiB tail window: the window after the offset is read, bounded, and a line there counts", async () => {
    const before = mine("before");
    const filler = `${JSON.stringify({ type: "attachment", filler: "f".repeat(4000) })}\n`;
    let body = before + mine("the resumed session's first line");
    while (Buffer.byteLength(body) < 300 * 1024) body += filler;
    let bytes = 0;
    const path = join(tempRoot(), `${conversation}.jsonl`);
    writeFileSync(path, body);
    const counting: ReadRange = async (p, position, length) => {
      const got = await readRange(p, position, length);
      bytes += got.length;
      return got;
    };
    const reading = await transcriptAfter(path, Buffer.byteLength(before), counting);
    expect(bytes).toBeLessThanOrEqual(2 * VERIFY_TAIL_BYTES + 1);
    expect(verificationOf(running, resumed, reading, attemptAt(Buffer.byteLength(before))).sessionLineSeen).toBe(true);
  });

  test("a reading taken against another attempt's offset is not this attempt's evidence", async () => {
    const before = mine("before");
    const reading = await readAfter(before + mine("after"), 0);
    expect(verificationOf(running, resumed, reading, attemptAt(Buffer.byteLength(before))).sessionLineSeen).toBe(false);
  });
});

// ═══ The preview ══════════════════════════════════════════════════════════════

describe("the preview", () => {
  test("a 10 MiB transcript is read at most 512 KiB, the quotes are capped, and an unchanged file is not read again", async () => {
    const dir = tempRoot();
    const conversation = randomUUID();
    const path = join(dir, `${conversation}.jsonl`);
    const brief = "b".repeat(QUOTE_MAX_CHARS + 50);
    let body = "";
    body += `${JSON.stringify({ type: "user", isMeta: true, message: { role: "user", content: "meta, never the brief" } })}\n`;
    body += `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "a result" }] } })}\n`;
    body += line("user", brief, conversation, "2026-09-10T08:00:00.000Z");
    const filler = `${JSON.stringify({ type: "attachment", filler: "f".repeat(4000) })}\n`;
    while (body.length < 10 * 1024 * 1024) body += filler;
    body += `${JSON.stringify({ type: "custom-title", customTitle: "ri-resume-title" })}\n`;
    body += line("assistant", "where it got to", conversation, "2026-09-10T09:00:00.000Z");
    body += `${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] } })}\n`;
    writeFileSync(path, body);

    let bytes = 0;
    let reads = 0;
    const counting: ReadRange = async (p, position, length) => {
      reads += 1;
      const { readRange } = await import("../tools/overseer/recovery-resume.js");
      const got = await readRange(p, position, length);
      bytes += got.length;
      return got;
    };
    const cache = newPreviewCache();
    const quotes = await transcriptQuotes(path, { readRange: counting, cache });
    expect(bytes).toBeLessThanOrEqual(PREVIEW_HEAD_BYTES + PREVIEW_TAIL_BYTES);
    expect(reads).toBe(2);
    expect(quotes.brief).toEqual({ kind: "quoted", text: "b".repeat(QUOTE_MAX_CHARS), truncated: true });
    expect(quotes.lastWords).toEqual({ kind: "quoted", text: "where it got to", truncated: false });
    expect(quotes.title).toBe("ri-resume-title");
    await transcriptQuotes(path, { readRange: counting, cache });
    expect(reads).toBe(2);
  });
});

// ═══ The locator's roots and the account port (G4) ════════════════════════════

describe("the transcript locator's roots", () => {
  test("a transcript under a second root is found, and the root it was found under is recorded", async () => {
    const first = tempRoot();
    const second = tempRoot();
    const conversation = randomUUID();
    const dir = "/srv/ri-resume/second-root";
    mkdirSync(join(first, "some-other-project"));
    writeTranscript(second, dir, conversation);
    const locate = transcriptLocator(evidenceDeps({ projectsRoots: async () => [first, second] }));
    expect(await locate(conversation, dir)).toMatchObject({ kind: "found", via: "slug-guess", root: realpathSync(second) });
    // And by scan, when the directory does not predict the slug.
    expect(await transcriptLocator(evidenceDeps({ projectsRoots: async () => [first, second] }))(conversation, "/srv/elsewhere")).toMatchObject({
      kind: "found",
      via: "scan",
      root: realpathSync(second),
    });
  });

  test("a root that is a symlink to another is searched once", async () => {
    const real = tempRoot();
    const alias = join(tempRoot(), "alias-projects");
    symlinkSync(real, alias);
    mkdirSync(join(real, "one-project"));
    const located = await transcriptLocator(evidenceDeps({ projectsRoots: async () => [alias, real] }))(randomUUID(), null);
    expect(located.kind).toBe("not-found");
    if (located.kind === "not-found") expect(located.why).toContain("looked in all 1 project directories");
  });

  test("the default roots: CLAUDE_CONFIG_DIR, ~/.claude, and every registered Claude account, and nothing guessed from a name", async () => {
    const home = tempRoot();
    const stateDir = tempRoot();
    mkdirSync(join(home, ".claude-lookalike", "projects"), { recursive: true });
    const registryPath = join(tempRoot(), "registry.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        schema: 1,
        accounts: [
          {
            name: "ri-pool",
            family: "claude",
            role: "pool",
            stateDir,
            providerAccountId: randomUUID(),
            providerTenantId: randomUUID(),
            displayEmail: "ri@example.invalid",
            addedAt: NOW_ISO,
            familyData: {},
          },
        ],
      }),
    );
    const listed = await defaultProjectsRoots({ registryPath, home, env: { CLAUDE_CONFIG_DIR: "/srv/ri-config" } })();
    expect(listed).toEqual(["/srv/ri-config/projects", join(home, ".claude", "projects"), join(stateDir, "projects")]);
  });
});

describe("the production account port", () => {
  function world(): { accountsDir: string; stateDir: string; projects: string; conversation: string } {
    const accountsDir = tempRoot();
    const stateDir = tempRoot();
    const projects = tempRoot();
    symlinkSync(projects, join(stateDir, "projects"));
    const conversation = randomUUID();
    writeFileSync(
      join(accountsDir, "registry.json"),
      JSON.stringify({
        schema: 1,
        accounts: [
          { name: "ri-pool", family: "claude", role: "pool", stateDir, providerAccountId: randomUUID(), providerTenantId: randomUUID(), addedAt: NOW_ISO, familyData: {} },
        ],
      }),
    );
    const rowOf = (session: string, accountName: string) =>
      `${JSON.stringify({ schema: 1, accountName, providerAccountId: null, sessionUuid: session, launchName: "ri", createdAt: NOW_ISO, outcome: "started" })}\n`;
    writeFileSync(join(accountsDir, "reservations.ndjson"), rowOf(conversation, "someone-else") + rowOf(randomUUID(), "ri-pool") + rowOf(conversation, "ri-pool"));
    return { accountsDir, stateDir, projects, conversation };
  }

  test("the conversation's LAST ledger row names the account, pinned to its config directory when the transcript is under its projects", async () => {
    const w = world();
    const port = productionAccountPort({ accountsDir: w.accountsDir });
    const resolved = await port.resolve({ conversationId: w.conversation, transcriptPath: "", transcriptRoot: realpathSync(w.projects) });
    expect(resolved.account).toEqual({ kind: "pinned", name: "ri-pool", configDir: w.stateDir });
  });

  test("no ledger row is the default login; a transcript under another root is not that account's", async () => {
    const w = world();
    const port = productionAccountPort({ accountsDir: w.accountsDir });
    const none = await port.resolve({ conversationId: randomUUID(), transcriptPath: "", transcriptRoot: realpathSync(w.projects) });
    // G17: THE ONE PROVEN DEFAULT LOGIN has its own reason code; nothing else may claim it.
    expect(none.account).toEqual({ kind: "unknown", reason: "default-login", why: "started on the default login, which gjd-remote cannot relaunch by name" });
    const elsewhere = await port.resolve({ conversationId: w.conversation, transcriptPath: "", transcriptRoot: realpathSync(tempRoot()) });
    expect(elsewhere.account).toMatchObject({ kind: "unknown", reason: "transcript-elsewhere" });
    expect(elsewhere.account.kind === "unknown" && elsewhere.account.why).toContain("not under the account ri-pool's own projects directory");
  });

  test("G11: the resolution carries evidence a synchronous recheck can test: unchanged is same; a ledger append, a registry replaced, or the account's projects link moved is changed", async () => {
    const w = world();
    const port = productionAccountPort({ accountsDir: w.accountsDir });
    const input = { conversationId: w.conversation, transcriptPath: "", transcriptRoot: realpathSync(w.projects) };
    const resolved = (await port.resolve(input)) as unknown as { account: RecoveryResumeAccount; recheck(): { kind: string } };
    expect(resolved.account).toMatchObject({ kind: "pinned", name: "ri-pool" });
    expect(resolved.recheck()).toEqual({ kind: "same" });
    appendFileSync(join(w.accountsDir, "reservations.ndjson"), `${JSON.stringify({ schema: 1, note: "another launch" })}\n`);
    expect(resolved.recheck().kind).toBe("changed");

    const again = (await port.resolve(input)) as unknown as { recheck(): { kind: string } };
    expect(again.recheck()).toEqual({ kind: "same" });
    const registry = join(w.accountsDir, "registry.json");
    writeFileSync(`${registry}.next`, readFileSync(registry));
    renameSync(`${registry}.next`, registry);
    expect(again.recheck().kind).toBe("changed");

    const third = (await port.resolve(input)) as unknown as { recheck(): { kind: string } };
    expect(third.recheck()).toEqual({ kind: "same" });
    rmSync(join(w.stateDir, "projects"));
    symlinkSync(tempRoot(), join(w.stateDir, "projects"));
    expect(third.recheck().kind).toBe("changed");
  });

  test("the port reads no quota and so makes no network call: the quota is the daemon's stored per-account reading", () => {
    const w = world();
    expect(Object.keys(productionAccountPort({ accountsDir: w.accountsDir }))).toEqual(["resolve"]);
  });
});

describe("G15: the account ledger's rows are the real launch record, and anything doubtful is unknown, never an account", () => {
  /**
   * Two registered accounts whose projects both resolve to the transcript's
   * root, so a WRONG row would pin a launch to the wrong account — the danger
   * being tested, not a row that happens to be refused later for its root.
   */
  function ledgerWorld(ledger: string): { accountsDir: string; projects: string } {
    const accountsDir = tempRoot();
    const projects = tempRoot();
    const accounts = ["ri-pool", "ri-other"].map((name) => {
      const stateDir = tempRoot();
      symlinkSync(projects, join(stateDir, "projects"));
      return { name, family: "claude", role: "pool", stateDir, providerAccountId: randomUUID(), providerTenantId: randomUUID(), addedAt: NOW_ISO, familyData: {} };
    });
    writeFileSync(join(accountsDir, "registry.json"), JSON.stringify({ schema: 1, accounts }));
    writeFileSync(join(accountsDir, "reservations.ndjson"), ledger);
    return { accountsDir, projects };
  }
  const row = (session: string, accountName: string, over: Record<string, unknown> = {}): string =>
    JSON.stringify({ schema: 1, accountName, providerAccountId: null, sessionUuid: session, launchName: "ri", createdAt: NOW_ISO, outcome: "started", ...over });
  async function resolveIn(ledger: string, conversation: string): Promise<RecoveryResumeAccount> {
    const w = ledgerWorld(ledger);
    const resolved: unknown = await productionAccountPort({ accountsDir: w.accountsDir }).resolve({ conversationId: conversation, transcriptPath: "", transcriptRoot: realpathSync(w.projects) });
    // Stage-agnostic: the port answers the account, or (after G11) the account with its evidence.
    return (typeof resolved === "object" && resolved !== null && "account" in resolved ? (resolved as { account: RecoveryResumeAccount }).account : resolved) as RecoveryResumeAccount;
  }

  test("a valid row is still the account", async () => {
    const conversation = randomUUID();
    expect(await resolveIn(`${row(conversation, "ri-pool")}\n`, conversation)).toMatchObject({ kind: "pinned", name: "ri-pool" });
  });

  test("a newer line naming the conversation that is not a whole launch record overrides nothing: unknown", async () => {
    const conversation = randomUUID();
    const foreign = JSON.stringify({ schema: 1, sessionUuid: conversation, accountName: "ri-other" });
    const got = await resolveIn(`${row(conversation, "ri-pool")}\n${foreign}\n`, conversation);
    expect(got.kind).toBe("unknown");
    expect(got.kind === "unknown" && got.why).toContain("not a valid launch record");
  });

  test("a newer row with an unreadable timestamp or an outcome the ledger does not have is not a record: unknown", async () => {
    for (const over of [{ createdAt: "not a time" }, { outcome: "exploded" }, { activeUntil: 7 }, { launchName: null }]) {
      const conversation = randomUUID();
      const got = await resolveIn(`${row(conversation, "ri-pool")}\n${row(conversation, "ri-other", over)}\n`, conversation);
      expect({ over, kind: got.kind }).toEqual({ over, kind: "unknown" });
    }
  });

  test("a tail window with no newline in it (one line longer than the window, still being written) is unknown, never parsed from its middle", async () => {
    const conversation = randomUUID();
    // The whole line is not JSON (two values); its last 4 MiB are whitespace and a row naming ri-other.
    const giant = `{"a":1}${" ".repeat(RESERVATIONS_TAIL_BYTES + 16)}${row(conversation, "ri-other")}`;
    const got = await resolveIn(`${row(conversation, "ri-pool")}\n${giant}`, conversation);
    expect(got.kind).toBe("unknown");
    expect(got.kind === "unknown" && got.why).toContain("longer than");
  });

  test("an oversized relevant line — cut by the window, naming the conversation, nothing newer — is unknown, not the default login", async () => {
    const conversation = randomUUID();
    const oversized = row(conversation, "ri-pool", { note: "n".repeat(RESERVATIONS_TAIL_BYTES + 16) });
    const got = await resolveIn(`${oversized}\n${row(randomUUID(), "ri-other")}\n`, conversation);
    expect(got.kind).toBe("unknown");
    expect(got.kind === "unknown" && got.why).toContain("longer than");
    // And a newer valid row after such a line still decides.
    const decided = await resolveIn(`${oversized}\n${row(conversation, "ri-other")}\n`, conversation);
    expect(decided).toMatchObject({ kind: "pinned", name: "ri-other" });
  });
});

// ═══ The pass, with a fake launch port ════════════════════════════════════════

type PassWorld = {
  root: string;
  projects: string;
  clock: ReturnType<typeof mutableClock>;
  port: FakePort;
  records: Map<string, FullRecord>;
  conversations: Map<string, string>;
  dirs: Map<string, string>;
  rows: ObservedRow[];
  health: unknown;
  /** The per-account usage reading the pass is handed; fresh at the clock by default. */
  usage: () => StoredAccountUsage | null;
  logs: string[];
};

function passWorld(names: readonly string[]): PassWorld {
  const root = tempRoot();
  const projects = tempRoot();
  const clock = mutableClock(NOW_ISO);
  const w: PassWorld = {
    root,
    projects,
    clock,
    port: fakePort(join(tempRoot(), "invocations.jsonl")),
    records: new Map(),
    conversations: new Map(),
    dirs: new Map(),
    rows: [],
    health: OK_HEALTH,
    usage: () => storedUsage([usageSection("ri-pool", 12, clock.ms())], clock.ms()),
    logs: [],
  };
  for (const name of names) {
    const conversation = randomUUID();
    const dir = tempRoot();
    const r = record(conversation, dir, name);
    w.records.set(name, r);
    w.conversations.set(name, conversation);
    w.dirs.set(name, dir);
    writeTranscript(projects, dir, conversation);
  }
  return w;
}

function idOf(w: PassWorld, name: string): string {
  const r = w.records.get(name);
  if (r === undefined) throw new Error(`no record ${name}`);
  return r.id;
}

function tap(w: PassWorld, name: string): void {
  const written = writeResumeRequest(w.root, {
    candidateId: idOf(w, name),
    actor: "dashboard",
    seen: { checkedAt: NOW_ISO, conversationId: w.conversations.get(name) as string, dir: w.dirs.get(name) as string },
    now: w.clock.now(),
  });
  if (written.kind !== "written") throw new Error(written.why);
  w.clock.advance(1000);
}

/** What today's dashboard declares on every payload (tools/fleet/state.ts): it reads `--resume <uuid>`. */
const THIS_BUILD: readonly string[] = ["argv-resume-uuid"];

async function pass(w: PassWorld, extra: { beforeRecapture?: () => Promise<void>; observe?: () => ResumeObservation; accounts?: ResumeAccountPort } = {}) {
  return runResumePass({
    root: w.root,
    now: w.clock.now,
    log: (l) => w.logs.push(l),
    port: w.port,
    accounts: extra.accounts ?? fakeAccounts(),
    accountUsage: () => w.usage(),
    evidence: evidenceDeps({ projectsDir: w.projects }),
    // THIS_BUILD: today's dashboard declares it reads `--resume <uuid>` (G3), so the pass may launch.
    observe: extra.observe ?? (() => ({ inventory: trusted(w.rows), health: w.health, capabilities: THIS_BUILD, index: indexOf([...w.records.values()]) })),
    view: () => null,
    previewCache: newPreviewCache(),
    ...(extra.beforeRecapture === undefined ? {} : { beforeRecapture: extra.beforeRecapture }),
  });
}

function filesIn(w: PassWorld, dir: "pending" | "done" | "refused"): string[] {
  const path = join(w.root, RECOVERY_RESUME_DIR, dir);
  return existsSync(path) ? readdirSync(path).filter((n) => !n.startsWith(".")) : [];
}

function resolveResumed(w: PassWorld, name: string): void {
  const r = w.records.get(name) as FullRecord;
  const conversation = w.conversations.get(name) as string;
  w.records.set(name, { ...r, resolution: { disposition: "resumed", at: w.clock.now().toISOString(), evidence: { previousToken: TOKEN_ONE, token: TOKEN_TWO, conversationId: conversation } } });
}

function grow(w: PassWorld, name: string, timestampMs: number): void {
  const conversation = w.conversations.get(name) as string;
  const path = join(w.projects, slugifyDir(w.dirs.get(name) as string), `${conversation}.jsonl`);
  appendFileSync(path, line("assistant", "resumed and working", conversation, new Date(timestampMs).toISOString()));
  const at = new Date(Date.now() + 5000);
  utimesSync(path, at, at);
}

/** Growth that is not the resumed conversation: a line with no sessionId, and one from another conversation. */
function growUnrelated(w: PassWorld, name: string): void {
  const conversation = w.conversations.get(name) as string;
  const path = join(w.projects, slugifyDir(w.dirs.get(name) as string), `${conversation}.jsonl`);
  appendFileSync(path, `${JSON.stringify({ type: "file-history-snapshot", snapshot: { files: {} } })}\n`);
  appendFileSync(path, line("assistant", "someone else", randomUUID(), new Date(w.clock.ms()).toISOString()));
  const at = new Date(Date.now() + 10_000);
  utimesSync(path, at, at);
}

describe("the pass (G1, G2, G8), with a fake launch port", () => {
  test("a live resumed process whose transcript does not grow stays unverified and blocks the next request, visibly (G2)", async () => {
    const w = passWorld(["alpha", "beta"]);
    // A line of this conversation dated AFTER the launch that is to come,
    // already in the file before it: it is before the launch's byte offset,
    // so it proves nothing about the resumed session (G12).
    grow(w, "alpha", NOW + 60 * 60_000);
    tap(w, "alpha");
    tap(w, "beta");
    const first = await pass(w);
    expect(first.head).toMatchObject({ decision: "launch", outcome: "invoked" });
    expect(markerLines(w.port.markerPath)).toHaveLength(1);

    w.port.set(idOf(w, "alpha"), { state: "observed-running", reservationHeld: false });
    resolveResumed(w, "alpha");
    const second = await pass(w);
    expect(second.head).toMatchObject({ candidateId: idOf(w, "beta"), decision: "defer" });
    expect(second.head?.why).toContain("alpha to be verified running");
    const alphaState = second.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state;
    expect(alphaState).toMatchObject({ kind: "launched", verification: { inventoryResumed: true, observedRunning: true, transcriptGrew: false, sessionLineSeen: false } });
    expect(second.projection.pace).toMatchObject({ kind: "waiting-for-verification", candidateId: idOf(w, "alpha") });

    // G12: THE TRANSCRIPT GROWS, BUT NOT WITH THIS CONVERSATION. The pre-launch
    // future-dated line plus an unrelated append is not verification.
    growUnrelated(w, "alpha");
    const unrelated = await pass(w);
    expect(unrelated.head).toMatchObject({ candidateId: idOf(w, "beta"), decision: "defer" });
    expect(unrelated.head?.why).toContain("alpha to be verified running");
    expect(unrelated.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state).toMatchObject({
      kind: "launched",
      verification: { transcriptGrew: true, sessionLineSeen: false },
    });
    w.clock.advance(RESUME_SPACING_MS + 1000);
    expect((await pass(w)).head).toMatchObject({ candidateId: idOf(w, "beta"), decision: "defer" });
    expect(w.port.invocations).toBe(1);

    // It writes a line of its own after the launch: verified, then two minutes of spacing, then beta.
    grow(w, "alpha", w.clock.ms() + 1000);
    const third = await pass(w);
    expect(third.head?.why).toContain("spacing");
    expect(third.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state.kind).toBe("resumed");
    w.clock.advance(RESUME_SPACING_MS + 1000);
    const fourth = await pass(w);
    expect(fourth.head).toMatchObject({ candidateId: idOf(w, "beta"), decision: "launch", outcome: "invoked" });
    expect(w.port.invocations).toBe(2);
    expect(markerLines(w.port.markerPath).map((m) => m.candidateId)).toEqual([idOf(w, "alpha"), idOf(w, "beta")]);
  });

  test("pace: an outcome-unknown blocker names its dispose command; dismissing the candidate does not waive it; disposing does (G8)", async () => {
    const w = passWorld(["alpha", "beta"]);
    tap(w, "alpha");
    await pass(w);
    w.port.set(idOf(w, "alpha"), { state: "outcome-unknown" });
    tap(w, "beta");
    const blocked = await pass(w);
    expect(blocked.head?.why).toContain(`dispose lo-${idOf(w, "alpha")}`);
    expect(blocked.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state).toMatchObject({ kind: "needs-greg" });

    const r = w.records.get("alpha") as FullRecord;
    w.records.set("alpha", { ...r, resolution: { disposition: "dismissed", at: w.clock.now().toISOString(), evidence: { requestId: randomUUID(), why: "let it go" } } });
    expect((await pass(w)).head).toMatchObject({ candidateId: idOf(w, "beta"), decision: "defer" });
    expect(w.port.invocations).toBe(1);

    w.port.set(idOf(w, "alpha"), { disposed: true });
    expect((await pass(w)).head).toMatchObject({ candidateId: idOf(w, "beta"), decision: "launch", outcome: "invoked" });
    expect(markerLines(w.port.markerPath)).toHaveLength(2);
  });

  test("an immediate failed-before-launch whose slot was released stays pending, and the next pass tries attempt 2 through the gates again, with no second tap (G1, G14)", async () => {
    const w = passWorld(["alpha"]);
    w.port.script.push(({ request, occurrenceId, attempt, port }) => {
      port.occurrences.set(request.candidateId, occurrence(request.candidateId, { occurrenceId, state: "failed-before-launch", attempt, reservationHeld: false }));
      return { kind: "failed-before-launch", occurrenceId, proof: "launcher-refused", why: "the launcher refused", reservation: { kind: "released" } };
    });
    tap(w, "alpha");
    const failed = await pass(w);
    expect(failed.head).toMatchObject({ decision: "launch", outcome: "failed-before-launch" });
    expect(filesIn(w, "refused")).toHaveLength(0);
    expect(filesIn(w, "pending")).toHaveLength(1);
    expect(failed.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state).toMatchObject({ kind: "pending" });
    expect(w.port.invocations).toBe(0);

    // The next pass: fresh gates and revalidation. A held gate still holds attempt 2.
    w.health = { verdict: { level: "critical" } };
    expect((await pass(w)).head).toMatchObject({ decision: "defer" });
    expect(w.port.calls).toHaveLength(1);
    w.health = OK_HEALTH;
    const retried = await pass(w);
    expect(retried.head).toMatchObject({ decision: "launch", outcome: "invoked" });
    expect(markerLines(w.port.markerPath)).toEqual([expect.objectContaining({ candidateId: idOf(w, "alpha"), attempt: 2 })]);
    expect(w.port.calls).toHaveLength(2);
    expect(filesIn(w, "done")).toHaveLength(1);
  });

  test("an immediate failed-before-launch whose slot is still held stays pending and deferred, visibly, with the dispose command; nothing more is asked of the launcher (G1, G14)", async () => {
    const w = passWorld(["alpha"]);
    w.port.script.push(({ request, occurrenceId, attempt, port }) => {
      port.occurrences.set(request.candidateId, occurrence(request.candidateId, { occurrenceId, state: "failed-before-launch", attempt, reservationHeld: true }));
      return { kind: "failed-before-launch", occurrenceId, proof: "launcher-refused", why: "refused", reservation: { kind: "held", why: "the owner did not answer" } };
    });
    tap(w, "alpha");
    const failed = await pass(w);
    expect(filesIn(w, "refused")).toHaveLength(0);
    expect(filesIn(w, "pending")).toHaveLength(1);
    expect(failed.head?.why).toContain(`dispose lo-${idOf(w, "alpha")}`);
    const deferred = await pass(w);
    expect(deferred.head).toMatchObject({ decision: "defer" });
    expect(deferred.head?.why).toContain("slot has not been released");
    expect(deferred.head?.why).toContain(`dispose lo-${idOf(w, "alpha")}`);
    const state = deferred.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state;
    expect(state).toMatchObject({ kind: "pending" });
    expect(state?.kind === "pending" && state.why).toContain(`dispose lo-${idOf(w, "alpha")}`);
    expect(w.port.calls).toHaveLength(1);
    expect(filesIn(w, "pending")).toHaveLength(1);
  });

  test("not-launched leaves the request pending, and the next pass settles it by what the protocol folded (G1)", async () => {
    // G13: planned and waiting-admission are DRIVEN (the protocol's
    // resumeOccurrence), never deferred for ever; reserved waits for the
    // protocol's own reconciliation.
    const expected = {
      planned: "drive",
      "waiting-admission": "drive",
      reserved: "defer",
      launching: "settled",
      "observed-running": "settled",
      "failed-before-launch": "launch",
    } as const;
    for (const [state, next] of Object.entries(expected) as [keyof typeof expected, (typeof expected)[keyof typeof expected]][]) {
      const w = passWorld(["alpha"]);
      w.port.script.push(({ request, occurrenceId, port }) => {
        port.occurrences.set(request.candidateId, occurrence(request.candidateId, { occurrenceId, state, reservationHeld: state === "reserved" || state === "launching" || state === "observed-running" }));
        return { kind: "not-launched", occurrenceId, why: "a journal write did not land" };
      });
      tap(w, "alpha");
      const first = await pass(w);
      expect(first.head).toMatchObject({ decision: "launch", outcome: "not-launched" });
      expect(filesIn(w, "pending")).toHaveLength(1);
      const second = await pass(w);
      expect({ state, decision: second.head?.decision }).toEqual({ state, decision: next });
      expect(w.port.calls).toHaveLength(next === "launch" ? 2 : 1);
      expect(w.port.drives).toHaveLength(next === "drive" ? 1 : 0);
      expect(filesIn(w, "done")).toHaveLength(next === "defer" ? 0 : 1);
    }
  });

  test("completed before verification shows ended-unverified, with how it ended (G1)", async () => {
    const w = passWorld(["alpha"]);
    tap(w, "alpha");
    await pass(w);
    w.port.set(idOf(w, "alpha"), { state: "completed", reservationHeld: false, endedAt: w.clock.now().toISOString(), completion: { kind: "exit", code: 1 } });
    const after = await pass(w);
    expect(after.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state).toMatchObject({
      kind: "ended-unverified",
      how: "it exited with code 1 before it was seen running",
    });
  });

  test("G19: a completed occurrence whose reservation is still held blocks the queue as stuck, names the dispose command on the pace line, and is needs-greg; disposing it frees the queue", async () => {
    const w = passWorld(["alpha", "beta"]);
    tap(w, "alpha");
    await pass(w);
    w.port.set(idOf(w, "alpha"), { state: "completed", reservationHeld: true, endedAt: w.clock.now().toISOString(), completion: { kind: "exit", code: 0 } });
    tap(w, "beta");
    const blocked = await pass(w);
    const dispose = `npx tsx scripts/overseer-launches.ts dispose lo-${idOf(w, "alpha")} --as not-running --why "<what you checked>"`;
    expect(blocked.head).toMatchObject({ candidateId: idOf(w, "beta"), decision: "defer" });
    expect(blocked.head?.why).toContain(dispose);
    expect(blocked.projection.pace).toMatchObject({ kind: "stuck", candidateId: idOf(w, "alpha"), state: "completed", disposeCommand: dispose });
    expect(blocked.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state).toMatchObject({ kind: "needs-greg", disposeCommand: dispose });
    expect(w.port.invocations).toBe(1);

    w.port.set(idOf(w, "alpha"), { disposed: true });
    expect((await pass(w)).head).toMatchObject({ candidateId: idOf(w, "beta"), decision: "launch", outcome: "invoked" });
  });

  test("G16: a terminal move that fails leaves the request pending AND projected, with an explicit error line, and a log line; it settles once the move can land", async () => {
    const w = passWorld(["alpha"]);
    tap(w, "alpha");
    // done/ cannot be created: a regular file stands where the directory would be.
    mkdirSync(join(w.root, RECOVERY_RESUME_DIR), { recursive: true });
    writeFileSync(join(w.root, RECOVERY_RESUME_DIR, "done"), "not a directory");
    const first = await pass(w);
    expect(first.head).toMatchObject({ decision: "launch", outcome: "invoked" });
    expect(filesIn(w, "pending")).toHaveLength(1);
    const state = first.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state;
    expect(state).toMatchObject({ kind: "pending" });
    expect(state?.kind === "pending" && state.why).toContain("could not be moved out of pending/");
    expect(w.logs.some((l) => l.includes("could not be moved out of pending/"))).toBe(true);

    // Still failing: still shown, and the launch is not repeated (the occurrence settles it).
    const second = await pass(w);
    expect(second.head).toMatchObject({ decision: "settled" });
    expect(second.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state.kind).toBe("pending");
    expect(w.port.invocations).toBe(1);

    rmSync(join(w.root, RECOVERY_RESUME_DIR, "done"));
    const third = await pass(w);
    expect(filesIn(w, "pending")).toHaveLength(0);
    expect(filesIn(w, "done")).toHaveLength(1);
    expect(third.projection.requests.find((r) => r.candidateId === idOf(w, "alpha"))?.state.kind).toBe("launched");
  });

  test("G13: a stored planned or waiting-admission occurrence is DRIVEN once the gates and revalidation pass — no replan, the attempt's offset written first; reserved is never driven; a held gate drives nothing", async () => {
    for (const state of ["planned", "waiting-admission"] as const) {
      const w = passWorld(["alpha"]);
      tap(w, "alpha");
      w.port.occurrences.set(idOf(w, "alpha"), occurrence(idOf(w, "alpha"), { state, attempt: null, reservationHeld: false }));
      // Gates held: nothing is driven.
      w.health = { verdict: { level: "critical" } };
      expect((await pass(w)).head).toMatchObject({ decision: "defer" });
      expect(w.port.drives).toEqual([]);
      // Gates clear: driven, once, through the protocol's own operation, not a new launch.
      w.health = OK_HEALTH;
      const driven = await pass(w);
      expect({ state, head: driven.head }).toMatchObject({ state, head: { decision: "drive", outcome: "invoked" } });
      expect(w.port.drives).toEqual([idOf(w, "alpha")]);
      expect(w.port.calls).toEqual([]);
      expect(markerLines(w.port.markerPath)).toHaveLength(1);
      expect(filesIn(w, "done")).toHaveLength(1);
      expect(existsSync(join(w.root, RECOVERY_RESUME_DIR, "attempts", `${idOf(w, "alpha")}.json`))).toBe(true);
    }
    const reserved = passWorld(["alpha"]);
    tap(reserved, "alpha");
    reserved.port.occurrences.set(idOf(reserved, "alpha"), occurrence(idOf(reserved, "alpha"), { state: "reserved", attempt: null, reservationHeld: true }));
    const held = await pass(reserved);
    expect(held.head).toMatchObject({ decision: "defer" });
    expect(held.head?.why).toContain("reserved");
    expect(reserved.port.drives).toEqual([]);
    expect(filesIn(reserved, "pending")).toHaveLength(1);
  });

  test("G11: a ledger row appended during the async phase moves the conversation's account — the launch is deferred, never made on the stale account, and the next pass resolves again", async () => {
    const w = passWorld(["alpha"]);
    const conversation = w.conversations.get("alpha") as string;
    const accountsDir = tempRoot();
    const accounts = ["ri-pool", "ri-other"].map((name) => {
      const stateDir = tempRoot();
      symlinkSync(w.projects, join(stateDir, "projects"));
      return { name, family: "claude", role: "pool", stateDir, providerAccountId: randomUUID(), providerTenantId: randomUUID(), addedAt: NOW_ISO, familyData: {} };
    });
    writeFileSync(join(accountsDir, "registry.json"), JSON.stringify({ schema: 1, accounts }));
    const ledgerRow = (accountName: string): string =>
      `${JSON.stringify({ schema: 1, accountName, providerAccountId: null, sessionUuid: conversation, launchName: "ri", createdAt: NOW_ISO, outcome: "started" })}\n`;
    writeFileSync(join(accountsDir, "reservations.ndjson"), ledgerRow("ri-pool"));
    w.usage = () => storedUsage([usageSection("ri-pool", 12, w.clock.ms()), usageSection("ri-other", 12, w.clock.ms())], w.clock.ms());
    const port = productionAccountPort({ accountsDir });
    tap(w, "alpha");

    const moved = await pass(w, { accounts: port, beforeRecapture: async () => appendFileSync(join(accountsDir, "reservations.ndjson"), ledgerRow("ri-other")) });
    expect(moved.head).toMatchObject({ decision: "defer" });
    expect(moved.head?.why).toContain("changed");
    expect(w.port.calls).toEqual([]);
    expect(filesIn(w, "pending")).toHaveLength(1);

    const next = await pass(w, { accounts: port });
    expect(next.head).toMatchObject({ decision: "launch", outcome: "invoked" });
    expect(w.port.calls.map((c) => c.account.name)).toEqual(["ri-other"]);
  });

  test("the done record carries what revalidation measured at launch", async () => {
    const w = passWorld(["alpha"]);
    tap(w, "alpha");
    await pass(w);
    const [done] = filesIn(w, "done");
    const body = JSON.parse(readFileSync(join(w.root, RECOVERY_RESUME_DIR, "done", done as string), "utf8"));
    expect(body).toMatchObject({ occurrenceId: `lo-${idOf(w, "alpha")}`, outcome: "invoked", launchedAt: expect.any(String) });
    expect(body.transcriptSizeAtLaunch).toBeGreaterThan(0);
    expect(body.transcriptMtimeAtLaunch).toBeGreaterThan(0);
  });
});

/** Re-exported so a mutation that loosens the gate's `onUnknown` shows up here, not only in the daemon suite. */
describe("unknown evidence holds the resume pass", () => {
  test("unknown health defers the head, with zero invocations", async () => {
    const w = passWorld(["alpha"]);
    w.health = { verdict: { level: "unknown" } };
    tap(w, "alpha");
    const result = await pass(w);
    expect(result.head).toMatchObject({ decision: "defer" });
    expect(markerLines(w.port.markerPath)).toHaveLength(0);
    expect(result.projection.gate).toMatchObject({ kind: "held" } satisfies Partial<LaunchGate>);
  });

  test("no per-account usage reading, or one for another account only, defers the head, with zero invocations", async () => {
    for (const usage of [(): StoredAccountUsage | null => null, (): StoredAccountUsage | null => storedUsage([usageSection("someone-else", 5, NOW)], NOW)]) {
      const w = passWorld(["alpha"]);
      w.usage = usage;
      tap(w, "alpha");
      const result = await pass(w);
      expect(result.head).toMatchObject({ decision: "defer" });
      expect(markerLines(w.port.markerPath)).toHaveLength(0);
    }
  });

  test("the pinned account at its 5-hour limit defers the head until the reset", async () => {
    const w = passWorld(["alpha"]);
    const resetsAtMs = NOW + 40 * 60_000;
    w.usage = () => storedUsage([usageSection("ri-pool", 100, w.clock.ms(), resetsAtMs)], w.clock.ms());
    tap(w, "alpha");
    const result = await pass(w);
    expect(result.projection.requests[0]?.state).toMatchObject({ kind: "pending", until: new Date(resetsAtMs).toISOString() });
    expect(markerLines(w.port.markerPath)).toHaveLength(0);
  });

  test("G3: a collecting dashboard that declares nothing defers the head, never refuses it, and invokes nothing", async () => {
    const w = passWorld(["alpha"]);
    tap(w, "alpha");
    const result = await pass(w, {
      observe: () => ({ inventory: trusted(w.rows), health: w.health, capabilities: [], index: indexOf([...w.records.values()]) }),
    });
    expect(result.head).toMatchObject({ decision: "defer", why: expect.stringContaining("cannot yet verify a resumed session") });
    expect(markerLines(w.port.markerPath)).toHaveLength(0);
    expect(filesIn(w, "refused")).toEqual([]);
    expect(filesIn(w, "pending")).toHaveLength(1);

    // The pair, so this is not a pass that has stopped launching anything: the same world, declared.
    const declared = passWorld(["alpha"]);
    tap(declared, "alpha");
    await pass(declared);
    expect(markerLines(declared.port.markerPath)).toHaveLength(1);
  });
});
