// @vitest-environment jsdom
/**
 * **The Feedback box is drawn inside the reader `App` provides**, so a write
 * it makes late (a dictated recording still draining, most of all) names the
 * reader it was mounted for. docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2.
 *
 * `FeedbackHost` wraps every page and draws the dialog itself, beside its
 * children. With the provider inside the host, the pages had a reader and
 * the dialog had `null`, which is unfenced: a recording made by reader A in
 * the Feedback box could be uploaded with reader B's token.
 *
 * The dialog here is **the real one, with a probe beside it** that says what
 * `useMadeFor` answers at the place the real one is drawn. Dictation's field
 * is replaced, and hands the test the one thing the dialog gives it that
 * outlives a change of reader: the callback that uploads a recording.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DictationContext } from "../src/web/dictation-upload.js";
import type { Transcriber } from "../src/web/transcriber.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom's storages are shadowed by Node's own globals here (tests/add-page-purpose.test.tsx). */
for (const name of ["localStorage", "sessionStorage"] as const) {
  const kept = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
      clear: () => kept.clear(),
    },
  });
}
class NoObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoObserver, IntersectionObserver: NoObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
/* jsdom has no `showModal` (tests/feedback-dialog.test.tsx). */
Object.assign(window.HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  },
  close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  },
});

interface FakeSession {
  access_token: string;
  user: { id: string; email: string };
}
let signedIn: FakeSession | null = null;
const listeners = new Set<(event: string, session: FakeSession | null) => void>();
const sessionOf = (id: string): FakeSession => ({
  access_token: `TOKEN-${id}`,
  user: { id, email: `${id}@example.com` },
});

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: signedIn } }),
      refreshSession: async () => ({ data: { session: signedIn } }),
      onAuthStateChange: (fn: (event: string, session: FakeSession | null) => void) => {
        listeners.add(fn);
        return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
      },
    },
  },
  googleSignInAvailable: false,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));
/** The upload callback of the Feedback dialog drawn last: what a draining tape calls. */
let mountedTranscriber: Transcriber<DictationContext> | null = null;
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: (options: { transcribe?: Transcriber<DictationContext> }) => {
    if (options.transcribe) mountedTranscriber = options.transcribe;
    return {
      dictation: { supported: false, armed: false, transcribing: false },
      readOnly: false,
      busy: false,
      toggle: () => {},
    };
  },
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));

vi.mock("../src/web/FeedbackDialog.js", async (importActual) => {
  const real = await importActual<typeof import("../src/web/FeedbackDialog.js")>();
  const { useMadeFor } = await import("../src/web/lib/made-for.js");
  const { createElement: h, Fragment } = await import("react");
  type Props = Parameters<typeof real.FeedbackDialog>[0];
  return {
    ...real,
    FeedbackDialog: (props: Props) =>
      h(
        Fragment,
        null,
        h("output", { "data-feedback-made-for": useMadeFor() ?? "nobody" }),
        h(real.FeedbackDialog, props),
      ),
  };
});

const { App } = await import("../src/web/App.js");

interface Sent {
  method: string;
  url: string;
  as: string | null;
}
let sent: Sent[] = [];
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** The server: each reader's own description, by the token the request carried. */
function answer(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const as = new Headers(init.headers).get("Authorization");
  sent.push({ method, url, as });
  const who = as?.replace("Bearer TOKEN-", "") ?? "nobody";
  const path = url.split("?")[0] ?? url;
  if (method !== "GET") return Promise.resolve(json(typeof init.body === "string" ? JSON.parse(init.body) : {}));
  if (path === "/api/reader") return Promise.resolve(json({ profile: `About ${who}.`, autoModes: true }));
  if (path === "/api/library") return Promise.resolve(json({ articles: [] }));
  if (path === "/api/models") return Promise.resolve(json({ tasks: [] }));
  if (path === "/api/jobs") return Promise.resolve(json({ jobs: [] }));
  return Promise.resolve(json({}));
}
let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
async function become(id: string): Promise<void> {
  signedIn = sessionOf(id);
  act(() => {
    for (const fn of [...listeners]) fn("SIGNED_IN", signedIn);
  });
  await settle();
}
beforeEach(async () => {
  sent = [];
  mountedTranscriber = null;
  vi.stubGlobal("fetch", answer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  history.replaceState(null, "", "/profile");
  act(() => {
    for (const fn of [...listeners]) fn("SIGNED_OUT", null);
  });
  act(() => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await become("A");
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});


it("gives the Feedback dialog the signed-in reader", () => {
  const drawn = host.querySelector("[data-feedback-made-for]");
  expect(drawn?.getAttribute("data-feedback-made-for")).toBe("A");
});

/** The dialog and its one text box, as the reader on screen has them. */
function feedbackBox(): { dialog: HTMLDialogElement; box: HTMLTextAreaElement } {
  const dialog = host.querySelector<HTMLDialogElement>("dialog.fb-dialog");
  const box = dialog?.querySelector<HTMLTextAreaElement>("textarea.fb-body");
  if (!dialog || !box) throw new Error("no Feedback dialog on the page");
  return { dialog, box };
}
async function pressFeedback(): Promise<void> {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Feedback"]');
  if (!trigger) throw new Error("no Feedback button on the page");
  act(() => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await settle();
}
const tape = (...bytes: number[]): Blob =>
  ({ size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as Blob;
const transcriptions = (): (string | null)[] =>
  sent.filter((request) => request.url.startsWith("/api/transcribe")).map((request) => request.as);

it("sends nothing of A's as B, and shows B none of A's draft, when the reader changes with the box open", async () => {
  const draft = "A's half-written report about the margin";
  await pressFeedback();
  const asA = feedbackBox();
  expect(asA.dialog.open).toBe(true);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(asA.box, draft);
    asA.box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(feedbackBox().box.value).toBe(draft);
  const late = mountedTranscriber;
  if (!late) throw new Error("the Feedback dialog gave dictation no upload callback");

  await become("B");

  /* A's tape finishes draining after the account changed: the dialog A typed
     in is gone, and its upload callback is still held by the recorder. */
  const result = await late(tape(1, 2, 3), "audio/webm", { kind: "profile" });
  await settle();
  expect(sent.filter((request) => request.method !== "GET" && request.as === "Bearer TOKEN-B")).toEqual([]);
  expect(transcriptions()).toEqual([]);
  expect(result).toMatchObject({ ok: false });

  /* B's own box: shut by the change, and empty when B opens it. */
  expect(feedbackBox().dialog.open).toBe(false);
  await pressFeedback();
  const asB = feedbackBox();
  expect(asB.dialog.open).toBe(true);
  expect(asB.box.value).toBe("");
  expect(host.innerHTML).not.toContain("half-written report");

  /* And the fence is a fence, not a dead microphone: B's own recording goes, as B. */
  const own = mountedTranscriber;
  if (!own || own === late) throw new Error("B's dialog has A's upload callback");
  await own(tape(4, 5, 6), "audio/webm", { kind: "profile" });
  expect(transcriptions()).toEqual(["Bearer TOKEN-B"]);
});
