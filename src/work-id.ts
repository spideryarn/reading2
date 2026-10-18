/**
 * **A cited work's identifier, as pure string work** — the `WorkId`, the one
 * parser of a DOI or arXiv id in any spelling (`parseWorkId`), the one parser
 * of an identifier out of an address (`identityOf`), and the address built back
 * from it (`evidenceUrl`).
 *
 * **A leaf on purpose, because a stranger's door reaches it.** A visitor's DTO
 * (src/public/dto.ts) shows a cited work's note through
 * src/citation-blurbs-identity.ts § `shownBlurb`, which re-parses the stored
 * id and rebuilds its address. These lived in src/bibliographic.ts,
 * src/cited-in-spideryarn.ts and src/citation-evidence.ts until 2026-10-18,
 * and importing them from there pulled the registry fetches, the Bibliography
 * writer and the model gateway into the public import graph
 * (tests/public-imports.test.ts;
 * docs/postmortems/261018b-a-guard-that-lives-in-a-suite-the-change-never-touched.md).
 * Nothing here may import anything but other leaves: src/paper-sources.ts and
 * src/doi-url.ts are pure strings too.
 */

import { doiUrl } from "./doi-url.js";
import { ARXIV_ID_PATTERN, arxivIdOf } from "./paper-sources.js";

/**
 * `doi:<lower-cased doi>` or `arxiv:<lower-cased id, no version>` — the same
 * spelling `keysOf` in src/bibliography.ts gives a work's `idKey`, so a Bibliography
 * row's key is already a `WorkId` once it has been through `parseWorkId`.
 *
 * Branded, so a string that has not been parsed cannot reach `lookupWork` — a
 * malformed identifier is refused by the compiler before it can be refused at
 * run time (which `lookupWork` also does).
 */
export type WorkId = string & { readonly __workId: true };

/** A DOI as the resolver path carries it: `10.` + registrant + `/` + suffix. */
const DOI_BODY = "10\\.\\d{4,9}\\/[^\\s\"'<>?#]+";
/** A DOI resolver path, whole: no prefix/suffix that merely contains a DOI. */
const DOI_PATH = new RegExp(`^\\/(${DOI_BODY})$`, "i");
/** The id pattern itself lives in src/paper-sources.ts — one copy; this is it as a capture group. */
const ARXIV_ID = `(${ARXIV_ID_PATTERN})`;
/**
 * The same two shapes as a whole bare string — a DOI, or an arXiv id with an
 * optional version — for src/bibliographic.ts, so there is one parser of each
 * rather than two that drift.
 */
export const DOI_SHAPE = new RegExp(`^(${DOI_BODY})$`, "i");
export const ARXIV_ID_SHAPE = new RegExp(`^${ARXIV_ID}(?:v\\d+)?$`, "i");

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
  /* **arXiv is asked of the registry** (src/paper-sources.ts § `arxivIdOf`), so
     every address it knows as an arXiv paper is one here: arXiv's own pages
     and PDFs, and the pages *about* a paper on Hugging Face and alphaXiv. This
     had a parser of its own until 2026-10-06, which knew fewer shapes
     (docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md
     § The arXiv mirrors are arXiv).

     It is asked about the host without a trailing dot and the path decoded, as
     that parser read them. A decoded path with anything in it but an id's own
     characters is refused first, because handing `?`, `#` or `\` back to a URL
     parser would turn part of the path into something else. arXiv's DOI never
     reaches here: `doi.org` answered above, as a DOI. */
  if (!/^[A-Za-z0-9._/-]*$/.test(path)) return {};
  const arxiv = arxivIdOf(`${u.protocol}//${host}${path}`);
  return arxiv === null ? {} : { arxiv: arxiv.workId };
}

/** DOIs are case-insensitive and in practice ASCII; anything else is refused rather than guessed. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const MAX_ID_LENGTH = 300;

/**
 * A publisher's page suffix glued onto a DOI by a copied address —
 * `10.1101/2020.06.26.174482v2.full.pdf` from bioRxiv, `….1.full` from a
 * journal. Neither registry knows those spellings (both 404'd in the 261001a
 * probe). Only the two observed publisher shapes are rewritten. DOI suffixes
 * are opaque, so a generic DOI ending `.pdf`, `.full` or `v2` is left alone.
 * A wrong strip is still caught downstream, where the registry's title must
 * agree with the citation's.
 */
