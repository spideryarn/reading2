/**
 * The judge for an upload's guessed web address — src/source-guess.ts.
 *
 * The one safety property: a found page is kept only if code has shown it is
 * this paper. Every row below that says "no" is a way a plausible page could
 * be the wrong one — a cited work, a sequel, a namesake — and a wrong link is
 * worse than none, because the reader will cite it.
 *
 * docs/plans/260929g-canonical-link-for-an-uploaded-paper.md § What counts as "an exact match".
 */
import { describe, expect, it } from "vitest";

import { isSamePaper, type PaperIdentityInput, paperIdentity, type SourceCandidate } from "../src/source-guess.js";

const TITLE = "Sparse Mixtures of Reasoning Experts for Long Document Retrieval";

const OPENING =
  "Retrieval over long documents remains difficult because relevant evidence is scattered across " +
  "distant sections and dense encoders compress each passage into a single vector. We propose a " +
  "sparse mixture of reasoning experts in which a lightweight router assigns every query to a small " +
  "number of specialised retrievers, each trained on a distinct kind of inference such as temporal " +
  "ordering, numerical comparison or causal attribution. The experts share a frozen backbone and " +
  "differ only in low rank adapters, so the whole system adds fewer than two percent parameters. " +
  "Across four benchmarks of scientific articles, legal contracts and technical manuals the method " +
  "improves recall at ten by between six and eleven points over the strongest dense baseline, while " +
  "halving latency relative to cross encoder reranking. Ablations show that routing decisions are " +
  "interpretable and that most gains come from queries requiring multi hop information integration.";

const OTHER_ABSTRACT =
  "Coral reefs in shallow tropical waters are exposed to repeated marine heatwaves, and bleaching " +
  "events have become more frequent over the past three decades. We surveyed forty reef sites along " +
  "a latitudinal gradient and recorded coral cover, juvenile recruitment and symbiont community " +
  "composition before and after two consecutive warm seasons. Sites with higher water flow retained " +
  "more live cover and recovered faster, and colonies hosting heat tolerant symbionts showed lower " +
  "mortality. These results suggest that local hydrodynamics and symbiont shuffling jointly buffer " +
  "reefs against thermal stress, which has implications for selecting protected areas.";

function input(over: Partial<PaperIdentityInput> = {}): PaperIdentityInput {
  return {
    title: TITLE,
    filename: "smre-final.pdf",
    authors: [
      { name: "Ana Müller", affiliations: [] },
      { name: "Wei Zhang", affiliations: [] },
    ],
    firstPagesText: `${TITLE}\nAna Müller, Wei Zhang\nhttps://doi.org/10.1234/SMRE.2024.001\n${OPENING}`,
    opening: OPENING,
    ...over,
  };
}

function identity(over: Partial<PaperIdentityInput> = {}) {
  const id = paperIdentity(input(over));
  if (!id) throw new Error("expected an identity");
  return id;
}

function candidate(over: {
  url?: string;
  format?: "html" | "pdf";
  text?: string;
  title?: string;
  meta?: SourceCandidate["read"]["meta"];
  resultUrl?: string;
  resultTitle?: string;
}): SourceCandidate {
  const url = over.url ?? "https://example.org/paper";
  return {
    read: {
      url,
      format: over.format ?? "html",
      text: over.text ?? `${TITLE}. Ana Muller and Wei Zhang. Abstract. ${OPENING}`,
      ...(over.title !== undefined ? { title: over.title } : {}),
      ...(over.meta !== undefined ? { meta: over.meta } : {}),
    },
    result: {
      url: over.resultUrl ?? url,
      ...(over.resultTitle !== undefined ? { title: over.resultTitle } : {}),
    },
  };
}

describe("paperIdentity", () => {
  it("is null for a title that fell back to the filename", () => {
    expect(
      paperIdentity(input({ title: "Sparse_Mixtures-of-Reasoning Experts", filename: "sparse_mixtures-of-reasoning experts.PDF" })),
    ).toBeNull();
  });

  it("is null for a title of fewer than three significant words", () => {
    expect(paperIdentity(input({ title: "Transformer Models Revisited" }))).not.toBeNull();
    // "The" is not a significant word, so this is two.
    expect(paperIdentity(input({ title: "The Transformer Revisited" }))).toBeNull();
  });

  it("reads identifiers from the raw first pages and the upload's meta, normalised", () => {
    const id = identity({
      firstPagesText: "Preprint. arXiv:2401.01234v1 [cs.CL] and DOI 10.1234/SMRE.2024.001.",
      uploadMeta: { doi: "10.5555/Other" },
    });
    expect(id.dois.sort()).toEqual(["10.1234/smre.2024.001", "10.5555/other"]);
    expect(id.arxivs).toEqual(["2401.01234"]);
  });
});

