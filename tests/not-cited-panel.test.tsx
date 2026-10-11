// @vitest-environment jsdom
/**
 * **Sources › Not cited, drawn and pressed** — NotCitedPanel.tsx over
 * useRelatedWork.ts, with the network mocked. Plan
 * docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md.
 *
 * What is held: the GET is not asked until the chip is shown, and is asked
 * again only when Bibliography changes; nothing is POSTed until the owner
 * presses (F1), and the line saying what the
 * press sends is under every button that sends it; the press is held until
 * its answer is read, so two presses are one search; each outcome is its own
 * sentence; a failed *Search again* keeps the list it was over; the framing
 * says once that no row is among the works in the bibliography, and no row
 * says "not cited"; the warnings for a stale or capped bibliography, a list
 * not limited by date, and a changed query; the chip has no number until the
 * stored answer is read. The search and the exclusion themselves are
 * tests/related-work.test.ts.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RELATED_WORK_BIBLIOGRAPHY_CAPPED,
  RELATED_WORK_BIBLIOGRAPHY_STALE,
  RELATED_WORK_INTRO,
  RELATED_WORK_NO_BIBLIOGRAPHY,
  RELATED_WORK_NO_QUERY,
  RELATED_WORK_NONE,
  RELATED_WORK_NOT_SEARCHED,
  RELATED_WORK_QUERY_CHANGED,
  RELATED_WORK_RATE_LIMITED,
  RELATED_WORK_SEARCH,
  RELATED_WORK_SEARCH_AGAIN,
  RELATED_WORK_SEARCHING,
  RELATED_WORK_SENDS,
  RELATED_WORK_UNAVAILABLE,
} from "../src/messages.js";
import type { RelatedWork, RelatedWorkResult } from "../src/types.js";
import { sourcesHead } from "./helpers/sources-head.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every request, as `METHOD url`, in order. */
const asked: string[] = [];
/** What the next GET and POST answer: a body, or a status that is not ok. */
let onGet: RelatedWorkResult | number = { kind: "not-searched" };
let onPost: RelatedWorkResult | number = { kind: "not-searched" };
/** Set to hold the next POST open until the test lets it go. */
let holdPost: { promise: Promise<void>; release(): void } | null = null;

function respond(body: RelatedWorkResult | number): Response {
  return typeof body === "number"
    ? new Response(JSON.stringify({ error: "no" }), { status: body })
    : new Response(JSON.stringify(body), { status: 200 });
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    asked.push(`${method} ${url}`);
    if (method === "POST") {
      if (holdPost) await holdPost.promise;
      return respond(onPost);
    }
    return respond(onGet);
  },
  readJson: async (res: Response) => {
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  },
}));

const { useRelatedWork } = await import("../src/web/useRelatedWork.js");
const { NotCitedPanel, relatedAuthors } = await import("../src/web/NotCitedPanel.js");

const SLUG = "a-piece";
const API = `/api/related-work/${SLUG}`;

const NAT: RelatedWork = {
  openalexId: "W2963403868",
  doi: "10.48550/arxiv.1711.02281",
  title: "Non-Autoregressive Neural Machine Translation",
  authors: ["Jiatao Gu", "James Bradbury", "Caiming Xiong", "Victor O. K. Li", "Richard Socher"],
  authorCount: 5,
  year: 2017,
  venue: "ICLR",
  citedByCount: 506,
  abstract: "Existing approaches to neural machine translation condition each output word on previously generated outputs.",
};
const NO_DOI: RelatedWork = {
  openalexId: "W1234567",
  title: "Convolutional Sequence to Sequence Learning",
  authors: [],
  authorCount: 0,
};

function found(over: Partial<Extract<RelatedWorkResult, { kind: "found" }>> = {}): RelatedWorkResult {
  return {
    kind: "found",
    works: [NAT, NO_DOI],
    excluded: 3,
    bibliographyStale: false,
    bibliographyCapped: false,
    yearLimited: 2017,
    queryChanged: false,
    searchedAt: "2026-10-11T09:00:00.000Z",
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

function Harness({ wanted, bibliographyBasis }: { wanted: boolean; bibliographyBasis: object | null }) {
  const related = useRelatedWork(SLUG, wanted, bibliographyBasis);
  const head = sourcesHead({ view: "not-cited", onView: () => {}, ownerSlug: SLUG, notCited: related.result });
  return wanted ? createElement(NotCitedPanel, { related, head }) : head;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
}

async function show(wanted = true, bibliographyBasis: object | null = null): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Harness, { wanted, bibliographyBasis })));
  });
  await settle();
}

const text = () => host.textContent?.replace(/\s+/g, " ") ?? "";
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
const chip = () =>
  [...host.querySelectorAll<HTMLButtonElement>("button[role=radio]")].find((b) => b.textContent?.startsWith("Not cited"));
const posts = () => asked.filter((a) => a.startsWith("POST"));

async function press(label: string): Promise<void> {
  const target = button(label);
  expect(target, `a button labelled ${label}`).toBeDefined();
  await act(async () => target?.click());
  await settle();
}

