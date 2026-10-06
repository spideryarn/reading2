/**
 * Paper sources: which pasted addresses name a paper we know how to fetch, and
 * what that paper is called whichever of its addresses was pasted.
 *
 * Pure string work — no network, no Node APIs, nothing heavy imported — so the
 * browser can import it too.
 *
 * **Adding a source is adding one object to `SOURCES`**, as long as the paper
 * and the addresses to try can be read off the pasted address. A source that is
 * only known after a fetch (a DOI that redirects to a publisher) does not fit
 * here.
 *
 * docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md
 * § `src/paper-sources.ts`: the registry. The sources after arXiv, and the
 * rules they all follow, are
 * docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md
 * § The rules every source here follows.
 */

export interface PaperCandidate {
  /** A fixed address built from the matched id — never text copied from the pasted address. */
  url: string;
  /** What the bytes must turn out to be for this candidate to count. */
  expect: "html" | "pdf";
  /** For HTML: a string the page must contain to be the paper rather than an error page. */
  marker?: string;
}

export interface ResolvedPaper {
  /** Which source recognised it: `"arxiv"`. */
  source: string;
  /** The id with the version the link carried, if it carried one. Lower-case for arXiv; the server's spelling elsewhere. */
  versionedId: string;
  /** The id of the work, never a version. Lower-case for arXiv; the server's spelling elsewhere. */
  workId: string;
  /** The address the paper is known by. */
  canonicalUrl: string;
  /** What `urlKey` (src/ingest.ts) answers for `canonicalUrl`, so every shape of the link is one article. */
  key: string;
  /** Passes `isSlug` (src/ingest.ts): lower-case, `[a-z0-9-]` only, at most `PAPER_SLUG_MAX` long. */
  slug: string;
  /** The addresses to try, in order of preference. */
  candidates: readonly PaperCandidate[];
}

export interface PaperSource {
  name: string;
  /** A parsed address → the paper it names, or null when it is not one of ours. */
  resolve(url: URL): ResolvedPaper | null;
}

/**
 * An arXiv id without its version, as regex source: new style (`2608.13566`)
 * or old (`hep-th/9901001`, `math.GT/0309136`). **The one copy** — a bare
 * alternation, so wrap it in a group, and match it case-insensitively.
 */
export const ARXIV_ID_PATTERN = "\\d{4}\\.\\d{4,5}|[a-z-]+(?:\\.[a-z]{2})?\\/\\d{7}";

/**
 * The longest slug `isSlug` (src/ingest.ts) accepts — its `MAX`. A copy, because
 * src/ingest.ts imports this file and the import cannot go both ways;
 * tests/paper-sources.test.ts fails if the two stop agreeing.
 */
export const PAPER_SLUG_MAX = 60;

/**
 * The same id, **bounded**, for the addresses this file resolves: an old-style
 * archive name is at most 16 characters. `ARXIV_ID_PATTERN` leaves it unbounded,
 * and that copy is left alone because src/cited-in-spideryarn.ts and
 * src/paper-text.ts share it and neither builds a slug from what it matches.
 *
 * Sixteen is twice the longest archive name known to whoever wrote this
 * (`cond-mat`, `astro-ph`, `chao-dyn`, `quant-ph` — eight each; not checked
 * against arXiv's full list of retired archives), and the subject class after
 * the dot is two letters (`math.GT`).
 */
const ARXIV_ID_BOUNDED = "\\d{4}\\.\\d{4,5}|[a-z-]{1,16}(?:\\.[a-z]{2})?\\/\\d{7}";
/**
 * A version: `v` and one to nine digits. arXiv has no paper near a thousand
 * versions, but a bound that refused `v1000` would send a real link back to the
 * abstract page; nine digits refuses nothing real and still closes the grammar.
 */
const ARXIV_VERSION = "v\\d{1,9}";
/* With both bounded, the longest slug the grammar can produce is 43 characters
   (`arxiv-` + 16 + `.xx` + `/` + 7 digits + `v` + 9 digits), well inside PAPER_SLUG_MAX.
   `arxivPaper` checks the length anyway, so widening either bound later cannot
   hand out a slug the store refuses. */

