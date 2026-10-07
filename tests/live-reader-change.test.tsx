// @vitest-environment jsdom
/** Real api.ts: live startup and later provider callbacks retain their page's reader. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

interface FakeSession { access_token: string; user: { id: string } }
let signedIn: FakeSession | null = null;
let announce: (event: string, session: FakeSession | null) => void = () => {};
function become(id: string): void {
  signedIn = { access_token: `TOKEN-${id}`, user: { id } };
  announce("SIGNED_IN", signedIn);
}
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: { auth: {
    getSession: async () => ({ data: { session: signedIn } }),
    refreshSession: async () => ({ data: { session: signedIn } }),
    onAuthStateChange: (fn: typeof announce) => {
      announce = fn;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  } },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));
const { SignedInReader } = await import("../src/web/lib/made-for.js");
const { useLiveConversation } = await import("../src/web/live/useLiveConversation.js");
const { useGptLive } = await import("../src/web/live/gpt-live/useGptLive.js");
const { resetMicrophoneLock } = await import("../src/web/mic-lock.js");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
let sent: { url: string; as: string | null }[] = [];
let devices: () => Promise<MediaDeviceInfo[]>;
let offer: () => Promise<{ sdp: string; type: "offer" }>;
let channel: Channel;
class Channel {
  readyState = "connecting";
  listeners = new Map<string, ((event: unknown) => void)[]>();
  addEventListener(name: string, fn: (event: unknown) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  send() {}
  close() { this.readyState = "closed"; }
  open() {
    this.readyState = "open";
    for (const fn of this.listeners.get("open") ?? []) fn({});
  }
  deliver(event: Record<string, unknown>) {
    for (const fn of this.listeners.get("message") ?? []) fn({ data: JSON.stringify(event) });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  roots = [];
  sent = [];
  devices = async () => [];
  offer = async () => ({ sdp: "v=0 offer", type: "offer" });
  resetMicrophoneLock();
  vi.stubGlobal("navigator", { mediaDevices: {
    enumerateDevices: () => devices(),
    getUserMedia: async () => ({ getAudioTracks: () => [{
      enabled: true, stop() {}, addEventListener() {}, readyState: "live", kind: "audio", label: "Microphone",
    }] }),
  } });
  vi.stubGlobal("RTCPeerConnection", class {
    connectionState = "connected";
    createDataChannel() { channel = new Channel(); return channel; }
    addEventListener() {}
    addTrack() {}
    getSenders() { return []; }
    createOffer() { return offer(); }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  });
  vi.stubGlobal("Audio", class { autoplay = false; srcObject: unknown; async play() {} pause() {} addEventListener() {} });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (!url.startsWith("/api/")) return new Response("v=0 answer");
    sent.push({ url, as: new Headers(init.headers).get("Authorization") });
    const ticket = url.endsWith("/live-session")
      ? { sdp: "v=0 answer", sessionId: "journal-A", liveSessionId: "provider-A", tailId: null }
      : url.endsWith("/live")
        ? { token: "secret-A", sessionId: "journal-A", seed: [], tailId: null }
        : { content: "done", label: "tool", detail: "" };
    return new Response(JSON.stringify(ticket), { headers: { "content-type": "application/json" } });
  });
  announce("SIGNED_OUT", null);
  become("A");
});
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetMicrophoneLock();
});
async function settle() {
  await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); });
}
function mount(engine: typeof useLiveConversation, reader = "A") {
  let api!: ReturnType<typeof useLiveConversation>;
  function Probe() { api = engine("a-slug", { tailNow: () => null }); return null; }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(createElement(SignedInReader.Provider, { value: reader }, createElement(Probe))));
  return { get: () => api };
}

it("does not mint A's Realtime ticket as B after delayed placement detection", async () => {
  let resolve!: (value: MediaDeviceInfo[]) => void;
  devices = () => new Promise((done) => { resolve = done; });
  const view = mount(useLiveConversation);
  act(() => view.get().start({ threadId: "spya-thra01" }));
  await settle();
  expect(resolve).toBeTypeOf("function");
  become("B");
  resolve([]);
  await settle();
  expect(sent).toEqual([]);
});

it("does not create A's paid GPT-Live session as B after a delayed SDP offer", async () => {
  let resolve!: (value: { sdp: string; type: "offer" }) => void;
  offer = () => new Promise((done) => { resolve = done; });
  const view = mount(useGptLive);
  act(() => view.get().start({ threadId: "spya-thra01" }));
  await settle();
  expect(resolve).toBeTypeOf("function");
  become("B");
  resolve({ sdp: "v=0 offer", type: "offer" });
  await settle();
  expect(sent).toEqual([]);
});

it("does not send A's late live-tool arguments or accounting reports as B", async () => {
  const view = mount(useLiveConversation);
  act(() => view.get().start({ threadId: "spya-thra01" }));
  await settle();
  expect(sent).toEqual([{ url: "/api/chat/a-slug/spya-thra01/live", as: "Bearer TOKEN-A" }]);
  become("B");
  act(() => {
    channel.open();
    channel.deliver({ type: "response.function_call_arguments.done", call_id: "call-A", name: "search_library", arguments: JSON.stringify({ query: "A's private question" }) });
  });
  await settle();
  expect(sent.filter((request) => request.as === "Bearer TOKEN-B")).toEqual([]);
});

it("still creates the current reader's ordinary paid session", async () => {
  become("B");
  const view = mount(useGptLive, "B");
  act(() => view.get().start({ threadId: "spya-thrb01" }));
  await settle();
  expect(sent).toEqual([{ url: "/api/chat/a-slug/spya-thrb01/live-session", as: "Bearer TOKEN-B" }]);
});
