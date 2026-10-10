/**
 * Matching a cited work to an article already here — src/cited-in-spideryarn.ts.
 * Which articles may be candidates at all, and which of a stranger's URLs, is
 * the store's business, pinned in tests/cited-in-spideryarn-pg.test.ts; this is
 * only identity.
 *
 * docs/plans/260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md.
 */
import { describe, expect, it } from "vitest";

import {
  authorsAgree,
  type CitedCandidate,
  identityOf,
  matchCited,
  matchOf,
  withCitedInSpideryarn,
} from "../src/cited-in-spideryarn.js";
import type { BlockId, Bibliography, CitedWork } from "../src/types.js";

const BLOCK = "spya-b2dy3k" as BlockId;
const TITLE = "Scaling Laws for Neural Language Models";

function work(over: Partial<CitedWork> = {}): CitedWork {
  return {
    id: "spya-w2rk3a",
    key: "work:x",
    title: TITLE,
    authors: "Kaplan, J.; McCandlish, S.",
    year: "2020",
    why: "The loss falls as a power law.",
    mentions: [],
    citedAt: [BLOCK],
    firstCited: BLOCK,
    citedInBody: true,
    url: "https://scholar.google.com/scholar?q=x",
    linkFrom: "search",
    ...over,
  };
}

function candidate(over: Partial<CitedCandidate> = {}): CitedCandidate {
  return {
    slug: "other-spya-aaaaaa",
    mine: true,
    urls: [],
    matchTitle: null,
    displayTitle: null,
    byline: null,
    archived: false,
    guessedUrl: null,
    ...over,
  };
}

const ARXIV_WORK = work({ url: "https://arxiv.org/abs/2001.08361", linkFrom: "arxiv" });
const DOI_WORK = work({ url: "https://doi.org/10.1038/Nature14539", linkFrom: "doi" });

describe("identityOf", () => {
  it("reads a DOI or arXiv id off the address that is one, by host", () => {
    expect(identityOf("https://doi.org/10.1038/Nature14539")).toEqual({ doi: "10.1038/nature14539" });
    expect(identityOf("https://dx.doi.org/10.1038/nature14539")).toEqual({ doi: "10.1038/nature14539" });
    expect(identityOf("https://arxiv.org/pdf/2001.08361v2")).toEqual({ arxiv: "2001.08361" });
    expect(identityOf("http://export.arxiv.org/abs/2001.08361")).toEqual({ arxiv: "2001.08361" });
  });

  it("does not take an identifier that is merely somewhere in the URL", () => {
    expect(identityOf("https://journals.example.org/article?id=10.1038/nature14539")).toEqual({});
    expect(identityOf("https://example.org/?next=https://arxiv.org/abs/2001.08361")).toEqual({});
    expect(identityOf("https://arxiv.org.evil.example/abs/2001.08361")).toEqual({});
    expect(identityOf("https://notarxiv.org/abs/2001.08361")).toEqual({});
    expect(identityOf("not a url")).toEqual({});
  });

  it("requires the canonical host's whole path to identify the work", () => {
    expect(identityOf("https://doi.org/redirect/10.1038/nature14539")).toEqual({});
    expect(identityOf("https://doi.org:8443/10.1038/nature14539")).toEqual({});
    expect(identityOf("https://arxiv.org/redirect/arxiv.org/abs/2001.08361")).toEqual({});
    expect(identityOf("https://arxiv.org/abs/2001.08361/another-paper")).toEqual({});
    expect(identityOf("https://arxiv.org/pdf/2001.08361v2.pdf")).toEqual({ arxiv: "2001.08361" });
  });
});

