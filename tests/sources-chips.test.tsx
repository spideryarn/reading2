// @vitest-environment jsdom
/**
 * **Sources' chips, three for the owner, and exactly one checked for every
 * address** — plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md,
 * decision 7 and GPT Sol's F2: Reception, Claims, Not cited and Investigate
 * stopped being chips and stayed addresses, so a radiogroup that compared the
 * raw view with each chip would check none of them on a tool's address.
 * `chipOf` is the one answer, and the row's `aria-checked`, `.on` and
 * `useRevealChosen` read it.
 *
 * Also here: what each chip and each address arms (activation.ts §
 * `activationForSources`, decisions 6 and 8, F4 and F5), and that a visitor's
 * row is the four chips it was (F3).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourcesHead } from "./helpers/sources-head.js";
import {
  activationForSources,
  bandTarget,
  pendingActivation,
  resetActivations,
  subModeTarget,
} from "../src/web/activation.js";
import {
  chipOf,
  SOURCES_CHIPS,
  SOURCES_VIEWS,
  type SourcesView,
  sourcesInSearch,
  sourcesParam,
  VISITOR_SOURCES_VIEWS,
  visitorSourcesView,
} from "../src/web/params.js";
import { SOURCES_SUB_MODES, subModeParams } from "../src/web/sub-modes.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const moved: SourcesView[] = [];

beforeEach(() => {
  moved.length = 0;
  resetActivations();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetActivations();
});

function draw(view: SourcesView, ownerSlug: string | null): void {
  act(() => root.render(sourcesHead({ view, onView: (v) => moved.push(v), ownerSlug })));
}
const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
/** Each chip's label, without its count. */
const labels = () => radios().map((r) => r.firstChild?.textContent);
const checked = () => radios().filter((r) => r.getAttribute("aria-checked") === "true");
const lit = () => radios().filter((r) => r.classList.contains("on"));

describe("the addresses and the chips", () => {
  it("has seven addresses and three owner chips, Where it sits first", () => {
    expect([...SOURCES_VIEWS]).toEqual(["where", "bibliography", "not-cited", "links", "reception", "claims", "investigate"]);
    expect([...SOURCES_CHIPS]).toEqual(["where", "bibliography", "links"]);
  });

  it("lights Where it sits for each of the four tools, and each chip for itself", () => {
    const expected: Record<SourcesView, SourcesView> = {
      where: "where",
      bibliography: "bibliography",
      links: "links",
      reception: "where",
      claims: "where",
      "not-cited": "where",
      investigate: "where",
    };
    for (const view of SOURCES_VIEWS) expect(chipOf(view), view).toBe(expected[view]);
  });

  it("defaults to Where it sits, leaves it off the address, and reads an unknown word as it", () => {
    expect(sourcesParam.defaultValue).toBe("where");
    expect(sourcesInSearch("")).toBe("where");
    expect(sourcesInSearch("?sources=nonsense")).toBe("where");
    expect(sourcesInSearch("?sources=bibliography")).toBe("bibliography");
    expect(subModeParams({ mode: "sources", view: "where" })).toEqual({ mode: "sources", sources: null });
    expect(subModeParams({ mode: "sources", view: "bibliography" })).toEqual({ mode: "sources", sources: "bibliography" });
  });

  it("gives a visitor Bibliography for the bare address, and the four chips they had", () => {
    expect(visitorSourcesView("where")).toBe("bibliography");
    expect([...VISITOR_SOURCES_VIEWS]).toEqual(["bibliography", "links", "reception", "claims"]);
  });
});

describe("the owner's chip row", () => {
  it.each(SOURCES_VIEWS.map((v) => [v]))("checks exactly one radio on ?sources=%s, the one chipOf names", (view) => {
    draw(view, "a-piece");
    expect(labels()).toEqual(["Where it sits", "Bibliography", "Links"]);
    expect(checked()).toHaveLength(1);
    expect(lit()).toHaveLength(1);
    /* Written out, not read from chipOf, so a wrong mapping turns this red too. */
    const lights = view === "bibliography" ? "Bibliography" : view === "links" ? "Links" : "Where it sits";
    expect(checked()[0]?.firstChild?.textContent).toBe(lights);
    expect(lit()[0]).toBe(checked()[0]);
  });

  it("moves to the chip pressed, and from a tool a press on Where it sits goes back to it", () => {
    draw("claims", "a-piece");
    act(() => radios()[0]?.click());
    expect(moved).toEqual(["where"]);
  });
});

describe("the visitor's chip row, unchanged", () => {
  it.each(SOURCES_VIEWS.map((v) => [v]))("checks exactly one radio on ?sources=%s", (view) => {
    draw(visitorSourcesView(view), null);
    expect(labels()).toEqual(["Bibliography", "Links", "Reception", "Claims"]);
    expect(checked()).toHaveLength(1);
    expect(checked()[0]?.textContent).toContain(SOURCES_SUB_MODES[visitorSourcesView(view)].label);
  });
});

describe("what a press arms (decisions 6 and 8)", () => {
  it("arms the citations for Where it sits and Bibliography, and nothing for any other", () => {
    const arms: Record<SourcesView, string | null> = {
      where: "bibliography",
      bibliography: "bibliography",
      links: null,
      "not-cited": null,
      reception: null,
      claims: null,
      investigate: null,
    };
    for (const view of SOURCES_VIEWS) {
      expect(activationForSources(view), view).toBe(arms[view]);
      /* The command bar's row and the band's boundary give the same answer. */
      expect(subModeTarget({ mode: "sources", view }), view).toBe(arms[view]);
      expect(
        bandTarget("sources", { diagram: "sketch", referee: "criteria", learn: "recall", summary: "brief", sources: view }),
        view,
      ).toBe(arms[view]);
    }
  });

  it("a press on the Where it sits chip arms Bibliography's list, and nothing paid", () => {
    draw("links", "a-piece");
    act(() => radios()[0]?.click());
    expect(pendingActivation("a-piece", "bibliography")).not.toBeNull();
    expect(pendingActivation("a-piece", "reception")).toBeNull();
    expect(pendingActivation("a-piece", "sources-claims")).toBeNull();
  });
});
