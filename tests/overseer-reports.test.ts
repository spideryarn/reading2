/**
 * **Work reports: the parsers, the drain, the fold and the three read arms.**
 *
 * Plan 260910e, Stage 1. The drain is the part with a protocol — four steps, a
 * frozen `processing/` file between the first and the rest — so most of what is
 * here is about what a crash, a duplicate, a hostile inbox entry or a missing log
 * must NOT turn into. Every uuid is minted per run: `tests/fixture-ids.test.ts`
 * fails the suite on a literal shared between files.
 */
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ArtefactCheck, ArtefactRef } from "../tools/fleet/artefact-ref.js";
import {
  DECISIONS_FILE,
  DECISIONS_LOCK_FILE,
  appendEvents,
  envelope,
  parseEventDetailed,
  readDecisions,
} from "../tools/overseer/decisions.js";
import type { SessionKey, StatusKey } from "../tools/overseer/diff.js";
import { releaseLock, takeLock } from "../tools/overseer/lock.js";
import { makeArtefactChecker } from "../tools/overseer/report-artefacts.js";
import { MAX_ANCESTRY_STEPS, observeOwnExecution } from "../tools/overseer/report-identity.js";
import {
  INBOX_DIR,
  MAX_SUBMISSION_BYTES,
  PROCESSING_DIR,
  QUARANTINE_DIR,
  REFUSED_DIR,
  REPORTS_FILE,
  REPORTS_INIT_FILE,
  SimulatedCrash,
  drainReports,
  foldReports,
  parseReportEvent,
  parseSubmission,
  readInbox,
  readReports,
  serializeSubmission,
  submitReport,
  type DrainBoundary,
  type DrainOptions,
  type ReportEvent,
  type ReportSubmission,
} from "../tools/overseer/reports.js";
import type { RegisterEntry, SessionRegister } from "../tools/overseer/store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-reports-"));
  roots.push(root);
  return root;
}

const BELL = String.fromCharCode(7);
const RLO = String.fromCharCode(0x202e);
const TOKEN_A = "boot-aaaa:4242:1000";
const TOKEN_B = "boot-aaaa:4343:2000";
const FIRST_NOW = new Date("2026-09-10T12:00:00.000Z");
const LATER_NOW = new Date("2026-09-10T13:30:00.000Z");

function submission(over: Partial<Record<string, unknown>> = {}): ReportSubmission {
  const base = {
    schema: 1,
    eventId: randomUUID(),
    submittedAt: "2026-09-10T11:59:00.000Z",
    kind: "progress",
    actor: { kind: "session", name: "work-reports" },
    observedExecution: TOKEN_A,
    job: { plan: "docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md", queueItem: null, occurrence: null },
    summary: "stage 1 tests written, red as expected",
    artefacts: [],
    corrects: null,
    ...over,
  };
  return base as unknown as ReportSubmission;
}

function entry(name: string, token: string | null): RegisterEntry {
  const at = "2026-09-10T10:00:00.000Z";
  return {
    key: `$9 name:${name}` as SessionKey,
    tmuxId: "$9",
    claimedConversationId: null,
    name,
    meta: { version: "legacy" },
    repo: null,
    worktree: null,
    startedAt: at,
    paneId: null,
    panePid: null,
    tmuxServerPid: null,
    lastSeenAlive: at,
    lastStatusKey: "idle" as StatusKey,
    statusSince: { kind: "observed", at },
    verifiedExecution: token === null ? null : { token, since: at },
  };
}

function register(...entries: RegisterEntry[]): SessionRegister {
  return new Map(entries.map((e, i) => [`${e.key}#${i}` as SessionKey, e]));
}

type Checker = { calls: ArtefactRef[]; check: (ref: ArtefactRef) => ArtefactCheck };

function checker(answer: (ref: ArtefactRef) => ArtefactCheck = () => ({ state: "on-dev" })): Checker {
  const calls: ArtefactRef[] = [];
  return {
    calls,
    check: (ref) => {
      calls.push(ref);
      return answer(ref);
    },
  };
}

function options(root: string, over: Partial<DrainOptions> = {}): DrainOptions {
  return {
    root,
    register: register(entry("work-reports", TOKEN_A)),
    now: () => FIRST_NOW,
    checkArtefact: checker().check,
    // A fresh directory per call unless a test names one: nothing here may reach ~/.overseer.
    decisionsRoot: tempRoot(),
    ...over,
  };
}

/** A draft in `overseer-decisions template`'s shape, minus author and evidence. */
function draft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    class: "decision",
    question: "Which shape should the drain's decision step use?",
    options: [
      { name: "Small", tradeoffs: "One append, frozen bytes." },
      { name: "General", tradeoffs: "A second log for sessions." },
    ],
    chose: { option: "Small", note: null },
    why: "Two logs would be two answers to what was decided.",
    advisers: ["nobody"],
    bearsOn: { sessions: ["work-reports"], plan: null },
    supersedes: null,
    consequence: "medium",
    reversibility: "costly",
    domain: "technical",
    recommendation: null,
    gregAsked: "no",
    confidence: null,
    ...over,
  };
}

function decisionSubmission(over: Partial<Record<string, unknown>> = {}, draftOver: Record<string, unknown> = {}): ReportSubmission {
  return submission({ kind: "decision", summary: "chose the small shape", draft: draft(draftOver), ...over });
}

function decisionsIn(dir: string) {
  const read = readDecisions(dir);
  if (read.kind !== "decisions") throw new Error(`expected decisions, got ${read.kind}${read.kind === "unreadable" ? `: ${read.why}` : ""}`);
  return read.view;
}

function decisionLines(dir: string): string[] {
  const file = join(dir, DECISIONS_FILE);
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "") : [];
}

const VERIFIED_A = { kind: "verified", token: TOKEN_A, since: "2026-09-10T10:00:00.000Z" };

function rows(root: string) {
  const read = readReports(root);
  if (read.kind !== "reports") throw new Error(`expected reports, got ${read.kind}${read.kind === "unreadable" ? `: ${read.why}` : ""}`);
  return read.view;
}

function drop(root: string, name: string, text: string): string {
  mkdirSync(join(root, INBOX_DIR), { recursive: true });
  const path = join(root, INBOX_DIR, name);
  writeFileSync(path, text);
  return path;
}

function listed(root: string, dir: string): string[] {
  const path = join(root, dir);
  return existsSync(path) ? readdirSync(path).filter((name) => !name.startsWith(".tmp-")) : [];
}

/* ------------------------------------------------------------------ *
 * The parsers.
 * ------------------------------------------------------------------ */

