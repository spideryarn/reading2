/**
 * Which conversations are anchored to which passage — the reading view's half
 * of chat. See docs/plans/260826ab-chat-as-gateway.md § The reading view gets thread
 * summaries.
 *
 * ## Why this is not just `useChat`
 *
 * The reading view needs two things from chat: a mark in the prose for every
 * conversation started from a selection, and enough to say something useful
 * when the reader hovers one. It does **not** need the transcripts, and taking
 * them is not merely wasteful.
 *
 * `useChat` calls `setThreads` on **every streamed token**. Hold that state
 * above `TableView` and every token re-renders the reading view — and
 * `TableView` maps every block and calls `annotateHtml` during render, so a
 * long article re-parses and re-annotates every paragraph hundreds of times
 * while one answer arrives. A GPT-5.6 review found this in the plan that
 * proposed lifting `useChat` into `Reader`; it also found the race below.
 *
 * So the summaries live here, the transcripts live in `ChatDialog` and
 * `ConversationBand`, and this state changes only when a conversation is created,
 * renamed or deleted.
 *
 * ## The one rule that keeps them in step
 *
 * **Mutations flow one way.** Whoever creates or deletes a thread tells this
 * hook, and it patches its list locally. It does not re-fetch, and it does not
 * poll. Two sources of truth are only a problem when both of them write.
 *
 * The reason that matters rather than being tidiness: a `refetch` after a send
 * is exactly the race `useChat` already documents — an in-flight GET returning
 * *after* an optimistic insert replaces the whole array with the older server
 * answer, and everything pointing at the new row is then pointing at nothing.
 *
 * **And the first fetch is a fetch.** That sentence stood here for ten days
 * describing a race this file then had, because "we never re-fetch" quietly
 * excused the one GET it does make: a reader who acts while it is in the air
 * gets the same replacement, from the same cause. `foldInLocalWrites` below is
 * the fix, and it arrived only when the "?" in the gutter turned a lost mark
 * into a second model call nobody asked for. GPT Sol, 2026-09-05.
 *
 * ## Since 2026-10-05 it can be asked again (`refresh`)
 *
 * The one-way rule only works for writers who tell this hook, and Chat's band
 * never has: a conversation started, continued or deleted there left this list
 * as it was until a reload. That did not show while every summary anyone
 * looked at was made by `ChatDialog`. It does now that a caller mode draws a
 * mark from a chat started in the band (Debate's claims; plan 261005i, F1).
 *
 * So `Reader` calls `refresh()` when the reader leaves Chat, and the chat
 * controller calls it when a typed turn settles, even after the composer goes.
 * A refetch is the race the paragraphs above
 * describe, so it goes through the same `foldInLocalWrites`: whatever was
 * added, touched or dropped while it was in the air wins over the answer, and
 * an older request can never land after a newer one. The list is not emptied
 * and `loaded` stays true while it is out, so no mark flickers.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ChatAnchor,
  isLensOrigin,
  type LensOrigin,
  sameOrigin,
  type ThreadOrigin,
  type ThreadSummary,
} from "../types.js";
import type { AskedQuestion } from "./comment-nav.js";
import { apiFetch, readJson } from "./lib/api.js";

export interface ChatAnchorsApi {
  summaries: ThreadSummary[];
  /**
   * Has the first fetch come back?
   *
   * The prose must not draw marks from an empty list it has not earned — a
   * paragraph that flickers its marks on at load looks like a rendering fault.
   * More importantly, "no conversation with this id" and "the list has not
   * arrived" are the same state without this, and the second must not make a
   * shared `?thread=` link say the conversation no longer exists.
   */
  loaded: boolean;
  /** A thread was created. Called by whoever created it, with the server's id. */
  add(summary: ThreadSummary): void;
  /** A thread went away — deleted, or cancelled before its first answer landed. */
  drop(threadId: string): void;
  /**
   * The server stored a new thread under another id than the one `add` was
   * given: the tab guesses a new conversation's id, and the server overrules a
   * guess used by a *message* in the article, including one minted for this
   * turn (src/chat.ts, `taken`, `withTurn`; a guess that is a conversation's
   * id is that conversation). The row moves to the server's id, in place.
   *
   * No answer will ever name the guess, so left alone its row stays beside the
   * real one and the paragraph counts one conversation twice. One operation
   * rather than `drop` then `add`, so the row keeps its place and the
   * bookkeeping for a request in the air moves in one step.
   * docs/plans/261005n-chat-guessed-id-reconciled-with-the-stored-one.md
   */
  rename(from: string, to: string): void;
  /**
   * A thread's title or newest answer changed.
   *
   * Only the fields a hover shows. Deliberately **not** called per token: the
   * whole point of this hook is that it does not change while an answer
   * streams. `ChatDialog` calls it once, when a turn finishes.
   */
  touch(threadId: string, patch: Partial<ThreadSummary>): void;
  /**
   * Ask the server for the list again, because something that does not tell
   * this hook may have changed it (Chat's band). Keeps what is on screen until
   * the answer lands, and keeps anything done while it was in the air. A
   * failure leaves the list as it was.
   */
  refresh(): void;
  error: string | null;
}

