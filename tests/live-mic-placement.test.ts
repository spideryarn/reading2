// @vitest-environment jsdom
/**
 * **Guessing where the microphone is, and never overriding somebody who said.**
 *
 * OpenAI's noise reduction takes `near_field` or `far_field` and runs before
 * the voice-activity detector, so it decides how often a room is treated as
 * somebody talking. Off by default, which is the wrong default for us — the
 * first thing Greg noticed about live conversation was the companion answering
 * a question he had not asked during a pause with background noise.
 *
 * Two properties are worth a test and the second is the one that would break
 * quietly:
 *
 *  1. The guess is right for the devices people actually have.
 *  2. **An explicit choice is never re-guessed.** A reader who picks "headset"
 *     while plugged into a display must not be silently corrected on the next
 *     connection — a control that quietly disagrees with you is worse than no
 *     control, because nothing on screen says it was ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PLACEMENT,
  guessPlacement,
  rememberPlacement,
  rememberedPlacement,
  resolvePlacement,
} from "../src/web/live/mic-placement.js";

/** What `enumerateDevices` will report. Empty labels mean "no permission yet". */
let devices: { kind: string; deviceId: string; label: string }[] = [];

/**
 * **`localStorage` has to be supplied, because this environment has none.**
 *
 * Node 26 does not give jsdom one without `--localstorage-file`, and says so
 * only as an `ExperimentalWarning` that scrolls past. So `window.localStorage`
 * is `undefined` here, every access in the module under test throws, and its
 * try/catch — which exists for Safari's private mode — swallows it.
 *
 * That is worth spelling out because of how it fails: without this stub the
 * "remembers a choice" tests do not error, they simply never remember, and the
 * module looks like it has a bug it does not have. A test environment missing
 * a browser API that production has is the quietest kind of wrong answer.
 */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  devices = [];
  vi.stubGlobal("localStorage", fakeStorage());
  vi.stubGlobal("navigator", {
    mediaDevices: { enumerateDevices: async () => devices },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const input = (label: string, deviceId = "d1") => ({ kind: "audioinput", deviceId, label });

describe("guessing from the device's own name", () => {
  it.each([
    "AirPods Pro",
    "Greg's AirPods",
    "Jabra Evolve 65",
    "External Headphones",
    "Bose QC 35",
    "WH-1000XM5",
    "Bluetooth Headset",
  ])("calls %s a headset", (label) => {
    expect(guessPlacement(label)).toBe("headset");
  });

  it.each([
    "MacBook Pro Microphone",
    "Built-in Microphone",
    "Studio Display Microphone",
    "iMac Microphone",
    "Logitech Webcam C920",
    "Microphone Array (Realtek)",
  ])("calls %s a laptop", (label) => {
    expect(guessPlacement(label)).toBe("laptop");
  });

  it("says nothing about a name it does not recognise", () => {
    /* `null` rather than the default, so the caller can tell "this looks like a
       headset" from "no idea". They lead to the same session today and to
       different sentences on screen. */
    expect(guessPlacement("Scarlett Solo USB")).toBeNull();
    expect(guessPlacement("")).toBeNull();
    expect(guessPlacement(null)).toBeNull();
  });

  it("prefers what you are WEARING over what it is plugged into", () => {
    /* Both of these are real label shapes, and the order of the two checks is
       the whole of the behaviour. */
    expect(guessPlacement("AirPods Pro (Built-in)")).toBe("headset");
    expect(guessPlacement("Jabra Link on Display Audio")).toBe("headset");
  });
});

describe("resolving what a session should use", () => {
  it("falls back when the browser will not name the device", async () => {
    /* `enumerateDevices` returns blank labels until the microphone permission
       has been granted once for this origin, so the FIRST connection on a new
       origin genuinely cannot know. `listInputs` filters those out, so an empty
       list is that case rather than an error. */
    const out = await resolvePlacement();
    expect(out).toMatchObject({ placement: DEFAULT_PLACEMENT, from: "default", label: null });
  });

  it("guesses from the device once the browser will name it", async () => {
    devices = [input("MacBook Pro Microphone")];
    expect(await resolvePlacement()).toMatchObject({ placement: "laptop", from: "guessed" });

    devices = [input("AirPods Pro")];
    expect(await resolvePlacement()).toMatchObject({ placement: "headset", from: "guessed" });
  });

  it("NEVER re-guesses over an explicit choice", async () => {
    /* The one that would break quietly. Somebody on a display mic who says
       "headset" — because they are leaning in, or because they prefer how it
       sounds — has to keep it. */
    devices = [input("Studio Display Microphone")];
    expect(await resolvePlacement()).toMatchObject({ placement: "laptop", from: "guessed" });

    rememberPlacement("headset");
    const out = await resolvePlacement();
    expect(out.placement, "an explicit choice was overwritten by the guess").toBe("headset");
    expect(out.from).toBe("chosen");
    /* And the device is still reported, so the UI can show what it disagrees
       with rather than hiding the conflict. */
    expect(out.label).toBe("Studio Display Microphone");
  });

  it("goes back to guessing when the choice is cleared", async () => {
    devices = [input("MacBook Pro Microphone")];
    rememberPlacement("headset");
    expect((await resolvePlacement()).from).toBe("chosen");
    rememberPlacement(null);
    expect(await resolvePlacement()).toMatchObject({ placement: "laptop", from: "guessed" });
  });

  it("asks about the device the reader picked, not whichever is first", async () => {
    /* Dictation already lets a reader choose a microphone (mic-devices.ts), and
       guessing from a different one than we are about to open would be
       confidently wrong. */
    devices = [input("MacBook Pro Microphone", "built-in"), input("AirPods Pro", "airpods")];
    expect((await resolvePlacement("airpods")).placement).toBe("headset");
    expect((await resolvePlacement("built-in")).placement).toBe("laptop");
  });

  it("survives a browser with no enumerateDevices at all", async () => {
    vi.stubGlobal("navigator", {});
    expect(await resolvePlacement()).toMatchObject({ from: "default" });
  });
});

describe("remembering", () => {
  it("keeps only the two real values", () => {
    window.localStorage.setItem("spya.live.micPlacement", "wibble");
    expect(rememberedPlacement()).toBeNull();
  });

  it("does not take the page down when storage throws", () => {
    /* Safari's private mode throws outright on `localStorage`, and a microphone
       preference is not worth a blank page. */
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(rememberedPlacement()).toBeNull();
    expect(() => rememberPlacement("headset")).not.toThrow();
    expect(() => rememberPlacement(null)).not.toThrow();
  });
});
