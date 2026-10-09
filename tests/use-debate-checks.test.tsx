// @vitest-environment jsdom
/**
 * The checks hook's recovery paths: another tab becomes visible to this one,
 * a broken SSE is reconciled before the same picks can be pressed again, and
 * overlapping reads land newest-wins. Plan 261008i stage 3.
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
  /* A reply that carries its own body answers with it, so a case can settle
     overlapping reads out of order; otherwise the next queued body. */
  readJson: async (res: { jsonBody?: unknown } | undefined) => res?.jsonBody ?? wire.getBodies.shift(),
}));

vi.mock("../src/web/lib/sse.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/lib/sse.js")>()),
  readAnswerStream: wire.readAnswerStream,
}));

const { PENDING_POLL_MS, useDebateChecks } = await import("../src/web/useDebateChecks.js");
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

function storedAs(id: string, status: DebateClaimCheck["status"]): DebateClaimCheck {
  return { ...stored(status), id };
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

  it("recovers the row named by begin, not another tab's identical check", async () => {
    vi.useFakeTimers();
    try {
      wire.getBodies.push({ checks: [] });
      await act(async () => root.render(createElement(Harness)));
      await settle();

      const other = storedAs("spya-other", "done");
      const ownPending = storedAs("spya-own", "pending");
      const ownDone = storedAs("spya-own", "done");
      wire.apiFetch.mockImplementationOnce(async () => ({ ok: true, body: {} }));
      wire.apiFetch.mockImplementationOnce(async () => ({
        ok: true,
        body: {},
        jsonBody: { checks: [other, ownPending] },
      }));
      wire.apiFetch.mockImplementationOnce(async () => ({
        ok: true,
        body: {},
        jsonBody: { checks: [other, ownDone] },
      }));
      wire.readAnswerStream.mockImplementationOnce(
        async (_body: unknown, handlers: { begin(data: unknown): void }) => {
          handlers.begin(ownPending);
          throw new Error("stream stopped after begin");
        },
      );

      let settled = false;
      let outcome!: Promise<boolean>;
      act(() => {
        outcome = hook.check({ claimIds: [TARGET.claimId] }).then((value) => {
          settled = true;
          return value;
        });
      });
      await settle();

      expect(settled).toBe(false);
      expect(hook.sending).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PENDING_POLL_MS);
        expect(await outcome).toBe(true);
      });
      expect(hook.checks).toEqual([other, ownDone]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("overlapping reads (GPT Sol's E11)", () => {
  it("never lets an older read's reply overwrite a newer one's", async () => {
    wire.getBodies.push({ checks: [] });
    await act(async () => root.render(createElement(Harness)));
    await settle();

    let olderReply!: (value: unknown) => void;
    let newerReply!: (value: unknown) => void;
    wire.apiFetch.mockImplementationOnce(() => new Promise((resolve) => (olderReply = resolve)));
    wire.apiFetch.mockImplementationOnce(() => new Promise((resolve) => (newerReply = resolve)));

    let older!: Promise<void>;
    let newer!: Promise<void>;
    act(() => {
      older = hook.refresh();
      newer = hook.refresh();
    });
    await act(async () => {
      newerReply({ ok: true, body: {}, jsonBody: { checks: [stored("done")] } });
      await newer;
    });
    expect(hook.checks).toEqual([stored("done")]);

    await act(async () => {
      olderReply({ ok: true, body: {}, jsonBody: { checks: [stored("pending")] } });
      await older;
    });
    expect(hook.checks).toEqual([stored("done")]);
  });

  it("never lets a read sent before the answer frame overwrite the answer", async () => {
    wire.getBodies.push({ checks: [] });
    await act(async () => root.render(createElement(Harness)));
    await settle();

    let staleReply!: (value: unknown) => void;
    wire.apiFetch.mockImplementationOnce(() => new Promise((resolve) => (staleReply = resolve)));
    let stale!: Promise<void>;
    act(() => {
      stale = hook.refresh();
    });

    wire.apiFetch.mockImplementationOnce(async () => ({ ok: true, body: {} }));
    wire.readAnswerStream.mockImplementationOnce(async () => stored("done"));
    await act(async () => {
      await hook.check({ claimIds: [TARGET.claimId] });
    });
    expect(hook.checks).toEqual([stored("done")]);

    await act(async () => {
      staleReply({ ok: true, body: {}, jsonBody: { checks: [stored("pending")] } });
      await stale;
    });
    expect(hook.checks).toEqual([stored("done")]);
  });

  it("never lets a delayed begin frame regress a stored answer to pending", async () => {
    wire.getBodies.push({ checks: [] });
    await act(async () => root.render(createElement(Harness)));
    await settle();

    let begin!: (data: unknown) => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    wire.apiFetch.mockImplementationOnce(async () => ({ ok: true, body: {} }));
    wire.readAnswerStream.mockImplementationOnce(
      async (_body: unknown, handlers: { begin(data: unknown): void }) => {
        begin = handlers.begin;
        await held;
        return stored("done");
      },
    );

    let outcome!: Promise<boolean>;
    act(() => {
      outcome = hook.check({ claimIds: [TARGET.claimId] });
    });
    await settle();

    wire.apiFetch.mockImplementationOnce(async () => ({
      ok: true,
      body: {},
      jsonBody: { checks: [stored("done")] },
    }));
    await act(async () => hook.refresh());
    expect(hook.checks).toEqual([stored("done")]);

    act(() => begin(stored("pending")));
    expect(hook.checks).toEqual([stored("done")]);

    await act(async () => {
      release();
      expect(await outcome).toBe(true);
    });
  });
});