const ARXIV_HOSTS: ReadonlySet<string> = new Set(["arxiv.org", "www.arxiv.org", "export.arxiv.org", "browse.arxiv.org"]);
const DOI_HOSTS: ReadonlySet<string> = new Set(["doi.org", "dx.doi.org"]);
/**
 * Two sites whose page for a paper is a page *about* an arXiv paper, with the
 * arXiv id as its path. They are shapes of an arXiv address, not sources of
 * their own: the paper is the same paper, and arXiv is where it is fetched.
 */
const HUGGING_FACE_HOST = "huggingface.co";
const ALPHAXIV_HOSTS: ReadonlySet<string> = new Set(["alphaxiv.org", "www.alphaxiv.org"]);

/** `/abs/<id>`, `/html/<id>`, `/format/<id>`, `/pdf/<id>` and `/pdf/<id>.pdf`; nothing before or after. */
const ARXIV_PATH = new RegExp(
  `^/(?:(?:abs|html|format)/(${ARXIV_ID_BOUNDED})(${ARXIV_VERSION})?|pdf/(${ARXIV_ID_BOUNDED})(${ARXIV_VERSION})?(?:\\.pdf)?)/?$`,
  "i",
);
/** arXiv's own DOI, the only DOI that names its paper without a fetch. */
const ARXIV_DOI_PATH = new RegExp(`^/10\\.48550/arxiv\\.(${ARXIV_ID_BOUNDED})(${ARXIV_VERSION})?/?$`, "i");
/** `huggingface.co/papers/<id>`: nothing before or after, so a model, a dataset and the papers index are not papers. */
const HUGGING_FACE_PATH = new RegExp(`^/papers/(${ARXIV_ID_BOUNDED})(${ARXIV_VERSION})?/?$`, "i");
/** `alphaxiv.org/abs/<id>`, and `/overview/<id>`, which redirects to it (probed 2026-10-05). */
const ALPHAXIV_PATH = new RegExp(`^/(?:abs|overview)/(${ARXIV_ID_BOUNDED})(${ARXIV_VERSION})?/?$`, "i");

/**
 * The addresses to try for one arXiv paper, in order of preference.
 *
 * **arXiv's HTML first, its PDF when there is none.** The HTML is free to read
 * and takes seconds where the PDF costs about ten cents and two minutes, and
 * once src/latexml.ts was in it was the better article on all five papers
 * compared (docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md).
 * arXiv answers 404 for a paper its converter could not handle, which is what
 * sends the fetch step on to the PDF. The marker is LaTeXML's own document
 * class, so an error page served with a 200 is not taken for the paper.
 */
function arxivCandidates(versionedId: string): readonly PaperCandidate[] {
  return [
    { url: `https://arxiv.org/html/${versionedId}`, expect: "html", marker: "ltx_document" },
    { url: `https://arxiv.org/pdf/${versionedId}`, expect: "pdf" },
  ];
}

/**
 * The id a parsed address names: on arXiv, at arXiv's DOI, or on a mirror page
 * about the paper (Hugging Face's paper pages, alphaXiv).
 *
 * It matches an origin, not a hostname: a non-default port is some other
 * service, and credentials are never part of a public address. The query and
 * the fragment are not read at all, so tracking parameters cannot matter.
 */
