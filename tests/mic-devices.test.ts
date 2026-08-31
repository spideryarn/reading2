// @vitest-environment jsdom
/**
 * **Which microphone, and how we ask for it.**
 *
 * The whole file exists because of one measurement: `getUserMedia({audio:true})`
 * handed the page "Microsoft Teams Audio Device (Virtual)", which emits
 * **exactly** `0.0` — digital silence, not a quiet room. Recognition heard
 * nothing, the meter drew nothing, and both were right.
 * docs/plans/260827k-microphone-device-and-recording.md.
 *
 * The property that matters most here is that **`exact` is used rather than
 * `ideal`**. `ideal` silently substitutes another device when the named one is
 * missing, which is the same genre of quiet-wrong-device failure the feature is
 * a response to; `exact` rejects, and the caller decides out loud.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  audioConstraint,
  labelled,
  listInputs,
  rememberDevice,
  rememberedDevice,
} from "../src/web/mic-devices.js";

/**
 * An in-memory store, because **`window.localStorage` is `undefined` in this
 * project's jsdom** rather than merely throwing. Which is worth knowing: the
 * source reads it inside a `try`, so an absent one lands in the same catch as a
 * blocked one and both come back as "nothing remembered". That is the intended
 * behaviour, and it is only visible because the environment happens to have no
 * storage at all.
 */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the constraint", () => {
  it("asks for anything at all when nothing is remembered", () => {
    expect(audioConstraint(null)).toEqual({ audio: true });
  });

  /* `exact`, never `ideal`. An `ideal` constraint quietly gives you a different
     microphone when the named one is gone, which looks exactly like success. */
  it("names the device exactly, so a missing one rejects rather than substitutes", () => {
    expect(audioConstraint("abc123")).toEqual({ audio: { deviceId: { exact: "abc123" } } });
  });
});

describe("remembering a choice", () => {
  it("round-trips", () => {
    expect(rememberedDevice()).toBeNull();
    rememberDevice("abc123");
    expect(rememberedDevice()).toBe("abc123");
  });

  it("forgets when handed null, and treats an empty string as nothing", () => {
    rememberDevice("abc123");
    rememberDevice(null);
    expect(rememberedDevice()).toBeNull();
    localStorage.setItem("spya.dictation.deviceId", "");
    expect(rememberedDevice()).toBeNull();
  });

  /* Safari's private mode throws on every `localStorage` access, and site data
     can be blocked outright. A microphone preference is not worth taking the
     page down for. */
  it("survives a localStorage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    });
    expect(() => rememberDevice("abc123")).not.toThrow();
    expect(rememberedDevice()).toBeNull();
  });
});

describe("listing the inputs", () => {
  const install = (devices: unknown) => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: async () => devices },
    });
  };

  it("keeps audio inputs and drops everything else", async () => {
    install([
      { kind: "audioinput", deviceId: "a", label: "MacBook Pro Microphone (Built-in)" },
      { kind: "videoinput", deviceId: "b", label: "FaceTime HD Camera" },
      { kind: "audiooutput", deviceId: "c", label: "MacBook Pro Speakers" },
    ]);
    expect(await listInputs()).toEqual([
      { deviceId: "a", label: "MacBook Pro Microphone (Built-in)" },
    ]);
  });

  /* Labels are empty strings until microphone permission has been granted. A
     row the reader cannot read is a row they cannot choose between, so it is
     not offered — the caller only opens the picker once there is a live track,
     by which point the names are there. */
  it("drops unnamed devices, because an unnamed row cannot be chosen", async () => {
    install([
      { kind: "audioinput", deviceId: "a", label: "" },
      { kind: "audioinput", deviceId: "", label: "Something" },
      { kind: "audioinput", deviceId: "c", label: "Real one" },
    ]);
    expect(await listInputs()).toEqual([{ deviceId: "c", label: "Real one" }]);
  });

  it("returns nothing rather than throwing where there is no such API", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    expect(await listInputs()).toEqual([]);
  });

  it("returns nothing rather than throwing when enumeration fails", async () => {
    install(null);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: async () => {
          throw new Error("no");
        },
      },
    });
    expect(await listInputs()).toEqual([]);
  });
});

describe("what to call it on screen", () => {
  it("uses the browser's own name, which is the one in the system settings", () => {
    expect(labelled({ label: "Microsoft Teams Audio Device (Virtual)" } as MediaStreamTrack)).toBe(
      "Microsoft Teams Audio Device (Virtual)",
    );
  });

  /* Nothing is invented. A browser that declines to name the device gets no
     sentence about the device rather than a made-up one. */
  it("says nothing when there is no name, rather than inventing one", () => {
    expect(labelled(null)).toBeNull();
    expect(labelled({ label: "" } as MediaStreamTrack)).toBeNull();
    expect(labelled({ label: "   " } as MediaStreamTrack)).toBeNull();
  });
});
