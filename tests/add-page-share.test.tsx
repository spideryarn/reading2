// @vitest-environment jsdom
/**
 * ***Make it public* on the add page** — src/web/AddShare.tsx over
 * src/web/add-share.ts, wired into src/web/AddPage.tsx;
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md § 3.
 *
 * The intent is driven without React in tests/add-share.test.ts. What only the
 * page can get wrong is pinned here:
 *
 *  - **no request goes out without the rights tick and the press**, through
 *    the real component and the real `apiFetch` call site;
 *  - **the box is offered only over an article nothing is published at**: the
 *    probe's three answers, and a copy from the offline cache is not one;
 *  - **the page does not leave by itself while sharing is unsettled** (GPT
 *    Sol's plan review, P2-5), and does when it is settled or untouched;
 *  - **one share per slug** (P1): a Retry that comes back under another slug
 *    takes back what was shared under the old one and starts from nothing.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
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

let jobs: Job[] = [];
let addResult: Job | null = null;
let retryResult: (() => Job | null) | null = null;
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
  retry: async () => retryResult?.() ?? null,
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => null }));
vi.mock("../src/web/uploadEngine.js", () => ({ uploadEngine: { retry: () => {}, cancel: () => {} } }));

const navigations: string[] = [];
vi.mock("../src/web/router.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/web/router.js")>()),
  navigate: (href: string) => {
    navigations.push(href);
  },
}));

const json = (body: unknown, init: ResponseInit = { status: 200 }) =>
  new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } });

const AT = "2026-10-05T12:00:00.000Z";
/** Every `PUT …/visibility`: `<slug>:<body>`. */
const puts: string[] = [];
/** Every probe: the slug asked about. */
const probes: string[] = [];
/** How the probe answers. Replaced per test; the default is *nothing published here*. */
let probeAnswer: (slug: string) => Promise<Response> = async () => json({ error: "No article" }, { status: 404 });
/** How the `PUT` answers. Replaced per test; the default does what it was asked. */
let putAnswer: (slug: string, body: { visibility: string }) => Promise<Response>;
const did = async (_slug: string, body: { visibility: string }) =>
  json(body.visibility === "public" ? { visibility: "public", publicAt: AT } : { visibility: "private", publicAt: null });

vi.mock("../src/web/lib/api.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/lib/api.js")>();
  return {
    ...actual,
    apiFetch: async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (input === "/api/reader") return json({ autoModes: true });
      if (input.startsWith("/api/reader?slug=")) return json({ autoModes: true, purpose: null, purposeFailed: false });
      if (method === "GET" && input.startsWith("/api/metadata/")) {
        const slug = decodeURIComponent(input.slice("/api/metadata/".length));
        probes.push(slug);
        return probeAnswer(slug);
      }
      if (method === "PUT" && input.endsWith("/visibility")) {
        const slug = decodeURIComponent(input.split("/")[3] ?? "");
        puts.push(`${slug}:${String(init.body)}`);
        return putAnswer(slug, JSON.parse(String(init.body)) as { visibility: string });
      }
      throw new Error(`unexpected fetch ${method} ${input}`);
    },
    leavingFetch: () => Promise.resolve(),
  };
});

const { AddPage, resetAddPurposeForTests } = await import("../src/web/AddPage.js");
const { resetAutoModesSettingForTests } = await import("../src/web/auto-modes-setting.js");
const {
  SHARE_AT_ADD_ALREADY_AN_ARTICLE,
  SHARE_AT_ADD_LABEL,
  SHARE_AT_ADD_ON,
  SHARE_AT_ADD_UNKNOWN,
  SHARING_CONFIRM_TITLE,
  SHARING_RIGHTS_CONFIRM,
  UNSHARING_COSTS_ALLOWANCE,
} = await import("../src/messages.js");

const SLUG = "a-paper";
const OTHER = "the-one-already-on-the-shelf";
const URL_SOURCE = { kind: "url", url: "https://example.com/a-paper" } as const;
const PUBLIC = (slug = SLUG) => `${slug}:${JSON.stringify({ visibility: "public", rightsConfirmed: true })}`;
const PRIVATE = (slug = SLUG) => `${slug}:${JSON.stringify({ visibility: "private" })}`;
const OPEN = "Open the article";

const makeJob = (id: string, status: Job["status"], slug = SLUG): Job =>
  ({ id, slug, status, steps: [] }) as unknown as Job;

let host: HTMLDivElement;
let root: Root;
let strict = false;

function render(): void {
  const page = createElement(AddPage, { source: URL_SOURCE });
  act(() => {
    root.render(strict ? createElement(StrictMode, null, page) : page);
  });
}

/** Let requests answer and effects run, without moving the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** The page mid-import, the job running and the probe answered. */
async function importing(): Promise<void> {
  addResult = makeJob("job-1", "running");
  jobs = [addResult];
  render();
  await settle();
}

async function finish(id = "job-1", slug = SLUG): Promise<void> {
  jobs = jobs.map((j) => (j.id === id ? makeJob(id, "done", slug) : j));
  render();
  await settle();
}