describe("parseSubmission is strict", () => {
  test("a valid submission round-trips through its canonical form", () => {
    const s = submission();
    const parsed = parseSubmission(serializeSubmission(s));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.submission).toEqual(s);
  });

  test("an unknown kind is refused, naming the kind", () => {
    const parsed = parseSubmission(JSON.stringify({ ...submission(), kind: "ready" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.why).toMatch(/kind/);
  });

  test("nothing is defaulted: an absent field is refused, and so is an extra one", () => {
    const { corrects: _dropped, ...missing } = submission() as unknown as Record<string, unknown>;
    const a = parseSubmission(JSON.stringify(missing));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.why).toMatch(/corrects/);
    const b = parseSubmission(JSON.stringify({ ...submission(), grants: "everything" }));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.why).toMatch(/grants/);
  });

  const bad: Array<[string, string]> = [
    ["a control character", `ring${BELL}`],
    ["a bidi override", `abc${RLO}fed`],
  ];
  const fieldCases: Array<{ field: RegExp; make: (text: string) => ReportSubmission; oversize: string }> = [
    { field: /summary/, make: (text) => submission({ summary: text }), oversize: "x".repeat(1001) },
    {
      field: /needs/,
      make: (text) => submission({ kind: "blocked", on: "greg", needs: text }),
      oversize: "x".repeat(501),
    },
    {
      field: /job\.plan/,
      make: (text) => submission({ job: { plan: `docs/${text}.md`, queueItem: null, occurrence: null } }),
      oversize: "a".repeat(301),
    },
    {
      field: /revisions\.reviewed\[0\]/,
      make: (text) =>
        submission({
          kind: "completed",
          ending: "finished",
          revisions: { reviewed: [`abc1234${text}`], tested: [], merged: [] },
        }),
      oversize: "a".repeat(41),
    },
  ];
  for (const { field, make, oversize } of fieldCases) {
    for (const [what, text] of bad) {
      test(`${what} in ${field.source} is refused, naming the field`, () => {
        const parsed = parseSubmission(JSON.stringify(make(text)));
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.why).toMatch(field);
      });
    }
    test(`an oversized ${field.source} is refused, naming the field`, () => {
      const parsed = parseSubmission(JSON.stringify(make(oversize)));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.why).toMatch(field);
    });
  }

  test("a path artefact outside the repository is refused", () => {
    for (const path of ["../x", "/etc/passwd"]) {
      const parsed = parseSubmission(JSON.stringify(submission({ artefacts: [{ kind: "path", path }] })));
      expect(parsed.ok, path).toBe(false);
      if (!parsed.ok) expect(parsed.why).toMatch(/artefacts\[0\]/);
    }
  });

  test("a report cannot correct itself", () => {
    const s = submission();
    const parsed = parseSubmission(JSON.stringify({ ...s, corrects: s.eventId }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.why).toMatch(/corrects/);
  });

  test("a malformed observed execution and a bad session name are refused", () => {
    const a = parseSubmission(JSON.stringify(submission({ observedExecution: "boot:1:01" })));
    expect(a.ok).toBe(false);
    const b = parseSubmission(JSON.stringify(submission({ actor: { kind: "session", name: "has space" } })));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.why).toMatch(/actor/);
  });
});

/* ------------------------------------------------------------------ *
 * The drain.
 * ------------------------------------------------------------------ */

describe("the drain records a submission once", () => {
  test("submit, drain: one row, stamped by the daemon, and the inbox is empty", () => {
    const root = tempRoot();
    const s = submission({ artefacts: [{ kind: "commit", sha: "abc1234" }] });
    const path = submitReport(root, s);
    expect(path).toBe(join(root, INBOX_DIR, `${s.eventId}.json`));

    const outcome = drainReports(options(root));
    expect(outcome.recorded).toBe(1);
    const view = rows(root);
    expect(view.rows).toHaveLength(1);
    const event = view.rows[0]?.event;
    expect(event?.receivedAt).toBe(FIRST_NOW.toISOString());
    expect(event?.execution).toBe("same-verified-run");
    expect(event?.artefacts).toEqual([{ ref: { kind: "commit", sha: "abc1234" }, check: { state: "on-dev" } }]);
    expect(listed(root, INBOX_DIR)).toEqual([]);
    expect(listed(root, PROCESSING_DIR)).toEqual([]);
    expect(existsSync(join(root, REPORTS_INIT_FILE))).toBe(true);
  });

  test("the same submission dropped twice is one row", () => {
    const root = tempRoot();
    const s = submission();
    submitReport(root, s);
    drainReports(options(root));
    submitReport(root, s);
    const second = drainReports(options(root, { now: () => LATER_NOW }));
    expect(second.duplicates).toBe(1);
    expect(second.refused).toBe(0);
    expect(rows(root).rows).toHaveLength(1);
    expect(listed(root, INBOX_DIR)).toEqual([]);
  });

  test("the same event id with other bytes is refused, and listed as refused", () => {
    const root = tempRoot();
    const s = submission();
    submitReport(root, s);
    drainReports(options(root));
    submitReport(root, { ...s, summary: "a different claim under the same id" });
    const second = drainReports(options(root));
    expect(second.refused).toBe(1);
    expect(rows(root).rows).toHaveLength(1);
    expect(rows(root).rows[0]?.event.summary).toBe(s.summary);
    const inbox = readInbox(root);
    expect(inbox.refused.items.map((r) => r.eventId)).toEqual([s.eventId]);
    expect(inbox.refused.items[0]?.why).toMatch(/already recorded/);
  });
});

describe("execution is compared by token", () => {
  function recordedExecution(reg: SessionRegister, over: Partial<Record<string, unknown>> = {}): ReportEvent["execution"] {
    const root = tempRoot();
    submitReport(root, submission(over));
    drainReports(options(root, { register: reg }));
    const [row] = rows(root).rows;
    // Not `?? "missing"`: null is a legitimate answer here and must survive.
    if (row === undefined) throw new Error("nothing was recorded");
    return row.event.execution;
  }

  test("an equal token is the same verified run", () => {
    expect(recordedExecution(register(entry("work-reports", TOKEN_A)))).toBe("same-verified-run");
  });

  test("a different token is a different verified run — kept, and labelled", () => {
    expect(recordedExecution(register(entry("work-reports", TOKEN_B)))).toBe("different-verified-run");
  });

  test("no observed token is unverifiable, with the reason", () => {
    const got = recordedExecution(register(entry("work-reports", TOKEN_A)), { observedExecution: null });
    expect(got).toEqual({ unverifiable: expect.stringMatching(/could not observe/) });
  });

  test("a name the register does not hold is unverifiable, with the reason", () => {
    const got = recordedExecution(register(entry("someone-else", TOKEN_A)));
    expect(got).toEqual({ unverifiable: expect.stringMatching(/no session named work-reports/) });
  });

  test("a register entry never verified is unverifiable, with the reason", () => {
    const got = recordedExecution(register(entry("work-reports", null)));
    expect(got).toEqual({ unverifiable: expect.stringMatching(/never verified/) });
  });

  test("the Overseer or Greg as actor has no comparison at all", () => {
    expect(recordedExecution(register(entry("work-reports", TOKEN_A)), { actor: { kind: "overseer" } })).toBeNull();
    expect(recordedExecution(register(entry("work-reports", TOKEN_A)), { actor: { kind: "greg" } })).toBeNull();
  });
});

describe("invalid input dropped by hand is refused, not recorded", () => {
  test("an unknown kind `ready` dropped into the inbox is refused", () => {
    const root = tempRoot();
    const s = submission();
    drop(root, `${s.eventId}.json`, JSON.stringify({ ...s, kind: "ready" }));
    const outcome = drainReports(options(root));
    expect(outcome.refused).toBe(1);
    expect(readReports(root).kind).toBe("never-written");
    const refused = readInbox(root).refused.items;
    expect(refused[0]?.why).toMatch(/kind/);
    const stored = JSON.parse(readFileSync(join(root, REFUSED_DIR, `${s.eventId}.json`), "utf8")) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["eventId", "original", "refusedAt", "why"]);
    expect(stored["original"]).toContain("ready");
  });

});

