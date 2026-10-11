// @vitest-environment jsdom
/**
 * **Sources › Links, drawn** — LinksPanel.tsx and its chip. Plan
 * docs/plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md.
 *
 * The rows themselves are tests/outbound-links.test.ts; this is what a reader
 * sees of them: the chip's count and its spoken name, a row's link out, its
 * jumps, *In Bibliography*, the two empty sentences, and that a press on the
 * chip arms nothing.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourcesHead } from "./helpers/sources-head.js";
import type { BlockId } from "../src/types.js";
import { LINKS_NONE, LINKS_NONE_PDF, LinksPanel } from "../src/web/LinksPanel.js";
import { outboundLinks } from "../src/web/outbound-links.js";
import { activationForSources, subModeGenerates } from "../src/web/activation.js";
import type { SourcesView } from "../src/web/params.js";

const SELF = "https://essays.example/on-minds";
const BLOCKS = [
  { id: "spya-aaaaaa" as BlockId, html: '<p>See <a href="https://www.science.org/doi/10.1126/science.aan8871">the paper</a>.</p>' },
  { id: "spya-bbbbbb" as BlockId, html: '<p><a href="https://en.wikipedia.org/wiki/Panpsychism">panpsychism</a> and <a href="https://www.science.org/doi/10.1126/science.aan8871">Dehaene 2017</a></p>' },
];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function draw(props: { links: ReturnType<typeof outboundLinks>; fromPdf?: boolean; onOpenWork?: (id: string) => void; jumps?: BlockId[] }) {
  const jumps = props.jumps ?? [];
  act(() =>
    root.render(
      createElement(LinksPanel, {
        links: props.links,
        fromPdf: props.fromPdf ?? false,
        works: [{ id: "w1", url: "https://doi.org/10.1126/science.aan8871", linkFrom: "doi" }],
        head: sourcesHead({ view: "links", onView: () => {}, ownerSlug: null, links: props.links }),
        onJump: (id) => jumps.push(id),
        onOpenWork: props.onOpenWork ?? (() => {}),
      }),
    ),
  );
}

describe("LinksPanel", () => {
  it("draws one row per address, each title a link out to a new tab", () => {
    draw({ links: outboundLinks(BLOCKS, SELF) });
    const rows = host.querySelectorAll("li.link-item");
    expect(rows).toHaveLength(2);
    const out = rows[0]?.querySelector<HTMLAnchorElement>(".cite-title a");
    expect(out?.getAttribute("href")).toBe("https://www.science.org/doi/10.1126/science.aan8871");
    expect(out?.target).toBe("_blank");
    expect(out?.rel).toBe("noreferrer noopener");
    expect(out?.getAttribute("aria-label")).toBe("the paper — opens science.org in a new tab");
    expect(rows[0]?.textContent).toContain("also linked as “Dehaene 2017”");
    expect(rows[0]?.textContent).toContain("science.org · DOI 10.1126/science.aan8871");
    expect(rows[0]?.textContent).toContain("linked in 2 paragraphs");
  });

  it("offers In Bibliography on the row whose paper Bibliography lists, and opens that work", () => {
    const opened: string[] = [];
    draw({ links: outboundLinks(BLOCKS, SELF), onOpenWork: (id) => opened.push(id) });
    const rows = host.querySelectorAll("li.link-item");
    expect(rows[1]?.querySelector(".link-in-bib")).toBeNull();
    const press = rows[0]?.querySelector<HTMLButtonElement>(".link-in-bib");
    act(() => press?.click());
    expect(opened).toEqual(["w1"]);
  });

  it("counts the addresses on the chip, and says what it counts", () => {
    draw({ links: outboundLinks(BLOCKS, SELF) });
    const chip = [...host.querySelectorAll<HTMLButtonElement>("button[role=radio]")].find((b) => b.textContent?.startsWith("Links"));
    expect(chip?.getAttribute("aria-label")).toBe("Links, 2 addresses");
    expect(chip?.getAttribute("aria-checked")).toBe("true");
  });

  it("says a PDF has none only when it knows the piece is one", () => {
    draw({ links: [], fromPdf: true });
    expect(host.textContent).toContain(LINKS_NONE_PDF);
    draw({ links: [], fromPdf: false });
    expect(host.textContent).toContain(LINKS_NONE);
    expect(host.textContent).not.toContain("PDF");
  });
});

describe("a press on Links", () => {
  it("arms nothing and is not marked as starting work", () => {
    const view: SourcesView = "links";
    expect(activationForSources(view)).toBeNull();
    expect(subModeGenerates({ mode: "sources", view })).toBe(false);
  });
});
