/**
 * **A chat started from an item in a mode: the button that starts one, and
 * the mark that reopens it.** Shared by Debate's claims, Glossary's entries
 * and Citations' rows, so the three are one design and not three copies.
 *
 * - `OriginChatMark` is the way back: the chat's count of questions and how
 *   its latest answer begins. A press opens that chat beside the mode. It was
 *   drawn inline in DebatePanel.tsx § `ClaimsList` until 2026-10-06
 *   (plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D4).
 * - `AskInChatButton` is Glossary's and Citations' *Ask in chat*, beside Dig
 *   deeper (plan docs/plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md, D5).
 *   Debate's claim has its own icon-only button on the claim's heading.
 *
 * **Nothing is stored on the item's side.** A caller finds its chat by
 * matching the item's origin against the thread summaries `Reader` holds
 * (`threadForOrigin` in useChatAnchors.ts), and hands the result here.
 *
 * **Owner only.** A visitor has no chat: each panel takes these through the
 * owner's arm of its `access` prop, so a visitor's band has nothing to pass.
 *
 * Styles: styles/origin-chat.css. A caller's own sheet adds placement only.
 */
import { MessagesSquare } from "lucide-react";

import type { CitedWork, GlossaryEntry, ThreadSummary } from "../types.js";
import { TipNote, Tooltip } from "./Tooltip.js";

/**
 * What a panel's rows need to start a chat about one of them and to find the
 * way back. `Item` is whatever the sender reads the id and the name from.
 */
export interface ItemChats<Item> {
  /** The reading view's thread summaries, which `Reader` owns and keeps current. */
  summaries: readonly ThreadSummary[];
  /** Start a fresh chat about this item. Goes to Chat with the question unsent; spends nothing. */
  onAsk(item: Item): void;
  /** Open a conversation already started from an item, beside the mode. */
  onOpen(threadId: string): void;
}

/** What Glossary's entries are handed: `onAsk` takes the entry's id and name. */
export type GlossaryEntryChats = ItemChats<Pick<GlossaryEntry, "id" | "name">>;
/** What Citations' rows are handed: `onAsk` takes the work's id and what names it. */
export type CitedWorkChats = ItemChats<Pick<CitedWork, "id" | "title" | "authors" | "year">>;

/** The words on Glossary's and Citations' button. */
export const ASK_IN_CHAT = "Ask in chat";
/** The button's accessible name on a Glossary entry, and on a cited work. */
export const ASK_ENTRY_IN_CHAT = "Ask about this term in chat";
export const ASK_WORK_IN_CHAT = "Ask about this work in chat";
/** The mark's accessible name on each. Debate's is `DEBATE_OPEN_CLAIM_CHAT`. */
export const OPEN_ENTRY_CHAT = "Open the chat about this term";
export const OPEN_WORK_CHAT = "Open the chat about this work";

/** What the button's card says under its name: where the press goes, and that it is free until Send. */
export const ASK_IN_CHAT_SAYS =
  "Opens a new chat with a question about it in the box. Nothing is sent until you press Send.";

/** The mark's tooltip: what a press does, what the number is, and what the words are. */
export function originChatTip(label: string, turns: number, answered: boolean): string {
  const asked = `${turns} ${turns === 1 ? "question" : "questions"} so far.`;
  return `${label}. ${asked}${answered ? " The words are how its latest answer begins." : ""}`;
}

/**
 * **The way back to a chat that was started from this item.**
 *
 * The count and *No answer yet* are the app's words. The line is the chat's
 * own latest answer, clipped: a model's words, so in the model's face
 * (docs/project/fonts.md, `voice-ai`). Absent while the newest question is
 * unanswered.
 *
 * Wears Chat's two bubbles, as every chat does wherever it opens
 * (docs/project/icons.md § A chat is two bubbles). Until 2026-10-06 it wore
 * one, for a conversation opened beside the mode; Greg read the one bubble
 * as a comment (spya-vj7wv0, plan 261006i). The count and the answer's
 * first words are what tell it from *Ask in chat* below.
 *
 * `preventDefault` on the press: in Debate the mark sits in a `<summary>`,
 * and the press must not also fold the claim. It costs nothing elsewhere.
 */
export function OriginChatMark({
  chat,
  label,
  className,
  onOpen,
}: {
  chat: ThreadSummary;
  /** The accessible name, and the tooltip's first sentence. */
  label: string;
  /** The caller's placement class, beside `.origin-chat`. */
  className?: string;
  onOpen(threadId: string): void;
}) {
  return (
    <Tooltip
      placement="bottom"
      content={<TipNote>{originChatTip(label, chat.turns, Boolean(chat.lastLine))}</TipNote>}
    >
      <button
        type="button"
        className={className ? `origin-chat ${className}` : "origin-chat"}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          onOpen(chat.id);
        }}
      >
        <MessagesSquare size={12} aria-hidden="true" />
        <span className="origin-chat-count">{chat.turns}</span>
        {chat.lastLine ? (
          <span className="origin-chat-line voice-ai">{chat.lastLine}</span>
        ) : (
          <span className="origin-chat-waiting">No answer yet</span>
        )}
      </button>
    </Tooltip>
  );
}

/**
 * **Glossary's and Citations' *Ask in chat*.** The neighbour of Dig deeper,
 * and drawn as it is: the quiet `.gloss-btn`, an icon and a label. Chat's
 * icon from the bar, because the press takes the reader into Chat.
 *
 * Never disabled: a chat needs no passage and no finished lookup, and the
 * press spends nothing (the question waits in the box for Send).
 */
export function AskInChatButton({
  label,
  className,
  iconSize = 12,
  onAsk,
}: {
  /** The accessible name: which thing the chat will be about. */
  label: string;
  /** The caller's classes, with `.gloss-btn` among them. */
  className: string;
  iconSize?: number;
  onAsk(): void;
}) {
  return (
    <Tooltip placement="bottom" content={<TipNote>{`${label}. ${ASK_IN_CHAT_SAYS}`}</TipNote>}>
      <button type="button" className={className} aria-label={label} onClick={onAsk}>
        <MessagesSquare size={iconSize} aria-hidden="true" />
        {ASK_IN_CHAT}
      </button>
    </Tooltip>
  );
}
