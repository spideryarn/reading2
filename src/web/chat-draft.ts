/**
 * **What the reader has typed into Chat and not sent, kept while the mode is
 * away** — so a question half written before a look at Structure, or at
 * Learn, is in the box on the way back. Plan
 * docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md.
 *
 * One store per article, held here rather than in a component because nothing
 * that types into it outlives a mode change: `ConversationBand` and
 * `ChatPanel` unmount, and `ChatDialog` unmounts the other way. The shape is
 * src/web/search-draft.ts's, without its subscription — a composer reads its
 * draft once on mount and owns the value from then on, so nothing renders
 * from this.
 *
 * **In memory, and only that.** It does not survive a reload or a closed tab,
 * and it is not sent anywhere. Sign-out replaces the page, which empties it;
 * **and so does any other change of reader**, since 2026-10-06: another tab
 * signing in as somebody else changes this tab's session without replacing
 * the page, and the next reader found these words in their box on the same
 * slug. `forgetOnReaderChange`, at the bottom of this file.
 *
 * ## The four things it holds (and, since 2026-10-05, a pending origin: see `ChatDrafts.origin`)
 *
 * - **A Chat conversation's unsent words**, by conversation id. Written by the
 *   panel's composer and by the floating dialog's (its conversation arm, not
 *   its passage arm), so the words follow the reader between the two.
 * - **The box under Chat's list**, one string: it belongs to no conversation.
 * - **Learn's unsent words, by kind** — Recall, Tutorial and Explore are
 *   each one conversation per article, and the band decides which conversation
 *   that is, so the words are handed to whichever it selects.
 * - **Where Chat was**: the conversation that was open, or the list. `?thread=`
 *   cannot be trusted to say, because Recall writes its own conversation's id
 *   there and Quiz clears it.
 *
 * ## Never submitted
 *
 * A conversation with no message yet exists only in the tab that began it, and
 * goes with the band. Coming back, the band begins another and moves the words
 * across — but only for a conversation that is **known never to have been
 * submitted to**, because a conversation can be missing for other reasons (the
 * list failed to load, the first question's write has not landed, another tab
 * deleted it) and recreating one of those would send a follow-up without its
 * history. So it is a mark the band makes when it begins the conversation and
 * revokes on the first typed or spoken submission, not something worked out
 * from the words or from a missing row, and once revoked it stays revoked.
 */
import type { LearnKind, ThreadOrigin } from "../types.js";
import { forgetOnReaderChange } from "./lib/reader-change.js";

export interface ChatDrafts {
  /**
   * **Where a handed-over conversation was started from** (`ThreadOrigin`;
   * plan 261005i, F5). Kept here, by conversation id, because it has to
   * outlive the band, which unmounts on every mode change and takes an unsent
   * conversation with it, and because one origin for the whole article would
   * attach itself to the wrong conversation.
   *
   * It is not part of the words. Typing, clearing the box and submitting leave
   * it alone; `moveThread` carries it and `dropThread` forgets it. The band
   * sends it with the conversation's questions until the server has the
   * thread, then clears it. The acknowledged thread carries its own origin
   * (`ConversationBand` § `pendingOrigin`). `clearOrigin` also forgets an id
   * the server replaced.
   */
  origin(id: string): ThreadOrigin | undefined;
  setOrigin(id: string, origin: ThreadOrigin): void;
  clearOrigin(id: string): void;

  /** A conversation's unsent words. `undefined` is "never written", `""` is "cleared". */
  thread(id: string): string | undefined;
  setThread(id: string, text: string): void;
  /** The conversation is gone — closed unused, or deleted: forget everything under its id. */
  dropThread(id: string): void;
  /** Carry a conversation's words and local identity to the one begun in its place. */
  moveThread(from: string, to: string): void;

  /** This tab has just begun `id`, and nothing has been submitted to it. */
  markFresh(id: string): void;
  /** Something has been sent or said to `id`. Irreversible. */
  submitted(id: string): void;
  isFresh(id: string): boolean;

  /** The box under Chat's list. */
  list(): string;
  setList(text: string): void;

  /** Recall's, Tutorial's or Explore's unsent words. */
  learn(kind: LearnKind): string;
  setLearn(kind: LearnKind, text: string): void;

