// @vitest-environment jsdom
/**
 * **The microphone control on the fleet dashboard, and the case it must not be
 * silent about.**
 *
 * `tools/fleet/web/src/DictationControl.tsx`.
 *
 * The test that matters here is the one about a **secure context**, and it
 * exists because the bug it pins would have shipped invisibly.
 * `getUserMedia` requires a secure context; `127.0.0.1` and `localhost` are
 * trustworthy by exception, so dictation works over the ssh forward Greg uses
 * from his laptop. A phone reaching `http://100.92.255.119:8787` over the
 * tailnet is **not** a secure context: `navigator.mediaDevices` is `undefined`
 * there, `useDictation`'s `supported` is false, and the first draft of this
 * component returned `null`.
 *
 * No button, no error, nothing to search for — on the one surface this feature
 * was built for. `tools/fleet/` spent 2026-09-08 fixing four features that were
 * silently dead, and that would have been the fifth. So the component says why,
 * and says which of the two reasons it is, because only one of them has a fix
 * and the fix is `tailscale serve` rather than anything in this repo.
 *
 * Nothing here opens a microphone: `useDictation`'s state is handed in as a
 * literal, which is the point — this file is about what is *drawn* for a given
 * state, and the state machine has its own tests in `tests/dictation-phases.ts`
 * and `tests/dictation-recording.test.ts`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { UseDictation } from "../src/web/useDictation.js";
import { DictationControl } from "../tools/fleet/web/src/DictationControl";
import { sendForTranscription } from "../tools/fleet/web/src/dictation-client";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A resting, working microphone. Fields are overridden per test. */
function dictation(over: Partial<UseDictation> = {}): UseDictation {
  return {
    supported: true,
    phase: "idle",
    armed: false,
    transcribing: false,
    liveText: true,
    interim: "",
    level: { current: 0 },
    meter: "none",
    quiet: false,
    toggle: () => {},
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
    ...over,
  } as UseDictation;
}

function draw(d: UseDictation): string {
  act(() => {
    root.render(<DictationControl dictation={d} toggle={() => {}} />);
  });
  return host.textContent ?? "";
}

/** jsdom leaves `isSecureContext` alone, so a test says which world it is in. */
function withSecureContext(secure: boolean, run: () => void): void {
  const had = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
  try {
    run();
  } finally {
    if (had) Object.defineProperty(window, "isSecureContext", had);
    else Reflect.deleteProperty(window as unknown as Record<string, unknown>, "isSecureContext");
  }
}

/* ------------------------------------------------------------------ *
 * The client half of POST /api/transcribe.
 * ------------------------------------------------------------------ */

