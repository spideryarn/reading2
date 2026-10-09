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
import {
  CITE_NOT_READ,
  CITE_PAGE_FOUND,
  CITE_QUOTE_LABEL,
  CITE_VERDICT_LABEL,
  CITE_WHY_LABEL,
  citeReadAssessed,
  citeReadNotIdentified,
  verdictText,
} from "../src/web/CitationsPanel.js";
import {
  CITED_AT_JUMPS_SHOWN,
  type CiteActions,
  ProseHoverCard,
} from "../src/web/ProseHoverCard.js";
import { annotateHtml, citeMarks, termMarks } from "../src/web/annotate.js";
import { buildNoteIndex } from "../src/web/notes-view.js";
import {
  type Block,
  type BlockId,
  type CitedWork,
  type GlossaryEntry,
  MAX_MENTIONS,
} from "../src/types.js";
import { HOVER_DELAY } from "../src/web/useHoverCard.js";

/* Floating UI observes its reference element and jsdom has no ResizeObserver;
   without this the hook throws on the first open. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-p7w2dn" as BlockId;
const THREE = "spya-h4v8zr" as BlockId;
const REFS = "spya-m5n6p7" as BlockId;

const block = (id: BlockId, html: string): Block => {
  const text = html.replace(/<[^>]+>/g, "");
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html, gistable: true };
};

const BLOCKS: Block[] = [
  block(ONE, "<p>Context is reinstated at retrieval (Tulving 1983), and that matters.</p>"),
  block(TWO, "<p>Scaling laws followed (Kaplan et al 2020) soon after.</p>"),
  block(THREE, `<p>Compare <a href="#${ONE}">(Broadbent 1958)</a> above.</p>`),
  block(REFS, "<p>Example, A. (2001). A work listed only here.</p>"),
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

/** A citation whose own words are also the author's link into the article. */
const BROADBENT = work({
  id: "spya-j2k3m4",
  title: "Perception and Communication",
  authors: "Broadbent",
  year: "1958",
  mentions: [{ blockId: THREE, quote: "(Broadbent 1958)", start: 8 }],
  citedAt: [THREE],
  firstCited: THREE,
});

/** A first-class row with no body citation, marked only in the bibliography. */
const REFERENCE_ONLY = work({
  id: "spya-n2p3q4",
  title: "A work listed only here",
  authors: "Example",
  year: "2001",
  mentions: [],
  reference: { blockId: REFS, quote: "Example, A. (2001)", start: 0 },
  citedAt: [],
  firstCited: REFS,
  citedInBody: false,
});

const WORKS = [TULVING, KAPLAN, BROADBENT];

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
const aimed: { id: BlockId; aim: unknown }[] = [];
const openedTerms: string[] = [];