describe("identityOf — a page about an arXiv paper is the arXiv paper", () => {
  /* docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md
     § The arXiv mirrors are arXiv. The id comes from the registry
     (src/paper-sources.ts § arxivIdOf), so a shape learned there is known here. */
  it.each([
    "https://huggingface.co/papers/2001.08361",
    "https://huggingface.co/papers/2001.08361v2",
    "https://alphaxiv.org/abs/2001.08361",
    "https://www.alphaxiv.org/abs/2001.08361v2",
    "https://www.alphaxiv.org/overview/2001.08361",
    "https://browse.arxiv.org/abs/2001.08361",
    "https://arxiv.org/format/2001.08361",
  ])("gives %s what it gives the arXiv address", (url) => {
    expect(identityOf(url)).toEqual({ arxiv: "2001.08361" });
    expect(identityOf(url)).toEqual(identityOf("https://arxiv.org/abs/2001.08361"));
  });

  it("still reads an old-style id, an encoded slash and a trailing dot on the host, as it did", () => {
    expect(identityOf("https://arxiv.org/abs/hep-th/9901001v2")).toEqual({ arxiv: "hep-th/9901001" });
    expect(identityOf("https://arxiv.org/abs/hep-th%2F9901001")).toEqual({ arxiv: "hep-th/9901001" });
    expect(identityOf("https://arxiv.org./abs/2001.08361")).toEqual({ arxiv: "2001.08361" });
    expect(identityOf("https://ARXIV.org/ABS/2001.08361V3")).toEqual({ arxiv: "2001.08361" });
  });

  it("still calls arXiv's own DOI a DOI, so a work keyed by it goes on matching", () => {
    expect(identityOf("https://doi.org/10.48550/arXiv.2001.08361")).toEqual({ doi: "10.48550/arxiv.2001.08361" });
  });

  it("takes nothing from a mirror's other pages, a look-alike host, or an id hidden behind an escape", () => {
    for (const url of [
      "https://huggingface.co/papers",
      "https://huggingface.co/papers/trending",
      "https://huggingface.co/openai/whisper-large-v3",
      "https://huggingface.co/papers/2001.08361/discussion",
      "https://huggingface.co.evil.example/papers/2001.08361",
      "https://huggingface.co:8443/papers/2001.08361",
      "https://alphaxiv.org/",
      "https://notalphaxiv.org/abs/2001.08361",
      "https://arxiv.org/abs/2001.08361%3Fx",
      "https://arxiv.org/abs/2001.08361%23x",
      "https://arxiv.org/abs%5C2001.08361",
      "https://arxiv.org/abs/2001.08361%2Fextra",
    ]) {
      expect(identityOf(url), url).toEqual({});
    }
  });
});

