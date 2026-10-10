/**
 * **Debate's authors and year, from the registry** — plan 261001a stage 6
 * (docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md),
 * the item 260929h deferred (SPIDERYARN-READING2-5P).
 *
 * After the `debate` step's searches, each distinct source address that
 * **carries** an identifier is looked up through stage 1's `lookupWork`:
 *
 * - a `doi.org` path, or an `arxiv.org` abstract or PDF path — `parseWorkId`,
 *   which goes through `identityOf` (src/cited-in-spideryarn.ts), the one parser
 *   of an identifier out of an address;
 * - **a publisher path whose first segment is `doi`**, optionally followed by
 *   one of the view words publishers put there (`full`, `abs`, `pdf`, …), then
 *   the DOI — `pnas.org/doi/10.1073/…`, `onlinelibrary.wiley.com/doi/full/10.1111/…`,
 *   `dl.acm.org/doi/10.1145/…`. Nothing looser: a `10.` somewhere else in a
 *   path, or a `doi` segment further down it, is not an identifier we trust to
 *   be the page's own.
 *
 * **Kept only when the registry's title strongly agrees with the engine's
 * title for the page** — for every address, `doi.org` included, because a link
 * can be as mistyped as a reference. `titleNamesWork`
 * (src/citation-lookup.ts) anchors at the start, allows a site tail and matches
 * a title the engine cut short ("…") on its opening words; this file also
 * refuses generic titles and tails naming supplements or notices. A row with
 * no engine title gets nothing. **Never a title search**: a page with no
 * identifier is not looked up.
 *
 * Attached after the model's answer, so the stamp and `PROMPT_VERSION` are
 * untouched; existing debates get it on a re-run. As in Bibliography, a one-minute
 * budget stops new lookups from making the pipeline step unbounded.
 */
import { parseWorkId, type LookupResult, type WorkId } from "./bibliographic.js";
import {
  citationRegistryDeps,
  mapLimited,
  REGISTRY_CONCURRENCY,
  REGISTRY_LOOKUP_BUDGET_MS,
  registryTitleIsDistinctive,
  safeLookup,
  titlesDifferByObjectQualifier,
  type RegistryDeps,
} from "./citation-registry.js";
import { titleNamesWork } from "./citation-lookup.js";
import { registryWorkOf } from "./registry-work.js";
import type { ClaimReceptionRow, Reception, DirectReceptionRow, RegistryWork } from "./types.js";

/** The same registry Bibliography uses — one lookup, one cache. */
export const receptionRegistryDeps: RegistryDeps = citationRegistryDeps;

/** Words a publisher puts between `/doi/` and the DOI. Anything else there and the path is not read. */
const DOI_VIEWS = new Set(["full", "abs", "pdf", "epdf", "pdfdirect", "fulltext", "book", "reader", "epub"]);
/** Common subordinate-object DOI endings, not the article page the result purports to be. */
const SUBORDINATE_DOI_SUFFIX = /\.(?:s|fig|figure|table)\d+$/i;

/**
 * **The DOI a publisher's `/doi/…` path carries, or null.** The first path
 * segment must be `doi`; then at most one view word; then a segment starting
 * `10.` + digits, and the rest of the path as the suffix. The query string and
 * fragment are never read.
 */
export function publisherPathDoi(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.port !== "" || u.username !== "" || u.password !== "") return null;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  const segments = path.split("/").filter((s) => s !== "");
  if (segments[0]?.toLowerCase() !== "doi") return null;
  let i = 1;
  if (segments[i] !== undefined && DOI_VIEWS.has(segments[i]!.toLowerCase())) i++;
  const prefix = segments[i];
  const suffix = segments.slice(i + 1).join("/");
  if (prefix === undefined || !/^10\.\d{4,9}$/.test(prefix) || suffix === "") return null;
  if (SUBORDINATE_DOI_SUFFIX.test(suffix)) return null;
  return `${prefix}/${suffix}`;
}

