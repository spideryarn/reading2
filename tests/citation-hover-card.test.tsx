// @vitest-environment jsdom
/**
 * **Point at a citation and the work appears** — the second half of
 * SPIDERYARN-READING2-3M, Greg, 2026-09-12:
 *
 * > with tooltip/clickable, that pops up a panel for the citation with various
 * > useful information & actions
 *
 * tests/citation-marks.test.ts proves the marks land on the right characters.
 * Every one of those could be right while a reader saw nothing, so this mounts
 * the real `ProseHoverCard` over the markup `annotateHtml` produces and asks
 * what a reader would: rest on the phrase, and is the work there.
 *
 * The harness is tests/note-preview-card.test.tsx's, which is the other suite
 * that drives this component by events.
 *
 * ## The assertion that earns its keep
 *
 * **A `search` row is drawn as a search, and never as the work's address.**
 * That is the one safety property Citations mode has
 * (docs/project/citations.md § The one safety property): the model never
 * supplies a URL we keep, and where we could not be sure the row offers a
 * Google Scholar *search* rather than a link that might be to the wrong paper.
 * The band already holds that property (tests/citations-panel.test.tsx). This
 * card is a second surface drawing the same fact, and two surfaces drawing
 * provenance differently is exactly the failure worth pinning — a reader who
 * learns the rule from the band and meets a different one here has been taught
 * something false.
 *
 * What this cannot prove is that any of it is *legible* — the width of the
 * card, whether a long `why` wraps, whether the dashed rule reads as apparatus.
 * Those are a browser's answer and are listed as unverified in the plan.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProseHoverCard } from "../src/web/ProseHoverCard.js";
import { annotateHtml, citeMarks, termMarks } from "../src/web/annotate.js";
import { buildNoteIndex } from "../src/web/notes-view.js";
import type { Block, BlockId, CitedWork, GlossaryEntry } from "../src/types.js";

/* Floating UI observes its reference element and jsdom has no ResizeObserver;
   without this the hook throws on the first open. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-p7w2dn" as BlockId;

const block = (id: BlockId, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

const BLOCKS: Block[] = [
  block(ONE, "<p>Context is reinstated at retrieval (Tulving 1983), and that matters.</p>"),
  block(TWO, "<p>Scaling laws followed (Kaplan et al 2020) soon after.</p>"),
];

function work(over: Partial<CitedWork> & Pick<CitedWork, "id" | "title">): CitedWork {
  return {
    key: `work:${over.title}`,
    why: "What the piece uses it for.",
    mentions: [],
    citedAt: [ONE],
    firstCited: ONE,
    citedInBody: true,
    url: "https://doi.org/10.1000/xyz",
    linkFrom: "doi",
    ...over,
  };
}

/** The article gave a DOI, so the row is an address and the title is a link. */
const TULVING = work({
  id: "spya-a2b3c4",
  title: "Elements of Episodic Memory",
  authors: "Tulving",
  year: "1983",
  why: "The piece takes its account of retrieval cues from it.",
  mentions: [{ blockId: ONE, quote: "(Tulving 1983)", start: 40 }],
  citedAt: [ONE, TWO, "spya-h4v8zr" as BlockId],
});

/** The article gave nothing, so the row is a Scholar SEARCH and not an address. */
const KAPLAN = work({
  id: "spya-d5e6f7",
  title: "Scaling Laws for Neural Language Models",
  authors: "Kaplan et al",
  year: "2020",
  why: "Cited for the exponent, not for the method.",
  mentions: [{ blockId: TWO, quote: "(Kaplan et al 2020)", start: 22 }],
  citedAt: [TWO],
  url: "https://scholar.google.com/scholar?q=Scaling+Laws",
  linkFrom: "search",
});

const WORKS = [TULVING, KAPLAN];

/** One glossary entry over the same phrase as a citation, for the overlap case. */
const TERM: GlossaryEntry = {
  id: "spya-g8h9j2",
  name: "Tulving",
  kind: "person",
  aliases: [],
  blocks: [ONE],
  senseHere: "The psychologist whose account of episodic memory the piece leans on.",
};

const jumped: BlockId[] = [];
const openedTerms: string[] = [];