describe("what the browser makes of the server's answer", () => {
  const blob = { size: 100_000, arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Blob;

  function withFetch(reply: { status: number; body: unknown }) {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.body === undefined) throw new SyntaxError("not json");
        return reply.body;
      },
    })) as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  it("does not turn an unreadable 200 into a transcript of nothing", async () => {
    /* **`text: ""` means somebody pressed the button and said nothing**, and the box must be left
       exactly as it was. A server answering `{}` means something else entirely, and collapsing the
       two showed either the misleading "we heard no speech" line or — on Chromium — left the rough
       live guesses standing as if they were the real transcript.

       The server already draws this distinction when OpenRouter does it to us
       (`tests/fleet-transcribe.test.ts`, "tells 'answered nonsense' apart from 'never answered'");
       the client was undoing it one hop later. GPT Sol, 2026-09-08. */
    const restore = withFetch({ status: 200, body: {} });
    try {
      const r = await sendForTranscription(blob, "audio/webm", { kind: "new-session" });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.message).toContain("[mic-unreadable]");
    } finally {
      restore();
    }
  });

  it("still treats an empty string as the success it is", async () => {
    /* The other half, and the reason the check has to be on the TYPE rather than on emptiness. */
    const restore = withFetch({ status: 200, body: { text: "" } });
    try {
      expect(await sendForTranscription(blob, "audio/webm", { kind: "new-session" })).toEqual({
        ok: true,
        text: "",
      });
    } finally {
      restore();
    }
  });

  it("shows the server's own sentence, never the raw body", async () => {
    /* An unparsed body is somebody else's HTML — a proxy's, a captive portal's — and putting it on
       screen is how a stack trace ends up rendered as an error message. */
    const restore = withFetch({ status: 503, body: { error: "Dictation is not configured. [mic-not-set-up]" } });
    try {
      const r = await sendForTranscription(blob, "audio/webm", { kind: "new-session" });
      expect(r.ok === false && r.message).toContain("[mic-not-set-up]");
      /* 503 is "nothing you can do", so no Retry button. */
      expect(r.ok === false && r.retryable).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("when a microphone cannot be opened", () => {
  it("never renders nothing", () => {
    /* THE WHOLE POINT. A control that disappears is indistinguishable from a
       feature nobody built, and it is what somebody reaching this page over the
       tailnet would have seen. */
    withSecureContext(false, () => {
      expect(draw(dictation({ supported: false })).trim()).not.toBe("");
    });
    withSecureContext(true, () => {
      expect(draw(dictation({ supported: false })).trim()).not.toBe("");
    });
  });

  it("names the secure context, and points at the fix that is not code", () => {
    withSecureContext(false, () => {
      const text = draw(dictation({ supported: false }));
      expect(text).toContain("secure");
      /* The two ways out, both of which are about how the page is REACHED. */
      expect(text).toContain("ssh forward");
      expect(text).toContain("tailscale serve");
    });
  });

  it("blames the browser only when the page itself is fine", () => {
    /* Told apart, because sending somebody to reconfigure Tailscale over a
       browser that has no microphone API wastes an afternoon in the wrong
       place — and so does the reverse. */
    withSecureContext(true, () => {
      const text = draw(dictation({ supported: false }));
      expect(text).toContain("browser");
      expect(text).not.toContain("tailscale serve");
    });
  });
});

describe("what it says while it is working", () => {
  it("makes the ~1.1 second gap before the microphone opens visible", () => {
    /* Measured in the product: pressing the button and the microphone actually
       opening are ~1.1s apart, and with nothing on screen somebody says a word
       into nothing and concludes it is broken. */
    expect(draw(dictation({ armed: true, startedAt: null }))).toContain("Opening the microphone");
  });

  it("tells a browser with no live words that the words come at the end", () => {
    /* Safari and Firefox. Without this somebody watches an empty box and reads
       silence as failure. */
    const text = draw(dictation({ armed: true, startedAt: 1, liveText: false }));
    expect(text).toContain("words arrive when you stop");
  });

  it("offers Stop while armed, and never disables it", () => {
    /* The same button is Stop. Disabling it mid-dictation would trap the
       recording — GPT Sol caught that as a P0 in the product. */
    act(() => {
      root.render(<DictationControl dictation={dictation({ armed: true, startedAt: 1 })} toggle={() => {}} />);
    });
    const button = host.querySelector("button");
    expect(button?.textContent).toContain("Stop");
    expect(button?.disabled).toBe(false);
  });

  it("disables the button through the transcribing gap, and only then", () => {
    /* A press there could only mean "start again", and starting again a moment
       before the words arrive throws away the dictation just given. */
    act(() => {
      root.render(<DictationControl dictation={dictation({ transcribing: true })} toggle={() => {}} />);
    });
    expect(host.querySelector("button")?.disabled).toBe(true);
    act(() => {
      root.render(<DictationControl dictation={dictation()} toggle={() => {}} />);
    });
    expect(host.querySelector("button")?.disabled).toBe(false);
  });

  it("reports a quiet meter as an observation, not a diagnosis", () => {
    /* live-conversation.md's sentence: a quiet meter is an observation, not a
       claim that the microphone is broken. The room may be quiet. */
    const text = draw(dictation({ armed: true, startedAt: 1, quiet: true, meter: "measured" }));
    expect(text).toContain("Not hearing much");
    expect(text.toLowerCase()).not.toContain("broken");
    expect(text.toLowerCase()).not.toContain("not working");
  });

  it("shows a failure sentence rather than swallowing it", () => {
    /* On a phone, "the mic gave us nothing", "the upload failed" and "the model
       refused" all look like the button doing nothing. Every one of them
       arrives here as a sentence with a bracketed code. */
    expect(draw(dictation({ error: "The microphone could not be started. [mic-no-start]" }))).toContain(
      "[mic-no-start]",
    );
  });

  it("offers Try again only when a second attempt could go the other way", () => {
    /* False after a success with an empty transcript, where sending the same
       silence again spends a model call to produce the same nothing. */
    expect(draw(dictation({ canRetry: false, error: "no" }))).not.toContain("Try again");
    expect(draw(dictation({ canRetry: true, error: "no" }))).toContain("Try again");
  });
});
