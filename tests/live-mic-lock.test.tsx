// @vitest-environment jsdom
/**
 * **Live conversation is a third claimant on the page's one microphone.**
 *
 * [`mic-lock.ts`](../src/web/mic-lock.ts) was written to arbitrate between
 * dictation hooks — `/profile` has two `ProfileBox`es, each with its own hook,
 * each perfectly correct alone, and two `getUserMedia` calls on WebKit is the
 * failure the whole dictation design exists to avoid.
 *
 * A live session is worse than either of them, because it holds the device for
 * **minutes** rather than for the length of a sentence. A session that took
 * `getUserMedia` without claiming would be invisible to both dictation hooks:
 * the reader would press the chat microphone mid-conversation and get a second
 * capture, silently.
 *
 * The three things asserted here are the three that go wrong quietly:
 *
 *  1. **It claims before opening the device.** A claim taken afterwards is a
 *     claim on something that has already gone wrong.
 *  2. **A failed start closes the device it already opened.** Everything after
 *     the claim can throw — a denied permission, a refused SDP exchange — and
 *     `getUserMedia` has succeeded by then, so without an unwind the reader is
 *     left with a lit recording indicator and an error message.
 *  3. **`released` settles only after the tracks are stopped.** The distinction
 *     between "is stopping" and "has stopped" is the entire content of that
 *     file.
 *
 * Point 2 says *device*, not *lock*, and that correction is the most useful
 * thing in this file. It was written as "a failed start releases the lock" and
 * mutation-testing showed the claim was empty: delete the release and the test
 * stays green, because the next claimant calls `stop()` on the stale claim and
 * that resolves `released` anyway. The lock recovers by itself; the microphone
 * does not. Every assertion here has been watched to fail.
 *
 * The synthetic-track path deliberately does **not** claim, and that is tested
 * too: it opens no device, so claiming for it would let an automated check
 * evict a reader's live dictation for a microphone it never touches.
 */
import { type ReactNode, createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimMicrophone, resetMicrophoneLock } from "../src/web/mic-lock.js";
import { useLiveConversation } from "../src/web/live/useLiveConversation.js";

/** Every track handed out, so the test can ask whether they were stopped. */
const handedOut: { stopped: boolean }[] = [];

function fakeTrack() {
  const t = { stopped: false };
  handedOut.push(t);
  return {
    kind: "audio",
    stop() {
      t.stopped = true;
    },
  } as unknown as MediaStreamTrack;
}

/** Order of operations, which is the thing under test. */
let events: string[] = [];

beforeEach(() => {
  events = [];
  handedOut.length = 0;
  resetMicrophoneLock();

  vi.stubGlobal("AudioContext", class {
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [fakeTrack()] } };
    }
    createOscillator() {
      return { connect: (n: unknown) => n, start() {} };
    }
    createGain() {
      return { gain: { value: 0 }, connect: (n: unknown) => n };
    }
  });

  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => {
        events.push("getUserMedia");
        return { getAudioTracks: () => [fakeTrack()] };
      },
    },
  });

  /* A peer connection that goes through the motions and never reaches a
     network. The data channel never opens, so `phase` never becomes "live" —
     which is fine: everything asserted here happens before that. */
  vi.stubGlobal("RTCPeerConnection", class {
    createDataChannel() {
      return { close() {}, addEventListener() {}, readyState: "connecting" };
    }
    addTrack() {}
    getSenders() {
      return handedOut.map((t) => ({ track: { stop: () => { t.stopped = true; } } }));
    }
    async createOffer() {
      return { sdp: "v=0", type: "offer" };
    }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  });

  vi.stubGlobal("Audio", class {
    autoplay = false;
    srcObject: unknown = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMicrophoneLock();
});

/** The token mint and the SDP exchange, both faked. `sdpOk` picks the outcome. */
function stubFetch(sdpOk: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/session")) {
        return { ok: true, json: async () => ({ token: "ek_test" }) } as Response;
      }
      events.push("sdp");
      return sdpOk
        ? ({ ok: true, text: async () => "v=0" } as Response)
        : ({ ok: false, status: 403, text: async () => "nope" } as Response);
    }),
  );
}

