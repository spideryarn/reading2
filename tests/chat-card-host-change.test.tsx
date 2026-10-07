// @vitest-environment jsdom
/** Real Reader and ChatDialog; the table seam synchronously draws the margin
    map, so changing the anchor removes the old host during the same commit. */
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, expect, it, vi } from "vitest";
import type { Article, BlockId, ChatThread } from "../src/types.js";
import type { ReaderCapability } from "../src/web/reader-capability.js";

const probe = vi.hoisted(() => ({ table: vi.fn() }));
vi.mock("../src/web/TableView.js", () => ({
  TableView: (props: { article: Article; margin?: ReadonlyMap<BlockId, ReactElement> }) => {
    probe.table(props);
    return (
      <table><tbody>{props.article.blocks.map((block) => (
        <tr key={block.id} data-block={block.id}><td className="text">{props.margin?.get(block.id)}</td></tr>
      ))}</tbody></table>
    );
  },
}));
vi.mock("../src/web/useExperimental.js", () => ({ useExperimental: () => ({ on: true }) }));
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));
vi.mock("../src/web/Masthead.js", () => ({ Masthead: () => null }));
/* The component only: Reader also calls the Dock's mode activators and
   `visibleModes` for chat's `mode` chips (plan 261007j). */
vi.mock("../src/web/Dock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/Dock.js")>()),
  Dock: () => null,
}));
vi.mock("../src/web/reader/measure.js", () => ({ useWindowWidth: () => 1600, useRootFontPx: () => 16 }));
vi.mock("../src/web/marginalia/MarginaliaColumn.js", async (original) => ({
  ...await original<typeof import("../src/web/marginalia/MarginaliaColumn.js")>(),
  OwnerMarginFeed: () => null, MarginaliaHead: () => null, useMarginLayout: () => {},
}));
vi.mock("../src/web/useProfile.js", () => ({
  useProfile: () => ({ profile: null, loaded: true, save: () => {}, error: null }),
}));
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    threads, loaded: true, loadFailed: false, recovering: new Set<string>(),
    send: () => "", speak: () => "", cancelAndDiscard: () => {}, retry: () => {}, edit: () => {},
    stop: () => {}, begin: () => {}, discard: () => {}, rename: () => {}, remove: () => {}, error: null,
  }),
}));

import { Reader } from "../src/web/reader/Reader.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const A = "spya-host01" as BlockId;
const B = "spya-host02" as BlockId;
const AT = "2026-10-04T10:00:00.000Z";
const threads: ChatThread[] = [A, B].map((blockId, index) => ({
  id: `spya-chat0${index}`, kind: "chat", title: `Question ${index}`, createdAt: AT, updatedAt: AT,
  anchor: { blockId },
  messages: [
    { id: `spya-user0${index}`, role: "user", text: "why?", status: "done", createdAt: AT },
    { id: `spya-asst0${index}`, role: "assistant", text: "Because.", status: "done", createdAt: AT },
  ],
}));
const article = {
  meta: { slug: "host-change", title: "Host change", source: "url" },
  blocks: [A, B].map((id) => ({ id, tag: "p", kind: "paragraph", text: "A paragraph.", words: 2,
    html: "<p>A paragraph.</p>", gistable: true, isStructural: true })),
  tree: { root: "root", nodes: [{ id: "root", parent: null, children: [], depth: 0,
    title: "Host change", gist: "A paragraph.", range: [A, B] }] },
} as unknown as Article;
const emptyRead = { status: "none", stale: false };
const owner = {
  kind: "owner",
  comments: { comments: [], loaded: true, loadError: null, error: null, create: () => {} },
  chatAnchors: { summaries: threads.map((t) => ({ ...t, turns: 1 })), add: () => {}, drop: () => {} },
  glossary: { ...emptyRead, glossary: null }, quotes: { ...emptyRead, quotes: null },
  citations: { ...emptyRead, citations: null }, quiz: { ...emptyRead, quiz: null },
  crossrefs: null, arc: { arc: null },
  readingTime: { levels: new Map(), reach: new Map(), status: "loaded", setCounting: () => {}, timeFor: () => null },
} as unknown as ReaderCapability;

let cleanup = () => {};
afterEach(() => cleanup());
it("keeps focus inside the live conversation when its anchor host is replaced", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  cleanup = () => { act(() => root.unmount()); el.remove(); };
  await act(async () => root.render(
    <NuqsTestingAdapter searchParams="?margin=1&spine=1" hasMemory>
      <Reader slug="host-change" article={article} capability={owner} />
    </NuqsTestingAdapter>,
  ));
  const open = (id: string) => {
    const props = probe.table.mock.lastCall?.[0] as { onOpenChat: (id: string) => void } | undefined;
    if (!props) throw new Error("Reader did not draw the table");
    props.onOpenChat(id);
  };
  await act(async () => open(threads[0]!.id));
  const firstHost = el.querySelector(`[data-block="${A}"] [data-chat-card-host]`);
  const close = firstHost?.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  expect(close).toBeTruthy();
  act(() => close?.focus());
  expect(document.activeElement).toBe(close);

  await act(async () => open(threads[1]!.id));
  const secondHost = el.querySelector(`[data-block="${B}"] [data-chat-card-host]`);
  expect(secondHost?.querySelector("aside.chat-dialog")).toBeTruthy();
  expect(firstHost?.isConnected).toBe(false);
  expect(secondHost?.querySelector('button[aria-label="Close"]')).toBe(close);
  expect(document.activeElement).toBe(close);
});