/** Everything the prose needs to draw one mark. */
export interface AnchoredThread {
  id: string;
  title: string;
  anchor: ChatAnchor & { quote: string; start: number };
  turns: number;
  lastLine?: string | undefined;
}

/**
 * The summaries that can actually be drawn in the prose.
 *
 * **A block-only anchor is skipped**, and that is the design rather than an
 * omission: the reader pressed the chat button beside a paragraph and picked
 * out no words, so there is nothing to underline. Washing the whole paragraph
 * would claim the conversation was about all of it. Those conversations show as
 * a count on the paragraph's own button instead.
 */
export function anchored(summaries: ThreadSummary[]): AnchoredThread[] {
  const out: AnchoredThread[] = [];
  for (const s of summaries) {
    if (!s.anchor || !("quote" in s.anchor)) continue;
    out.push({
      id: s.id,
      title: s.title,
      anchor: s.anchor,
      turns: s.turns,
      lastLine: s.lastLine,
    });
  }
  return out;
}

/** How many conversations are anchored to this block, whether or not they mark it. */
export function countByBlock(summaries: ThreadSummary[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of summaries) {
    if (!s.anchor) continue;
    /* Every anchored chat, not only the block-only ones. Counting just those
       would make the number disagree with the marks sitting beside it — a
       paragraph with two selections and no whole-block chat would say "0" over
       two visible marks. */
    counts.set(s.anchor.blockId, (counts.get(s.anchor.blockId) ?? 0) + 1);
  }
  return counts;
}

/**
 * **The questions the reader asked about a passage**, for the Comments drawer.
 *
 * Every *chat* with an anchor: the gutter's "?" (whole block) and *Chat about
 * this* on a selection. Both are a question about somewhere in the article, and
 * a whole-block one draws no mark in the prose, so without this a reader who
 * forgot which paragraph they pressed had nowhere to find it again — Greg,
 * SPIDERYARN-READING2-6W. An unanchored chat is about the whole piece, has
 * nowhere to jump to, and stays in Chat mode only.
 *
 * **`kind === "chat"` by a positive test**, for the reason `overlay` in
 * Reader.tsx gives: opening a row sets `?thread=`, and only a chat may be opened
 * by the floating dialog.
 *
 * **Minus the chats a comment already points at** (`Comment.threadId`): *Also
 * ask the AI* on a comment makes an anchored chat, and the drawer already lists
 * that comment, so without this one question would be two rows. GPT Sol's plan
 * review, finding 3.
 */
export function askedQuestions(
  summaries: ThreadSummary[],
  comments: readonly { threadId?: string | undefined }[],
): AskedQuestion[] {
  const linked = new Set(comments.flatMap((c) => (c.threadId ? [c.threadId] : [])));
  const out: AskedQuestion[] = [];
  for (const s of summaries) {
    if (s.kind !== "chat" || !s.anchor || linked.has(s.id)) continue;
    out.push({
      id: s.id,
      blockId: s.anchor.blockId,
      quote: "quote" in s.anchor ? s.anchor.quote : undefined,
      start: "quote" in s.anchor ? s.anchor.start : undefined,
      createdAt: s.createdAt,
      lastLine: s.lastLine,
    });
  }
  return out;
}