describe("isSamePaper", () => {
  it("DOI agreement passes, with the canonical doi.org address", () => {
    const verdict = isSamePaper(
      identity(),
      candidate({ title: TITLE, meta: { doi: "10.1234/smre.2024.001", authors: ["Müller, Ana"] }, text: "Paywalled abstract only." }),
    );
    expect(verdict).toEqual({ same: true, matchedBy: "doi", canonicalUrl: "https://doi.org/10.1234/smre.2024.001" });
  });

  it("arXiv agreement passes from the URL, with the abs address and no version", () => {
    const verdict = isSamePaper(
      identity({ firstPagesText: `${TITLE}\narXiv:2401.01234v1 [cs.IR] 3 Jan 2024` }),
      candidate({
        url: "https://arxiv.org/pdf/2401.01234v2",
        format: "pdf",
        resultUrl: "https://arxiv.org/abs/2401.01234v2",
        resultTitle: `[2401.01234] ${TITLE}`,
        text: `${TITLE}\nAna Müller Wei Zhang\nAbstract\nSomething rewritten entirely for version two.`,
      }),
    );
    expect(verdict).toEqual({ same: true, matchedBy: "arxiv", canonicalUrl: "https://arxiv.org/abs/2401.01234" });
  });

  it("a perfect title and identifier with the wrong first author is not this paper", () => {
    const verdict = isSamePaper(
      identity(),
      candidate({
        title: TITLE,
        meta: { doi: "10.1234/smre.2024.001", authors: ["Jones, Peter"] },
        text: "Peter Jones. A paper with a very different author list.",
      }),
    );
    expect(verdict).toEqual({ same: false, why: "author-mismatch" });
  });

  it("a cited work whose DOI is in the upload's first pages, but whose title differs, is not this paper", () => {
    const id = identity({
      firstPagesText: `${TITLE}\nAna Müller\n... as shown by Müller (2019), doi:10.9999/cited.2019.7 ...`,
    });
    const verdict = isSamePaper(
      id,
      candidate({
        url: "https://doi.org/10.9999/cited.2019.7",
        title: "Dense Passage Retrieval for Open Domain Question Answering",
        meta: { doi: "10.9999/cited.2019.7", authors: ["Müller, Ana"] },
      }),
    );
    expect(verdict).toEqual({ same: false, why: "title-mismatch" });
  });

  it("a title that only overlaps — a subset or a superset — is not exact", () => {
    const meta = { doi: "10.1234/smre.2024.001", authors: ["Ana Müller"] };
    const superset = isSamePaper(identity(), candidate({ title: `${TITLE}: Extended Version`, meta }));
    const subset = isSamePaper(identity(), candidate({ title: "Sparse Mixtures of Reasoning Experts", meta }));
    expect(superset).toEqual({ same: false, why: "title-mismatch" });
    expect(subset).toEqual({ same: false, why: "title-mismatch" });
  });

  it("an upload with no authors needs its text to agree: a cited work's DOI and an exact title are not enough", () => {
    const authorless = identity({
      authors: [],
      firstPagesText: `${TITLE}\n... following earlier work (doi:10.9999/cited.2019.7) ...`,
    });
    const verdict = isSamePaper(
      authorless,
      candidate({ title: TITLE, meta: { doi: "10.9999/cited.2019.7" }, text: `${TITLE} ${OTHER_ABSTRACT}` }),
    );
    expect(verdict).toEqual({ same: false, why: "no-agreement" });
  });

  it("an upload with no authors, whose text and DOI both agree, is still labelled by its DOI", () => {
    const authorless = identity({ authors: [] });
    const verdict = isSamePaper(authorless, candidate({ title: TITLE, meta: { doi: "10.1234/smre.2024.001" } }));
    expect(verdict).toEqual({ same: true, matchedBy: "doi", canonicalUrl: "https://doi.org/10.1234/smre.2024.001" });
  });

  it("an upload with no authors passes on its text alone", () => {
    const authorless = identity({ authors: [], firstPagesText: TITLE });
    const verdict = isSamePaper(authorless, candidate({ title: TITLE }));
    expect(verdict).toEqual({ same: true, matchedBy: "content", canonicalUrl: null });
  });

  it("a search result's title matches once arXiv's [id] prefix is removed", () => {
    const verdict = isSamePaper(
      identity({ firstPagesText: `${TITLE}\narXiv:2401.01234` }),
      candidate({ url: "https://arxiv.org/abs/2401.01234", resultTitle: `[2401.01234] ${TITLE}`, text: "Ana Müller" }),
    );
    expect(verdict).toEqual({ same: true, matchedBy: "arxiv", canonicalUrl: "https://arxiv.org/abs/2401.01234" });
  });

  it("the content branch passes over line-break hyphens and ligatures", () => {
    // Every long word broken across a line, as pdf.js leaves them: unmended,
    // well over half the shingles would differ.
    const mangled = OPENING.replace("differ", "diﬀer")
      .replace("benchmarks of scientific", "benchmarks of scientiﬁc")
      .replace(/(\p{L}{4})(\p{L}{4,})/gu, "$1- $2");
    const verdict = isSamePaper(
      identity({ firstPagesText: `${TITLE}\nAna Müller` }),
      candidate({ url: "https://muller.example.edu/smre.html", title: TITLE, text: `${TITLE} Ana Müller ${mangled}` }),
    );
    expect(verdict).toEqual({ same: true, matchedBy: "content", canonicalUrl: null });
  });

  it("the content branch fails on a different abstract", () => {
    const verdict = isSamePaper(
      identity({ firstPagesText: `${TITLE}\nAna Müller` }),
      candidate({ title: TITLE, text: `${TITLE} Ana Müller ${OTHER_ABSTRACT}` }),
    );
    expect(verdict).toEqual({ same: false, why: "no-agreement" });
  });

  it("the content branch cannot pass on too short an opening", () => {
    const short = "Retrieval over long documents remains difficult.";
    const verdict = isSamePaper(
      identity({ firstPagesText: TITLE, opening: short }),
      candidate({ title: TITLE, text: `${TITLE} Ana Müller ${short}` }),
    );
    expect(verdict).toEqual({ same: false, why: "no-agreement" });
  });

  it("a conflicting DOI is a no, even when the text agrees", () => {
    const verdict = isSamePaper(
      identity(),
      candidate({ title: TITLE, meta: { doi: "10.4321/someone.else", authors: ["Ana Müller"] } }),
    );
    expect(verdict).toEqual({ same: false, why: "identifier-conflict" });
  });

  it("a conflicting arXiv id is a no, even when the text agrees", () => {
    const verdict = isSamePaper(
      identity({ firstPagesText: `${TITLE}\narXiv:2401.01234v1` }),
      candidate({ url: "https://arxiv.org/pdf/2402.09999v1", format: "pdf" }),
    );
    expect(verdict).toEqual({ same: false, why: "identifier-conflict" });
  });

  it("a PDF with no title passes the title rule when its text opens with the title", () => {
    const verdict = isSamePaper(
      identity({ firstPagesText: `${TITLE}\nAna Müller` }),
      candidate({ url: "https://muller.example.edu/smre.pdf", format: "pdf" }),
    );
    expect(verdict).toEqual({ same: true, matchedBy: "content", canonicalUrl: null });
  });

  it("a PDF with no title whose text does not open with the title fails the title rule", () => {
    const verdict = isSamePaper(
      identity({ firstPagesText: `${TITLE}\nAna Müller` }),
      candidate({
        url: "https://muller.example.edu/smre.pdf",
        format: "pdf",
        text: `${"Lorem ipsum dolor sit amet ".repeat(30)} ${TITLE} Ana Müller ${OPENING}`,
      }),
    );
    expect(verdict).toEqual({ same: false, why: "title-mismatch" });
  });

  it("a candidate with no title at all fails the title rule", () => {
    const verdict = isSamePaper(identity(), candidate({ meta: { doi: "10.1234/smre.2024.001" } }));
    expect(verdict).toEqual({ same: false, why: "title-mismatch" });
  });
});
