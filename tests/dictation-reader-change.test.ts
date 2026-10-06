// @vitest-environment jsdom
/** Real api.ts: converting and retrying audio must retain its first reader. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DictationContext } from "../src/web/dictation-upload.js";
import type { Transcriber } from "../src/web/transcriber.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mountedTranscriber!: Transcriber<DictationContext>;
let roots: Root[] = [];
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: (options: { transcribe: Transcriber<DictationContext> }) => {
    mountedTranscriber = options.transcribe;
    return { dictation: { supported: false, armed: false, transcribing: false }, readOnly: false, toggle() {} };
  },
}));
vi.mock("../src/web/DictationStrip.js", () => ({ DictationButton: () => null, DictationStrip: () => null }));

interface FakeSession {
  access_token: string;
  user: { id: string };
}
let signedIn: FakeSession | null = null;
let announce: (event: string, session: FakeSession | null) => void = () => {};
function become(id: string): void {
  signedIn = { access_token: `TOKEN-${id}`, user: { id } };
  announce("SIGNED_IN", signedIn);
}

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: signedIn } }),
      refreshSession: async () => ({ data: { session: signedIn } }),
      onAuthStateChange: (fn: typeof announce) => {
        announce = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { sendForTranscription } = await import("../src/web/dictation-upload.js");
const { ProfileBox } = await import("../src/web/ProfileBox.js");
const { SignedInReader } = await import("../src/web/lib/made-for.js");
let sent: (string | null)[] = [];
let answer: () => Response = () => new Response(JSON.stringify({ text: "A's words" }));

beforeEach(() => {
  sent = [];
  roots = [];
  answer = () => new Response(JSON.stringify({ text: "A's words" }));
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
    sent.push(new Headers(init.headers).get("Authorization"));
    return answer();
  });
  announce("SIGNED_OUT", null);
  become("A");
});

afterEach(() => {
  act(() => { for (const root of roots) root.unmount(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountBox(reader: string): void {
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(createElement(SignedInReader.Provider, { value: reader }, createElement(ProfileBox, {
    id: "about-you", label: "About you", hint: "", placeholder: "", value: "", onChange() {}, onCommit() {},
    max: 4000, save: { kind: "clean" },
  }))));
}

function recording(arrayBuffer: () => Promise<ArrayBuffer>): Blob {
  return { size: 3, arrayBuffer } as Blob;
}

it("does not send A's audio as B when conversion finishes after the reader changes", async () => {
  let finish!: (value: ArrayBuffer) => void;
  const blob = recording(() => new Promise((resolve) => { finish = resolve; }));
  const pending = sendForTranscription(blob, "audio/webm", { kind: "profile" });
  become("B");
  finish(new Uint8Array([1, 2, 3]).buffer);
  const result = await pending;
  expect(sent).toEqual([]);
  expect(result).toMatchObject({ ok: false, retryable: false });
  const own = recording(async () => new Uint8Array([4, 5, 6]).buffer);
  expect(await sendForTranscription(own, "audio/webm", { kind: "profile" })).toMatchObject({ ok: true });
  expect(sent).toEqual(["Bearer TOKEN-B"]);
});

it("does not retry A's failed recording as B", async () => {
  const blob = recording(async () => new Uint8Array([1, 2, 3]).buffer);
  answer = () => { throw new TypeError("Failed to fetch"); };
  expect(await sendForTranscription(blob, "audio/webm", { kind: "profile" }))
    .toMatchObject({ ok: false, retryable: true });
  become("B");
  const result = await sendForTranscription(blob, "audio/webm", { kind: "profile" });
  expect(sent).toEqual(["Bearer TOKEN-A"]);
  expect(result).toMatchObject({ ok: false, retryable: false });
});

it("still sends the same reader's recording and retry", async () => {
  const blob = recording(async () => new Uint8Array([1, 2, 3]).buffer);
  answer = () => { throw new TypeError("Failed to fetch"); };
  expect(await sendForTranscription(blob, "audio/webm", { kind: "profile" }))
    .toMatchObject({ ok: false, retryable: true });
  answer = () => new Response(JSON.stringify({ text: "A's words" }));
  expect(await sendForTranscription(blob, "audio/webm", { kind: "profile" }))
    .toEqual({ ok: true, text: "A's words" });
  expect(sent).toEqual(["Bearer TOKEN-A", "Bearer TOKEN-A"]);
});

it("does not first upload A's tape as B when its mounted callback is invoked after the account changes", async () => {
  mountBox("A");
  const late = mountedTranscriber;
  become("B");
  // Tape draining can finish after the event and before React unmounts A's box.
  const blob = recording(async () => new Uint8Array([1, 2, 3]).buffer);
  const result = await late(blob, "audio/webm", { kind: "profile" });
  expect(sent).toEqual([]);
  expect(result).toMatchObject({ ok: false, retryable: false });
  mountBox("B");
  const own = recording(async () => new Uint8Array([4, 5, 6]).buffer);
  expect(await mountedTranscriber(own, "audio/webm", { kind: "profile" })).toMatchObject({ ok: true });
  expect(sent).toEqual(["Bearer TOKEN-B"]);
});
