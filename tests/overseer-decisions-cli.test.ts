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
    decision: "Use the small shape.",
    why: "There is no demonstrated need for the extension points.",
    advisers: ["nobody"],
    bearsOn: { sessions, plan: null },
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
  const opened = openStore({ root, now: () => new Date("2026-09-09T10:00:00.000Z") });
  if (!opened.ok) throw new Error(describeRefusal(opened.refusal));
  stores.push(opened.store);
  const appended = opened.store.append(rows.map((row, index) => seen(row, `2026-09-09T09:0${index}:00.000Z`)));
  if (!appended.ok) throw new Error("the fixture store lost its lock");
  const written = opened.store.checkpoint({ lastGoodSnapshotAt: "2026-09-09T09:05:00.000Z", tick: true });
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
});

describe("add and register identity", () => {
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
        decidedBy: "overseer",
        recordedBy: "overseer",
        question: payload().question,
        reviewed: false,
        reversed: false,
        bearsOn: { sessions: [{ name: "not-in-register", executionToken: null }], plan: null },
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

  test("stores the verified execution token found at write time, and null for a missing name", () => {
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
      { name: "known-session", executionToken: "boot-cli-known:52731:81191" },
      { name: "missing-session", executionToken: null },
    ]);
  });

  test("an unreadable checkpoint does not fail the write and records null honestly", () => {
    const root = tempRoot();
    writeFileSync(join(root, "current.json"), "not json");
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload(["unknown-now"])));
    const result = run(root, ["add", "--file", file, "--by", "overseer"]);
    expect(result.status).toBe(0);
    expect(records(root)[0]?.bearsOn.sessions).toEqual([{ name: "unknown-now", executionToken: null }]);
  });

  test("two register entries with one name store null and announce the ambiguity on stdout", () => {
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
    expect(records(root)[0]?.bearsOn.sessions).toEqual([{ name: "shared-name", executionToken: null }]);
  });
});

describe("reading and Greg's two write commands", () => {
  test("list, class filtering, show, export, reviewed and reversed all use the same record", () => {
    const root = tempRoot();
    const file = join(root, "decision.json");
    writeFileSync(file, JSON.stringify(payload()));
    const added = run(root, ["add", "--file", file, "--by", "overseer"]);
    expect(added.status).toBe(0);
    const id = /dec-[23456789abcdefghjkmnpqrstvwxyz]{8}/.exec(added.stdout)?.[0];
    if (id === undefined) throw new Error(`no id in ${added.stdout}`);

    const listed = run(root, ["list", "--unreviewed"]);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain(id);
    expect(run(root, ["list", "--class", "assumption"]).stdout).not.toContain(id);
    expect(run(root, ["list", "--json"]).stdout).toContain('"records"');

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
