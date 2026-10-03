/**
 * **The reader's own tags, over the wire** — the one client function that
 * writes them, and the one that reads the reader's vocabulary.
 *
 * Both the tag editor (TagEditor.tsx, on the shelf and the Metadata page) and
 * the command bar's later "add a tag of X" call `editArticleTags`, so there is
 * one request shape and one validation (src/tags.ts § `normaliseTag`, which
 * the server runs too). Plan
 * docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md.
 */

import type { ArticleTagsResponse, LibraryTagsResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

/** What one edit asks for. The server runs remove before add. */
export interface TagChange {
  add?: string[];
  remove?: string[];
}

/** Add and remove tags on one of the reader's articles; the tags after, as stored. */
export async function editArticleTags(slug: string, change: TagChange): Promise<string[]> {
  const r = await apiFetch(`/api/library/${encodeURIComponent(slug)}/tags`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  });
  return (await readJson<ArticleTagsResponse>(r)).tags;
}

/** Every tag the reader uses, with counts — the editor's suggestions. */
export async function loadReaderTags(): Promise<LibraryTagsResponse["tags"]> {
  const r = await apiFetch("/api/library/tags");
  return (await readJson<LibraryTagsResponse>(r)).tags;
}
