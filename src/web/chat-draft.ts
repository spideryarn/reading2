/**
 * **What the reader has typed into Chat and not sent, kept while the mode is
 * away** — so a question half written before a look at Structure, or at
 * Remember, is in the box on the way back. Plan
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
 * and it is not sent anywhere. Sign-out replaces the page, which empties it.
 *
 * ## The four things it holds
 *
 * - **A Chat conversation's unsent words**, by conversation id. Written by the
 *   panel's composer and by the floating dialog's (its conversation arm, not
 *   its passage arm), so the words follow the reader between the two.
 * - **The box under Chat's list**, one string: it belongs to no conversation.
 * - **Remember's unsent words, by kind** — Recall, Tutorial and Explore are
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
import type { SingleThreadKind } from "../types.js";

export interface ChatDrafts {
  /** A conversation's unsent words. `undefined` is "never written", `""` is "cleared". */
  thread(id: string): string | undefined;
  setThread(id: string, text: string): void;
  /** The conversation is gone — closed unused, or deleted: forget everything under its id. */
  dropThread(id: string): void;
  /** Carry a conversation's words to the one begun in its place. */
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
  remember(kind: SingleThreadKind): string;
  setRemember(kind: SingleThreadKind, text: string): void;

  /**
   * Where Chat was: a conversation's id, `null` for the list, or `undefined`
   * when Chat has not been open on this article since the page loaded.
   */
  destination(): string | null | undefined;
  setDestination(id: string | null): void;
}

export function createChatDrafts(): ChatDrafts {
  const threads = new Map<string, string>();
  const fresh = new Set<string>();
  /* Kept so that `markFresh` after `submitted` is refused rather than trusted
     to never happen: the revocation is the safety, and a caller getting the
     order wrong must not be able to undo it. */
  const spent = new Set<string>();
  let list = "";
  const remember = new Map<SingleThreadKind, string>();
  let destination: string | null | undefined;
  return {
    thread: (id) => threads.get(id),
    setThread(id, text) {
      threads.set(id, text);
    },
    dropThread(id) {
      threads.delete(id);
      fresh.delete(id);
    },
    moveThread(from, to) {
      const text = threads.get(from);
      if (text !== undefined) threads.set(to, text);
      threads.delete(from);
      fresh.delete(from);
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
    remember: (kind) => remember.get(kind) ?? "",
    setRemember(kind, text) {
      remember.set(kind, text);
    },
    destination: () => destination,
    setDestination(id) {
      destination = id;
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
 * Empty every article's drafts. **For tests**, which share this module between
 * cases the way a reader's tab shares it between visits to a mode — the very
 * thing it is for, and the thing a test has to undo.
 */
export function forgetChatDrafts(): void {
  drafts.clear();
}
