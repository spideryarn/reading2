/**
 * The paper-source registry — src/paper-sources.ts. Pure string work: which
 * addresses name a paper we know how to fetch, and what that paper is called.
 *
 * docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md.
 */
import { describe, expect, it } from "vitest";

import { isSlug, urlKey } from "../src/ingest.js";
import { ARXIV_ID_PATTERN, arxivIdOf, resolvePaperSource } from "../src/paper-sources.js";

/** The link Greg pasted, tracking parameters and all. */
const PASTED =
  "https://arxiv.org/abs/2608.13566?utm_campaign=ai-tinkerers__paperclub&utm_content=link1&utm_medium=ai-tinkerers&utm_source=paperclub";

/** Every shape of one unversioned paper's link. */
const SAME_PAPER = [
  "https://arxiv.org/abs/2608.13566",
  PASTED,
  "https://arxiv.org/abs/2608.13566#section-3",
  "https://arxiv.org/pdf/2608.13566",
  "https://arxiv.org/pdf/2608.13566.pdf",
  "https://arxiv.org/html/2608.13566",
  "https://arxiv.org/format/2608.13566",
  "http://arxiv.org/abs/2608.13566",
  "https://www.arxiv.org/abs/2608.13566",
  "https://export.arxiv.org/abs/2608.13566",
  "https://browse.arxiv.org/pdf/2608.13566",
  "https://ARXIV.ORG/abs/2608.13566",
  "https://arxiv.org/abs/2608.13566/",
  "https://arxiv.org/pdf/2608.13566.pdf/",
  "https://arxiv.org:443/abs/2608.13566",
  "https://doi.org/10.48550/arXiv.2608.13566",
  "https://dx.doi.org/10.48550/arxiv.2608.13566",
  "https://doi.org/10.48550/ARXIV.2608.13566?utm_source=x",
];

const VERSIONED = [
  "https://arxiv.org/abs/2608.13566v1",
  "https://arxiv.org/abs/2608.13566V1",
  "https://arxiv.org/pdf/2608.13566v1",
  "https://arxiv.org/pdf/2608.13566v1.pdf",
  "https://arxiv.org/html/2608.13566v1",
  "https://arxiv.org/html/2608.13566v1/",
  "https://arxiv.org/format/2608.13566v1",
  "https://doi.org/10.48550/arXiv.2608.13566v1",
];

const OLD_STYLE: [string, string, string, string][] = [
  ["https://arxiv.org/abs/hep-th/9901001", "hep-th/9901001", "hep-th/9901001", "arxiv-hep-th-9901001"],
  ["https://arxiv.org/pdf/hep-th/9901001.pdf", "hep-th/9901001", "hep-th/9901001", "arxiv-hep-th-9901001"],
  ["https://arxiv.org/html/hep-th/9901001v2", "hep-th/9901001v2", "hep-th/9901001", "arxiv-hep-th-9901001v2"],
  ["https://arxiv.org/abs/math.GT/0309136", "math.gt/0309136", "math.gt/0309136", "arxiv-math-gt-0309136"],
  ["https://arxiv.org/pdf/math.GT/0309136v1", "math.gt/0309136v1", "math.gt/0309136", "arxiv-math-gt-0309136v1"],
];

const NOT_A_PAPER = [
  "https://arxiv.org/list/cs.LG/recent",
  "https://arxiv.org/abs/",
  "https://arxiv.org/abs",
  "https://arxiv.org/",
  "https://arxiv.org/a/lastname_f_1",
  "https://notarxiv.org/abs/2608.13566",
  "https://arxiv.org.evil.example/abs/2608.13566",
  "https://evil.example/?next=https://arxiv.org/abs/2608.13566",
  "https://arxiv.org:444/abs/2608.13566",
  "http://arxiv.org:8080/abs/2608.13566",
  "https://user:pw@arxiv.org/abs/2608.13566",
  "https://user@arxiv.org/abs/2608.13566",
  "https://arxiv.org/abs/2608.13566abc",
  "https://arxiv.org/abs/2608.13566/extra",
  "https://arxiv.org/abs/2608.13566//",
  "https://arxiv.org/abs/2608.13566v",
  "https://arxiv.org/abs/2608.13566.pdf",
  "https://arxiv.org/abs/2608.135",
  "https://arxiv.org/redirect/arxiv.org/abs/2608.13566",
  "https://arxiv.org/pdf/2608.13566.pdf.exe",
  "ftp://arxiv.org/abs/2608.13566",
  "https://doi.org/10.1038/nature14539",
  "https://doi.org/10.48550/arXiv.2608.13566/extra",
  "https://doi.org/10.48550/somethingelse.2608.13566",
  "https://doi.org/prefix/10.48550/arXiv.2608.13566",
  "https://doi.org:444/10.48550/arXiv.2608.13566",
  "https://user:pw@doi.org/10.48550/arXiv.2608.13566",
  "https://notdoi.org/10.48550/arXiv.2608.13566",
  "https://arxiv.org/10.48550/arXiv.2608.13566",
  "https://doi.org/abs/2608.13566",
  "not a url",
  "",
];

