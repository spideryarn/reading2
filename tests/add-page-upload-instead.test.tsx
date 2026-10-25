// @vitest-environment jsdom
/**
 * **A failed import whose sentence says to upload the file offers the upload
 * where the reader is** — src/web/UploadInstead.tsx, wired into
 * src/web/AddPage.tsx under `failureSuggestsUpload`.
 * docs/plans/261015a-a-site-that-refuses-the-app-a-better-way-round-and-the-bigger-options-for-greg.md.
 *
 *  - a site that refused the app (`[fetch-refused]`) gets the control; a
 *    timeout, whose sentence says to try again, and a running import do not;
 *  - choosing a file and pressing Add hands it to the shelf's own upload
 *    engine and goes to `/add/upload/<id>`, as the shelf's Add does;
 *  - the Chrome extension is offered above the bookmarklet only where it gets
 *    round the failure, and only once there is a store item (plan 261025b).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { Transfer } from "../src/web/uploadEngine.js";
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

let jobs: Job[] = [];
let addResult: Job | null = null;
const queue: UseJobs = {
  get jobs() {
    return jobs;
  },
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => addResult,
  addUpload: async () => null,
  run: async () => null,
  reset: async () => null,
  cancel: async () => {},
  retry: async () => null,
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));
let transfer: Transfer | null = null;
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => transfer }));

const sent: string[] = [];
let forgotten = 0;
vi.mock("../src/web/uploadEngine.js", () => ({
  uploadEngine: {
    retry: () => {},
    cancel: () => {},
    forget: () => {
      forgotten += 1;
      transfer = null;
    },
    send: async (file: File) => {
      sent.push(file.name);
      return "up-1";
    },
  },
}));

/** Every file handed to the shelf's minimal batch import, which this control must never start. */
const batched: string[] = [];
vi.mock("../src/web/batchUpload.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/batchUpload.js")>();
  return {
    ...actual,
    batchUpload: {
      ...actual.batchUpload,
      add: (files: File[]) => {
        batched.push(...files.map((f) => f.name));
      },
    },
  };
});

/** `EXTENSION_STORE_URL`, as each test wants it: `null` is today's production. */
let storeUrl: string | null = null;
vi.mock("../src/web/extension-handoff.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/extension-handoff.js")>();
  return {
    ...actual,
    get EXTENSION_STORE_URL() {
      return storeUrl;
    },
  };
});

const navigations: string[] = [];
vi.mock("../src/web/router.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/router.js")>()),
  navigate: (href: string) => {
    navigations.push(href);
  },
}));

const json = (body: unknown, init: ResponseInit = { status: 200 }) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

vi.mock("../src/web/lib/api.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/lib/api.js")>();
  return {
    ...actual,
    apiFetch: async (input: string) => {
      if (input === "/api/reader") return json({ autoModes: true });
      if (input.startsWith("/api/reader?slug=")) return json({ autoModes: true, purpose: null, purposeFailed: false });
      return json({ error: "No article" }, { status: 404 });
    },
    leavingFetch: () => Promise.resolve(),
  };
});

const { AddPage, resetAddPurposeForTests } = await import("../src/web/AddPage.js");
const { resetAutoModesSettingForTests } = await import("../src/web/auto-modes-setting.js");
const { resetShareAtAddForTests } = await import("../src/web/add-share.js");
const { addUploadHref } = await import("../src/web/router.js");
const { fetchFailed } = await import("../src/messages.js");
const { ONE_FILE_HERE } = await import("../src/web/UploadPicker.js");

const URL = "https://www.cell.com/fulltext/S1364-6613(15)00180-1";

/** An import: `fetch` among its steps is what `isImportJob` asks. A mode job carries a `url` too. */
const makeJob = (status: Job["status"], error?: string, step = "fetch"): Job =>
  ({
    id: "job-1",
    slug: "a-paper",
    url: URL,
    status,
    steps: [{ name: step, status: status === "error" ? "error" : "pending" }],
    ...(error ? { error } : {}),
  }) as unknown as Job;

let host: HTMLDivElement;
let root: Root;

async function show(job: Job): Promise<void> {
  addResult = job;
  jobs = [job];
  act(() => root.render(createElement(AddPage, { source: { kind: "url", url: URL } })));
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

const control = () => host.querySelector('section[aria-label="Upload a file instead"]');

function drop(files: File[]): void {
  const target = control()?.parentElement;
  if (!target) throw new Error("no drop target");
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: ["Files"], dropEffect: "none" },
  });
  act(() => target.dispatchEvent(event));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAutoModesSettingForTests();
  resetAddPurposeForTests();
  resetShareAtAddForTests();
  window.sessionStorage.clear();
  jobs = [];
  addResult = null;
  transfer = null;
  sent.length = 0;
  forgotten = 0;
  batched.length = 0;
  navigations.length = 0;
  storeUrl = null;
  /* A mouse: the extension and the bookmarklet are offered only to a fine pointer. */
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query === "(pointer: fine)", media: query }),
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  await vi.advanceTimersByTimeAsync(0);
  host.remove();
  vi.useRealTimers();
});