function Harness({ works, entries }: { works: CitedWork[]; entries: GlossaryEntry[] }) {
  /* Both scans, and then concatenated per block — which is what `TableView`
     does, and is the only way to get the merged `<mark class="term cite">` the
     overlap case is about. Computing only one of them would have made that test
     pass or fail for a reason that has nothing to do with the card. */
  const cites = citeMarks(BLOCKS, [
    ...works.map((w) => ({
      id: w.id,
      places: w.mentions.map((p) => ({ blockId: p.blockId, quote: p.quote })),
    })),
  ]);
  const terms = termMarks(
    BLOCKS,
    entries.map((e) => ({ id: e.id, forms: [e.name, ...e.aliases], blocks: e.blocks })),
  );
  const marksFor = (id: BlockId) => [...(terms.get(id) ?? []), ...(cites.get(id) ?? [])];
  return (
    <>
      <table>
        <tbody>
          {BLOCKS.map((b) => (
            <tr key={b.id} data-block={b.id}>
              <td>
                <div
                  className="prose"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: standing in for TableView
                  dangerouslySetInnerHTML={{ __html: annotateHtml(b.html, marksFor(b.id)) }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ProseHoverCard
        entries={entries}
        works={works}
        slug={null}
        sourceUrl={null}
        blockText={new Map(BLOCKS.map((b) => [b.id, b.text]))}
        notes={buildNoteIndex([])}
        lookUpLinks={false}
        canAddToShelf={false}
        onOpenTerm={(id) => openedTerms.push(id)}
        onJump={(id) => jumped.push(id)}
        onFollowNote={() => {}}
      />
    </>
  );
}

function pointer(type: string, target: Element): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  target.dispatchEvent(event);
}

/** Rest the pointer on something for long enough to open a card. */
function hover(target: Element): void {
  act(() => {
    pointer("pointerover", target);
  });
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

let host: HTMLDivElement;
let root: Root;

function paint(works: CitedWork[] = WORKS, entries: GlossaryEntry[] = []): void {
  act(() => root.render(<Harness works={works} entries={entries} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  jumped.length = 0;
  openedTerms.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const card = () => document.querySelector(".prose-card");
const cite = (n: number) => host.querySelectorAll("mark.cite")[n] as HTMLElement;

describe("resting on a citation", () => {
  it("draws the work: its title, who wrote it and when, and what the piece uses it for", () => {
    paint();
    expect(card()).toBe(null);
    hover(cite(0));
    const text = card()?.textContent ?? "";
    expect(text).toContain("Elements of Episodic Memory");
    expect(text).toContain("Tulving");
    expect(text).toContain("1983");
    /* The one line that is ours rather than the author's — Fable, 2026-09-16:
       "That is the augmentation; the citation itself is the author's." */
    expect(text).toContain("The piece takes its account of retrieval cues from it.");
  });

  it("links a work the article gave an address for, and says where the address came from", () => {
    paint();
    hover(cite(0));
    const link = card()?.querySelector<HTMLAnchorElement>("a[href^='https://doi.org']");
    expect(link, "the DOI row draws no link out").not.toBeNull();
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    /* The provenance, as the band draws it: an address shows its host and its
       rule, so a reader can always tell one the article gave from one we built. */
    expect(card()?.textContent).toContain("doi.org");
  });

  it("DRAWS A SEARCH AS A SEARCH, never as the work's address", () => {
    /* The one safety property, held on this surface as well as in the band.
       `KAPLAN` has `linkFrom: "search"`, so its `url` is a Google Scholar query
       and not the paper: presenting it as the work's own address would be the
       card claiming we found something we did not. */
    paint();
    hover(cite(1));
    const text = card()?.textContent ?? "";
    expect(text).toContain("Scaling Laws for Neural Language Models");
    expect(text).toContain("search Scholar");
    /* The title is NOT a link — the band's rule, and the reason is that a link
       on the title would read as the work's own page. */
    const titleLink = card()?.querySelector(".prose-card-cite-title a");
    expect(titleLink, "the searched row's title is a link, which claims too much").toBeNull();
    /* And nothing anywhere in the card presents the Scholar query as the work. */
    expect(card()?.querySelector("a[href^='https://doi.org']")).toBeNull();
  });

  it("says how many paragraphs cite the work, which is the gap the marks cannot close", () => {
    /* `mentions` is capped at three and `citedAt` is not, so beyond three we
       know only which paragraph. The honest answer is words rather than a mark
       on a paragraph we cannot place — Fable, 2026-09-16. */
    paint();
    hover(cite(0));
    expect(card()?.textContent).toMatch(/cited in 3 paragraphs/i);
    hover(cite(1));
    /* Singular, because one is a real answer and "1 paragraphs" is the sort of
       thing a reader notices and we do not. */
    expect(card()?.textContent).toMatch(/cited in 1 paragraph\b/i);
  });

  it("draws both halves where a citation and a glossary term share the phrase", () => {
    /* One <mark> carrying both classes (annotate.ts § MarkKind), so this is not
       a hypothetical pairing — a cited author who is also a glossary entry is
       the ordinary case in a paper. The card composes, the way it already does
       for a term inside a link. */
    paint(WORKS, [TERM]);
    /* **No fallback here, deliberately.** The first draft read
       `querySelector("mark.term.cite") ?? cite(0)`, and with a harness that had
       forgotten to compute the term marks at all it would have hovered a
       citation-only mark and reported a missing term section as a bug in the
       card. A test that quietly substitutes a different subject when it cannot
       find its own is the shape this repo keeps meeting. */
    const both = host.querySelector("mark.term.cite");
    expect(both, "the two marks did not merge into one element").not.toBeNull();
    hover(both as HTMLElement);
    const text = card()?.textContent ?? "";
    expect(text).toContain("The psychologist whose account of episodic memory");
    expect(text).toContain("Elements of Episodic Memory");
  });

  it("opens no card for an id the list does not have", () => {
    /* The stale case and the forged one at once: the prose can outlive the list
       it was marked from, and `data-cite` is an attribute an article could ship
       if the sanitiser ever stopped stripping it. Either way the id resolves to
       nothing, and a card about nothing is worse than no card. */
    paint([]);
    /* With no works there are no marks at all, which is the first half. */
    expect(host.querySelector("mark.cite")).toBeNull();

    /* The second half: a mark whose id is not in the list. Written by hand,
       because `citeMarks` cannot produce one. */
    const row = host.querySelector("tr[data-block] .prose") as HTMLElement;
    row.innerHTML = `<p>A claim <mark class="cite" data-cite="spya-zzzzzz">(Nobody 1999)</mark> here.</p>`;
    hover(row.querySelector("mark.cite") as HTMLElement);
    expect(card()).toBe(null);
  });
});