describe("a session's decision goes into the decision record, and the report points at it", () => {
  test("it lands in both logs joined by report:<eventId>, recorded by the daemon, authored by the session, pending review", () => {
    const root = tempRoot();
    const dir = tempRoot();
    const s = decisionSubmission();
    submitReport(root, s);
    const outcome = drainReports(options(root, { decisionsRoot: dir }));
    expect(outcome.recorded).toBe(1);
    expect(outcome.refused).toBe(0);

    const report = rows(root).rows[0]?.event;
    if (report?.kind !== "decision") throw new Error(`expected a decision report, got ${report?.kind}`);
    const view = decisionsIn(dir);
    expect(view.problems).toEqual([]);
    expect(view.records).toHaveLength(1);
    const record = view.records[0];
    expect(record?.id).toBe(report.decisionId);
    const lines = decisionLines(dir);
    expect(lines).toHaveLength(1);
    const raw = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(raw["commandId"]).toBe(`report:${s.eventId}`);
    expect(raw["by"]).toBe("daemon");
    expect(record?.recordedBy).toBe("daemon");
    expect(record?.author).toEqual({ kind: "session", name: "work-reports", execution: VERIFIED_A });
    expect(record?.bearsOn.sessions).toEqual([{ name: "work-reports", execution: VERIFIED_A }]);
    expect(record?.decidedAt).toBe(FIRST_NOW.toISOString());
    expect(record?.question).toBe(draft()["question"]);
    // Pending review: nothing a session says reviews it.
    expect(record?.reviewed).toBe(false);
    expect(record?.reversed).toBe(false);
    // The report carries the id and nothing of the decision's content.
    expect(readFileSync(join(root, REPORTS_FILE), "utf8")).not.toContain(String(draft()["question"]));
    expect(listed(root, INBOX_DIR)).toEqual([]);
    expect(listed(root, PROCESSING_DIR)).toEqual([]);
  });

  test("the decision's evidence checks are the report's artefact checks, one probe each", () => {
    const root = tempRoot();
    const dir = tempRoot();
    const probes = checker((ref) => (ref.kind === "commit" ? { state: "on-dev" } : { state: "not-found" }));
    submitReport(root, decisionSubmission({ artefacts: [{ kind: "commit", sha: "abc1234" }, { kind: "path", path: "package.json" }] }));
    drainReports(options(root, { decisionsRoot: dir, checkArtefact: probes.check }));
    const report = rows(root).rows[0]?.event;
    expect(report?.artefacts.map((item) => item.check)).toEqual([{ state: "on-dev" }, { state: "not-found" }]);
    expect(decisionsIn(dir).records[0]?.evidence).toEqual({ kind: "recorded", value: report?.artefacts });
    expect(probes.calls).toHaveLength(2);
  });

  const boundaries: DrainBoundary[] = ["processing-written", "decision-appended", "reports-appended", "processing-unlinked"];
  for (const boundary of boundaries) {
    test(`crash after ${boundary}: one decision and one report, from the first attempt's frozen bytes`, () => {
      const root = tempRoot();
      const dir = tempRoot();
      submitReport(root, decisionSubmission({ artefacts: [{ kind: "path", path: "package.json" }] }));
      expect(() =>
        drainReports(options(root, { decisionsRoot: dir, crashAt: boundary, checkArtefact: checker(() => ({ state: "found-locally" })).check })),
      ).toThrow(SimulatedCrash);

      // The world has moved on: a later clock, a replaced run, a file now on dev.
      drainReports(
        options(root, {
          decisionsRoot: dir,
          now: () => LATER_NOW,
          register: register(entry("work-reports", TOKEN_B)),
          checkArtefact: checker(() => ({ state: "on-dev" })).check,
        }),
      );
      expect(decisionLines(dir)).toHaveLength(1);
      const view = decisionsIn(dir);
      expect(view.problems).toEqual([]);
      const record = view.records[0];
      const reports = rows(root);
      expect(reports.rows).toHaveLength(1);
      expect(reports.problems).toEqual([]);
      const report = reports.rows[0]?.event;
      expect(report?.kind === "decision" ? report.decisionId : null).toBe(record?.id);
      expect(report?.receivedAt).toBe(FIRST_NOW.toISOString());
      expect(record?.decidedAt).toBe(FIRST_NOW.toISOString());
      expect(record?.author).toEqual({ kind: "session", name: "work-reports", execution: VERIFIED_A });
      expect(record?.evidence).toEqual({ kind: "recorded", value: [{ ref: { kind: "path", path: "package.json" }, check: { state: "found-locally" } }] });
      expect(listed(root, INBOX_DIR)).toEqual([]);
      expect(listed(root, PROCESSING_DIR)).toEqual([]);
      // A leftover inbox copy of a recorded decision is the same claim, not a refusal.
      expect(readInbox(root).refused.items).toEqual([]);
    });
  }

  test("the decisions lock held: pending, nothing written to either log, later reports not starved", () => {
    const root = tempRoot();
    const dir = tempRoot();
    const lockPath = join(dir, DECISIONS_LOCK_FILE);
    const held = takeLock(lockPath, () => new Date());
    if (!held.ok) throw new Error("could not take the decisions lock for the test");
    const s = decisionSubmission();
    const other = submission({ summary: "a progress report behind the decision" });
    try {
      submitReport(root, s);
      submitReport(root, other);
      const outcome = drainReports(options(root, { decisionsRoot: dir }));
      expect(outcome.pending).toBe(1);
      expect(outcome.refused).toBe(0);
      expect(outcome.recorded).toBe(1);
      expect(outcome.notes.join("\n")).toMatch(new RegExp(`pending ${s.eventId}`));
      expect(existsSync(join(dir, DECISIONS_FILE))).toBe(false);
      expect(rows(root).rows.map((row) => row.event.eventId)).toEqual([other.eventId]);
      expect(listed(root, INBOX_DIR)).toEqual([`${s.eventId}.json`]);
    } finally {
      releaseLock(held.lock, lockPath);
    }
    const after = drainReports(options(root, { decisionsRoot: dir }));
    expect(after.replayed).toBe(1);
    expect(decisionLines(dir)).toHaveLength(1);
    expect(rows(root).rows.map((row) => row.event.eventId)).toEqual([other.eventId, s.eventId]);
  });

  test("a decision submitted as the Overseer or Greg is refused: they use overseer-decisions add", () => {
    for (const actor of [{ kind: "overseer" }, { kind: "greg" }]) {
      const s = decisionSubmission({ actor, observedExecution: null });
      const parsed = parseSubmission(JSON.stringify(s));
      expect(parsed.ok).toBe(false);
      expect(parsed.ok ? "" : parsed.why).toMatch(/overseer-decisions add/);

      // Dropped by hand, past the CLI: the drain refuses it the same way.
      const root = tempRoot();
      const dir = tempRoot();
      drop(root, `${s.eventId}.json`, JSON.stringify(s));
      const outcome = drainReports(options(root, { decisionsRoot: dir }));
      expect(outcome.refused).toBe(1);
      expect(readInbox(root).refused.items[0]?.why).toMatch(/overseer-decisions add/);
      expect(existsSync(join(dir, DECISIONS_FILE))).toBe(false);
    }
  });

  test("a bad draft is refused naming the field, by the one parser", () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ question: "" }, /question/],
      [{ why: `ring${BELL}` }, /why/],
      [{ chose: { option: "Neither", note: null } }, /chose/],
      [{ consequence: "enormous" }, /consequence/],
      [{ bearsOn: { sessions: ["no spaces allowed"], plan: null } }, /bearsOn/],
      [{ author: { kind: "greg" } }, /author/],
      [{ evidence: ["commit:abc1234"] }, /evidence.*--artefact/],
      [{ ready: true }, /draft/],
    ];
    for (const [over, why] of cases) {
      const parsed = parseSubmission(JSON.stringify(decisionSubmission({}, over)));
      expect(parsed.ok, JSON.stringify(over)).toBe(false);
      expect(parsed.ok ? "" : parsed.why, JSON.stringify(over)).toMatch(why);
    }
    expect(parseSubmission(JSON.stringify(decisionSubmission())).ok).toBe(true);
  });

  test("a decision the record would refuse is refused with the record's reason, and nothing more is written", () => {
    const root = tempRoot();
    const dir = tempRoot();
    const s = decisionSubmission();
    // Another decision already holds this report's command id, with other content.
    const prior = parseEventDetailed(
      JSON.stringify({
        ...envelope("daemon", { commandId: `report:${s.eventId}` }),
        kind: "decided",
        id: "dec-33333333",
        decidedAt: FIRST_NOW.toISOString(),
        ...draft({ question: "A different question under the same command id?" }),
        bearsOn: { sessions: [], plan: null },
        author: { kind: "session", name: "work-reports", execution: { kind: "not-found" } },
        evidence: [],
      }),
    );
    if (!prior.ok) throw new Error(prior.why);
    expect(appendEvents([prior.event], { root: dir }).ok).toBe(true);

    submitReport(root, s);
    const outcome = drainReports(options(root, { decisionsRoot: dir }));
    expect(outcome.refused).toBe(1);
    expect(readInbox(root).refused.items[0]?.why).toMatch(/command-conflict/);
    expect(decisionLines(dir)).toHaveLength(1);
    expect(readReports(root).kind).toBe("never-written");
    expect(listed(root, PROCESSING_DIR)).toEqual([]);
    expect(listed(root, INBOX_DIR)).toEqual([]);
  });

  test("a decision re-dropped after it was recorded is a duplicate; changed under the same id it is refused", () => {
    const root = tempRoot();
    const dir = tempRoot();
    const s = decisionSubmission();
    submitReport(root, s);
    drainReports(options(root, { decisionsRoot: dir }));
    drop(root, `${s.eventId}.json`, serializeSubmission(s));
    const again = drainReports(options(root, { decisionsRoot: dir }));
    expect(again.duplicates).toBe(1);
    expect(again.refused).toBe(0);
    const changed = decisionSubmission({ eventId: s.eventId }, { question: "A different question after the fact?" });
    drop(root, `${s.eventId}.json`, serializeSubmission(changed));
    const conflicting = drainReports(options(root, { decisionsRoot: dir }));
    expect(conflicting.refused).toBe(1);
    expect(readInbox(root).refused.items[0]?.why).toMatch(/different content/);
    expect(decisionLines(dir)).toHaveLength(1);
    expect(rows(root).rows).toHaveLength(1);
  });
});