const shareBox = (): HTMLInputElement | null =>
  host.querySelector<HTMLInputElement>("[data-add-share] > label input[type=checkbox]");
const rightsBox = (): HTMLInputElement | undefined =>
  [...host.querySelectorAll("label")].find((l) => l.textContent?.includes(SHARING_RIGHTS_CONFIRM))?.querySelector("input") ??
  undefined;
const button = (name: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const click = (el: HTMLElement | null | undefined, what: string): void => {
  if (!el) throw new Error(`no ${what}`);
  act(() => el.click());
};
const text = () => host.textContent ?? "";

/** Tick the box, tick the rights, press *Share it*. */
async function share(): Promise<void> {
  click(shareBox(), "share box");
  click(rightsBox(), "rights box");
  click(button("Share it"), "Share it button");
  await settle();
}

/** A response a test answers when it chooses. */
function heldResponse() {
  let answer: (r: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  return { promise, answer: (r: Response) => answer(r) };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAutoModesSettingForTests();
  resetAddPurposeForTests();
  jobs = [];
  addResult = null;
  retryResult = null;
  strict = false;
  navigations.length = 0;
  puts.length = 0;
  probes.length = 0;
  probeAnswer = async () => json({ error: "No article" }, { status: 404 });
  putAnswer = did;
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

describe("the adopted-article probe", () => {
  it("offers the box, unticked, when nothing is published at the slug", async () => {
    await importing();
    expect(probes).toEqual([SLUG]);
    expect(text()).toContain(SHARE_AT_ADD_LABEL);
    expect(shareBox()?.checked).toBe(false);
    expect(puts).toEqual([]);
  });

  it("asks once under StrictMode's double mount", async () => {
    strict = true;
    await importing();
    expect(probes).toEqual([SLUG]);
    expect(shareBox()).not.toBeNull();
  });

  it("offers no box over an article already on the shelf, and says where to share it", async () => {
    probeAnswer = async () => json({ stages: [] });
    await importing();
    expect(shareBox()).toBeNull();
    expect(text()).toContain(SHARE_AT_ADD_ALREADY_AN_ARTICLE);
  });

  it.each([
    ["a server error", async () => json({ error: "boom" }, { status: 500 })],
    ["a copy from the offline cache", async () => json({ stages: [] }, { status: 200, headers: { "x-spideryarn-offline": "copy" } })],
    ["a success that is not a 200", async () => new Response(null, { status: 204 })],
    ["no answer", async () => Promise.reject(new TypeError("Failed to fetch"))],
  ] as const)("offers no box and no line after %s", async (_name, answer) => {
    probeAnswer = answer as () => Promise<Response>;
    await importing();
    expect(shareBox()).toBeNull();
    expect(text()).not.toContain(SHARE_AT_ADD_LABEL);
    expect(text()).not.toContain(SHARE_AT_ADD_ALREADY_AN_ARTICLE);
  });
});

describe("no request without the rights tick and the press", () => {
  it("ticking the box opens the confirmation and sends nothing", async () => {
    await importing();
    click(shareBox(), "share box");
    await settle();
    expect(text()).toContain(SHARING_CONFIRM_TITLE);
    expect(text(), "the inventory was not drawn").toContain("Glossary");
    expect(text(), "money inside the confirmation").not.toContain(UNSHARING_COSTS_ALLOWANCE);
    expect(button("Share it")?.disabled).toBe(true);
    expect(puts).toEqual([]);
  });

  it("the press does nothing until the rights box is ticked", async () => {
    await importing();
    click(shareBox(), "share box");
    click(button("Share it"), "Share it button");
    await settle();
    expect(puts).toEqual([]);
  });

  it("ticking the rights box alone sends nothing", async () => {
    await importing();
    click(shareBox(), "share box");
    click(rightsBox(), "rights box");
    await settle();
    expect(button("Share it")?.disabled).toBe(false);
    expect(puts).toEqual([]);
  });

  it("with both, sends one publish carrying rightsConfirmed, and shows the public state", async () => {
    await importing();
    await share();
    expect(puts).toEqual([PUBLIC()]);
    expect(text()).toContain(SHARE_AT_ADD_ON);
    expect(text()).toContain(UNSHARING_COSTS_ALLOWANCE);
    expect(host.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(`${location.origin}/read/${SLUG}`);
    expect(text()).not.toContain(SHARING_CONFIRM_TITLE);
  });

  it("Cancel closes the confirmation, unticks the box and sends nothing", async () => {
    await importing();
    click(shareBox(), "share box");
    click(rightsBox(), "rights box");
    click(button("Cancel"), "Cancel button");
    await settle();
    expect(shareBox()?.checked).toBe(false);
    expect(text()).not.toContain(SHARING_CONFIRM_TITLE);
    expect(puts).toEqual([]);
  });

  it("unticking while public sends private, with no confirmation", async () => {
    await importing();
    await share();
    click(shareBox(), "share box");
    await settle();
    expect(puts).toEqual([PUBLIC(), PRIVATE()]);
    expect(shareBox()?.checked).toBe(false);
  });
});

describe("the page does not leave by itself while sharing is unsettled", () => {
  it("opens the article by itself over a box never touched", async () => {
    await importing();
    await finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(puts).toEqual([]);
  });

  it("opens the article by itself once the share is on", async () => {
    await importing();
    await share();
    await finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(puts, "leaving took the share back").toEqual([PUBLIC()]);
  });

  it("waits while the confirmation is open, and opens on the button", async () => {
    await importing();
    click(shareBox(), "share box");
    await finish();
    expect(navigations, "the page left from under the confirmation").toEqual([]);
    expect(text()).toContain(SHARING_CONFIRM_TITLE);
    expect(button(OPEN)).toBeTruthy();

    /* The reader can still finish what they were doing. */
    click(rightsBox(), "rights box");
    click(button("Share it"), "Share it button");
    await settle();
    expect(puts).toEqual([PUBLIC()]);
    expect(navigations, "it stays until the reader has read the answer").toEqual([]);

    click(button(OPEN), "Open the article button");
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("waits over a refusal, which stays on the page", async () => {
    putAnswer = async () => json({ error: "A paper that has not been read cannot be shared." }, { status: 409 });
    await importing();
    await share();
    await finish();
    expect(navigations).toEqual([]);
    expect(text()).toContain("A paper that has not been read cannot be shared.");
    expect(button(OPEN)).toBeTruthy();
  });

  it("waits over an answer that never came", async () => {
    putAnswer = async () => Promise.reject(new TypeError("Failed to fetch"));
    await importing();
    await share();
    await finish();
    expect(navigations).toEqual([]);
    expect(text()).toContain(SHARE_AT_ADD_UNKNOWN);
  });

  it("sends a share still waiting for the row when the import completes, and waits for its answer", async () => {
    /* The row is not there until the import is done. */
    let rowExists = false;
    putAnswer = async (slug, body) =>
      rowExists ? did(slug, body) : json({ error: "No article" }, { status: 404 });
    await importing();
    await share();
    expect(puts.length).toBeGreaterThan(0);
    const before = puts.length;
    rowExists = true;
    await finish();
    expect(puts.length, "completion did not send the waiting share").toBe(before + 1);
    expect(text()).toContain(SHARE_AT_ADD_ON);
    expect(navigations, "it left before the reader could read the answer").toEqual([]);
    expect(button(OPEN)).toBeTruthy();
  });
});

describe("one share per slug", () => {
  /** The import fails, and Retry comes back as a job under another slug. */
  async function retryOntoAnotherSlug(): Promise<void> {
    jobs = [makeJob("job-1", "error")];
    render();
    await settle();
    retryResult = () => {
      const replacement = makeJob("job-2", "running", OTHER);
      jobs = [makeJob("job-1", "error"), replacement];
      return replacement;
    };
    click(
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry")),
      "Retry button",
    );
    await settle();
  }

  it("after a share succeeded: the old slug is made private, and the new one starts from nothing", async () => {
    await importing();
    await share();
    expect(puts).toEqual([PUBLIC()]);

    await retryOntoAnotherSlug();
    expect(puts, "the old slug was left public behind a box that reads off").toEqual([PUBLIC(), PRIVATE()]);
    expect(probes, "the new slug was not asked about").toEqual([SLUG, OTHER]);
    expect(shareBox()?.checked, "the old share was carried to the new slug").toBe(false);
    expect(text()).not.toContain(SHARE_AT_ADD_ON);
    expect(puts.some((p) => p.startsWith(`${OTHER}:`)), "something was sent about the new slug").toBe(false);
  });

  it("the new slug needs its own confirmation, rights tick included", async () => {
    await importing();
    await share();
    await retryOntoAnotherSlug();
    click(shareBox(), "share box");
    expect(rightsBox()?.checked).toBe(false);
    expect(button("Share it")?.disabled).toBe(true);
    expect(puts.some((p) => p.startsWith(`${OTHER}:`))).toBe(false);
  });

  it("during an unanswered request: its answer changes nothing on the page, and is taken back", async () => {
    const first = heldResponse();
    putAnswer = async (slug, body) => (body.visibility === "public" ? first.promise : did(slug, body));
    await importing();
    await share();
    expect(puts).toEqual([PUBLIC()]);

    await retryOntoAnotherSlug();
    expect(puts, "nothing to take back until the request answers").toEqual([PUBLIC()]);
    first.answer(json({ visibility: "public", publicAt: AT }));
    await settle();
    expect(puts).toEqual([PUBLIC(), PRIVATE()]);
    expect(shareBox()?.checked).toBe(false);
    expect(text()).not.toContain(SHARE_AT_ADD_ON);
  });

  it("an adopted article after the Retry gets the line, not the box", async () => {
    probeAnswer = async (slug) => (slug === OTHER ? json({ stages: [] }) : json({ error: "No article" }, { status: 404 }));
    await importing();
    await retryOntoAnotherSlug();
    expect(shareBox()).toBeNull();
    expect(text()).toContain(SHARE_AT_ADD_ALREADY_AN_ARTICLE);
  });
});
