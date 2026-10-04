/**
 * **A DOI as part of an address, and back.**
 *
 * A DOI's suffix is opaque: it may hold `%`, `\`, brackets and dot segments,
 * and pasted into a path as written some of those change which work the
 * address names — `a%2Fb` is read back as `a/b`, a browser turns `\` into `/`
 * and folds `a/../x` to `x`. So every doi.org address is built by `doiUrl`,
 * and whoever needs the DOI out of one again asks `doiOfUrl` rather than
 * slicing the string. docs/plans/261004j-encode-dois-in-link-addresses.md.
 *
 * **This file imports nothing**, so the browser can use it and so can
 * src/citations.ts, which src/bibliographic.ts already reaches by way of
 * src/cited-in-spideryarn.ts.
 */

const DOI_ORG = "https://doi.org/";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** UTF-8 cannot represent a lone surrogate. Refuse it before choosing a DOI link. */
export function doiIsEncodable(doi: string): boolean {
  return !LONE_SURROGATE.test(doi);
}

/** Encoded dots still fold in a URL parser; escape their preceding slash instead. */
function protectDotSegments(path: string): string {
  return path.replace(/\/(?=\.\.?(?:\/|$))/g, "%2F");
}

/**
 * The doi.org address of one DOI.
 *
 * **Only what is not a legal path character is escaped**, so an ordinary DOI —
 * a colon, parentheses, plus and a semicolon included — keeps its spelling.
 * Square brackets and non-ASCII characters are encoded. `encodeURI` does that
 * for everything but `?` and `#`, which it keeps because it encodes a whole
 * address. A slash in front of a `.` or `..` segment is escaped too, which is the DOI Foundation's own
 * advice: the dots cannot be, because a URL parser reads `%2e%2e` as `..`.
 * Malformed UTF-16 throws rather than silently substituting a different DOI.
 */
export function doiUrl(doi: string): string {
  const path = encodeURI(doi)
    .replace(/\?/g, "%3F")
    .replace(/#/g, "%23");
  return `${DOI_ORG}${protectDotSegments(path)}`;
}

/**
 * The DOI a `doiUrl` address was built from — or null for any other address.
 * Decodes the whole opaque DOI once, not individual path segments. Legacy
 * links with valid percent escapes are ambiguous: `a%2Fb` now reads as `a/b`,
 * even if an old writer intended a literal `%2F`. Without encoding provenance
 * that cannot be distinguished from an encoded link. Malformed escapes leave
 * the entire path unchanged, including any otherwise valid escapes in it.
 */
export function doiOfUrl(url: string): string | null {
  if (!url.startsWith(DOI_ORG)) return null;
  const path = url.slice(DOI_ORG.length);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * A DOI inside a registry's API address, each segment encoded and the slashes
 * kept except before dot segments: Crossref, DataCite and OpenAlex take
 * `/works/10.1038/nn.4304` as written. Dot segments must survive URL parsing too.
 */
export function doiPath(doi: string): string {
  return protectDotSegments(doi.split("/").map(encodeURIComponent).join("/"));
}
