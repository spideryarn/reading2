// @vitest-environment jsdom
/** Real thread controller and URL selection; transport alone is replaced. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LiveOptions } from "../src/web/live/useLiveConversation.js";

let panel: Record<string, unknown> = {};
let options: LiveOptions;
const starts: { id: string; selected: unknown }[] = [];
let stops = 0;
const STORED_ID = "spya-k3m9qt";

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => { panel = props; return null; },
}));
vi.mock("../src/web/lib/api.js", async (original) => ({
  ...await original<typeof import("../src/web/lib/api.js")>(),
  apiFetch: async () => new Response(JSON.stringify({ threads: [{
    id: "spya-k3m9qt", kind: "chat", title: "Earlier chat", createdAt: "2026-09-06T00:00:00Z",
    updatedAt: "2026-09-06T00:00:00Z", messages: [],
  }] }), { headers: { "content-type": "application/json" } }),
}));
vi.mock("../src/web/live/useLiveConversation.js", async () => {
  const { useCallback, useState } = await import("react");
  return {
    useLiveConversation: (_slug: string, next: LiveOptions) => {
      options = next;
      const [state, setState] = useState<{ phase: string; threadId: string | null }>({ phase: "idle", threadId: null });
      const start = useCallback(({ threadId }: { threadId: string }) => {
        starts.push({ id: threadId, selected: panel.threadId });
        setState({ phase: "connecting", threadId });
      }, []);
      const stop = useCallback(async () => {
        stops++;
        setState({ phase: "idle", threadId: null });
      }, []);
      return { ...state, start, stop };
    },
  };
});

/* `ConversationBand` left `App.tsx` for a mode module of its own on
   2026-09-06 (260906c § Stage 3). A **dynamic** import, which is why the
   direction guards did not flag this one when the move landed — see
   `refuseUntraceableImports` in tests/helpers/ts-ast.ts, and F21. */
const { ConversationBand } = await import(
  "../src/web/modes/conversation/ConversationModes.js"
);
enableHistorySync();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  starts.length = 0;
  stops = 0;
  panel = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

async function mount(thread: string | null) {
  history.replaceState(null, "", `/a-piece?mode=chat${thread ? `&thread=${thread}` : ""}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(ConversationBand, {
      slug: "a-piece", blocks: new Map(), onJump: () => {}, kind: "chat", onMode: () => {},
    })));
  });
  await act(async () => { await vi.waitFor(() => expect(panel.loaded).toBe(true)); });
}

async function waitForThread(id: string | null) {
  await act(async () => {
    await vi.waitFor(() => expect(new URLSearchParams(location.search).get("thread")).toBe(id));
  });
}

it("creates and selects a new thread before starting Live, without cancelling its own startup", async () => {
  await mount(null);
  let created: string | undefined;
  act(() => { created = (panel.onStartLive as (id: null) => string)(null); });
  expect(created).toMatch(/^spya-/);
  expect(created).not.toBe(STORED_ID);
  await waitForThread(created!);
  expect(starts).toEqual([{ id: created, selected: created }]);
  expect(stops).toBe(0);
});

it("resumes the selected thread without creating another one", async () => {
  await mount(STORED_ID);
  act(() => { (panel.onStartLive as (id: string) => string)(STORED_ID); });
  await waitForThread(STORED_ID);
  expect(starts).toEqual([{ id: STORED_ID, selected: STORED_ID }]);
  expect((panel.threads as unknown[]).length).toBe(1);
  expect(stops).toBe(0);
});

it("does not follow a late spoken append back into the thread the reader left", async () => {
  await mount(STORED_ID);
  const late = options.onThreadId;
  act(() => { (panel.onThread as (id: null) => void)(null); });
  await waitForThread(null);
  act(() => { late?.("spya-c2r3ct", STORED_ID); });
  // Flushing another URL write would expose a callback that incorrectly navigated.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  expect(panel.threadId).toBeNull();
  expect(new URLSearchParams(location.search).get("thread")).toBeNull();
});