describe("artefacts are checked, not trusted, and not refused", () => {
  test("a commit the checker cannot find is kept as not-found", () => {
    const root = tempRoot();
    submitReport(root, submission({ artefacts: [{ kind: "commit", sha: "0123456789abcdef0123456789abcdef01234567" }] }));
    drainReports(options(root, { checkArtefact: checker(() => ({ state: "not-found" })).check }));
    expect(rows(root).rows[0]?.event.artefacts[0]?.check).toEqual({ state: "not-found" });
  });
});

describe("corrections are explicit", () => {
  test("an explicit correction keeps both rows and marks the earlier one", () => {
    const root = tempRoot();
    const first = submission({ kind: "completed", ending: "finished", revisions: { reviewed: [], tested: [], merged: [] } });
    submitReport(root, first);
    drainReports(options(root));
    const second = submission({ summary: "not finished after all: the drain leaks", corrects: first.eventId });
    submitReport(root, second);
    drainReports(options(root, { now: () => LATER_NOW }));

    const view = rows(root);
    expect(view.problems).toEqual([]);
    expect(view.rows).toHaveLength(2);
    expect(view.rows[0]?.event.summary).toBe(first.summary);
    expect(view.rows[0]?.correctedBy).toEqual({
      eventId: second.eventId,
      actor: { kind: "session", name: "work-reports" },
      at: LATER_NOW.toISOString(),
    });
    expect(view.rows[1]?.correctedBy).toBeNull();
  });

  test("a correction naming an unknown event is refused", () => {
    const root = tempRoot();
    submitReport(root, submission({ corrects: randomUUID() }));
    const outcome = drainReports(options(root));
    expect(outcome.refused).toBe(1);
    expect(readInbox(root).refused.items[0]?.why).toMatch(/corrects/);
  });

  test("completed then progress without `corrects` are both kept, and neither is marked", () => {
    const root = tempRoot();
    submitReport(root, submission({ kind: "completed", ending: "important-work-left", revisions: { reviewed: [], tested: [], merged: [] } }));
    drainReports(options(root));
    submitReport(root, submission({ summary: "picked it up again" }));
    drainReports(options(root));
    const view = rows(root);
    expect(view.rows.map((r) => r.event.kind)).toEqual(["completed", "progress"]);
    expect(view.rows.every((r) => r.correctedBy === null)).toBe(true);
    expect(view.problems).toEqual([]);
  });

  test("the fold names a correction of a later, an unknown or the same event", () => {
    const root = tempRoot();
    const a = submission();
    submitReport(root, a);
    drainReports(options(root));
    const b = submission({ corrects: a.eventId });
    submitReport(root, b);
    drainReports(options(root));
    const [ea, eb] = rows(root).rows.map((r) => r.event);
    if (ea === undefined || eb === undefined) throw new Error("expected two events");

    const later = foldReports([eb, ea]);
    expect(later.problems.map((p) => p.why).join(" ")).toMatch(/after/);
    expect(later.rows.every((r) => r.correctedBy === null)).toBe(true);

    const unknown = foldReports([eb]);
    expect(unknown.problems.map((p) => p.why).join(" ")).toMatch(/not in this record/);

    const self = foldReports([{ ...ea, corrects: ea.eventId }]);
    expect(self.problems.map((p) => p.why).join(" ")).toMatch(/itself/);
  });

  test("the fold names the same event id twice with other bytes", () => {
    const root = tempRoot();
    submitReport(root, submission());
    drainReports(options(root));
    const [event] = rows(root).rows.map((r) => r.event);
    if (event === undefined) throw new Error("expected an event");
    const view = foldReports([event, { ...event, summary: "rewritten" }]);
    expect(view.rows).toHaveLength(1);
    expect(view.problems.map((p) => p.kind)).toEqual(["duplicate-event"]);
    expect(foldReports([event, event]).problems).toEqual([]);
  });
});

describe("a crash at each step boundary replays the frozen bytes", () => {
  const boundaries: DrainBoundary[] = ["processing-written", "reports-appended", "processing-unlinked"];
  for (const boundary of boundaries) {
    test(`crash after ${boundary}: exactly one row, and the enrichment is the first attempt's`, () => {
      const root = tempRoot();
      submitReport(root, submission({ artefacts: [{ kind: "path", path: "package.json" }] }));
      expect(() =>
        drainReports(options(root, { crashAt: boundary, checkArtefact: checker(() => ({ state: "found-locally" })).check })),
      ).toThrow(SimulatedCrash);

      // The world has moved on: a later clock, a replaced run, a file now on dev.
      drainReports(
        options(root, {
          now: () => LATER_NOW,
          register: register(entry("work-reports", TOKEN_B)),
          checkArtefact: checker(() => ({ state: "on-dev" })).check,
        }),
      );
      const view = rows(root);
      expect(view.rows).toHaveLength(1);
      expect(view.problems).toEqual([]);
      const event = view.rows[0]?.event;
      expect(event?.receivedAt).toBe(FIRST_NOW.toISOString());
      expect(event?.execution).toBe("same-verified-run");
      expect(event?.artefacts[0]?.check).toEqual({ state: "found-locally" });
      expect(listed(root, INBOX_DIR)).toEqual([]);
      expect(listed(root, PROCESSING_DIR)).toEqual([]);
    });
  }
});

