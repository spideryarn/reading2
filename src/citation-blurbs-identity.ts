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

import { REGISTRY_NEGATIVE_TTL_MS } from "./citation-evidence.js";
import type { CitationBlurbEntry, CitationBlurbRegistryWhy, CitationBlurbs, CitedWork } from "./types.js";

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