function Harness({
  works,
  entries,
  owner,
  citeActions = null,
}: {
  works: CitedWork[];
  entries: GlossaryEntry[];
  owner: boolean;
  citeActions?: CiteActions | null;
}) {
  /* Both scans, and then concatenated per block — which is what `TableView`
     does, and is the only way to get the merged `<mark class="term cite">` the
     overlap case is about. Computing only one of them would have made that test
     pass or fail for a reason that has nothing to do with the card. */
  const cites = citeMarks(BLOCKS, [
    ...works.map((w) => ({
      id: w.id,
      places: [...w.mentions, ...(w.reference ? [w.reference] : [])].map((p) => ({
        blockId: p.blockId,
        quote: p.quote,
      })),
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
        showInSpideryarn={owner}
        termActions={null}
        citeActions={citeActions}
        onOpenTerm={(id) => openedTerms.push(id)}
        onJump={(id, aim) => {
          jumped.push(id);
          if (aim !== undefined) aimed.push({ id, aim });
        }}
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

/** A complete touch tap, including the compatibility click that can navigate. */
function tap(target: Element): MouseEvent {
  const fire = (type: string, at: Element | Document, bubbles = true): MouseEvent => {
    const event = new MouseEvent(type, {
      bubbles,
      cancelable: true,
      clientX: 10,
      clientY: 10,
      detail: 1,
    });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "isPrimary", { value: true });
    at.dispatchEvent(event);
    return event;
  };

  let click!: MouseEvent;
  act(() => {
    fire("pointerover", target);
    fire("pointerdown", target);
    fire("pointerup", target);
    fire("pointerout", target);
    fire("pointerleave", document, false);
    fire("mouseup", target);
    click = fire("click", target);
  });
  return click;
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

function paint(
  works: CitedWork[] = WORKS,
  entries: GlossaryEntry[] = [],
  owner = true,
  citeActions: CiteActions | null = null,
): void {
  act(() => root.render(<Harness works={works} entries={entries} owner={owner} citeActions={citeActions} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  jumped.length = 0;
  aimed.length = 0;
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
  it("draws the work: its title, who wrote it and when, and nothing of ours about it", () => {
    paint();
    expect(card()).toBe(null);
    hover(cite(0));
    const text = card()?.textContent ?? "";
    expect(text).toContain("Elements of Episodic Memory");
    expect(text).toContain("Tulving");
    expect(text).toContain("1983");
    /* Until 2026-10-03 the card also drew `why`, the one line that was ours
       rather than the author's. Greg, spya-zmdb7y: it restates the citing
       paragraph and reads as what the paper says, so it waits for a check
       (plan 261003j; "what the card says after Look it up" has that half). */
    expect(text).not.toContain("The piece takes its account of retrieval cues from it.");
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
    expect(card()?.querySelector(".prose-card-cite-jumps .prose-card-cite-where")?.textContent).toBe(
      "cited in 1 paragraph",
    );
    /* And cited only in the paragraph the reader is in, there is nowhere to
       jump: no lone unlinked "1", and no "and 1 more" (plan 261009e). */
    expect(card()?.querySelectorAll(".prose-card-cite-jump")).toHaveLength(0);
    expect(card()?.textContent).not.toMatch(/more/);
  });

  it("calls a bibliography-only work only in the references, not cited in zero paragraphs", () => {
    paint([REFERENCE_ONLY]);
    hover(cite(0));
    expect(card()?.textContent).toMatch(/only in the references/i);
    expect(card()?.textContent).not.toMatch(/cited in 0 paragraphs/i);
    expect(card()?.querySelector(".prose-card-cite-jumps")).toBeNull();
  });

  it("keeps an internal article link's second-tap jump when its words are a citation", () => {
    paint();
    const linked = cite(2);
    expect(linked.closest("a")?.getAttribute("href")).toBe(`#${ONE}`);

    const first = tap(linked);
    expect(first.defaultPrevented).toBe(true);
    expect(card()).not.toBeNull();
    expect(jumped).toEqual([]);

    const second = tap(linked);
    expect(second.defaultPrevented).toBe(true);
    expect(jumped).toEqual([ONE]);
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

/* Plan 260929g stage 1: the card says what the band says about whether we read
   the work, from the same strings, so the two surfaces cannot drift. */
describe("what the card says we have read", () => {
  const read = () => card()?.querySelector(".prose-card-cite-read")?.textContent;

  it("says we have not read the work, and labels why as the article's", () => {
    paint();
    hover(cite(0));
    expect(read()).toBe(CITE_NOT_READ);
    /* Nothing the model wrote about the work, until something was checked
       against it (Greg, spya-zmdb7y, plan 261003j). */
    expect(card()?.querySelector(".prose-card-part-why .prose-card-label")).toBeNull();
    expect(card()?.textContent).not.toContain(TULVING.why);
    /* A searched row too: a Scholar search is not the work either. */
    hover(cite(1));
    expect(read()).toBe(CITE_NOT_READ);
  });

  it("after Find it, says only that a page matching the title was found", () => {
    const found: CitedWork = {
      ...KAPLAN,
      url: "https://arxiv.org/abs/2001.08361",
      linkFrom: "web",
      found: { title: "Scaling Laws", host: "arxiv.org", searches: 1, model: "test", at: "2026-09-29T09:00:00.000Z" },
    };
    paint([TULVING, found, BROADBENT]);
    hover(cite(1));
    expect(read()).toBe(CITE_PAGE_FOUND);
    expect(read()).not.toMatch(/verif|confirm|from the (paper|work)/i);
  });
});

/* Plan 260929g stage 2 — Greg's *"in the tool tip"*: after *Look it up*, the
   card says the band's line for the lookup's state and, when an extract was
   assessed, the verdict labelled as the AI's reading plus one quote labelled as
   the extract's. No button: a press that spends money does not belong on a
   surface that opens because a pointer rested. */
describe("what the card says after Look it up", () => {
  const read = () => card()?.querySelector(".prose-card-cite-read")?.textContent;
  const base = {
    host: "arxiv.org",
    searches: 1,
    model: "test",
    at: "2026-09-29T09:00:00.000Z",
    contextHash: "ctx",
    evidenceHash: "ev",
  };
  const SUPPORT = "we find that loss scales as a power law with model size";
  const DOES = "we study empirical scaling laws for language model performance";

  it("shows the verdict as the AI's reading, and the first quote as the extract's", () => {
    const looked: CitedWork = {
      ...TULVING,
      lookup: {
        ...base,
        state: "assessed",
        excerptWords: 310,
        verdict: { support: "partly", quote: SUPPORT },
        paperDoes: { says: "It measures how loss falls as models grow.", quote: DOES },
      },
    };
    paint([looked, KAPLAN, BROADBENT]);
    hover(cite(0));
    expect(read()).toBe(citeReadAssessed(310, "arxiv.org"));
    /* The claim the verdict is about, labelled as the article's. */
    expect(card()?.querySelector(".prose-card-part-why .prose-card-label")?.textContent).toBe(CITE_WHY_LABEL);
    expect(card()?.querySelector(".prose-card-part-why .prose-card-text")?.textContent).toBe(TULVING.why);
    const verdict = card()?.querySelector(".prose-card-cite-verdict");
    expect(verdict?.querySelector(".prose-card-label")?.textContent).toBe(CITE_VERDICT_LABEL);
    expect(verdict?.querySelector(".prose-card-cite-verdict-text")?.textContent).toBe(verdictText("partly"));
    const quotes = [...(card()?.querySelectorAll(".prose-card-cite-quote") ?? [])];
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.querySelector("blockquote")?.textContent).toContain(SUPPORT);
    expect(quotes[0]?.querySelector("figcaption")?.textContent).toBe(CITE_QUOTE_LABEL);
    /* No button on the card. */
    expect(card()?.querySelector("button.cite-find")).toBeNull();
    expect(card()?.textContent).not.toMatch(/Look it up/);
  });

  it("falls back to what the work does, with its quote, when the extract doesn't show the claim", () => {
    const looked: CitedWork = {
      ...TULVING,
      lookup: {
        ...base,
        state: "assessed",
        excerptWords: 120,
        verdict: { support: "not-in-extract" },
        paperDoes: { says: "It measures how loss falls as models grow.", quote: DOES },
      },
    };
    paint([looked, KAPLAN, BROADBENT]);
    hover(cite(0));
    const said = card()?.querySelector(".prose-card-cite-verdict-text")?.textContent ?? "";
    expect(said).toBe(verdictText("not-in-extract"));
    expect(said).not.toMatch(/does not support|doesn't support/i);
    const quotes = [...(card()?.querySelectorAll(".prose-card-cite-quote") ?? [])];
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.querySelector("blockquote")?.textContent).toContain(DOES);
    expect(card()?.querySelector(".prose-card-cite-does")?.textContent).toContain(
      "It measures how loss falls as models grow.",
    );
  });

  it("says a lookup that read nothing read nothing, and shows no verdict", () => {
    paint([{ ...TULVING, lookup: { ...base, state: "not-identified" } }, KAPLAN, BROADBENT]);
    hover(cite(0));
    expect(read()).toBe(citeReadNotIdentified("arxiv.org"));
    expect(card()?.querySelector(".prose-card-cite-verdict")).toBeNull();
    expect(card()?.querySelector(".prose-card-cite-quote")).toBeNull();
  });

  /* Plan 260930a § UI: a kept *Dig deeper* answer lives in the band, not on the
     hover card. The button is the card's since 261004b; see the next describe. */
  it("shows nothing of Investigate, even on a work that has a kept answer", () => {
    const investigated: CitedWork = {
      ...TULVING,
      investigation: {
        answer: "Does it back the claim?\nA DISTINCTIVE INVESTIGATION SENTENCE.",
        sources: [{ url: "https://arxiv.org/abs/1" }],
        extractsRead: 1,
        longestExtractWords: 10,
        matchedHost: null,
        searches: 1,
        searchesFrom: "x",
        model: "test",
        at: "2026-09-30T09:00:00.000Z",
        contextHash: "ctx",
        promptVersion: "1",
      },
    };
    paint([investigated, KAPLAN, BROADBENT]);
    hover(cite(0));
    expect(card()).not.toBeNull();
    expect(card()?.textContent).not.toMatch(/DISTINCTIVE INVESTIGATION|Investigat/);
    /* So no claim either: the card draws nothing that was checked against it. */
    expect(card()?.textContent).not.toContain(TULVING.why);
    expect(card()?.querySelector(".cite-investigate, .cite-inv")).toBeNull();
  });
});

/* Plan 261001i: the band's "already an article here" line, on the card too. */
describe("the card says when the work is already an article here", () => {
  it("draws the band's line, linking to our page in this tab", () => {
    const owned: CitedWork = {
      ...TULVING,
      inSpideryarn: { slug: "old-spya-k2m3n4", whose: "yours", matchedBy: "doi", title: "My copy", archived: true },
    };
    paint([owned, KAPLAN, BROADBENT]);
    hover(cite(0));
    const a = card()?.querySelector<HTMLAnchorElement>(".cite-here a");
    expect(a?.textContent).toBe("In your library · archived");
    expect(a?.getAttribute("href")).toBe("/read/old-spya-k2m3n4");
    expect(a?.getAttribute("target")).toBeNull();
    expect(a?.title).toContain("the same DOI");
    /* And nothing on a work that is not here. */
    hover(cite(1));
    expect(card()?.querySelector(".cite-here")).toBeNull();
  });

  it("says an upload's match is by the id we found, and a public one is on the public shelf", () => {
    const upload: CitedWork = {
      ...TULVING,
      inSpideryarn: { slug: "pdf-spya-p5q6r7", whose: "yours", matchedBy: "guessed-id", title: "My PDF" },
    };
    paint([upload, KAPLAN, BROADBENT]);
    hover(cite(0));
    const a = card()?.querySelector<HTMLAnchorElement>(".cite-here a");
    expect(a?.textContent).toBe("In your library");
    expect(a?.title).toContain("we found for your uploaded PDF");

    const shared: CitedWork = {
      ...TULVING,
      inSpideryarn: { slug: "theirs-spya-d5e6f7", whose: "public", matchedBy: "title", title: "As shared" },
    };
    paint([shared, KAPLAN, BROADBENT]);
    hover(cite(0));
    expect(card()?.querySelector(".cite-here a")?.textContent).toBe("On the public shelf");
    expect(card()?.querySelector(".cite-here-how")?.textContent).toContain("As shared");
  });

  it("draws nothing for a non-owner, even from a payload that carries the field", () => {
    /* The public DTO cannot name the field; this models a wire payload that
       broke that type, so the card's own lock is pinned independently. */
    const leaked: CitedWork = {
      ...TULVING,
      inSpideryarn: { slug: "private-spya-g8h9j2", whose: "yours", matchedBy: "doi", title: "Private copy" },
    };
    paint([leaked, KAPLAN, BROADBENT], [], false);
    hover(cite(0));
    expect(card()).not.toBeNull();
    expect(card()?.querySelector(".cite-here")).toBeNull();
    expect(card()?.textContent).not.toContain("Private copy");
  });
});


/* Report `spya-c2qmbg`, Greg, 2026-10-03: *"What I was hoping is that it would
   have a button for dig deeper in the tooltip."* Plan 261004b. */
describe("Dig deeper from the card", () => {
  const INVESTIGATION: NonNullable<CitedWork["investigation"]> = {
    answer: "A kept answer.",
    sources: [{ url: "https://arxiv.org/abs/1" }],
    extractsRead: 1,
    longestExtractWords: 10,
    matchedHost: null,
    searches: 1,
    searchesFrom: "x",
    model: "test",
    at: "2026-09-30T09:00:00.000Z",
    contextHash: "ctx",
    promptVersion: "1",
  };
  const button = () =>
    [...(card()?.querySelectorAll("button") ?? [])].find((b) => /dig/i.test(b.textContent ?? "")) as
      | HTMLButtonElement
      | undefined;
  const actions = (over: Partial<CiteActions> = {}): CiteActions & { dug: string[] } => {
    const dug: string[] = [];
    return { dig: (id) => dug.push(id), digging: null, ...over, dug };
  };

  it("starts the dig for that work, and closes the card", () => {
    const a = actions();
    paint(WORKS, [], true, a);
    hover(cite(0));
    expect(button()?.textContent).toBe("Dig deeper");
    act(() => button()?.click());
    expect(a.dug).toEqual([TULVING.id]);
    expect(card()).toBe(null);
  });

  it("keeps the Scholar search beside it on a row the article gave no link for", () => {
    paint(WORKS, [], true, actions());
    hover(cite(1));
    expect(button()).toBeDefined();
    expect(card()?.querySelector('a[href*="scholar.google.com"]')?.textContent).toContain("search Scholar");
  });

  it("says again on a work that has a kept answer", () => {
    paint([{ ...TULVING, investigation: INVESTIGATION }, KAPLAN, BROADBENT], [], true, actions());
    hover(cite(0));
    expect(button()?.textContent).toBe("Dig deeper again");
  });

  it("is disabled while any dig runs, and says so on the work being dug", () => {
    const a = actions({ digging: KAPLAN.id });
    paint(WORKS, [], true, a);
    hover(cite(0));
    expect(button()?.disabled).toBe(true);
    expect(button()?.textContent).toBe("Dig deeper");
    act(() => button()?.click());
    expect(a.dug).toEqual([]);
    paint(WORKS, [], true, actions({ digging: TULVING.id }));
    expect(button()?.textContent).toBe("Digging deeper…");
    expect(button()?.disabled).toBe(true);
  });

  it("is not drawn without the owner's actions", () => {
    paint(WORKS, [], false, null);
    hover(cite(0));
    expect(card()).not.toBeNull();
    expect(button()).toBeUndefined();
  });
});

/* Greg, 2026-10-09 (spya-tsd470): *"jump back from the list of references to
   the places where it's cited."* Plan 261009e. */
describe("from the card, back to every passage that cites the work", () => {
  /** Tulving with its bibliography entry marked, cited in ONE, TWO and THREE. */
  const TULVING_LISTED: CitedWork = {
    ...TULVING,
    reference: { blockId: REFS, quote: "Example, A. (2001)", start: 0 },
  };
  const jumps = () => [...(card()?.querySelectorAll<HTMLElement>(".prose-card-cite-jump") ?? [])];
  const refMark = () => host.querySelector(`tr[data-block="${REFS}"] mark.cite`) as HTMLElement;

  it("from the reference entry, links every citing paragraph in document order", () => {
    paint([TULVING_LISTED]);
    hover(refMark());
    expect(card()?.textContent).toMatch(/cited in 3 paragraphs/i);
    const links = jumps();
    expect(links.map((a) => a.tagName)).toEqual(["A", "A", "A"]);
    expect(links.map((a) => a.getAttribute("data-block-link"))).toEqual([ONE, TWO, THREE]);
    expect(links.map((a) => a.querySelector(".prose-card-cite-jump-number")?.textContent)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(links.map((a) => a.textContent)).toEqual([
      "1Citing paragraph 1 of 3",
      "2Citing paragraph 2 of 3",
      "3Citing paragraph 3 of 3",
    ]);
    /* A real address, so a modified click or a copied link still works. */
    expect(links[1]?.getAttribute("href")).toContain(`at=${TWO}`);
  });

  it("a press jumps aimed at the work's own citing words, and closes the card", () => {
    paint([TULVING_LISTED]);
    hover(refMark());
    const second = jumps()[1];
    expect(second).toBeDefined();
    act(() => {
      second?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(jumped).toEqual([TWO]);
    expect(aimed).toEqual([{ id: TWO, aim: `cite:${TULVING.id}` }]);
    expect(card()).toBeNull();
  });

  it("a first touch opens the card and one touch on a number jumps once and closes it", () => {
    paint([TULVING_LISTED]);
    tap(refMark());
    expect(card()).not.toBeNull();
    expect(jumped).toEqual([]);

    const second = jumps()[1];
    expect(second).toBeDefined();
    const click = tap(second!);
    expect(click.defaultPrevented).toBe(true);
    expect(jumped).toEqual([TWO]);
    expect(aimed).toEqual([{ id: TWO, aim: `cite:${TULVING.id}` }]);
    expect(card()).toBeNull();
  });

  it("from a body mention, leaves the paragraph you are in unlinked", () => {
    paint([TULVING_LISTED]);
    hover(cite(0)); // "(Tulving 1983)" in ONE
    const [first, ...rest] = jumps();
    expect(first?.tagName).toBe("SPAN");
    expect(first?.getAttribute("aria-current")).toBe("location");
    expect(first?.textContent).toMatch(/citing paragraph 1 of 3, this paragraph/i);
    expect(rest.map((a) => a.getAttribute("data-block-link"))).toEqual([TWO, THREE]);
  });

  it(`lists at most ${CITED_AT_JUMPS_SHOWN} and says how many more, with the count exact`, () => {
    const many = Array.from({ length: CITED_AT_JUMPS_SHOWN + 5 }, (_, i) => `spya-zz${String(i).padStart(4, "0")}` as BlockId);
    paint([{ ...TULVING_LISTED, citedAt: many }]);
    hover(refMark());
    expect(card()?.textContent).toMatch(new RegExp(`cited in ${CITED_AT_JUMPS_SHOWN + 5} paragraphs`));
    expect(jumps()).toHaveLength(CITED_AT_JUMPS_SHOWN);
    expect(card()?.textContent).toMatch(/and 5 more/);
  });

  it("past the cap, the paragraph you are in is simply not listed, and every listed number links", () => {
    const many = Array.from({ length: CITED_AT_JUMPS_SHOWN + 2 }, (_, i) => `spya-zz${String(i).padStart(4, "0")}` as BlockId);
    paint([{ ...TULVING_LISTED, citedAt: [...many, ONE] }]);
    hover(cite(0)); // in ONE, which is last
    expect(jumps()).toHaveLength(CITED_AT_JUMPS_SHOWN);
    expect(jumps().every((el) => el.tagName === "A")).toBe(true);
    expect(card()?.textContent).toMatch(/and 3 more/);
  });

  it(`says "at least" when the work has the most direct mentions we keep (${MAX_MENTIONS})`, () => {
    /* A work cited directly in the text keeps at most MAX_MENTIONS mentions,
       so a fourth citing paragraph is not in citedAt (GPT Sol, plan review). */
    const mentions = [ONE, TWO, THREE].map((blockId) => ({ blockId, quote: "x", start: 0 }));
    paint([{ ...TULVING_LISTED, mentions: [TULVING.mentions[0]!, ...mentions.slice(1)] }]);
    hover(refMark());
    expect(card()?.querySelector(".prose-card-cite-jumps .prose-card-cite-where")?.textContent).toBe(
      "cited in at least 3 paragraphs",
    );
  });

  it("keeps an exact count for a note-expanded work with no direct mentions", () => {
    paint([{ ...TULVING_LISTED, mentions: [], citedAt: [ONE, TWO, THREE] }]);
    hover(refMark());
    expect(card()?.querySelector(".prose-card-cite-jumps .prose-card-cite-where")?.textContent).toBe(
      "cited in 3 paragraphs",
    );
  });

  it("uses at least conservatively when the mention cap is reached within one paragraph", () => {
    const mentions = Array.from({ length: MAX_MENTIONS }, (_, start) => ({
      blockId: ONE,
      quote: `citation ${start + 1}`,
      start,
    }));
    paint([{ ...TULVING_LISTED, mentions, citedAt: [ONE] }]);
    hover(refMark());
    expect(card()?.querySelector(".prose-card-cite-jumps .prose-card-cite-where")?.textContent).toBe(
      "cited in at least 1 paragraph",
    );
  });

  it("keeps the card open while the keyboard moves into it, cancelling a pending pointer close", () => {
    paint([TULVING_LISTED]);
    hover(refMark());
    const first = jumps()[0];
    act(() => {
      pointer("pointerover", host);
      first?.focus();
    });
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY.close * 2);
    });
    expect(card(), "focus entering the card closed it").not.toBeNull();
  });

  it("closes after focus leaves the card for browser chrome", () => {
    paint([TULVING_LISTED]);
    hover(refMark());
    const first = jumps()[0];
    act(() => {
      first?.focus();
      first?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    });
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY.close * 2);
    });
    expect(card(), "the card stayed open after focus left the document").toBeNull();
  });
});