describe("bounds per pass", () => {
  test("a backlog of 120 while the daemon was down drains over three passes, oldest first", () => {
    const root = tempRoot();
    const base = Date.parse("2026-09-10T09:00:00.000Z") / 1000;
    const order: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      const s = submission({ summary: `backlog item ${i}` });
      const path = submitReport(root, s);
      // mtime, not the name, is the order: a uuid name sorts at random.
      utimesSync(path, base + i, base + i);
      order.push(s.eventId);
    }
    const passes = [drainReports(options(root)), drainReports(options(root)), drainReports(options(root))];
    expect(passes.map((p) => p.recorded)).toEqual([50, 50, 20]);
    expect(passes[0]?.deferred).toBe(70);
    expect(passes[0]?.stoppedBy).toBe("files");
    const view = rows(root);
    expect(view.rows.map((r) => r.event.eventId)).toEqual(order);
    expect(listed(root, INBOX_DIR)).toEqual([]);
  });

  test("the byte and probe limits hold per pass, and nothing is lost", () => {
    const root = tempRoot();
    for (let i = 0; i < 10; i += 1) {
      submitReport(
        root,
        submission({
          summary: `probe item ${i}`,
          artefacts: [
            { kind: "commit", sha: "abc1234" },
            { kind: "path", path: "package.json" },
            { kind: "queue-item", id: "qi-22222222" },
          ],
        }),
      );
    }
    const probes = checker(() => ({ state: "not-found" }));
    let recorded = 0;
    for (let pass = 0; pass < 10 && recorded < 10; pass += 1) {
      const before = probes.calls.length;
      const outcome = drainReports(options(root, { checkArtefact: probes.check, limits: { probes: 7 } }));
      expect(probes.calls.length - before).toBeLessThanOrEqual(7);
      expect(outcome.probes).toBeLessThanOrEqual(7);
      recorded += outcome.recorded;
    }
    expect(recorded).toBe(10);

    const bytesRoot = tempRoot();
    let size = 0;
    for (let i = 0; i < 6; i += 1) size = readFileSync(submitReport(bytesRoot, submission({ summary: `bytes ${i}` }))).length;
    const limit = size * 2 + 10;
    let total = 0;
    for (let pass = 0; pass < 6 && total < 6; pass += 1) {
      const outcome = drainReports(options(bytesRoot, { limits: { bytes: limit } }));
      expect(outcome.bytesRead).toBeLessThanOrEqual(limit);
      total += outcome.recorded;
    }
    expect(total).toBe(6);
  });

  test("the wall-clock limit finishes a legal report without starting more artefact probes", () => {
    const root = tempRoot();
    const s = submission({
      artefacts: [
        { kind: "commit", sha: "abc1234" },
        { kind: "path", path: "package.json" },
        { kind: "queue-item", id: "qi-22222222" },
      ],
    });
    submitReport(root, s);
    let elapsedMs = 0;
    const probes = checker(() => {
      elapsedMs = 2;
      return { state: "not-found" };
    });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => elapsedMs);
    try {
      const outcome = drainReports(options(root, { checkArtefact: probes.check, limits: { wallMs: 1 } }));
      expect(outcome.stoppedBy).toBe("time");
      expect(outcome.recorded).toBe(1);
      expect(outcome.probes).toBe(1);
      expect(probes.calls).toHaveLength(1);
      expect(rows(root).rows[0]?.event.artefacts.map((item) => item.check)).toEqual([
        { state: "not-found" },
        { state: "unchecked", why: expect.stringMatching(/wall-clock limit/) },
        { state: "unchecked", why: expect.stringMatching(/wall-clock limit/) },
      ]);
      expect(readInbox(root).inFlight.items).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });

  test("pass setup consuming the wall budget cannot defer the first legal item forever", () => {
    const root = tempRoot();
    const s = submission({ artefacts: [{ kind: "commit", sha: "abc1234" }] });
    submitReport(root, s);
    const probes = checker(() => ({ state: "not-found" }));
    const readings = [0, 2, 2];
    const clock = vi.spyOn(Date, "now").mockImplementation(() => readings.shift() ?? 2);
    try {
      const outcome = drainReports(options(root, { checkArtefact: probes.check, limits: { wallMs: 1 } }));
      expect(outcome.recorded).toBe(1);
      expect(outcome.probes).toBe(0);
      expect(probes.calls).toEqual([]);
      expect(rows(root).rows[0]?.event.artefacts[0]?.check).toEqual({
        state: "unchecked",
        why: expect.stringMatching(/wall-clock limit/),
      });
    } finally {
      clock.mockRestore();
    }
  });

  test("zero byte and probe budgets do no work", () => {
    const bytesRoot = tempRoot();
    submitReport(bytesRoot, submission());
    const bytes = drainReports(options(bytesRoot, { limits: { bytes: 0 } }));
    expect(bytes.bytesRead).toBe(0);
    expect(bytes.recorded).toBe(0);
    expect(bytes.stoppedBy).toBe("bytes");

    const probesRoot = tempRoot();
    submitReport(probesRoot, submission({ artefacts: [{ kind: "commit", sha: "abc1234" }] }));
    const checked = checker();
    const probes = drainReports(options(probesRoot, { checkArtefact: checked.check, limits: { probes: 0 } }));
    expect(probes.probes).toBe(0);
    expect(checked.calls).toEqual([]);
    expect(probes.recorded).toBe(0);
    expect(probes.stoppedBy).toBe("probes");
  });
});

