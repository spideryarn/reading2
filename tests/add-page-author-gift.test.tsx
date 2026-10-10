// @vitest-environment jsdom
/**
 * ***For the author…* on the add page** — src/web/AddAuthorGift.tsx over
 * src/web/add-author-gift.ts, wired into src/web/AddPage.tsx;
 * docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md § D9 and
 * § Revision 3, R2-F8.
 *
 * The controller is driven without React in tests/add-author-gift.test.ts.
 * What only the page can get wrong is pinned here:
 *
 *  - **only an administrator sees it**, and for everybody else, and for an
 *    administrator who never armed it, the exit is what it always was: in
 *    the same tick, with no request;
 *  - **confirming ticks High-powered AI through its own controller** (its
 *    `PUT` goes out) and arms the gift; *Undo* disarms it;
 *  - **both exits go through one transition**: armed, the gift's `POST` is
 *    sent once, for this reader, and the page navigates once after it;
 *  - **a refusal keeps the page**, says why, links to `/admin/vouchers` and
 *    offers *Open the article anyway*;
 *  - **a reader change mid-await navigates nowhere**.
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

const AT = "2026-10-09T12:00:00.000Z";
/** Every author-gift `POST`: its body, and the reader it was made for. */
const gifts: Array<{ body: unknown; madeFor: string | null }> = [];
/** Every High-powered `PUT`: `<slug>:<body>`. */
const powers: string[] = [];
/** How the author-gift `POST` answers. Replaced per test; the default is a new gift. */
let giftAnswer: () => Promise<Response>;
const created = async () =>
  json({ id: "a07e6f15-0000-4000-8000-0000000000a1", status: "draft", created: true, lookupId: "x" }, { status: 202 });

vi.mock("../src/web/lib/api.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/web/lib/api.js")>();
  return {
    ...actual,
    apiFetch: async (input: string, init: RequestInit = {}, madeFor: string | null = null) => {
      const method = init.method ?? "GET";
      if (input === "/api/reader") return json({ autoModes: true });
      if (input.startsWith("/api/reader?slug=")) return json({ autoModes: true, purpose: null, purposeFailed: false });
      if (method === "GET" && input.startsWith("/api/metadata/")) return json({ error: "No article" }, { status: 404 });
      if (method === "PUT" && input.endsWith("/high-power")) {
        powers.push(`${decodeURIComponent(input.split("/")[3] ?? "")}:${String(init.body)}`);
        return json({ highPowerSince: AT });
      }
      if (method === "POST" && input === "/api/admin/author-gifts") {
        gifts.push({ body: JSON.parse(String(init.body)), madeFor });
        return giftAnswer();
      }
      throw new Error(`unexpected fetch ${method} ${input}`);
    },
    leavingFetch: () => Promise.resolve(),
  };
});

const { AddPage, resetAddPurposeForTests } = await import("../src/web/AddPage.js");
const { resetAutoModesSettingForTests } = await import("../src/web/auto-modes-setting.js");
const { resetShareAtAddForTests } = await import("../src/web/add-share.js");
const { retireAddSharing } = await import("../src/web/add-sharing-session.js");
const { ADMIN_USER_ID_PROD } = await import("../src/admin.js");
const { SHARING_RIGHTS_CONFIRM } = await import("../src/messages.js");
const {
  AUTHOR_GIFT_AT_ADD_ARMED,
  AUTHOR_GIFT_AT_ADD_CONFIRM,
  AUTHOR_GIFT_AT_ADD_LABEL,
  AUTHOR_GIFT_AT_ADD_OPEN_ANYWAY,
  AUTHOR_GIFT_AT_ADD_STEPS,
} = await import("../src/web/AddAuthorGift.js");

const SLUG = "a-paper";
const URL_SOURCE = { kind: "url", url: "https://example.com/a-paper" } as const;
const READ = `/read/${SLUG}`;
const ADMIN = ADMIN_USER_ID_PROD;

const makeJob = (id: string, status: Job["status"], slug = SLUG): Job =>
  ({ id, slug, status, steps: [] }) as unknown as Job;

let host: HTMLDivElement;
let root: Root;
let strict = false;
let reader: string | null = ADMIN;

