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
  RESUME_SPACING_MS,
  RESUME_USAGE_STALE_AFTER_MS,
  runResumePass,
  transcriptQuotes,
  verificationOf,
  type ReadRange,
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

  test("planned, waiting-admission and reserved defer with the protocol's state", () => {
    for (const state of ["planned", "waiting-admission", "reserved"] as const) {
      const decision = decide({ occurrence: occurrence(id, { state }) });
      expect(decision.kind).toBe("defer");
      if (decision.kind === "defer") expect(decision.why).toContain(state);
    }
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
    if (pace.kind !== "blocked") throw new Error("expected blocked");
    expect(pace.why).toContain(`scripts/overseer-launches.ts dispose lo-${other} --as not-running`);
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
    const result = revalidate(facts({ account: { kind: "unknown", why: "started on the default login, which gjd-remote cannot relaunch by name" } }));
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
  const after = line("assistant", "back", conversation, "2026-09-10T10:00:30.000Z");

  test("resumed, observed running, grown and a new line: verified", () => {
    const v = verificationOf(occurrence(attempt.candidateId, { state: "observed-running" }), resumed, { size: 200, mtimeMs: 2000, tail: after, tailFromStart: true }, attempt);
    expect(v).toEqual({ inventoryResumed: true, observedRunning: true, transcriptGrew: true, sessionLineSeen: true });
  });

  test("a line dated after the launch in a transcript that did not grow is not verification", () => {
    const v = verificationOf(occurrence(attempt.candidateId, { state: "observed-running" }), resumed, { size: 100, mtimeMs: 1000, tail: after, tailFromStart: true }, attempt);
    expect(v.transcriptGrew).toBe(false);
    expect(v.sessionLineSeen).toBe(true);
  });

  test("a line from before the launch, another conversation's line, a launch not seen running, a record not resumed: each missing", () => {
    const early = line("assistant", "old", conversation, "2026-09-10T09:59:00.000Z");
    const foreign = line("assistant", "other", randomUUID(), "2026-09-10T10:00:30.000Z");
    const grown = { size: 200, mtimeMs: 2000, tailFromStart: true };
    expect(verificationOf(occurrence(attempt.candidateId, { state: "observed-running" }), resumed, { ...grown, tail: early + foreign }, attempt).sessionLineSeen).toBe(false);
    expect(verificationOf(occurrence(attempt.candidateId, { state: "launching" }), resumed, { ...grown, tail: after }, attempt).observedRunning).toBe(false);
    expect(verificationOf(occurrence(attempt.candidateId, { state: "observed-running" }), record(conversation, "/srv/v"), { ...grown, tail: after }, attempt).inventoryResumed).toBe(false);
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
    expect(resolved).toEqual({ kind: "pinned", name: "ri-pool", configDir: w.stateDir });
  });

  test("no ledger row is the default login; a transcript under another root is not that account's", async () => {
    const w = world();
    const port = productionAccountPort({ accountsDir: w.accountsDir });
    const none = await port.resolve({ conversationId: randomUUID(), transcriptPath: "", transcriptRoot: realpathSync(w.projects) });
    expect(none).toEqual({ kind: "unknown", why: "started on the default login, which gjd-remote cannot relaunch by name" });
    const elsewhere = await port.resolve({ conversationId: w.conversation, transcriptPath: "", transcriptRoot: realpathSync(tempRoot()) });
    expect(elsewhere.kind === "unknown" && elsewhere.why).toContain("not under the account ri-pool's own projects directory");
  });

  test("the port reads no quota and so makes no network call: the quota is the daemon's stored per-account reading", () => {
    const w = world();
    expect(Object.keys(productionAccountPort({ accountsDir: w.accountsDir }))).toEqual(["resolve"]);
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

async function pass(w: PassWorld, extra: { beforeRecapture?: () => Promise<void>; observe?: () => ResumeObservation } = {}) {
  return runResumePass({
    root: w.root,
    now: w.clock.now,
    log: (l) => w.logs.push(l),
    port: w.port,
    accounts: fakeAccounts(),
    accountUsage: () => w.usage(),
    evidence: evidenceDeps({ projectsDir: w.projects }),
    observe: extra.observe ?? (() => ({ inventory: trusted(w.rows), health: w.health, index: indexOf([...w.records.values()]) })),
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

describe("the pass (G1, G2, G8), with a fake launch port", () => {
  test("a live resumed process whose transcript does not grow stays unverified and blocks the next request, visibly (G2)", async () => {
    const w = passWorld(["alpha", "beta"]);
    // A line dated AFTER the launch that is to come, already in the file
    // before it: a future-stamped line is not growth.
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
    expect(alphaState).toMatchObject({ kind: "launched", verification: { inventoryResumed: true, observedRunning: true, transcriptGrew: false, sessionLineSeen: true } });
    expect(second.projection.pace).toMatchObject({ kind: "waiting-for-verification", candidateId: idOf(w, "alpha") });

    // It grows: verified, then two minutes of spacing, then beta.
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

  test("retry after a released failed-before-launch: refused, then a re-tap launches attempt 2 (G1)", async () => {
    const w = passWorld(["alpha"]);
    w.port.script.push(({ request, occurrenceId, attempt, port }) => {
      port.occurrences.set(request.candidateId, occurrence(request.candidateId, { occurrenceId, state: "failed-before-launch", attempt, reservationHeld: false }));
      return { kind: "failed-before-launch", occurrenceId, proof: "launcher-refused", why: "the launcher refused", reservation: { kind: "released" } };
    });
    tap(w, "alpha");
    await pass(w);
    expect(filesIn(w, "refused")).toHaveLength(1);
    expect(w.port.invocations).toBe(0);
    tap(w, "alpha");
    const retried = await pass(w);
    expect(retried.head).toMatchObject({ decision: "launch", outcome: "invoked" });
    expect(markerLines(w.port.markerPath)).toEqual([expect.objectContaining({ candidateId: idOf(w, "alpha"), attempt: 2 })]);
    expect(w.port.calls).toHaveLength(2);
  });

  test("a held release defers the re-tap, and nothing is asked of the launcher (G1)", async () => {
    const w = passWorld(["alpha"]);
    w.port.script.push(({ request, occurrenceId, attempt, port }) => {
      port.occurrences.set(request.candidateId, occurrence(request.candidateId, { occurrenceId, state: "failed-before-launch", attempt, reservationHeld: true }));
      return { kind: "failed-before-launch", occurrenceId, proof: "launcher-refused", why: "refused", reservation: { kind: "held", why: "the owner did not answer" } };
    });
    tap(w, "alpha");
    await pass(w);
    tap(w, "alpha");
    const deferred = await pass(w);
    expect(deferred.head).toMatchObject({ decision: "defer" });
    expect(deferred.head?.why).toContain("slot has not been released");
    expect(w.port.calls).toHaveLength(1);
    expect(filesIn(w, "pending")).toHaveLength(1);
  });

  test("not-launched leaves the request pending, and the next pass settles it by what the protocol folded (G1)", async () => {
    const expected = {
      planned: "defer",
      "waiting-admission": "defer",
      reserved: "defer",
      launching: "settled",
      "observed-running": "settled",
      "failed-before-launch": "launch",
    } as const;
    for (const [state, next] of Object.entries(expected) as [keyof typeof expected, (typeof expected)[keyof typeof expected]][]) {
      const w = passWorld(["alpha"]);
      w.port.script.push(({ request, occurrenceId, port }) => {
        port.occurrences.set(request.candidateId, occurrence(request.candidateId, { occurrenceId, state, reservationHeld: state !== "failed-before-launch" }));
        return { kind: "not-launched", occurrenceId, why: "a journal write did not land" };
      });
      tap(w, "alpha");
      const first = await pass(w);
      expect(first.head).toMatchObject({ decision: "launch", outcome: "not-launched" });
      expect(filesIn(w, "pending")).toHaveLength(1);
      const second = await pass(w);
      expect({ state, decision: second.head?.decision }).toEqual({ state, decision: next });
      expect(w.port.calls).toHaveLength(next === "launch" ? 2 : 1);
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
});