/**
 * **The margin's questions, less the one drawn as a card beside them.**
 *
 * While a block's conversation is a card in the Marginalia column
 * (docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md § 6),
 * that block's *Question · About this paragraph* line would sit directly above
 * the card that is that question. So the margin's list goes without it, for as
 * long as the card is up. **The margin's only**: the Comments drawer lists
 * every question whether or not one is open.
 *
 * **The same array when nothing is dropped**, because the margin's notes are
 * memoised on it and `memo(TableView)` on them.
 */
export function askedBesideCard<T extends { id: string }>(
  asked: readonly T[],
  cardThreadId: string | null,
): readonly T[] {
  if (cardThreadId === null || !asked.some((q) => q.id === cardThreadId)) return asked;
  return asked.filter((q) => q.id !== cardThreadId);
}

/**
 * **The conversation a second press of "?" should open instead of buying.**
 *
 * The gutter's "?" spends a model call with no confirmation, so pressing it on
 * a paragraph you asked about ten minutes ago must show you the answer you
 * already have rather than a second one. `App.helpAboutBlock` asks this first
 * and only mints a thread when it comes back empty.
 *
 * **Whole-block anchors only**, which is the same distinction `anchored` above
 * makes and for a sharper reason here: a conversation about a phrase the reader
 * *selected* is about that phrase, so opening it for somebody asking about the
 * paragraph would answer a question they did not ask — and would make the "?"
 * quietly do nothing new on any paragraph they had ever highlighted.
 *
 * **The newest**, because it is the one whose context is closest to where they
 * are now, and because "the oldest" would strand them in the conversation they
 * have already read.
 *
 * A function here rather than three lines inside App so that the rules above
 * are somewhere a test can reach them. `tests/help-sends-once.test.tsx`.
 */
export function helpThreadFor(
  summaries: ThreadSummary[],
  blockId: string,
): ThreadSummary | undefined {
  let best: ThreadSummary | undefined;
  for (const s of summaries) {
    if (s.kind !== "chat") continue;
    if (!s.anchor || s.anchor.blockId !== blockId || "quote" in s.anchor) continue;
    if (!best || s.updatedAt > best.updatedAt) best = s;
  }
  return best;
}

/**
 * **The conversation the gutter's chat chip should open rather than replace.**
 *
 * The chip carries a count, and until 2026-09-05 a press on it minted a fresh
 * draft — so the reader who clicked a blue mark saying *"(3 already)"* got an
 * empty composer. `App.chatAboutBlock` asks this first and falls back to the
 * draft only when it comes back empty.
 *
 * ## The order is not "newest wins", and that is the whole of it
 *
 * **A whole-block conversation beats a selection, however much newer the
 * selection is.** The reader pressed a control beside a *paragraph*, so the
 * paragraph's own conversation is the one they are pointing at; letting a
 * three-word highlight from a minute ago displace it would answer a question
 * they did not ask. GPT Sol's finding 4 on the plan, against Fable's flat
 * "newest", and Sol has the better of it.
 *
 * **But a selection is still opened when there is no whole-block chat**, and
 * that is where this parts company with `helpThreadFor` above, which admits
 * whole-block anchors only. The two buttons make different promises: the "?"
 * *spends*, so it must be sure the conversation it reopens answers the question
 * being asked, while the chip is free and its count already includes every
 * anchored conversation on the block. Showing one of the things it is counting
 * is the truthful thing for it to do.
 *
 * `kind === "chat"` is filtered **positively**, so the rule that the reading
 * view only ever draws chats is stated here rather than borrowed from the
 * route's correctness.
 *
 * **Newest by `updatedAt`** within each tier, the same comparison
 * `helpThreadFor` makes and for the same reason: it is the one whose context is
 * closest to where the reader is now.
 */
export function threadFor(
  summaries: ThreadSummary[],
  blockId: string,
): ThreadSummary | undefined {
  let block: ThreadSummary | undefined;
  let selection: ThreadSummary | undefined;
  for (const s of summaries) {
    if (s.kind !== "chat") continue;
    if (!s.anchor || s.anchor.blockId !== blockId) continue;
    if ("quote" in s.anchor) {
      if (!selection || s.updatedAt > selection.updatedAt) selection = s;
    } else if (!block || s.updatedAt > block.updatedAt) block = s;
  }
  return block ?? selection;
}

