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
 * § `src/paper-sources.ts`: the registry.
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
  /** The id with the version the link carried, if it carried one. Lower-case. */
  versionedId: string;
  /** The id of the work, never a version. Lower-case. */
  workId: string;
  /** The address the paper is known by. */
  canonicalUrl: string;
  /** What `urlKey` (src/ingest.ts) answers for `canonicalUrl`, so every shape of the link is one article. */
  key: string;
  /** Passes `isSlug` (src/ingest.ts): lower-case, `[a-z0-9-]` only. */
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

const ARXIV_HOSTS: ReadonlySet<string> = new Set(["arxiv.org", "www.arxiv.org", "export.arxiv.org", "browse.arxiv.org"]);
const DOI_HOSTS: ReadonlySet<string> = new Set(["doi.org", "dx.doi.org"]);

/** `/abs/<id>`, `/html/<id>`, `/format/<id>`, `/pdf/<id>` and `/pdf/<id>.pdf`; nothing before or after. */
const ARXIV_PATH = new RegExp(
  `^/(?:(?:abs|html|format)/(${ARXIV_ID_PATTERN})(v\\d+)?|pdf/(${ARXIV_ID_PATTERN})(v\\d+)?(?:\\.pdf)?)/?$`,
  "i",
);
/** arXiv's own DOI, the only DOI that names its paper without a fetch. */
const ARXIV_DOI_PATH = new RegExp(`^/10\\.48550/arxiv\\.(${ARXIV_ID_PATTERN})(v\\d+)?/?$`, "i");

/**
 * The addresses to try for one arXiv paper, in order of preference.
 *
 * **The PDF only, for now.** arXiv's HTML reads better where it exists, but its
 * LaTeXML pages have faults the extract step does not yet handle, so the HTML
 * candidate goes in front in a later stage of plan 261005l (§ Stage: the HTML
 * arm's faults, and HTML first). That stage adds this line above the PDF's:
 *
 *   { url: `https://arxiv.org/html/${versionedId}`, expect: "html", marker: "ltx_document" },
 */
function arxivCandidates(versionedId: string): readonly PaperCandidate[] {
  return [{ url: `https://arxiv.org/pdf/${versionedId}`, expect: "pdf" }];
}

/**
 * The id a parsed address names, on arXiv or at arXiv's DOI.
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
  }
  if (id === undefined) return null;
  const workId = id.toLowerCase();
  return { versionedId: `${workId}${(version ?? "").toLowerCase()}`, workId };
}

const arxiv: PaperSource = {
  name: "arxiv",
  resolve(url) {
    const id = arxivIdIn(url);
    if (id === null) return null;
    return {
      source: "arxiv",
      ...id,
      canonicalUrl: `https://arxiv.org/abs/${id.versionedId}`,
      key: `arxiv.org/abs/${id.versionedId}`,
      slug: `arxiv-${id.versionedId.replace(/[^a-z0-9]+/g, "-")}`,
      candidates: arxivCandidates(id.versionedId),
    };
  },
};

const SOURCES: readonly PaperSource[] = [arxiv];

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