describe("matchOf", () => {
  it("matches a work cited by its Hugging Face or alphaXiv page to the article stored under arXiv's PDF", () => {
    /* End to end, the way Citations meets it: the article linked the mirror
       page, so the work's link is that page (`linkFrom: "article"`), and the
       article we hold was fetched from the PDF the arXiv source names. */
    const held = candidate({ urls: ["https://arxiv.org/pdf/2001.08361"] });
    for (const url of [
      "https://huggingface.co/papers/2001.08361",
      "https://www.alphaxiv.org/abs/2001.08361",
      "https://www.alphaxiv.org/overview/2001.08361v2",
    ]) {
      const cited = work({ url, linkFrom: "article" });
      expect(matchOf(cited, held), url).toBe("arxiv");
      expect(matchOf(cited, candidate({ urls: ["https://arxiv.org/pdf/2001.08361v3"] })), url).toBe("arxiv");
      expect(matchOf(cited, candidate({ urls: ["https://arxiv.org/pdf/2001.08362"] })), url).toBeNull();
      expect(matchOf(cited, candidate({ guessedUrl: "https://arxiv.org/abs/2001.08361" })), url).toBe("guessed-id");
    }
    /* And the other way round: the article we hold was added by its mirror page. */
    expect(matchOf(ARXIV_WORK, candidate({ urls: ["https://huggingface.co/papers/2001.08361"] }))).toBe("arxiv");
    /* A Hugging Face page that is not a paper stays an address. */
    const model = work({ url: "https://huggingface.co/openai/whisper-large-v3", linkFrom: "article" });
    expect(matchOf(model, held)).toBeNull();
    expect(matchOf(model, candidate({ urls: ["https://huggingface.co/openai/whisper-large-v3"] }))).toBe("address");
  });

  it("matches an arXiv work to an article fetched from its PDF, any version", () => {
    expect(matchOf(ARXIV_WORK, candidate({ urls: ["https://arxiv.org/pdf/2001.08361v2"] }))).toBe("arxiv");
    expect(matchOf(ARXIV_WORK, candidate({ urls: ["https://arxiv.org/abs/2001.08362"] }))).toBeNull();
  });

  it("matches a DOI work to an article at its doi.org address, case aside", () => {
    expect(matchOf(DOI_WORK, candidate({ urls: ["https://doi.org/10.1038/nature14539"] }))).toBe("doi");
    expect(matchOf(DOI_WORK, candidate({ urls: ["https://doi.org/10.1038/nature14540"] }))).toBeNull();
  });

  it("does not match a DOI carried in somebody's query string", () => {
    const c = candidate({ urls: ["https://journals.example.org/article?id=10.1038/nature14539"] });
    expect(matchOf(DOI_WORK, c)).toBeNull();
  });

  it("matches an article-given address to the same request target, and only that", () => {
    const w = work({ url: "https://gwern.net/scaling-hypothesis", linkFrom: "article" });
    expect(matchOf(w, candidate({ urls: ["https://gwern.net/scaling-hypothesis#top"] }))).toBe("address");
    /* `sameTarget`, unchanged: http and https are two pages, as everywhere else. */
    expect(matchOf(w, candidate({ urls: ["http://gwern.net/scaling-hypothesis"] }))).toBeNull();
    expect(matchOf(w, candidate({ urls: ["https://gwern.net/other"] }))).toBeNull();
  });

  it("never treats a Scholar search as the work's address", () => {
    const w = work({ title: "Short", url: "https://scholar.google.com/scholar?q=x" });
    expect(matchOf(w, candidate({ urls: ["https://scholar.google.com/scholar?q=x"] }))).toBeNull();
  });

  it("matches the same extracted title, punctuation and case aside", () => {
    expect(matchOf(work(), candidate({ matchTitle: "scaling laws for neural language models." }))).toBe("title");
  });

  it("never matches on the reader's rename, which is a label, not an identity", () => {
    const renamed = candidate({ matchTitle: "Something the page called itself", displayTitle: TITLE });
    expect(matchOf(work(), renamed)).toBeNull();
  });

  it("does not match a title too short to be evidence of identity", () => {
    const bare = {};
    expect(matchOf(work({ title: "Introduction", ...bare }), candidate({ matchTitle: "Introduction" }))).toBeNull();
    expect(matchOf(work({ title: "On AI", ...bare }), candidate({ matchTitle: "On AI" }))).toBeNull();
  });

  it("takes a three-word title only when the authors positively agree", () => {
    const short = work({ title: "The Bitter Lesson", authors: "Sutton, R." });
    expect(matchOf(short, candidate({ matchTitle: "The Bitter Lesson", byline: "Rich Sutton" }))).toBe("title");
    expect(matchOf(short, candidate({ matchTitle: "The Bitter Lesson" }))).toBeNull();
    const { authors: _gone, ...anonymous } = short;
    expect(matchOf(anonymous, candidate({ matchTitle: "The Bitter Lesson", byline: "Rich Sutton" }))).toBeNull();
  });

  it("keeps Part 1 and Part 2 apart", () => {
    const w = work({ title: "Learning Systems, Part 1" });
    expect(matchOf(w, candidate({ matchTitle: "Learning Systems, Part 2" }))).toBeNull();
  });

  it("refuses a title match the authors contradict, and allows one they support", () => {
    expect(matchOf(work(), candidate({ matchTitle: TITLE, byline: "Jane Smith" }))).toBeNull();
    expect(matchOf(work(), candidate({ matchTitle: TITLE, byline: "Jared Kaplan, Sam McCandlish" }))).toBe("title");
  });
});

describe("an upload, by the identifier we found for it (plan 261001i)", () => {
  const upload = (over: Partial<CitedCandidate> = {}) =>
    candidate({ slug: "upload-spya-dddddd", guessedUrl: "https://doi.org/10.1038/nature14539", ...over });

  it("matches a DOI work to an upload whose guessed address is that DOI, said as a guess", () => {
    expect(matchOf(DOI_WORK, upload())).toBe("guessed-id");
    expect(matchOf(ARXIV_WORK, upload({ guessedUrl: "https://arxiv.org/abs/2001.08361" }))).toBe("guessed-id");
  });

  it("fails closed on a guessed address that is not a resolver's: parsing, not the row's kind, decides", () => {
    expect(matchOf(DOI_WORK, upload({ guessedUrl: "https://example.com/10.1038/nature14539" }))).toBeNull();
  });

  it("never matches a guessed address by address, only by the identifier it is", () => {
    const pageWork = work({ url: "https://example.com/paper", linkFrom: "article" });
    expect(matchOf(pageWork, upload({ guessedUrl: "https://example.com/paper" }))).toBeNull();
  });

  it("is an identifier match: the reader's own upload beats a stranger's public copy (GPT Sol, plan review)", () => {
    const publicReal = candidate({ slug: "a-public", mine: false, urls: ["https://doi.org/10.1038/nature14539"] });
    expect(matchCited([DOI_WORK], [publicReal, upload({ slug: "z-guess" })]).get(DOI_WORK.id)?.slug).toBe("z-guess");
    /* An archived own copy by its real DOI still loses to a live upload: live before archived. */
    const archivedReal = candidate({ slug: "a-archived", archived: true, urls: ["https://doi.org/10.1038/nature14539"] });
    expect(matchCited([DOI_WORK], [archivedReal, upload({ slug: "z-guess" })]).get(DOI_WORK.id)?.slug).toBe("z-guess");
  });

  it("between two of the reader's live copies, the real identifier before our guess", () => {
    const real = candidate({ slug: "z-real", urls: ["https://doi.org/10.1038/nature14539"] });
    expect(matchCited([DOI_WORK], [upload({ slug: "a-guess" }), real]).get(DOI_WORK.id)?.slug).toBe("z-real");
    const byTitle = candidate({ slug: "a-title", matchTitle: TITLE });
    expect(matchCited([DOI_WORK], [byTitle, upload({ slug: "z-guess" })]).get(DOI_WORK.id)).toMatchObject({
      slug: "z-guess",
      matchedBy: "guessed-id",
    });
  });
});

