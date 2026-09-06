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
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatAnchor, ThreadSummary } from "../types.js";
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
   * A thread's title or newest answer changed.
   *
   * Only the fields a hover shows. Deliberately **not** called per token: the
   * whole point of this hook is that it does not change while an answer
   * streams. `ChatDialog` calls it once, when a turn finishes.
   */
  touch(threadId: string, patch: Partial<ThreadSummary>): void;
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
function foldInLocalWrites(
  fetched: ThreadSummary[],
  local: ThreadSummary[],
  dropped: ReadonlySet<string>,
): ThreadSummary[] {
  const mine = new Map(local.map((s) => [s.id, s]));
  const out = fetched.filter((s) => !dropped.has(s.id)).map((s) => mine.get(s.id) ?? s);
  const seen = new Set(out.map((s) => s.id));
  for (const s of local) if (!seen.has(s.id)) out.push(s);
  return out;
}

export function useChatAnchors(slug: string): ChatAnchorsApi {
  const [summaries, setSummaries] = useState<ThreadSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Conversations dropped while the first fetch was still in the air.
   *
   * `null` once it has landed, because after that nothing replaces the array
   * and there is nothing to remember — a `Set` that went on growing for the
   * life of the page would be a leak in the shape of a fix.
   */
  const droppedInFlight = useRef<Set<string> | null>(null);

  useEffect(() => {
    let live = true;
    droppedInFlight.current = new Set();
    setSummaries([]);
    setLoaded(false);
    apiFetch(`/api/chat/${encodeURIComponent(slug)}?summary=1`)
      .then((r) => readJson<{ threads?: ThreadSummary[]; error?: string }>(r))
      .then((body) => {
        if (!live) return;
        if (body.error) setError(body.error);
        else {
          const dropped = droppedInFlight.current ?? new Set<string>();
          setSummaries((local) => foldInLocalWrites(body.threads ?? [], local, dropped));
        }
        droppedInFlight.current = null;
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!live) return;
        /* A mark that is not drawn is not worth a message across the reading
           view — the conversation is still in chat mode, and the reader has
           lost a shortcut rather than their work. Kept for whoever wants to
           show it, but nothing here insists. */
        setError(e.message);
        droppedInFlight.current = null;
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [slug]);

  const add = useCallback((summary: ThreadSummary) => {
    setSummaries((prev) =>
      prev.some((s) => s.id === summary.id)
        ? prev.map((s) => (s.id === summary.id ? summary : s))
        : [...prev, summary],
    );
  }, []);

  const drop = useCallback((threadId: string) => {
    /* Remembered as well as removed, and only while the first fetch is still in
       the air: a deletion leaves nothing behind to compare the arriving
       snapshot against, so without this the GET would quietly bring the
       conversation back. See `foldInLocalWrites`. */
    droppedInFlight.current?.add(threadId);
    setSummaries((prev) => prev.filter((s) => s.id !== threadId));
  }, []);

  const touch = useCallback((threadId: string, patch: Partial<ThreadSummary>) => {
    setSummaries((prev) =>
      prev.map((s) => (s.id === threadId ? { ...s, ...patch } : s)),
    );
  }, []);

  return { summaries, loaded, add, drop, touch, error };
}
