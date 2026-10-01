/**
 * **Is a cited work already an article here?** The pure half of Citations'
 * *In your library* / *On the public shelf* link — SPIDERYARN-READING2-5R,
 * docs/plans/260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md.
 *
 * It matches; it decides nothing about who may see what. The candidates it is
 * handed are already only the articles the reader may open — their own, or
 * public ones — and that is src/store/pg-cited-in-spideryarn.ts's `where`, not
 * a filter here. (That file also decides which of a stranger's URLs may be
 * matched against at all: only the one the public page itself publishes.)
 *
 * Identity, strongest first:
 *
 * - **doi / arxiv** — the work's identifier (`keysOf`, from the link code found
 *   in the article) is the one a candidate's address **is**: a `doi.org` path
 *   or an `arxiv.org` abstract/PDF path, parsed by host. Not a DOI anywhere in
 *   a URL — a publisher's query string or a lookalike host can carry somebody
 *   else's (GPT Sol, plan review).
 * - **address** — the work's own address and the candidate's ask a server for
 *   the same thing: `sameTarget`, unchanged, so `http` and `https` stay two
 *   pages as they do everywhere else. Never a Scholar search: that address is
 *   ours, not the work's.
 * - **title** — the same words by `keyWords` (which keeps "Part 1" apart from
 *   "Part 2") against the **extracted** title, never a reader's rename, which is
 *   a label and not an identity. At least `MIN_TITLE_WORDS` words and not
 *   contradicted by the first author; or one word fewer and the authors
 *   positively agree. The weakest, and the row says so.
 */

import { firstAuthor, keyWords, keysOf } from "./citations.js";
import type { Citations, CitedInSpideryarn, CitedMatchedBy, CitedWork } from "./types.js";
import { sameTarget } from "./urls.js";

/** Fewer words than this and a title needs its authors to agree before it is evidence. */
export const MIN_TITLE_WORDS = 4;

/** One article the reader may open, as the store hands it over. */
export interface CitedCandidate {
  slug: string;
  mine: boolean;
  /** The addresses it may be matched by — for a stranger's article, only its published source. */
  urls: readonly string[];
  /** The extracted title: what the document calls itself. Matched against. */
  matchTitle: string | null;
  /** What the reader would see it called: their own rename for theirs. Shown, never matched. */
  displayTitle: string | null;
  /** The extracted byline — a fact about the document, as on the public shelf. */
  byline: string | null;
}

const RANK: Record<CitedMatchedBy, number> = { doi: 0, arxiv: 1, address: 2, title: 3 };

/** A DOI as the resolver path carries it: `10.` + registrant + `/` + suffix. */
const DOI_BODY = "10\\.\\d{4,9}\\/[^\\s\"'<>?#]+";
/** A DOI resolver path, whole: no prefix/suffix that merely contains a DOI. */
const DOI_PATH = new RegExp(`^\\/(${DOI_BODY})$`, "i");
const ARXIV_ID = "(\\d{4}\\.\\d{4,5}|[a-z-]+(?:\\.[a-z]{2})?\\/\\d{7})";
/**
 * The same two shapes as a whole bare string — a DOI, or an arXiv id with an
 * optional version — for src/bibliographic.ts, so there is one parser of each
 * rather than two that drift.
 */
export const DOI_SHAPE = new RegExp(`^(${DOI_BODY})$`, "i");
export const ARXIV_ID_SHAPE = new RegExp(`^${ARXIV_ID}(?:v\\d+)?$`, "i");
const ARXIV_PAGE_PATH = new RegExp(`^/(?:abs|html)/${ARXIV_ID}(?:v\\d+)?/?$`, "i");
const ARXIV_PDF_PATH = new RegExp(`^/pdf/${ARXIV_ID}(?:v\\d+)?(?:\\.pdf)?/?$`, "i");

function decodedPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/** The DOI or arXiv id a candidate's address *is*, by host and path — or nothing. */
export function identityOf(url: string): { doi?: string; arxiv?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return {};
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return {};
  /* A non-default port is a different service, not the canonical resolver.
     Credentials are never part of a public resolver address either. */
  if (u.port !== "" || u.username !== "" || u.password !== "") return {};
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const path = decodedPath(u.pathname);
  if (path === null) return {};
  if (host === "doi.org" || host === "dx.doi.org" || host === "www.doi.org") {
    const doi = DOI_PATH.exec(path)?.[1];
    return doi === undefined ? {} : { doi: doi.toLowerCase() };
  }
  if (host === "arxiv.org" || host === "www.arxiv.org" || host === "export.arxiv.org") {
    const arxiv = ARXIV_PAGE_PATH.exec(path)?.[1] ?? ARXIV_PDF_PATH.exec(path)?.[1];
    return arxiv === undefined ? {} : { arxiv: arxiv.toLowerCase() };
  }
  return {};
}

