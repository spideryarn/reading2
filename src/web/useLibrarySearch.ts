/**
 * The second half of the home page's search box: passages, from the server.
 *
 * The first half — filtering the cards by title, author, source and blurb —
 * needs no hook at all, because the shelf is already in memory. It is a
 * `filter` in Library.tsx, it runs on every keystroke, and it is free. This is
 * the half that costs a round trip, so it waits.
 *
 * ## Two things here are not optional
 *
 * **Debounce.** Typing "consciousness" is thirteen keystrokes and would be
 * thirteen full-text queries over every paragraph we own. The pause is short
 * enough that a reader who stops to think sees results without asking.
 *
 * **Drop late responses.** Debounced typing produces out-of-order responses as
 * a matter of course: a slow query for "con" can land after a fast one for
 * "consciousness" and repaint the list with the wrong answers. The response
 * echoes the query back for exactly this, and a request whose echo is not what
 * the box currently says is dropped. Comparing against a ref rather than state
 * because the closure would otherwise be one render behind — which is the
 * version of this bug that only shows up when you type quickly.
 */
import { useEffect, useRef, useState } from "react";
import type { LibraryHit, LibrarySearchResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

/** Long enough to skip the middle of a word, short enough not to feel laggy. */
const DEBOUNCE_MS = 250;

/**
 * Below this we do not ask the server.
 *
 * Three characters is this box's threshold, to avoid broad requests while the
 * reader starts typing. Chat's parser in src/library-search.ts uses a different
 * threshold: `MIN_TERM` admits two-character terms. The former filesystem
 * adapter used that parser too; it went on 2026-09-05.
 */
export const MIN_QUERY = 3;

export interface LibrarySearchState {
  hits: LibraryHit[];
  /**
   * The query `hits` are the answer to.
   *
   * The caller must render results only when this matches what is in the box.
   * Without it the previous query's hits stay on screen while the next request
   * runs — and the renderer marks and links them using the NEW query, so a
   * reader sees passages that do not contain what they typed, presented as
   * though they do. Caught by a cross-family review, 2026-08-26.
   */
  resultsQuery: string;
  /** Whether `hits` included the archive — the other half of the question, checked the same way. */
  resultsArchived: boolean;
  /** The shelf snapshot searched; mutations can change the answer at the same query. */
  resultsShelfKey: string;
  /** How many articles those hits are spread across. */
  articles: number;
  capped: boolean;
  /** `LibrarySearchResponse.archivedArticles`: set only on an answer asked without the archive. */
  archivedArticles?: number;
  /** True while a request for the current query is in flight. */
  searching: boolean;
  error: string | null;
  /** False until a query has actually been asked — so "no matches" is not shown before we looked. */
  asked: boolean;
}

const IDLE: LibrarySearchState = {
  hits: [],
  resultsQuery: "",
  resultsArchived: false,
  resultsShelfKey: "",
  articles: 0,
  capped: false,
  searching: false,
  error: null,
  asked: false,
};

/**
 * @param includeArchived the shelf's Include archived chip: search the archived
 *   articles' text too (plan 260930d). Part of the question, so pressing the
 *   chip asks again, and a response for the other chip state is dropped like a
 *   response for other words.
 */
export function useLibrarySearch(query: string, includeArchived: boolean, shelfKey = ""): LibrarySearchState {
  const [state, setState] = useState<LibrarySearchState>(IDLE);
  const current = useRef({ query, includeArchived, shelfKey });
  current.current = { query, includeArchived, shelfKey };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setState({ ...IDLE, resultsShelfKey: shelfKey });
      return;
    }

    /* The previous query's hits are dropped the moment the query changes, not
       when the next response lands. Keeping them would be smoother and would be
       a lie for as long as the request takes. */
    setState({ ...IDLE, resultsShelfKey: shelfKey, searching: true, asked: false });

    /* Declared before the timer that uses it. It only ever *ran* after this
       line, so the old order worked — but a `const` referenced above its own
       declaration is a temporal-dead-zone crash waiting for somebody to make
       the callback synchronous. */
    const controller = new AbortController();

    const timer = setTimeout(() => {
      /* `AbortController` as well as the echo check, because the two solve
         different halves: abort stops the browser holding six connections open
         while somebody types, and the echo check is what stops a response that
         escaped the abort from repainting the list. Either alone leaves a gap. */
      const archived = includeArchived ? "&archived=1" : "";
      apiFetch(`/api/library/search?q=${encodeURIComponent(trimmed)}${archived}`, { signal: controller.signal })
        .then((r) => readJson<LibrarySearchResponse>(r))
        .then((body) => {
          // The answer to a question nobody is asking any more.
          if (body.query !== current.current.query.trim()) return;
          if (body.archived !== current.current.includeArchived) return;
          if (shelfKey !== current.current.shelfKey) return;
          /* Aborted, and so superseded — even if the words and the chip are
             back where they were (A → B → A), this is the old A's answer.
             GPT Sol, plan 261002b § Part D review. */
          if (controller.signal.aborted) return;
          setState({
            hits: body.hits,
            resultsQuery: body.query,
            resultsArchived: body.archived,
            resultsShelfKey: shelfKey,
            articles: body.articles,
            capped: body.capped,
            ...(body.archivedArticles === undefined ? {} : { archivedArticles: body.archivedArticles }),
            searching: false,
            error: null,
            asked: true,
          });
        })
        .catch((e: Error) => {
          // An abort is this hook working, not a failure to report.
          if (e.name === "AbortError") return;
          // A failed answer can escape an abort too. It belongs to the same
          // query and archive scope as a successful one, so do not let an old
          // failure replace newer results (plan 260930d code review).
          if (current.current.query.trim() !== trimmed) return;
          if (current.current.includeArchived !== includeArchived) return;
          if (current.current.shelfKey !== shelfKey) return;
          if (controller.signal.aborted) return;
          setState({ ...IDLE, resultsShelfKey: shelfKey, error: e.message, asked: true });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, includeArchived, shelfKey]);

  // Hide the old snapshot synchronously, before the effect starts the next read.
  return state.resultsShelfKey === shelfKey
    ? state
    : { ...IDLE, resultsShelfKey: shelfKey, searching: query.trim().length >= MIN_QUERY };
}
