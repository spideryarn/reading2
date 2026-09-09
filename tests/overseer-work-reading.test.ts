/** The persisted projection of one process-table reading, kept honest at both clocks. */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { probeProcessTable } from "../tools/overseer/work-probe.js";
import { classifyPaneWork, parseProcessTable, type ProcessRow, type ProcessTableReading } from "../tools/overseer/work.js";
import { paneWorkOf, REUSE_TOLERANCE_MS, safeCommand, scanPaneWork } from "../tools/overseer/work-reading.js";
import { freshFixture } from "./overseer-fixtures.js";

const TREES = join(import.meta.dirname, "fixtures", "overseer-process-trees");
const NOW_MS = Date.UTC(2026, 8, 9, 12, 0, 0);
const PANE = {
  codex: 3184904,
  claude: 3184904,
  tests: 1234211,
  quiet: 652780,
} as const;
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

function readingOf(name: string): ProcessTableReading {
  const raw = readFileSync(join(TREES, `${name}.txt`), "utf8");
  const parsed = parseProcessTable(raw, NOW_MS);
  if (!parsed.ok) throw new Error(parsed.reason);
  return { read: true, rows: parsed.rows, atMs: NOW_MS };
}

function pane(name: string, panePid: number, sourceCollectedAtMs = NOW_MS): ReturnType<typeof paneWorkOf> {
  return paneWorkOf({ reading: classifyPaneWork(panePid, readingOf(name)), sourceCollectedAtMs });
}

describe("safe command evidence", () => {
  test.each([
    ["codex exec --model gpt-5.6-sol -c approval_policy=never", "codex exec"],
    ["claude --print --model haiku -- Reply with pong", "claude"],
    ["codex exec --prompt a prompt containing spaces and a secret", "codex exec"],
    ["python customer-secret-token", "python"],
    ["node customer-secret-token", "node"],
    ["node /srv/app/node_modules/.bin/vitest run --config secret", "vitest run"],
    ["codex customer-secret-token", "codex"],
    ["toString customer-secret-token", "toString"],
    ["bash", "bash"],
  ])("reduces %s", (command, expected) => expect(safeCommand(command)).toBe(expected));

  test.each(["", "   ", "/", "/tmp/customer-secret-token exec"])(
    "explains that %j has no safe command instead of publishing an empty string",
    (command) => expect(safeCommand(command)).toBe("command unavailable"),
  );
});

describe("converting work readings", () => {
  test("the captured depth-eight codex review survives intact", () => {
    const work = pane("codex-review-under-pane", PANE.codex);
    expect(work.kind).toBe("work");
    if (work.kind !== "work") return;
    expect(work.jobs).toHaveLength(1);
    expect(work.jobs[0]).toMatchObject({
      recogniser: "codex-exec",
      label: "GPT review or task (non-interactive codex)",
      depth: 8,
      command: "codex exec",
      ranForMs: 4_000,
    });
    expect(work.jobs[0]?.startedAt).toBe(new Date(NOW_MS - 4_000).toISOString());
  });

  test.each([
    ["codex-review-under-pane", PANE.codex, "codex-exec"],
    ["headless-claude-under-pane", PANE.claude, "claude-headless"],
  ])("classifies the foreground or background capture %s", (name, pid, recogniser) => {
    const work = pane(name, pid);
    expect(work.kind).toBe("work");
    if (work.kind === "work") expect(work.jobs.map((job) => job.recogniser)).toContain(recogniser);
  });

  test("the shell-pane fixture gives vitest work and its pane command", () => {
    const work = pane("shell-pane-running-tests", PANE.tests);
    expect(work.kind).toBe("work");
    if (work.kind !== "work") return;
    expect(work.jobs.map((job) => job.recogniser)).toEqual(["vitest"]);
    expect(work.paneCommand).toBe("sh");
  });

  test("a quiet pane retains the non-zero number of processes inspected", () => {
    const work = pane("quiet-claude-pane", PANE.quiet);
    expect(work.kind).toBe("none");
    if (work.kind !== "none") return;
    expect(work.inspected).toBe(8);
  });

  test("an exited child is absent from the moment, not retained as stale work", () => {
    const reading = readingOf("codex-review-under-pane");
    if (!reading.read) throw new Error("unreachable");
    const rows = reading.rows.filter((row) => row.pid !== 1370771);
    const work = paneWorkOf({
      reading: classifyPaneWork(PANE.codex, { read: true, rows, atMs: reading.atMs }),
      sourceCollectedAtMs: NOW_MS,
    });
    expect(work.kind).toBe("none");
  });
});