function arxivIdIn(url: URL): { versionedId: string; workId: string } | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.port !== "" || url.username !== "" || url.password !== "") return null;
  const host = url.hostname.toLowerCase();
  let id: string | undefined;
  let version: string | undefined;
  if (ARXIV_HOSTS.has(host)) {
    const m = ARXIV_PATH.exec(url.pathname);
    id = m?.[1] ?? m?.[3];
    version = m?.[2] ?? m?.[4];
  } else if (DOI_HOSTS.has(host)) {
    const m = ARXIV_DOI_PATH.exec(url.pathname);
    id = m?.[1];
    version = m?.[2];
  } else if (host === HUGGING_FACE_HOST || ALPHAXIV_HOSTS.has(host)) {
    const m = (host === HUGGING_FACE_HOST ? HUGGING_FACE_PATH : ALPHAXIV_PATH).exec(url.pathname);
    id = m?.[1];
    version = m?.[2];
  }
  if (id === undefined) return null;
  const workId = id.toLowerCase();
  return { versionedId: `${workId}${(version ?? "").toLowerCase()}`, workId };
}

/**
 * The arXiv paper with this id — exactly what the arXiv source answers for any
 * of its addresses, so another source (a mirror of arXiv) can hand back the same
 * paper without copying the object.
 *
 * **`null` when the slug would not pass `isSlug`'s length rule.** An id from
 * `arxivIdOf` never gets there, because the grammar above is bounded; an id
 * built some other way might, and a `ResolvedPaper` whose slug the store
 * refuses is worse than no paper — `slugFromUrl` would return it and
 * `POST /api/jobs` would answer 400. `null` sends the address down the ordinary
 * path instead.
 */
export function arxivPaper(id: { versionedId: string; workId: string }): ResolvedPaper | null {
  const slug = `arxiv-${id.versionedId.replace(/[^a-z0-9]+/g, "-")}`;
  if (slug.length > PAPER_SLUG_MAX) return null;
  return {
    source: "arxiv",
    versionedId: id.versionedId,
    workId: id.workId,
    canonicalUrl: `https://arxiv.org/abs/${id.versionedId}`,
    key: `arxiv.org/abs/${id.versionedId}`,
    slug,
    candidates: arxivCandidates(id.versionedId),
  };
}

const arxiv: PaperSource = {
  name: "arxiv",
  resolve(url) {
    const id = arxivIdIn(url);
    return id === null ? null : arxivPaper(id);
  },
};

/* --------------------------------------------------------------------------
   The sources after arXiv. Every one follows the same rules
   (docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md
   § The rules every source here follows), and tests/paper-sources.test.ts holds
   each of them to it for every source:

   - It matches an origin: http or https, the named host, no port, no credentials.
   - Every candidate is a fixed `https://` string on the source's own host, built
     only from pieces a closed character class matched. No pattern lets through a
     dot segment, a percent sign, a backslash or a second slash.
   - The landing page and the PDF's own address resolve to the same paper, and so
     does every candidate: the article's address afterwards is where its bytes
     came from, and "do we already have this?" asks that address.
   - Every candidate is the paper, as a PDF. The landing page is never one: a
     stub stored under the paper's key could not be replaced by pasting the PDF.
   - The key is what `urlKey` gave the landing page before the source existed,
     and holds the whole id. The slug is cut to fit `isSlug`.
   - A name keeps the case the address spelled it in, in the key and in the
     candidate, because these servers are case-sensitive. ACL's ids are the one
     exception, and say why.

   These sites have no versions in their addresses, so `versionedId` and
   `workId` are the same id.
   -------------------------------------------------------------------------- */

/** Whether an address is on the public web at exactly one of these hosts: no port, no credentials. */
function isAt(url: URL, hosts: ReadonlySet<string>): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.port !== "" || url.username !== "" || url.password !== "") return false;
  return hosts.has(url.hostname.toLowerCase());
}

