// @vitest-environment jsdom
/**
 * **A paper not read through yet, in the browser** — plan 261001m stage 4.
 *
 * - the shelf card shows the marker, the authors, the abstract behind a
 *   disclosure and *Read this*, and no word count and no Rebuild;
 * - *Read this* posts `{ slug, process: true }` and never fires by itself;
 * - the reading address turns the owned route's `409 not-processed` into the
 *   paper's own page, with its DOI linked only when it is a DOI, and a
 *   different 409 is still an error;
 * - the batch panel says each file's state, links what landed, offers Retry,
 *   and says the tab must stay open;
 * - the add box hands two or more files to the batch and one to the single
 *   upload, as before.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry, UnreadPaper } from "../src/types.js";
import { ReaderFacingError } from "../src/web/lib/reader-facing.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every request the page made, and what the next one answers. */
const calls: { url: string; body: unknown }[] = [];
let answer: () => Response = () => new Response("{}", { status: 200 });

/* The real module drags the Supabase client in behind it; this is the slice
   the code under test reaches, with the real module's error shape — a
   reader-facing error carrying `status` and `details`. */
vi.mock("../src/web/lib/api.js", () => {
  const readJson = async (res: Response) => {
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const { error, ...details } = (body ?? {}) as Record<string, unknown>;
      throw Object.assign(new ReaderFacingError(String(error)), { status: res.status, details });
    }
    return body;
  };
  return {
    apiFetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return answer();
    },
    fetchOk: async () => new Response(null, { status: 200 }),
    readJson,
    statusOf: (err: { status?: unknown } | null) =>
      typeof err?.status === "number" ? err.status : null,
    detailsOf: (err: { details?: unknown } | null) =>
      (err?.details as Record<string, unknown> | undefined) ?? {},
  };
});

const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
  },
});

const { ShelfCard } = await import("../src/web/ShelfEntry.js");
const { ReadThisButton } = await import("../src/web/ReadThis.js");
const { UnreadPaperPage, doiHref } = await import("../src/web/article/UnreadPaperPage.js");
const { resolveAccess } = await import("../src/web/article/access.js");
const { BatchPanel, batchSummary } = await import("../src/web/BatchPanel.js");
const { batchUpload } = await import("../src/web/batchUpload.js");
const { UploadPicker } = await import("../src/web/UploadPicker.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const { CLIENT_MINIMAL_STEPS, isMinimalJob: clientIsMinimalJob } = await import(
  "../src/web/read-this.js"
);
const { writeAutoModes } = await import("../src/web/auto-modes.js");
const { MINIMAL_STEPS, isMinimalJob: serverIsMinimalJob } = await import(
  "../src/minimal-paper.js"
);

const MINIMAL: LibraryEntry = {
  slug: "a-paper",
  title: "On the Reading of Papers",
  byline: "Ada Lovelace, Charles Babbage",
  addedAt: "2026-10-01T10:00:00.000Z",
  words: 0,
  minutes: 0,
  blocks: 0,
  parts: 0,
  sections: 0,
  comments: 0,
  opens: 0,
  sourceReusable: true,
  has: { arc: false, tweets: false, glossary: false },
  processing: "minimal",
  abstract: "We read papers, and say how.",
  doi: "10.1234/abcd.5678",
};

const shelf = {
  renaming: null,
  report: () => {},
  archive: () => Promise.resolve(),
  restore: () => Promise.resolve(),
  beginRename: () => {},
  cancelRename: () => {},
  rename: () => Promise.resolve(),
} as unknown as Parameters<typeof ShelfCard>[0]["shelf"];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  calls.length = 0;
  stored.clear();
  answer = () => new Response("{}", { status: 200 });
  jobEngine.reset();
  batchUpload.reset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (el: React.ReactElement) => act(() => root.render(el));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const buttonNamed = (name: RegExp) =>
  [...container.querySelectorAll("button")].find((b) =>
    name.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
  );

/** The card as Library.tsx draws it, with *Read this* in its slot for a minimal paper. */
const card = (entry: LibraryEntry) =>
  createElement(ShelfCard, {
    entry,
    shelf,
    note: "added 1 Oct",
    readThis:
      entry.processing === "minimal" ? createElement(ReadThisButton, { slug: entry.slug }) : undefined,
  });

