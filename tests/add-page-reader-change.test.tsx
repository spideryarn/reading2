// @vitest-environment jsdom
/**
 * **The add page when the signed-in reader changes under it** —
 * docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md.
 *
 * Reader A is at `/add/<url>`, has typed why they are reading and ticked
 * High-powered AI. Another tab signs in as reader B, or this one signs out
 * and B signs in. Two things must hold, and they fail separately:
 *
 *  1. **the screen**: B sees none of A's words or choices, and no import
 *     starts for B from this page (src/web/add-visit.ts, kept by `App`);
 *  2. **the writes still owed**: A's purpose and A's High-powered request are
 *     not sent with B's token (`NotThisReader` in src/web/lib/api.ts).
 *
 * **Through the real `App`**, the real `useSession`, the real
 * `AddPurposeSession` and `HighPowerIntent`, and the real `apiFetch`: what is
 * replaced is the Supabase client (this file *is* the SDK, and says who is
 * signed in) and `fetch` (every request is recorded with the token it
 * carried, which is the whole question). The job queue is replaced too: an
 * add POST waiting for its token is the engines' own case
 * (tests/engines-send-as-their-reader.test.ts), and here it only needs
 * counting.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom's storages are shadowed by Node's own globals here (tests/add-page-purpose.test.tsx). */
for (const name of ["localStorage", "sessionStorage"] as const) {
  const held = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
      clear: () => held.clear(),
    },
  });
}
class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver, IntersectionObserver: NoResizeObserver });
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

/* ---- The SDK: who is signed in, and everybody who asked to be told. ---- */

interface FakeSession {
  access_token: string;
  user: { id: string; email: string };
}
let signedIn: FakeSession | null = null;
let holdSessions = false;
let heldSessions: (() => void)[] = [];
const listeners = new Set<(event: string, session: FakeSession | null) => void>();
const sessionOf = (id: string): FakeSession => ({
  access_token: `TOKEN-${id}`,
  user: { id, email: `${id}@example.com` },
});

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: () => holdSessions
        ? new Promise((resolve) => { heldSessions.push(() => resolve({ data: { session: signedIn } })); })
        : Promise.resolve({ data: { session: signedIn } }),
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

/* ---- The queue: counted, and tagged with who was signed in at the press. ---- */

const SLUG = "a-paper";
const ADDRESS = "https://example.com/a-paper";
const UPLOAD_ID = "c4a1e6d2-7b3f-4e58-9a0c-261006e00001";
const FILENAME = "reader-a-private-draft.pdf";
const makeJob = (id: string, extra: Partial<Job> = {}): Job =>
  ({ id, slug: SLUG, status: "running", steps: [], ...extra }) as unknown as Job;

let jobs: Job[] = [];
/** Who was signed in at each add POST the page asked for. */
let adds: (string | null)[] = [];
const queue: UseJobs = {
  get jobs() {
    return jobs;
  },
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => {
    adds.push(signedIn?.user.id ?? null);
    const job = makeJob(`job-${adds.length}`);
    jobs = [job];
    return job;
  },
  addUpload: async () => {
    adds.push(signedIn?.user.id ?? null);
    const job = makeJob(`job-${adds.length}`, {
      upload: { filename: FILENAME },
    } as unknown as Partial<Job>);
    jobs = [job];
    return job;
  },
  run: async () => null,
  reset: async () => null,
  cancel: async () => {},
  retry: async () => null,
  forget: async () => {},
};
let realJobs = false;
vi.mock("../src/web/useJobs.js", async () => {
  const actual = await vi.importActual<typeof import("../src/web/useJobs.js")>("../src/web/useJobs.js");
  return {
    useJobs: (...args: Parameters<typeof actual.useJobs>) => {
      const live = actual.useJobs(...args);
      return realJobs ? live : queue;
    },
    useJobSession: (...args: Parameters<typeof actual.useJobSession>) => {
      actual.useJobSession(realJobs ? args[0] : null, realJobs ? args[1] : null);
    },
  };
});
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => null }));

/* ---- The network: every request, with the token it carried. ---- */

