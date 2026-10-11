/**
 * **The addresses of a search in Search mode** — the command bar's find row,
 * chat's *Find “X”* chip and the *Open in Search* link under a search a chat
 * button ran in place (ChatSearchCard.tsx, plan 261011aa). Its own module, out
 * of CommandBar.tsx, so the chat card can build a link without loading the
 * whole bar.
 */
import { readHref, searchWithoutAny } from "./router.js";

/**
 * **The search parameters a words search is made of**, and the ones of the
 * same kind that a new search replaces rather than sits beside — the block
 * last-view.ts § `NEVER_REMEMBERED` names for the same reason: they are one
 * search, and a stale `?run=` beside a new `?find=` is two.
 */
const SEARCH_KEYS = new Set(["mode", "match", "find", "run", "runs", "order", "conf"]);

/**
 * **The address a words search for `words` is** — the find row's, and the one
 * chat's *Find “X”* chip goes to (Reader.tsx § `chatCommands`), so the two
 * cannot open different searches. `carried` is already through `carriedSearch`.
 */
export function findHref(slug: string, carried: string, words: string): string {
  const kept = searchWithoutAny(carried, SEARCH_KEYS);
  const search = [kept, "mode=search", "match=words", `find=${encodeURIComponent(words)}`]
    .filter(Boolean)
    .join("&");
  return readHref(slug, search, "article");
}

/**
 * **The address of one saved quick search, switched on in Search** — the
 * *Open in Search* link under a search a chat button ran in place
 * (ChatSearchCard.tsx, plan 261011aa). `findHref`'s rule for what is carried.
 */
export function searchRunHref(slug: string, carried: string, runId: string): string {
  const kept = searchWithoutAny(carried, SEARCH_KEYS);
  const search = [kept, "mode=search", "match=quick", `runs=${encodeURIComponent(runId)}`]
    .filter(Boolean)
    .join("&");
  return readHref(slug, search, "article");
}