const BIORXIV_STEM = "10\\.1101\\/(?:\\d{4}\\.\\d{2}\\.\\d{2}\\.)?\\d+";
const BIORXIV_PAGE = new RegExp(`^(${BIORXIV_STEM})(?:v\\d+)?\\.(?:full\\.pdf|full-text|full|abstract|short|pdf)$`, "i");
const BIORXIV_VERSION = new RegExp(`^(${BIORXIV_STEM})v\\d+$`, "i");
/* BioOne's observed article route. Keep this narrow: a DOI suffix is opaque,
   so a generic `.full`/`.pdf` rule can silently rewrite a real DOI. */
const BIOONE_PAGE = /^(10\.1636\/[a-z]+(?:-[a-z]+)*-\d{2}-\d{3}\.\d+)\.(?:full(?:\.pdf)?|abstract|short|pdf)$/i;

function withoutPageSuffix(doi: string): string {
  return doi.replace(BIORXIV_PAGE, "$1").replace(BIORXIV_VERSION, "$1").replace(BIOONE_PAGE, "$1");
}

function doiId(raw: string): WorkId | null {
  const doi = withoutPageSuffix(raw);
  const m = DOI_SHAPE.exec(doi);
  if (!m?.[1] || !PRINTABLE_ASCII.test(m[1])) return null;
  const id = `doi:${m[1].toLowerCase()}`;
  return id.length <= MAX_ID_LENGTH ? (id as WorkId) : null;
}

function arxivId(arxiv: string): WorkId | null {
  const m = ARXIV_ID_SHAPE.exec(arxiv);
  return m?.[1] ? (`arxiv:${m[1].toLowerCase()}` as WorkId) : null;
}

/**
 * A DOI or arXiv id in any of the spellings a caller holds, as a `WorkId` — or
 * null. Accepts `doi:10.…`, a bare `10.…`, a `doi.org` address, `arxiv:…`, a
 * bare arXiv id (either shape, any version) and an `arxiv.org` abs/pdf address.
 * The address forms go through `identityOf` above, the one parser of an
 * identifier out of an address.
 */
export function parseWorkId(input: string): WorkId | null {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) {
    const found = identityOf(s);
    if (found.doi !== undefined) return doiId(found.doi);
    if (found.arxiv !== undefined) return arxivId(found.arxiv);
    return null;
  }
  const prefixed = /^(doi|arxiv):\s*(.+)$/i.exec(s);
  if (prefixed?.[1] && prefixed[2]) {
    return prefixed[1].toLowerCase() === "doi" ? doiId(prefixed[2]) : arxivId(prefixed[2]);
  }
  return doiId(s) ?? arxivId(s);
}

/** The DOI a lookup asks a registry about: the DOI itself, or arXiv's own at DataCite. */
export function doiFor(id: WorkId): string {
  if (id.startsWith("doi:")) return id.slice("doi:".length);
  return `10.48550/arxiv.${id.slice("arxiv:".length)}`;
}

/**
 * **Semantic Scholar's own id for a paper: forty lower-case hex characters**
 * (its `paperId`, a SHA-1). Checked where the cascade reads it and again
 * where a note is shown (src/citation-blurbs-identity.ts § `shownBlurb`),
 * because it becomes part of a link on the reader's screen. Plan 261018o.
 */
export function isSemanticScholarPaperId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

/** A registry negative is worth asking again after this long: the registry cache's own miss lifetime (G9). */
export const REGISTRY_NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function arxivUrl(id: WorkId): string {
  return `https://arxiv.org/abs/${id.slice("arxiv:".length)}`;
}

/**
 * **The work's address, built by code from its identifier** — arxiv.org for an
 * arXiv id, doi.org for a DOI. The one builder: for the evidence a note is
 * written from, and for every read that shows the note
 * (src/citation-blurbs-identity.ts § `shownBlurb`), so a stored address is
 * never passed through to a reader.
 */
export function evidenceUrl(workId: WorkId): string {
  return workId.startsWith("arxiv:") ? arxivUrl(workId) : doiUrl(doiFor(workId));
}
