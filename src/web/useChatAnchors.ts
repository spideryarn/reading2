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
 */
import { useCallback, useEffect, useState } from "react";

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

export function useChatAnchors(slug: string): ChatAnchorsApi {
  const [summaries, setSummaries] = useState<ThreadSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSummaries([]);
    setLoaded(false);
    apiFetch(`/api/chat/${encodeURIComponent(slug)}?summary=1`)
      .then((r) => readJson<{ threads?: ThreadSummary[]; error?: string }>(r))
      .then((body) => {
        if (!live) return;
        if (body.error) setError(body.error);
        else setSummaries(body.threads ?? []);
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!live) return;
        /* A mark that is not drawn is not worth a message across the reading
           view — the conversation is still in chat mode, and the reader has
           lost a shortcut rather than their work. Kept for whoever wants to
           show it, but nothing here insists. */
        setError(e.message);
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
    setSummaries((prev) => prev.filter((s) => s.id !== threadId));
  }, []);

  const touch = useCallback((threadId: string, patch: Partial<ThreadSummary>) => {
    setSummaries((prev) =>
      prev.map((s) => (s.id === threadId ? { ...s, ...patch } : s)),
    );
  }, []);

  return { summaries, loaded, add, drop, touch, error };
}