  /**
   * Where Chat was: a conversation's id, `null` for the list, or `undefined`
   * when Chat has not been open on this article since the page loaded.
   */
  destination(): string | null | undefined;
  setDestination(id: string | null): void;

  /**
   * **The guide this tab began**, by id, or `undefined` (plan 261007j). The
   * guide is one conversation per article, opened in Chat's band; one this tab
   * began and nothing has been sent to goes with the band on a mode change, as
   * an unsent chat does. Kept here so the band can begin it again **under the
   * same id**, words and all, rather than mistake its words for a chat's —
   * and so two quick opens (StrictMode's second run, a pinned-row press racing
   * `?guide=1`) are one guide, not two.
   */
  guide(): string | undefined;
  setGuide(id: string): void;

  /** Whether any of the three boxes holds words — more than spaces — right now. */
  holdsWords(): boolean;
}

export function createChatDrafts(): ChatDrafts {
  const threads = new Map<string, string>();
  const origins = new Map<string, ThreadOrigin>();
  const fresh = new Set<string>();
  /* Kept so that `markFresh` after `submitted` is refused rather than trusted
     to never happen: the revocation is the safety, and a caller getting the
     order wrong must not be able to undo it. */
  const spent = new Set<string>();
  let list = "";
  const learnDrafts = new Map<LearnKind, string>();
  let destination: string | null | undefined;
  let guide: string | undefined;
  return {
    guide: () => guide,
    setGuide(id) {
      guide = id;
    },
    thread: (id) => threads.get(id),
    setThread(id, text) {
      threads.set(id, text);
    },
    dropThread(id) {
      threads.delete(id);
      fresh.delete(id);
      origins.delete(id);
      if (guide === id) guide = undefined;
    },
    moveThread(from, to) {
      const text = threads.get(from);
      if (text !== undefined) threads.set(to, text);
      threads.delete(from);
      fresh.delete(from);
      const origin = origins.get(from);
      if (origin !== undefined) origins.set(to, origin);
      origins.delete(from);
      if (guide === from) guide = to;
    },
    origin: (id) => origins.get(id),
    setOrigin(id, origin) {
      origins.set(id, origin);
    },
    clearOrigin(id) {
      origins.delete(id);
    },
    markFresh(id) {
      if (!spent.has(id)) fresh.add(id);
    },
    submitted(id) {
      fresh.delete(id);
      spent.add(id);
    },
    isFresh: (id) => fresh.has(id),
    list: () => list,
    setList(text) {
      list = text;
    },
    learn: (kind) => learnDrafts.get(kind) ?? "",
    setLearn(kind, text) {
      learnDrafts.set(kind, text);
    },
    destination: () => destination,
    setDestination(id) {
      destination = id;
    },
    holdsWords() {
      const some = (texts: Iterable<string>): boolean => {
        for (const text of texts) if (text.trim() !== "") return true;
        return false;
      };
      return list.trim() !== "" || some(threads.values()) || some(learnDrafts.values());
    },
  };
}

/**
 * Every article's drafts, for as long as the page lives. A handful of short
 * strings an article; nothing here is worth evicting.
 */
const drafts = new Map<string, ChatDrafts>();

/** This article's drafts, made on first use. */
export function chatDraftsFor(slug: string): ChatDrafts {
  let d = drafts.get(slug);
  if (!d) {
    d = createChatDrafts();
    drafts.set(slug, d);
  }
  return d;
}

/**
 * Whether any article holds unsent words. They live only in this page's
 * memory, so this is the question to ask before replacing the page —
 * safe-to-reload.ts.
 */
export function anyChatDraftHeld(): boolean {
  for (const d of drafts.values()) if (d.holdsWords()) return true;
  return false;
}

/**
 * Empty every article's drafts. **For a change of reader**, below, and for
 * tests, which share this module between cases the way a reader's tab shares
 * it between visits to a mode — the very thing it is for, and the thing a
 * test has to undo.
 */
export function forgetChatDrafts(): void {
  drafts.clear();
}

/* These are one reader's words. The band that holds a store has unmounted by
   the time the next reader's is drawn, so nothing is left typing into an old
   one. docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2. */
forgetOnReaderChange(forgetChatDrafts);
