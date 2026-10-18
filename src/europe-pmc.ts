/**
 * **Finding a refused paper's free copy at Europe PMC**: which paper an address
 * names, and whether Europe PMC holds it open access.
 *
 * docs/plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md
 * § Stage 1, and GPT Sol's S6 on it. Greg's reply `spya-qy8mgg`, 2026-10-18:
 * *"try Europe PMC first and then fall back to the bookmarklet"*.
 *
 * Three steps, each through a fixed door in src/fetch.ts, and each able to say
 * "no" without throwing:
 *
 * ```
 *  the refused address  ──paperIdsInUrl──▶  a DOI, or an Elsevier PII
 *  a PII                ──doiForPii──────▶  its DOI (Crossref, the one item whose alternative-id is it)
 *  a DOI                ──openPmcidForDoi▶  a PMCID that is open access and in Europe PMC, or nothing
 * ```
 *
 * `findOpenCopy` is the chain; src/pipeline.ts § `fetchByAddress` calls it
 * only when a site has refused us, and fetches the copy as the Europe PMC paper
 * source (src/paper-sources.ts § `europePmcPaper`).
 *
 * **Narrow on purpose.** A DOI is read only off the routes the 261017a sample
 * showed, host by host, and never by stripping a suffix: DOI suffixes are
 * opaque, so `/doi/10.x/y.pdf` is looked up as the DOI `10.x/y.pdf` and,
 * if no such paper exists, simply misses (src/work-id.ts § `withoutPageSuffix`
 * has the same rule). A wrong identification can only miss, because Europe
 * PMC's answer must name the same DOI back.
 */

import {
  type BibliographicFetchOptions,
  fetchBibliographicJson,
  fetchEuropePmc,
} from "./fetch.js";
import { doiFor, identityOf, parseWorkId } from "./work-id.js";

/** One identifier read off an address. */
export type PaperId = { kind: "doi"; doi: string } | { kind: "pii"; pii: string };

/** Whether an address is on the public web at exactly one of these hosts: no port, no credentials. */
function isAt(url: URL, hosts: readonly string[]): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.port !== "" || url.username !== "" || url.password !== "") return false;
  return hosts.includes(url.hostname.toLowerCase());
}

/**
 * The routes that carry a DOI, by host. Each was seen refusing us in the
 * 261017a sample (docs/investigations/261017a-evidence/sample.tsv); the DOI is
 * the whole of the rest of the path.
 */
const DOI_ROUTES: readonly { hosts: readonly string[]; route: RegExp }[] = [
  /* Atypon's `/doi/<doi>`, and its rendering prefixes (`/doi/full/…`, `/doi/abs/…`). */
  {
    hosts: [
      "onlinelibrary.wiley.com",
      "www.tandfonline.com",
      "tandfonline.com",
      "journals.sagepub.com",
      "www.pnas.org",
      "pnas.org",
      "www.science.org",
      "science.org",
      "pubs.acs.org",
      "www.nejm.org",
      "nejm.org",
    ],
    route: /^\/doi\/(?:(?:full|abs|pdf|epdf)\/)?(10\.\d{4,9}\/.+)$/i,
  },
  /* Springer's `/article/<doi>`. */
  { hosts: ["link.springer.com"], route: /^\/article\/(10\.\d{4,9}\/.+)$/i },
];

/** An Elsevier PII, punctuated (`S1364-6613(15)00180-1`) or not (`S0010027713002497`). */
const PII = "S\\d{4}-?\\d{3}[\\dX]\\(?\\d{2}\\)?\\d{5}-?[\\dX]";
const PII_ROUTES: readonly { hosts: readonly string[]; route: RegExp }[] = [
  { hosts: ["www.sciencedirect.com", "sciencedirect.com"], route: new RegExp(`^/science/article/(?:abs/)?pii/(${PII})/?$`, "i") },
  /* Cell Press: `/fulltext/<pii>` and `/<journal>/fulltext/<pii>` (or `abstract`). */
  { hosts: ["www.cell.com", "cell.com"], route: new RegExp(`^/(?:[a-z-]{1,40}/)?(?:fulltext|abstract)/(${PII})/?$`, "i") },
  /* The Lancet: `/journals/<journal>/article/PII<pii>/fulltext`. */
  {
    hosts: ["www.thelancet.com", "thelancet.com"],
    route: new RegExp(`^/journals/[a-z-]{1,40}/article/PII(${PII})/(?:fulltext|abstract)$`, "i"),
  },
];

function decodedPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/** A PII as Crossref's `alternative-id` spells it: punctuation gone, upper-case. */
function compactPii(pii: string): string {
  return pii.replace(/[-()]/g, "").toUpperCase();
}

/**
 * **The paper an address names, as far as its address alone says** — a DOI, or
 * an Elsevier PII — or nothing. Pure.
 *
 * A `doi.org` link is read by `identityOf` (src/work-id.ts), the one parser of
 * an identifier out of an address. Every DOI goes through `parseWorkId`, so a
 * shape it refuses is not looked up.
 */