/** A slug from a source's name and an id of any length: lower-case, single dashes, cut to fit, no dash at either end. */
function slugOf(source: string, id: string): string {
  return `${source}-${id}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, PAPER_SLUG_MAX)
    .replace(/-+$/, "");
}

/** One paper of a source that has no versions: the landing page it is known by, and its PDFs in order. */
function paperAt(source: string, id: string, slugFrom: string, landing: string, pdfs: readonly string[]): ResolvedPaper {
  const address = new URL(landing);
  return {
    source,
    versionedId: id,
    workId: id,
    canonicalUrl: landing,
    key: `${address.hostname}${address.pathname.replace(/\/$/, "")}`,
    slug: slugOf(source, slugFrom),
    candidates: pdfs.map((url) => ({ url, expect: "pdf" })),
  };
}

const ACL_HOSTS: ReadonlySet<string> = new Set(["aclanthology.org"]);
/**
 * An ACL Anthology id: old style (`N19-1423`) or new (`2020.acl-main.703`).
 * Matched case-insensitively and then spelled the one way the Anthology serves
 * it, an upper-case letter on the old style and lower case on the new, because
 * a DOI is case-insensitive and a reader's link may carry either.
 */
const ACL_ID = "[a-z]\\d{2}-\\d{4}|\\d{4}\\.[a-z0-9]{1,30}(?:-[a-z0-9]{1,30}){0,3}\\.\\d{1,5}";
/** `/<id>`, `/<id>/` and `/<id>.pdf`; nothing before or after. */
const ACL_PATH = new RegExp(`^/(${ACL_ID})(?:/|\\.pdf)?$`, "i");
/** The Anthology's own DOI prefix, whose suffix is the id. */
const ACL_DOI_PATH = new RegExp(`^/10\\.18653/v1/(${ACL_ID})$`, "i");

const acl: PaperSource = {
  name: "acl",
  resolve(url) {
    const matched = isAt(url, ACL_HOSTS)
      ? ACL_PATH.exec(url.pathname)?.[1]
      : isAt(url, DOI_HOSTS)
        ? ACL_DOI_PATH.exec(url.pathname)?.[1]
        : undefined;
    if (matched === undefined) return null;
    const lower = matched.toLowerCase();
    const id = /^[a-z]/.test(lower) ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
    return paperAt("acl", id, id, `https://aclanthology.org/${id}/`, [`https://aclanthology.org/${id}.pdf`]);
  },
};

const PMLR_HOSTS: ReadonlySet<string> = new Set(["proceedings.mlr.press"]);
/** `/v<N>/<name>.html`, `/v<N>/<name>.pdf` and `/v<N>/<name>/<name>.pdf`, the name the same both times. */
const PMLR_PATH = /^\/v(\d{1,4})\/([A-Za-z0-9][A-Za-z0-9_-]{0,80})(?:\.html|\.pdf|\/\2\.pdf)$/;

const pmlr: PaperSource = {
  name: "pmlr",
  resolve(url) {
    const m = isAt(url, PMLR_HOSTS) ? PMLR_PATH.exec(url.pathname) : null;
    const volume = m?.[1];
    const name = m?.[2];
    if (volume === undefined || name === undefined) return null;
    const id = `v${volume}/${name}`;
    const base = `https://proceedings.mlr.press/${id}`;
    /* Two layouts, and which a volume uses cannot be read off the address:
       probed 2026-10-05, v139 serves the nested one and v37 only the flat one. */
    return paperAt("pmlr", id, id, `${base}.html`, [`${base}/${name}.pdf`, `${base}.pdf`]);
  },
};

const NEURIPS_HOSTS: ReadonlySet<string> = new Set(["proceedings.neurips.cc", "papers.nips.cc"]);
/**
 * The abstract page (`/hash/<hash>-Abstract….html`) and the paper
 * (`/file/<hash>-Paper….pdf`), under `/paper/` or `/paper_files/paper/`.
 *
 * **The ending is read off the link and never guessed.** The file is
 * `-Paper.pdf` in some years and `-Paper-Conference.pdf` or
 * `-Paper-Datasets_and_Benchmarks.pdf` in others, and the abstract page's own
 * name carries the same ending. The wrong one answers 404 (probed 2026-10-05).
 */
const NEURIPS_PATH =
  /^\/(?:paper_files\/)?paper\/(\d{4})\/(?:hash\/([0-9a-f]{32})-Abstract(?:-([A-Za-z0-9_]{1,40}))?\.html|file\/([0-9a-f]{32})-Paper(?:-([A-Za-z0-9_]{1,40}))?\.pdf)$/;

