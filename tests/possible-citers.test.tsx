// @vitest-environment jsdom
/**
 * **Possible citations, drawn** (plan 261026f, Stage 2): what `CitersAnswer`
 * says under a no-DOI or no-match answer once `useCiters` has handed it a
 * `possible` (tests/use-citers.test.tsx covers when it does). The failures
 * worth a test: the no-DOI "cannot" sentence drawn over a list, a count with
 * no rows drawn as nothing, the gate's or the empty search's sentence lost,
 * and a *See all* link that asks OpenAlex something other than the count did.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CitersAnswer } from "../src/web/ReceptionAndClaimsPanel.js";
import {
  CITERS_NO_DOI,
  CITERS_NO_MATCH,
  POSSIBLE_CITERS_COMMON_PHRASE,
  POSSIBLE_CITERS_LEAD,
  POSSIBLE_CITERS_NONE,
  POSSIBLE_CITERS_NO_ROWS,
  POSSIBLE_CITERS_PAPERS_ONLY,
} from "../src/messages.js";
import type { Citer, CitersResult, PossibleCiters } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function draw(result: CitersResult, shown = 3): void {
  act(() => root.render(createElement(CitersAnswer, { result, onRetry: () => {}, shown })));
}

const citer = (n: number): Citer => ({
  openalexId: `W${n}`,
  title: `Paper ${n}`,
  authors: ["A. Writer"],
  authorCount: 1,
  citedByCount: 0,
});

const found = (citers: Citer[], over: Partial<Extract<PossibleCiters, { kind: "found" }>> = {}): PossibleCiters => ({
  kind: "found",
  total: 134,
  dropped: 0,
  order: "newest",
  phrase: "do things that don't scale",
  fromYear: 2012,
  toYear: 2026,
  citers,
  ...over,
});

it("draws the plain sentence alone when there is no possible list", () => {
  draw({ kind: "no-doi" });
  expect(host.textContent).toBe(CITERS_NO_DOI);
  draw({ kind: "no-match", possible: { kind: "unavailable" } });
  expect(host.textContent).toBe(CITERS_NO_MATCH);
});

it("adds the gate's sentence, or the empty search's, under the plain one", () => {
  draw({ kind: "no-doi", possible: { kind: "common-phrase" } });
  expect(host.textContent).toBe(CITERS_NO_DOI + POSSIBLE_CITERS_COMMON_PHRASE);
  draw({ kind: "no-match", possible: { kind: "none" } });
  expect(host.textContent).toBe(CITERS_NO_MATCH + POSSIBLE_CITERS_NONE);
});

it("replaces the 'cannot' sentence with the lead, and lists the first rows with a count of the total", () => {
  draw({ kind: "no-doi", possible: found([citer(1), citer(2), citer(3), citer(4)]) });
  const text = host.textContent ?? "";
  expect(text).not.toContain(CITERS_NO_DOI);
  expect(text.startsWith(POSSIBLE_CITERS_LEAD)).toBe(true);
  /* Literal assertions rather than the message exports: changing the copy and
     its caller together must not silently turn possible matches into claims. */
  expect(host.querySelector(".rcp-possible-head")?.tagName).toBe("P");
  expect(host.querySelector(".rcp-possible-label")?.textContent).toBe("Possible citations");
  expect(text).not.toContain("Cited by");
  expect(text).toContain("we have not checked each one");
  expect(text).toContain("research papers only");
  expect(host.querySelector(".rcp-possible-count")?.textContent).toBe("4 of 134");
  expect(host.querySelector(".rcp-possible-order")?.textContent).toBe("newest first");
  expect([...host.querySelectorAll(".rcp-citer-title")].map((a) => a.textContent)).toEqual(["Paper 1", "Paper 2", "Paper 3"]);
  expect(text).toContain(POSSIBLE_CITERS_PAPERS_ONLY);
  const more = [...host.querySelectorAll("button")].find((b) => b.textContent === "Show all 4");
  expect(more).toBeDefined();
  act(() => more!.click());
  expect(host.querySelectorAll(".rcp-citer")).toHaveLength(4);
});

it("links See all to OpenAlex's search for the same phrase and inclusive year window, encoded", () => {
  draw({ kind: "no-doi", possible: found([citer(1)]) });
  const link = host.querySelector<HTMLAnchorElement>("a.rcp-possible-all");
  expect(link?.textContent).toBe("See all 134 at OpenAlex, a free index of research papers");
  const url = new URL(link!.href);
  expect(url.origin + url.pathname).toBe("https://openalex.org/works");
  expect(url.searchParams.get("filter")).toBe(`fulltext.search:"do things that don't scale",publication_year:2012-2026`);
  expect(link?.rel).toBe("noreferrer noopener");
  expect(link?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");

  draw({ kind: "no-doi", possible: found([citer(1)], { fromYear: null, toYear: null }) });
  const undated = new URL(host.querySelector<HTMLAnchorElement>("a.rcp-possible-all")!.href);
  expect(undated.searchParams.get("filter")).toBe(`fulltext.search:"do things that don't scale"`);
});

it("keeps the count and the link when no row could be shown", () => {
  draw({ kind: "no-match", possible: found([], { total: 7 }) });
  expect(host.querySelector(".rcp-possible-count")?.textContent).toBe("0 of 7");
  expect(host.textContent).toContain(POSSIBLE_CITERS_NO_ROWS);
  expect(host.querySelector("a.rcp-possible-all")).not.toBeNull();
  expect(host.querySelector(".rcp-possible-order")).toBeNull();
});
