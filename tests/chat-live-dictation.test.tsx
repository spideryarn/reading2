// @vitest-environment jsdom
/** The last input method the reader chose owns the microphone, even while Live
 * is still waiting for its ticket. Real Composer, Live hook and microphone lock;
 * only dictation's capture/transcription and the provider wire are substituted. */
import { act, createElement, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { claimMicrophone, releaseMicrophone, resetMicrophoneLock, type MicClaim } from "../src/web/mic-lock.js";
import { useLiveConversation, type LiveApi } from "../src/web/live/useLiveConversation.js";
import type { LiveTicket, LiveWiring } from "../src/web/live/wiring.js";
import type { UseDictationField } from "../src/web/useDictationField.js";

vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField(): UseDictationField {
    const [armed, setArmed] = useState(false);
    const held = useRef<MicClaim | null>(null);
    useEffect(() => () => held.current?.stop(), []);
    const toggle = () => {
      if (held.current) {
        held.current.stop();
        return;
      }
      let release!: () => void;
      const claim: MicClaim = {
        released: new Promise<void>((resolve) => { release = resolve; }),
        stop: () => {
          if (held.current === claim) held.current = null;
          setArmed(false);
          release();
          releaseMicrophone(claim);
        },
      };
      held.current = claim;
      void claimMicrophone(claim).then(() => {
        if (held.current === claim) setArmed(true);
      });
    };
    return {
      readOnly: false,
      toggle,
      dictation: {
        supported: true,
        phase: armed ? "listening" : "idle",
        armed,
        transcribing: false,
        liveText: true,
        interim: "",
        level: { current: 0 },
        meter: "none",
        quiet: false,
        toggle,
        error: null,
        startedAt: null,
        deviceLabel: null,
        deviceId: null,
        deviceUnavailable: false,
        chooseDevice: () => {},
        recording: null,
        clearRecording: () => {},
        canRetry: false,
        retry: () => {},
      },
    };
  },
}));

const { Composer } = await import("../src/web/ChatPanel.js");
let host: HTMLDivElement;
let root: Root;
let live: LiveApi;
let connections: number;
let releaseTicket: (ticket: LiveTicket) => void;
let ticket: ReturnType<typeof vi.fn<LiveWiring["ticket"]>>;
const TICKET: LiveTicket = {
  token: "ek_test", sessionId: "test-session", expiresAt: 0, model: "test",
  seed: [], tailId: null,
};

function Harness({ kind }: { kind: "chat" | "remember" }) {
  live = useLiveConversation("a-piece", {
    wiring: {
      ticket,
      runTool: async () => ({ content: "", label: "", detail: "" }),
      liveConnected: async () => "accepted",
      liveUsage: async () => "accepted",
      liveClose: async () => "accepted",
    },
  });
  const focused = useRef(0);
  return createElement(Composer, {
    slug: "a-piece", kind, onSend: () => {}, busy: false, focusNonce: 0,
    focused, draft: "", onDraft: () => {}, live,
    onStartLive: () => live.start({ threadId: "spya-k3m9qt" }),
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetMicrophoneLock();
  connections = 0;
  ticket = vi.fn(() => new Promise<LiveTicket>((resolve) => { releaseTicket = resolve; }));
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("navigator", {
    onLine: true,
    platform: "MacIntel",
    userAgent: "Test browser",
    mediaDevices: {
      enumerateDevices: async () => [],
      getUserMedia: async () => ({
        getAudioTracks: () => [{ enabled: true, label: "Test microphone", stop() {} }],
      }),
    },
  });
  vi.stubGlobal("RTCPeerConnection", class {
    constructor() { connections++; }
    createDataChannel() { return { readyState: "connecting", addEventListener() {}, send() {}, close() {} }; }
    addEventListener() {}
    addTrack() {}
    getSenders() { return []; }
    async createOffer() { return { sdp: "v=0", type: "offer" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  });
  vi.stubGlobal("Audio", class { autoplay = false; srcObject = null; pause() {} async play() {} });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "v=0" }) as Response));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  resetMicrophoneLock();
  vi.unstubAllGlobals();
});

it.each(["chat", "remember"] as const)("%s Dictate cancels pending Live before claiming the microphone", async (kind) => {
  await act(async () => { root.render(createElement(Harness, { kind })); });
  await act(async () => { live.start({ threadId: "spya-k3m9qt" }); });
  expect(ticket).toHaveBeenCalledOnce();
  expect(live.phase).toBe("connecting");
  const dictate = host.querySelector<HTMLButtonElement>('button[aria-label="Dictate"]');
  expect(dictate).not.toBeNull();
  await act(async () => { dictate?.click(); });
  expect(host.querySelector('button[aria-label="Stop dictating"]')).not.toBeNull();
  // Deliberately let the cancelled request return anyway: abort alone cannot
  // prove the old attempt will not later evict dictation through mic-lock.
  await act(async () => { releaseTicket(TICKET); });
  expect(host.querySelector('button[aria-label="Stop dictating"]')).not.toBeNull();
  expect(live.phase).toBe("idle");
  expect(connections).toBe(0);
});

it("Use dictation fallback also cancels pending Live before claiming the microphone", async () => {
  await act(async () => { root.render(createElement(Harness, { kind: "chat" })); });
  await act(async () => { live.start({ threadId: "spya-k3m9qt" }); });
  const fallback = [...host.querySelectorAll("button")].find((button) => button.textContent === "Use dictation");
  expect(fallback).toBeDefined();
  await act(async () => { fallback?.click(); });
  await act(async () => { releaseTicket(TICKET); });
  expect(host.querySelector('button[aria-label="Stop dictating"]')).not.toBeNull();
  expect(live.phase).toBe("idle");
  expect(connections).toBe(0);
});