beforeEach(() => {
  asked.length = 0;
  onGet = { kind: "not-searched" };
  onPost = { kind: "not-searched" };
  holdPost = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("when Not cited asks", () => {
  it("asks nothing until its chip is shown, and the chip has no number", async () => {
    await show(false);
    expect(asked).toEqual([]);
    expect(chip()?.textContent).toBe("Not cited");
    expect(chip()?.getAttribute("aria-label")).toBe("Not cited");
  });

  it("reads the stored answer once, and never POSTs on opening", async () => {
    onGet = found();
    await show();
    expect(asked).toEqual([`GET ${API}`]);
    await show(false);
    await show(true);
    expect(asked).toEqual([`GET ${API}`]);
  });

  it("reads again when the Bibliography changes, so a newly listed work cannot remain on screen", async () => {
    const before = {};
    const after = {};
    onGet = found();
    await show(true, before);
    onGet = found({ works: [NAT], excluded: 4 });
    await show(true, after);
    expect(asked).toEqual([`GET ${API}`, `GET ${API}`]);
    expect(host.querySelectorAll("li.rcp-related-row")).toHaveLength(1);
    expect(text()).not.toContain(NO_DOI.title);
  });

  it("counts the rows on the chip once the stored answer is read, and keeps it on another chip", async () => {
    onGet = found();
    await show();
    expect(chip()?.getAttribute("aria-label")).toBe("Not cited, 2 papers");
    await show(false);
    expect(chip()?.textContent).toBe("Not cited2");
  });
});

describe("each outcome is its own sentence", () => {
  it("says the bibliography comes first, and offers no button", async () => {
    onGet = { kind: "no-bibliography" };
    await show();
    expect(text()).toContain(RELATED_WORK_NO_BIBLIOGRAPHY);
    expect(button(RELATED_WORK_SEARCH)).toBeUndefined();
  });

  it("says there is nothing to search with, and offers no button", async () => {
    onGet = { kind: "no-query" };
    await show();
    expect(text()).toContain(RELATED_WORK_NO_QUERY);
    expect(button(RELATED_WORK_SEARCH)).toBeUndefined();
  });

  it("offers the search, with what it sends under it, when nobody has searched", async () => {
    await show();
    expect(text()).toContain(RELATED_WORK_NOT_SEARCHED);
    expect(button(RELATED_WORK_SEARCH)).toBeDefined();
    expect(text()).toContain(RELATED_WORK_SENDS);
    expect(posts()).toEqual([]);
  });

  it("says it is rate-limited, with no Try again", async () => {
    onGet = { kind: "rate-limited" };
    await show();
    expect(text()).toContain(RELATED_WORK_RATE_LIMITED);
    expect(button("Try again")).toBeUndefined();
  });

  it("offers Try again on a failed read, and reads again rather than searching", async () => {
    onGet = 500;
    await show();
    expect(text()).toContain(RELATED_WORK_UNAVAILABLE);
    onGet = { kind: "not-searched" };
    await press("Try again");
    expect(asked).toEqual([`GET ${API}`, `GET ${API}`]);
    expect(text()).toContain(RELATED_WORK_NOT_SEARCHED);
  });

  it("reads an answer that is not one of the route's as unavailable", async () => {
    onGet = { kind: "found", works: "nope" } as unknown as RelatedWorkResult;
    await show();
    expect(text()).toContain(RELATED_WORK_UNAVAILABLE);
  });

  it("does not claim an empty answer was all in the bibliography when OpenAlex may have found nothing but the piece itself", async () => {
    onGet = found({ works: [], excluded: 0 });
    await show();
    expect(text()).toContain(RELATED_WORK_NONE);
    expect(text()).toContain("No other papers remain to show");
    expect(text()).not.toContain("Everything OpenAlex found close to this piece is already among the works in its bibliography");
    expect(host.querySelectorAll("li.rcp-related-row")).toHaveLength(0);
    expect(button(RELATED_WORK_SEARCH_AGAIN)).toBeDefined();
  });
});

describe("a found list", () => {
  it("frames the list once, and no row says it is not cited", async () => {
    onGet = found();
    await show();
    expect(text()).toContain("2 papers found by OpenAlex's search on this piece's title and opening");
    expect(text()).toContain(RELATED_WORK_INTRO);
    expect(text().split(RELATED_WORK_INTRO)).toHaveLength(2);
    expect(text()).toContain("3 more it found are in the bibliography, and are left out.");
    expect(text()).toContain("Only work published in 2017 or before.");
    for (const row of host.querySelectorAll("li.rcp-related-row")) {
      expect(row.textContent?.toLowerCase()).not.toContain("not cited");
      expect(row.textContent?.toLowerCase()).not.toContain("should cite");
    }
  });

  it("draws each row: title linked to a new tab, authors with how many more, year, venue, cited-by, abstract", async () => {
    onGet = found();
    await show();
    const [first, second] = [...host.querySelectorAll<HTMLLIElement>("li.rcp-related-row")];
    const out = first?.querySelector<HTMLAnchorElement>("a.rcp-citer-title");
    expect(out?.getAttribute("href")).toBe("https://doi.org/10.48550/arxiv.1711.02281");
    expect(out?.target).toBe("_blank");
    expect(out?.rel).toBe("noreferrer noopener");
    expect(first?.querySelector(".rcp-meta")?.textContent).toBe(
      "Jiatao Gu, James Bradbury, Caiming Xiong +2 more · 2017 · ICLR · cited 506 times",
    );
    expect(first?.querySelector(".rcp-related-abstract")?.textContent).toBe(NAT.abstract);
    /* No DOI: OpenAlex's own page, built from the shape-checked id. */
    expect(second?.querySelector("a.rcp-citer-title")?.getAttribute("href")).toBe("https://openalex.org/W1234567");
    expect(second?.querySelector(".rcp-meta")).toBeNull();
    expect(second?.querySelector(".rcp-related-abstract")).toBeNull();
  });

  it("names the authors beyond the ones it holds", () => {
    expect(relatedAuthors({ authors: ["A", "B"], authorCount: 9 })).toBe("A, B +7 more");
    expect(relatedAuthors({ authors: ["A"], authorCount: 1 })).toBe("A");
    expect(relatedAuthors({ authors: [], authorCount: 4 })).toBeNull();
  });

  it("warns above the list when the bibliography is stale or capped", async () => {
    onGet = found({ bibliographyStale: true, bibliographyCapped: true });
    await show();
    const all = text();
    expect(all).toContain(RELATED_WORK_BIBLIOGRAPHY_STALE);
    expect(all).toContain(RELATED_WORK_BIBLIOGRAPHY_CAPPED);
    expect(all.indexOf(RELATED_WORK_BIBLIOGRAPHY_STALE)).toBeLessThan(all.indexOf(NAT.title));
  });

  it("draws no warning when the bibliography is current and whole", async () => {
    onGet = found();
    await show();
    expect(text()).not.toContain(RELATED_WORK_BIBLIOGRAPHY_STALE);
    expect(text()).not.toContain(RELATED_WORK_BIBLIOGRAPHY_CAPPED);
    expect(text()).not.toContain(RELATED_WORK_QUERY_CHANGED);
  });

  it("says the list is not limited by date when the piece's year is unknown", async () => {
    onGet = found({ yearLimited: null });
    await show();
    expect(text()).toContain("We do not know when this piece was published, so the list is not limited by date.");
  });

  it("says when the piece has changed since the search", async () => {
    onGet = found({ queryChanged: true });
    await show();
    expect(text()).toContain(RELATED_WORK_QUERY_CHANGED);
  });
});

describe("the press", () => {
  it("searches only when pressed, and draws what it found", async () => {
    await show();
    expect(posts()).toEqual([]);
    onPost = found();
    await press(RELATED_WORK_SEARCH);
    expect(posts()).toEqual([`POST ${API}`]);
    expect(host.querySelectorAll("li.rcp-related-row")).toHaveLength(2);
    expect(button(RELATED_WORK_SEARCH_AGAIN)).toBeDefined();
    expect(text()).toContain(RELATED_WORK_SENDS);
  });

  it("is held from the press until the answer is read, so two presses are one search", async () => {
    await show();
    let release = () => {};
    holdPost = { promise: new Promise<void>((done) => { release = done; }), release: () => release() };
    onPost = found();
    const search = button(RELATED_WORK_SEARCH);
    await act(async () => search?.click());
    await act(async () => search?.click());
    await settle();
    const held = button(RELATED_WORK_SEARCHING);
    expect(held, "the button says it is searching").toBeDefined();
    expect(held?.disabled).toBe(true);
    await act(async () => held?.click());
    expect(posts()).toEqual([`POST ${API}`]);
    await act(async () => holdPost?.release());
    await settle();
    expect(posts()).toEqual([`POST ${API}`]);
    expect(button(RELATED_WORK_SEARCH_AGAIN)?.disabled).toBe(false);
    expect(host.querySelectorAll("li.rcp-related-row")).toHaveLength(2);
  });

  it("keeps the list when Search again fails, and says why", async () => {
    onGet = found();
    await show();
    onPost = { kind: "unavailable" };
    await press(RELATED_WORK_SEARCH_AGAIN);
    expect(text()).toContain(RELATED_WORK_UNAVAILABLE);
    expect(host.querySelectorAll("li.rcp-related-row")).toHaveLength(2);
    onPost = { kind: "rate-limited" };
    await press(RELATED_WORK_SEARCH_AGAIN);
    expect(text()).toContain(RELATED_WORK_RATE_LIMITED);
    expect(host.querySelectorAll("li.rcp-related-row")).toHaveLength(2);
  });

  it("offers Try again after a failed first search, and Try again searches again", async () => {
    await show();
    onPost = 502;
    await press(RELATED_WORK_SEARCH);
    expect(text()).toContain(RELATED_WORK_UNAVAILABLE);
    onPost = found();
    await press("Try again");
    expect(posts()).toEqual([`POST ${API}`, `POST ${API}`]);
    expect(host.querySelectorAll("li.rcp-related-row")).toHaveLength(2);
  });
});
