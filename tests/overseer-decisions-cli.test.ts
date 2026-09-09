/**
 * The terminal entrance to the decision record.
 *
 * These tests cross Commander and the typed runner because the promise is not
 * merely that a helper can form an event: the parser must require the actor,
 * stdin/files must reach the same append path, and the register identity must
 * survive all the way into decisions.jsonl. Every run gets a fresh temp root.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

import { identityOf, sessionKey, type OverseerEvent } from "../tools/overseer/diff.js";
import type { ObservedRow } from "../tools/overseer/observation.js";
import { describeRefusal, openStore, type OverseerStore } from "../tools/overseer/store.js";
import { DECISIONS_FILE, readDecisions } from "../tools/overseer/decisions.js";
import { parseArgv, runParsed } from "../scripts/overseer-decisions.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];
const stores: OverseerStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-decisions-cli-test-"));
  roots.push(root);
  return root;
}

function run(root: string, args: readonly string[], input?: string) {
  const parsed = parseArgv(args);
  if (parsed.kind === "error") return { status: 1, stdout: "", stderr: parsed.why };
  if (parsed.kind === "help") return { status: 0, stdout: `${parsed.text}\n`, stderr: "" };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((value?: unknown) => stdout.push(String(value ?? "")));
  const error = vi.spyOn(console, "error").mockImplementation((value?: unknown) => stderr.push(String(value ?? "")));
  let status: number;
  try {
    status = runParsed(
      parsed.parsed,
      { ...process.env, OVERSEER_DECISIONS_DIR: root, OVERSEER_STORE_DIR: root },
      () => input ?? "",
    );
  } catch (cause) {
    status = 1;
    stderr.push(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return {
    status,
    stdout: stdout.length === 0 ? "" : `${stdout.join("\n")}\n`,
    stderr: stderr.length === 0 ? "" : `${stderr.join("\n")}\n`,
  };
}

function payload(sessions: readonly string[] = []): Record<string, unknown> {
  return {
    class: "decision",
    question: "Which shape should the first version use?",
    options: [
      { name: "Small", tradeoffs: "Ships quickly, with fewer extension points." },
      { name: "General", tradeoffs: "Handles imagined cases, with more machinery." },
    ],
    chose: { option: "Small", note: "Use the small shape." },
    why: "There is no demonstrated need for the extension points.",
    advisers: ["nobody"],
    bearsOn: { sessions, plan: null },
    supersedes: null,
  };
}

function observedRow(
  name: string,
  id: string,
  conversation: string,
  token: { boot: string; pid: number; startTicks: number },
): ObservedRow {
  return {
    id,
    name,
    execution: { kind: "verified", token, harness: "claude-code", conversation: { kind: "verified", id: conversation } },
    title: null,
    repo: "spideryarn/reading2",
    worktree: name,
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: REPO },
    startedAt: "2026-09-09T09:00:00.000Z",
    paneId: `%${id.slice(1)}`,
    panePid: token.pid,
    claimedConversationId: conversation,
    question: null,
    status: { kind: "working" },
  };
}

function seen(row: ObservedRow, at: string): OverseerEvent {
  return {
    kind: "session-seen",
    at,
    tmuxServerPid: 734921,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    row,
  };
}

function checkpoint(root: string, rows: readonly ObservedRow[]): void {
  const now = new Date();
  const opened = openStore({ root, now: () => now });
  if (!opened.ok) throw new Error(describeRefusal(opened.refusal));
  stores.push(opened.store);
  const appended = opened.store.append(rows.map((row, index) => seen(row, new Date(now.getTime() - index * 1_000).toISOString())));
  if (!appended.ok) throw new Error("the fixture store lost its lock");
  const written = opened.store.checkpoint({ lastGoodSnapshotAt: now.toISOString(), snapshotStaleAfterMs: 300_000, tick: true });
  if (!written.ok) throw new Error("the fixture checkpoint was not written");
  opened.store.close();
  stores.splice(stores.indexOf(opened.store), 1);
}

function records(root: string) {
  const read = readDecisions(root);
  if (read.kind !== "decisions") throw new Error(`expected decisions, got ${read.kind}`);
  return read.view.records;
}

describe("Commander grammar", () => {
  test("a missing --by is a usage error and writes nothing", () => {
    const root = tempRoot();
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload()));

    const result = run(root, ["add", "--file", file]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("required option '--by <actor>' not specified");
    expect(() => readFileSync(join(root, DECISIONS_FILE), "utf8")).toThrow();
  });

  test("rejects an unknown actor instead of coercing it", () => {
    const root = tempRoot();
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload()));
    const result = run(root, ["add", "--file", file, "--by", "daemon"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("'greg' or 'overseer'");
  });

  test("template prints a commented, fillable input with every required field", () => {
    const root = tempRoot();
    const result = run(root, ["template"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("// Copy this");
    const json = result.stdout
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(JSON.parse(json)).toEqual(expect.objectContaining(payload()));
  });

  test("list accepts its class, pending-only, and JSON filters", () => {
    const parsed = parseArgv(["list", "--class", "decision", "--unreviewed", "--json"]);
    expect(parsed).toEqual({
      kind: "run",
      parsed: { command: "list", class: "decision", unreviewed: true, json: true },
    });
  });
});

describe("add and register identity", () => {
  test("re-running add with the same command id is a no-op naming the existing decision", () => {
    /* **THE RETRY THE COMMAND ID EXISTS FOR**: the append succeeded and the
       answer was lost, so the Overseer runs the same command again.
       Determinism cannot deliver this — a second run mints a fresh decision id,
       stamps a later `decidedAt`, and re-resolves every session against a
       register that has moved — so the CLI reads before it writes. The fold's
       payload comparison stays as the safety net for OTHER writers. */
    const root = tempRoot();
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload(["not-in-register"])));

    const first = run(root, ["add", "--file", file, "--by", "overseer", "--command-id", "retry-me"]);
    const second = run(root, ["add", "--file", file, "--by", "overseer", "--command-id", "retry-me"]);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.stderr).toBe("");
    expect(records(root)).toHaveLength(1);
    const id = /dec-[23456789abcdefghjkmnpqrstvwxyz]{8}/.exec(first.stdout)?.[0];
    expect(id).toBeDefined();
    expect(second.stdout).toContain(id as string);
  });

  test("reusing a command id for a DIFFERENT decision is refused, not reported as a retry", () => {
    /* The regression this pins: the retry check moved to the CLI in Stage 2b and
       lost half of itself in the move. Comparing only the command id makes a
       different decision under a reused key exit 0 and print the OLD id — the
       exact failure the fold's conflict arm exists to prevent, reintroduced one
       layer up where the fold never sees it. GPT Sol's P1, reviewing the
       implementation. What is compared is the AUTHOR'S INPUT, because that is
       what is stable: the decision id, `decidedAt` and every resolved execution
       ref legitimately differ between two runs of the same command. */
    const root = tempRoot();
    const a = join(root, "a.json");
    const b = join(root, "b.json");
    writeFileSync(a, JSON.stringify(payload()));
    writeFileSync(b, JSON.stringify({ ...payload(), question: "An entirely different question?", why: "For different reasons." }));

    const first = run(root, ["add", "--file", a, "--by", "overseer", "--command-id", "same-key"]);
    const second = run(root, ["add", "--file", b, "--by", "overseer", "--command-id", "same-key"]);

    expect(first.status).toBe(0);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/same-key/);
    expect(second.stderr).toMatch(/different/i);
    expect(records(root)).toHaveLength(1);
    expect(records(root)[0]).toMatchObject({ question: payload().question });
  });

  test("add writes a well-formed decided event and prints its id and version", () => {
    const root = tempRoot();
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload(["not-in-register"])));

    const result = run(root, ["add", "--file", file, "--by", "overseer", "--command-id", "command-1"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/dec-[23456789abcdefghjkmnpqrstvwxyz]{8}/);
    expect(result.stdout).toMatch(/version 1\.[0-9a-f-]+/);
    expect(records(root)).toEqual([
      expect.objectContaining({
        class: "decision",
        recordedBy: "overseer",
        question: payload().question,
        reviewed: false,
        reversed: false,
        bearsOn: {
          sessions: [{ name: "not-in-register", execution: { kind: "unavailable", why: expect.stringMatching(/checkpoint.*absent/i) } }],
          plan: null,
        },
      }),
    ]);
    const raw = readFileSync(join(root, DECISIONS_FILE), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toMatchObject({ kind: "decided", commandId: "command-1", by: "overseer" });
  });

  test("reads JSON from stdin when --file is -", () => {
    const root = tempRoot();
    const result = run(root, ["add", "--file", "-", "--by", "overseer"], JSON.stringify(payload()));
    expect(result.status).toBe(0);
    expect(records(root)).toHaveLength(1);
  });

  test("stores verified and not-found separately from a fresh checkpoint", () => {
    const root = tempRoot();
    checkpoint(root, [
      observedRow("known-session", "$731", "791b6ca1-0001-4000-8000-000000000731", {
        boot: "boot-cli-known",
        pid: 52731,
        startTicks: 81191,
      }),
    ]);
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload(["known-session", "missing-session"])));

    const result = run(root, ["add", "--file", file, "--by", "overseer"]);

    expect(result.status).toBe(0);
    expect(records(root)[0]?.bearsOn.sessions).toEqual([
      {
        name: "known-session",
        execution: {
          kind: "verified",
          token: "boot-cli-known:52731:81191",
          since: expect.any(String),
        },
      },
      { name: "missing-session", execution: { kind: "not-found" } },
    ]);
  });

  test("an unreadable checkpoint does not fail the write and records unavailable honestly", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), "not json");
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload(["unknown-now"])));
    const result = run(root, ["add", "--file", file, "--by", "overseer"]);
    expect(result.status).toBe(0);
    expect(records(root)[0]?.bearsOn.sessions).toEqual([
      { name: "unknown-now", execution: { kind: "unavailable", why: expect.stringMatching(/unreadable|malformed/i) } },
    ]);
  });

  test("two register entries with one name store unavailable and announce the ambiguity on stdout", () => {
    const root = tempRoot();
    checkpoint(root, [
      observedRow("shared-name", "$741", "791b6ca1-0002-4000-8000-000000000741", {
        boot: "boot-cli-a",
        pid: 52741,
        startTicks: 81201,
      }),
      observedRow("shared-name", "$742", "791b6ca1-0003-4000-8000-000000000742", {
        boot: "boot-cli-b",
        pid: 52742,
        startTicks: 81202,
      }),
    ]);
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload(["shared-name"])));

    const result = run(root, ["add", "--file", file, "--by", "overseer"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("shared-name");
    expect(result.stdout).toMatch(/ambiguous/i);
    expect(records(root)[0]?.bearsOn.sessions).toEqual([
      { name: "shared-name", execution: { kind: "unavailable", why: expect.stringMatching(/ambiguous/i) } },
    ]);
  });

  test("a stale checkpoint stores unavailable instead of drawing absence", () => {
    const root = tempRoot();
    checkpoint(root, []);
    const checkpointPath = join(root, "current.json");
    const current = JSON.parse(readFileSync(checkpointPath, "utf8")) as Record<string, unknown>;
    current["lastGoodSnapshotAt"] = "2026-09-09T09:00:00.000Z";
    current["snapshotStaleAfterMs"] = 1_000;
    writeFileSync(checkpointPath, JSON.stringify(current));
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload(["unknown-now"])));

    const result = run(root, ["add", "--file", file, "--by", "overseer"]);

    expect(result.status).toBe(0);
    expect(records(root)[0]?.bearsOn.sessions).toEqual([
      { name: "unknown-now", execution: { kind: "unavailable", why: expect.stringMatching(/stale/i) } },
    ]);
  });
});

