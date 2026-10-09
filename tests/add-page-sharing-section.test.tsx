// @vitest-environment jsdom
/**
 * **The add page's Sharing section, and the card drawn from the POST's
 * answer** — src/web/AddSharing.tsx and src/web/AddShareLink.tsx over
 * src/web/add-share-link.ts, wired into src/web/AddPage.tsx;
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § Stage 2 (2a, 2b) and § What the stage 2 plan review changed (F1, F4).
 *
 * The link's controller is driven without React in
 * tests/add-share-link.test.ts, and *Make it public* through the page in
 * tests/add-page-share.test.tsx. What only the page can get wrong is here:
 *
 *  - **2a**: the card, the link button and the Sharing row come from the
 *    POST's answer, and from Retry's, before any list has the job; the list's
 *    copy wins once it is there; an upload the engine queued is the same;
 *  - **2b**: one section, closed, that opens itself when a control has
 *    something to say and names what is on when shut; nothing is created
 *    without the rights tick and the press; an answer that did not come back
 *    is never sent again by itself; the page does not leave while unsettled;
 *  - **F1**: a direct switch from reader A to reader B leaves nothing of A's
 *    on screen, and A's late answers are drawn nowhere.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { Transfer } from "../src/web/uploadEngine.js";
import type { UseJobs } from "../src/web/useJobs.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom's storages are shadowed by Node's own globals here (tests/add-page-purpose.test.tsx).
   Kept where a case can read every value back: the key of a private link goes in neither. */
const stores = { localStorage: new Map<string, string>(), sessionStorage: new Map<string, string>() };
for (const name of ["localStorage", "sessionStorage"] as const) {
  const held = stores[name];
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
/** What the add POST answers. A promise lets a case answer it late. */
let addResult: Job | null | Promise<Job | null> = null;
let adds = 0;
let retryResult: (() => Job | null) | null = null;
const queue: UseJobs = {
  get jobs() {
    return jobs;
  },
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => {
    adds += 1;
    return addResult;
  },
  addUpload: async () => null,
  run: async () => null,
  reset: async () => null,
  cancel: async () => {},
  retry: async () => retryResult?.() ?? null,
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));
/** This tab's transfer, as the upload engine's snapshot has it. */
let transfer: Transfer | null = null;
vi.mock("../src/web/useUpload.js", () => ({ useUpload: () => transfer }));
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

const AT = "2026-10-06T12:00:00.000Z";
const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const LINK_ON = { on: true, key: KEY, since: AT };
const LINK_OFF = { on: false };
const NO_ROW = () => json({ error: "No article" }, { status: 404 });

/** Every request about sharing: `<METHOD> <slug> <body>`, the probe and the reads apart. */
const writes: string[] = [];
const probes: string[] = [];
const linkReads: string[] = [];
let probeAnswer: (slug: string) => Promise<Response>;
let linkRead: (slug: string) => Promise<Response>;
let linkCreate: (slug: string) => Promise<Response>;
let linkRemove: (slug: string) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/lib/api.js")>();
  return {
    ...actual,
    apiFetch: async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      if (input === "/api/reader") return json({ autoModes: true });
      if (input.startsWith("/api/reader?slug=")) return json({ autoModes: true, purpose: null, purposeFailed: false });
      const slug = decodeURIComponent(input.split("/")[3] ?? "");
      if (method === "GET" && input.startsWith("/api/metadata/")) {
        probes.push(slug);
        return probeAnswer(slug);
      }
      if (input.endsWith("/share-link")) {
        if (method === "GET") {
          linkReads.push(slug);
          return linkRead(slug);
        }
        writes.push(`${method} ${slug} ${String(init.body ?? "")}`.trim());
        if (method === "POST") return linkCreate(slug);
        if (method === "DELETE") return linkRemove(slug);
      }
      if (method === "PUT" && input.endsWith("/visibility")) {
        const body = JSON.parse(String(init.body)) as { visibility: string };
        writes.push(`PUT ${slug} ${body.visibility}`);
        return json(
          body.visibility === "public" ? { visibility: "public", publicAt: AT } : { visibility: "private", publicAt: null },
        );
      }
      throw new Error(`unexpected fetch ${method} ${input}`);
    },
    leavingFetch: () => Promise.resolve(),
  };
});