describe("the inbox scan is bounded, and what can never be a report is moved out of its way", () => {
  function recordedIds(root: string): string[] {
    const read = readReports(root);
    return read.kind === "reports" ? read.view.rows.map((row) => row.event.eventId) : [];
  }

  test("a flood of 5 000 invalid entries and one valid submission: recorded within six passes, none reading more than scanEntries", () => {
    const root = tempRoot();
    const inboxDir = join(root, INBOX_DIR);
    mkdirSync(inboxDir, { recursive: true });
    for (let i = 0; i < 5000; i += 1) writeFileSync(join(inboxDir, `flood-${i}.txt`), "");
    const s = submission();
    submitReport(root, s);
    const count = (): number => readdirSync(inboxDir).length;
    let passes = 0;
    while (passes < 6 && !recordedIds(root).includes(s.eventId)) {
      const before = count();
      const outcome = drainReports(options(root));
      passes += 1;
      expect(outcome.scanned).toBeLessThanOrEqual(1000);
      // Measured from OUTSIDE the drain: every entry it read and could not use
      // was moved away, so the inbox cannot shrink by more than it read.
      const moved = before - count();
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThanOrEqual(1000);
    }
    expect(recordedIds(root)).toEqual([s.eventId]);
    expect(passes).toBeLessThanOrEqual(6);
  });

  test("the drain never deletes from the quarantine: 300 moved, then 5 more, and all 305 are still there", () => {
    const root = tempRoot();
    for (let i = 0; i < 300; i += 1) drop(root, `junk-${i}.txt`, "");
    expect(drainReports(options(root)).quarantined).toBe(300);
    expect(listed(root, QUARANTINE_DIR)).toHaveLength(300);
    for (let i = 0; i < 5; i += 1) drop(root, `late-${i}.txt`, "");
    expect(drainReports(options(root)).quarantined).toBe(5);
    const kept = listed(root, QUARANTINE_DIR);
    expect(kept).toHaveLength(305);
    for (let i = 0; i < 300; i += 1) expect(kept.some((name) => name.endsWith(`-junk-${i}.txt`)), `junk-${i}`).toBe(true);
  });

  test("a quarantined directory holding 2 000 files is still there, intact and untouched, after passes that quarantine 1 000 more", () => {
    const root = tempRoot();
    const big = join(root, INBOX_DIR, "a-big-tree");
    mkdirSync(big, { recursive: true });
    for (let i = 0; i < 2000; i += 1) writeFileSync(join(big, `f-${i}`), `content ${i}`);
    expect(drainReports(options(root)).quarantined).toBe(1);
    const [moved] = listed(root, QUARANTINE_DIR);
    const where = join(root, QUARANTINE_DIR, moved ?? "");
    const before = statSync(where);
    for (let pass = 0; pass < 4; pass += 1) {
      for (let i = 0; i < 250; i += 1) drop(root, `junk-${pass}-${i}.txt`, "");
      expect(drainReports(options(root)).quarantined).toBe(250);
    }
    expect(listed(root, QUARANTINE_DIR)).toHaveLength(1 + 1000);
    expect(readdirSync(where)).toHaveLength(2000);
    expect(readFileSync(join(where, "f-1999"), "utf8")).toBe("content 1999");
    const after = statSync(where);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  test("no pass lists the quarantine: one the daemon may enter but not read still takes new arrivals", () => {
    if (process.getuid?.() === 0) return; // root reads whatever the mode says, so the control below could not fail
    const root = tempRoot();
    drop(root, "first.txt", "");
    expect(drainReports(options(root)).quarantined).toBe(1);
    const quarantine = join(root, QUARANTINE_DIR);
    chmodSync(quarantine, 0o300);
    try {
      expect(() => readdirSync(quarantine)).toThrow(/EACCES/); // the control: this directory cannot be listed
      drop(root, "second.txt", "");
      const outcome = drainReports(options(root));
      expect(outcome.quarantined).toBe(1);
      expect(outcome.skippedEntries).toBe(0);
    } finally {
      chmodSync(quarantine, 0o700);
    }
    expect(listed(root, QUARANTINE_DIR)).toHaveLength(2);
  });

  test("a symlink in the inbox is moved, never followed, and its target is untouched", () => {
    const root = tempRoot();
    const elsewhere = join(root, "elsewhere.json");
    const target = submission();
    const original = serializeSubmission(target);
    writeFileSync(elsewhere, original);
    mkdirSync(join(root, INBOX_DIR), { recursive: true });
    symlinkSync(elsewhere, join(root, INBOX_DIR, `${target.eventId}.json`));

    const outcome = drainReports(options(root));
    expect(outcome.quarantined).toBe(1);
    expect(outcome.recorded).toBe(0);
    expect(listed(root, INBOX_DIR)).toEqual([]);
    const moved = listed(root, QUARANTINE_DIR);
    expect(moved).toHaveLength(1);
    const link = join(root, QUARANTINE_DIR, moved[0] ?? "");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(elsewhere);
    expect(readFileSync(elsewhere, "utf8")).toBe(original);
    expect(readReports(root).kind).toBe("never-written");
  });

  test("a name that is not UTF-8 is moved too, rather than being unreachable by a string path", () => {
    const root = tempRoot();
    const inboxDir = join(root, INBOX_DIR);
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(Buffer.concat([Buffer.from(`${inboxDir}/`), Buffer.from([0x61, 0xff, 0x62])]), "x");
    expect(drainReports(options(root)).quarantined).toBe(1);
    expect(readdirSync(inboxDir, { encoding: "buffer" })).toEqual([]);
  });

  test("the scan cap says so when it is hit, and not when it is not", () => {
    const root = tempRoot();
    for (let i = 0; i < 5; i += 1) drop(root, `stray-${i}.txt`, "");
    const capped = drainReports(options(root, { limits: { scanEntries: 3 } }));
    expect(capped.scanned).toBe(3);
    expect(capped.scanCapped).toBe(true);
    expect(capped.notes.join("\n")).toMatch(/order is approximate beyond the first 3 entries/);
    const rest = drainReports(options(root, { limits: { scanEntries: 3 } }));
    expect(rest.scanned).toBe(2);
    expect(rest.scanCapped).toBe(false);
    expect(rest.notes.join("\n")).not.toMatch(/approximate/);
  });
});

describe("readInbox is bounded, and every count says whether it was capped", () => {
  function submissions(root: string, count: number): void {
    const dir = join(root, INBOX_DIR);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < count; i += 1) {
      const s = submission();
      writeFileSync(join(dir, `${s.eventId}.json`), serializeSubmission(s));
    }
  }

  test("a flood of 5 000 submissions: at least 1 000 counted, no more than 200 read", () => {
    const root = tempRoot();
    submissions(root, 5000);
    const inbox = readInbox(root);
    expect(inbox.inFlight.count).toEqual({ atLeast: 1000 });
    expect(inbox.inFlight.items.length).toBeGreaterThan(0);
    expect(inbox.inFlight.items.length).toBeLessThanOrEqual(200);
    expect(inbox.processing.count).toEqual({ exact: 0 });
    expect(inbox.refused.count).toEqual({ exact: 0 });
  });

  test("a flood of 5 000 junk names is 'at least none submitted', never 'nothing submitted'", () => {
    const root = tempRoot();
    const dir = join(root, INBOX_DIR);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 5000; i += 1) writeFileSync(join(dir, `junk-${i}.txt`), "");
    const inbox = readInbox(root);
    expect(inbox.inFlight.count).toEqual({ atLeast: 0 });
    expect(inbox.inFlight.items).toEqual([]);
    expect(inbox.skippedEntries).toEqual({ atLeast: 1000 });
  });

  test("an unflooded inbox is exact, and so is one of exactly the scan cap; one more is at least", () => {
    const three = tempRoot();
    submissions(three, 3);
    expect(readInbox(three).inFlight.count).toEqual({ exact: 3 });
    expect(readInbox(three, { scanEntries: 3 }).inFlight.count).toEqual({ exact: 3 });
    const four = tempRoot();
    submissions(four, 4);
    expect(readInbox(four, { scanEntries: 3 }).inFlight.count).toEqual({ atLeast: 3 });
  });

  test("more submissions than it parses are counted exactly, and the list is not the count", () => {
    const root = tempRoot();
    submissions(root, 5);
    const inbox = readInbox(root, { parseFiles: 2 });
    expect(inbox.inFlight.count).toEqual({ exact: 5 });
    expect(inbox.inFlight.items).toHaveLength(2);
  });

  test("the quarantine's size and oldest entry come from the names, and nothing in it is opened", () => {
    const root = tempRoot();
    for (let i = 0; i < 3; i += 1) drop(root, `junk-${i}.txt`, "");
    expect(drainReports(options(root)).quarantined).toBe(3);
    const quarantine = join(root, QUARANTINE_DIR);
    // A FIFO would block an open for ever, and an unreadable directory would refuse one.
    execFileSync("mkfifo", [join(quarantine, "a-fifo-placed-by-hand")]);
    mkdirSync(join(quarantine, "a-locked-directory"), { mode: 0o000 });
    try {
      const inbox = readInbox(root);
      expect(inbox.quarantine).toEqual({ path: quarantine, count: { exact: 5 }, oldestMovedAt: FIRST_NOW.toISOString() });
    } finally {
      chmodSync(join(quarantine, "a-locked-directory"), 0o700);
    }
  });

  test("an empty quarantine is exact zero with no age; a capped one is at least, with the oldest seen", () => {
    const empty = tempRoot();
    expect(readInbox(empty).quarantine).toEqual({ path: join(empty, QUARANTINE_DIR), count: { exact: 0 }, oldestMovedAt: null });
    const root = tempRoot();
    const dir = join(root, QUARANTINE_DIR);
    mkdirSync(dir, { recursive: true });
    const base = Date.parse("2026-09-01T00:00:00.000Z");
    for (let i = 0; i < 1200; i += 1) writeFileSync(join(dir, `${String(base + i * 1000)}-${String(i).padStart(7, "0")}-deadbeef`), "");
    const capped = readInbox(root).quarantine;
    expect(capped.count).toEqual({ atLeast: 1000 });
    const oldest = Date.parse(capped.oldestMovedAt ?? "");
    expect(oldest).toBeGreaterThanOrEqual(base);
    expect(oldest).toBeLessThan(base + 1200 * 1000);
  });
});