describe("reading and Greg's two write commands", () => {
  test("show, export, reviewed and reversed all use the same record", () => {
    const root = tempRoot();
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload()));
    const added = run(root, ["add", "--file", file, "--by", "overseer"]);
    expect(added.status).toBe(0);
    const id = /dec-[23456789abcdefghjkmnpqrstvwxyz]{8}/.exec(added.stdout)?.[0];
    if (id === undefined) throw new Error(`no id in ${added.stdout}`);

    const shown = run(root, ["show", id]);
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({ id, reviewed: false });
    const exported = run(root, ["export"]);
    expect(exported.status).toBe(0);
    expect(exported.stdout).toBe(readFileSync(join(root, DECISIONS_FILE), "utf8"));

    const reviewed = run(root, ["reviewed", id, "--by", "greg", "--note", "read it"]);
    expect(reviewed.status).toBe(0);
    expect(records(root)[0]).toMatchObject({ reviewed: true, reviewNote: "read it", reversed: false });
    const reversed = run(root, ["reversed", id, "--by", "greg", "--why", "new evidence"]);
    expect(reversed.status).toBe(0);
    expect(records(root)[0]).toMatchObject({ reviewed: true, reversed: true, reversedWhy: "new evidence" });
  });

  test("reviewed and reversed also require --by", () => {
    const root = tempRoot();
    expect(run(root, ["reviewed", "dec-aaaaaaaa"]).status).not.toBe(0);
    expect(run(root, ["reversed", "dec-aaaaaaaa"]).status).not.toBe(0);
  });
});

