/**
 * The filesystem store, as a value rather than as a pile of imports.
 *
 * Every method here **delegates to the code that already does the job** — this
 * file adds no behaviour at all, and that is the point. It exists so the
 * filesystem can be one side of a comparison: the parity test asks the same
 * questions of this and of the Postgres store and demands the same answers.
 * A reimplementation would be comparing the migration against a fresh set of
 * bugs.
 *
 * It is also the rollback. docs/plans/postgres-migration.md § The order of work
 * keeps the filesystem adapter, the importer and the exporter for one release
 * after cutover and then deletes them. This is the first of those three.
 *
 * **This is not where a fallback lives.** Nothing may catch a Postgres error
 * and call into here — see docs/plans/postgres-storage-implementation.md
 * § Rules. A silent fallback hides divergence and makes the parity exercise
 * worthless, which is the single most important line in the plan.
 */

import {
  articleMetadata,
  assertOwnArticle,
  deleteGlossary,
  listArticles,
  loadArticle,
  loadGlossary,
  loadIdeas,
  loadSummaries,
  loadTweets,
} from "../api.js";
import {
  beginTurn,
  ChatConflict,
  deleteThread,
  finishTurn,
  loadThreads,
  renameThread,
  retryTurn,
  update as updateThreads,
  withEdit,
} from "../chat.js";
import { createComment, deleteComment, loadComments, patchComment } from "../comments.js";
import { loadLookups, saveLookup } from "../glossary-lookups.js";
import { searchLibrary } from "../library-search.js";
import { log } from "../log.js";
import { loadReaderProfile, saveReaderProfile } from "../profile.js";
import {
  beginRun,
  currentSourceHash,
  deleteRun,
  finishRun,
  loadRuns,
  update as updateRuns,
} from "../searches.js";
import { loadShelf, patchShelf, recordOpen } from "../shelf.js";
import type {
  ArticleReader,
  ChatStore,
  CommentStore,
  GlossaryLookupStore,
  GlossaryStore,
  LibrarySearch,
  ReaderStore,
  SearchStore,
  ShelfStore,
  SweepOptions,
} from "./contracts.js";
import type { ChatMessage, ChatThread, LibraryEntry, SearchRun } from "../types.js";

export const fsArticleReader: ArticleReader = {
  loadArticle,
  listArticles,
  articleMetadata,
  loadTweets,
  loadGlossary,
  loadSummaries,
  loadIdeas,
};

/**
 * The glossary write that is not a lookup.
 *
 * `Pick<…>` rather than the whole `GlossaryStore`, and the missing half is
 * deliberate: `lookUpTerm` is no longer a filesystem function at all. It is
 * store-independent orchestration over a reader and a lookup store
 * (src/term-lookup.ts), and index.ts builds one from whichever adapters are
 * live. What is left here is the delete, which really does reach for a file.
 */
export const fsGlossaryStore: Pick<GlossaryStore, "deleteGlossary"> = {
  deleteGlossary,
};

/**
 * The 403 the filesystem needs and Postgres does not — see `assertOwnArticle`.
 *
 * Handed to `makeLookUpTerm` in index.ts when the filesystem is live. There is
 * no Postgres counterpart: an unknown slug has no row there and 404s, where
 * `articleDir` falls through to the committed `example/` directory.
 */
export const fsAssertWritableGlossary = (slug: string): Promise<void> =>
  assertOwnArticle(slug, "write to");

/**
 * Comments, with no adaptation at all — the contract is `src/comments.ts`'s own
 * surface, so every method is the function itself. `count` is the one addition,
 * and it exists because the library needs a number without the comments.
 */
export const fsCommentStore: CommentStore = {
  load: loadComments,
  create: createComment,
  patch: patchComment,
  remove: deleteComment,

  async count(slug: string): Promise<number> {
    return (await loadComments(slug)).length;
  },
};

/**
 * The shelf's write side: archive, rename, count an open.
 *
 * Two properties, and each cost a round trip that is worth it at this size.
 *
 * **Nothing is written for an article that does not exist.** `src/shelf.ts`
 * happily creates `data/<slug>/shelf.json` for any slug-shaped string, so
 * without this check a typo produced a directory, a file, and then a 404 — a
 * request that reports "no such article" and leaves state behind for it. The
 * Postgres side gets this for free, because there is no row to update; the
 * filesystem has to be told. Caught by a cross-family review, 2026-08-26.
 *
 * **The entry comes back through `listArticles`**, rather than being patched
 * together here. One directory walk per click, and it buys the property that
 * matters: the card the client renders after a write is built by the same code
 * as the card before it. A second way of building a `LibraryEntry` is the
 * divergence this whole seam exists to make impossible.
 */
export const fsShelfStore: ShelfStore = {
  read: loadShelf,

  async patch(slug, change): Promise<LibraryEntry> {
    await requireEntry(slug);
    const state = await patchShelf(slug, change);
    return entryFor(slug, !!state.archivedAt);
  },

  async recordOpen(slug: string): Promise<void> {
    await requireEntry(slug);
    await recordOpen(slug);
  },
};