const { AddPage, resetAddPurposeForTests } = await import("../src/web/AddPage.js");
const { resetAutoModesSettingForTests } = await import("../src/web/auto-modes-setting.js");
const { retireAddSharing } = await import("../src/web/add-sharing-session.js");
const { jobEngine } = await import("../src/web/jobEngine.js");
const {
  PRIVATE_LINK_ALSO_PUBLIC,
  PRIVATE_LINK_CONFIRM_TITLE,
  PRIVATE_LINK_OPEN_TIP,
  PRIVATE_LINK_STOP_TIP,
  SHARE_AT_ADD_ALREADY_AN_ARTICLE,
  LINK_AT_ADD_LABEL,
  SHARE_AT_ADD_LABEL,
  SHARE_AT_ADD_RECALLED,
  PUBLIC_SHELF_LABEL,
  SHARING_AT_ADD_INTRO,
  SHARING_CONFIRM_TITLE,
  SHARING_OPEN_TIP,
  SHARING_RIGHTS_CONFIRM,
  SHARING_STOP_TIP,
  LINK_AT_ADD_ON,
  LINK_AT_ADD_UNKNOWN,
  LINK_AT_ADD_UNKNOWN_STOP_TIP,
  LINK_AT_ADD_WAITING,
  sharingAtAddSummary,
} = await import("../src/messages.js");

const SLUG = "a-paper";
const OTHER = "the-one-it-became";
const URL_SOURCE = { kind: "url", url: "https://example.com/a-paper" } as const;
const CREATE = (slug = SLUG) => `POST ${slug} ${JSON.stringify({ rightsConfirmed: true })}`;
const REMOVE = (slug = SLUG) => `DELETE ${slug}`;
const OPEN = "Open the article";
const QUEUEING = "Queueing it…";

/** An import job: `fetch` among its steps is what makes it one (src/job-state.ts). */
const makeJob = (id: string, status: Job["status"], slug = SLUG): Job =>
  ({
    id,
    slug,
    status,
    title: `The job ${id}`,
    steps: [{ name: "fetch", label: "Fetching", status: "pending" }],
    createdAt: AT,
  }) as unknown as Job;

let host: HTMLDivElement;
let root: Root;
let strict = false;
let source: { kind: "url"; url: string } | { kind: "upload"; uploadId: string } = URL_SOURCE;
let readerId: string | null = "reader-a";

function render(): void {
  const page = createElement(AddPage, { source, readerId });
  act(() => {
    root.render(strict ? createElement(StrictMode, null, page) : page);
  });
}

/** Let requests answer and effects run, without moving the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** The page mid-import, the job in the list, the probe and the read answered. */
async function importing(): Promise<void> {
  addResult = makeJob("job-1", "running");
  jobs = [addResult];
  render();
  await settle();
}

async function finish(id = "job-1", slug = SLUG): Promise<void> {
  jobs = [makeJob(id, "done", slug)];
  render();
  await settle();
}

const section = () => host.querySelector<HTMLElement>("[data-add-sharing]");
const toggle = () => host.querySelector<HTMLButtonElement>("[data-add-sharing-toggle]");
const isOpen = () => section()?.dataset.open === "true";
/**
 * ***Make it public* as the box it used to be.** It became a button on
 * 2026-10-09 (plan 261009i), and each press calls what the box called, so the
 * cases below still say *tick* and *untick*. This hands back the one press the
 * control offers (*Make it public…*, *Cancel* or *Stop sharing*; the
 * confirmation's own *Cancel* is deliberately excluded), or null when the
 * control offers no press, as the box was disabled then; and `checked` is its
 * `data-on`, which is what the tick showed.
 */