/**
 * **The conversation that was started from this item in another mode**, for
 * the item to draw its way back from. Derived from the summaries, so nothing
 * is stored on the item's side (plan 261005i, D2).
 *
 * The match is exact (`sameOrigin`): a claim has no id, so its block and its
 * words are its name, and a new search that words the claim differently no
 * longer matches. The conversation is then still in Chat's list; only the
 * mark goes. A lens never matches a claim, whatever its words; the chats
 * started from a lens are listed by `lensThreads` below.
 *
 * The newest by `updatedAt`, `threadFor`'s rule. `kind === "chat"` positively,
 * because the mark opens the floating dialog, which is chat's.
 */
export function threadForOrigin(
  summaries: readonly ThreadSummary[],
  origin: ThreadOrigin,
): ThreadSummary | undefined {
  let best: ThreadSummary | undefined;
  for (const s of summaries) {
    if (s.kind !== "chat" || !s.origin || !sameOrigin(s.origin, origin)) continue;
    if (!best || s.updatedAt > best.updatedAt) best = s;
  }
  return best;
}

/** A chat's summary whose origin is a lens: what one line of Debate's *Your angles* is drawn from. */
export type LensThread = ThreadSummary & { origin: LensOrigin };

/**
 * **Every chat that was started from an angle typed into Debate's box**,
 * newest first: Debate's *Your angles*, the way back to them
 * (plan 261005k, A). Derived from the summaries, as `threadForOrigin` is, so
 * nothing is stored on Debate's side.
 *
 * A list and not a lookup: an angle is the reader's own free words with
 * nothing in Debate to hang a mark on, and two chats started from the same
 * words are two conversations, so each gets its line. `kind === "chat"`
 * positively, for `threadForOrigin`'s reason.
 */
