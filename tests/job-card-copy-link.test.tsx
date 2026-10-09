// @vitest-environment jsdom
/**
 * **A job card hands out the address its import's article will have** —
 * `JobCard` in src/web/AddArticle.tsx;
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md § 1.
 * Greg, 2026-10-05 (spya-h7skj5): *"Is there a way we could at least include a
 * permalink icon for what the link will be eventually?"*
 *
 * What is pinned: an import job has the button, while queued, running or
 * done, and it copies `<origin>/read/<slug>`; a mode job does not have it,
 * even carrying a `url` (GPT Sol's plan review, P2-3); a failed or cancelled
 * job does not; the slug is read on every render; and a refused copy says so
 * in words, with the address.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";

vi.mock("../src/web/FeedbackButton.js", () => ({ useFeedbackOpen: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { JobCard } = await import("../src/web/AddArticle.js");
const { IMPORT_LINK_COPY_FAILED, IMPORT_LINK_COPY_TIP } = await import("../src/messages.js");

const queue: UseJobs = {
  jobs: [],
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => null,
  addUpload: async () => null,
  run: async () => null,
  reset: async () => null,
  cancel: async () => undefined,
  retry: async () => null,
  forget: async () => undefined,
};

let host: HTMLDivElement;
let root: Root;
let written: string[] = [];
let refuse = false;

beforeEach(() => {
  written = [];
  refuse = false;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        if (refuse) return Promise.reject(new Error("NotAllowedError"));
        written.push(text);
        return Promise.resolve();
      },
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(job: Job): void {
  act(() => {
    root.render(<JobCard job={job} queue={queue} onHide={() => undefined} />);
  });
}

const NOW = new Date().toISOString();
const steps = (...names: string[]): Job["steps"] =>
  names.map((name) => ({ name, label: name, status: "pending" })) as Job["steps"];

const IMPORT: Job = {
  id: "spya-copyaa",
  ownerId: "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"],
  slug: "a-piece",
  url: "https://example.com/a-piece",
  status: "running",
  createdAt: NOW,
  steps: steps("fetch", "extract", "blocks", "structure"),
};

const copyButton = (): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>("button[data-copy-import-link]");

async function press(): Promise<void> {
  await act(async () => {
    copyButton()?.click();
  });
}

describe("the copy-the-link button on a job card", () => {
  it("describes this import's link without promising it survives failure or Retry", () => {
    expect(IMPORT_LINK_COPY_TIP).toContain("Copy the address this import's article will have");
    expect(IMPORT_LINK_COPY_TIP).toContain("If the import fails, the address leads nowhere");
    expect(IMPORT_LINK_COPY_TIP).not.toContain("for good");
    /* Not *if you share it*: a private link is another address, and a reader
       who took this one for it sent colleagues a link that opened for nobody
       (plan 261009i, from GPT Sol's critique). */
    expect(IMPORT_LINK_COPY_TIP).toContain("only if you make the article public");
    expect(IMPORT_LINK_COPY_TIP).toContain("a private link is a different address");
  });

  it("also copies a minimal paper's import link", async () => {
    render({ ...IMPORT, steps: steps("fetch", "metadata") });
    await press();
    expect(written).toEqual([`${location.origin}/read/a-piece`]);
  });

  it.each(["queued", "running", "done"] as const)("is on an import job that is %s", (status) => {
    render({ ...IMPORT, status, ...(status === "done" ? { finishedAt: NOW } : {}) });
    expect(copyButton()).not.toBeNull();
  });

  it("copies the address the article will have, and says Copied in words", async () => {
    render(IMPORT);
    expect(copyButton()?.getAttribute("aria-label")).toBe("Copy the link this article will have");
    expect(copyButton()?.querySelector(".lucide-copy")).not.toBeNull();
    await press();
    expect(written).toEqual([`${location.origin}/read/a-piece`]);
    expect(copyButton()?.textContent).toContain("Copied");
  });

  it("is on an upload's import, which has no url", async () => {
    const { url: _url, ...rest } = IMPORT;
    render({ ...rest, upload: { id: "up-1", filename: "paper.pdf" } } as Job);
    await press();
    expect(written).toEqual([`${location.origin}/read/a-piece`]);
  });

  it("is not on a mode job, though it carries the article's url", () => {
    render({ ...IMPORT, steps: steps("glossary") });
    expect(copyButton()).toBeNull();
  });

  it.each(["error", "cancelled"] as const)("is not on an import that is %s", (status) => {
    render({ ...IMPORT, status, finishedAt: NOW });
    expect(copyButton()).toBeNull();
  });

  it("copies the slug the job has now, after a Retry came back under another", async () => {
    render(IMPORT);
    render({ ...IMPORT, slug: "the-article-already-on-the-shelf" });
    await press();
    expect(written).toEqual([`${location.origin}/read/the-article-already-on-the-shelf`]);
  });

  it("says a refused copy in words, with the address to copy by hand", async () => {
    refuse = true;
    render(IMPORT);
    await press();
    expect(written).toEqual([]);
    expect(host.textContent).toContain(IMPORT_LINK_COPY_FAILED);
    expect(host.textContent).toContain(`${location.origin}/read/a-piece`);
    expect(copyButton()?.textContent).not.toContain("Copied");
  });
});