function mount() {
  let api: ReturnType<typeof useLiveConversation> | null = null;
  function Probe(): ReactNode {
    api = useLiveConversation("a-slug");
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root!: Root;
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });
  return {
    get: () => {
      if (!api) throw new Error("the hook never rendered");
      return api;
    },
    unmount: () => act(() => root.unmount()),
  };
}

/** Let the hook's async `start` run to completion. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("live conversation and the page's one microphone", () => {
  it("claims the lock BEFORE it opens the device", async () => {
    stubFetch(true);
    /* An incumbent holder that never lets go. If the live session opens a
       device anyway, `getUserMedia` shows up in `events` and the ordering
       assertion below fails — which is the whole point: the claim has to be a
       gate, not a formality. */
    let release!: () => void;
    await claimMicrophone({
      stop: () => events.push("incumbent asked to stop"),
      released: new Promise<void>((res) => {
        release = res;
      }),
    });

    const h = mount();
    act(() => h.get().start({ microphone: true }));
    await settle();

    expect(events, "the device was opened while somebody else held the lock").not.toContain(
      "getUserMedia",
    );
    expect(events).toContain("incumbent asked to stop");

    release();
    await settle();
    expect(events).toContain("getUserMedia");
    h.unmount();
  });

  it("does NOT claim for the synthetic silent track", async () => {
    stubFetch(true);
    /* An incumbent that would have to be asked to stop, if we claimed. */
    await claimMicrophone({
      stop: () => events.push("incumbent asked to stop"),
      released: Promise.resolve(),
    });

    const h = mount();
    act(() => h.get().start({ microphone: false }));
    await settle();

    expect(events).not.toContain("incumbent asked to stop");
    expect(events).not.toContain("getUserMedia");
    /* It still got all the way to the SDP exchange — the point is that the
       automated path is the real path minus the device. */
    expect(events).toContain("sdp");
    h.unmount();
  });

  /**
   * **A failed start must close the device it already opened.**
   *
   * This assertion was originally written as "it releases the lock", and
   * mutation-testing showed that claim was empty: deleting the release left the
   * test green, because the *next* claimant calls `stop()` on the stale claim
   * and that resolves `released` anyway. The lock recovers on its own.
   *
   * What does not recover is the **track**. `getUserMedia` has already
   * succeeded by the time the SDP exchange is refused, so without the unwind
   * the reader is left with a live microphone and a recording indicator lit,
   * for a conversation that never started and shows an error. That is the real
   * failure, it is visible to the reader, and it is what this now checks.
   */
  it("closes the microphone it opened when starting FAILS", async () => {
    stubFetch(false);
    const h = mount();
    act(() => h.get().start({ microphone: true }));
    await settle();

    expect(h.get().phase).toBe("failed");
    expect(handedOut.length, "no device was ever opened, so this proves nothing").toBeGreaterThan(0);
    expect(
      handedOut.every((t) => t.stopped),
      "the microphone is still open after a session that failed to start",
    ).toBe(true);
    h.unmount();
  });

  it("stops every track before it says the device is free", async () => {
    stubFetch(true);
    const h = mount();
    act(() => h.get().start({ microphone: true }));
    await settle();
    expect(handedOut.length).toBeGreaterThan(0);

    act(() => h.get().stop());
    /* Asserted after `stop` returns, because `released` is resolved inside it —
       if the resolve ever moves above the track teardown, WebKit gets two live
       sources and this is what should catch it. */
    expect(handedOut.every((t) => t.stopped)).toBe(true);

    let gotIn = false;
    await claimMicrophone({ stop: () => {}, released: new Promise<void>(() => {}) }).then(() => {
      gotIn = true;
    });
    expect(gotIn).toBe(true);
    h.unmount();
  });
});
