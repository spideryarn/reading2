// @vitest-environment jsdom
/**
 * **A dictation that fails says so to somebody besides the reader.**
 * docs/plans/261011i-dictation-failures-reach-sentry.md (spya-m2pyfq).
 *
 * Two halves. The hook: representative failures reach `report`, repeated
 * presses remain separate occurrences, one failure is not double-reported,
 * and microphone-opening diagnostics survive or reset at the right boundaries.
 * The product's reporter: what it would send, and that none of it is the
 * sentence or anything else a reader could have put there.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserTags, dictationCode, dictationFailureEvent } from "../src/web/dictation-report.js";
import { MIC_NONE, MIC_REFUSED } from "../src/web/dictation-errors.js";
import { safeEvent, sanitise } from "../src/monitoring-scrub.js";
import { resetMicrophoneLock } from "../src/web/mic-lock.js";
import {
  type DictationFailure,
  type DictationKeeper,
  type TranscriptionResult,
  micErrorName,
} from "../src/web/transcriber.js";
import { useDictation } from "../src/web/useDictation.js";

/* ------------------------------------------------------------- the fakes -- */

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported(t: string) {
    return t.startsWith("audio/webm");
  }
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    setTimeout(() => this.onstop?.(), 0);
  }
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

/**
 * What each `getUserMedia` does, in order: `ok` opens a track, `empty` answers
 * with no audio track, anything else is refused with that name. Past the end
 * of the plan, `ok`.
 */
let gumPlan: string[] = [];
const gumWith: MediaStreamConstraints[] = [];
let answerWith: TranscriptionResult = { ok: true, text: "hello" };
let clock = 0;

const transcribe = async (): Promise<TranscriptionResult> => answerWith;

beforeEach(() => {
  resetMicrophoneLock();
  FakeRecorder.instances = [];
  gumPlan = [];
  gumWith.length = 0;
  answerWith = { ok: true, text: "hello" };
  clock = 0;
  const base = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => base + clock);
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  /* Where a chosen microphone is remembered. */
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(private tracks: unknown[] = []) {}
      getAudioTracks() {
        return this.tracks;
      }
    },
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      resume = async () => {};
      createMediaStreamSource = () => ({ connect: () => {}, disconnect: () => {} });
      createAnalyser = () => ({ fftSize: 2048, getFloatTimeDomainData: () => {}, disconnect: () => {} });
    },
  );
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  delete (navigator as { userAgentData?: unknown }).userAgentData;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (c: MediaStreamConstraints) => {
        gumWith.push(c);
        const plan = gumPlan.shift() ?? "ok";
        if (plan === "empty") return { getAudioTracks: () => [], getTracks: () => [] };
        if (plan !== "ok") throw new DOMException("the browser's own words", plan);
        const track = { readyState: "live", addEventListener: () => {}, removeEventListener: () => {}, stop: () => {} };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
      /* The remembered headset is still listed, so it is asked for by id. */
      enumerateDevices: async () => [{ kind: "audioinput", deviceId: "gone", label: "Headset" }],
    },
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

