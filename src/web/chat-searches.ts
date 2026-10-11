/**
 * **The quick searches a chat answer's buttons started, for this tab** — plan
 * docs/plans/261011aa-guide-and-chat-run-in-article-searches-in-place-and-link-the-article-readily.md.
 *
 * > It shouldn't take me to the search mode because that's really
 * > disorienting, and I might want to search for multiple things, and it
 * > should be able to initiate searches.
 * >
 * > — Greg, 2026-10-11, `spya-ma72mx`
 *
 * A `quick-search` button pressed in a chat surface runs the search where it
 * is (ChatSearchCard.tsx) rather than switching the band to Search. The
 * request is the one Search mode makes — `POST /api/search/<slug>`, kind
 * `quick` — so the answer is saved as a Search row like any other and is in
 * Search's list when the reader goes there.
 *
 * **Why a store outside React, and not the card's own state.** A card is
 * remounted whenever the transcript is redrawn (a new answer, a thread
 * switch), and the server abandons a quick search whose client went away
 * (routes.ts § search, `gone`). Kept here, a search outlives the card that
 * pressed it, and two buttons with the same words show one search rather
 * than paying twice.
 *
 * **A reload keeps the answer** through the article's saved list
 * (`GET /api/search/<slug>`, read once per article per page): a card whose
 * words match a finished saved quick search draws it as found. That read
 * spends nothing and writes nothing, so a model's token still runs nothing
 * by being drawn.
 *
 * Keyed by the reader as well as the article, because a tab can change
 * reader under a mounted page (lib/made-for.ts).
 */
import { useEffect, useSyncExternalStore } from "react";
import type { SearchHit, SearchRun } from "../types.js";
import { mintId } from "../ids.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
import { apiFetch, failure, fetchOk } from "./lib/api.js";
import { ReaderFacingError } from "./lib/reader-facing.js";

export type ChatSearch =
  | { readonly status: "checking" }
  | { readonly status: "idle" }
  | { readonly status: "searching"; readonly runId: string; readonly hits: readonly SearchHit[] }
  /** `saved`: read from the article's saved list, not run by this tab. */
  | { readonly status: "done"; readonly run: SearchRun; readonly saved?: true }
  | { readonly status: "error"; readonly message: string; readonly retryId: string };

const CHECKING: ChatSearch = { status: "checking" };
const IDLE: ChatSearch = { status: "idle" };

/* A tab can visit articles for days. These caches are conveniences, not the
   store of record (finished runs are on the server), so keep their memory
   bounded. An exceptional burst of more than MAX_SEARCHES live requests may
   exceed the bound until one settles; an in-flight request is never evicted. */
const MAX_SEARCHES = 200;
const MAX_SAVED_ARTICLES = 20;

/** The words as the server stores them, compared without case. */
export function sameWords(words: string): string {
  return words.replace(/\s+/g, " ").trim().toLowerCase();
}

const keyOf = (reader: string | null, slug: string, words: string) =>
  `${reader ?? ""}\u0000${slug}\u0000${sameWords(words)}`;

/** What this tab started, and what it learnt from the saved list. */
const searches = new Map<string, ChatSearch>();
/** The saved list, once per reader and article — `null` while it is out. */
const saved = new Map<string, readonly SearchRun[] | null>();
const listeners = new Set<() => void>();

const listKeyOf = (reader: string | null, slug: string) => `${reader ?? ""}\u0000${slug}`;

function trimSearches(): void {
  while (searches.size > MAX_SEARCHES) {
    const disposable = [...searches].find(([, value]) => value.status !== "searching");
    if (disposable === undefined) return;
    searches.delete(disposable[0]);
  }
}

function trimSaved(): void {
  while (saved.size > MAX_SAVED_ARTICLES) saved.delete(saved.keys().next().value as string);
}