export function lensThreads(summaries: readonly ThreadSummary[]): LensThread[] {
  const out: LensThread[] = [];
  for (const s of summaries) {
    if (s.kind !== "chat" || !s.origin || !isLensOrigin(s.origin)) continue;
    out.push({ ...s, origin: s.origin });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * **The list that arrives from the server, with what happened while it was in
 * the air folded back in.**
 *
 * The fetch takes a snapshot and resolves some hundreds of milliseconds later.
 * Anything the reader did in that window — starting a conversation, deleting
 * one, finishing a turn — is a write the snapshot cannot contain, so replacing
 * the array with it **silently undoes their work**. That was the bug until
 * 2026-09-05, and the "?" in the gutter is what made it cost money: the
 * optimistic summary for a just-bought conversation vanished under the arriving
 * GET, so the next press found nothing anchored to that paragraph and bought a
 * second answer. GPT Sol's stage 3 review, finding 1.
 *
 * **`local` is not a delta anyone had to record.** The effect sets the array
 * empty before it fetches, so by the time this runs, everything in it got there
 * from `add` or `touch` during the flight — the local writes *are* the state.
 * Only `drop` needs remembering separately, because removing something leaves
 * no trace to compare against and the arriving snapshot would resurrect it.
 *
 * Local wins wherever both have an id, and that ordering is the point rather
 * than a tie-break: the fetch was issued **before** any of these writes, so on
 * every one of them the local copy is the newer fact.
 */
/**
 * **Since `refresh` (2026-10-05) the local writes are recorded**, because a
 * refetch does not empty the array first: `written` is the ids `add` or
 * `touch` changed while this request was out, and only those rows win over the
 * answer. A row the reader did not touch takes the server's newer copy, and a
 * row the server no longer has goes. For the first fetch nothing changes: the
 * array starts empty, so every row in it was written.
 *
 * **"The server no longer has it" needs the server to have had it.** A row
 * `add` put here that no answer has ever contained (`unseen`) is not one the
 * server dropped: its first question was refused, or the list was read before
 * the insert. It stays, whenever it was added, until an answer names it or
 * `drop` takes it. The first version removed it, and the floating dialog is
 * drawn from this row, so a refused first question closed the dialog over its
 * own reason.
 * docs/postmortems/261005q-a-refetch-cannot-tell-never-had-from-no-longer-has.md
 */
function foldInLocalWrites(
  fetched: ThreadSummary[],
  local: ThreadSummary[],
  flight: Flight,
  unseen: ReadonlySet<string>,
): ThreadSummary[] {
  const mine = new Map(
    local.filter((s) => flight.written.has(s.id) || unseen.has(s.id)).map((s) => [s.id, s]),
  );
  const out = fetched.filter((s) => !flight.dropped.has(s.id)).map((s) => mine.get(s.id) ?? s);
  const seen = new Set(out.map((s) => s.id));
  for (const s of mine.values()) if (!seen.has(s.id)) out.push(s);
  return out;
}

/** What the reader did while a request for the list was in the air. */
interface Flight {
  written: Set<string>;
  dropped: Set<string>;
}

export function useChatAnchors(slug: string): ChatAnchorsApi {
  const [summaries, setSummaries] = useState<ThreadSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The local writes made while a request is in the air.
   *
   * `null` once it has landed, because after that nothing replaces the array
   * and there is nothing to remember — a `Set` that went on growing for the
   * life of the page would be a leak in the shape of a fix. A request that
   * supersedes one still out inherits its record: those writes are newer than
   * the new snapshot too, or as good as.
   */
  const flight = useRef<Flight | null>(null);
  /**
   * Conversations `add` put here that no answer from the server has contained
   * yet (`foldInLocalWrites`). Bounded by what this tab started and the server
   * never took; an answer that names one, or a `drop`, takes it out.
   */
  const unseen = useRef(new Set<string>());
  /**
   * Deletions made after each optimistic row was added. A refetch may name
   * its stored id before the send does, letting the reader delete that id
   * first. The delayed acknowledgement must not recreate it, even between
   * list requests. Kept only while the row awaits a name; older deletions
   * must not prevent a new conversation from using the same id.
   */
  const droppedSinceAdd = useRef(new Map<string, Set<string>>());
  /** Server-confirmed ids for this article. `add` must not make one unseen again. */
  const confirmed = useRef(new Set<string>());
  /** The newest request. An older one's answer is not allowed to land. */
  const request = useRef(0);
  /** Whether any answer has landed for this article, so a failed *refresh* stays quiet. */
  const landed = useRef(false);
  /** A completion from a composer that has gone may only refresh its own mounted article. */
  const activeSlug = useRef<string | null>(null);

  const ask = useCallback(() => {
    const mine = ++request.current;
    flight.current ??= { written: new Set(), dropped: new Set() };
    apiFetch(`/api/chat/${encodeURIComponent(slug)}?summary=1`)
      .then((r) => readJson<{ threads?: ThreadSummary[]; error?: string }>(r))
      .then((body) => {
        if (request.current !== mine) return;
        const during = flight.current ?? { written: new Set<string>(), dropped: new Set<string>() };
        flight.current = null;
        if (body.error) {
          if (!landed.current) setError(body.error);
        } else {
          const fetched = body.threads ?? [];
          /* Only an answer that lands confirms a row. Prune before taking
             the snapshot: an optimistic row written before this flight must
             take the server's first copy too. Keep ref mutations outside the
             updater, which React may run twice. */
          for (const s of fetched) {
            confirmed.current.add(s.id);
            unseen.current.delete(s.id);
            droppedSinceAdd.current.delete(s.id);
          }
          const waiting = new Set(unseen.current);
          setSummaries((local) => foldInLocalWrites(fetched, local, during, waiting));
        }
        landed.current = true;
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (request.current !== mine) return;
        flight.current = null;
        /* A mark that is not drawn is not worth a message across the reading
           view — the conversation is still in chat mode, and the reader has
           lost a shortcut rather than their work. Kept for whoever wants to
           show it, but nothing here insists.

           Only the first load says it failed. A failed refresh leaves the
           list that was already there, which is still the best one we have. */
        if (!landed.current) setError(e.message);
        landed.current = true;
        setLoaded(true);
      });
  }, [slug]);

  useEffect(() => {
    activeSlug.current = slug;
    /* Another article: nothing done to the last one's list applies. */
    flight.current = null;
    unseen.current = new Set();
    droppedSinceAdd.current = new Map();
    confirmed.current = new Set();
    landed.current = false;
    setSummaries([]);
    setLoaded(false);
    /* The last article's failure is not this one's. It was harmless while only
       the hook's own callers read `error`; the Comments drawer says it aloud
       now (plan 260930f), so a stale one would claim this article's questions
       failed to load. GPT Sol's plan review, finding 4. */
    setError(null);
    ask();
    return () => {
      /* Whatever is out is for an article, or a mount, that has gone. */
      request.current++;
      activeSlug.current = null;
    };
  }, [ask, slug]);

  const refresh = useCallback(() => {
    if (activeSlug.current === slug) ask();
  }, [ask, slug]);

  const add = useCallback((summary: ThreadSummary) => {
    flight.current?.written.add(summary.id);
    flight.current?.dropped.delete(summary.id);
    if (!confirmed.current.has(summary.id)) unseen.current.add(summary.id);
    /* An explicit add is newer than a deletion, even when this id appeared
       in a previous conversation. Historical confirmation is not an
       acknowledgement of this addition. */
    for (const dropped of droppedSinceAdd.current.values()) dropped.delete(summary.id);
    if (!droppedSinceAdd.current.has(summary.id)) {
      droppedSinceAdd.current.set(summary.id, new Set());
    }
    setSummaries((prev) =>
      prev.some((s) => s.id === summary.id)
        ? prev.map((s) => (s.id === summary.id ? summary : s))
        : [...prev, summary],
    );
  }, []);

  const drop = useCallback((threadId: string) => {
    /* A current list request remembers the deletion: without it the GET
       would quietly bring the conversation back. Pending additions also
       remember it until their identity is reconciled. See `foldInLocalWrites`
       and `rename`. */
    flight.current?.dropped.add(threadId);
    flight.current?.written.delete(threadId);
    unseen.current.delete(threadId);
    for (const dropped of droppedSinceAdd.current.values()) dropped.add(threadId);
    droppedSinceAdd.current.delete(threadId);
    setSummaries((prev) => prev.filter((s) => s.id !== threadId));
  }, []);

  const touch = useCallback((threadId: string, patch: Partial<ThreadSummary>) => {
    flight.current?.written.add(threadId);
    setSummaries((prev) =>
      prev.map((s) => (s.id === threadId ? { ...s, ...patch } : s)),
    );
  }, []);

  const rename = useCallback((from: string, to: string) => {
    if (from === to) return;
    /* Called from a turn's acknowledgement, which outlives its dialog
       (ChatDialog.tsx § `onConfirmed`), so it can arrive for an article this
       hook has left. `refresh`'s guard, for the same reason. */
    if (activeSlug.current !== slug) return;
    const discarded = droppedSinceAdd.current.get(from)?.has(to) ?? false;
    droppedSinceAdd.current.delete(from);
    /* A later deletion takes precedence over this creation acknowledgement.
       Otherwise `to` takes `from`'s place in both records: `written` gets `to`
       whether or not `from` was written during this flight. `from` needs no
       entry in `dropped`: on the server it is a message's id, so no answer
       lists it as a conversation. */
    if (flight.current) {
      flight.current.written.delete(from);
      if (discarded) flight.current.dropped.add(to);
      else {
        flight.current.written.add(to);
        flight.current.dropped.delete(to);
      }
    }
    unseen.current.delete(from);
    if (!discarded && !confirmed.current.has(to)) unseen.current.add(to);
    setSummaries((prev) => {
      if (discarded) return prev.filter((s) => s.id !== from && s.id !== to);
      if (!prev.some((s) => s.id === from)) return prev;
      /* A refetch may have named the real one first; then the guess just goes. */
      if (prev.some((s) => s.id === to)) return prev.filter((s) => s.id !== from);
      return prev.map((s) => (s.id === from ? { ...s, id: to } : s));
    });
  }, [slug]);

  return { summaries, loaded, add, drop, rename, touch, refresh, error };
}
