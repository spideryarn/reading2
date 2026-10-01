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
  judgeFallback,
  labelled,
  rememberDeviceLabel,
  rememberedDeviceLabel,
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
  it("asks plainly when nothing is remembered and the browser lists no default", () => {
    expect(audioConstraint(null)).toEqual({ audio: true });
  });

  /* `{ audio: true }` opens Chromium's own choice, which need not be the
     operating system's input (spya-g8byyd); only `exact` beats it. */
  it("names Chromium's system-default input exactly when it is listed", () => {
    expect(audioConstraint(null, true)).toEqual({ audio: { deviceId: { exact: "default" } } });
  });

  it("lets a remembered pick win over the system default", () => {
    expect(audioConstraint("abc123", true)).toEqual({ audio: { deviceId: { exact: "abc123" } } });
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

/**
 * **A remembered microphone that will not open by id may still be there.**
 *
 * spya-k3q9mc, Greg on an iPhone with AirPods, 2026-09-29: *"The microphone you
 * chose isn't available. Using another one."* — and then it worked. The stored
 * id had stopped resolving (why, on iOS, was not established), and the default
 * it fell back to may well have been the same microphone. The label is what
 * is remembered beside the id and compared — never on its own, since labels
 * need not be unique.
 * docs/plans/261001l-autosave-about-you-and-honest-mic-fallback.md.
 */
describe("judging the fallback", () => {
  it("remembers the label beside the id, and forgets both together", () => {
    rememberDevice("abc123");
    rememberDeviceLabel("AirPods Pro");
    expect(rememberedDeviceLabel()).toBe("AirPods Pro");
    rememberDevice(null);
    expect(rememberedDeviceLabel()).toBeNull();
  });

  /* A new choice is a different device; the old name would vouch for it. */
  it("drops the label when a different device is chosen", () => {
    rememberDevice("abc123");
    rememberDeviceLabel("AirPods Pro");
    rememberDevice("def456");
    expect(rememberedDeviceLabel()).toBeNull();
  });

  const PHONE = [
    { deviceId: "new-id", label: "AirPods Pro" },
    { deviceId: "mic-id", label: "iPhone Microphone" },
  ];

  it("calls the fallback the same microphone when it is the one input with that name, and adopts its new id", () => {
    expect(judgeFallback("AirPods Pro", { label: "AirPods Pro", id: "new-id" }, PHONE)).toEqual({
      kind: "same-device",
      id: "new-id",
    });
  });

  it("says which one was wanted when the fallback is a different microphone", () => {
    expect(
      judgeFallback("AirPods Pro", { label: "iPhone Microphone", id: "mic-id" }, PHONE),
    ).toEqual({ kind: "different", wanted: "AirPods Pro" });
  });

  /* Labels are descriptive, not unique. Two inputs with the chosen name and
     no id to tell them apart is not a match. GPT Sol's plan review, item 4. */
  it("does not match a name two inputs share", () => {
    const twins = [
      { deviceId: "a", label: "USB Audio Device" },
      { deviceId: "b", label: "USB Audio Device" },
    ];
    expect(judgeFallback("USB Audio Device", { label: "USB Audio Device", id: "a" }, twins)).toEqual(
      { kind: "different", wanted: "USB Audio Device" },
    );
  });

  it("does not match when the input with that name is not the one that opened", () => {
    const list = [{ deviceId: "other", label: "AirPods Pro" }];
    expect(judgeFallback("AirPods Pro", { label: "AirPods Pro", id: "new-id" }, list)).toEqual({
      kind: "different",
      wanted: "AirPods Pro",
    });
  });

  /* Stored before labels were kept: there is nothing to compare, and warning
     on every press for ever is the bug. */
  it("forgets a choice that was stored without a name", () => {
    expect(judgeFallback(null, { label: "AirPods Pro", id: "new-id" }, PHONE)).toEqual({
      kind: "forget",
    });
  });

  /* A browser that will not say what it opened cannot be said to have opened
     the right thing. */
  it("does not match on a missing name or id", () => {
    expect(judgeFallback("AirPods Pro", { label: null, id: "new-id" }, PHONE).kind).toBe("different");
    expect(judgeFallback("AirPods Pro", { label: "AirPods Pro", id: null }, PHONE).kind).toBe(
      "different",
    );
  });
});