function changed(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(key: string, next: ChatSearch): void {
  /* Map insertion order is our tiny LRU. */
  searches.delete(key);
  searches.set(key, next);
  trimSearches();
  changed();
}

/**
 * The newest finished quick search in the saved list with these words, or
 * none. Only `done`: a failed or abandoned row is not an answer to show.
 */
function savedAnswer(reader: string | null, slug: string, words: string): SearchRun | undefined {
  const runs = saved.get(listKeyOf(reader, slug));
  if (!runs) return undefined;
  const want = sameWords(words);
  let best: SearchRun | undefined;
  for (const run of runs) {
    if (run.kind !== "quick" || run.status !== "done" || sameWords(run.criterion) !== want) continue;
    if (best === undefined || (run.finishedAt ?? run.createdAt) > (best.finishedAt ?? best.createdAt)) best = run;
  }
  return best;
}

function readSaved(reader: string | null, slug: string): void {
  const listKey = listKeyOf(reader, slug);
  if (saved.has(listKey)) return;
  saved.set(listKey, null);
  trimSaved();
  void fetchOk(`/api/search/${encodeURIComponent(slug)}`, {}, reader)
    .then((r) => r.json() as Promise<{ runs?: SearchRun[] }>)
    .then((body) => {
      /* The GET may have begun before a card's POST and answered after it.
         Merge this tab's completed runs so the late list cannot forget the
         answer we just received. */
      const own = [...searches]
        .filter(([key, value]) => key.startsWith(`${listKey}\u0000`) && value.status === "done")
        .map(([, value]) => (value as Extract<ChatSearch, { status: "done" }>).run);
      const byId = new Map((body.runs ?? []).map((run) => [run.id, run]));
      for (const run of own) byId.set(run.id, run);
      saved.delete(listKey);
      saved.set(listKey, [...byId.values()]);
      trimSaved();
      changed();
    })
    /* No list is not a failure the reader needs to hear about: the button
       stays a button, and pressing it asks. Left `[]` rather than retried, so
       a card that keeps redrawing does not keep asking. */
    .catch(() => {
      saved.delete(listKey);
      saved.set(listKey, []);
      trimSaved();
      changed();
    });
}

/** This button's search: what this tab started, else a saved answer, else nothing yet. */
export function chatSearchFor(reader: string | null, slug: string, words: string): ChatSearch {
  const key = keyOf(reader, slug, words);
  const own = searches.get(key);
  if (own !== undefined) return own;
  const list = saved.get(listKeyOf(reader, slug));
  if (list === undefined || list === null) return CHECKING;
  const run = savedAnswer(reader, slug, words);
  if (run === undefined) return IDLE;
  /* The same object for the same run: `useSyncExternalStore` compares
     snapshots by identity, and a fresh one each read would redraw forever.
     Weakly keyed by the saved run, so visiting articles cannot leave one
     wrapper per search phrase behind for the rest of the tab's life. */
  const before = fromSaved.get(run);
  if (before !== undefined) return before;
  const found: ChatSearch = { status: "done", run, saved: true };
  fromSaved.set(run, found);
  return found;
}

/** The saved answers drawn so far, weakly held so a snapshot keeps its identity. */
let fromSaved = new WeakMap<SearchRun, ChatSearch>();

/** The search for these words, redrawn as it changes. Reads the saved list once per article. */
export function useChatSearch(reader: string | null, slug: string, words: string): ChatSearch {
  useEffect(() => readSaved(reader, slug), [reader, slug]);
  return useSyncExternalStore(subscribe, () => chatSearchFor(reader, slug, words), () => IDLE);
}

function followBegin(key: string, begun: SearchRun): string {
  const at = searches.get(key);
  if (at?.status === "searching") set(key, { ...at, runId: begun.id });
  return begun.id;
}

function appendHit(key: string, hit: SearchHit): void {
  const at = searches.get(key);
  if (at?.status === "searching") set(key, { ...at, hits: [...at.hits, hit] });
}

function finish(key: string, reader: string | null, slug: string, run: SearchRun): void {
  if (run.status !== "done") {
    set(key, { status: "error", message: run.error ?? FAILED, retryId: run.id });
    return;
  }
  const listKey = listKeyOf(reader, slug);
  const runs = saved.get(listKey);
  if (runs !== undefined && runs !== null) {
    saved.delete(listKey);
    saved.set(listKey, [run, ...runs.filter((candidate) => candidate.id !== run.id)]);
    trimSaved();
  }
  set(key, { status: "done", run });
}

/**
 * **Run it** — the reader's press, never a draw. A search for the same words
 * already out, or already answered, is left alone: one search, shown by every
 * button with those words.
 */
export function startChatSearch(
  reader: string | null,
  slug: string,
  words: string,
  options: { readonly ignoreSaved?: boolean } = {},
): void {
  const key = keyOf(reader, slug, words);
  const now = chatSearchFor(reader, slug, words);
  if (now.status === "checking" || now.status === "searching") return;
  if (now.status === "done" && !options.ignoreSaved) return;
  const criterion = words.replace(/\s+/g, " ").trim();
  if (criterion === "") return;
  /* A retry names the failed server row. That is how `withRun` knows it may
     reset the row instead of leaving one failed row and minting another. */
  const requestedId = now.status === "error" ? now.retryId : mintId();
  set(key, { status: "searching", runId: requestedId, hits: [] });
  void (async () => {
    let liveId = requestedId;
    try {
      const r = await apiFetch(
        `/api/search/${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: requestedId, criterion, kind: "quick" }),
        },
        reader,
      );
      if (!r.ok || !r.body) throw await failure(r);
      for await (const event of readEvents(r.body, { stallMs: STREAM_STALL_MS })) {
        if (event.name === "begin") {
          const begun = event.data as SearchRun;
          liveId = followBegin(key, begun);
          continue;
        }
        if (event.name === "hit") {
          const { hit } = event.data as { hit: SearchHit };
          appendHit(key, hit);
          continue;
        }
        if (event.name === "done") {
          /* The final answer replaces what streamed, as in Search mode
             (useSearch.ts § `done`). */
          const run = event.data as SearchRun;
          finish(key, reader, slug, run);
          return;
        }
      }
      throw new ReaderFacingError("The search stopped arriving. Try again.");
    } catch (e) {
      set(key, { status: "error", message: describeFetchFailure(e as Error), retryId: liveId });
    }
  })();
}

const FAILED = "That search didn't work. Try again in a moment.";

/** Tests only: forget everything this tab started and read. */
export function resetChatSearches(): void {
  searches.clear();
  saved.clear();
  fromSaved = new WeakMap<SearchRun, ChatSearch>();
  changed();
}
