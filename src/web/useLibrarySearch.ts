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
 * One or two characters match nearly every article and rank nothing, and the
 * filesystem adapter drops such terms anyway (`MIN_TERM` in
 * src/library-search.ts) — so the request would reliably cost a walk over every
 * paragraph to return nothing.
 */
const MIN_QUERY = 3;

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
  /** How many articles those hits are spread across. */
  articles: number;
  capped: boolean;
  /** True while a request for the current query is in flight. */
  searching: boolean;
  error: string | null;
  /** False until a query has actually been asked — so "no matches" is not shown before we looked. */
  asked: boolean;
}

const IDLE: LibrarySearchState = {
  hits: [],
  resultsQuery: "",
  articles: 0,
  capped: false,
  searching: false,
  error: null,
  asked: false,
};

export function useLibrarySearch(query: string): LibrarySearchState {
  const [state, setState] = useState<LibrarySearchState>(IDLE);
  const current = useRef(query);
  current.current = query;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setState(IDLE);
      return;
    }

    /* The previous query's hits are dropped the moment the query changes, not
       when the next response lands. Keeping them would be smoother and would be
       a lie for as long as the request takes. */
    setState({ ...IDLE, searching: true, asked: false });

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
      apiFetch(`/api/library/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => readJson<LibrarySearchResponse>(r))
        .then((body) => {
          // The answer to a question nobody is asking any more.
          if (body.query !== current.current.trim()) return;
          setState({
            hits: body.hits,
            resultsQuery: body.query,
            articles: body.articles,
            capped: body.capped,
            searching: false,
            error: null,
            asked: true,
          });
        })
        .catch((e: Error) => {
          // An abort is this hook working, not a failure to report.
          if (e.name === "AbortError") return;
          setState({ ...IDLE, error: e.message, asked: true });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return state;
}