const mounted = new Set<() => void>();
afterEach(() => {
  for (const unmount of mounted) unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/* ----------------------------------------------------------- the harness -- */

function drive(options: { keep?: DictationKeeper<{ kind: "article"; slug: string }> } = {}) {
  const reports: Array<{ failure: DictationFailure; context: unknown }> = [];
  let state: ReturnType<typeof useDictation> | null = null;
  function Probe(): ReactNode {
    state = useDictation({
      onText: () => {},
      onTranscript: () => true,
      context: { kind: "article", slug: "a-private-slug" },
      transcribe,
      report: (failure, context) => reports.push({ failure, context }),
      ...(options.keep && { keep: options.keep }),
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const unmount = () => {
    if (!mounted.delete(unmount)) return;
    act(() => root.unmount());
    host.remove();
  };
  mounted.add(unmount);
  act(() => root.render(createElement(Probe)));
  return {
    reports,
    get: () => {
      if (!state) throw new Error("the hook never rendered");
      return state;
    },
  };
}

async function settle() {
  await act(async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

async function press(h: ReturnType<typeof drive>) {
  act(() => h.get().toggle());
  await settle();
}

/* ------------------------------------------------------------- the tests -- */

describe("a microphone that will not open", () => {
  /**
   * **The fallback chain is the ordinary path's, so these run on it.** Off
   * Chromium a press with nobody else on the microphone asks once, inside the
   * press, as `ideal`, and has no chain to fall down (plan 261024z). The chain
   * is still what Chromium does, and what any browser does when the press had
   * to wait for another holder, so it is pinned here on Chromium's engine brand
   * — with no recogniser stubbed, so there is no probe either.
   */
  function ordinaryPath() {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { brands: [{ brand: "Chromium", version: "151" }], mobile: false, platform: "macOS" },
    });
  }

  it.each([
    ["NotAllowedError", MIC_REFUSED],
    ["SecurityError", MIC_REFUSED],
    ["NotFoundError", MIC_NONE],
    ["NotReadableError", "The microphone could not be started. Press it again, or type instead. [mic-no-start]"],
    ["SomethingNewError", "The microphone could not be started. Press it again, or type instead. [mic-no-start]"],
  ])("%s is told the right sentence, and reported once with its name", async (name, sentence) => {
    gumPlan = [name];
    const h = drive();
    await press(h);
    expect(h.get().error).toBe(sentence);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]?.failure).toEqual({
      message: sentence,
      micError: name === "SomethingNewError" ? "other" : name,
      live: false,
      chosenMic: "none",
    });
  });

  it("a second press that fails the same way is a second report", async () => {
    gumPlan = ["NotAllowedError", "NotAllowedError"];
    const h = drive();
    await press(h);
    await press(h);
    expect(h.reports.map((r) => r.failure.micError)).toEqual(["NotAllowedError", "NotAllowedError"]);
  });

  /* GPT Sol's plan review, F3: once a missing device has sent it down the
     fallback, the reason that counts is the last request's, not the first. */
  it("a chosen microphone gone, then the default refused, is reported as the refusal", async () => {
    ordinaryPath();
    const h = drive();
    act(() => h.get().chooseDevice("gone"));
    await settle();
    gumPlan = ["OverconstrainedError", "NotAllowedError"];
    await press(h);
    expect(gumWith).toHaveLength(2);
    expect(h.get().error).toBe(MIC_REFUSED);
    expect(h.reports.map((r) => [r.failure.micError, r.failure.chosenMic])).toEqual([
      ["NotAllowedError", "not-honoured"],
    ]);
  });

  it("an answer with no audio in it is `no-track`", async () => {
    gumPlan = ["empty"];
    const h = drive();
    await press(h);
    expect(h.get().error).toContain("[mic-no-start]");
    expect(h.reports[0]?.failure.micError).toBe("no-track");
  });

  it("a fallback that opens a stream with no audio track is `no-track`, not the earlier refusal", async () => {
    ordinaryPath();
    const h = drive();
    act(() => h.get().chooseDevice("gone"));
    await settle();
    gumPlan = ["NotFoundError", "empty"];
    await press(h);
    expect(gumWith).toHaveLength(2);
    expect(h.get().error).toContain("[mic-no-start]");
    expect(h.reports.at(-1)?.failure.micError).toBe("no-track");
  });

  it("keeps the final refusal through the complete chosen/default/unconstrained chain", async () => {
    ordinaryPath();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        ...(navigator.mediaDevices as object),
        getUserMedia: navigator.mediaDevices.getUserMedia,
        enumerateDevices: async () => [
          { kind: "audioinput", deviceId: "gone", label: "Headset" },
          { kind: "audioinput", deviceId: "default", label: "System default" },
        ],
      },
    });
    const h = drive();
    act(() => h.get().chooseDevice("gone"));
    await settle();
    gumPlan = ["OverconstrainedError", "NotFoundError", "NotReadableError"];
    await press(h);
    expect(gumWith).toHaveLength(3);
    expect(h.get().error).toContain("[mic-no-start]");
    expect(h.reports.at(-1)?.failure.micError).toBe("NotReadableError");
  });

  it("a final unconstrained stream with no audio track is `no-track`", async () => {
    ordinaryPath();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        ...(navigator.mediaDevices as object),
        getUserMedia: navigator.mediaDevices.getUserMedia,
        enumerateDevices: async () => [
          { kind: "audioinput", deviceId: "gone", label: "Headset" },
          { kind: "audioinput", deviceId: "default", label: "System default" },
        ],
      },
    });
    const h = drive();
    act(() => h.get().chooseDevice("gone"));
    await settle();
    gumPlan = ["OverconstrainedError", "NotFoundError", "empty"];
    await press(h);
    expect(gumWith).toHaveLength(3);
    expect(h.get().error).toContain("[mic-no-start]");
    expect(h.reports.at(-1)?.failure.micError).toBe("no-track");
  });
});

