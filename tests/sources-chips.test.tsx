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
  it("has ten addresses and four owner chips, Where it sits first and Digest beside it", () => {
    expect([...SOURCES_VIEWS]).toEqual([
      "where", "digest", "bibliography", "not-cited", "links", "reception", "claims", "investigate", "guess-first", "evidence-first",
    ]);
    expect([...SOURCES_CHIPS]).toEqual(["where", "digest", "bibliography", "links"]);
  });

  it("lights Where it sits for each of the four tools and the two experiments, and each chip for itself", () => {
    const expected: Record<SourcesView, SourcesView> = {
      where: "where",
      digest: "digest",
      bibliography: "bibliography",
      links: "links",
      reception: "where",
      claims: "where",
      "not-cited": "where",
      investigate: "where",
      "guess-first": "where",
      "evidence-first": "where",
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

  it("gives a visitor Bibliography for the bare address and the experiments, and the four chips they had", () => {
    expect(visitorSourcesView("where")).toBe("bibliography");
    /* The digest is the owner's (plan 261030b, F3): a shared address draws Bibliography. */
    expect(visitorSourcesView("digest")).toBe("bibliography");
    expect(visitorSourcesView("guess-first")).toBe("bibliography");
    expect(visitorSourcesView("evidence-first")).toBe("bibliography");
    expect([...VISITOR_SOURCES_VIEWS]).toEqual(["bibliography", "links", "reception", "claims"]);
  });
});

describe("the owner's chip row", () => {
  it.each(SOURCES_VIEWS.map((v) => [v]))("checks exactly one radio on ?sources=%s, the one chipOf names", (view) => {
    draw(view, "a-piece");
    /* The switch is off here, so Digest is drawn only on its own address. */
    expect(labels()).toEqual(
      view === "digest" ? ["Where it sits", "Digest", "Bibliography", "Links"] : ["Where it sits", "Bibliography", "Links"],
    );
    expect(checked()).toHaveLength(1);
    expect(lit()).toHaveLength(1);
    /* Written out, not read from chipOf, so a wrong mapping turns this red too. */
    const lights =
      view === "bibliography" ? "Bibliography" : view === "links" ? "Links" : view === "digest" ? "Digest" : "Where it sits";
    expect(checked()[0]?.firstChild?.textContent).toBe(lights);
    expect(lit()[0]).toBe(checked()[0]);
  });

  it("moves to the chip pressed, and from a tool a press on Where it sits goes back to it", () => {
    draw("claims", "a-piece");
    act(() => radios()[0]?.click());
    expect(moved).toEqual(["where"]);
  });
});

describe("the Digest chip, behind the experimental switch (plan 261030b, F7)", () => {
  const drawWith = (view: SourcesView, experimental: boolean) =>
    act(() => root.render(sourcesHead({ view, onView: (v) => moved.push(v), ownerSlug: "a-piece", experimental })));

  it("is hidden with the switch off, on every address but its own", () => {
    drawWith("where", false);
    expect(labels()).not.toContain("Digest");
    drawWith("links", false);
    expect(labels()).not.toContain("Digest");
  });

  it("is drawn and lit on a pasted ?sources=digest with the switch off", () => {
    drawWith("digest", false);
    expect(labels()).toContain("Digest");
    expect(checked().map((r) => r.firstChild?.textContent)).toEqual(["Digest"]);
  });

  it("is drawn second with the switch on, and its press arms the digest's own step and nothing else", () => {
    drawWith("where", true);
    expect(labels()).toEqual(["Where it sits", "Digest", "Bibliography", "Links"]);
    act(() => radios()[1]?.click());
    expect(moved).toEqual(["digest"]);
    expect(pendingActivation("a-piece", "sources-digest")).not.toBeNull();
    expect(pendingActivation("a-piece", "sources-where")).toBeNull();
    expect(pendingActivation("a-piece", "bibliography")).toBeNull();
  });

  it("is behind the switch in the command bar too", () => {
    expect(SOURCES_SUB_MODES.digest.experimental).toBe(true);
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
  it("arms the citations for Bibliography, Where it sits' two for it, and nothing for any other", () => {
    const arms: Record<SourcesView, string | null> = {
      /* The works cited and the search of the literature, behind one token (plan 261026g § Stage 4). */
      where: "sources-where",
      /* Its own step, on the press (plan 261030b). */
      digest: "sources-digest",
      bibliography: "bibliography",
      links: null,
      "not-cited": null,
      reception: null,
      claims: null,
      investigate: null,
      /* The experiments read the stored dossier and start nothing (plan 261025h, Stage 4). */
      "guess-first": null,
      "evidence-first": null,
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

  it("a press on the Where it sits chip arms its own target, and nothing for the tools", () => {
    draw("links", "a-piece");
    act(() => radios()[0]?.click());
    expect(pendingActivation("a-piece", "sources-where")).not.toBeNull();
    expect(pendingActivation("a-piece", "bibliography")).toBeNull();
    expect(pendingActivation("a-piece", "reception")).toBeNull();
    expect(pendingActivation("a-piece", "sources-claims")).toBeNull();
  });
});
