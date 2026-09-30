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
import type { BlockId, Citations, CitedWork } from "../src/types.js";

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
});

describe("matchOf", () => {
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

  it("gives an unmatched work nothing", () => {
    expect(matchCited([work()], [candidate({ matchTitle: "Something else entirely here" })]).size).toBe(0);
  });
});

describe("withCitedInSpideryarn", () => {
  it("adds the match to the matched row only, and leaves the response otherwise alone", () => {
    const matched = work({ id: "spya-aaaaaa" });
    const other = work({ id: "spya-bbbbbb", title: "Nothing like it at all today" });
    const citations = { citations: [matched, other] } as unknown as Citations;
    const found = { citations, stale: false, outdated: false };
    const out = withCitedInSpideryarn(found, [candidate({ slug: "mine-spya-cccccc", matchTitle: TITLE })]);
    expect(out.stale).toBe(false);
    expect(out.citations.citations[0]?.inSpideryarn).toEqual({
      slug: "mine-spya-cccccc",
      whose: "yours",
      matchedBy: "title",
      title: TITLE,
    });
    expect(out.citations.citations[1]?.inSpideryarn).toBeUndefined();
    expect(found.citations.citations[0]?.inSpideryarn).toBeUndefined();
  });
});