/** The article's entry from whichever half of the shelf it is on, or `null`. */
async function findEntry(slug: string): Promise<LibraryEntry | null> {
  const [shelf, archived] = await Promise.all([
    listArticles(),
    listArticles({ archived: true }),
  ]);
  return [...shelf, ...archived].find((e) => e.slug === slug) ?? null;
}

/** …or a 404, before anything is written. */
async function requireEntry(slug: string): Promise<LibraryEntry> {
  const entry = await findEntry(slug);
  if (!entry) {
    throw Object.assign(new Error(`No article artefacts for "${slug}".`), { status: 404 });
  }
  return entry;
}

/**
 * The article as the shelf now describes it.
 *
 * `archived` says which half to look in, because an entry that has just been
 * archived is by definition no longer in the other one — and looking in the
 * wrong half would 404 an article that is sitting right there.
 */
async function entryFor(slug: string, archived: boolean): Promise<LibraryEntry> {
  const entries = await listArticles({ archived });
  const entry = entries.find((e) => e.slug === slug);
  if (!entry) {
    // `requireEntry` already proved the article exists, so this means it stopped
    // being one between the two calls — a concurrent re-extraction, or a
    // directory removed under us. Rare, and worth saying plainly rather than
    // reporting as the same thing as "no such article".
    throw Object.assign(
      new Error(`"${slug}" stopped being a complete article while the shelf was being written.`),
      { status: 409 },
    );
  }
  return entry;
}

/** Searching every article at once. One function, no adaptation — src/library-search.ts. */
export const fsLibrarySearch: LibrarySearch = { searchLibrary };

/* ------------------------------------------------- the reader's own state -- */

/**
 * Chat, on files. Thin, except for the sweep.
 *
 * The sweep is the one method with no counterpart in src/chat.ts, because on
 * the filesystem it was never a storage concern: it lived in src/routes.ts as a
 * `map` over the whole array inside `update`. Moving it here changes nothing
 * about what it does — the same grace window, the same `keep` set, the same
 * error string — it just puts it where the Postgres store can be held to it.
 */
export const fsChatStore: ChatStore = {
  load: loadThreads,
  rename: renameThread,
  remove: deleteThread,

  /* `attempt: undefined` on all three, and it is not a stub. The filesystem has
     no attempts and will not get any: the point of an attempt is to be compared
     across processes, and two servers sharing one `data/` directory is a thing
     nobody does. This side stays fenced by identity alone, exactly as today. */
  async begin(slug, turn, now) {
    return { ...(await beginTurn(slug, turn, now)), attempt: undefined };
  },

  async retry(slug, threadId, messageId, now) {
    return { ...(await retryTurn(slug, threadId, messageId, now)), attempt: undefined };
  },

  async finish(slug, threadId, messageId, patch, opts = {}): Promise<void> {
    // The list is thrown away. Both call sites already did; saying so in the
    // type is what stops the Postgres store paying for a read nobody wants.
    // `opts.attempt` is ignored here — see the note on `begin`.
    await finishTurn(slug, threadId, messageId, patch, opts.now);
  },

  async edit(slug, threadId, messageId, question, opts = {}) {
    /* **The tail check runs inside the mutex, with the edit.**

       Checking it out here — load, check, then call `editTurn`, which enters
       the mutex and re-reads — is checking a copy. A `begin` can land, or
       already be queued, between the two reads: the check passes against
       Q1/A1, `begin` writes Q2/A2, and the edit then runs behind it and
       deletes both. That is precisely the loss `expectedTailId` exists to
       prevent, reintroduced by putting the guard one layer too high. GPT Sol
       found it, 2026-08-26. */
    let out!: ReturnType<typeof withEdit>;
    await updateThreads(slug, (threads) => {
      if (opts.expectedTailId !== undefined) {
        requireTail(threads, threadId, opts.expectedTailId);
      }
      const at = (opts.now ?? (() => new Date().toISOString()))();
      const result = withEdit(threads, threadId, messageId, question, at);
      out = result;
      return result.threads;
    });
    log("store").info(
      {
        slug,
        threadId: out.thread.id,
        messageId: out.reply.id,
        discarded: out.discarded,
        turns: out.thread.messages.length,
      },
      "chat question edited",
    );
    /* `threads` is dropped, not spread. `withEdit` returns the whole rewritten
       array as well as the turn — it has to, because the filesystem writes it —
       and spreading the lot puts a key in the response that the Postgres store
       has no way to produce and no caller wants. Caught by
       tests/store-reader-state-parity.test.ts, which is exactly the kind of
       difference it exists for: nothing else would have noticed. */
    const { threads: _written, ...turn } = out;
    return { ...turn, attempt: undefined };
  },

  async sweepPending(slug: string, opts: SweepOptions): Promise<ChatThread[]> {
    const threads = await loadThreads(slug);
    const now = Date.now();
    const orphaned = (m: ChatMessage) => {
      if (opts.keep.has(m.id)) return false; // this process is on it
      const started = Date.parse(m.createdAt);
      return Number.isNaN(started) || now - started > opts.graceMs;
    };
    const stale = threads.some((t) =>
      t.messages.some((m) => m.status === "pending" && orphaned(m)),
    );
    // The pre-check exists to avoid rewriting the file for nothing. The
    // Postgres store deliberately drops it: an UPDATE matching no rows is free.
    if (!stale) return threads;
    return updateThreads(slug, (current) =>
      current.map((t) => ({
        ...t,
        messages: t.messages.map((m) =>
          m.status === "pending" && orphaned(m)
            ? { ...m, status: "error" as const, error: CHAT_SWEPT }
            : m,
        ),
      })),
    );
  },
};