describe("the pid-reuse backstop", () => {
  const rows = (paneStartedAt: number): readonly ProcessRow[] => [
    { pid: 100, ppid: 1, command: "bash pane", started: { known: true, atMs: paneStartedAt } },
    { pid: 200, ppid: 100, command: "codex exec --model x", started: { known: true, atMs: NOW_MS - 4_000 } },
  ];

  test("fires when the pane is younger than the inventory beyond tolerance", () => {
    const reading: ProcessTableReading = { read: true, rows: rows(NOW_MS + REUSE_TOLERANCE_MS + 1), atMs: NOW_MS + 30_000 };
    const work = paneWorkOf({ reading: classifyPaneWork(100, reading), sourceCollectedAtMs: NOW_MS });
    expect(work.kind).toBe("cannot-tell");
    if (work.kind === "cannot-tell") expect(work.cause).toBe("pane-younger-than-inventory");
  });

  test("does not fire for the one-second imprecision in ps etimes", () => {
    const reading: ProcessTableReading = { read: true, rows: rows(NOW_MS + 1_000), atMs: NOW_MS + 30_000 };
    const work = paneWorkOf({ reading: classifyPaneWork(100, reading), sourceCollectedAtMs: NOW_MS });
    expect(work.kind).toBe("work");
  });

  test("cannot claim no work when the pane start is unavailable and reuse cannot be checked", () => {
    const reading: ProcessTableReading = {
      read: true,
      rows: [
        { pid: 100, ppid: 1, command: "bash pane", started: { known: false } },
        { pid: 200, ppid: 100, command: "ordinary-child", started: { known: true, atMs: NOW_MS - 4_000 } },
      ],
      atMs: NOW_MS + 30_000,
    };
    const work = paneWorkOf({ reading: classifyPaneWork(100, reading), sourceCollectedAtMs: NOW_MS });
    expect(work).toMatchObject({ kind: "cannot-tell", cause: "pane-start-unavailable" });
  });

  test("records the uncaught case: a reused pid older than the inventory is walked", () => {
    // Known limitation: age can reject only a process born in the gap. Closing
    // this case needs the process table sampled in the same pass that reads the
    // pane pids, so the two identities are observed together.
    const reading: ProcessTableReading = { read: true, rows: rows(NOW_MS - 10_000), atMs: NOW_MS + 30_000 };
    const work = paneWorkOf({ reading: classifyPaneWork(100, reading), sourceCollectedAtMs: NOW_MS });
    expect(work.kind).toBe("work");
  });
});

describe("scanning every pane from one table", () => {
  test("an unreadable table is one global failure with no panes", () => {
    const work = scanPaneWork({
      rows: freshFixture("session-new-before").snapshot.rows,
      reading: { read: false, why: "ps could not see /proc" },
      sourceCollectedAt: "2026-09-09T11:59:30.000Z",
      sourceCollectedAtMs: Date.UTC(2026, 8, 9, 11, 59, 30),
      attemptedAt: "2026-09-09T12:00:00.000Z",
    });
    expect(work).toMatchObject({ kind: "probe-failed", why: "ps could not see /proc" });
    expect(work).not.toHaveProperty("panes");
  });

  test("uses the parser's millisecond clock for the reuse guard instead of reparsing its display string", () => {
    const fixture = freshFixture("session-new-before").snapshot;
    const row = fixture.rows[0];
    if (row === undefined) throw new Error("fixture has no row");
    const work = scanPaneWork({
      rows: [{ ...row, panePid: 100 }],
      reading: {
        read: true,
        rows: [{ pid: 100, ppid: 1, command: "bash pane", started: { known: true, atMs: NOW_MS + 3_000 } }],
        atMs: NOW_MS + 30_000,
      },
      // The mismatch is constructed to discriminate which member the helper
      // uses. Production receives this pair from one strict parser.
      sourceCollectedAt: new Date(NOW_MS + 10_000).toISOString(),
      sourceCollectedAtMs: NOW_MS,
      attemptedAt: new Date(NOW_MS + 30_000).toISOString(),
    });
    expect(work.kind).toBe("scan");
    if (work.kind !== "scan") return;
    expect(work.panes[0]?.work).toMatchObject({ kind: "cannot-tell", cause: "pane-younger-than-inventory" });
  });
});

describe("DISPOSABLE POSITIVE CONTROL: the live apparatus detects", () => {
  test("a real child with a recognisable argv is found under this worker", async ({ skip }) => {
    const preflight = probeProcessTable();
    if (!preflight.read && /could not be run/.test(preflight.why)) {
      skip(`ps is unavailable: ${preflight.why}`);
      return;
    }
    expect(preflight.read ? null : preflight.why).toBeNull();

    // `yes` accepts an arbitrary first argument and stays alive; argv0 supplies
    // the installed recogniser's executable without running a recursive suite.
    const child = spawn("/usr/bin/yes", ["run"], { argv0: "vitest", stdio: "ignore" });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const reading = probeProcessTable();
    expect(reading.read ? null : reading.why).toBeNull();
    if (!reading.read) return;
    const work = classifyPaneWork(process.pid, reading);
    expect(work.kind).toBe("child-work");
    if (work.kind !== "child-work") return;
    expect(work.jobs.some((job) => job.pid === child.pid && job.recogniser === "vitest")).toBe(true);
  });
});
