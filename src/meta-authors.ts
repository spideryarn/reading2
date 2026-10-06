/**
 * **The authors a page declares in its metadata, every one of them.**
 *
 * Readability builds its byline from a `name → content` map of `<meta>` tags,
 * one value per name, last write wins — so a page that repeats `dc.creator`
 * once per author keeps only the last. Greg's 25-author Nature paper came back
 * as "Hasson, Uri" on 2026-09-28. Readability does not read `citation_author`
 * at all, which is the tag every scholarly publisher emits once per author for
 * Google Scholar, so PLOS fell through to the first link in its author list and
 * arXiv to its submission dateline.
 *
 * `metaAuthors` reads the document **before** Readability does, because
 * Readability mutates it: every `citation_author`, else a *repeated*
 * `dc.creator` (a single one Readability already reads correctly). Then
 * `chooseByline` keeps Readability's byline wherever it already names every one
 * of those authors — a page with a full JSON-LD author list, like Frontiers, is
 * left exactly as it was — and replaces it only where it has dropped somebody.
 * A page with none of these tags gets Readability's byline unchanged, **unless
 * it is a LaTeXML page**, whose authors are in its title block rather than its
 * metadata (`latexmlAuthorNames`, src/latexml.ts) and take the same path.
 *
 * docs/plans/260928b-multi-author-bylines-from-citation-meta.md;
 * docs/postmortems/260928a-a-library-field-that-holds-one-value-for-a-list-keeps-one.md.
 */
import { AUTHOR_LIMITS } from "./authors.js";
import { latexmlAuthorNames } from "./latexml.js";
import type { Author } from "./types.js";

/**
 * `dc.creator` in the spellings publishers use, compared lower-cased with `.`
 * for `:`. `dcterm` as well as `dcterms`, because Readability reads `dcterm:`.
 */
const DC_CREATOR = new Set(["dc.creator", "dcterms.creator", "dcterm.creator"]);

/**
 * `citation_author_institution`, and the older Highwire spelling. Each belongs
 * to the nearest `citation_author` before it — the convention Nature and PLOS
 * both follow, measured 2026-09-29. One before any author belongs to nobody
 * and is dropped.
 */
const CITATION_INSTITUTION = new Set(["citation_author_institution", "citation_author_affiliation"]);

/**
 * Every author the page's metadata declares, with the affiliations it declares
 * for each, in document order and natural order — or `null`.
 * docs/plans/260929d-authors-and-affiliations-at-import-shown-and-linked.md § 2.
 */
export function metaAuthors(doc: Document): Author[] | null {
  const citation: Author[] = [];
  const dc: Author[] = [];
  for (const el of Array.from(doc.querySelectorAll("meta[name][content]"))) {
    const name = (el.getAttribute("name") ?? "").trim().toLowerCase().replace(/:/g, ".");
    const content = el.getAttribute("content") ?? "";
    if (name === "citation_author") citation.push({ name: content, affiliations: [] });
    else if (CITATION_INSTITUTION.has(name)) citation.at(-1)?.affiliations.push(content);
    else if (DC_CREATOR.has(name)) dc.push({ name: content, affiliations: [] });
  }
  const fromCitation = cleaned(citation);
  if (fromCitation.length > 0) return naturalAuthors(fromCitation);
  const fromDc = cleaned(dc);
  if (fromDc.length > 1) return naturalAuthors(fromDc);
  /* A single dc.creator, or another author meta tag Readability understands,
     is already its byline source. The LaTeXML title block is a fallback only
     for a page that declares nobody there. */
  if (fromDc.length === 1 || hasAuthorMetadata(doc)) return null;
  /* A LaTeXML page (arXiv's HTML, ar5iv) declares nobody in its metadata and
     everybody in its title block. Names only, in the page's order and as
     written: they are already given-name first. src/latexml.ts. */
  const fromLatexml = cleaned((latexmlAuthorNames(doc) ?? []).map((name) => ({ name, affiliations: [] })));
  return fromLatexml.length > 0 ? fromLatexml : null;
}

/** Any non-empty author/creator meta declaration, in Readability's spellings. */
function hasAuthorMetadata(doc: Document): boolean {
  return Array.from(doc.querySelectorAll("meta[content]")).some((el) => {
    if ((el.getAttribute("content") ?? "").trim() === "") return false;
    const key = (el.getAttribute("name") || el.getAttribute("property") || "").trim().toLowerCase();
    return /(?:^|[.:_-])(?:author|creator)$/u.test(key);
  });
}

/**
 * The declared list inside `AUTHOR_LIMITS` — the first hundred authors, ten
 * affiliations each, and no value longer than a name or an address runs to.
 * Applied before the byline is built from it, so the cap holds for every
 * prompt's `BY:` line too.
 */
function withinLimits(authors: Author[]): Author[] {
  const { maxAuthors, maxAffiliations, maxNameChars, maxAffiliationChars } = AUTHOR_LIMITS;
  return authors
    .filter((a) => a.name.length <= maxNameChars)
    .slice(0, maxAuthors)
    .map((a) => ({
      name: a.name,
      affiliations: a.affiliations.filter((x) => x.length <= maxAffiliationChars).slice(0, maxAffiliations),
    }));
}

/** `inNaturalOrder` over the names, the affiliations kept beside the name they belong to. */
function naturalAuthors(authors: readonly Author[]): Author[] {
  const names = inNaturalOrder(authors.map((a) => a.name));
  return authors.map((a, i) => ({ name: names[i] ?? a.name, affiliations: a.affiliations }));
}

/**
 * Whitespace collapsed, empties and case-insensitive repeats dropped — a
 * repeated author's affiliations merged into the first, since a publisher that
 * lists somebody twice has usually split their institutions across the two.
 */