const shareBox = (): (HTMLElement & { checked: boolean }) | null => {
  const control = host.querySelector<HTMLElement>("[data-add-share]:not([data-add-share=adopted])");
  if (!control) return null;
  const press = control.querySelector<HTMLButtonElement>("[data-add-share-press]");
  if (!press) return null;
  return Object.assign(press, { checked: control.dataset.on === "true" });
};
const linkControl = () => host.querySelector<HTMLElement>("[data-add-share-link]");
const linkShown = (): string | null =>
  [...host.querySelectorAll<HTMLInputElement>("input[readonly]")].map((i) => i.value).find((v) => v.includes("key=")) ??
  null;
const rightsBox = (): HTMLInputElement | undefined =>
  [...host.querySelectorAll("label")].find((l) => l.textContent?.includes(SHARING_RIGHTS_CONFIRM))?.querySelector("input") ??
  undefined;
const button = (name: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const copyLinkButton = () => host.querySelector<HTMLButtonElement>("button[data-copy-import-link]");
const click = (el: HTMLElement | null | undefined, what: string): void => {
  if (!el) throw new Error(`no ${what}`);
  act(() => el.click());
};
const text = () => host.textContent ?? "";
/** Everything a reader could see or copy: the text, and what every input holds. */
const everything = () =>
  `${host.innerHTML} ${[...host.querySelectorAll("input")].map((i) => i.value).join(" ")}`;

/** Focus is how a keyboard asks for a Tooltip, and opens it without the pointer delay. */
async function expectTooltip(control: HTMLButtonElement | undefined, words: string): Promise<void> {
  expect(control, `no control for tooltip “${words}”`).toBeDefined();
  expect(document.body.textContent).not.toContain(words);
  await act(async () => control?.focus());
  expect(document.body.textContent).toContain(words);
}

async function openSection(): Promise<void> {
  if (!isOpen()) click(toggle(), "Sharing row");
  await settle();
}

/** Open the section, open the question, tick the rights, press *Create the link*. */
async function createLink(): Promise<void> {
  await openSection();
  click(button(LINK_AT_ADD_LABEL), "Create a private link button");
  click(rightsBox(), "rights box");
  click(button("Create the link"), "Create the link button");
  await settle();
}

async function makePublic(): Promise<void> {
  await openSection();
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
  retireAddSharing();
  stores.localStorage.clear();
  stores.sessionStorage.clear();
  source = URL_SOURCE;
  readerId = "reader-a";
  jobs = [];
  addResult = null;
  adds = 0;
  retryResult = null;
  transfer = null;
  strict = false;
  navigations.length = 0;
  writes.length = 0;
  probes.length = 0;
  linkReads.length = 0;
  probeAnswer = async () => NO_ROW();
  linkRead = async () => NO_ROW();
  linkCreate = async () => json(LINK_ON);
  linkRemove = async () => json(LINK_OFF);
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

describe("2a: the job card comes from the POST's answer", () => {
  it("hears a terminal advance before the list replaces its running copy", async () => {
    let end: (outcome: import("../src/web/jobEngine.js").TerminalOutcome) => void = () => {};
    const watch = vi.spyOn(jobEngine, "watchTerminal").mockImplementation((_id, callback) => {
      end = callback;
      return () => {};
    });
    try {
      await importing();
      act(() => end({ kind: "done", job: makeJob("job-1", "done") }));
      await settle();
      expect(navigations).toEqual([`/read/${SLUG}`]);
    } finally {
      watch.mockRestore();
    }
  });

  it("never resurrects the POST's running status after the list showed a cancelled job", async () => {
    addResult = makeJob("job-1", "running");
    render();
    await settle();
    jobs = [makeJob("job-1", "cancelled")];
    render();
    await settle();
    expect(text()).toContain("Retry");
    jobs = [];
    render();
    await settle();
    expect(text()).toContain("Retry");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Stop")).toBe(false);
  });

  it("stops showing the POST snapshot when the engine proves the job vanished from a fresh list", async () => {
    let end: (outcome: import("../src/web/jobEngine.js").TerminalOutcome) => void = () => {};
    const watch = vi.spyOn(jobEngine, "watchTerminal").mockImplementation((_id, callback) => {
      end = callback;
      return () => {};
    });
    try {
      addResult = makeJob("job-1", "running");
      jobs = [];
      render();
      await settle();
      expect(text()).toContain("The job job-1");
      act(() => end({ kind: "vanished" }));
      await settle();
      expect(text()).not.toContain("The job job-1");
      expect(text()).not.toContain(QUEUEING);
      expect(text()).toContain("Look on your shelf before trying again");
    } finally {
      watch.mockRestore();
    }
  });

  it("draws the card, the link button and the Sharing row before any list has the job", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [];
    render();
    await settle();
    expect(text()).not.toContain(QUEUEING);
    expect(text()).toContain("The job job-1");
    expect(copyLinkButton(), "the copy-the-link button").not.toBeNull();
    expect(section(), "the Sharing row").not.toBeNull();
    expect(probes).toEqual([SLUG]);
  });

  it("the list's copy wins once the list has the job", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [];
    render();
    await settle();
    expect(navigations).toEqual([]);
    /* Only the list says it is done; the held copy still says running. */
    await finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("posts once under StrictMode, and still draws the held job", async () => {
    strict = true;
    addResult = makeJob("job-1", "running");
    jobs = [];
    render();
    await settle();
    expect(adds).toBe(1);
    expect(text()).toContain("The job job-1");
  });

  it("follows Retry: the replacement is drawn under its new id and slug before the list has it", async () => {
    await importing();
    jobs = [makeJob("job-1", "error")];
    render();
    await settle();
    /* The list never learns of the replacement in this case. */
    retryResult = () => makeJob("job-2", "running", OTHER);
    click(
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry")),
      "Retry button",
    );
    await settle();
    expect(text()).toContain("The job job-2");
    expect(text()).not.toContain("The job job-1");
    expect(probes, "the Sharing row is about the replacement's slug").toEqual([SLUG, OTHER]);
  });

  it("does not draw the held job of one address at another", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [];
    render();
    await settle();
    /* The second address's POST has not answered. */
    addResult = new Promise<Job | null>(() => {});
    source = { kind: "url", url: "https://example.com/another" };
    render();
    await settle();
    expect(text()).not.toContain("The job job-1");
    expect(text()).toContain(QUEUEING);
  });

  it("drops an answer that arrives after the address has moved on", async () => {
    let answer: (job: Job) => void = () => {};
    addResult = new Promise<Job | null>((resolve) => {
      answer = resolve;
    });
    render();
    await settle();
    addResult = new Promise<Job | null>(() => {});
    source = { kind: "url", url: "https://example.com/another" };
    render();
    await settle();
    answer(makeJob("job-1", "running"));
    await settle();
    expect(text()).not.toContain("The job job-1");
    expect(section()).toBeNull();
  });

  it("an upload the engine queued is drawn from the engine's own copy of the job", async () => {
    source = { kind: "upload", uploadId: "up-1" };
    transfer = {
      uploadId: "up-1",
      filename: "a-paper.pdf",
      size: 10,
      phase: { kind: "queued", job: makeJob("job-up", "running") },
    } as unknown as Transfer;
    jobs = [];
    render();
    await settle();
    expect(adds, "the engine posted, so the page must not").toBe(0);
    expect(text()).toContain("The job job-up");
    expect(section()).not.toBeNull();
    expect(probes).toEqual([SLUG]);
  });
});

describe("2b: one Sharing section, closed by default", () => {
  it("starts closed: one row, and neither control", async () => {
    await importing();
    expect(section()).not.toBeNull();
    expect(isOpen()).toBe(false);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle()?.textContent?.trim()).toBe(sharingAtAddSummary(false, false));
    expect(shareBox()).toBeNull();
    expect(linkControl()).toBeNull();
    expect(text()).not.toContain(SHARE_AT_ADD_LABEL);
    expect(writes).toEqual([]);
  });

  it("reads the link's state once on arriving, closed or not, and shares the probe", async () => {
    await importing();
    expect(linkReads).toEqual([SLUG]);
    expect(probes).toEqual([SLUG]);
  });

  it("opens to both controls, and shuts again", async () => {
    await importing();
    expect(toggle()?.parentElement?.tagName, "the disclosure row remains the section's heading").toBe("H2");
    await openSection();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(shareBox()?.checked).toBe(false);
    expect(button(LINK_AT_ADD_LABEL)).toBeDefined();
    await expectTooltip(button(LINK_AT_ADD_LABEL), PRIVATE_LINK_OPEN_TIP);
    await expectTooltip(button(SHARE_AT_ADD_LABEL), SHARING_OPEN_TIP);
    expect(linkControl()?.querySelector(":scope > h3")?.textContent).toBe("Private link");
    expect(host.querySelector("[data-add-share] > h3")?.textContent).toBe("Public");
    click(toggle(), "Sharing row");
    expect(isOpen()).toBe(false);
    expect(shareBox()).toBeNull();
  });

  /* Plan 261009i (spya-nsrkju): five critics read the page in character, and
     these are the four things they agreed it did not say. */
  it("claims no state when shut with nothing on, and opens on what every article starts as, with Help", async () => {
    /* Not *off*: this tab cannot always know (GPT Sol's plan review, P1). */
    await importing();
    expect(isOpen()).toBe(false);
    expect(toggle()?.textContent).toBe(sharingAtAddSummary(false, false));
    expect(sharingAtAddSummary(false, false)).not.toMatch(/off|private|only you/i);
    await openSection();
    const intro = host.querySelector("[data-add-sharing-intro]");
    expect(intro?.textContent).toContain(SHARING_AT_ADD_INTRO);
    expect(intro?.querySelector("a")?.getAttribute("href")).toBe("/help/sharing");
  });

  it("draws the private link first, the Metadata card's order", async () => {
    await importing();
    await openSection();
    const link = linkControl();
    const pub = host.querySelector("[data-add-share]");
    if (!link || !pub) throw new Error("both controls should be drawn");
    expect(link.compareDocumentPosition(pub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers no tick box and no *Stop sharing* while the public question is still asking", async () => {
    /* The box stayed ticked over an unanswered confirmation, so the page
       looked shared when nothing was. */
    await importing();
    await openSection();
    click(button(SHARE_AT_ADD_LABEL), "Make it public button");
    expect(text()).toContain(SHARING_CONFIRM_TITLE);
    const boxes = [...host.querySelectorAll<HTMLInputElement>("[data-add-share] input[type=checkbox]")];
    expect(boxes.map((b) => b.closest("label")?.textContent), "a box other than the rights tick").toEqual([
      SHARING_RIGHTS_CONFIRM,
    ]);
    expect(shareBox(), "the legacy helper found a press where the public control offers none").toBeNull();
    expect(button("Stop sharing")).toBeUndefined();
    expect(button(SHARE_AT_ADD_LABEL), "the opener is still offered over its own question").toBeUndefined();
    expect(button("Share it")?.closest("div.tw\\:rounded-md")?.querySelector("h4")?.textContent).toBe(
      SHARING_CONFIRM_TITLE,
    );
  });

  it("says where the public listing is, by the public shelf's own name", async () => {
    await importing();
    await openSection();
    const shelf = [...host.querySelectorAll("[data-add-share] a")].find((a) => a.textContent === PUBLIC_SHELF_LABEL);
    expect(shelf?.getAttribute("href")).toBe("/read/public");
  });

  it("says the private link itself is unlisted even while the article is public", async () => {
    await importing();
    await makePublic();
    expect(linkControl()?.textContent).toContain("The private link is not listed anywhere.");
  });

  it("shows only the control it could read: the link's read failed", async () => {
    linkRead = async () => json({ error: "boom" }, { status: 500 });
    await importing();
    await openSection();
    expect(shareBox()).not.toBeNull();
    expect(linkControl()).toBeNull();
  });

  it("draws no row over an article already on the shelf: the line, and no control", async () => {
    probeAnswer = async () => json({ stages: [] });
    await importing();
    expect(toggle()).toBeNull();
    expect(text()).toContain(SHARE_AT_ADD_ALREADY_AN_ARTICLE);
    expect(text().split(SHARE_AT_ADD_ALREADY_AN_ARTICLE)).toHaveLength(2);
    expect(linkReads, "a published article's link is Metadata's to read").toEqual([]);
  });
});

describe("2b: no link without the rights tick and the press", () => {
  it("opening the question sends nothing, and shows the Metadata card's confirmation", async () => {
    await importing();
    await openSection();
    click(button(LINK_AT_ADD_LABEL), "Create a private link button");
    expect(text()).toContain(PRIVATE_LINK_CONFIRM_TITLE);
    expect(text()).toContain(SHARING_RIGHTS_CONFIRM);
    expect(button("Create the link")?.closest("div.tw\\:rounded-md")?.querySelector("h4")?.textContent).toBe(
      PRIVATE_LINK_CONFIRM_TITLE,
    );
    await settle();
    expect(writes).toEqual([]);
  });

  it("the press does nothing until the rights box is ticked", async () => {
    await importing();
    await openSection();
    click(button(LINK_AT_ADD_LABEL), "Create a private link button");
    expect(button("Create the link")?.disabled).toBe(true);
    click(button("Create the link"), "Create the link button");
    await settle();
    expect(writes).toEqual([]);
  });

  it("ticking the rights box alone sends nothing", async () => {
    await importing();
    await openSection();
    click(button(LINK_AT_ADD_LABEL), "Create a private link button");
    click(rightsBox(), "rights box");
    await settle();
    expect(writes).toEqual([]);
  });

  it("with both, sends one create carrying rightsConfirmed, and shows the whole link", async () => {
    await importing();
    await createLink();
    expect(writes).toEqual([CREATE()]);
    expect(linkShown()).toBe(`${location.origin}/read/${SLUG}?key=${KEY}`);
    expect(text()).toContain(LINK_AT_ADD_ON);
    expect(button("Turn off")).toBeDefined();
    await expectTooltip(button("Turn off"), PRIVATE_LINK_STOP_TIP);
  });

  it("Cancel closes the confirmation and sends nothing", async () => {
    await importing();
    await openSection();
    click(button(LINK_AT_ADD_LABEL), "Create a private link button");
    click(rightsBox(), "rights box");
    click(button("Cancel"), "Cancel button");
    await settle();
    expect(text()).not.toContain(PRIVATE_LINK_CONFIRM_TITLE);
    expect(writes).toEqual([]);
  });

  it("*Turn off* sends the delete, and the link is gone", async () => {
    await importing();
    await createLink();
    click(button("Turn off"), "Turn off button");
    await settle();
    expect(writes).toEqual([CREATE(), REMOVE()]);
    expect(linkShown()).toBeNull();
  });

  it("puts the key in no storage", async () => {
    await importing();
    await createLink();
    const stored = [...stores.sessionStorage, ...stores.localStorage].flat().join(" ");
    expect(stored).not.toContain(KEY);
  });
});

describe("2b: before the article's row exists, and an answer that did not come back", () => {
  it("a 404 on the create while the import runs is *not yet*, and is sent again", async () => {
    let answers = 0;
    linkCreate = async () => (++answers === 1 ? NO_ROW() : json(LINK_ON));
    await importing();
    await createLink();
    expect(text()).toContain(LINK_AT_ADD_WAITING);
    expect(writes).toEqual([CREATE()]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await settle();
    expect(writes).toEqual([CREATE(), CREATE()]);
    expect(linkShown()).not.toBeNull();
  });

  it("a create that did not come back is not sent again by itself, at any later moment", async () => {
    linkCreate = async () => Promise.reject(new TypeError("Failed to fetch"));
    await importing();
    await createLink();
    expect(text()).toContain(LINK_AT_ADD_UNKNOWN);
    expect(linkShown()).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    await finish();
    expect(writes).toEqual([CREATE()]);
    expect(navigations, "it left without the reader being told").toEqual([]);
  });

  it("*Check again* reads, and shows the link that create did make", async () => {
    linkCreate = async () => Promise.reject(new TypeError("Failed to fetch"));
    await importing();
    await createLink();
    linkRead = async () => json(LINK_ON);
    click(button("Check again"), "Check again button");
    await settle();
    expect(linkReads).toEqual([SLUG, SLUG]);
    expect(linkShown()).toBe(`${location.origin}/read/${SLUG}?key=${KEY}`);
    expect(writes).toEqual([CREATE()]);
  });

  it("*Turn off* stops a link that create may have made, while the reads still fail (plan 261009l)", async () => {
    linkCreate = async () => Promise.reject(new TypeError("Failed to fetch"));
    await importing();
    await createLink();
    linkRead = async () => Promise.reject(new TypeError("Failed to fetch"));
    click(button("Check again"), "Check again button");
    await settle();
    expect(text()).toContain(LINK_AT_ADD_UNKNOWN);
    await expectTooltip(button("Turn off"), LINK_AT_ADD_UNKNOWN_STOP_TIP);
    click(button("Turn off"), "Turn off button");
    await settle();
    expect(writes).toEqual([CREATE(), REMOVE()]);
    expect(text()).not.toContain(LINK_AT_ADD_UNKNOWN);
    expect(button(LINK_AT_ADD_LABEL)).toBeDefined();
  });

  it("*Turn off* stays pressable while *Check again*'s read is out", async () => {
    linkCreate = async () => Promise.reject(new TypeError("Failed to fetch"));
    await importing();
    await createLink();
    linkRead = () => new Promise<Response>(() => {});
    click(button("Check again"), "Check again button");
    await settle();
    expect(button("Checking…")?.disabled).toBe(true);
    expect(button("Turn off")?.disabled).toBe(false);
    click(button("Turn off"), "Turn off button");
    await settle();
    expect(writes).toEqual([CREATE(), REMOVE()]);
    expect(button(LINK_AT_ADD_LABEL)).toBeDefined();
  });
});

describe("2b: the section opens itself when it has something to say, and names what is on when shut", () => {
  it("is open, with the link, on arriving at an import whose link is already on: a reload", async () => {
    linkRead = async () => json(LINK_ON);
    await importing();
    expect(isOpen()).toBe(true);
    expect(linkShown()).toBe(`${location.origin}/read/${SLUG}?key=${KEY}`);
    expect(writes).toEqual([]);
  });

  it("is open over the reload warning of *Make it public*", async () => {
    stores.sessionStorage.set(`spideryarn.share-at-add.reader-a.${SLUG}`, "1");
    await importing();
    expect(isOpen()).toBe(true);
    expect(text()).toContain(SHARE_AT_ADD_RECALLED);
  });

  it("cannot be shut over an open question", async () => {
    await importing();
    await openSection();
    click(button(LINK_AT_ADD_LABEL), "Create a private link button");
    expect(isOpen()).toBe(true);
    expect(toggle(), "a row that would shut it").toBeNull();
  });

  it("shut over a private link, its row says so", async () => {
    await importing();
    await createLink();
    click(toggle(), "Sharing row");
    expect(isOpen()).toBe(false);
    expect(toggle()?.textContent?.trim()).toBe(sharingAtAddSummary(false, true));
    expect(linkShown(), "the key stays out of a shut section").toBeNull();
  });

  it("shut over a public article, its row says so", async () => {
    await importing();
    await makePublic();
    click(toggle(), "Sharing row");
    expect(toggle()?.textContent?.trim()).toBe(sharingAtAddSummary(true, false));
    await openSection();
    await expectTooltip(button("Stop sharing"), SHARING_STOP_TIP);
  });

  it("with both on, says both, and says the link is not what keeps it readable", async () => {
    await importing();
    await makePublic();
    expect(text()).not.toContain(PRIVATE_LINK_ALSO_PUBLIC);
    await createLink();
    expect(writes).toEqual([`PUT ${SLUG} public`, CREATE()]);
    expect(text()).toContain(PRIVATE_LINK_ALSO_PUBLIC);
    click(toggle(), "Sharing row");
    expect(toggle()?.textContent?.trim()).toBe(sharingAtAddSummary(true, true));
  });

  it("the three summaries are three different sentences", () => {
    const all = [
      sharingAtAddSummary(false, false),
      sharingAtAddSummary(true, false),
      sharingAtAddSummary(false, true),
      sharingAtAddSummary(true, true),
    ];
    expect(new Set(all).size).toBe(4);
  });
});

describe("2b: the page does not leave by itself while the link is unsettled", () => {
  it("opens the article by itself over a section never opened", async () => {
    await importing();
    await finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("opens the article by itself once the link is on", async () => {
    await importing();
    await createLink();
    await finish();
    expect(navigations).toEqual([`/read/${SLUG}`]);
  });

  it("waits while the link's confirmation is open, and opens on the button", async () => {
    await importing();
    await openSection();
    click(button(LINK_AT_ADD_LABEL), "Create a private link button");
    await finish();
    expect(navigations).toEqual([]);
    click(button(OPEN), OPEN);
    await settle();
    expect(navigations).toEqual([`/read/${SLUG}`]);
    expect(writes).toEqual([]);
  });

  it("waits over a refusal, which stays on the page", async () => {
    linkCreate = async () => json({ error: "This paper has not been read through yet." }, { status: 409 });
    await importing();
    await createLink();
    await finish();
    expect(navigations).toEqual([]);
    expect(text()).toContain("This paper has not been read through yet.");
    expect(button(OPEN)).toBeDefined();
  });

  it("sends a create still waiting for the row when the import completes, and waits for its answer", async () => {
    let answers = 0;
    linkCreate = async () => (++answers === 1 ? NO_ROW() : json(LINK_ON));
    await importing();
    await createLink();
    expect(writes).toEqual([CREATE()]);
    await finish();
    expect(writes).toEqual([CREATE(), CREATE()]);
    expect(navigations).toEqual([]);
    expect(linkShown()).not.toBeNull();
    expect(button(OPEN)).toBeDefined();
  });
});

describe("F1: a direct switch from reader A to reader B", () => {
  /** What `useJobSession`'s cleanup does, and then the page drawn for B, whose list is empty. */
  async function switchToB(): Promise<void> {
    act(() => retireAddSharing());
    readerId = "reader-b";
    jobs = [];
    render();
    await settle();
  }

  it("leaves nothing of A's on screen: no link, no key, no card", async () => {
    await importing();
    await createLink();
    expect(everything()).toContain(KEY);
    await switchToB();
    expect(everything()).not.toContain(KEY);
    expect(text()).not.toContain("The job job-1");
    expect(section()).toBeNull();
  });

  it("does not draw A's held job for B, before B's list has anything", async () => {
    addResult = makeJob("job-1", "running");
    jobs = [];
    render();
    await settle();
    expect(text()).toContain("The job job-1");
    await switchToB();
    expect(text()).not.toContain("The job job-1");
    expect(copyLinkButton()).toBeNull();
  });

  it("A's create answering after the switch is drawn nowhere", async () => {
    const out = heldResponse();
    linkCreate = () => out.promise;
    await importing();
    await createLink();
    await switchToB();
    out.answer(json(LINK_ON));
    await settle();
    expect(everything()).not.toContain(KEY);
    expect(linkShown()).toBeNull();
  });

  it("A's add POST answering after the switch draws no card for B", async () => {
    let answer: (job: Job) => void = () => {};
    addResult = new Promise<Job | null>((resolve) => {
      answer = resolve;
    });
    render();
    await settle();
    await switchToB();
    answer(makeJob("job-1", "running"));
    await settle();
    expect(text()).not.toContain("The job job-1");
    expect(section()).toBeNull();
  });

  it("the same reader keeps their controllers when nothing was retired", async () => {
    await importing();
    await createLink();
    render();
    await settle();
    expect(linkShown()).not.toBeNull();
    expect(linkReads).toEqual([SLUG]);
  });

  it("a page still mounted when its controllers are retired takes up fresh ones, and reads again", async () => {
    await importing();
    await createLink();
    linkRead = async () => json(LINK_ON);
    act(() => retireAddSharing());
    await settle();
    expect(linkReads, "the fresh controller reads the truth").toEqual([SLUG, SLUG]);
    expect(linkShown()).toBe(`${location.origin}/read/${SLUG}?key=${KEY}`);
    expect(writes).toEqual([CREATE()]);
  });
});