describe("the shelf card of a paper not read through yet", () => {
  it("uses the server's exact minimal-job step contract", () => {
    expect(CLIENT_MINIMAL_STEPS).toEqual(MINIMAL_STEPS);
    for (const steps of [
      ["fetch", "metadata"],
      ["metadata"],
      ["metadata", "fetch"],
      ["fetch", "metadata", "metadata"],
    ] as const) {
      const browser = clientIsMinimalJob({
        steps: steps.map((name) => ({ name })),
      } as never);
      expect(browser, steps.join(",")).toBe(serverIsMinimalJob(steps));
    }
  });

  it("says so, shows the authors and the abstract, and offers Read this — not Rebuild, not words", () => {
    render(card(MINIMAL));
    expect(container.querySelector("[data-not-processed-mark]")?.textContent).toContain(
      "Not AI-processed yet",
    );
    expect(container.textContent).toContain("Ada Lovelace, Charles Babbage");
    const details = container.querySelector("details");
    expect(details?.textContent).toContain("We read papers, and say how.");
    expect(details?.open, "the abstract is open by default").toBe(false);
    expect(buttonNamed(/^Read this$/)).toBeDefined();
    expect(container.textContent).toContain("0.99 of an article");
    expect(container.textContent).not.toContain("words");
    expect(container.textContent).not.toContain("blocks");
    expect(buttonNamed(/Rebuild|Re-fetch/i), "Rebuild offered on a paper with nothing built").toBe(
      undefined,
    );
    expect(calls, "drawing the card asked for something").toEqual([]);
  });

  it("keeps Rebuild on an ordinary article", () => {
    const full: LibraryEntry = { ...MINIMAL, processing: "full", words: 2400, blocks: 60, url: "https://example.com/a" };
    render(card(full));
    expect(buttonNamed(/Re-fetch|Rebuild/i)).toBeDefined();
    expect(container.querySelector("[data-not-processed-mark]")).toBeNull();
  });

  it("Read this posts { slug, process: true }, once, and shows it running", async () => {
    answer = () =>
      new Response(
        JSON.stringify({
          id: "j1",
          slug: "a-paper",
          status: "queued",
          steps: [{ name: "extract", label: "Reading the text", status: "pending" }],
        }),
        { status: 202 },
      );
    render(card(MINIMAL));
    await act(async () => buttonNamed(/^Read this$/)?.click());
    await settle();
    expect(calls).toEqual([{ url: "/api/jobs", body: { slug: "a-paper", process: true } }]);
    expect(container.querySelector("[role=status]")?.textContent).toContain("Reading it through");
    expect(buttonNamed(/^Read this$/), "Read this still pressable while it runs").toBeUndefined();

    await act(async () => jobEngine.receive([]));
    expect(buttonNamed(/^Read this$/), "a vanished job left the button spinning").toBeDefined();
    expect(container.textContent).toContain("lost sight of this import");
  });

  it("queues the main modes only after Read this finishes, and honours an unticked box", async () => {
    const queued = {
      id: "j-read",
      slug: "a-paper",
      status: "queued",
      steps: [{ name: "extract", label: "Reading the text", status: "pending" }],
    };
    answer = () => new Response(JSON.stringify(queued), { status: 202 });
    render(card(MINIMAL));
    await act(async () => buttonNamed(/^Read this$/)?.click());
    expect(calls).toHaveLength(1);

    await act(async () => jobEngine.receive([{ ...queued, status: "done" } as never]));
    await settle();
    expect(calls.slice(1).length, "the modes were not queued after Read this").toBeGreaterThan(0);
    expect(calls.slice(1).every((call) => Array.isArray((call.body as { steps?: unknown }).steps))).toBe(
      true,
    );

    act(() => root.unmount());
    root = createRoot(container);
    calls.length = 0;
    jobEngine.reset();
    writeAutoModes(false);
    render(card(MINIMAL));
    await act(async () => buttonNamed(/^Read this$/)?.click());
    await act(async () => jobEngine.receive([{ ...queued, status: "done" } as never]));
    await settle();
    expect(calls).toEqual([{ url: "/api/jobs", body: { slug: "a-paper", process: true } }]);
  });

  it("says the server's refusal beside the button", async () => {
    answer = () =>
      new Response(
        JSON.stringify({ error: "This paper is already being read through. [pay-reading]" }),
        { status: 409 },
      );
    render(card(MINIMAL));
    await act(async () => buttonNamed(/^Read this$/)?.click());
    await settle();
    expect(container.textContent).toContain("[pay-reading]");
  });
});

