/**
 * The paper-source registry — src/paper-sources.ts. Pure string work: which
 * addresses name a paper we know how to fetch, and what that paper is called.
 *
 * docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isSlug, slugFromUrl, urlKey } from "../src/ingest.js";
import {
  ARXIV_ID_PATTERN,
  arxivIdOf,
  arxivPaper,
  PAPER_SLUG_MAX,
  resolvePaperSource,
} from "../src/paper-sources.js";

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
      candidates: [
        { url: "https://arxiv.org/html/2608.13566", expect: "html", marker: "ltx_document" },
        { url: "https://arxiv.org/pdf/2608.13566", expect: "pdf" },
      ],
    });
  });

  it.each(SAME_PAPER)("resolves %s to the one paper", (url) => {
    expect(resolvePaperSource(url)).toEqual(resolvePaperSource("https://arxiv.org/abs/2608.13566"));
  });

  it.each(VERSIONED)("keeps the version of %s everywhere but the work id and the key", (url) => {
    expect(resolvePaperSource(url)).toEqual({
      source: "arxiv",
      versionedId: "2608.13566v1",
      workId: "2608.13566",
      canonicalUrl: "https://arxiv.org/abs/2608.13566v1",
      key: "arxiv.org/abs/2608.13566",
      slug: "arxiv-2608-13566v1",
      candidates: [
        { url: "https://arxiv.org/html/2608.13566v1", expect: "html", marker: "ltx_document" },
        { url: "https://arxiv.org/pdf/2608.13566v1", expect: "pdf" },
      ],
    });
  });

  /* The version decides what is fetched and the slug, but not "do we already
     have this?": report spya-n50aft, plan 261009d. */
  it("gives every version, and none, one key, and keeps them apart everywhere else", () => {
    const bare = resolvePaperSource("https://arxiv.org/abs/2608.13566");
    const v1 = resolvePaperSource("https://arxiv.org/abs/2608.13566v1");
    const v2 = resolvePaperSource("https://arxiv.org/abs/2608.13566v2");
    expect(new Set([bare?.key, v1?.key, v2?.key])).toEqual(new Set(["arxiv.org/abs/2608.13566"]));
    expect(new Set([bare?.canonicalUrl, v1?.canonicalUrl, v2?.canonicalUrl]).size).toBe(3);
    expect(new Set([bare?.slug, v1?.slug, v2?.slug]).size).toBe(3);
    expect(new Set([bare?.workId, v1?.workId, v2?.workId])).toEqual(new Set(["2608.13566"]));
  });

  it.each(OLD_STYLE)("reads the old-style id in %s", (url, versionedId, workId, slug) => {
    const got = resolvePaperSource(url);
    expect(got).toMatchObject({ source: "arxiv", versionedId, workId, slug });
    expect(got?.canonicalUrl).toBe(`https://arxiv.org/abs/${versionedId}`);
    expect(got?.candidates).toEqual([
      { url: `https://arxiv.org/html/${versionedId}`, expect: "html", marker: "ltx_document" },
      { url: `https://arxiv.org/pdf/${versionedId}`, expect: "pdf" },
    ]);
  });

  it("takes a five-digit and a four-digit new-style number", () => {
    expect(resolvePaperSource("https://arxiv.org/abs/1706.03762")?.workId).toBe("1706.03762");
    expect(resolvePaperSource("https://arxiv.org/abs/0704.0001")?.workId).toBe("0704.0001");
  });

  it.each(NOT_A_PAPER)("answers null for %j", (url) => {
    expect(resolvePaperSource(url)).toBeNull();
  });

  /* Pinned so that changing the order, or dropping the fallback, is a red test
     somebody changes on purpose. HTML went first on 2026-10-06, with the fixes
     in src/latexml.ts — plan 261005l § the HTML arm's faults, and HTML first. */
  it("offers arXiv's HTML first and its PDF second, and nothing else", () => {
    for (const url of [...SAME_PAPER, ...VERSIONED, ...OLD_STYLE.map((row) => row[0])]) {
      const got = resolvePaperSource(url);
      expect(got?.candidates).toEqual([
        { url: `https://arxiv.org/html/${got?.versionedId}`, expect: "html", marker: "ltx_document" },
        { url: `https://arxiv.org/pdf/${got?.versionedId}`, expect: "pdf" },
      ]);
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

  /* The abs link is what every article imported before this was keyed by.
     A versioned one's key lost its version on 2026-10-09 (plan 261009d), which
     is the point: it now matches the article an unversioned link imported. */
  it("does not change the key an abstract link already has", () => {
    for (const url of ["https://arxiv.org/abs/2608.13566", PASTED]) {
      expect(resolvePaperSource(url)?.key).toBe(urlKey(url));
    }
  });
});

/* Review finding F16: the grammar used to leave the version and the old-style
   archive name unbounded, so an address could resolve to a slug `isSlug`
   refuses. Both are bounded now, and the resolver refuses any slug over the
   limit whatever the grammar says. */
describe("resolvePaperSource — a slug the store would refuse", () => {
  const LONG_VERSION = `https://arxiv.org/abs/2608.13566v${"1".repeat(50)}`;
  const LONG_ARCHIVE = `https://arxiv.org/abs/${"a".repeat(50)}/9901001`;
  const TOO_LONG = [
    LONG_VERSION,
    LONG_ARCHIVE,
    `https://arxiv.org/pdf/2608.13566v${"1".repeat(50)}.pdf`,
    `https://arxiv.org/pdf/${"a".repeat(50)}.gt/9901001v2`,
    `https://doi.org/10.48550/arXiv.2608.13566v${"1".repeat(50)}`,
    // One past each bound, well short of the slug limit: the grammar is closed, not only guarded.
    `https://arxiv.org/abs/2608.13566v${"1".repeat(10)}`,
    `https://arxiv.org/abs/${"a".repeat(17)}/9901001`,
  ];

  it.each(TOO_LONG)("answers null for %s", (url) => {
    expect(resolvePaperSource(url)).toBeNull();
    expect(arxivIdOf(url)).toBeNull();
  });

  it.each([LONG_VERSION, LONG_ARCHIVE])("leaves %s to the ordinary slug and key", (url) => {
    const slug = slugFromUrl(url);
    expect(slug === "" || isSlug(slug)).toBe(true);
    // The ordinary key: host and path, lower-cased — not a paper's.
    expect(urlKey(url)).toBe(url.replace("https://", "").toLowerCase());
  });

  /** The longest id each bound admits, and real archives beside them. */
  const LONGEST = [
    `https://arxiv.org/abs/${"a".repeat(16)}.GT/9901001v999999999`,
    `https://arxiv.org/pdf/${"a-".repeat(8)}.GT/9901001v999999999.pdf`,
    "https://arxiv.org/abs/2608.13566v999999999",
    "https://doi.org/10.48550/arXiv.2608.13566v999",
    /* GPT Sol's F17: a four-digit version is still this paper, not the abstract page. */
    "https://arxiv.org/abs/2608.13566v1000",
    "https://arxiv.org/abs/2608.13566v1234",
    "https://arxiv.org/abs/cond-mat/9901001v12",
    "https://arxiv.org/abs/astro-ph/0001001",
    "https://arxiv.org/abs/chao-dyn/9901001",
    "https://arxiv.org/abs/physics/0001001v3",
    "https://arxiv.org/abs/q-alg/9701001",
    "https://arxiv.org/abs/nlin.CD/0001001",
  ];

  it.each(LONGEST)("still resolves %s, to a slug the store accepts", (url) => {
    const got = resolvePaperSource(url);
    if (got === null) throw new Error(`did not resolve: ${url}`);
    expect(isSlug(got.slug)).toBe(true);
    expect(got.slug.length).toBeLessThanOrEqual(PAPER_SLUG_MAX);
  });

  it("keeps its limit equal to isSlug's", () => {
    expect(isSlug("a".repeat(PAPER_SLUG_MAX))).toBe(true);
    expect(isSlug("a".repeat(PAPER_SLUG_MAX + 1))).toBe(false);
  });
});

describe("arxivPaper", () => {
  it.each([
    "https://arxiv.org/abs/2608.13566",
    "https://arxiv.org/pdf/2608.13566v1.pdf",
    "https://arxiv.org/abs/math.GT/0309136v3",
  ])("answers what the arXiv source answers for %s", (url) => {
    const id = arxivIdOf(url);
    if (id === null) throw new Error(`no id: ${url}`);
    expect(arxivPaper(id)).not.toBeNull();
    expect(arxivPaper(id)).toEqual(resolvePaperSource(url));
  });

  it("refuses an id whose slug the store would refuse, rather than returning it", () => {
    const workId = "2608.13566";
    expect(arxivPaper({ versionedId: `${workId}v${"1".repeat(50)}`, workId })).toBeNull();
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

/* ------------------------------------------------------------------------
   Part 2: the arXiv mirrors and the five other sources.
   docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md
   ------------------------------------------------------------------------ */

describe("the arXiv mirrors are shapes of the arXiv source", () => {
  const MIRRORS = [
    "https://huggingface.co/papers/",
    "http://huggingface.co/papers/",
    "https://alphaxiv.org/abs/",
    "https://www.alphaxiv.org/abs/",
    "https://www.alphaxiv.org/overview/",
    "https://alphaxiv.org/overview/",
  ];

  for (const prefix of MIRRORS) {
    it(`${prefix}<id> resolves to exactly what arXiv's own link does`, () => {
      for (const id of ["1706.03762", "1706.03762v5", "hep-th/9901001"]) {
        const direct = resolvePaperSource(`https://arxiv.org/abs/${id}`);
        expect(direct).not.toBeNull();
        expect(resolvePaperSource(`${prefix}${id}`)).toEqual(direct);
        expect(resolvePaperSource(`${prefix}${id}/?utm_source=x#top`)).toEqual(direct);
        expect(arxivIdOf(`${prefix}${id}`)).toEqual(arxivIdOf(`https://arxiv.org/abs/${id}`));
      }
    });
  }

  it.each([
    "https://huggingface.co/papers",
    "https://huggingface.co/papers/",
    "https://huggingface.co/papers/trending",
    "https://huggingface.co/papers/not-an-arxiv-id",
    "https://huggingface.co/papers/1706.03762/discussion",
    "https://huggingface.co/papers/1706.03762abc",
    "https://huggingface.co/openai/whisper-large-v3",
    "https://huggingface.co/datasets/1706.03762",
    "https://huggingface.co/abs/1706.03762",
    "https://www.huggingface.co/papers/1706.03762",
    "https://huggingface.co.evil.example/papers/1706.03762",
    "https://huggingface.co:444/papers/1706.03762",
    "https://user@huggingface.co/papers/1706.03762",
    "https://alphaxiv.org/",
    "https://alphaxiv.org/abs",
    "https://alphaxiv.org/abs/",
    "https://alphaxiv.org/papers/1706.03762",
    "https://alphaxiv.org/abs/1706.03762/blog",
    "https://alphaxiv.org/pdf/1706.03762",
    "https://notalphaxiv.org/abs/1706.03762",
    "https://alphaxiv.org:8443/abs/1706.03762",
    "https://user:pw@www.alphaxiv.org/abs/1706.03762",
  ])("answers null for %j", (url) => {
    expect(resolvePaperSource(url)).toBeNull();
    expect(arxivIdOf(url)).toBeNull();
  });
});

/** One paper of a source: every address that names it, and what they must all resolve to. */
interface SourceCase {
  shapes: string[];
  resolved: {
    source: string;
    id: string;
    canonicalUrl: string;
    key: string;
    slug: string;
    candidates: string[];
  };
  hosts: string[];
  nearMisses: string[];
}

const NEURIPS_HASH = "3f5ee243547dee91fbd053c1c4a845aa";
const NEURIPS_TRACK_HASH = "0001ca33ba34ce0351e4612b744b3936";
const SWIN = "Liu_Swin_Transformer_Hierarchical_Vision_Transformer_Using_Shifted_Windows_ICCV_2021_paper";

const SOURCE_CASES: Record<string, SourceCase> = {
  "acl, a new-style id": {
    shapes: [
      "https://aclanthology.org/2020.acl-main.703/",
      "https://aclanthology.org/2020.acl-main.703",
      "https://aclanthology.org/2020.acl-main.703.pdf",
      "http://aclanthology.org/2020.acl-main.703/",
      "https://ACLANTHOLOGY.ORG/2020.ACL-MAIN.703/",
      "https://aclanthology.org/2020.acl-main.703/?utm_source=x#abstract",
      "https://doi.org/10.18653/v1/2020.acl-main.703",
      "https://dx.doi.org/10.18653/v1/2020.acl-main.703",
    ],
    resolved: {
      source: "acl",
      id: "2020.acl-main.703",
      canonicalUrl: "https://aclanthology.org/2020.acl-main.703/",
      key: "aclanthology.org/2020.acl-main.703",
      slug: "acl-2020-acl-main-703",
      candidates: ["https://aclanthology.org/2020.acl-main.703.pdf"],
    },
    hosts: ["aclanthology.org"],
    nearMisses: [
      "https://aclanthology.org/",
      "https://aclanthology.org/volumes/2020.acl-main/",
      "https://aclanthology.org/events/acl-2020/",
      "https://aclanthology.org/2020.acl-main.703/extra",
      "https://aclanthology.org/2020.acl-main.703.pdf/extra",
      "https://aclanthology.org/2020.acl-main.703.bib",
      "https://aclanthology.org/2020.acl_main.703/",
      "https://aclanthology.org/2020.acl-main.703x/",
      "https://aclanthology.org/2020.acl-main/",
      "https://aclanthology.org/x/2020.acl-main.703/",
      "https://aclanthology.org.evil.example/2020.acl-main.703/",
      "https://notaclanthology.org/2020.acl-main.703/",
      "https://aclanthology.org:8443/2020.acl-main.703/",
      "https://user:pw@aclanthology.org/2020.acl-main.703/",
      "ftp://aclanthology.org/2020.acl-main.703/",
      "https://doi.org/10.18653/v1/2020.acl-main.703/extra",
      "https://doi.org/10.18653/v2/2020.acl-main.703",
      "https://doi.org/10.18654/v1/2020.acl-main.703",
      "https://doi.org:444/10.18653/v1/2020.acl-main.703",
      "https://aclanthology.org/10.18653/v1/2020.acl-main.703",
    ],
  },
  "acl, an old-style id": {
    shapes: [
      "https://aclanthology.org/N19-1423/",
      "https://aclanthology.org/N19-1423",
      "https://aclanthology.org/N19-1423.pdf",
      "https://aclanthology.org/n19-1423/",
      "https://doi.org/10.18653/v1/N19-1423",
      "https://doi.org/10.18653/v1/n19-1423",
    ],
    resolved: {
      source: "acl",
      id: "N19-1423",
      canonicalUrl: "https://aclanthology.org/N19-1423/",
      key: "aclanthology.org/N19-1423",
      slug: "acl-n19-1423",
      candidates: ["https://aclanthology.org/N19-1423.pdf"],
    },
    hosts: ["aclanthology.org"],
    nearMisses: [
      "https://aclanthology.org/N19-142/",
      "https://aclanthology.org/N19-14234567/",
      "https://aclanthology.org/NN19-1423/",
      "https://aclanthology.org/N19_1423/",
      "https://aclanthology.org/N19-1423/N19-1423.pdf",
    ],
  },
  "pmlr, the nested layout": {
    shapes: [
      "https://proceedings.mlr.press/v139/radford21a.html",
      "http://proceedings.mlr.press/v139/radford21a.html",
      "https://proceedings.mlr.press/v139/radford21a.pdf",
      "https://proceedings.mlr.press/v139/radford21a/radford21a.pdf",
      "http://proceedings.mlr.press/v139/radford21a/radford21a.pdf",
      "https://proceedings.mlr.press/v139/radford21a.html?utm_source=x#abstract",
    ],
    resolved: {
      source: "pmlr",
      id: "v139/radford21a",
      canonicalUrl: "https://proceedings.mlr.press/v139/radford21a.html",
      key: "proceedings.mlr.press/v139/radford21a.html",
      slug: "pmlr-v139-radford21a",
      candidates: [
        "https://proceedings.mlr.press/v139/radford21a/radford21a.pdf",
        "https://proceedings.mlr.press/v139/radford21a.pdf",
      ],
    },
    hosts: ["proceedings.mlr.press"],
    nearMisses: [
      "https://proceedings.mlr.press/",
      "https://proceedings.mlr.press/v139/",
      "https://proceedings.mlr.press/v139/radford21a",
      "https://proceedings.mlr.press/v139/radford21a/",
      "https://proceedings.mlr.press/v139/radford21a/other21b.pdf",
      "https://proceedings.mlr.press/v139/radford21a/radford21a-supp.pdf",
      "https://proceedings.mlr.press/v139/radford21a.html/extra",
      "https://proceedings.mlr.press/v139/rad.ford21a.html",
      "https://proceedings.mlr.press/vx/radford21a.html",
      "https://proceedings.mlr.press/V139/radford21a.html",
      "https://proceedings.mlr.press/x/v139/radford21a.html",
      "https://mlr.press/v139/radford21a.html",
      "https://proceedings.mlr.press.evil.example/v139/radford21a.html",
      "https://proceedings.mlr.press:8080/v139/radford21a.html",
      "https://user@proceedings.mlr.press/v139/radford21a.html",
    ],
  },
  "neurips, no track": {
    shapes: [
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://proceedings.neurips.cc/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://papers.nips.cc/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://papers.nips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `http://papers.nips.cc/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/file/${NEURIPS_HASH}-Paper.pdf`,
      `https://proceedings.neurips.cc/paper/2017/file/${NEURIPS_HASH}-Paper.pdf`,
      `https://papers.nips.cc/paper/2017/file/${NEURIPS_HASH}-Paper.pdf`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html?x=1#top`,
    ],
    resolved: {
      source: "neurips",
      id: `2017/${NEURIPS_HASH}`,
      canonicalUrl: `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      key: `proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      slug: `neurips-2017-${NEURIPS_HASH}`,
      candidates: [`https://proceedings.neurips.cc/paper_files/paper/2017/file/${NEURIPS_HASH}-Paper.pdf`],
    },
    hosts: ["proceedings.neurips.cc"],
    nearMisses: [
      "https://proceedings.neurips.cc/",
      "https://proceedings.neurips.cc/paper_files/paper/2017",
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html/extra`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Reviews.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Paper.pdf`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/file/${NEURIPS_HASH}-Abstract.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/file/${NEURIPS_HASH}-Supplemental.pdf`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/file/${NEURIPS_HASH}-Bibtex.bib`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH.slice(1)}-Abstract.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}0-Abstract.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/g${NEURIPS_HASH.slice(1)}-Abstract.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH.toUpperCase()}-Abstract.html`,
      `https://proceedings.neurips.cc/paper_files/paper/17/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://proceedings.neurips.cc/x/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://neurips.cc/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://proceedings.neurips.cc.evil.example/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://proceedings.neurips.cc:444/paper_files/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      `https://user:pw@papers.nips.cc/paper/2017/hash/${NEURIPS_HASH}-Abstract.html`,
      "https://papers.nips.cc/paper/7181-attention-is-all-you-need",
    ],
  },
  "neurips, a track": {
    shapes: [
      `https://proceedings.neurips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}-Abstract-Conference.html`,
      `https://papers.nips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}-Abstract-Conference.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2023/file/${NEURIPS_TRACK_HASH}-Paper-Conference.pdf`,
    ],
    resolved: {
      source: "neurips",
      id: `2023/${NEURIPS_TRACK_HASH}`,
      canonicalUrl: `https://proceedings.neurips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}-Abstract-Conference.html`,
      key: `proceedings.neurips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}-Abstract-Conference.html`,
      slug: `neurips-2023-${NEURIPS_TRACK_HASH}`,
      candidates: [`https://proceedings.neurips.cc/paper_files/paper/2023/file/${NEURIPS_TRACK_HASH}-Paper-Conference.pdf`],
    },
    hosts: ["proceedings.neurips.cc"],
    nearMisses: [
      `https://proceedings.neurips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}-Abstract-.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}-Abstract-Con.ference.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}-Abstract-Con-ference.html`,
      `https://proceedings.neurips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}-AbstractConference.html`,
    ],
  },
  "cvf, the older collection style": {
    shapes: [
      "https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "http://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "https://openaccess.thecvf.com/content_cvpr_2016/papers/He_Deep_Residual_Learning_CVPR_2016_paper.pdf",
      "https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html?x=1#top",
    ],
    resolved: {
      source: "cvf",
      id: "content_cvpr_2016/He_Deep_Residual_Learning_CVPR_2016_paper",
      canonicalUrl: "https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      key: "openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      slug: "cvf-he-deep-residual-learning-cvpr-2016-paper",
      candidates: ["https://openaccess.thecvf.com/content_cvpr_2016/papers/He_Deep_Residual_Learning_CVPR_2016_paper.pdf"],
    },
    hosts: ["openaccess.thecvf.com"],
    nearMisses: [
      "https://openaccess.thecvf.com/",
      "https://openaccess.thecvf.com/CVPR2016",
      "https://openaccess.thecvf.com/content_cvpr_2016/html/",
      "https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper",
      "https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.pdf",
      "https://openaccess.thecvf.com/content_cvpr_2016/papers/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html/extra",
      "https://openaccess.thecvf.com/content_cvpr_2016/html/He.Deep_paper.html",
      "https://openaccess.thecvf.com/content_cvpr_2016/supplemental/He_Deep_Residual_Learning_CVPR_2016_paper.pdf",
      "https://openaccess.thecvf.com/other_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "https://openaccess.thecvf.com/x/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "https://openaccess.thecvf.com/content/a/b/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "https://thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "https://openaccess.thecvf.com.evil.example/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "https://openaccess.thecvf.com:444/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
      "https://user@openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
    ],
  },
  "cvf, the newer collection style and a 90-character name": {
    shapes: [
      `https://openaccess.thecvf.com/content/ICCV2021/html/${SWIN}.html`,
      `https://openaccess.thecvf.com/content/ICCV2021/papers/${SWIN}.pdf`,
    ],
    resolved: {
      source: "cvf",
      id: `content/ICCV2021/${SWIN}`,
      canonicalUrl: `https://openaccess.thecvf.com/content/ICCV2021/html/${SWIN}.html`,
      key: `openaccess.thecvf.com/content/ICCV2021/html/${SWIN}.html`,
      slug: "cvf-liu-swin-transformer-hierarchical-vision-transformer-usi",
      candidates: [`https://openaccess.thecvf.com/content/ICCV2021/papers/${SWIN}.pdf`],
    },
    hosts: ["openaccess.thecvf.com"],
    nearMisses: [],
  },
  jmlr: {
    shapes: [
      "https://jmlr.org/papers/v15/srivastava14a.html",
      "https://www.jmlr.org/papers/v15/srivastava14a.html",
      "http://jmlr.org/papers/v15/srivastava14a.html",
      "https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf",
      "https://www.jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf",
      "https://jmlr.org/papers/v15/srivastava14a.html?x=1#abs",
    ],
    resolved: {
      source: "jmlr",
      id: "v15/srivastava14a",
      canonicalUrl: "https://jmlr.org/papers/v15/srivastava14a.html",
      key: "jmlr.org/papers/v15/srivastava14a.html",
      slug: "jmlr-v15-srivastava14a",
      candidates: ["https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf"],
    },
    hosts: ["jmlr.org"],
    nearMisses: [
      "https://jmlr.org/",
      "https://jmlr.org/papers/v15/",
      "https://jmlr.org/papers/v15/srivastava14a",
      "https://jmlr.org/papers/v15/srivastava14a.html/extra",
      "https://jmlr.org/papers/v15/sriva.stava14a.html",
      "https://jmlr.org/papers/v15/srivastava14a.pdf",
      "https://jmlr.org/papers/volume15/srivastava14a/other.pdf",
      "https://jmlr.org/papers/volume15/srivastava14a.pdf",
      "https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.html",
      "https://jmlr.org/papers/vx/srivastava14a.html",
      "https://jmlr.org/x/papers/v15/srivastava14a.html",
      "https://jmlr.org/proceedings/papers/v37/ioffe15.html",
      "https://jmlr.csail.mit.edu/papers/v15/srivastava14a.html",
      "https://jmlr.org.evil.example/papers/v15/srivastava14a.html",
      "https://jmlr.org:444/papers/v15/srivastava14a.html",
      "https://user:pw@jmlr.org/papers/v15/srivastava14a.html",
    ],
  },
  /* docs/plans/261006i-an-article-is-found-by-the-address-it-was-asked-for-and-a-redirect-that-ends-on-a-paper-source-imports-the-paper.md
     § Stage 3. The key is pinned as a literal: it is what `urlKey` answered for
     `https://www.nber.org/papers/w30000` on the commit before this source
     existed (`8f45d1ff7`), where `www.` was dropped by `urlKey` itself. */
  nber: {
    shapes: [
      "https://www.nber.org/papers/w30000",
      "https://nber.org/papers/w30000",
      "http://www.nber.org/papers/w30000",
      "https://www.nber.org/papers/w30000/",
      "https://www.nber.org/papers/w30000.pdf",
      "https://www.nber.org/system/files/working_papers/w30000/w30000.pdf",
      "https://nber.org/system/files/working_papers/w30000/w30000.pdf",
      "https://www.nber.org/papers/W30000",
      "https://www.nber.org/system/files/working_papers/W30000/w30000.pdf",
      "https://doi.org/10.3386/w30000",
      "https://dx.doi.org/10.3386/W30000",
      "https://www.nber.org/papers/w30000?utm_source=x#fromrss",
    ],
    resolved: {
      source: "nber",
      id: "w30000",
      canonicalUrl: "https://www.nber.org/papers/w30000",
      key: "nber.org/papers/w30000",
      slug: "nber-w30000",
      candidates: ["https://www.nber.org/system/files/working_papers/w30000/w30000.pdf"],
    },
    hosts: ["www.nber.org"],
    nearMisses: [
      "https://www.nber.org/",
      "https://www.nber.org/papers",
      "https://www.nber.org/papers/",
      "https://www.nber.org/papers/w",
      "https://www.nber.org/papers/30000",
      "https://www.nber.org/papers/wabc",
      "https://www.nber.org/papers/w30000a",
      "https://www.nber.org/papers/w3000000",
      "https://www.nber.org/papers/t0123",
      "https://www.nber.org/papers/w30000/revisions",
      "https://www.nber.org/papers/w30000.pdf/x",
      "https://www.nber.org/papers/w30000.html",
      "https://www.nber.org/x/papers/w30000",
      "https://www.nber.org/system/files/working_papers/w30000/w30001.pdf",
      "https://www.nber.org/system/files/working_papers/w30000/w3000.pdf",
      "https://www.nber.org/system/files/working_papers/w30000/w30000.pdf/x",
      "https://www.nber.org/system/files/working_papers/w30000.pdf",
      "https://www.nber.org/system/files/chapters/w30000/w30000.pdf",
      "https://data.nber.org/papers/w30000",
      "https://www.nber.org.evil.example/papers/w30000",
      "https://notnber.org/papers/w30000",
      "https://www.nber.org:444/papers/w30000",
      "https://user:pw@www.nber.org/papers/w30000",
      "https://doi.org/10.3386/wabc",
      "https://doi.org/10.3386/t0123",
      "https://doi.org/10.3386/w30000/x",
      "https://doi.org/10.3387/w30000",
      "https://www.nber.org/10.3386/w30000",
    ],
  },
};

const resolvedOrThrow = (url: string) => {
  const got = resolvePaperSource(url);
  if (got === null) throw new Error(`did not resolve: ${url}`);
  return got;
};

describe("resolvePaperSource — the sources after arXiv", () => {
  for (const [name, wanted] of Object.entries(SOURCE_CASES)) {
    describe(name, () => {
      const whole = {
        source: wanted.resolved.source,
        versionedId: wanted.resolved.id,
        workId: wanted.resolved.id,
        canonicalUrl: wanted.resolved.canonicalUrl,
        key: wanted.resolved.key,
        slug: wanted.resolved.slug,
        candidates: wanted.resolved.candidates.map((url) => ({ url, expect: "pdf" })),
      };

      it.each(wanted.shapes)("resolves %s to the one paper", (url) => {
        expect(resolvePaperSource(url)).toEqual(whole);
      });

      it("resolves every candidate's own address, and the address it is known by, back to the same paper", () => {
        for (const address of [...wanted.resolved.candidates, wanted.resolved.canonicalUrl]) {
          expect(resolvePaperSource(address), address).toEqual(whole);
          /* What the shelf lookup asks of the address the fetch ended on. */
          expect(urlKey(address), address).toBe(wanted.resolved.key);
        }
      });

      it("has the key urlKey gave its landing page before, a slug the store takes, and only PDFs on its own host", () => {
        const got = resolvedOrThrow(wanted.shapes[0] as string);
        expect(isSlug(got.slug)).toBe(true);
        const landing = new URL(got.canonicalUrl);
        /* Without `www.`, as `urlKey` always dropped it: NBER is known by its `www.` address. */
        expect(got.key).toBe(`${landing.hostname.replace(/^www\./, "")}${landing.pathname.replace(/\/$/, "")}`);
        expect(got.candidates.length).toBeGreaterThan(0);
        for (const candidate of got.candidates) {
          expect(candidate.expect).toBe("pdf");
          expect(candidate.url).not.toBe(got.canonicalUrl);
          expect(new URL(candidate.url).protocol).toBe("https:");
          expect(wanted.hosts).toContain(new URL(candidate.url).host);
        }
      });

      if (wanted.nearMisses.length > 0) {
        it.each(wanted.nearMisses)("answers null for %j", (url) => {
          expect(resolvePaperSource(url)).toBeNull();
        });
      }
    });
  }

  it("keeps the case the server spells a name in, in the key and in the candidate", () => {
    /* CVF's and PMLR's file names are case-sensitive on the server, so a
       lower-cased spelling is a different address there and stays a different
       key here. ACL's ids are the exception: a DOI is case-insensitive, so both
       spellings are folded to the one the Anthology serves. */
    const cvf = resolvedOrThrow("https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html");
    const lower = resolvedOrThrow("https://openaccess.thecvf.com/content_cvpr_2016/html/he_deep_residual_learning_cvpr_2016_paper.html");
    expect(lower.key).not.toBe(cvf.key);
    expect(lower.candidates[0]?.url).toContain("/he_deep_residual_learning_cvpr_2016_paper.pdf");
    expect(resolvedOrThrow("https://ACLANTHOLOGY.ORG/n19-1423").candidates[0]?.url).toBe("https://aclanthology.org/N19-1423.pdf");
    expect(resolvedOrThrow("https://aclanthology.org/2023.ACL-Long.1/").candidates[0]?.url).toBe("https://aclanthology.org/2023.acl-long.1.pdf");
  });

  it("gives two NeurIPS tracks of one hash two keys, so a wrong ending cannot be mistaken for the right one", () => {
    const base = `https://proceedings.neurips.cc/paper_files/paper/2023/hash/${NEURIPS_TRACK_HASH}`;
    const conference = resolvedOrThrow(`${base}-Abstract-Conference.html`);
    const benchmarks = resolvedOrThrow(`${base}-Abstract-Datasets_and_Benchmarks.html`);
    const none = resolvedOrThrow(`${base}-Abstract.html`);
    expect(new Set([conference.key, benchmarks.key, none.key]).size).toBe(3);
    expect(benchmarks.candidates).toEqual([
      { url: `https://proceedings.neurips.cc/paper_files/paper/2023/file/${NEURIPS_TRACK_HASH}-Paper-Datasets_and_Benchmarks.pdf`, expect: "pdf" },
    ]);
  });

  describe("a long CVF name", () => {
    const cases = JSON.parse(readFileSync(path.join(import.meta.dirname, "../evals/paper-sources/cases.json"), "utf8")) as {
      source: string;
      label: string;
      landingUrl: string;
    }[];
    const measured = cases.find((c) => c.source === "cvf" && c.label === "Swin");

    it("is the 90-character one that was measured, and resolves with a cut slug and a whole key", () => {
      if (measured === undefined) throw new Error("the Swin case has gone from evals/paper-sources/cases.json");
      const name = new URL(measured.landingUrl).pathname.split("/").at(-1)?.replace(/\.html$/, "") ?? "";
      expect(name.length).toBe(90);
      const got = resolvedOrThrow(measured.landingUrl);
      expect(isSlug(got.slug)).toBe(true);
      expect(got.slug.length).toBeLessThanOrEqual(60);
      expect(got.key).toContain(name);
      expect(got.candidates[0]?.url).toContain(`/${name}.pdf`);
    });

    it("gives two names that share their first 60 characters different keys", () => {
      const shared = "Author_A_Very_Long_Title_That_Goes_On_And_On_Past_Sixty_Characters_Before_It";
      expect(shared.length).toBeGreaterThan(60);
      const one = resolvedOrThrow(`https://openaccess.thecvf.com/content/CVPR2023/html/${shared}_Ends_CVPR_2023_paper.html`);
      const two = resolvedOrThrow(`https://openaccess.thecvf.com/content/CVPR2023/html/${shared}_Stops_CVPR_2023_paper.html`);
      expect(one.key).not.toBe(two.key);
      expect(one.candidates[0]?.url).not.toBe(two.candidates[0]?.url);
      /* The slug is only a name: `freeSlug` tells two articles with one apart. */
      expect(isSlug(one.slug)).toBe(true);
      expect(isSlug(two.slug)).toBe(true);
    });

    it("cuts the slug of every source to what the store takes, however long the id", () => {
      const long = "a".repeat(80);
      for (const url of [
        `https://proceedings.mlr.press/v1/${long}.html`,
        `https://openaccess.thecvf.com/content/CVPR2023/html/${long}-.html`,
        `https://openaccess.thecvf.com/content/CVPR2023/html/${"a".repeat(55)}_____${long}.html`,
      ]) {
        const got = resolvedOrThrow(url);
        expect(isSlug(got.slug), got.slug).toBe(true);
        expect(got.slug.endsWith("-")).toBe(false);
      }
    });
  });
});

describe("no pasted text reaches a candidate address", () => {
  /** A good landing address of each source, and of each mirror, to bend. */
  const GOOD: [string, string[]][] = [
    ["https://arxiv.org/abs/2608.13566", ["arxiv.org"]],
    ["https://huggingface.co/papers/1706.03762", ["arxiv.org"]],
    ["https://www.alphaxiv.org/abs/1706.03762", ["arxiv.org"]],
    ...Object.values(SOURCE_CASES).flatMap((c) => c.shapes.map((shape): [string, string[]] => [shape, c.hosts])),
  ];

  /** Ways to bend one address. Most must stop resolving; any that still does must stay clean. */
  const bent = (good: string): string[] => {
    const u = new URL(good);
    const at = (pathname: string) => `${u.protocol}//${u.host}${pathname}`;
    const p = u.pathname;
    const stem = p.replace(/(\.html|\.pdf|\/)$/, "");
    const tail = p.slice(stem.length);
    return [
      good,
      good.toUpperCase(),
      `${good}?next=https://evil.example/x.pdf`,
      `${good}#https://evil.example/x.pdf`,
      `${good}?a=..%2f..%2f&b=@evil.example`,
      at(`${p}/..`),
      at(`${p}/../x`),
      at(`/x/..${p}`),
      at(`/x/%2e%2e${p}`),
      at(`/${p}`),
      at(p.replace(/\/(?=[^/]*$)/, "//")),
      at(`${stem}%2f..%2f..%2fetc${tail}`),
      at(`${stem}%2Fevil${tail}`),
      at(`${stem}@evil.example${tail}`),
      at(`${stem}\\evil${tail}`),
      at(`${stem}\\..\\..${tail}`),
      at(`${stem}%00${tail}`),
      at(`${stem} x${tail}`),
      at(`${stem}?${tail}`),
      at(`${stem};x=1${tail}`),
      at(`${stem}%252e%252e${tail}`),
      `${u.protocol}//evil.example@${u.host}${p}`,
      `${u.protocol}//${u.host}@evil.example${p}`,
      `${u.protocol}//${u.host}.evil.example${p}`,
      `${u.protocol}//evil.example/${u.host}${p}`,
      `${u.protocol}//evil.example/?u=${encodeURIComponent(good)}`,
      `${u.protocol}//${u.host}:8443${p}`,
      `${u.protocol}//${u.host}\\@evil.example${p}`,
    ];
  };

  it("for every bent address: null, or https on the source's own host with a plain path", () => {
    let resolved = 0;
    let refused = 0;
    for (const [good, hosts] of GOOD) {
      for (const url of bent(good)) {
        const got = resolvePaperSource(url);
        if (got === null) {
          refused += 1;
          continue;
        }
        resolved += 1;
        expect(isSlug(got.slug), url).toBe(true);
        for (const candidate of got.candidates) {
          const c = new URL(candidate.url);
          expect(c.protocol, url).toBe("https:");
          expect(hosts, url).toContain(c.host);
          expect(c.username + c.password + c.search + c.hash, url).toBe("");
          /* The address is exactly its origin and a plain path: nothing the
             parser had to tidy, no dot segment, no doubled slash. */
          expect(candidate.url, url).toBe(`https://${c.host}${c.pathname}`);
          expect(c.pathname, url).toMatch(/^[A-Za-z0-9._/-]+$/);
          expect(c.pathname, url).not.toMatch(/\/\.{1,2}(\/|$)|\/\//);
          /* And it is still this source's paper. */
          expect(resolvePaperSource(candidate.url)?.key, url).toBe(got.key);
        }
      }
    }
    /* Both arms ran: a sweep in which nothing resolved, or nothing was refused, proves nothing. */
    expect(resolved).toBeGreaterThan(GOOD.length);
    expect(refused).toBeGreaterThan(GOOD.length * 5);
  });
});
