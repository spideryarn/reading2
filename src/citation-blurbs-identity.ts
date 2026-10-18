/**
 * **What a cited work's note is fingerprinted by, and when the step that
 * writes them is current** — the pure half of src/citation-blurbs.ts, apart so
 * the metadata page's freshness read (src/store/pg.ts § `isCurrent`) and stage
 * 3c's read-time attach can ask the same questions without importing a model
 * call. Plan 261017h stage 3: docs/plans/261017h-stage-3-design-citation-blurbs.md
 * § 1–2, as amended by its design review (G1, G2, G8, G9).
 *
 * ```
 * a row ─► rowIdentity (id, title, authors, year, url + linkFrom, registry kind + source)
 * every row, in list order, + CITATION_BLURBS_VALIDATION_VERSION ─► citationBlurbsInputHash
 * ```
 *
 * **Not the Bibliography's `sourceHash`**, so a list made again with the same
 * works leaves its notes current; and **not the row's `why`, relevance or
 * mentions**, which say how the article uses a work, not which work it is.
 */

import { createHash } from "node:crypto";

import type {
  Bibliography,
  CitationBlurbEntry,
  CitationBlurbRegistryWhy,
  CitationBlurbs,
  CitationBlurbSentence,
  CitedWork,
  CitedWorkBlurb,
} from "./types.js";
import { evidenceUrl, parseWorkId, REGISTRY_NEGATIVE_TTL_MS } from "./work-id.js";

/** One sentence by default; a second only when the abstract separately supports it (G4). */
export const BLURB_MAX_SENTENCES = 2;
/** The whole note, both sentences together. */
export const BLURB_MAX_CHARS = 400;
/**
 * A supporting quote's ceiling in characters, for the read guard only: the
 * writer's rule is 6–30 words (src/citation-blurbs.ts), and thirty long words
 * fit well inside this.
 */
export const BLURB_QUOTE_MAX_CHARS = 400;

/**
 * The writer's prompt and the schema it answers in — the stamp's
 * `promptVersion`, stored as the artefact's `version` (G1). Bump it when the
 * wording changes: unforced runs then write every note again, and an old note
 * stays on screen until they do (design § 2, *Attach by identity only*).
 */
export const CITATION_BLURBS_PROMPT_VERSION = "citation-blurbs/1";

/**
 * **The checks a note must pass to be kept** (G8): the quote rules, the length
 * rules and the support check's prompt. Bump it when any of them changes:
 * every stored note is then detached on screen and written again, because a
 * note that passed weaker checks is not one we would show today.
 */
export const CITATION_BLURBS_VALIDATION_VERSION = "citation-blurbs-checks/1";

/** What the identity is computed over, by name, so the hash input is a closed list. */
export type IdentityRow = Pick<CitedWork, "id" | "title" | "url" | "linkFrom"> &
  Partial<Pick<CitedWork, "authors" | "year" | "registry">>;

/** **Which work a row names**, as a short hash. The registry's verdict counts by kind and source only. */
export function rowIdentity(row: IdentityRow): string {
  const fields = [
    row.id,
    row.title,
    row.authors ?? null,
    row.year ?? null,
    row.url,
    row.linkFrom,
    row.registry?.kind ?? null,
    row.registry?.source ?? null,
  ];
  return createHash("sha256").update(JSON.stringify(fields), "utf8").digest("hex").slice(0, 16);
}