describe("list and historical seed", () => {
  test("seed is idempotent by command id and preserves historical decision identity", () => {
    const root = tempRoot();

    const first = run(root, ["seed"]);
    const firstRaw = readFileSync(join(root, DECISIONS_FILE), "utf8");
    const firstEvent = JSON.parse(firstRaw) as Record<string, unknown>;
    const second = run(root, ["seed"]);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(readFileSync(join(root, DECISIONS_FILE), "utf8")).toBe(firstRaw);
    expect(records(root)).toHaveLength(1);
    expect(firstEvent["commandId"]).toBe("seed-2026-09-09-0812-claude-agents-dashboard-stage-6");
    expect(firstEvent["decidedAt"]).toBe("2026-09-09T08:12:00Z");
    expect(firstEvent["at"]).not.toBe(firstEvent["decidedAt"]);
    expect(firstEvent).toMatchObject({
      by: "overseer",
      class: "decision",
      question:
        "`claude-agents-dashboard` asked whether to continue its mechanical Stage 6 (catalogue → `wire.ts`) with Stage 5 blocked on the SessionDetail re-layout.",
      options: [
        {
          name: "Stop now and leave Stage 6 to a later session",
          tradeoffs: "Costs a fresh session's context to pick it up later.",
        },
        {
          name: "Continue as it was",
          tradeoffs: "A Claude session writing mechanical code against a 76% weekly window.",
        },
        {
          name: "Continue with Codex implementing",
          tradeoffs: "Bills the ChatGPT window at 24%.",
        },
      ],
      chose: {
        option: "Continue with Codex implementing",
        note: "Terra, mechanical; then debrief and stop.",
      },
      why:
        "The work is specified and mechanical, the session holds the context, and Greg's standing answer this morning is to delegate implementation to GPT.",
      advisers: ["nobody"],
      supersedes: null,
    });
    expect(firstEvent["bearsOn"]).toEqual({
      sessions: [
        {
          name: "claude-agents-dashboard",
          execution: { kind: "unavailable", why: "seeded from the hand-kept log" },
        },
      ],
      plan: null,
    });
  });

  test("list states unavailable aggregates as a sentence, never as zero", () => {
    const root = tempRoot();
    expect(run(root, ["seed"]).status).toBe(0);
    writeFileSync(join(root, DECISIONS_FILE), `${readFileSync(join(root, DECISIONS_FILE), "utf8")}not-json\n`);

    const result = run(root, ["list"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/counts? (?:is|are) unavailable/i);
    expect(result.stdout).toMatch(/seven days.*unavailable/i);
    expect(result.stdout).not.toMatch(/not yet reviewed:\s*0\b/i);
  });

  test("list calls an unreviewed superseded record superseded, never reviewed", () => {
    const root = tempRoot();
    expect(run(root, ["seed"]).status).toBe(0);
    const successor = {
      ...payload(),
      supersedes: "dec-dashstg6",
    };
    const file = join(root, "successor.json");
    writeFileSync(file, JSON.stringify(successor));
    expect(run(root, ["add", "--file", file, "--by", "overseer"]).status).toBe(0);

    const result = run(root, ["list"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/SUPERSEDED\s+dec-dashstg6/);
    expect(result.stdout).not.toMatch(/REVIEWED\s+dec-dashstg6/);
  });

  test("list applies class and pending filters to the shared projected rows", () => {
    const root = tempRoot();
    expect(run(root, ["seed"]).status).toBe(0);

    const wrongClass = run(root, ["list", "--class", "assumption", "--json"]);
    const pending = run(root, ["list", "--class", "decision", "--unreviewed", "--json"]);
    expect(wrongClass.status).toBe(0);
    expect((JSON.parse(wrongClass.stdout) as { records: unknown[] }).records).toEqual([]);
    expect((JSON.parse(pending.stdout) as { records: Array<{ record: { id: string } }> }).records.map((item) => item.record.id)).toEqual([
      "dec-dashstg6",
    ]);

    expect(run(root, ["reviewed", "dec-dashstg6", "--by", "greg"]).status).toBe(0);
    const afterReview = run(root, ["list", "--unreviewed", "--json"]);
    expect((JSON.parse(afterReview.stdout) as { records: unknown[] }).records).toEqual([]);
  });
});