/** The identifier a Debate source's address carries, or null. */
export function receptionWorkId(url: string): WorkId | null {
  const direct = parseWorkId(url);
  if (direct !== null) return direct;
  const doi = publisherPathDoi(url);
  return doi === null ? null : parseWorkId(`doi:${doi}`);
}

/** Does the registry's title agree with the engine's title for the page? Never without an engine title. */
export function receptionTitleAgrees(engineTitle: string | undefined, registryTitle: string): boolean {
  if (!engineTitle?.trim()) return false;
  return (
    titleNamesWork(engineTitle, registryTitle) !== null &&
    registryTitleIsDistinctive(registryTitle) &&
    !titlesDifferByObjectQualifier(engineTitle, registryTitle)
  );
}

export interface ReceptionRegistryCounts {
  /** Distinct addresses that carry an identifier. */
  identified: number;
  found: number;
  /** Found, and the title did not agree: not kept. */
  disagreed: number;
  notFound: number;
  unavailable: number;
  /** Identifiers the run's wall-time budget did not start. */
  overBudget: number;
}

/**
 * **The Reception artefact with each identified row's `registry` set, or cleared** — a row
 * keeps only this run's answer. Distinct addresses are asked once; the rows
 * are at most 24, so there is no cap beyond the groups' own.
 */
export async function attachReceptionRegistry(
  reception: Reception,
  deps: RegistryDeps,
): Promise<{ reception: Reception; counts: ReceptionRegistryCounts }> {
  const counts: ReceptionRegistryCounts = { identified: 0, found: 0, disagreed: 0, notFound: 0, unavailable: 0, overBudget: 0 };
  const rows = [...reception.direct.rows, ...reception.claims.rows];
  const idOf = new Map<string, WorkId>();
  for (const row of rows) {
    const id = receptionWorkId(row.url);
    if (id !== null) idOf.set(row.url, id);
  }
  const ids = [...new Set(idOf.values())];
  counts.identified = ids.length;
  const now = deps.now ?? Date.now;
  const began = now();
  const results = await mapLimited(
    ids,
    REGISTRY_CONCURRENCY,
    (id) => safeLookup(deps.lookup, id),
    () => now() - began < (deps.lookupBudgetMs ?? REGISTRY_LOOKUP_BUDGET_MS),
  );
  const answers = new Map<WorkId, LookupResult>();
  for (const [i, id] of ids.entries()) {
    const answer = results.values[i];
    if (answer !== undefined) answers.set(id, answer);
  }
  counts.overBudget = ids.length - results.started;
  for (const answer of answers.values()) {
    if (answer.kind === "found") counts.found++;
    else if (answer.kind === "not-found") counts.notFound++;
    else counts.unavailable++;
  }

  const judged = new Set<WorkId>();
  const withRegistry = <Row extends DirectReceptionRow | ClaimReceptionRow>(row: Row): Row => {
    const { registry: _previous, ...rest } = row;
    const id = idOf.get(row.url);
    const answer = id === undefined ? undefined : answers.get(id);
    if (id === undefined || answer?.kind !== "found") return rest as Row;
    const agrees = receptionTitleAgrees(row.title, answer.record.title);
    if (!agrees) {
      if (!judged.has(id)) counts.disagreed++;
      judged.add(id);
      return rest as Row;
    }
    judged.add(id);
    const registry: RegistryWork = registryWorkOf(answer.record);
    return { ...rest, registry } as Row;
  };
  return {
    reception: {
      ...reception,
      direct: { ...reception.direct, rows: reception.direct.rows.map(withRegistry) },
      /* A not-run claims group (`debate/7`) has no rows and stays as it is. */
      claims:
        reception.claims.pass === "not-run"
          ? reception.claims
          : { ...reception.claims, rows: reception.claims.rows.map(withRegistry) },
    },
    counts,
  };
}