const PAPER: UnreadPaper = {
  slug: "a-paper",
  title: "On the Reading of Papers",
  authors: ["Ada Lovelace", "Charles Babbage", "Mary Somerville"],
  abstract: "We read papers, and say how.",
  doi: "10.1234/abcd.5678",
  filename: "reading.pdf",
  kind: "pdf",
  addedAt: "2026-10-01T10:00:00.000Z",
};

describe("the reading address of a paper not read through yet", () => {
  const load = () =>
    ({ signal: new AbortController().signal, release: () => {} }) as unknown as Parameters<
      typeof resolveAccess
    >[2];

  it("turns the owned route's 409 not-processed into the paper's page", async () => {
    answer = () =>
      new Response(
        JSON.stringify({ error: "Not read through yet. [np-read]", code: "not-processed", paper: PAPER }),
        { status: 409 },
      );
    const { access } = await resolveAccess("a-paper", true, load());
    expect(access).toEqual({ kind: "unread", paper: PAPER });
  });

  it("leaves any other 409 an error, with its own sentence", async () => {
    answer = () => new Response(JSON.stringify({ error: "Something else. [x-y]" }), { status: 409 });
    await expect(resolveAccess("a-paper", true, load())).rejects.toThrow("Something else. [x-y]");
  });

  it("does not accept another article's paper body on this owned route", async () => {
    answer = () =>
      new Response(
        JSON.stringify({
          error: "Not read through yet. [np-read]",
          code: "not-processed",
          paper: { ...PAPER, slug: "some-other-paper" },
        }),
        { status: 409 },
      );
    await expect(resolveAccess("a-paper", true, load())).rejects.toThrow("Not read through yet");
  });

  it("draws the title, the authors, the abstract, the DOI and the PDF, and does not start the import", () => {
    render(createElement(UnreadPaperPage, { paper: PAPER, onRead: () => {} }));
    expect(container.querySelector("h1")?.textContent).toBe(PAPER.title);
    expect(container.textContent).toContain("Ada Lovelace, Charles Babbage and Mary Somerville");
    expect(container.textContent).toContain("We read papers, and say how.");
    expect(container.textContent).toContain("Not AI-processed yet");
    const doi = container.querySelector<HTMLAnchorElement>("a[href^='https://doi.org/']");
    expect(doi?.href).toBe("https://doi.org/10.1234/abcd.5678");
    expect(buttonNamed(/Open the PDF/)).toBeDefined();
    expect(buttonNamed(/^Read this$/)).toBeDefined();
    expect(container.textContent).toContain("Uses 0.99 of an article from your allowance.");
    expect(calls, "opening the paper started something").toEqual([]);
  });

  it("links a DOI only when it is one, and offers no file for a web page", () => {
    expect(doiHref("not a doi")).toBeNull();
    expect(doiHref("javascript:alert(1)")).toBeNull();
    expect(doiHref("10.1234/a?redirect=elsewhere")).toBeNull();
    expect(doiHref(`10.1234/${"a".repeat(400)}`)).toBeNull();
    expect(doiHref(undefined)).toBeNull();
    render(
      createElement(UnreadPaperPage, {
        paper: { ...PAPER, doi: "javascript:alert(1)", kind: "html", filename: "page.html" },
        onRead: () => {},
      }),
    );
    expect(container.querySelector("a[href^='javascript']")).toBeNull();
    expect(container.querySelector("a[href^='https://doi.org/']")).toBeNull();
    expect(buttonNamed(/Open the PDF/)).toBeUndefined();
  });

  it("loads the article when the Read this job is done", async () => {
    const onRead = vi.fn();
    render(createElement(UnreadPaperPage, { paper: PAPER, onRead }));
    const steps = [{ name: "extract", label: "Reading the text", status: "running" }];
    await act(async () => {
      jobEngine.receive([{ id: "j1", slug: "a-paper", status: "running", steps } as never]);
    });
    expect(container.textContent).toContain("Reading the text");
    await act(async () => {
      jobEngine.receive([{ id: "j1", slug: "a-paper", status: "done", steps } as never]);
    });
    expect(onRead).toHaveBeenCalledTimes(1);
  });
});

