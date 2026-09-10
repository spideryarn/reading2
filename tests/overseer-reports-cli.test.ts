/**
 * **`overseer report <kind>` and `overseer reports`: the grammar, and what each
 * arm does.**
 *
 * The parser and the drain share one submission parser, so the grammar here
 * only has to refuse what Commander can see (an unknown kind, an unknown
 * `--on`, a malformed `--artefact`) and hand the rest to `parseSubmission`.
 * Every store is a temp directory; nothing here touches `~/.overseer`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { parseArgv, runParsed, runReport, runReports, type Parsed, type ReportDeps } from "../scripts/overseer.js";
import type { SessionKey, StatusKey } from "../tools/overseer/diff.js";
import { drainReports, INBOX_DIR, REFUSED_DIR, type ReportSubmission } from "../tools/overseer/reports.js";
import type { RegisterEntry } from "../tools/overseer/store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-reports-cli-"));
  roots.push(root);
  return root;
}

const BELL = String.fromCharCode(7);

function parsed(argv: string[]): Parsed {
  const out = parseArgv(argv);
  if (out.kind !== "run") throw new Error(`expected a command, got ${JSON.stringify(out)}`);
  return out.parsed;
}

function report(argv: string[]): Extract<Parsed, { command: "report" }> {
  const p = parsed(argv);
  if (p.command !== "report") throw new Error(`expected report, got ${p.command}`);
  return p;
}

function inbox(root: string): string[] {
  const dir = join(root, INBOX_DIR);
  return existsSync(dir) ? readdirSync(dir) : [];
}

type Captured = { out: string[]; err: string[]; deps: ReportDeps };

function deps(over: Partial<ReportDeps> = {}): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      env: {},
      tmuxSessionName: () => ({ ok: false, why: "no tmux in this test" }),
      observe: () => ({ kind: "observed", pid: 80, token: "boot-cli:80:5555" }),
      now: () => new Date("2026-09-10T12:00:00.000Z"),
      mintId: () => randomUUID(),
      readFile: () => {
        throw new Error("no file in this test");
      },
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      ...over,
    },
  };
}

describe("the grammar", () => {
  test("report progress parses into one shape", () => {
    const p = report(["report", "progress", "--summary", "tests red", "--session", "work-reports", "--artefact", "commit:abc1234", "--artefact", "path:docs/x.md"]);
    expect(p.report).toMatchObject({
      kind: "progress",
      summary: "tests red",
      session: "work-reports",
      as: null,
      artefacts: [
        { kind: "commit", sha: "abc1234" },
        { kind: "path", path: "docs/x.md" },
      ],
    });
  });

  test("an unknown kind `ready` is refused by the parser", () => {
    expect(parseArgv(["report", "ready", "--summary", "x", "--session", "w"]).kind).toBe("error");
    expect(parseArgv(["reports", "--kind", "ready"]).kind).toBe("error");
  });

  test("blocked needs --on from its list and --needs", () => {
    const p = report(["report", "blocked", "--summary", "s", "--on", "greg", "--needs", "a yes or no", "--as", "overseer"]);
    expect(p.report).toMatchObject({ kind: "blocked", on: "greg", needs: "a yes or no", as: "overseer" });
    expect(parseArgv(["report", "blocked", "--summary", "s", "--on", "nobody", "--needs", "n"]).kind).toBe("error");
    expect(parseArgv(["report", "blocked", "--summary", "s", "--on", "greg"]).kind).toBe("error");
  });

  test("completed collects repeated revision flags", () => {
    const p = report(["report", "completed", "--summary", "s", "--ending", "finished", "--reviewed", "abc1234", "--reviewed", "def5678", "--merged", "0123abc", "--as", "greg"]);
    expect(p.report).toMatchObject({ kind: "completed", ending: "finished", reviewed: ["abc1234", "def5678"], tested: [], merged: ["0123abc"] });
  });

  test("an artefact outside the repository is refused at parse time", () => {
    for (const spec of ["path:../x", "path:/etc/passwd"]) {
      const out = parseArgv(["report", "progress", "--summary", "s", "--session", "w", "--artefact", spec]);
      expect(out.kind, spec).toBe("error");
    }
  });

  test("reports takes its filters", () => {
    expect(parsed(["reports", "--session", "w", "--kind", "blocked", "--search", "drain", "--json"])).toEqual({
      command: "reports",
      session: "w",
      kind: "blocked",
      search: "drain",
      event: null,
      json: true,
    });
  });
});

describe("runReport", () => {
  test("submits, prints the id and says it is not yet recorded", () => {
    const root = tempRoot();
    const c = deps();
    const code = runReport(root, report(["report", "progress", "--summary", "tests red", "--session", "work-reports"]).report, c.deps);
    expect(code).toBe(0);
    const files = inbox(root);
    expect(files).toHaveLength(1);
    const id = files[0]?.slice(0, -5) ?? "";
    expect(c.out.join("\n")).toContain(id);
    expect(c.out.join("\n")).toMatch(/submitted, not yet recorded/);
    expect(c.out.join("\n")).toContain(`reports --event ${id}`);
  });

  test("with neither --session nor --as, the tmux session name is used when $TMUX is set", () => {
    const root = tempRoot();
    const c = deps({ env: { TMUX: "/tmp/tmux-1000/default,1,0" }, tmuxSessionName: () => ({ ok: true, name: "from-tmux" }) });
    expect(runReport(root, report(["report", "progress", "--summary", "s"]).report, c.deps)).toBe(0);
    expect(c.out.join("\n")).toMatch(/session from-tmux/);
  });

  test("with neither, and no tmux, it refuses and writes nothing", () => {
    const root = tempRoot();
    const c = deps();
    expect(runReport(root, report(["report", "progress", "--summary", "s"]).report, c.deps)).toBe(1);
    expect(inbox(root)).toEqual([]);
    expect(c.err.join("\n")).toMatch(/--session/);
  });

  test("--session and --as together are refused", () => {
    const root = tempRoot();
    const c = deps();
    expect(runReport(root, report(["report", "progress", "--summary", "s", "--session", "w", "--as", "greg"]).report, c.deps)).toBe(1);
    expect(inbox(root)).toEqual([]);
  });

  test("a control character in the summary is refused, naming the field, and nothing is written", () => {
    const root = tempRoot();
    const c = deps();
    expect(runReport(root, report(["report", "progress", "--summary", `ring${BELL}`, "--session", "w"]).report, c.deps)).toBe(1);
    expect(inbox(root)).toEqual([]);
    expect(c.err.join("\n")).toMatch(/summary/);
  });

  test("a decision is parsed and then refused as not yet wired", () => {
    const root = tempRoot();
    const c = deps({ readFile: () => JSON.stringify({ question: "which?" }) });
    expect(runReport(root, report(["report", "decision", "--summary", "s", "--session", "w", "--file", "d.json"]).report, c.deps)).toBe(1);
    expect(inbox(root)).toEqual([]);
    expect(c.err.join("\n")).toMatch(/stage 3/);
  });
});

function entry(name: string, token: string): RegisterEntry {
  const at = "2026-09-10T10:00:00.000Z";
  return {
    key: `$7 name:${name}` as SessionKey,
    tmuxId: "$7",
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
    verifiedExecution: { token, since: at },
  };
}

function drain(root: string): void {
  drainReports({
    root,
    register: new Map([[`$7 name:work-reports` as SessionKey, entry("work-reports", "boot-cli:80:5555")]]),
    now: () => new Date("2026-09-10T12:01:00.000Z"),
    checkArtefact: () => ({ state: "not-found" }),
    appendDecision: () => ({ kind: "pending", why: "not in this stage" }),
  });
}

describe("runReports", () => {
  test("every empty case says so in a sentence", () => {
    const root = tempRoot();
    const out: string[] = [];
    expect(runReports(root, { command: "reports", session: null, kind: null, search: null, event: null, json: false }, (l) => out.push(l))).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/no reports have been recorded/i);
    expect(text).toMatch(/nothing in flight/i);
    expect(text).toMatch(/nothing refused/i);
  });

  test("recorded rows say who claimed them, how the run compared, and 'not stated'", () => {
    const root = tempRoot();
    const c = deps();
    runReport(root, report(["report", "completed", "--summary", "done", "--ending", "finished", "--session", "work-reports", "--artefact", "commit:abc1234"]).report, c.deps);
    drain(root);
    const first = readdirSync(root).length; // the drain ran
    expect(first).toBeGreaterThan(0);
    const out: string[] = [];
    runReports(root, { command: "reports", session: null, kind: null, search: null, event: null, json: false }, (l) => out.push(l));
    const text = out.join("\n");
    expect(text).toMatch(/claimed by session work-reports/);
    expect(text).toMatch(/same verified run/);
    expect(text).toMatch(/reviewed: not stated/);
    expect(text).toMatch(/commit:abc1234 — not found at receipt/);
  });

  test("a correction is shown on the corrected row", () => {
    const root = tempRoot();
    const c = deps();
    runReport(root, report(["report", "progress", "--summary", "first", "--session", "work-reports"]).report, c.deps);
    drain(root);
    const firstId = c.out[0] ?? "";
    runReport(root, report(["report", "progress", "--summary", "second", "--session", "work-reports", "--corrects", firstId]).report, c.deps);
    drain(root);
    const out: string[] = [];
    runReports(root, { command: "reports", session: null, kind: null, search: null, event: firstId, json: false }, (l) => out.push(l));
    expect(out.join("\n")).toMatch(/corrected by .* by session work-reports/);
  });

  test("--event finds an in-flight report before the daemon has recorded it", () => {
    const root = tempRoot();
    const c = deps();
    runReport(root, report(["report", "progress", "--summary", "pending one", "--session", "work-reports"]).report, c.deps);
    const id = c.out[0] ?? "";
    const out: string[] = [];
    runReports(root, { command: "reports", session: null, kind: null, search: null, event: id, json: false }, (l) => out.push(l));
    expect(out.join("\n")).toMatch(/in flight/);
    expect(out.join("\n")).toContain("pending one");
  });

  test("a refused report is listed with its reason", () => {
    const root = tempRoot();
    const id = randomUUID();
    const dir = join(root, INBOX_DIR);
    runReport(root, report(["report", "progress", "--summary", "x", "--session", "w"]).report, deps().deps);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ kind: "ready" } satisfies Partial<Record<keyof ReportSubmission, unknown>>));
    drain(root);
    const out: string[] = [];
    runReports(root, { command: "reports", session: null, kind: null, search: null, event: null, json: false }, (l) => out.push(l));
    expect(out.join("\n")).toMatch(new RegExp(`refused.*\\n.*${id}`, "s"));
  });

  test("a hand-written refusal cannot put control characters in terminal output", () => {
    const root = tempRoot();
    const id = randomUUID();
    const dir = join(root, REFUSED_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ eventId: id, refusedAt: `time${BELL}`, why: `reason${BELL}`, original: "" }));
    const out: string[] = [];
    runReports(root, { command: "reports", session: null, kind: null, search: null, event: null, json: false }, (line) => out.push(line));
    expect(out.join("\n")).not.toContain(BELL);
  });

  test("a symlink in the refusal directory is not followed into terminal output", () => {
    const root = tempRoot();
    const id = randomUUID();
    const dir = join(root, REFUSED_DIR);
    mkdirSync(dir, { recursive: true });
    const elsewhere = join(root, "elsewhere-refusal.json");
    writeFileSync(elsewhere, JSON.stringify({ eventId: id, refusedAt: "2026-09-10T12:00:00.000Z", why: "FOLLOWED LINK", original: "" }));
    symlinkSync(elsewhere, join(dir, `${id}.json`));
    const out: string[] = [];
    runReports(root, { command: "reports", session: null, kind: null, search: null, event: null, json: false }, (line) => out.push(line));
    expect(out.join("\n")).not.toContain("FOLLOWED LINK");
    expect(out.join("\n")).toMatch(/refusal record could not be read/);
  });
});

describe("runParsed", () => {
  test("report and reports reach the store named by OVERSEER_STORE_DIR", async () => {
    const root = tempRoot();
    vi.stubEnv("OVERSEER_STORE_DIR", root);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    expect(await runParsed(parsed(["report", "progress", "--summary", "via runParsed", "--session", "work-reports"]))).toBe(0);
    expect(inbox(root)).toHaveLength(1);
    expect(await runParsed(parsed(["reports"]))).toBe(0);
    expect(lines.join("\n")).toContain("via runParsed");
  });
});