/** Every row's identity in list order, under the validation version: the stamp's `inputHash`. */
export function citationBlurbsInputHash(rows: readonly IdentityRow[]): string {
  const canonical = JSON.stringify([CITATION_BLURBS_VALIDATION_VERSION, rows.map(rowIdentity)]);
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/** The suffix on a stored `sourceHash` when some row ended transient (G2). */
export const PARTIAL_SUFFIX = ":partial";
/** The suffix on an *expected* hash when a stored registry negative is old enough to ask again (G9). */
export const RECHECK_SUFFIX = ":recheck";

const REGISTRY_WHYS: readonly CitationBlurbRegistryWhy[] = ["not-found", "no-abstract", "not-identified", "conflict"];

/**
 * **A registry's "nothing", old enough to ask again** (G9) — `not-found`,
 * `no-abstract`, `not-identified`, `conflict` once a week has passed. A
 * structural answer (a label, an unpublished work, no identity) never is.
 * An unreadable `checkedAt` is old: asking again is the safe way to be wrong.
 */
export function registryNegativeExpired(entry: CitationBlurbEntry, now: number): boolean {
  if (entry.state !== "no-evidence" || !(REGISTRY_WHYS as readonly string[]).includes(entry.why)) return false;
  const checkedAt = "checkedAt" in entry ? Date.parse(entry.checkedAt) : Number.NaN;
  return !Number.isFinite(checkedAt) || now - checkedAt >= REGISTRY_NEGATIVE_TTL_MS;
}

/**
 * **The `inputHash` a run today would aim at**: the identity hash, with
 * `RECHECK_SUFFIX` when a stored entry that still belongs to its row is a
 * registry negative past its week. That suffix is never written — the run
 * that asks again stamps the bare hash (or `:partial`) — so it can only ever
 * make a finished artefact read as not current, which is exactly what G9
 * needs: only a publication or a press starts a run, so nothing spins.
 */
export function citationBlurbsExpectedHash(
  rows: readonly IdentityRow[],
  stored: CitationBlurbs | null,
  now: number,
): string {
  const hash = citationBlurbsInputHash(rows);
  if (stored === null || typeof stored.entries !== "object" || stored.entries === null) return hash;
  const due = rows.some((row) => {
    const entry = Object.hasOwn(stored.entries, row.id) ? stored.entries[row.id] : undefined;
    return entry !== undefined && entry.identity === rowIdentity(row) && registryNegativeExpired(entry, now);
  });
  return due ? `${hash}${RECHECK_SUFFIX}` : hash;
}

/* ------------------------------------------------------------- the read -- */

const KINDS: readonly CitedWorkBlurb["kind"][] = ["author-abstract", "registry-reconstruction"];
const SOURCES: readonly CitedWorkBlurb["source"][] = ["crossref", "datacite", "openalex"];
const VIAS: readonly CitedWorkBlurb["via"][] = ["id", "title"];

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * **The one read guard: a stored entry as a reader may be shown it, or null.**
 * The owner's `loadBibliography` (src/store/pg.ts, through `attachBlurbs` below) and a
 * visitor's DTO (`publicCitedWork`, src/public/dto.ts) both call it, so the two
 * cannot show different notes for one row. Plan 261017h stage 3c; the design's
 * § 2 (*Attach by identity only*) as amended by G5 and G8.
 *
 * A note is shown only when **all** of these hold, and nothing is shown
 * otherwise — declined, no evidence, a failed check, a transient row (never
 * stored), and anything that does not read as a note:
 *
 * - `state` is `blurb`;
 * - its `identity` equals `rowIdentity` recomputed from the row **as the list
 *   stores it** (a list made again that changed the title, authors, year, link
 *   or registry verdict takes the note down);
 * - its `validationVersion` is today's (G8). **The prompt version and the
 *   model do not hide it**: a new prompt keeps a paid-for, checked note on
 *   screen until a run replaces it.
 *
 * And every field is rebuilt rather than passed through, because JSONB arrives
 * unchecked: one or two sentences, each a non-empty text and quote within the
 * caps; the three labels from their closed lists; `workId` re-parsed by
 * `parseWorkId`; **`url` built from it by `evidenceUrl`**, never the stored
 * one; `readAt` a moment that parses, written back as ISO. No hash, no model,
 * no versions leave here.
 */
export function shownBlurb(entry: unknown, row: IdentityRow): CitedWorkBlurb | null {
  const e = record(entry);
  if (e === null || e.state !== "blurb") return null;
  if (e.validationVersion !== CITATION_BLURBS_VALIDATION_VERSION) return null;
  if (typeof e.identity !== "string" || e.identity !== rowIdentity(row)) return null;

  if (!Array.isArray(e.sentences) || e.sentences.length === 0 || e.sentences.length > BLURB_MAX_SENTENCES) return null;
  const sentences: CitationBlurbSentence[] = [];
  for (const raw of e.sentences as unknown[]) {
    const s = record(raw);
    const text = typeof s?.text === "string" ? s.text.trim() : "";
    const quote = typeof s?.quote === "string" ? s.quote.trim() : "";
    if (text === "" || quote === "" || text.length > BLURB_MAX_CHARS || quote.length > BLURB_QUOTE_MAX_CHARS) return null;
    sentences.push({ text, quote });
  }
  if (sentences.reduce((n, s) => n + s.text.length, 0) + (sentences.length - 1) > BLURB_MAX_CHARS) return null;

  const ev = record(e.evidence);
  const kind = oneOf(ev?.kind, KINDS);
  const source = oneOf(ev?.source, SOURCES);
  const via = oneOf(ev?.via, VIAS);
  const workId = typeof ev?.workId === "string" ? parseWorkId(ev.workId) : null;
  const readAt = typeof ev?.readAt === "string" ? Date.parse(ev.readAt) : Number.NaN;
  if (kind === null || source === null || via === null || workId === null || !Number.isFinite(readAt)) return null;
  return { sentences, kind, source, via, workId, url: evidenceUrl(workId), readAt: new Date(readAt).toISOString() };
}

/** The stored artefact's `entries`, or null when the column holds nothing that reads as one. */
export function storedBlurbEntries(stored: unknown): Readonly<Record<string, unknown>> | null {
  return record(record(stored)?.entries);
}

/** The entry stored for one row id — own keys only, so `__proto__` or `constructor` is never an entry. */
export function storedBlurbEntry(entries: Readonly<Record<string, unknown>>, id: string): unknown {
  return Object.hasOwn(entries, id) ? entries[id] : undefined;
}

/**
 * **Put each cited work's note onto its row, at read time** — the owner's
 * `loadBibliography` (src/store/pg.ts). `stored` is the `citation_blurbs`
 * column as it came back, unread; `shownBlurb` decides each row, the guard a
 * visitor's DTO uses too, so the owner and a visitor are shown one rule.
 *
 * **The identity is recomputed from the row as the list stores it**
 * (`asStored`), not from `shown`, because the step fingerprinted the stored
 * row, and `attachFinds` (src/bibliography.ts) turns a searched row into a
 * `web` one — a different link — on the owner's read. Rows are matched by id.
 * A row that already carries a `blurb` (nothing writes one into the list, but
 * JSONB is unchecked) loses it unless the column gives it one.
 *
 * Here rather than beside `attachFinds` in src/bibliography.ts, where the
 * brief first put it, because that file importing this one closes an import
 * cycle (this → citation-evidence → citation-lookup → bibliography).
 */
export function attachBlurbs(
  shown: Bibliography,
  stored: unknown,
  asStored: readonly CitedWork[] = shown.citations,
): Bibliography {
  const entries = storedBlurbEntries(stored);
  const byId = new Map(asStored.map((row) => [row.id, row]));
  let changed = false;
  const works = shown.citations.map((work) => {
    const row = byId.get(work.id);
    const blurb = entries === null || row === undefined ? null : shownBlurb(storedBlurbEntry(entries, work.id), row);
    if (blurb === null) {
      if (!("blurb" in work)) return work;
      changed = true;
      const { blurb: _dropped, ...rest } = work;
      return rest;
    }
    changed = true;
    return { ...work, blurb };
  });
  return changed ? { ...shown, citations: works } : shown;
}