describe("resolvePaperSource — arXiv", () => {
  it("names the paper in full for the plain abstract link", () => {
    expect(resolvePaperSource("https://arxiv.org/abs/2608.13566")).toEqual({
      source: "arxiv",
      versionedId: "2608.13566",
      workId: "2608.13566",
      canonicalUrl: "https://arxiv.org/abs/2608.13566",
      key: "arxiv.org/abs/2608.13566",
      slug: "arxiv-2608-13566",
      candidates: [{ url: "https://arxiv.org/pdf/2608.13566", expect: "pdf" }],
    });
  });

  it.each(SAME_PAPER)("resolves %s to the one paper", (url) => {
    expect(resolvePaperSource(url)).toEqual(resolvePaperSource("https://arxiv.org/abs/2608.13566"));
  });

  it.each(VERSIONED)("keeps the version of %s everywhere but the work id", (url) => {
    expect(resolvePaperSource(url)).toEqual({
      source: "arxiv",
      versionedId: "2608.13566v1",
      workId: "2608.13566",
      canonicalUrl: "https://arxiv.org/abs/2608.13566v1",
      key: "arxiv.org/abs/2608.13566v1",
      slug: "arxiv-2608-13566v1",
      candidates: [{ url: "https://arxiv.org/pdf/2608.13566v1", expect: "pdf" }],
    });
  });

  it("gives a versioned link a different key from the unversioned one, and the same work", () => {
    const bare = resolvePaperSource("https://arxiv.org/abs/2608.13566");
    const v1 = resolvePaperSource("https://arxiv.org/abs/2608.13566v1");
    const v2 = resolvePaperSource("https://arxiv.org/abs/2608.13566v2");
    expect(new Set([bare?.key, v1?.key, v2?.key]).size).toBe(3);
    expect(new Set([bare?.slug, v1?.slug, v2?.slug]).size).toBe(3);
    expect(new Set([bare?.workId, v1?.workId, v2?.workId])).toEqual(new Set(["2608.13566"]));
  });

  it.each(OLD_STYLE)("reads the old-style id in %s", (url, versionedId, workId, slug) => {
    const got = resolvePaperSource(url);
    expect(got).toMatchObject({ source: "arxiv", versionedId, workId, slug });
    expect(got?.canonicalUrl).toBe(`https://arxiv.org/abs/${versionedId}`);
    expect(got?.candidates).toEqual([{ url: `https://arxiv.org/pdf/${versionedId}`, expect: "pdf" }]);
  });

  it("takes a five-digit and a four-digit new-style number", () => {
    expect(resolvePaperSource("https://arxiv.org/abs/1706.03762")?.workId).toBe("1706.03762");
    expect(resolvePaperSource("https://arxiv.org/abs/0704.0001")?.workId).toBe("0704.0001");
  });

  it.each(NOT_A_PAPER)("answers null for %j", (url) => {
    expect(resolvePaperSource(url)).toBeNull();
  });

  /* Pinned so that putting the HTML candidate first — the later stage of plan
     261005l — is a red test somebody changes on purpose. */
  it("offers exactly one candidate today: the PDF", () => {
    for (const url of [...SAME_PAPER, ...VERSIONED, ...OLD_STYLE.map((row) => row[0])]) {
      const got = resolvePaperSource(url);
      expect(got?.candidates).toEqual([{ url: `https://arxiv.org/pdf/${got?.versionedId}`, expect: "pdf" }]);
    }
  });

  it("builds a slug the store accepts, addresses on arxiv.org, and the key urlKey gives today", () => {
    const all = [...SAME_PAPER, ...VERSIONED, ...OLD_STYLE.map((row) => row[0])];
    for (const url of all) {
      const got = resolvePaperSource(url);
      if (got === null) throw new Error(`did not resolve: ${url}`);
      expect(isSlug(got.slug)).toBe(true);
      expect(got.key).toBe(urlKey(got.canonicalUrl));
      expect(got.canonicalUrl.startsWith("https://arxiv.org/abs/")).toBe(true);
      expect(got.candidates.length).toBeGreaterThan(0);
      for (const candidate of got.candidates) expect(new URL(candidate.url).origin).toBe("https://arxiv.org");
      expect(got.versionedId).toBe(got.versionedId.toLowerCase());
      expect(got.versionedId.startsWith(got.workId)).toBe(true);
      expect(got.workId).not.toMatch(/v\d+$/);
    }
  });

  /* The abs link is what every article imported before this was keyed by. */
  it("does not change the key an abstract link already has", () => {
    for (const url of ["https://arxiv.org/abs/2608.13566", "https://arxiv.org/abs/2608.13566v1", PASTED]) {
      expect(resolvePaperSource(url)?.key).toBe(urlKey(url));
    }
  });
});

describe("arxivIdOf", () => {
  it("answers the two ids, or null", () => {
    expect(arxivIdOf(PASTED)).toEqual({ versionedId: "2608.13566", workId: "2608.13566" });
    expect(arxivIdOf("https://arxiv.org/pdf/math.GT/0309136v3.pdf")).toEqual({
      versionedId: "math.gt/0309136v3",
      workId: "math.gt/0309136",
    });
    expect(arxivIdOf("https://doi.org/10.1038/nature14539")).toBeNull();
    expect(arxivIdOf("not a url")).toBeNull();
  });
});

describe("ARXIV_ID_PATTERN", () => {
  it("is a bare alternation a caller wraps itself", () => {
    const whole = new RegExp(`^(?:${ARXIV_ID_PATTERN})$`, "i");
    expect(whole.test("2608.13566")).toBe(true);
    expect(whole.test("hep-th/9901001")).toBe(true);
    expect(whole.test("math.GT/0309136")).toBe(true);
    expect(whole.test("2608.13566v1")).toBe(false);
    expect(whole.test("x2608.13566")).toBe(false);
  });
});
