// @vitest-environment jsdom
/** The box confirmation is executable only when every part of one server receipt agrees. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BoxActions } from "../tools/fleet/web/src/ActionButtons";
import { makeActionsApi, parseActionsFeed, type ActionsApi, type BoxOutcome } from "../tools/fleet/web/src/actions-client";
import type { FleetActionPreview } from "../tools/fleet/wire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const KILL = {
  effect: "enacted",
  id: "kill-test-suites",
  scope: "box",
  label: "Kill test suites",
  summary: "SIGTERM every vitest runner on the box.",
  needsConfirm: true,
  gate: "Each pid must still match the test-suite rule.",
};

const BROADCAST = {
  effect: "broadcast",
  id: "resource-broadcast",
  scope: "box",
  label: "Broadcast: ease off, staggered",
  summary: "Tell every steerable session to ease off.",
  needsConfirm: true,
  stagger: { minMinutes: 5, windowMinutes: 60 },
};

function feed(actions: unknown[]) {
  const parsed = parseActionsFeed({ actions: { session: [], box: actions }, queues: [] });
  if (parsed === null) throw new Error("the action fixture did not parse");
  return parsed;
}

function killAnswer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    op: "dry-run",
    action: "kill-test-suites",
    dryRun: true,
    result: {
      candidates: [
        { pid: 5001, comm: "node", args: `node ${"very-long-argument ".repeat(12)}`, rule: "vitest-runner", why: "argv names vitest" },
      ],
    },
    preview: {
      schema: "fleet-action-preview/1",
      previewId: "box-a-p1",
      serverInstanceId: "box-a",
      actionId: "kill-test-suites",
      expiresAt: Date.now() + 60_000,
      material: { kind: "kill", confirmable: [{ pid: 5001, startTicks: 10, bootId: "boot-a" }], excluded: [] },
    },
    ...over,
  };
}

function broadcastAnswer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    op: "broadcast-preview",
    action: "resource-broadcast",
    dryRun: true,
    result: { sample: "Greg says: pause for 5 minutes, then continue.", recipients: [] },
    preview: {
      schema: "fleet-action-preview/1",
      previewId: "box-a-p2",
      serverInstanceId: "box-a",
      actionId: "resource-broadcast",
      expiresAt: Date.now() + 60_000,
      material: {
        kind: "broadcast",
        speaker: "greg",
        recipients: [
          {
            paneId: "%1",
            sessionId: "$1",
            claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
            panePid: 1001,
            status: { kind: "idle" },
            minutes: 5,
          },
        ],
      },
    },
    ...over,
  };
}

function apiAnswer(answer: Record<string, unknown>): ActionsApi {
  const fetcher = (async () => ({ status: 200, json: async () => answer }) as Response) as typeof fetch;
  return makeActionsApi(fetcher);
}

function renderActions(actions: unknown[], api: ActionsApi): void {
  act(() => root.render(<BoxActions feed={feed(actions)} api={api} asked={true} error={null} onChanged={() => {}} rows={[]} />));
}

function button(label: string): HTMLButtonElement | null {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(label)) ?? null;
}

async function press(label: string): Promise<void> {
  const found = button(label);
  if (found === null) throw new Error(`no ${JSON.stringify(label)} button in ${container.textContent ?? ""}`);
  await act(async () => found.click());
}

function expectNoConfirm(): void {
  expect([...container.querySelectorAll("button")].some((item) => item.textContent?.startsWith("Yes —"))).toBe(false);
}

describe("only a complete, agreeing receipt becomes a confirmation", () => {
  it("offers no executable confirm for an older answer with no envelope", async () => {
    const answer = killAnswer();
    delete answer.preview;
    renderActions([KILL], apiAnswer(answer));
    await press("Kill test suites");
    expectNoConfirm();
  });

  it.each([
    ["absent", undefined],
    ["false", false],
  ])("offers no confirm when dryRun is %s", async (_name, dryRun) => {
    const answer = killAnswer();
    if (dryRun === undefined) delete answer.dryRun;
    else answer.dryRun = dryRun;
    renderActions([KILL], apiAnswer(answer));
    await press("Kill test suites");
    expectNoConfirm();
  });

  it("rejects a material list when even one entry is only half parsable", async () => {
    const answer = killAnswer();
    const preview = answer.preview as Record<string, unknown>;
    preview.material = {
      kind: "kill",
      confirmable: [{ pid: 5001, startTicks: 10, bootId: "boot-a" }, { pid: 5002, bootId: "boot-a" }],
      excluded: [],
    };
    renderActions([KILL], apiAnswer(answer));
    await press("Kill test suites");
    expectNoConfirm();
  });

  it("rejects an envelope naming a different action from the button", async () => {
    const answer = killAnswer();
    (answer.preview as Record<string, unknown>).actionId = "kill-safe-processes";
    renderActions([KILL], apiAnswer(answer));
    await press("Kill test suites");
    expectNoConfirm();
  });

  it.each([
    [KILL, "Kill test suites", killAnswer({ op: "ran" })],
    [BROADCAST, "Broadcast: ease off, staggered", broadcastAnswer({ op: "dry-run" })],
  ])("rejects a contradictory operation for $label", async (action, label, answer) => {
    renderActions([action], apiAnswer(answer));
    await press(label);
    expectNoConfirm();
  });
});

function parsedPreview(answer: Record<string, unknown>, actionId: string): Promise<BoxOutcome> {
  return makeActionsApi((async () => ({ status: 200, json: async () => answer }) as Response) as typeof fetch).boxPreview(actionId, []);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

it("discards an older preview response and confirms only the newer envelope", async () => {
  const a = deferred<BoxOutcome>();
  const b = deferred<BoxOutcome>();
  const confirmed: FleetActionPreview[] = [];
  const ordinary = makeActionsApi();
  const api: ActionsApi = {
    ...ordinary,
    boxPreview: (actionId) => actionId === "kill-test-suites" ? a.promise : b.promise,
    boxConfirm: async (preview) => {
      confirmed.push(preview);
      return { ok: true, op: "broadcast", action: preview.actionId, dryRun: false, dryRunStated: true, preview: null, result: {}, why: null, effect: null };
    },
  };
  renderActions([KILL, BROADCAST], api);
  const kill = button("Kill test suites");
  const broadcast = button("Broadcast: ease off, staggered");
  if (kill === null || broadcast === null) throw new Error("both action buttons were not rendered");
  act(() => {
    kill.click();
    broadcast.click();
  });

  await act(async () => b.resolve(await parsedPreview(broadcastAnswer(), "resource-broadcast")));
  expect(container.textContent).toContain("Confirm: Broadcast: ease off, staggered");
  await act(async () => a.resolve(await parsedPreview(killAnswer(), "kill-test-suites")));
  expect(container.textContent).toContain("Confirm: Broadcast: ease off, staggered");
  expect(container.textContent).not.toContain("Confirm: Kill test suites");

  await press("Yes — Broadcast: ease off, staggered");
  expect(confirmed.map((preview) => preview.previewId)).toEqual(["box-a-p2"]);
});

it("shows every confirmable and excluded process, with explicit counts and reasons", async () => {
  const answer = killAnswer();
  const preview = answer.preview as Record<string, unknown>;
  preview.material = {
    kind: "kill",
    confirmable: [{ pid: 5001, startTicks: 10, bootId: "boot-a" }],
    excluded: [
      { pid: 5002, why: "the process vanished before its identity could be read" },
      { pid: 5003, why: "the pid changed process while the preview was being built" },
    ],
  };
  renderActions([KILL], apiAnswer(answer));
  await press("Kill test suites");

  expect(container.textContent).toContain("1 confirmable process");
  expect(container.textContent).toContain("2 excluded processes");
  expect(container.textContent).toContain("pid 5001");
  expect(container.textContent).toContain("matched rule: vitest-runner");
  expect(container.textContent).toContain("the process vanished before its identity could be read");
  expect(container.textContent).toContain("the pid changed process while the preview was being built");
  expect(button("Yes — Kill test suites")).not.toBeNull();
  const diagnostic = [...container.querySelectorAll("details")].find((detail) => detail.textContent?.includes("Diagnostic detail"));
  expect(diagnostic?.open).toBe(false);
});

it("shows the broadcast's recipients, promised pauses, sampled sentence, and exact action words", async () => {
  renderActions([BROADCAST], apiAnswer(broadcastAnswer()));
  await press("Broadcast: ease off, staggered");

  expect(container.textContent).toContain("1 recipient");
  expect(container.textContent).toContain("$1");
  expect(container.textContent).toContain("%1");
  expect(container.textContent).toContain("pause for 5 minutes");
  expect(container.textContent).toContain("Greg says: pause for 5 minutes, then continue.");
  expect(button("Yes — Broadcast: ease off, staggered")).not.toBeNull();
});