/** What both chat sweeps write. One constant, so they cannot drift. */
export const CHAT_SWEPT = "The server stopped before this answer finished.";
/** What both search sweeps write. */
export const SEARCH_SWEPT = "The server stopped before this search finished.";

/**
 * The stale-edit guard, shared by both stores.
 *
 * A stale tab editing an old question discards every turn added since it last
 * looked, and today nothing notices: `withEdit` checks only that its target
 * still exists and is a question. So tab A appends Q2 and A2, stale tab B edits
 * Q1 and deletes both, A's answer lands on a message that is gone, and the
 * reader — who saw a perfectly successful answer — reloads to find it missing.
 * The mutex orders those two writes; it does not make the result correct.
 *
 * Deliberately narrow: no thread version, because a version column would 409
 * two *appends* that succeed today, and inventing a failure mode is the one
 * thing this migration must not do. Only the destructive operation is guarded,
 * and only against its discard set having changed. `withRetry` has always had
 * exactly this guard, by insisting on the thread's real last message.
 */
export function requireTail(
  threads: ChatThread[],
  threadId: string,
  expectedTailId: string,
): void {
  const thread = threads.find((t) => t.id === threadId);
  const tail = thread?.messages.at(-1);
  if (tail?.id !== expectedTailId) {
    throw new ChatConflict(
      "This conversation has moved on since you opened it. Reload before editing.",
    );
  }
}

/**
 * Searches, on files. `attempt` is always `undefined`, which is today exactly.
 *
 * The filesystem has no attempt column and cannot grow one usefully: the whole
 * point of an attempt is to be compared across processes, and two servers
 * sharing one `data/` directory is a thing nobody does. So this side stays
 * fenced by identity alone, and the divergence is written down rather than
 * papered over — see src/store/pg-searches.ts.
 */
export const fsSearchStore: SearchStore = {
  load: loadRuns,
  /* The article's own `blocks.json`, hashed with the same `hashBlocks` the
     Postgres half uses — src/searches.ts § currentSourceHash says why the hash
     is over the whole article rather than only the blocks a run cited. */
  sourceHash: currentSourceHash,
  remove: deleteRun,

  async begin(slug, criterion, wantedId, now) {
    return { run: await beginRun(slug, criterion, wantedId, now), attempt: undefined };
  },

  async finish(slug, runId, patch): Promise<SearchRun | undefined> {
    // `finishRun` returns the whole list and the caller did `.find`; doing it
    // here is what lets the Postgres side answer with `UPDATE … RETURNING`
    // instead of reading every run in the article back.
    const runs = await finishRun(slug, runId, patch);
    return runs.find((r) => r.id === runId);
  },

  async sweepPending(slug: string, opts: SweepOptions): Promise<SearchRun[]> {
    const runs = await loadRuns(slug);
    /* **`graceMs` is ignored here, and that is the pre-existing behaviour
       rather than an oversight.** Today's sweep errors any `pending` run this
       process did not start, immediately and with no grace at all. Giving the
       filesystem a grace window would be an improvement smuggled in under a
       migration; the Postgres store needs one because it has other processes
       to be wrong about, and this one does not. */
    const orphaned = (r: SearchRun) => r.status === "pending" && !opts.keep.has(r.id);
    if (!runs.some(orphaned)) return runs;
    const swept = await updateRuns(slug, (current) =>
      current.map((r) =>
        orphaned(r) ? { ...r, status: "error" as const, error: SEARCH_SWEPT } : r,
      ),
    );
    log("store").warn(
      { slug, orphans: swept.filter((r) => r.status === "error").length },
      "swept abandoned search(es)",
    );
    return swept;
  },
};

/** Glossary lookups, on files. Two functions, no adaptation. */
export const fsGlossaryLookupStore: GlossaryLookupStore = {
  load: loadLookups,
  save: saveLookup,
};

/**
 * The reader's global profile, on `data/reader.json`. Two functions, no
 * adaptation — src/profile.ts already does the normalising, capping and
 * atomic write, so there is nothing for this file to add.
 */
export const fsReaderStore: ReaderStore = {
  readProfile: loadReaderProfile,
  writeProfile: saveReaderProfile,
};