function cleaned(raw: readonly Author[]): Author[] {
  const byKey = new Map<string, Author>();
  const out: Author[] = [];
  for (const author of raw) {
    const name = squash(author.name);
    const key = name.toLowerCase();
    if (name === "") continue;
    const affiliations = author.affiliations.map(squash).filter((a) => a !== "");
    const seen = byKey.get(key);
    if (seen) {
      for (const a of affiliations) if (!seen.affiliations.includes(a)) seen.affiliations.push(a);
      continue;
    }
    const kept: Author = { name, affiliations: [...new Set(affiliations)] };
    byKey.set(key, kept);
    out.push(kept);
  }
  return withinLimits(out);
}

const squash = (s: string) => s.replace(/\s+/gu, " ").trim();

/** `Jr.`, `III`, `PhD` — what follows a comma without being a given name. */
const SUFFIX = /^(jr|sr|[ivx]+|phd|md|dphil|esq)\.?$/i;

/** Words that make a comma-separated value an organization rather than a person's name. */
const ORGANISATION_WORDS = new Set([
  "agency",
  "center",
  "centre",
  "collaboration",
  "committee",
  "company",
  "consortium",
  "corporation",
  "council",
  "department",
  "foundation",
  "group",
  "hospital",
  "institute",
  "institution",
  "laboratory",
  "network",
  "project",
  "society",
  "team",
  "university",
]);

/**
 * `["Nastase, Samuel A.", "Liu, Yun-Fei"]` → `["Samuel A. Nastase", "Yun-Fei Liu"]`.
 *
 * **Decided for the list, not per name.** A comma alone does not say which way
 * round a name is — Google Scholar accepts `Smith, John` and `John Smith` both,
 * and `John Smith, Jr.` has a comma too. So the list is flipped only when every
 * name in it has the `Surname, Given` shape; one name that does not means the
 * publisher's own order is kept for all of them. The shape is one comma, at
 * most three words either side (so `van der Berg, Eva` flips), no suffix after
 * the comma, and no organization word on either side. GPT Sol, 2026-09-28, who
 * found `Jr. John Smith` and the organizational-author case.
 */
export function inNaturalOrder(names: readonly string[]): string[] {
  const flipped = names.map(flip);
  return flipped.every((n) => n !== null) ? (flipped as string[]) : [...names];
}

/** `"Nastase, Samuel A."` → `"Samuel A. Nastase"`, or `null` if it is not that shape. */
function flip(name: string): string | null {
  const parts = name.split(",").map((p) => p.trim());
  if (parts.length !== 2) return null;
  const [surname, given] = parts as [string, string];
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const organizational = fold(name)
    .split(" ")
    .some((word) => ORGANISATION_WORDS.has(word));
  if (
    surname === "" ||
    given === "" ||
    words(surname) > 3 ||
    words(given) > 3 ||
    SUFFIX.test(given) ||
    organizational
  ) {
    return null;
  }
  return `${given} ${surname}`;
}

/**
 * **Readability's byline where it already names everybody, the declared list
 * where it does not.**
 *
 * "Names everybody" means each author's full name appears as consecutive words
 * in Readability's byline, diacritics and case folded. `Tingting Wu, Xiaorong
 * Hou, …` from JSON-LD passes and stays byte-identical. A surname alone is not
 * evidence: `May` can occur in a dateline, which is one of the wrong bylines
 * this module exists to replace. An author whose folded name is empty also
 * cannot prove anything.
 */
export function chooseByline(authors: readonly string[] | null, readability: string | undefined): string | undefined {
  if (!authors || authors.length === 0) return readability;
  if (readability) {
    const haystack = ` ${fold(readability)} `;
    const namesEverybody = authors.every((author) => {
      const name = fold(author);
      return name !== "" && haystack.includes(` ${name} `);
    });
    if (namesEverybody) return readability;
  }
  return bylineFromAuthors(authors);
}

/** What may sit between names in a byline without being somebody. */
const BYLINE_GLUE = new Set(["and", "by", "with"]);

/**
 * **The structured list, but only when it is the whole byline.**
 *
 * `chooseByline` can keep Readability's byline when it already names every
 * declared author — and that byline can name *more* people than were declared:
 * one `citation_author` beside a complete JSON-LD list is the case its tests
 * hold. Storing the one-name list beside the two-name byline would have the
 * masthead show fewer authors than the byline it replaces. So the list is kept
 * when the byline is the one built from it, or when taking every declared
 * name out of the byline leaves only separators; otherwise the byline is left
 * to stand alone, as it did before 260929d.
 */
export function authorsForByline(authors: Author[] | null, byline: string | undefined): Author[] | null {
  if (!authors || authors.length === 0 || !byline) return null;
  if (byline === bylineFromAuthors(authors.map((a) => a.name))) return authors;
  let rest = ` ${fold(byline)} `;
  for (const author of authors) {
    const name = fold(author.name);
    if (name === "" || !rest.includes(` ${name} `)) return null;
    rest = rest.replace(` ${name} `, " ");
  }
  const leftover = rest.split(" ").filter((w) => w !== "" && !BYLINE_GLUE.has(w));
  return leftover.length === 0 ? authors : null;
}

/** Lower-cased, diacritics stripped, every run of non-letters a single space. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * **Joined with `"; "`, not `", "`.** `authorKeys` in src/referee-candidates.ts
 * — Referee mode's own-author exclusion — splits people on `;` and reads a
 * two-part comma segment as `Surname, Given`, so `"Jane Doe, John Smith"` would
 * be one person called "John Smith Jane Doe". A semicolon is unambiguous to it,
 * to the model prompts that see `BY:`, and to a reader.
 */
export function bylineFromAuthors(names: readonly string[]): string {
  return names.join("; ");
}
