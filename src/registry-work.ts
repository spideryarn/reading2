/**
 * **A registry's record as a Citations or Debate row keeps it, and the guards
 * that read one back** — plan 261001a stages 5 and 6
 * (docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md).
 *
 * Pure and client-safe: the panels, the public projection and the two steps
 * all read a stored row through `readRegistryWork` / `readCitationRegistry`,
 * because nothing revalidates stored JSON on its way out of the database and a
 * hand-edit or an older shape must draw as *no record*, never crash a panel.
 *
 * What is kept is bounded here, once: a registry may list a hundred authors of
 * two hundred characters each, and eighty rows of that is not a row's worth.
 */
import type { CitationRegistry, RegistrySource, RegistryWork } from "./types.js";

/**
 * The part of stage 1's `WorkRecord` (src/bibliographic.ts) a row keeps —
 * written out rather than imported, so the client's type graph does not reach
 * the server's fetch path through this file.
 */
export interface RecordFields {
  source: RegistrySource;
  title: string;
  authors: readonly { family: string; given?: string }[];
  year?: number;
  venue?: string;
}

/** Authors kept on a row; the rest are counted in `moreAuthors`. */
export const REGISTRY_AUTHORS_KEPT = 12;
const NAME_CAP = 100;
const TITLE_CAP = 300;
const VENUE_CAP = 200;

/** What a reader is told the record came from. A `Record`, so a third registry is a compile error here. */
export const REGISTRY_NAME: Record<RegistrySource, string> = { crossref: "Crossref", datacite: "DataCite" };

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** A stage-1 record, bounded, as a row keeps it. The DOI is the row's own address and is not repeated. */
export function registryWorkOf(record: RecordFields): RegistryWork {
  const kept = record.authors.slice(0, REGISTRY_AUTHORS_KEPT).map((a) =>
    a.given === undefined ? { family: cap(a.family, NAME_CAP) } : { family: cap(a.family, NAME_CAP), given: cap(a.given, NAME_CAP) },
  );
  const more = record.authors.length - kept.length;
  return {
    source: record.source,
    title: cap(record.title, TITLE_CAP),
    authors: kept,
    ...(more > 0 ? { moreAuthors: more } : {}),
    ...(record.year !== undefined ? { year: record.year } : {}),
    ...(record.venue !== undefined ? { venue: cap(record.venue, VENUE_CAP) } : {}),
  };
}

function isSource(value: unknown): value is RegistrySource {
  return value === "crossref" || value === "datacite";
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() !== "" ? cap(value, max) : null;
}

/**
 * **A stored record, rebuilt field by field, or null** — the one reader. Also
 * the public projection's: what it returns is exactly the named fields, so an
 * extra key on a stored row cannot ride through.
 */
export function readRegistryWork(value: unknown): RegistryWork | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!isSource(v.source)) return null;
  const title = str(v.title, TITLE_CAP);
  if (title === null || !Array.isArray(v.authors)) return null;
  const authors: RegistryWork["authors"] = [];
  for (const raw of v.authors.slice(0, REGISTRY_AUTHORS_KEPT)) {
    if (typeof raw !== "object" || raw === null) continue;
    const family = str((raw as { family?: unknown }).family, NAME_CAP);
    if (family === null) continue;
    const given = str((raw as { given?: unknown }).given, NAME_CAP);
    authors.push(given === null ? { family } : { family, given });
  }
  const more = v.moreAuthors;
  const year = v.year;
  const venue = str(v.venue, VENUE_CAP);
  return {
    source: v.source,
    title,
    authors,
    ...(typeof more === "number" && Number.isInteger(more) && more > 0 ? { moreAuthors: more } : {}),
    ...(typeof year === "number" && Number.isInteger(year) && year >= 1500 && year <= 2100 ? { year } : {}),
    ...(venue !== null ? { venue } : {}),
  };
}

/** Citations' field read back: `found` through `readRegistryWork`, `conflict` with its source, else null. */
export function readCitationRegistry(value: unknown): CitationRegistry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as { kind?: unknown; source?: unknown };
  if (v.kind === "conflict") return isSource(v.source) ? { kind: "conflict", source: v.source } : null;
  if (v.kind !== "found") return null;
  const work = readRegistryWork(value);
  return work === null ? null : { kind: "found", ...work };
}

/** One author as a by-line names them: `Ashish Vaswani`, or an organisation's name alone. */
export function registryAuthorName(author: RegistryWork["authors"][number]): string {
  return author.given === undefined ? author.family : `${author.given} ${author.family}`;
}

/** Every kept author, comma-separated, and *et al.* when the registry lists more. Empty when none. */
export function registryAuthorsText(work: RegistryWork): string {
  const names = work.authors.map(registryAuthorName);
  if (names.length === 0) return "";
  return work.moreAuthors ? `${names.join(", ")} et al.` : names.join(", ");
}
