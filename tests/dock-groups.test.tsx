// @vitest-environment jsdom
/**
 * **Which frame More and Comments stand in** — Greg, 2026-10-08:
 *
 * > I'm wondering if we could put those perhaps just after the skim mode, just
 * > after structure and summary as part of that group, rather than out on
 * > their own. And also, I wonder if we could put the comments icon inside a
 * > group with marginalia, perhaps after marginalia.
 *
 * (spya-mcs4gb; Skim joined Structure's run the same morning, spya-wm5gu2,
 * which tests/dock-mode-order.test.ts holds.) Both arms of the bar, because the
 * links arm is the half this bar keeps forgetting (Dock.tsx § `DockModeLinks`).
 * docs/plans/261008d-bottom-bar-groups-skim-and-more-join-structure-and-summary-comments-joins-marginalia.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODE_LABEL } from "../src/title-text.js";
import { Dock } from "../src/web/Dock.js";
import { moreTrigger } from "./helpers/dock-more.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/read/a-piece");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const DRAWER = {
  comments: [],
  paragraphs: new Map(),
  loaded: true,
  loadError: null,
  error: null,
  panel: null,
  onPanel: () => {},
  onOpenComment: () => {},
};

function reading(props: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the two arms of the bar differ by which props are present, the same cast tests/dock-more.test.tsx makes
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_OFF,
        drawer: DRAWER,
        ...props,
      }),
    );
  });
}

function loose(props: Record<string, unknown> = {}): void {
  history.replaceState(null, "", "/read/a-piece/metadata");
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as above
      createElement(Dock as any, { slug: "a-piece", view: "metadata", experimental: EXPERIMENTAL_OFF, ...props }),
    );
  });
}

/** Each frame's buttons and links, by accessible name, left to right. */
const frames = () =>
  [...host.querySelectorAll<HTMLElement>(".dock-modes .dock-frame")].map((f) =>
    [...f.querySelectorAll<HTMLElement>(".dock-btn")].map((b) => b.getAttribute("aria-label")),
  );

const L = MODE_LABEL;

describe("the reading view's frames", () => {
  it("draws More straight after Skim in Structure's frame, and Comments after Marginalia", () => {
    reading();
    expect(frames()).toEqual([
      [L.plain],
      [L.structure, L.summary, L.skim, "More", L["peer-review"], L.search, L.chat, L.learn],
      [L.marginalia, "Comments"],
    ]);
  });

  it("with the switch on, More still ends the shape run, after Diagram and Skim", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    expect(frames()[1]?.slice(0, 5)).toEqual([L.structure, L.summary, L.diagram, L.skim, "More"]);
  });

  it("a gathered mode drawn while open stands after More, as a run of its own", () => {
    reading({ mode: "glossary" });
    expect(frames()[1]).toEqual([L.structure, L.summary, L.skim, "More", L.glossary, L["peer-review"], L.search, L.chat, L.learn]);
    const glossary = host.querySelector(`[aria-label="${L.glossary}"]`) as HTMLElement;
    expect(glossary.classList.contains("dock-group-start")).toBe(true);
  });

  it("every gathered mode, open, stands straight after More, switch on or off", () => {
    for (const [experimental, modes] of [
      [EXPERIMENTAL_OFF, ["quotes", "glossary", "ideas"]],
      [EXPERIMENTAL_ON, ["quotes", "glossary", "faq", "ideas", "timeline"]],
    ] as const) {
      for (const mode of modes) {
        reading({ experimental, mode });
        const bands = frames()[1] ?? [];
        expect(bands[bands.indexOf("More") + 1], `${mode}, switch ${experimental.on}`).toBe(L[mode]);
        expect(bands[bands.indexOf("More") - 1], `${mode}, switch ${experimental.on}`).toBe(L.skim);
      }
    }
  });

  it("draws no line between Skim and More, and one after More", () => {
    reading();
    const more = moreTrigger(host) as HTMLElement;
    expect(more.classList.contains("dock-group-start")).toBe(false);
    const skim = host.querySelector(`[aria-label="${L.skim}"]`) as HTMLElement;
    expect(skim.classList.contains("dock-group-start")).toBe(false);
    const search = host.querySelector(`[aria-label="${L.search}"]`) as HTMLElement;
    expect(search.classList.contains("dock-group-start")).toBe(true);
  });

  it("More is still a menu button and never a radio", () => {
    reading();
    const more = moreTrigger(host) as HTMLElement;
    expect(more.getAttribute("role")).toBeNull();
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.hasAttribute("aria-checked")).toBe(false);
  });

  it("Comments is the drawer trigger, not a mode, and not in the radiogroup", () => {
    reading();
    const comments = host.querySelector<HTMLElement>('button[aria-label="Comments"]') as HTMLElement;
    expect(comments.closest('[role="radiogroup"]')).toBeNull();
    expect(comments.getAttribute("role")).toBeNull();
    /* Not a mode, so not `data-mode`: dock-fit.css's rung-2 rule gives an
       `.on` mode its word back, and Comments is `.on` while its drawer is
       open, which nothing remeasures (GPT Sol, PR-2). */
    expect(comments.hasAttribute("data-mode")).toBe(false);
    /* Exactly one Comments control in the bar: moved, not copied. */
    expect(host.querySelectorAll('[aria-label="Comments"]')).toHaveLength(1);
  });

  it("counts Comments in the shares a coarse pointer spreads the segment by", () => {
    reading();
    const modes = host.querySelector<HTMLElement>(".dock-modes") as HTMLElement;
    /* 8 radios (Peer review since 2026-10-09) + More + Marginalia + Comments. */
    expect(modes.style.getPropertyValue("--dock-mode-count")).toBe("11");
    const last = [...host.querySelectorAll<HTMLElement>(".dock-modes .dock-frame")].at(-1) as HTMLElement;
    expect(last.style.getPropertyValue("--dock-frame-count")).toBe("2");
  });
});

describe("off the reading view, the same frames as links", () => {
  it("draws More after Skim and the Comments link after Marginalia", () => {
    loose();
    expect(frames()).toEqual([
      [L.plain],
      [L.structure, L.summary, L.skim, "More", L["peer-review"], L.search, L.chat, L.learn],
      [L.marginalia, "Comments"],
    ]);
    const comments = host.querySelector<HTMLElement>('[aria-label="Comments"]') as HTMLElement;
    expect(comments.tagName).toBe("A");
  });
});
