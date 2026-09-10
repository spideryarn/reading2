// @vitest-environment jsdom
/** A real daemon over controlled source/probe inputs, through the production payload and browser DOM. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";

import { readCheckpointFeeds } from "../tools/fleet/overseer-status.js";
import { statePayload } from "../tools/fleet/state.js";
import { OverseerStatusCard } from "../tools/fleet/web/src/OverseerPanel";
import { parseFleetState } from "../tools/fleet/web/src/types";
import { runOverseer } from "../tools/overseer/daemon.js";
import type { JsonValue } from "../tools/overseer/observation.js";
import { parseProcessTable } from "../tools/overseer/work.js";
import type { SourceMessage } from "../tools/overseer/source.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SNAPSHOT = join(process.cwd(), "tests", "fixtures", "overseer-snapshots", "session-new-before.json");
const PROCESS_TREE = join(
  process.cwd(),
  "tests",
  "fixtures",
  "overseer-process-trees",
  "codex-review-under-pane.txt",
);
const SCANNED_AT_MS = Date.parse("2026-09-08T02:48:40.000Z");

let container: HTMLDivElement;
let reactRoot: Root;
const storeRoots: string[] = [];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
});

afterEach(() => {
  act(() => reactRoot.unmount());
  container.remove();
  for (const root of storeRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("recognised child work reaches the browser through the real daemon, projection and parser", async () => {
  const storeRoot = mkdtempSync(join(tmpdir(), "fleet-work-evidence-e2e-"));
  storeRoots.push(storeRoot);

  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as JsonValue;
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    throw new Error("fixture is not an object");
  }
  const rows = snapshot.rows;
  if (!Array.isArray(rows)) throw new Error("fixture has no rows");
  const pane = rows[0];
  if (pane === null || Array.isArray(pane) || typeof pane !== "object") throw new Error("fixture has no pane");
  pane.panePid = 3_184_904;

  const reading = parseProcessTable(readFileSync(PROCESS_TREE, "utf8"), SCANNED_AT_MS);
  if (!reading.ok) throw new Error(reading.reason);
  const message: SourceMessage = { kind: "payload", via: "sse", atMs: SCANNED_AT_MS, json: snapshot };

  const outcome = await runOverseer({
    root: storeRoot,
    baseUrl: "http://127.0.0.1:0",
    signal: new AbortController().signal,
    now: () => new Date(SCANNED_AT_MS),
    log: () => undefined,
    source: async function* () {
      yield message;
    },
    probe: () => ({ read: true, rows: reading.rows, atMs: SCANNED_AT_MS }),
  });
  expect(outcome.kind).toBe("stopped");

  /* Use the production payload composition and outer browser parser. Passing
     the projected object straight to `parseOverseer` would leave the HTTP JSON
     seam and the top-level `overseer` field untested. */
  const payload: unknown = JSON.parse(
    statePayload({
      snapshot: null,
      error: null,
      health: null,
      refreshMs: 60_000,
      answeringEnabled: true,
      attemptedAt: null,
      producer: { instance: "1a2b3c4d", publication: 0, inventory: null },
      readCheckpoint: () => readCheckpointFeeds(storeRoot),
    }),
  );
  const receivedAt = Date.now();
  const read = parseFleetState(payload, receivedAt);
  expect(read.ok, read.ok ? "" : read.why).toBe(true);
  if (!read.ok) return;
  act(() => reactRoot.render(<OverseerStatusCard overseer={read.state.overseer} now={receivedAt} receivedAt={receivedAt} />));

  const text = (container.textContent ?? "").replace(/\s+/g, " ");
  expect(text).toContain("pane: idle · work:");
  expect(text).toContain("GPT review");
  expect(text).toContain("running 4s");
});
