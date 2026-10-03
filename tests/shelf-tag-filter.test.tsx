// @vitest-environment jsdom
/**
 * The shelf's Tags row — src/web/ShelfTagFilter.tsx, plan 261003d. The
 * narrowing itself is tests/shelf-narrow.test.ts § tagFacets; this is what is
 * drawn: nothing without tags, a zero hidden unless chosen, and a press that
 * names the tag.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfTagFilter } from "../src/web/ShelfTagFilter.js";
import { tagFacets } from "../src/web/shelf-narrow.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const facets = tagFacets([
  { slug: "a", tags: ["ai", "memory"] },
  { slug: "b", tags: ["ai"] },
]);

function paint(counts: Record<string, number>, selected: string[], onToggle = vi.fn()) {
  act(() => {
    root.render(
      createElement(ShelfTagFilter, {
        facets,
        counts: new Map(Object.entries(counts)),
        selected,
        onToggle,
        onClear: vi.fn(),
      }),
    );
  });
  return onToggle;
}

const chips = () => [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];

describe("ShelfTagFilter", () => {
  it("draws nothing when no article in scope has a tag", () => {
    act(() => {
      root.render(
        createElement(ShelfTagFilter, {
          facets: [],
          counts: new Map(),
          selected: [],
          onToggle: vi.fn(),
          onClear: vi.fn(),
        }),
      );
    });
    expect(host.innerHTML).toBe("");
  });

  it("hides a tag with nothing left to show, unless it is chosen", () => {
    paint({ ai: 2, memory: 0 }, []);
    expect(chips().map((c) => c.textContent)).toEqual(["ai2"]);
    paint({ ai: 0, memory: 0 }, ["memory"]);
    expect(chips().map((c) => c.getAttribute("aria-pressed"))).toEqual(["true"]);
  });

  it("toggles by the tag's key", () => {
    const onToggle = paint({ ai: 2, memory: 1 }, []);
    act(() => chips()[1]?.click());
    expect(onToggle).toHaveBeenCalledWith("memory");
  });
});