/** How this work matches this candidate, or null. The strongest rule wins. */
export function matchOf(
  work: Pick<CitedWork, "title" | "authors" | "year" | "url" | "linkFrom">,
  candidate: CitedCandidate,
): CitedMatchedBy | null {
  const { idKey } = keysOf(work);
  if (idKey !== null) {
    for (const url of candidate.urls) {
      const id = identityOf(url);
      if (id.doi !== undefined && idKey === `doi:${id.doi}`) return "doi";
      if (id.arxiv !== undefined && idKey === `arxiv:${id.arxiv}`) return "arxiv";
    }
  }
  if (work.linkFrom !== "search" && work.url && candidate.urls.some((u) => sameTarget(work.url, u))) {
    return "address";
  }
  if (!work.title || !candidate.matchTitle) return null;
  const title = keyWords(work.title);
  if (title === "" || title !== keyWords(candidate.matchTitle)) return null;
  const words = title.split(" ").length;
  const authors = authorsAgree(work.authors, candidate.byline);
  if (words >= MIN_TITLE_WORDS && authors !== "disagree") return "title";
  if (words === MIN_TITLE_WORDS - 1 && authors === "agree") return "title";
  return null;
}

/**
 * **Do the authors agree?** A word of the work's first author (three letters or
 * more, so an initial does not count) in the article's byline. `unknown` when
 * either side names nobody — an uploaded PDF often has no byline — which does
 * not contradict a long title, and does not corroborate a short one.
 */
export function authorsAgree(
  authors: string | undefined,
  byline: string | null,
): "agree" | "disagree" | "unknown" {
  const first = keyWords(firstAuthor(authors))
    .split(" ")
    .filter((w) => w.length >= 3);
  if (first.length === 0 || !byline) return "unknown";
  const by = new Set(keyWords(byline).split(" "));
  return first.some((w) => by.has(w)) ? "agree" : "disagree";
}

/**
 * At most one article per work: the strongest match, then the reader's own copy
 * before a public one, then slug order — so the answer never depends on the
 * order the database returned rows in.
 */
export function matchCited(
  works: readonly CitedWork[],
  candidates: readonly CitedCandidate[],
): Map<string, CitedInSpideryarn> {
  const out = new Map<string, CitedInSpideryarn>();
  for (const work of works) {
    let best: { c: CitedCandidate; by: CitedMatchedBy } | null = null;
    for (const c of candidates) {
      const by = matchOf(work, c);
      if (by === null) continue;
      if (best === null || better({ c, by }, best)) best = { c, by };
    }
    if (best !== null) {
      out.set(work.id, {
        slug: best.c.slug,
        whose: best.c.mine ? "yours" : "public",
        matchedBy: best.by,
        title: best.c.displayTitle ?? best.c.matchTitle ?? best.c.slug,
      });
    }
  }
  return out;
}

function better(
  a: { c: CitedCandidate; by: CitedMatchedBy },
  b: { c: CitedCandidate; by: CitedMatchedBy },
): boolean {
  if (RANK[a.by] !== RANK[b.by]) return RANK[a.by] < RANK[b.by];
  if (a.c.mine !== b.c.mine) return a.c.mine;
  return a.c.slug < b.c.slug;
}

/**
 * The owner's citations response with `inSpideryarn` on each matched row.
 * Read-time only, like `lookup` and `investigation`: never stored.
 */
export function withCitedInSpideryarn<R extends { citations: Citations }>(
  found: R,
  candidates: readonly CitedCandidate[],
): R {
  const matches = matchCited(found.citations.citations, candidates);
  if (matches.size === 0) return found;
  return {
    ...found,
    citations: {
      ...found.citations,
      citations: found.citations.citations.map((work) => {
        const match = matches.get(work.id);
        return match === undefined ? work : { ...work, inSpideryarn: match };
      }),
    },
  };
}