const neurips: PaperSource = {
  name: "neurips",
  resolve(url) {
    const m = isAt(url, NEURIPS_HOSTS) ? NEURIPS_PATH.exec(url.pathname) : null;
    const year = m?.[1];
    const hash = m?.[2] ?? m?.[4];
    if (year === undefined || hash === undefined) return null;
    const track = m?.[3] ?? m?.[5];
    const ending = track === undefined ? "" : `-${track}`;
    const base = `https://proceedings.neurips.cc/paper_files/paper/${year}`;
    return paperAt("neurips", `${year}/${hash}`, `${year}-${hash}`, `${base}/hash/${hash}-Abstract${ending}.html`, [
      `${base}/file/${hash}-Paper${ending}.pdf`,
    ]);
  },
};

const CVF_HOSTS: ReadonlySet<string> = new Set(["openaccess.thecvf.com"]);
/**
 * `/<collection>/html/<name>.html` and `/<collection>/papers/<name>.pdf`. The
 * collection is written two ways, `content_cvpr_2016` and `content/ICCV2021`.
 * A name runs to 90 characters and more.
 */
const CVF_PATH =
  /^\/(content_[A-Za-z0-9_]{1,40}|content\/[A-Za-z0-9_]{1,40})\/(?:html\/([A-Za-z0-9_-]{1,200})\.html|papers\/([A-Za-z0-9_-]{1,200})\.pdf)$/;

const cvf: PaperSource = {
  name: "cvf",
  resolve(url) {
    const m = isAt(url, CVF_HOSTS) ? CVF_PATH.exec(url.pathname) : null;
    const collection = m?.[1];
    const name = m?.[2] ?? m?.[3];
    if (collection === undefined || name === undefined) return null;
    const base = `https://openaccess.thecvf.com/${collection}`;
    return paperAt("cvf", `${collection}/${name}`, name, `${base}/html/${name}.html`, [`${base}/papers/${name}.pdf`]);
  },
};

const JMLR_HOSTS: ReadonlySet<string> = new Set(["jmlr.org", "www.jmlr.org"]);
/** `/papers/v<N>/<name>.html` and `/papers/volume<N>/<name>/<name>.pdf`, the name the same both times. */
const JMLR_PATH =
  /^\/papers\/(?:v(\d{1,4})\/([A-Za-z0-9][A-Za-z0-9-]{0,60})\.html|volume(\d{1,4})\/([A-Za-z0-9][A-Za-z0-9-]{0,60})\/\4\.pdf)$/;

const jmlr: PaperSource = {
  name: "jmlr",
  resolve(url) {
    const m = isAt(url, JMLR_HOSTS) ? JMLR_PATH.exec(url.pathname) : null;
    const volume = m?.[1] ?? m?.[3];
    const name = m?.[2] ?? m?.[4];
    if (volume === undefined || name === undefined) return null;
    const id = `v${volume}/${name}`;
    return paperAt("jmlr", id, id, `https://jmlr.org/papers/${id}.html`, [
      `https://jmlr.org/papers/volume${volume}/${name}/${name}.pdf`,
    ]);
  },
};

/**
 * In order, though no address is recognised by two: each source names its own
 * hosts, and the one host two of them share (`doi.org`) is told apart by the
 * DOI's prefix.
 */
const SOURCES: readonly PaperSource[] = [arxiv, acl, pmlr, neurips, cvf, jmlr];

function parsed(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The paper this address names, or null for anything unparseable or not a source we know. */
export function resolvePaperSource(url: string): ResolvedPaper | null {
  const u = parsed(url);
  if (u === null) return null;
  for (const source of SOURCES) {
    const found = source.resolve(u);
    if (found !== null) return found;
  }
  return null;
}

/** The arXiv id an address names, with and without its version — or null. */
export function arxivIdOf(url: string): { versionedId: string; workId: string } | null {
  const u = parsed(url);
  return u === null ? null : arxivIdIn(u);
}