describe("Upload a file instead, on the add page", () => {
  it("is offered under a site that refused the app", async () => {
    await show(makeJob("error", fetchFailed("forbidden", 403).message));
    expect(control()).not.toBeNull();
  });

  it("is not offered under a failure whose sentence says to try again", async () => {
    await show(makeJob("error", fetchFailed("timeout", null).message));
    expect(control()).toBeNull();
  });

  it("is not offered while the import is still going", async () => {
    await show(makeJob("running"));
    expect(control()).toBeNull();
  });

  it("is not offered under a mode job that failed the same way", async () => {
    await show(makeJob("error", fetchFailed("forbidden", 403).message, "summary"));
    expect(control()).toBeNull();
  });

  it("is not offered for an import job without an address", async () => {
    const job = makeJob("error", fetchFailed("forbidden", 403).message);
    delete job.url;
    await show(job);
    expect(control()).toBeNull();
  });

  it("takes one file, and says so to two rather than starting the shelf's batch", async () => {
    await show(makeJob("error", fetchFailed("forbidden", 403).message));
    const input = control()?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    expect(input.multiple).toBe(false);
    const files = ["a.pdf", "b.pdf"].map((name) => new File(["%PDF-1.7\n"], name, { type: "application/pdf" }));
    Object.defineProperty(input, "files", { configurable: true, value: files });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(control()?.textContent).toContain(ONE_FILE_HERE);
    expect(sent).toEqual([]);
    expect(batched).toEqual([]);
  });

  it("refuses two dropped files rather than committing either or starting the shelf's batch", async () => {
    await show(makeJob("error", fetchFailed("forbidden", 403).message));
    const files = ["a.pdf", "b.pdf"].map(
      (name) => new File(["%PDF-1.7\n"], name, { type: "application/pdf" }),
    );
    drop(files);
    expect(control()?.textContent).toContain(ONE_FILE_HERE);
    expect(sent).toEqual([]);
    expect(batched).toEqual([]);
  });

  it("labels another terminal transfer and replaces it when a new file is chosen", async () => {
    transfer = {
      uploadId: "up-old",
      filename: "another-paper.pdf",
      bytes: 12,
      phase: { kind: "failed", at: "granting", reason: "The old upload failed.", status: null },
    };
    await show(makeJob("error", fetchFailed("forbidden", 403).message));
    expect(control()?.textContent).toContain("Another upload: another-paper.pdf");
    const input = control()?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = new File(["%PDF-1.7\n"], "replacement.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(forgotten).toBe(1);
    expect(control()?.textContent).toContain("replacement.pdf");
    expect(control()?.textContent).not.toContain("The old upload failed.");
  });

  it("hands the chosen file to the upload engine and goes to its add page", async () => {
    await show(makeJob("error", fetchFailed("forbidden", 403).message));
    const input = control()?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = new File(["%PDF-1.7\n"], "mental-imagery.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const add = [...(control()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "Add");
    if (!add) throw new Error("no Add button after choosing a file");
    await act(async () => {
      add.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sent).toEqual(["mental-imagery.pdf"]);
    expect(navigations).toContain(addUploadHref("up-1"));
  });
});

describe("the Chrome extension, under a failed import (plan 261025b)", () => {
  const STORE = "https://chromewebstore.google.com/detail/abcdefghijklmnopabcdefghijklmnop";
  const storeLink = () => control()?.querySelector<HTMLAnchorElement>(`a[href="${STORE}"]`) ?? null;

  it("is offered under a site that refused the app, opening the store in a new tab", async () => {
    storeUrl = STORE;
    await show(makeJob("error", fetchFailed("forbidden", 403).message));
    const link = storeLink();
    expect(link?.textContent).toBe("Get it from the Chrome Web Store");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
    /* Above the bookmarklet: the better way round where it reaches. */
    const bookmarklet = [...(control()?.querySelectorAll("a") ?? [])].find((a) => a.textContent?.includes("Save for Spideryarn"));
    expect(bookmarklet).toBeDefined();
    expect(link!.compareDocumentPosition(bookmarklet!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not offered where it would not help, though the upload is", async () => {
    storeUrl = STORE;
    await show(makeJob("error", fetchFailed("invalid-url", null).message));
    expect(control()).not.toBeNull();
    expect(storeLink()).toBeNull();
    expect(control()?.textContent).not.toContain("Chrome");
  });

  it("is not offered while there is no store item", async () => {
    await show(makeJob("error", fetchFailed("forbidden", 403).message));
    expect(control()).not.toBeNull();
    expect(control()?.textContent).not.toContain("Chrome");
  });

  it("is not offered on a phone", async () => {
    storeUrl = STORE;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({ matches: query === "(pointer: coarse)", media: query }),
    });
    await show(makeJob("error", fetchFailed("forbidden", 403).message));
    expect(control()).not.toBeNull();
    expect(storeLink()).toBeNull();
  });
});
