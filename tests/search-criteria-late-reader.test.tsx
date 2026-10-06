// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Session { access_token: string; user: { id: string } }
const sessionFor = (id: string): Session => ({ access_token: `TOKEN-${id}`, user: { id } });
let session = sessionFor("A");
let announce: (event: string, session: Session) => void;
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: { auth: {
    getSession: async () => ({ data: { session } }),
    refreshSession: async () => ({ data: { session } }),
    onAuthStateChange: (fn: typeof announce) => {
      announce = fn;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  } },
}));

const { useSearch } = await import("../src/web/useSearch.js");
const { useCriteria } = await import("../src/web/useCriteria.js");
const { SignedInReader } = await import("../src/web/lib/made-for.js");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let search: ReturnType<typeof useSearch>;
let criteria: ReturnType<typeof useCriteria>;
function Harness() {
  search = useSearch("paper");
  criteria = useCriteria("paper");
  return null;
}
const response = () => new Response('{"runs":[],"criteria":[]}', {
  status: 200, headers: { "Content-Type": "application/json" },
});
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const sent = () => fetchMock.mock.calls.map(([url, init = {}]) => ({
  url, method: init.method ?? "GET", body: init.body,
  token: new Headers(init.headers).get("Authorization"),
}));
let fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
const fetchMock = vi.fn((url: string, init: RequestInit = {}) => fetchImpl(url, init));

beforeEach(async () => {
  fetchMock.mockClear();
  fetchImpl = async () => response();
  vi.stubGlobal("fetch", fetchMock);
  session = sessionFor("A");
  announce("SIGNED_IN", session);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(SignedInReader.Provider, { value: "A" }, createElement(Harness))));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function changeReader() {
  session = sessionFor("B");
  announce("SIGNED_IN", session);
}

describe.each(["search", "criteria"] as const)("%s delayed settings", (kind) => {
  it("still sends both ordinary queued choices for the mounted reader", async () => {
    let release!: (r: Response) => void;
    let patches = 0;
    fetchImpl = async (_url, init) => init.method === "PATCH" && ++patches === 1
      ? await new Promise<Response>((resolve) => { release = resolve; })
      : response();
    const hook = kind === "search" ? search : criteria;
    act(() => hook.recolour("saved-row", 2));
    await settle();
    act(() => hook.recolour("saved-row", 4));
    release(response());
    await settle();
    expect(sent().filter((call) => call.method === "PATCH")).toEqual([
      expect.objectContaining({ body: '{"colour":2}', token: "Bearer TOKEN-A" }),
      expect.objectContaining({ body: '{"colour":4}', token: "Bearer TOKEN-A" }),
    ]);
  });

  it("does not send A's queued colour choice with B's token", async () => {
    let release!: (r: Response) => void;
    fetchImpl = async (_url, init) => init.method === "PATCH"
      ? await new Promise<Response>((resolve) => { release = resolve; })
      : response();
    const hook = kind === "search" ? search : criteria;
    act(() => hook.recolour("saved-row", 2));
    await settle();
    expect(sent().filter((call) => call.method === "PATCH")).toHaveLength(1);
    act(() => hook.recolour("saved-row", 4));
    changeReader();
    release(response());
    await settle();
    expect(sent().filter((call) => call.method === "PATCH")).toEqual([
      expect.objectContaining({ body: '{"colour":2}', token: "Bearer TOKEN-A" }),
    ]);
  });

  it("does not re-delete A's row with B's token after a late done frame", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    fetchImpl = async (_url, init) => init.method === "POST"
      ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), {
          status: 200, headers: { "Content-Type": "text/event-stream" },
        })
      : response();
    let id!: string;
    act(() => { id = kind === "search" ? search.ask("A's question", "quick") : criteria.ask("A's criterion", { kind: "single" }); });
    await settle();
    act(() => (kind === "search" ? search : criteria).remove(id));
    await settle();
    expect(sent().filter((call) => call.method === "DELETE")).toHaveLength(1);
    changeReader();
    stream.enqueue(new TextEncoder().encode(`event: done\ndata: ${JSON.stringify({ id, status: "done", hits: [], results: [] })}\n\n`));
    stream.close();
    await settle();
    expect(sent().filter((call) => call.method === "DELETE")).toEqual([
      expect.objectContaining({ token: "Bearer TOKEN-A" }),
    ]);
  });
});

it("does not send A's parked revised words with B's token after begin", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  fetchImpl = async (_url, init) => init.method === "POST"
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), {
        status: 200, headers: { "Content-Type": "text/event-stream" },
      })
    : response();
  let id!: string;
  act(() => { id = search.ask("A's first words", "quick"); });
  await settle();
  act(() => search.revise(id, "A's revised private words"));
  changeReader();
  stream.enqueue(new TextEncoder().encode(`event: begin\ndata: ${JSON.stringify({ id, criterion: "A's first words", kind: "quick", createdAt: "now", status: "pending", hits: [] })}\n\n`));
  await settle();
  expect(sent().filter((call) => call.method === "POST")).toEqual([
    expect.objectContaining({ token: "Bearer TOKEN-A" }),
  ]);
});