describe("a failure after the microphone opened", () => {
  it("is reported with no microphone reason, and a later press does not inherit one", async () => {
    const h = drive();
    await press(h);
    expect(h.get().phase).toBe("listening");
    answerWith = { ok: false, retryable: true, message: "We couldn't reach the server to transcribe that. [mic-offline]" };
    clock += 3000;
    act(() => FakeRecorder.instances.at(-1)?.emit(4000));
    await press(h);
    expect(h.get().error).toContain("[mic-offline]");
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]?.failure.micError).toBeNull();
    expect(h.reports[0]?.context).toEqual({ kind: "article", slug: "a-private-slug" });
  });

  it("a press that works reports nothing", async () => {
    const h = drive();
    await press(h);
    clock += 3000;
    act(() => FakeRecorder.instances.at(-1)?.emit(4000));
    await press(h);
    expect(h.get().error).toBeNull();
    expect(h.reports).toEqual([]);
  });

  it("reports one broken-tape occurrence once, though the same sentence survives its ending", async () => {
    const h = drive();
    await press(h);
    clock += 3000;
    act(() => {
      const recorder = FakeRecorder.instances.at(-1);
      recorder?.emit(4000);
      recorder?.onerror?.();
    });
    await settle();
    expect(h.get().error).toContain("[mic-broken]");
    expect(h.reports.filter((r) => r.failure.message.includes("[mic-broken]"))).toHaveLength(1);
  });

  it("a retry of a recovered tape does not inherit the previous press's microphone details", async () => {
    let recoveries = 0;
    const recoveredTape = {
      chunk: () => {},
      broken: () => {},
      complete: () => {},
      intact: async () => true,
      forget: () => {},
      release: () => {},
    };
    const keep: DictationKeeper<{ kind: "article"; slug: string }> = {
      box: "chat:a-private-slug",
      begin: () => null,
      recover: async () => {
        recoveries++;
        if (recoveries === 1) return null;
        return {
          tape: recoveredTape,
          where: { kind: "article", slug: "a-private-slug" },
          startedAt: Date.now() - 3000,
          parts: [{ blob: new Blob([new Uint8Array(4000)]), mimeType: "audio/webm", ms: 3000 }],
          broken: false,
          complete: true,
        };
      },
    };
    const h = drive({ keep });
    await settle();
    act(() => h.get().chooseDevice("gone"));
    await press(h);
    clock += 3000;
    act(() => FakeRecorder.instances.at(-1)?.emit(4000));
    await press(h);
    await settle();
    expect(h.get().error).toContain("[mic-recovered]");

    answerWith = {
      ok: false,
      retryable: true,
      message: "We couldn't reach the server to transcribe that. [mic-offline]",
    };
    act(() => h.get().retry());
    await settle();
    expect(h.reports.at(-1)?.failure).toEqual({
      message: answerWith.message,
      micError: null,
      live: false,
      chosenMic: "none",
    });
  });
});

describe("what the product sends", () => {
  const failure = (message: string): DictationFailure => ({
    message,
    micError: "NotAllowedError",
    live: true,
    chosenMic: "not-honoured",
  });
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const place = { kind: "article", slug: "a-private-slug" } as const;

  it("the code, the place's kind and the reason — never the sentence or the slug", () => {
    const event = dictationFailureEvent(failure(MIC_REFUSED), place, "chat", iphone);
    expect(event?.tags).toEqual({
      dictation_code: "mic-refused",
      dictation_surface: "chat",
      dictation_place: "article",
      mic_error: "NotAllowedError",
      mic_chosen: "not-honoured",
      mic_live: "yes",
      browser_engine: "webkit",
      browser_mobile: "yes",
    });
    expect(event?.fingerprint).toEqual(["dictation-failure", "mic-refused"]);
    if (!event) throw new Error("no event");

    /* End to end through the scrubber, as `captureClientFailure` would send
       it (GPT Sol's plan review, F4). */
    const { error } = sanitise(event.error, { neverAuthored: true });
    const sent = safeEvent({
      exception: { values: [{ type: error.name, value: error.message }] },
      tags: event.tags,
      fingerprint: event.fingerprint,
    } as Parameters<typeof safeEvent>[0]);
    const wire = JSON.stringify(sent);
    expect(wire).toContain("DictationFailure");
    expect(wire).not.toContain("allowed to use the microphone");
    expect(wire).not.toContain("a-private-slug");
  });

  it("the browser, coarsely", () => {
    expect(browserTags(iphone)).toEqual({ browser_engine: "webkit", browser_mobile: "yes" });
    expect(
      browserTags(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      ),
    ).toEqual({ browser_engine: "chromium", browser_mobile: "no" });
    expect(browserTags("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0").browser_engine).toBe(
      "gecko",
    );
  });

  it("an offer back is not a failure", () => {
    for (const code of ["mic-recovered", "mic-cut-off", "mic-moved", "mic-moved-held", "mic-full"]) {
      expect(dictationFailureEvent(failure(`Something kind. [${code}]`), place, "chat", iphone)).toBeNull();
    }
  });

  it("a code is only ever ours: `mic-` or `ai-`, short, at the end", () => {
    expect(dictationCode("The service is busy. [ai-busy]")).toBe("ai-busy");
    expect(dictationCode("No code at all")).toBe("none");
    expect(dictationCode("I said [mic-blocked] out loud, then more")).toBe("none");
    expect(dictationCode("Odd [something-else]")).toBe("none");
    expect(dictationCode(`Long [mic-${"a".repeat(40)}]`)).toBe("none");
  });

  it("an error name outside the closed list travels as `other`", () => {
    expect(micErrorName(new DOMException("x", "NotReadableError"))).toBe("NotReadableError");
    expect(micErrorName({ name: "my words, spoken aloud" })).toBe("other");
    expect(micErrorName({ name: "unsupported" })).toBe("other");
    expect(micErrorName({ name: "no-track" })).toBe("other");
    expect(micErrorName(null)).toBe("other");
  });
});