describe("inbox hygiene", () => {
  test("a symlink, a directory and a stray name are quarantined; name ≠ id and 17 KiB are refused", () => {
    const root = tempRoot();
    const elsewhere = join(root, "elsewhere.json");
    const target = submission();
    writeFileSync(elsewhere, serializeSubmission(target));
    mkdirSync(join(root, INBOX_DIR), { recursive: true });
    const linkName = `${target.eventId}.json`;
    symlinkSync(elsewhere, join(root, INBOX_DIR, linkName));
    const dirName = `${randomUUID()}.json`;
    mkdirSync(join(root, INBOX_DIR, dirName));
    drop(root, "notes.txt", serializeSubmission(submission()));
    const mismatchName = `${randomUUID()}.json`;
    drop(root, mismatchName, serializeSubmission(submission()));
    const bigName = `${randomUUID()}.json`;
    drop(root, bigName, "x".repeat(17 * 1024));

    const probes = checker();
    const outcome = drainReports(options(root, { checkArtefact: probes.check }));
    expect(outcome.quarantined).toBe(3);
    expect(outcome.skippedEntries).toBe(0);
    expect(outcome.refused).toBe(2);
    expect(outcome.recorded).toBe(0);
    expect(probes.calls).toEqual([]);
    expect(readReports(root).kind).toBe("never-written");
    // Entries that can never be a report are moved out of the inbox, not deleted and not read.
    for (const name of [linkName, dirName, "notes.txt"]) expect(existsSync(join(root, INBOX_DIR, name)), name).toBe(false);
    expect(listed(root, QUARANTINE_DIR)).toHaveLength(3);
    expect(readFileSync(elsewhere, "utf8")).toBe(serializeSubmission(target));
    const refused = new Map(readInbox(root).refused.items.map((r) => [r.eventId, r.why]));
    expect(refused.get(mismatchName.slice(0, -5))).toMatch(/named/);
    expect(refused.get(bigName.slice(0, -5))).toMatch(new RegExp(String(MAX_SUBMISSION_BYTES)));
  });

  test("temp debris older than an hour is removed, and a fresh one is left for its writer", () => {
    const root = tempRoot();
    const old = drop(root, `.tmp-${randomUUID()}`, "{");
    const fresh = drop(root, `.tmp-${randomUUID()}`, "{");
    const nowS = FIRST_NOW.getTime() / 1000;
    utimesSync(old, nowS - 2 * 3600, nowS - 2 * 3600);
    utimesSync(fresh, nowS - 60, nowS - 60);
    const outcome = drainReports(options(root));
    expect(outcome.debrisRemoved).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("a hard-linked submission is quarantined and the other link is untouched", () => {
    const root = tempRoot();
    const s = submission();
    const elsewhere = join(root, "elsewhere.json");
    writeFileSync(elsewhere, serializeSubmission(s));
    mkdirSync(join(root, INBOX_DIR), { recursive: true });
    const inboxFile = join(root, INBOX_DIR, `${s.eventId}.json`);
    linkSync(elsewhere, inboxFile);

    const outcome = drainReports(options(root));
    expect(outcome.quarantined).toBe(1);
    expect(outcome.recorded).toBe(0);
    expect(readReports(root).kind).toBe("never-written");
    expect(readFileSync(elsewhere, "utf8")).toBe(serializeSubmission(s));
    expect(existsSync(inboxFile)).toBe(false);
    expect(listed(root, QUARANTINE_DIR)).toHaveLength(1);
  });

  test("a prepared report replaced by a symlink is left pending rather than followed", () => {
    const root = tempRoot();
    const s = submission();
    submitReport(root, s);
    expect(() => drainReports(options(root, { crashAt: "processing-written" }))).toThrow(SimulatedCrash);
    const prepared = join(root, PROCESSING_DIR, `${s.eventId}.json`);
    const elsewhere = join(root, "prepared-elsewhere.json");
    renameSync(prepared, elsewhere);
    symlinkSync(elsewhere, prepared);
    const later = submission({ summary: "later report" });
    submitReport(root, later);

    const outcome = drainReports(options(root));
    expect(outcome.pending).toBe(1);
    expect(outcome.recorded).toBe(1);
    expect(rows(root).rows.map((row) => row.event.eventId)).toEqual([later.eventId]);
    expect(existsSync(prepared)).toBe(true);
    expect(existsSync(join(root, INBOX_DIR, `${s.eventId}.json`))).toBe(true);
  });
});

describe("a transient failure leaves the item pending", () => {
  test("a checker that throws writes nothing, and the next pass records it", () => {
    const root = tempRoot();
    const s = submission({ artefacts: [{ kind: "commit", sha: "abc1234" }] });
    submitReport(root, s);
    const outcome = drainReports(
      options(root, {
        checkArtefact: () => {
          throw new Error("git exploded");
        },
      }),
    );
    expect(outcome.pending).toBe(1);
    expect(outcome.recorded).toBe(0);
    expect(readReports(root).kind).toBe("never-written");
    expect(listed(root, PROCESSING_DIR)).toEqual([]);
    expect(listed(root, REFUSED_DIR)).toEqual([]);
    expect(readInbox(root).inFlight.items.map((i) => i.eventId)).toEqual([s.eventId]);

    expect(drainReports(options(root)).recorded).toBe(1);
  });

  test("a checker that always throws for one item does not starve later submissions", () => {
    const root = tempRoot();
    const stuck = submission({ artefacts: [{ kind: "commit", sha: "abc1234" }] });
    const later = submission({ summary: "later report" });
    const stuckPath = submitReport(root, stuck);
    const laterPath = submitReport(root, later);
    const base = Date.parse("2026-09-10T09:00:00.000Z") / 1000;
    utimesSync(stuckPath, base, base);
    utimesSync(laterPath, base + 1, base + 1);

    const outcome = drainReports(
      options(root, {
        checkArtefact: () => {
          throw new Error("git always explodes for this reference");
        },
      }),
    );

    expect(outcome.pending).toBe(1);
    expect(outcome.recorded).toBe(1);
    expect(rows(root).rows.map((row) => row.event.eventId)).toEqual([later.eventId]);
    expect(readInbox(root).inFlight.items.map((item) => item.eventId)).toEqual([stuck.eventId]);
  });

  test("a failed append stops the pass before another line can be welded to its torn tail", () => {
    const root = tempRoot();
    const first = submission({ summary: "first" });
    const second = submission({ summary: "second" });
    const firstPath = submitReport(root, first);
    const secondPath = submitReport(root, second);
    const base = Date.parse("2026-09-10T09:00:00.000Z") / 1000;
    utimesSync(firstPath, base, base);
    utimesSync(secondPath, base + 1, base + 1);
    let calls = 0;
    const outcome = drainReports(
      options(root, {
        appendReportLine: (file, line) => {
          calls += 1;
          if (calls === 1) {
            writeFileSync(file, '{"torn"', { flag: "a" });
            throw new Error("disk filled during append");
          }
          writeFileSync(file, `${line}\n`, { flag: "a" });
        },
      }),
    );

    expect(calls).toBe(1);
    expect(outcome.recorded).toBe(0);
    expect(outcome.pending).toBe(1);
    expect(new Set(readInbox(root).inFlight.items.map((item) => item.eventId))).toEqual(new Set([first.eventId, second.eventId]));

    const retry = drainReports(options(root));
    expect(retry.replayed).toBe(1);
    expect(retry.recorded).toBe(1);
    expect(rows(root).rows.map((row) => row.event.summary)).toEqual(["first", "second"]);
  });
});

describe("the three read arms", () => {
  test("never written, recorded, and lost are three different answers", () => {
    const root = tempRoot();
    expect(readReports(root).kind).toBe("never-written");
    submitReport(root, submission());
    drainReports(options(root));
    expect(readReports(root).kind).toBe("reports");

    unlinkSync(join(root, REPORTS_FILE));
    const lost = readReports(root);
    expect(lost.kind).toBe("unreadable");
    if (lost.kind === "unreadable") expect(lost.why).toMatch(/LOST/);

    writeFileSync(join(root, REPORTS_FILE), "");
    expect(readReports(root).kind).toBe("unreadable");
  });

  test("the drain will not recreate a lost log", () => {
    const root = tempRoot();
    submitReport(root, submission());
    drainReports(options(root));
    unlinkSync(join(root, REPORTS_FILE));
    submitReport(root, submission());
    const outcome = drainReports(options(root));
    expect(outcome.recorded).toBe(0);
    expect(outcome.pending).toBe(1);
    expect(existsSync(join(root, REPORTS_FILE))).toBe(false);
  });

  test("an unreadable line is a problem, not a skipped line", () => {
    const root = tempRoot();
    submitReport(root, submission());
    drainReports(options(root));
    writeFileSync(join(root, REPORTS_FILE), `${readFileSync(join(root, REPORTS_FILE), "utf8")}{"schema":1,"kind":"ready"}\n`);
    const view = rows(root);
    expect(view.rows).toHaveLength(1);
    expect(view.problems.map((p) => p.kind)).toEqual(["unreadable-line"]);
  });

  test("parseReportEvent refuses a session event with no execution comparison", () => {
    const root = tempRoot();
    submitReport(root, submission());
    drainReports(options(root));
    const line = readFileSync(join(root, REPORTS_FILE), "utf8").trim();
    expect(parseReportEvent(line).ok).toBe(true);
    const bad = JSON.stringify({ ...(JSON.parse(line) as object), execution: null });
    expect(parseReportEvent(bad).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The submitter's own execution.
 * ------------------------------------------------------------------ */

function stat(pid: number, ppid: number, startTicks: number, name = "proc"): string {
  // Field 22 is index 19 after the last `)`: state, ppid, then 17 fillers.
  return `${pid} (${name}) S ${ppid} ${"0 ".repeat(17)}${startTicks} 0 0`;
}

function fakeProc(procs: Record<number, { argv: string[]; ppid: number; start: number }>): (path: string) => string {
  return (path) => {
    if (path === "/proc/sys/kernel/random/boot_id") return "boot-1111\n";
    const match = /^\/proc\/(\d+)\/(stat|cmdline)$/.exec(path);
    const proc = match === null ? undefined : procs[Number(match[1])];
    if (match === null || proc === undefined) throw new Error(`ENOENT ${path}`);
    return match[2] === "stat" ? stat(Number(match[1]), proc.ppid, proc.start) : `${proc.argv.join("\0")}\0`;
  };
}

describe("observeOwnExecution walks up to the claude process", () => {
  test("finds the nearest `claude` ancestor and names it by boot, pid and start tick", () => {
    const read = fakeProc({
      300: { argv: ["node", "/x/tsx", "scripts/overseer.ts"], ppid: 200, start: 9 },
      200: { argv: ["/bin/bash", "-c", "npx tsx"], ppid: 80, start: 8 },
      80: { argv: ["/home/greg/.local/bin/claude", "--session-id", "x"], ppid: 1, start: 5555 },
    });
    expect(observeOwnExecution({ ppid: 300, read, platform: "linux" })).toEqual({
      kind: "observed",
      pid: 80,
      token: "boot-1111:80:5555",
    });
  });

  test(`no claude within ${MAX_ANCESTRY_STEPS} steps is a reason, not a guess`, () => {
    const procs: Record<number, { argv: string[]; ppid: number; start: number }> = {};
    for (let pid = 1000; pid < 1030; pid += 1) procs[pid] = { argv: ["bash"], ppid: pid + 1, start: 1 };
    const got = observeOwnExecution({ ppid: 1000, read: fakeProc(procs), platform: "linux" });
    expect(got.kind).toBe("unobserved");
    if (got.kind === "unobserved") expect(got.why).toMatch(String(MAX_ANCESTRY_STEPS));
  });

  test("a pid replaced between its command line and start-time reads is not observed as a Claude run", () => {
    let statReads = 0;
    const read = (path: string): string => {
      if (path === "/proc/sys/kernel/random/boot_id") return "boot-1111\n";
      if (path === "/proc/80/cmdline") return "/home/greg/.local/bin/claude\0";
      if (path === "/proc/80/stat") {
        statReads += 1;
        return stat(80, 1, statReads === 1 ? 5555 : 6666);
      }
      throw new Error(`ENOENT ${path}`);
    };

    const got = observeOwnExecution({ ppid: 80, read, platform: "linux" });
    expect(got).toEqual({ kind: "unobserved", why: expect.stringMatching(/changed while it was read/) });
  });

  test("off Linux it says so", () => {
    expect(observeOwnExecution({ ppid: 300, read: fakeProc({}), platform: "darwin" }).kind).toBe("unobserved");
  });
});

/* ------------------------------------------------------------------ *
 * The real checker, against this checkout.
 * ------------------------------------------------------------------ */

describe("makeArtefactChecker", () => {
  const repoDir = join(import.meta.dirname, "..");
  const empty = (): string => tempRoot();

  test("git says no is not-found; could not run git is unchecked", () => {
    const check = makeArtefactChecker({ repoDir, decisionsRoot: empty(), queueRoot: empty() });
    expect(check({ kind: "commit", sha: "0000000" })).toEqual({ state: "not-found" });
    expect(check({ kind: "path", path: "no/such/file-here.ts" })).toEqual({ state: "not-found" });
    const gone = makeArtefactChecker({ repoDir: join(empty(), "missing"), decisionsRoot: empty(), queueRoot: empty() });
    expect(gone({ kind: "commit", sha: "0000000" }).state).toBe("unchecked");

    const notRepo = empty();
    writeFileSync(join(notRepo, "local.ts"), "local but git cannot say whether it is on dev");
    const noGitAnswer = makeArtefactChecker({ repoDir: notRepo, decisionsRoot: empty(), queueRoot: empty() });
    expect(noGitAnswer({ kind: "path", path: "local.ts" }).state).toBe("unchecked");
  });

  test("a commit on origin/dev and a path in its tree are on-dev", () => {
    const check = makeArtefactChecker({ repoDir, decisionsRoot: empty(), queueRoot: empty() });
    const sha = execFileSync("git", ["rev-parse", "refs/remotes/origin/dev"], { cwd: repoDir, encoding: "utf8" }).trim();
    expect(check({ kind: "commit", sha })).toEqual({ state: "on-dev" });
    expect(check({ kind: "path", path: "package.json" })).toEqual({ state: "on-dev" });
  });

  test("a decision or queue item absent from a never-written record is not-found", () => {
    const check = makeArtefactChecker({ repoDir, decisionsRoot: empty(), queueRoot: empty() });
    expect(check({ kind: "decision", id: "dec-22222222" })).toEqual({ state: "not-found" });
    expect(check({ kind: "queue-item", id: "qi-22222222" })).toEqual({ state: "not-found" });
  });
});
