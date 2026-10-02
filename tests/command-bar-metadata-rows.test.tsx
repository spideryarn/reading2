// @vitest-environment jsdom
/**
 * **The command bar's Metadata rows, pressed** — the section rows, Archive and
 * Export, stage B of
 * docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md, drawn
 * out of the real `Dock` as tests/command-bar-rerun-and-find.test.tsx draws it.
 *
 * Greg, 2026-10-01 (SPIDERYARN-READING2-8D): *"look for ways to make Commands
 * more powerful and universal and an easy-to-use way to do most things."*
 *
 * What a happy path would not see:
 *
 *  - **Archive is absent while the state is unknown** (GPT Sol's F6). Either
 *    label could be false then, and pressing the wrong one does the opposite of
 *    its name.
 *  - **A press while the controller is busy sends nothing**, so a masthead
 *    press already out and a bar press cannot become two PATCHes.
 *  - **A failure keeps the bar open with a sentence** — the archive's, or the
 *    export's — rather than closing over a press that did nothing.
 *  - **Neither is offered without a shelf row to act on** — the fixture, or a
 *    Dock nobody handed one — because the request could only 404.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveControl } from "../src/web/useArchive.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  googleSignInAvailable: false,
}));

const { Dock } = await import("../src/web/Dock.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

const SLUG = "a-piece";

let requests: string[];
/** The export route's answer — a zip, or a refusal a test swaps in. */
let exportAnswer: () => Response;
let host: HTMLDivElement;
let root: Root;
let clicked: HTMLAnchorElement[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}?at=spya-k3m9qt`);
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  requests = [];
  clicked = [];
  exportAnswer = () =>
    new Response(new Blob(["zip"]), { status: 200, headers: { "content-type": "application/zip" } });
  jobEngine.reset();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url.startsWith("/api/export/")) return Promise.resolve(exportAnswer());
    if (url === "/api/jobs") return Promise.resolve(json({ jobs: [] }));
    return Promise.resolve(json({}));
  });
  /* jsdom has neither, and a real click on a `blob:` href is a navigation it
     does not implement. tests/metadata-export-button.test.tsx does the same. */
  URL.createObjectURL = vi.fn(() => "blob:zip");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A controller the test drives, in the shape `useArchive` hands out. */
function archiveControl(over: Partial<ArchiveControl> = {}): ArchiveControl & { set: ReturnType<typeof vi.fn> } {
  return {
    at: null,
    lost: false,
    busy: false,
    error: null,
    set: vi.fn(async () => ({ kind: "done" }) as const),
    ...over,
  } as ArchiveControl & { set: ReturnType<typeof vi.fn> };
}

function reading(shelfRow?: { archive: ArchiveControl }): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as tests/command-bar.test.tsx § reading
      createElement(Dock as any, {
        slug: SLUG,
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_OFF,
        shelfRow,
      }),
    );
  });
}

function metadataPage(shelfRow?: { archive: ArchiveControl }): void {
  history.replaceState(null, "", `/read/${SLUG}/metadata?at=spya-k3m9qt`);
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the metadata page's Dock has no onMode, on purpose
      createElement(Dock as any, { slug: SLUG, view: "metadata", experimental: EXPERIMENTAL_OFF, shelfRow }),
    );
  });
}

const dialog = (): HTMLDialogElement => host.querySelector("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;
const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
const listed = (): string[] => rows().map((r) => r.querySelector(".cmdbar-name")?.textContent ?? "");
const status = (): string => dialog().querySelector('[role="status"]')?.textContent ?? "";

function openBar(): void {
  act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
}

function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

const NEW_ROWS = [
  "High-powered AI",
  "AI processing",
  "Access & sharing",
  "Archive this article",
  "Put this article back",
  "Export this article",
];

describe("the list the bar opens on", () => {
  it("does not grow by any of them", () => {
    reading({ archive: archiveControl() });
    openBar();
    for (const name of NEW_ROWS) expect(listed(), name).not.toContain(name);
  });
});

describe("a section row", () => {
  it("from the reading view, goes to that section of Metadata and carries the reader's place", () => {
    reading();
    const depth = history.length;
    openBar();
    type("opus");
    expect(listed()[0]).toBe("High-powered AI");
    expect(rows()[0]?.querySelector(".cmdbar-generates")).toBeNull();
    press("Enter");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(location.search).toBe("?at=spya-k3m9qt&section=ai-processing");
    /* Pushed, so Back returns to the paragraph — the Metadata row's own rule. */
    expect(history.length).toBe(depth + 1);
    expect(dialog().open).toBe(false);
    expect(requests.filter((r) => !r.startsWith("GET /api/jobs"))).toEqual([]);
  });

  it("names Access & sharing for `share`, the sharing card's own section", () => {
    reading();
    openBar();
    type("publish");
    expect(listed()[0]).toBe("Access & sharing");
    press("Enter");
    expect(location.search).toBe("?at=spya-k3m9qt&section=access-sharing");
  });

  it("on the Metadata page, adds the section to this address in place", () => {
    metadataPage();
    const depth = history.length;
    openBar();
    type("ai processing");
    press("Enter");
    expect(location.pathname).toBe(`/read/${SLUG}/metadata`);
    expect(location.search).toBe("?at=spya-k3m9qt&section=ai-processing");
    expect(history.length, "the page did not change, so nothing for Back to retrace").toBe(depth);
  });
});

describe("Archive", () => {
  it("is absent while nobody knows whether the article is archived", () => {
    reading({ archive: archiveControl({ at: undefined }) });
    openBar();
    type("archive");
    expect(listed()).not.toContain("Archive this article");
    expect(listed()).not.toContain("Put this article back");
  });

  it("is absent without a shelf row to act on", () => {
    reading();
    openBar();
    type("archive");
    expect(listed()).not.toContain("Archive this article");
    type("export");
    expect(listed()).not.toContain("Export this article");
  });

  it("archives a live article through the controller, once, and closes", async () => {
    const archive = archiveControl({ at: null });
    reading({ archive });
    openBar();
    type("archive");
    expect(listed()[0]).toBe("Archive this article");
    press("Enter");
    press("Enter");
    await settle();
    expect(archive.set).toHaveBeenCalledTimes(1);
    expect(archive.set).toHaveBeenCalledWith(true);
    expect(dialog().open).toBe(false);
    /* Nothing navigates: an archived article is still readable here. */
    expect(location.pathname).toBe(`/read/${SLUG}`);
  });

  it("uses the app's Put back wording over an archived article", async () => {
    const archive = archiveControl({ at: "2026-10-01T00:00:00.000Z" });
    reading({ archive });
    openBar();
    type("restore");
    expect(listed()[0]).toBe("Put this article back");
    press("Enter");
    await settle();
    expect(archive.set).toHaveBeenCalledWith(false);
    expect(dialog().open).toBe(false);
  });

  it("sends nothing while the controller is already busy, and says why", async () => {
    const archive = archiveControl({ at: null, busy: true });
    reading({ archive });
    openBar();
    type("archive");
    press("Enter");
    await settle();
    expect(archive.set).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
    expect(status()).not.toBe("");
  });

  it("stays open with the controller's sentence when the write could not be confirmed", async () => {
    const archive = archiveControl({
      at: null,
      set: vi.fn(async () => ({ kind: "failed", message: "Network down." }) as const),
    });
    reading({ archive });
    openBar();
    type("archive");
    press("Enter");
    await settle();
    expect(dialog().open).toBe(true);
    expect(status()).toContain("Network down.");
  });

  it("is offered on the Metadata page too, when the page hands one over", () => {
    metadataPage({ archive: archiveControl({ at: null }) });
    openBar();
    type("archive");
    expect(listed()[0]).toBe("Archive this article");
  });
});

describe("Export", () => {
  it("downloads the zip as a named file, and closes", async () => {
    reading({ archive: archiveControl() });
    openBar();
    type("download");
    expect(listed()[0]).toBe("Export this article");
    press("Enter");
    press("Enter");
    await settle();
    expect(requests.filter((r) => r.includes("/api/export/"))).toEqual([`GET /api/export/${SLUG}`]);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe(`${SLUG}.zip`);
    expect(dialog().open).toBe(false);
  });

  it("stays open with the server's sentence when the export is refused", async () => {
    exportAnswer = () => json({ error: "No such article." }, 404);
    reading({ archive: archiveControl() });
    openBar();
    type("export");
    press("Enter");
    await settle();
    expect(clicked).toHaveLength(0);
    expect(dialog().open).toBe(true);
    expect(status()).toContain("Couldn't build the download.");
    expect(status()).toContain("No such article.");
  });
});