function render(): void {
  const page = createElement(AddPage, { source: URL_SOURCE, readerId: reader });
  act(() => {
    root.render(strict ? createElement(StrictMode, null, page) : page);
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function importing(): Promise<void> {
  addResult = makeJob("job-1", "running");
  jobs = [addResult];
  render();
  await settle();
}

/** The job reaching `done`: the automatic exit. */
function complete(): void {
  jobs = [makeJob("job-1", "done")];
  render();
}

const giftBox = () => host.querySelector<HTMLElement>("[data-add-author-gift]");
const button = (name: string, within: ParentNode = host): HTMLButtonElement | undefined =>
  [...within.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const click = (el: HTMLElement | null | undefined, what: string): void => {
  if (!el) throw new Error(`no ${what}`);
  act(() => el.click());
};
const text = () => host.textContent ?? "";

/** Open the confirmation, tick the rights, confirm. */
async function arm(): Promise<void> {
  click(button(AUTHOR_GIFT_AT_ADD_LABEL), "For the author button");
  const box = giftBox();
  if (!box) throw new Error("no gift box");
  for (const step of AUTHOR_GIFT_AT_ADD_STEPS) expect(box.textContent).toContain(step);
  expect(box.textContent).toContain("up to three searches");
  expect(button(AUTHOR_GIFT_AT_ADD_CONFIRM, box)?.disabled).toBe(true);
  const rights = [...box.querySelectorAll("label")]
    .find((l) => l.textContent?.includes(SHARING_RIGHTS_CONFIRM))
    ?.querySelector("input");
  click(rights, "rights box");
  click(button(AUTHOR_GIFT_AT_ADD_CONFIRM, box), "confirm button");
  await settle();
}

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
  resetShareAtAddForTests();
  retireAddSharing();
  window.sessionStorage.clear();
  jobs = [];
  addResult = null;
  strict = false;
  reader = ADMIN;
  navigations.length = 0;
  gifts.length = 0;
  powers.length = 0;
  giftAnswer = created;
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

describe("who sees it", () => {
  it("a reader who is not an administrator sees no control, and leaves as before", async () => {
    reader = "a07e6f15-1111-4111-8111-0000000000b2";
    await importing();
    expect(text()).not.toContain(AUTHOR_GIFT_AT_ADD_LABEL);
    expect(giftBox()).toBeNull();
    complete();
    /* In the same tick as the completion's render, with nothing awaited. */
    expect(navigations).toEqual([READ]);
    await settle();
    expect(navigations).toEqual([READ]);
    expect(gifts).toEqual([]);
  });

  it("an administrator sees it under the High-powered AI box", async () => {
    await importing();
    const power = host.querySelector("[data-add-high-power]");
    const box = giftBox();
    expect(power).not.toBeNull();
    expect(box).not.toBeNull();
    expect((power as Node).compareDocumentPosition(box as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text()).toContain(AUTHOR_GIFT_AT_ADD_LABEL);
  });
});

describe("not armed: the exits are unchanged", () => {
  it("an administrator who never pressed it leaves at completion, in the same tick, with no request", async () => {
    await importing();
    complete();
    expect(navigations).toEqual([READ]);
    await settle();
    expect(navigations).toEqual([READ]);
    expect(gifts).toEqual([]);
  });

  it("Undo disarms it: nothing is sent and the page leaves as before", async () => {
    await importing();
    await arm();
    click(button("Undo"), "Undo");
    expect(text()).not.toContain(AUTHOR_GIFT_AT_ADD_ARMED);
    complete();
    expect(navigations).toEqual([READ]);
    await settle();
    expect(gifts).toEqual([]);
  });

  it("an open confirmation holds the page, as the sharing confirmation does", async () => {
    await importing();
    click(button(AUTHOR_GIFT_AT_ADD_LABEL), "For the author button");
    complete();
    await settle();
    expect(navigations).toEqual([]);
    expect(button("Open the article")).toBeDefined();
    expect(gifts).toEqual([]);
  });
});

describe("armed", () => {
  it("confirming ticks High-powered AI through its own controller", async () => {
    await importing();
    await arm();
    expect(powers).toEqual([`${SLUG}:${JSON.stringify({ on: true })}`]);
    expect(text()).toContain(AUTHOR_GIFT_AT_ADD_ARMED);
    expect(gifts).toEqual([]);
  });

  it("202: one request for this reader, then one navigation", async () => {
    await importing();
    await arm();
    complete();
    /* Not in the same tick: it waits for the gift. */
    expect(navigations).toEqual([]);
    await settle();
    expect(gifts).toEqual([{ body: { slug: SLUG, rightsConfirmed: true }, madeFor: ADMIN }]);
    expect(navigations).toEqual([READ]);
  });

  it("200 (a gift already there) navigates too", async () => {
    giftAnswer = async () =>
      json({ id: "a07e6f15-0000-4000-8000-0000000000a1", status: "draft", created: false });
    await importing();
    await arm();
    complete();
    await settle();
    expect(gifts).toHaveLength(1);
    expect(navigations).toEqual([READ]);
  });

  it("a double completion (StrictMode, and a second render) sends once and navigates once", async () => {
    strict = true;
    const held = heldResponse();
    giftAnswer = () => held.promise;
    await importing();
    await arm();
    complete();
    render();
    await settle();
    expect(gifts).toHaveLength(1);
    expect(navigations).toEqual([]);
    held.answer(await created());
    await settle();
    render();
    await settle();
    expect(gifts).toHaveLength(1);
    expect(navigations).toEqual([READ]);
  });

  it("the reader's own exit goes through it too", async () => {
    await importing();
    await arm();
    /* The caret in the purpose box: the page waits at *ready*. */
    const box = host.querySelector<HTMLTextAreaElement>("textarea");
    if (!box) throw new Error("no purpose box");
    act(() => box.focus());
    complete();
    await settle();
    expect(navigations).toEqual([]);
    expect(gifts).toEqual([]);
    click(button("Open the article"), "Open the article");
    await settle();
    expect(gifts).toHaveLength(1);
    expect(navigations).toEqual([READ]);
  });

  it("409: stays, says why with a link to /admin/vouchers, and offers Open the article anyway", async () => {
    giftAnswer = async () => json({ error: "That article has nothing to read yet." }, { status: 409 });
    await importing();
    await arm();
    complete();
    await settle();
    expect(gifts).toHaveLength(1);
    expect(navigations).toEqual([]);
    const line = host.querySelector("[data-add-author-gift-failed]");
    expect(line?.textContent).toContain("That article has nothing to read yet.");
    expect(line?.querySelector("a")?.getAttribute("href")).toBe("/admin/vouchers");
    click(button(AUTHOR_GIFT_AT_ADD_OPEN_ANYWAY), "Open the article anyway");
    await settle();
    expect(navigations).toEqual([READ]);
    expect(gifts).toHaveLength(1);
  });

  it("a lost answer stays too", async () => {
    giftAnswer = async () => Promise.reject(new TypeError("Failed to fetch"));
    await importing();
    await arm();
    complete();
    await settle();
    expect(navigations).toEqual([]);
    expect(host.querySelector("[data-add-author-gift-failed]")?.textContent).toContain("may or may not");
    expect(button(AUTHOR_GIFT_AT_ADD_OPEN_ANYWAY)).toBeDefined();
  });

  it("a malformed success answer does not let the page claim the gift was made", async () => {
    giftAnswer = async () => json({ id: "not-the-contract", created: true }, { status: 202 });
    await importing();
    await arm();
    complete();
    await settle();
    expect(navigations).toEqual([]);
    expect(host.querySelector("[data-add-author-gift-failed]")).not.toBeNull();
    expect(button(AUTHOR_GIFT_AT_ADD_OPEN_ANYWAY)).toBeDefined();
  });

  it("a reader change mid-await navigates nowhere", async () => {
    const held = heldResponse();
    giftAnswer = () => held.promise;
    await importing();
    await arm();
    complete();
    await settle();
    expect(gifts).toEqual([{ body: { slug: SLUG, rightsConfirmed: true }, madeFor: ADMIN }]);
    act(() => retireAddSharing());
    held.answer(await created());
    await settle();
    expect(navigations).toEqual([]);
    expect(gifts).toHaveLength(1);
  });

  it("a reader change before completion forgets the intent: no request at all", async () => {
    await importing();
    await arm();
    act(() => retireAddSharing());
    await settle();
    complete();
    await settle();
    expect(gifts).toEqual([]);
  });

  it("a source change mid-await cannot open the article from the old address", async () => {
    const held = heldResponse();
    giftAnswer = () => held.promise;
    await importing();
    await arm();
    complete();
    await settle();

    addResult = makeJob("job-2", "running", "another");
    jobs = [addResult];
    act(() => {
      root.render(<AddPage source={{ kind: "url", url: "https://example.com/another" }} readerId={reader} />);
    });
    await act(async () => held.answer(await created()));
    await settle();
    expect(navigations).toEqual([]);
    expect(gifts).toHaveLength(1);
  });
});
