/**
 * **A reader's own tags on their articles — what counts as one.**
 *
 * Pure, and imported by both halves: the store refuses what this refuses, and
 * the editor refuses it first, so a reader never types a tag that comes back as
 * a 400. The database holds the same rules as a CHECK on `article_tags.tag`
 * (src/db/schema.ts), so a script that skips this module is refused too.
 *
 * - **Spelling**: NFC, trimmed, inner whitespace collapsed to one space,
 *   1–`TAG_MAX_LENGTH` characters, no comma and no control character. The
 *   comma is excluded because a tag becomes a key in the shelf's `?tags=`
 *   list, which is comma-separated (src/web/params.ts).
 * - **Lowercase.** A tag is its own identity: `AI` and `ai` are one tag, stored
 *   as `ai`. Keeping the reader's case would need a vocabulary table to stay
 *   one-spelling-per-reader under concurrent first adds; lowercase needs
 *   nothing, and the shelf's topic pills are lowercase already (plan 261003d §
 *   After GPT Sol's plan review, 1).
 *
 * The later command-bar "add a tag of X" validates X with `normaliseTag` too
 * (docs/project/chat-llm-help-commands-vision.md: a proposal's argument that
 * fails the command's own validation is "I don't know").
 *
 * Plan: docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md.
 */

/** Longest tag, in characters (code points), after normalising. */
export const TAG_MAX_LENGTH = 40;

/** Most tags one article may carry: a ceiling against a script, not a design limit. */
export const TAGS_PER_ARTICLE = 30;

/** Most tags one request may add or remove, for the same reason. */
export const TAGS_PER_EDIT = TAGS_PER_ARTICLE;

export type TagSpelling =
  | { ok: true; tag: string }
  | { ok: false; reason: string };

/* C0, DEL and C1 controls. Whitespace controls (tab, newline) are collapsed to a
   space before this is asked, so only the invisible ones are left to refuse. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/* JavaScript strings may contain lone UTF-16 surrogates. Node replaces those
   with U+FFFD while encoding a Postgres parameter, so accepting one would mean
   the tag we validate is not the tag the database stores. */
const ILL_FORMED_UTF16 =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A tag as it would be stored, or why it cannot be one. */
export function normaliseTag(raw: string): TagSpelling {
  if (ILL_FORMED_UTF16.test(raw)) {
    return { ok: false, reason: "A tag needs valid Unicode characters." };
  }
  const tag = raw.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  if (tag === "") return { ok: false, reason: "A tag needs at least one character." };
  if ([...tag].length > TAG_MAX_LENGTH) {
    return { ok: false, reason: `A tag can be at most ${TAG_MAX_LENGTH} characters.` };
  }
  if (tag.includes(",")) return { ok: false, reason: "A tag cannot contain a comma." };
  if (CONTROL.test(tag)) return { ok: false, reason: "A tag cannot contain control characters." };
  return { ok: true, tag };
}

/** Display order, by code unit — sorted here rather than by a collation, so server and client agree. */
export function compareTags(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