describe("authorsAgree", () => {
  it("is unknown when either side names nobody", () => {
    expect(authorsAgree(undefined, "Jane Smith")).toBe("unknown");
    expect(authorsAgree("Kaplan, J.", null)).toBe("unknown");
  });
  it("does not count an initial as a name", () => {
    expect(authorsAgree("J. K.", "Jane Smith")).toBe("unknown");
  });
});

describe("matchCited", () => {
  it("prefers the strongest rule, then the reader's own copy, then slug order", () => {
    const byTitle = candidate({ slug: "a-title", matchTitle: TITLE });
    const publicById = candidate({ slug: "b-public", mine: false, urls: ["https://arxiv.org/abs/2001.08361"] });
    const mineById = candidate({ slug: "c-mine", urls: ["https://arxiv.org/abs/2001.08361"], displayTitle: "My copy" });
    for (const order of [
      [byTitle, publicById, mineById],
      [mineById, publicById, byTitle],
    ]) {
      expect(matchCited([ARXIV_WORK], order).get(ARXIV_WORK.id)).toEqual({
        slug: "c-mine",
        whose: "yours",
        matchedBy: "arxiv",
        title: "My copy",
      });
    }
    expect(matchCited([ARXIV_WORK], [byTitle, publicById]).get(ARXIV_WORK.id)?.slug).toBe("b-public");
    expect(matchCited([ARXIV_WORK], [publicById]).get(ARXIV_WORK.id)?.whose).toBe("public");
  });

  it("puts the reader's live copy before their archived one, and their archived one before a public one", () => {
    const url = ["https://arxiv.org/abs/2001.08361"];
    const live = candidate({ slug: "z-live", urls: url });
    const archived = candidate({ slug: "a-archived", urls: url, archived: true });
    const pub = candidate({ slug: "a-public", mine: false, urls: url });
    expect(matchCited([ARXIV_WORK], [archived, pub, live]).get(ARXIV_WORK.id)?.slug).toBe("z-live");
    expect(matchCited([ARXIV_WORK], [pub, archived]).get(ARXIV_WORK.id)).toEqual({
      slug: "a-archived",
      whose: "yours",
      matchedBy: "arxiv",
      title: "a-archived",
      archived: true,
    });
    /* A live copy's match carries no archived key at all. */
    expect(matchCited([ARXIV_WORK], [live]).get(ARXIV_WORK.id)).not.toHaveProperty("archived");
  });

  it("gives an unmatched work nothing", () => {
    expect(matchCited([work()], [candidate({ matchTitle: "Something else entirely here" })]).size).toBe(0);
  });
});

describe("withCitedInSpideryarn", () => {
  it("adds the match to the matched row only, and leaves the response otherwise alone", () => {
    const matched = work({ id: "spya-aaaaaa" });
    const other = work({ id: "spya-bbbbbb", title: "Nothing like it at all today" });
    const citations = { citations: [matched, other] } as unknown as Bibliography;
    const found = { bibliography: citations, stale: false, outdated: false };
    const out = withCitedInSpideryarn(found, [candidate({ slug: "mine-spya-cccccc", matchTitle: TITLE })]);
    expect(out.stale).toBe(false);
    expect(out.bibliography.citations[0]?.inSpideryarn).toEqual({
      slug: "mine-spya-cccccc",
      whose: "yours",
      matchedBy: "title",
      title: TITLE,
    });
    expect(out.bibliography.citations[1]?.inSpideryarn).toBeUndefined();
    expect(found.bibliography.citations[0]?.inSpideryarn).toBeUndefined();
  });
});
