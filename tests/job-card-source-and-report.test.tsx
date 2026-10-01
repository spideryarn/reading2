// @vitest-environment jsdom
/**
 * **A past import says where it came from, when, and — if it failed — offers
 * to report itself.**
 *
 * Greg, 2026-10-01 (spya-a5gzb9): past imports on the signed-in home page
 * carried too little. Plan 261001s § Stage 1, with GPT Sol's review items 6–9.
 *
 * The source line is the reader's own input drawn back at them, so the one
 * claim here that is about safety rather than looks is that a `javascript:`
 * address is never an `href` — `isWebUrl` (src/urls.ts) decides, and this file
 * mounts the card to check the anchor is really absent rather than reading the
 * function.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";

/* The host is App.tsx's business; what is under test is what the card does
   with the opener it is or is not handed. `null` is the no-host case. */
let opener: ((request?: { id: string; kind: string; body: string }) => void) | null = null;
vi.mock("../src/web/FeedbackButton.js", () => ({
  useFeedbackOpen: () => opener,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { JobCard } = await import("../src/web/AddArticle.js");
const { importProblemReport } = await import("../src/web/import-report.js");

/** A queue that does nothing — interrupted-job-card.test.tsx gives the reason. */
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

beforeEach(() => {
  opener = null;
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

/** An hour ago, so the relative label is a relative one. */
const RECENT = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

const BASE: Job = {
  id: "spya-cardbb",
  ownerId: "00000000-0000-4000-8000-00000000c0de" as Job["ownerId"],
  slug: "a-piece",
  title: "A piece",
  status: "done",
  createdAt: RECENT,
  finishedAt: RECENT,
  steps: [{ name: "fetch", label: "Fetching the page", status: "done" }],
};

const FAILED: Job = {
  ...BASE,
  status: "error",
  error: "The page answered 403.",
  failureKind: "blocked",
  steps: [{ name: "fetch", label: "Fetching the page", status: "error", error: "The page answered 403." }],
};

function reportButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    (b.textContent ?? "").includes("Report this"),
  );
}

describe("the source line", () => {
  it("links an https address, in a new tab, without an opener", () => {
    render({ ...BASE, url: "https://arxiv.org/abs/2401.01234" });
    const link = host.querySelector<HTMLAnchorElement>('a[href="https://arxiv.org/abs/2401.01234"]');
    expect(link).not.toBeNull();
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
  });

  it("draws a javascript: address as text and never as an href", () => {
    render({ ...BASE, url: "javascript:alert(1)" });
    expect(host.textContent).toContain("javascript:alert(1)");
    expect(host.querySelector("a")).toBeNull();
  });

  it("shows an upload's filename, unlinked", () => {
    render({ ...BASE, upload: { id: "00000000-0000-4000-8000-0000000000aa", filename: "draft.pdf" } });
    expect(host.textContent).toContain("draft.pdf");
    expect(host.querySelector("a")).toBeNull();
  });

  it("shows when it was added, both exactly and how long ago", () => {
    render({ ...BASE, url: "https://arxiv.org/abs/2401.01234" });
    const times = [...host.querySelectorAll("time")];
    expect(times).toHaveLength(2);
    expect(times[0]?.getAttribute("dateTime")).toBe(RECENT);
    expect(host.textContent).toContain("3 hours ago");
  });

  it("drops the how-long-ago once it has fallen back to a date, so the date is not printed twice", () => {
    render({ ...BASE, createdAt: "2026-01-05T09:00:00.000Z", url: "https://arxiv.org/abs/2401.01234" });
    expect(host.querySelectorAll("time")).toHaveLength(1);
  });
});

describe("Report this", () => {
  it("is not offered on a job that did not fail", () => {
    opener = vi.fn();
    render({ ...BASE, status: "cancelled" });
    expect(reportButton()).toBeUndefined();
    render(BASE);
    expect(reportButton()).toBeUndefined();
  });

  it("is not offered when there is no Feedback host to open", () => {
    opener = null;
    render(FAILED);
    expect(reportButton()).toBeUndefined();
  });

  it("opens the dialog as a Problem, filled with the ids-only report", () => {
    const calls: unknown[] = [];
    opener = (request) => calls.push(request);
    render({ ...FAILED, url: "https://example.com/?token=secret" });
    const button = reportButton();
    expect(button).toBeDefined();
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(calls).toHaveLength(1);
    const request = calls[0] as { id: string; kind: string; body: string };
    expect(request.kind).toBe("problem");
    expect(request.body).toBe(importProblemReport({ ...FAILED, url: "https://example.com/?token=secret" }));
    expect(typeof request.id).toBe("string");
    expect(request.id.length).toBeGreaterThan(0);
  });
});
