/**
 * **Keep the most recently opened articles ready while the shelf is on
 * screen** — the shelf's half of lib/prefetch-article.ts, which has the rules.
 *
 * Runs as soon as the shelf has a list, **the cached one included**: the shelf
 * paints from its saved copy before the network answers, and a reader going
 * "back, then straight back in" can click before the live list arrives. The
 * candidates come from that list, but every article request is live. When the
 * list changes — cached, then live — the five are worked out again, and
 * `preloadArticles` does not re-ask for one it asked for moments ago. GPT Sol's
 * plan review, docs/plans/261003d-preload-recent-shelf-articles.md.
 *
 * In an idle callback, so the shelf draws first; and not at all when the
 * browser says the reader asked to save data.
 */
import { useEffect } from "react";
import type { LibraryEntry } from "../types.js";
import { PRELOAD_COUNT, preloadArticles } from "./lib/prefetch-article.js";

export function usePreloadRecent(articles: readonly LibraryEntry[] | null): void {
  /* A string, so a re-render with the same five and the same payload-bearing
     shelf fields is not a new effect. `revisionId` alone is insufficient: a
     rename and visibility/archive changes live on the article row. */
  /* `Array.isArray`, not `=== null`: a preload is an extra, and nothing about
     it may break the shelf. Five shelf tests whose stubs answer `/api/library`
     with no list at all went red on `.filter` of `undefined`. The shelf itself
     tolerates that with `articles ?? []`, and so does this. */
  const key = !Array.isArray(articles)
      ? null
      : JSON.stringify(
          recentlyOpenedEntries(articles).map((article) => [
            article.slug,
            shelfVersion(article),
          ]),
        );
  useEffect(() => {
    if (key === null || savingData()) return;
    const chosen = JSON.parse(key) as [slug: string, shelfVersion: string][];
    return whenIdle(() =>
      preloadArticles(
        chosen.map(([slug]) => slug),
        new Map(chosen),
      ),
    );
  }, [key]);
}

/**
 * The `PRELOAD_COUNT` articles opened most recently, newest first. Never-opened
 * and archived ones are not candidates: the report is about reopening, and an
 * archived row is not on the shelf the reader is looking at.
 */
export function recentlyOpened(articles: readonly LibraryEntry[]): string[] {
  return recentlyOpenedEntries(articles).map((a) => a.slug);
}

function recentlyOpenedEntries(articles: readonly LibraryEntry[]): LibraryEntry[] {
  return articles
    .filter((a): a is LibraryEntry & { lastOpenedAt: string } =>
      Boolean(a.lastOpenedAt && !a.archivedAt),
    )
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .slice(0, PRELOAD_COUNT);
}

/** Fields visible on the shelf that also change `GET /api/article/<slug>`. */
function shelfVersion(article: LibraryEntry): string {
  return JSON.stringify([
    article.revisionId ?? null,
    article.title,
    article.titleOverridden ?? false,
    article.visibility ?? null,
    article.archivedAt ?? null,
  ]);
}

function savingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/** Run `fn` when the browser is idle (or soon, without the API); returns a cancel. */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(fn, { timeout: 1000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(fn, 200);
  return () => clearTimeout(handle);
}
