/** The daemon takes one work reading only for inventories it will checkpoint. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runOverseer, type DaemonOptions } from "../tools/overseer/daemon.js";
import { identityOf, sessionKey } from "../tools/overseer/diff.js";
import { parseObservation, type JsonValue } from "../tools/overseer/observation.js";
import { CHECKPOINT_FILE } from "../tools/overseer/store.js";
import { parseProcessTable, type ProcessTableReading } from "../tools/overseer/work.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import { editableFixture, rawFixture, rowsOf, type FixtureName } from "./overseer-fixtures.js";

const roots: string[] = [];
const TREE = join(import.meta.dirname, "fixtures", "overseer-process-trees", "codex-review-under-pane.txt");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-daemon-work-"));
  roots.push(root);
  return root;
}

function fakeClock(startIso: string): { now: () => Date; advance(ms: number): void; ms(): number } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by) => (ms += by), ms: () => ms };
}

function payload(json: JsonValue): SourceMessage {
  return { kind: "payload", via: "sse", atMs: 0, json };
}

function fixtureWith(name: FixtureName, changes: Record<string, JsonValue>): JsonValue {
  return { ...editableFixture(name), ...changes } as unknown as JsonValue;
}

function fixtureWithCodexPane(name: FixtureName): { json: JsonValue; key: string } {
  const snapshot = editableFixture(name);
  const rows = rowsOf(snapshot);
  const row = rows[0];
  if (row === undefined) throw new Error("fixture has no row");
  row.panePid = 3184904;
  const parsed = parseObservation(snapshot as unknown as JsonValue);
  if (!parsed.ok) throw new Error(parsed.reason);
  const observed = parsed.value.rows[0];
  if (observed === undefined) throw new Error("parsed fixture has no row");
  return { json: snapshot as unknown as JsonValue, key: sessionKey(identityOf(observed)) };
}

function capturedReading(atMs: number): ProcessTableReading {
  const parsed = parseProcessTable(readFileSync(TREE, "utf8"), atMs);
  if (!parsed.ok) throw new Error(parsed.reason);
  return { read: true, rows: parsed.rows, atMs };
}

async function run(
  root: string,
  script: () => AsyncGenerator<SourceMessage>,
  input: { clock: ReturnType<typeof fakeClock>; probe: NonNullable<DaemonOptions["probe"]>; tickMs?: number },
): Promise<void> {
  const controller = new AbortController();
  const outcome = await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:0",
    signal: controller.signal,
    now: input.clock.now,
    tickMs: input.tickMs ?? 5,
    log: () => undefined,
    source: () => script(),
    probe: input.probe,
  });
  expect(outcome.kind).toBe("stopped");
}

function current(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, CHECKPOINT_FILE), "utf8")) as Record<string, unknown>;
}

describe("probe cadence", () => {
  test("exactly one probe runs for each inventory that reaches a checkpoint", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    let probes = 0;
    await run(
      root,
      async function* () {
        yield payload(rawFixture("session-new-before"));
        yield payload(rawFixture("session-new-after"));
      },
      { clock, probe: () => { probes += 1; return capturedReading(clock.ms()); } },
    );
    expect(probes).toBe(2);
  });

  test("duplicates, rejected payloads, held diffs and heartbeat ticks do not probe", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    let probes = 0;
    await run(
      root,
      async function* () {
        yield payload(rawFixture("session-new-before"));
        await new Promise((resolve) => setTimeout(resolve, 25));
        yield payload(rawFixture("session-new-before"));
        yield payload(fixtureWith("session-new-after", { error: "tmux failed" }));
        yield payload(fixtureWith("session-new-after", { tmuxServerPid: null, collectedAt: "2026-09-08T02:48:00.000Z" }));
        await new Promise((resolve) => setTimeout(resolve, 25));
      },
      { clock, tickMs: 5, probe: () => { probes += 1; return capturedReading(clock.ms()); } },
    );
    // The first accepted inventory is the sole checkpointing inventory. Every
    // later case above is deliberately on a path where its own increment is 0.
    expect(probes).toBe(1);
    const heartbeat = current(root).heartbeat as { ticks: number };
    expect(heartbeat.ticks).toBeGreaterThan(0);
  });
});

describe("published work evidence", () => {
  test("the captured depth-eight codex job reaches current.json under the session key", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    const fixture = fixtureWithCodexPane("session-new-before");
    await run(root, async function* () { yield payload(fixture.json); }, { clock, probe: () => capturedReading(clock.ms()) });

    const work = current(root).work as {
      kind: string;
      scannedAt: string;
      panes: { key: string; work: { kind: string; jobs?: Record<string, unknown>[] } }[];
    };
    expect(work.kind).toBe("scan");
    const pane = work.panes.find((entry) => entry.key === fixture.key);
    expect(pane?.work.kind).toBe("work");
    expect(pane?.work.jobs?.[0]).toMatchObject({
      recogniser: "codex-exec",
      label: "GPT review or task (non-interactive codex)",
      depth: 8,
      startedAt: new Date(clock.ms() - 4_000).toISOString(),
      ranForMs: 4_000,
      command: "codex exec",
    });
  });

  test("a failed probe is probe-failed, carries why, and has no panes", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    await run(root, async function* () { yield payload(rawFixture("session-new-before")); }, {
      clock,
      probe: () => ({ read: false, why: "ps exited 1: /proc missing" }),
    });
    expect(current(root).work).toMatchObject({ kind: "probe-failed", why: "ps exited 1: /proc missing" });
    expect(current(root).work).not.toHaveProperty("panes");
  });

  test("a throwing probe is contained and the daemon still checkpoints why", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    await run(root, async function* () { yield payload(rawFixture("session-new-before")); }, {
      clock,
      probe: () => { throw new Error("ps wrapper exploded"); },
    });
    expect(current(root).work).toMatchObject({ kind: "probe-failed", why: expect.stringContaining("ps wrapper exploded") });
  });

  test("a pane absent from the table is cannot-tell, not none", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    const source = fixtureWithCodexPane("session-new-before");
    const table = capturedReading(clock.ms());
    if (!table.read) throw new Error("unreachable");
    await run(root, async function* () { yield payload(source.json); }, {
      clock,
      probe: () => ({ read: true, rows: table.rows.filter((row) => row.pid !== 3184904), atMs: table.atMs }),
    });
    const work = current(root).work as { panes: { key: string; work: Record<string, unknown> }[] };
    expect(work.panes.find((pane) => pane.key === source.key)?.work).toMatchObject({ kind: "cannot-tell", cause: "pane-not-in-table" });
  });

  test("a row with null pane pid still has a cannot-tell entry", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    const snapshot = editableFixture("session-new-before");
    const row = rowsOf(snapshot)[0];
    if (row === undefined) throw new Error("fixture has no row");
    row.panePid = null;
    const parsed = parseObservation(snapshot as unknown as JsonValue);
    if (!parsed.ok) throw new Error(parsed.reason);
    const observed = parsed.value.rows[0];
    if (observed === undefined) throw new Error("parsed fixture has no row");
    const key = sessionKey(identityOf(observed));
    await run(root, async function* () { yield payload(snapshot as unknown as JsonValue); }, { clock, probe: () => capturedReading(clock.ms()) });
    const work = current(root).work as { panes: { key: string; work: Record<string, unknown> }[] };
    expect(work.panes.find((pane) => pane.key === key)?.work).toMatchObject({ kind: "cannot-tell", cause: "no-pane-pid" });
  });

  test("sourceCollectedAt is the inventory's clock, not the daemon clock", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T02:48:40.000Z");
    const json = rawFixture("session-new-before");
    const parsed = parseObservation(json);
    if (!parsed.ok) throw new Error(parsed.reason);
    if (!parsed.value.clock.collected) throw new Error("fixture has no collection clock");
    const sourceCollectedAt = parsed.value.clock.at;
    expect(sourceCollectedAt).not.toBe(clock.now().toISOString());
    await run(root, async function* () { yield payload(json); }, { clock, probe: () => capturedReading(clock.ms()) });
    expect(current(root).work).toMatchObject({ sourceCollectedAt });
  });
});
