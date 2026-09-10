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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

import type { ArtefactCheck, ArtefactRef } from "../tools/fleet/artefact-ref.js";
import type { SessionKey, StatusKey } from "../tools/overseer/diff.js";
import { makeArtefactChecker } from "../tools/overseer/report-artefacts.js";
import { MAX_ANCESTRY_STEPS, observeOwnExecution } from "../tools/overseer/report-identity.js";
import {
  DECISION_NOT_WIRED,
  INBOX_DIR,
  MAX_SUBMISSION_BYTES,
  PROCESSING_DIR,
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
    appendDecision: () => ({ kind: "pending", why: "not in this stage" }),
    ...over,
  };
}

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
    expect(inbox.refused.map((r) => r.eventId)).toEqual([s.eventId]);
    expect(inbox.refused[0]?.why).toMatch(/already recorded/);
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
    const refused = readInbox(root).refused;
    expect(refused[0]?.why).toMatch(/kind/);
    const stored = JSON.parse(readFileSync(join(root, REFUSED_DIR, `${s.eventId}.json`), "utf8")) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["eventId", "original", "refusedAt", "why"]);
    expect(stored["original"]).toContain("ready");
  });

  test("a decision submission is refused in this stage, and appendDecision is not called", () => {
    const root = tempRoot();
    let called = 0;
    submitReport(root, submission({ kind: "decision", draft: { question: "which?" } }));
    const outcome = drainReports(
      options(root, {
        appendDecision: () => {
          called += 1;
          return { kind: "appended" };
        },
      }),
    );
    expect(outcome.refused).toBe(1);
    expect(called).toBe(0);
    expect(readInbox(root).refused[0]?.why).toBe(DECISION_NOT_WIRED);
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
    expect(readInbox(root).refused[0]?.why).toMatch(/corrects/);
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
});

describe("inbox hygiene", () => {
  test("a symlink, a directory and a stray name are skipped; name ≠ id and 17 KiB are refused", () => {
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
    expect(outcome.skippedEntries).toBe(3);
    expect(outcome.refused).toBe(2);
    expect(outcome.recorded).toBe(0);
    expect(probes.calls).toEqual([]);
    expect(readReports(root).kind).toBe("never-written");
    // Skipped entries are left exactly where they were.
    for (const name of [linkName, dirName, "notes.txt"]) expect(existsSync(join(root, INBOX_DIR, name)), name).toBe(true);
    const refused = new Map(readInbox(root).refused.map((r) => [r.eventId, r.why]));
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
    expect(readInbox(root).inFlight.map((i) => i.eventId)).toEqual([s.eventId]);

    expect(drainReports(options(root)).recorded).toBe(1);
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