interface Sent {
  method: string;
  url: string;
  token: string | null;
  body: string | null;
}
let sent: Sent[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** How the purpose PATCH answers. Replaced by the case that holds one back. */
let patchAnswer: () => Promise<Response>;
/** How High-powered AI's PUT answers. A 404 is *not yet*, and is retried each second. */
let putAnswer: () => Promise<Response>;

function answer(method: string, url: string): Promise<Response> {
  if (url === "/api/jobs") return Promise.resolve(json(method === "GET" ? { jobs: [] } : makeJob("real-add")));
  if (method === "PATCH" && url.startsWith("/api/library/")) return patchAnswer();
  if (method === "PUT" && url.endsWith("/high-power")) return putAnswer();
  if (url.startsWith("/api/reader")) {
    return Promise.resolve(json({ autoModes: true, purpose: null, purposeFailed: false }));
  }
  if (url.startsWith("/api/metadata/")) return Promise.resolve(json({ error: "No article" }, 404));
  if (url.startsWith("/api/library")) return Promise.resolve(json([]));
  return Promise.resolve(json({}));
}

const writesOf = (method: string, ending: string): Sent[] =>
  sent.filter((r) => r.method === method && r.url.endsWith(ending));
const purposeWrites = (): Sent[] => writesOf("PATCH", `/api/library/${SLUG}`);
const powerWrites = (): Sent[] => writesOf("PUT", "/high-power");
const purposeReads = (): Sent[] => sent.filter((r) => r.url === `/api/reader?slug=${SLUG}`);

const { App } = await import("../src/web/App.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { resetSessionForTests } = await import("../src/web/lib/session.js");
const { resetAddPurposeForTests } = await import("../src/web/AddPage.js");
const { ADD_PURPOSE_IDLE_MS } = await import("../src/web/add-purpose.js");
const { resetAutoModesSettingForTests } = await import("../src/web/auto-modes-setting.js");
const { navigate, LIBRARY_HREF } = await import("../src/web/router.js");
const { pageTitle } = await import("../src/web/page-title.js");

let host: HTMLDivElement;
let root: Root;

/** Let requests answer and effects run, without moving the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}
async function pause(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

/** The SDK announcing a change of session to everybody listening, `apiFetch`'s cache included. */
async function become(id: string | null): Promise<void> {
  signedIn = id === null ? null : sessionOf(id);
  act(() => {
    for (const fn of [...listeners]) fn(id === null ? "SIGNED_OUT" : "SIGNED_IN", signedIn);
  });
  await settle();
}

async function open(path: string, as: string | null): Promise<void> {
  history.replaceState(null, "", path);
  act(() => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await become(as);
}
async function go(href: string): Promise<void> {
  act(() => navigate(href));
  await settle();
}

const box = (): HTMLTextAreaElement | null => host.querySelector<HTMLTextAreaElement>("textarea#add-purpose");
const highPowerBox = (): HTMLInputElement | null =>
  host.querySelector<HTMLInputElement>("[data-add-high-power] input[type=checkbox]");
function type(value: string): void {
  const el = box();
  if (!el) throw new Error("no purpose box on the page");
  act(() => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function tickHighPower(): void {
  const el = highPowerBox();
  if (!el) throw new Error("no High-powered AI box on the page");
  act(() => el.click());
}
const stoppedPage = (): HTMLElement | null => host.querySelector<HTMLElement>("[data-add-stopped]");
const announcer = (): string => document.getElementById("spya-page-title-announcer")?.textContent ?? "";

const URL_PATH = `/add/${ADDRESS}`;
const UPLOAD_PATH = `/add/upload/${UPLOAD_ID}`;
const WORDS = "Reader A wants the dosing table";

beforeEach(() => {
  vi.useFakeTimers();
  signedIn = null;
  realJobs = false;
  holdSessions = false;
  heldSessions = [];
  jobs = [];
  adds = [];
  sent = [];
  patchAnswer = async () => json({ entry: null, purpose: WORDS });
  putAnswer = async () => json({ highPowerSince: "2026-10-06T12:00:00.000Z" });
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const auth = new Headers(init.headers).get("Authorization");
    sent.push({
      method,
      url: input,
      token: auth === null ? null : auth.replace("Bearer ", ""),
      body: typeof init.body === "string" ? init.body : null,
    });
    return answer(method, input);
  });
  resetAddPurposeForTests();
  resetAutoModesSettingForTests();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  await settle();
  host.remove();
  jobEngine.reset();
  /* Not `listeners.clear()`: the one listener is lib/session.ts's, registered
     at import for the life of the page. What it holds is put back instead. */
  resetSessionForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what reader B sees", () => {
  it("is none of reader A's words, tick, or address, and a generic tab title", async () => {
    await open(URL_PATH, "A");
    type(WORDS);
    tickHighPower();
    await settle();
    /* The page under test can show all of it, or the absences below prove nothing. */
    expect(box()?.value).toBe(WORDS);
    expect(highPowerBox()?.checked).toBe(true);
    expect(host.textContent).toContain("example.com");
    expect(document.title).toContain("example.com");

    await become("B");

    expect(host.textContent).not.toContain(WORDS);
    expect(host.innerHTML).not.toContain(WORDS);
    expect(box()?.value).toBeUndefined();
    expect(stoppedPage()).not.toBeNull();
    expect(host.innerHTML).not.toContain("example.com");
    expect(box()).toBeNull();
    expect(highPowerBox()).toBeNull();
    /* Nothing to press on the page itself. The corner Feedback button is the app's. */
    expect(stoppedPage()?.querySelector("button, input, textarea")).toBeNull();
    expect(stoppedPage()?.querySelector(`a[href="${LIBRARY_HREF}"]`)?.textContent).toContain("Back to the shelf");
    expect(document.title).toBe(pageTitle({ kind: "add" }));
  });

  it("does not include the filename of reader A's upload, in the page, the tab or what is announced", async () => {
    await open(UPLOAD_PATH, "A");
    await pause(500);
    expect(document.title).toContain(FILENAME.slice(0, 12));
    expect(announcer()).toContain(FILENAME.slice(0, 12));

    await become("B");
    expect(host.innerHTML).not.toContain("reader-a");
    expect(document.title).not.toContain("reader-a");
    expect(stoppedPage()).not.toBeNull();
    /* Emptied at once, and what replaces it is the generic title. */
    expect(announcer()).not.toContain("reader-a");
    await pause(500);
    expect(announcer()).not.toContain("reader-a");
    expect(announcer()).not.toBe("");
    expect(document.title).toBe(pageTitle({ kind: "add" }));
  });
});

describe("no import starts for reader B from reader A's page", () => {
  it.each([
    [URL_PATH, "A"], [URL_PATH, "B"], [UPLOAD_PATH, "A"], [UPLOAD_PATH, "B"],
  ])("binds the first POST at %s to A when its token lookup answers %s", async (path, next) => {
    realJobs = true;
    holdSessions = true;
    await open(path, "A");
    expect(jobEngine.reader()).toBe("A");
    expect(heldSessions.length).toBeGreaterThan(0);
    expect(sent.filter((r) => r.method === "POST" && r.url === "/api/jobs")).toEqual([]);

    await become(next);
    holdSessions = false;
    for (const resolve of heldSessions.splice(0)) resolve();
    await settle();
    const posts = sent.filter((r) => r.method === "POST" && r.url === "/api/jobs");
    if (next === "B") {
      expect(stoppedPage()).not.toBeNull();
      expect(posts).toEqual([]);
    } else {
      expect(stoppedPage()).toBeNull();
      expect(posts.map((r) => r.token)).toEqual(["TOKEN-A"]);
    }
  });

  it("directly: another tab signs in as B", async () => {
    await open(URL_PATH, "A");
    expect(adds).toEqual(["A"]);
    await become("B");
    await pause(5_000);
    expect(adds).toEqual(["A"]);
    expect(stoppedPage()).not.toBeNull();
  });

  it("through signing out: A, then nobody, then B", async () => {
    await open(URL_PATH, "A");
    await become(null);
    expect(stoppedPage()).toBeNull();
    await become("B");
    await pause(5_000);
    expect(adds).toEqual(["A"]);
    expect(stoppedPage()).not.toBeNull();
  });

  it("and it stays stopped when A comes back: A, then B, then A", async () => {
    await open(URL_PATH, "A");
    await become("B");
    await become("A");
    await pause(5_000);
    expect(adds).toEqual(["A"]);
    expect(stoppedPage()).not.toBeNull();
    expect(box()).toBeNull();
  });

  it("until the address is left: from the shelf, B's own add runs", async () => {
    await open(URL_PATH, "A");
    await become("B");
    await go(LIBRARY_HREF);
    await go(URL_PATH);
    expect(stoppedPage()).toBeNull();
    expect(adds).toEqual(["A", "B"]);
  });

  it("somebody who arrives signed out and signs in gets a running page that posts once", async () => {
    await open(URL_PATH, null);
    expect(adds).toEqual([]);
    await become("B");
    await pause(5_000);
    expect(stoppedPage()).toBeNull();
    expect(box()).not.toBeNull();
    expect(adds).toEqual(["B"]);
  });
});

describe("what reader A still owed is not sent as reader B", () => {
  it("the unsaved purpose: no PATCH leaves, after the idle timer or after retirement", async () => {
    await open(URL_PATH, "A");
    /* Seeded: the box has read what is stored, so it may save. */
    expect(purposeReads().map((r) => r.token)).toEqual(["TOKEN-A"]);
    type(WORDS);
    await settle();
    expect(purposeWrites()).toEqual([]);

    await become("B");
    await pause(ADD_PURPOSE_IDLE_MS * 3);
    await go(LIBRARY_HREF);
    await pause(ADD_PURPOSE_IDLE_MS * 3);
    expect(purposeWrites()).toEqual([]);
  });

  it("the same words do leave for reader A, so the case above is about the reader", async () => {
    await open(URL_PATH, "A");
    type(WORDS);
    await pause(ADD_PURPOSE_IDLE_MS * 3);
    expect(purposeWrites().map((r) => r.token)).toEqual(["TOKEN-A"]);
  });

  /**
   * The `keepalive` write, which waits for no token and takes the one the tab
   * last saw. **The page is still reader A's here**: the SDK has announced B,
   * and `pagehide` fires before React has rendered that. So this is the one
   * case where A's own page is what sends, and the stopped page is no help.
   */
  it("the purpose on the way out: pagehide between the change and its render sends nothing", async () => {
    await open(URL_PATH, "A");
    type(WORDS);
    await settle();
    signedIn = sessionOf("B");
    act(() => {
      for (const fn of [...listeners]) fn("SIGNED_IN", signedIn);
      expect(box()?.value).toBe(WORDS);
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    expect(purposeWrites()).toEqual([]);
  });

  it("the waiting High-powered intent: no PUT leaves while B is signed in", async () => {
    putAnswer = async () => json({ error: "No article" }, 404);
    await open(URL_PATH, "A");
    tickHighPower();
    await pause(2_500);
    /* Waiting, and asking again each second, as reader A. */
    const before = powerWrites().length;
    expect(before).toBeGreaterThanOrEqual(2);
    expect(new Set(powerWrites().map((r) => r.token))).toEqual(new Set(["TOKEN-A"]));

    await become("B");
    await pause(10_000);
    expect(powerWrites().length).toBe(before);
  });
});

describe("two readers with an article under one slug", () => {
  it("reader B's purpose read proceeds while reader A's PATCH is unanswered", async () => {
    /* Never answered. */
    patchAnswer = () => new Promise<Response>(() => {});
    await open(URL_PATH, "A");
    type(WORDS);
    await pause(ADD_PURPOSE_IDLE_MS * 3);
    expect(purposeWrites().map((r) => r.token)).toEqual(["TOKEN-A"]);

    await become("B");
    await go(LIBRARY_HREF);
    await go(URL_PATH);
    await pause(2_000);
    expect(adds).toEqual(["A", "B"]);
    expect(purposeReads().map((r) => r.token)).toEqual(["TOKEN-A", "TOKEN-B"]);
    expect(box()?.value).toBe("");
  });
});
