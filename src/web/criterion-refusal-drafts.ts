/**
 * Criteria the server refused before storing them, kept for this tab's next
 * visit or reload. Only ceiling refusals live here; a begin frame hands the
 * words to the server, and an explicit delete gives them up. No automatic POST.
 * The key names both the reader and article: another reader must never inherit
 * these words. Session storage is scoped to the tab, with no device sync.
 */
import { isSpideryarnId } from "../ids.js";
import { isDivergingScale, isRefereeCriterionKind } from "../referee-criteria.js";
import { isCriteriaAtCeiling } from "../referee-criteria-store.js";
import type { SavedCriterion } from "../saved-criteria.js";
import { storageReader } from "./lib/storage-reader.js";

function isDraft(value: unknown): value is SavedCriterion {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SavedCriterion>;
  if (!isSpideryarnId(row.id) || typeof row.criterion !== "string" ||
      typeof row.createdAt !== "string" || row.status !== "error" ||
      typeof row.error !== "string" || !isCriteriaAtCeiling(row.error) || !Array.isArray(row.results) ||
      row.results.length !== 0 || !row.config || !isRefereeCriterionKind(row.config.kind)) return false;
  return row.config.kind !== "diverging" ||
    (!!row.config.poles && typeof row.config.poles.against === "string" &&
      typeof row.config.poles.favour === "string" && isDivergingScale(row.config.scale));
}

export function criterionRefusalDrafts(slug: string, reader: string | null) {
  const key = `spideryarn.criterion-refusals.${JSON.stringify([storageReader(reader), slug])}`;
  // Retained by an in-flight send even after the hook's tombstones are cleared
  // on unmount. A late refusal must not save words the reader already deleted.
  const discarded = new Set<string>();
  function read(): SavedCriterion[] {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
      return Array.isArray(value) ? value.filter(isDraft) : [];
    } catch {
      // Disabled storage or a damaged record must not prevent reading or Retry.
      return [];
    }
  }
  function write(rows: SavedCriterion[]) {
    try {
      if (rows.length) sessionStorage.setItem(key, JSON.stringify(rows));
      else sessionStorage.removeItem(key);
    } catch {
      // The hook still holds the words on screen when storage is unavailable.
    }
  }
  function remove(id: string) {
    write(read().filter((draft) => draft.id !== id));
  }
  return {
    read,
    put(row: SavedCriterion, requireExisting = false) {
      if (discarded.has(row.id)) return;
      const current = read();
      // A newer hook may have discarded this retry's draft, or consumed it
      // after acceptance. An old response cannot re-create it in either case.
      if (requireExisting && !current.some((draft) => draft.id === row.id)) return;
      write([...current.filter((draft) => draft.id !== row.id), row]);
    },
    remove,
    discard(id: string) {
      discarded.add(id);
      remove(id);
    },
  };
}
