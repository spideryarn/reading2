// @vitest-environment jsdom
/**
 * The checks hook's two recovery paths: another tab becomes visible to this
 * one, and a broken SSE is reconciled before the same picks can be pressed
 * again. Plan 261008i stage 3.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DebateClaimCheck } from "../src/types.js";

const wire = vi.hoisted(() => ({
  getBodies: [] as { checks: DebateClaimCheck[] }[],
  apiFetch: vi.fn(),
  readAnswerStream: vi.fn(),
}));

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: wire.apiFetch,
  failure: async () => new Error("request refused"),
  readJson: async () => wire.getBodies.shift(),
}));

vi.mock("../src/web/lib/sse.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/lib/sse.js")>()),
  readAnswerStream: wire.readAnswerStream,
}));

const { useDebateChecks } = await import("../src/web/useDebateChecks.js");
type ChecksHook = ReturnType<typeof useDebateChecks>;

const TARGET = {
  kind: "listed" as const,
  claimId: "spya-claima",
  blockId: "spya-k3m9qt" as const,
  quote: "the article's words",
  statement: "The claim in plain words.",
};

function stored(status: DebateClaimCheck["status"]): DebateClaimCheck {
  return {
    id: "spya-checka",
    status,
    listSourceHash: "hash",
    promptVersion: "debate-check/1",
    digFurther: false,
    targets: [TARGET],
    results: status === "done" ? [{ claimId: TARGET.claimId, outcome: "answered", rows: [] }] : [],
    createdAt: "2026-10-09T10:00:00.000Z",
  };
}

let host: HTMLDivElement;
let root: Root;
let hook: ChecksHook;

function Harness() {
  hook = useDebateChecks("a-piece");
  return createElement("span", { "data-sending": hook.sending });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  wire.getBodies.length = 0;
  wire.apiFetch.mockReset();
  wire.readAnswerStream.mockReset();
  wire.apiFetch.mockResolvedValue({ ok: true, body: {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("checks made outside this tab", () => {
  it("reads again when the tab is focused and discovers another tab's pending check", async () => {
    wire.getBodies.push({ checks: [] });
    await act(async () => root.render(createElement(Harness)));
    await settle();
    expect(hook.status).toBe("ready");
    expect(wire.apiFetch).toHaveBeenCalledTimes(1);

    wire.getBodies.push({ checks: [stored("pending")] });
    window.dispatchEvent(new Event("focus"));
    await settle();

    expect(wire.apiFetch).toHaveBeenCalledTimes(2);
    expect(hook.checks).toEqual([stored("pending")]);
  });
});

describe("a broken answer stream", () => {
  it("keeps the press held through recovery and recognises the matching stored check", async () => {
    wire.getBodies.push({ checks: [] });
    await act(async () => root.render(createElement(Harness)));
    await settle();

    let resolveRecovery!: (value: unknown) => void;
    const recovery = new Promise((resolve) => (resolveRecovery = resolve));
    wire.apiFetch.mockImplementationOnce(async () => ({ ok: true, body: {} }));
    wire.apiFetch.mockImplementationOnce(async () => recovery);
    wire.readAnswerStream.mockRejectedValueOnce(new Error("stream stopped"));

    let outcome!: Promise<boolean>;
    act(() => {
      outcome = hook.check({ claimIds: [TARGET.claimId] });
    });
    await settle();
    expect(hook.sending).toBe(true);

    wire.getBodies.push({ checks: [stored("done")] });
    resolveRecovery({ ok: true, body: {} });
    let recovered = false;
    await act(async () => {
      recovered = await outcome;
    });

    expect(recovered).toBe(true);
    expect(hook.sending).toBe(false);
    expect(hook.checks).toEqual([stored("done")]);
  });
});