describe("the batch panel", () => {
  const rows = [
    { id: 1, filename: "a.pdf", bytes: 10, state: { kind: "shelved", slug: "a-paper" } },
    { id: 2, filename: "b.pdf", bytes: 10, state: { kind: "reading", jobId: "j2" } },
    {
      id: 3,
      filename: "c.pdf",
      bytes: 10,
      state: { kind: "failed", message: "The AI service is busy. [ai-busy]", retry: { from: "job", jobId: "j3" } },
    },
    {
      id: 4,
      filename: "d.pdf",
      bytes: 10,
      state: {
        kind: "duplicate",
        slug: "old",
        message: "That file is already on your shelf, in your archived articles … [up-dup-archived]",
      },
    },
    { id: 5, filename: "e.pdf", bytes: 10, state: { kind: "no-room", message: "No room. [pay-minimal]" } },
    { id: 6, filename: "f.pdf", bytes: 10, state: { kind: "waiting" } },
  ] as const;
  const fake = (over: Partial<{ overflow: number }> = {}) => {
    const snap = { rows, overflow: over.overflow ?? 0 };
    return {
      subscribe: () => () => {},
      getSnapshot: () => snap as never,
      cancel: vi.fn(),
      retry: vi.fn(),
      dismiss: vi.fn(),
    };
  };

  it("says each file's state, links what landed, and keeps the tab-open sentence", () => {
    const source = fake();
    render(createElement(BatchPanel, { source }));
    const text = container.textContent ?? "";
    expect(text).toContain("On your shelf");
    expect(text).toContain("Reading its title and abstract");
    expect(text).toContain("Couldn't read this one");
    expect(text).toContain("[ai-busy]");
    expect(text).toContain("Already on your shelf, archived");
    expect(text).toContain("Not started: out of allowance");
    expect(text).toContain("Keep this tab open while it works");
    expect(container.querySelector("a[href='/read/a-paper']")?.textContent).toBe("a.pdf");
    expect(container.querySelector("a[href='/read/old']")?.textContent).toBe("d.pdf");
    expect(container.querySelector("a[href='/pricing']"), "no way to more room").not.toBeNull();
    buttonNamed(/^Retry$/)?.click();
    expect(source.retry).toHaveBeenCalledWith(3);
    buttonNamed(/^Stop$/)?.click();
    expect(source.cancel).toHaveBeenCalledTimes(1);
  });

  it("says when a drop was more than one batch takes", () => {
    render(createElement(BatchPanel, { source: fake({ overflow: 7 }) }));
    expect(container.textContent).toContain("the other 7 were not added");
  });

  it("counts plainly", () => {
    expect(batchSummary(rows as never)).toBe(
      "1 of 6 on your shelf · 1 already there · 2 still going · 1 couldn't be read · 1 out of allowance",
    );
  });

  it("draws nothing with no batch", () => {
    render(createElement(BatchPanel, {}));
    expect(container.innerHTML).toBe("");
  });
});

describe("the add box", () => {
  function mountPicker() {
    const slots = (s: { pdfButton: React.ReactNode; uploadStatus: React.ReactNode }) =>
      createElement("div", null, s.pdfButton, s.uploadStatus);
    render(createElement(UploadPicker, null as never, slots as never));
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) throw new Error("no file input");
    return input;
  }

  function choose(input: HTMLInputElement, files: File[]) {
    Object.defineProperty(input, "files", { configurable: true, value: files });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("takes several files, and hands two or more to the batch", () => {
    batchUpload.start("reader-1");
    const add = vi.spyOn(batchUpload, "add").mockImplementation(() => {});
    const input = mountPicker();
    expect(input.multiple).toBe(true);
    const files = [
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["<html>"], "b.html", { type: "text/html" }),
    ];
    choose(input, files);
    expect(add).toHaveBeenCalledWith(files);
    expect(container.textContent).not.toContain("One at a time");
    add.mockRestore();
  });

  it("keeps one file as today's single upload", () => {
    const add = vi.spyOn(batchUpload, "add").mockImplementation(() => {});
    const input = mountPicker();
    choose(input, [new File(["a"], "a.pdf", { type: "application/pdf" })]);
    expect(add).not.toHaveBeenCalled();
    expect(container.textContent).toContain("a.pdf");
    add.mockRestore();
  });
});