export function paperIdsInUrl(url: string): PaperId[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const found = identityOf(url).doi;
  if (found !== undefined) return doiId(found);
  const path = decodedPath(u.pathname);
  if (path === null) return [];
  for (const { hosts, route } of DOI_ROUTES) {
    if (!isAt(u, hosts)) continue;
    const doi = route.exec(path)?.[1];
    if (doi !== undefined) return doiId(doi);
  }
  for (const { hosts, route } of PII_ROUTES) {
    if (!isAt(u, hosts)) continue;
    const pii = route.exec(path)?.[1];
    if (pii !== undefined) return [{ kind: "pii", pii: compactPii(pii) }];
  }
  return [];
}

function doiId(raw: string): PaperId[] {
  const id = parseWorkId(`doi:${raw}`);
  return id === null || !id.startsWith("doi:") ? [] : [{ kind: "doi", doi: doiFor(id) }];
}

/** Every identifier the addresses carry, each once, in the order given. */
export function paperIdsInUrls(urls: readonly string[]): PaperId[] {
  const seen = new Set<string>();
  const out: PaperId[] = [];
  for (const url of urls) {
    for (const id of paperIdsInUrl(url)) {
      const key = id.kind === "doi" ? `doi:${id.doi}` : `pii:${id.pii}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
  }
  return out;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * **A PII's DOI, from Crossref**, or `null`. Asked by the PII with its
 * punctuation removed (the punctuated form finds nothing, measured 2026-10-18),
 * and believed only when exactly one work answers **and** that work's own
 * `alternative-id` is this PII (GPT Sol's S6): a filter that matched loosely
 * would otherwise hand us somebody else's paper.
 */
export async function doiForPii(pii: string, options: BibliographicFetchOptions = {}): Promise<string | null> {
  const wanted = compactPii(pii);
  const url = `https://api.crossref.org/works?filter=alternative-id:${encodeURIComponent(wanted)}&rows=2&select=DOI,alternative-id`;
  const items = record(record(await fetchBibliographicJson(url, options))?.message)?.items;
  if (!Array.isArray(items) || items.length !== 1) return null;
  const item = record(items[0]);
  const alternatives = item?.["alternative-id"];
  if (!Array.isArray(alternatives) || !alternatives.some((a) => typeof a === "string" && compactPii(a) === wanted)) {
    return null;
  }
  const doi = item?.DOI;
  if (typeof doi !== "string") return null;
  const id = parseWorkId(`doi:${doi}`);
  return id === null ? null : doiFor(id);
}

/**
 * **The PMCID of a DOI's open-access copy in Europe PMC**, or `null`.
 *
 * The first search result whose own `doi` is ours (case-insensitively), and
 * which is open access, in Europe PMC, and has a PMCID. A paper with a PMCID
 * that is not in the open-access subset — the Neuron paper of the 261017a
 * sample — is `null` here, before its full text answers 500.
 */
export async function openPmcidForDoi(doi: string, options: BibliographicFetchOptions = {}): Promise<string | null> {
  const query = encodeURIComponent(`DOI:"${doi}"`);
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&resultType=lite&pageSize=5`;
  const results = record(record(await fetchEuropePmc(url, "json", options))?.resultList)?.result;
  if (!Array.isArray(results)) return null;
  for (const raw of results) {
    const hit = record(raw);
    if (hit === null) continue;
    if (typeof hit.doi !== "string" || hit.doi.toLowerCase() !== doi.toLowerCase()) continue;
    if (hit.isOpenAccess !== "Y" || hit.inEPMC !== "Y") continue;
    if (typeof hit.pmcid === "string" && /^PMC\d{1,9}$/.test(hit.pmcid)) return hit.pmcid;
  }
  return null;
}

/**
 * What the chain found, and if nothing, where it stopped — fixed words, for
 * the log line (src/pipeline.ts). No address and no identifier.
 */
export type OpenCopy =
  | { found: true; pmcid: string; idKind: PaperId["kind"] }
  | {
      found: false;
      idKind: PaperId["kind"] | null;
      endedAt: "no-identifier" | "no-doi-for-pii" | "no-open-copy" | "lookup-failed";
    };

/**
 * **The chain**: the first identifier the addresses carry that leads to an
 * open-access copy. A lookup that fails — a timeout, a 503, an answer of the
 * wrong shape — is a miss like any other, because the caller's answer to a miss
 * is the original refusal, unchanged.
 */
export async function findOpenCopy(urls: readonly string[], options: BibliographicFetchOptions = {}): Promise<OpenCopy> {
  const ids = paperIdsInUrls(urls);
  if (ids.length === 0) return { found: false, idKind: null, endedAt: "no-identifier" };
  let last: OpenCopy = { found: false, idKind: null, endedAt: "no-identifier" };
  for (const id of ids) {
    if (options.signal?.aborted) return last;
    try {
      const doi = id.kind === "doi" ? id.doi : await doiForPii(id.pii, options);
      if (doi === null) {
        last = { found: false, idKind: id.kind, endedAt: "no-doi-for-pii" };
        continue;
      }
      const pmcid = await openPmcidForDoi(doi, options);
      if (pmcid !== null) return { found: true, pmcid, idKind: id.kind };
      last = { found: false, idKind: id.kind, endedAt: "no-open-copy" };
    } catch {
      last = { found: false, idKind: id.kind, endedAt: "lookup-failed" };
    }
  }
  return last;
}
