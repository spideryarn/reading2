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
 * A page with none of these tags gets Readability's byline unchanged.
 *
 * docs/plans/260928b-multi-author-bylines-from-citation-meta.md;
 * docs/postmortems/260928a-a-library-field-that-holds-one-value-for-a-list-keeps-one.md.
 */

/**
 * `dc.creator` in the spellings publishers use, compared lower-cased with `.`
 * for `:`. `dcterm` as well as `dcterms`, because Readability reads `dcterm:`.
 */
const DC_CREATOR = new Set(["dc.creator", "dcterms.creator", "dcterm.creator"]);

/** Every author the page's metadata declares, in document order and natural order, or `null`. */
export function metaAuthors(doc: Document): string[] | null {
  const citation: string[] = [];
  const dc: string[] = [];
  for (const el of Array.from(doc.querySelectorAll("meta[name][content]"))) {
    const name = (el.getAttribute("name") ?? "").trim().toLowerCase().replace(/:/g, ".");
    const content = el.getAttribute("content") ?? "";
    if (name === "citation_author") citation.push(content);
    else if (DC_CREATOR.has(name)) dc.push(content);
  }
  const fromCitation = cleaned(citation);
  if (fromCitation.length > 0) return inNaturalOrder(fromCitation);
  const fromDc = cleaned(dc);
  return fromDc.length > 1 ? inNaturalOrder(fromDc) : null;
}

/** Whitespace collapsed, empties and case-insensitive repeats dropped. */
function cleaned(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const name = value.replace(/\s+/gu, " ").trim();
    const key = name.toLowerCase();
    if (name === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

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
