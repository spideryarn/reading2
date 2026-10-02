/**
 * **Terms the reader added to their own glossary**, and how they sit beside
 * the model's list — docs/plans/261002f-glossary-add-a-looked-up-term.md.
 *
 * An added term is a `glossary_lookups` row with `added_name` set: the name
 * the reader typed into *Look up a term*, and the explanation they read. It is
 * never in the glossary document, so *Find more* cannot merge it away and the
 * public read (which reads only the document) cannot publish it. The owner's
 * read seam (`loadGlossary`, src/store/pg.ts) and the write
 * (`pgGlossaryLookupStore.addTerm`) both build the owner's list here, so the
 * list the write checks "already there" against is the list the reader sees.
 *
 * Type-only imports and the matcher: pure, so a test needs no database.
 */

import { formsOf, termPattern, termSpans } from "./term-match.js";
import type { GlossaryEntry } from "./types.js";

/** One `glossary_lookups` row, as far as this file cares. */
export interface LookupRowIds {
  entryId: string;
  /** Non-null exactly when the reader added this term. */
  addedName: string | null;
}

/**
 * **Does this entry name exactly these words?** Some form of it — name or
 * alias, under the shared matcher's folding — matches the whole of `text`, not
 * just part of it. *Attention* does not cover *attention head*; *attention
 * heads* does, because the matcher folds the plural.
 */
export function coversWholly(
  entry: { name: string; aliases?: readonly string[] },
  text: string,
): boolean {
  const pattern = termPattern(formsOf(entry));
  if (!pattern) return false;
  const whole = text.trim();
  return termSpans(whole, pattern).some((s) => s.start === 0 && s.end === whole.length);
}

/** The entry an added row stands for. `blocks` is filled in by the caller's relocate. */
function addedEntry(entryId: string, name: string): GlossaryEntry {
  return { id: entryId, name, kind: "term", aliases: [], blocks: [], added: true };
}

export interface OwnersEntries {
  /** The model's entries, then the reader's added ones that no model entry already names. */
  entries: GlossaryEntry[];
  /**
   * An added term a later model entry now names, keyed by the model entry's id
   * — so the reader's explanation can follow it there rather than vanish with
   * the row that is no longer drawn. Its hide does not follow: see
   * `loadGlossary`.
   */
  absorbed: Map<string, string[]>;
}

/**
 * The owner's list: the document's entries plus the reader's own.
 *
 * **When a model entry names an added term** — a *Find more* after the reader
 * added it — the model's entry is drawn and the added one is not, since it has
 * `senseHere` and `background` and the added one has only the answer. The row
 * stays; `absorbed` says where its explanation goes. Order is not decided here: the
 * caller relocates and orders everything together.
 */
export function withAddedEntries(
  stored: readonly GlossaryEntry[],
  rows: readonly LookupRowIds[],
): OwnersEntries {
  const entries = [...stored];
  const absorbed = new Map<string, string[]>();
  for (const row of rows) {
    if (row.addedName === null) continue;
    const name = row.addedName;
    /* Only against the model's entries: the write refuses a second added term
       that an earlier one already names, so two added rows cannot collide. */
    const winner = stored.find((entry) => coversWholly(entry, name));
    if (winner) {
      absorbed.set(winner.id, [...(absorbed.get(winner.id) ?? []), row.entryId]);
    } else {
      entries.push(addedEntry(row.entryId, name));
    }
  }
  return { entries, absorbed };
}
