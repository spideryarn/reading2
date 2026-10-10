/**
 * **A chat started from an item in a mode: the button that starts one, and
 * the mark that reopens it.** Shared by Debate's claims, Glossary's entries,
 * Bibliography's rows and Ideas' rows (since plan 261009k), so they are one
 * design and not four copies.
 *
 * - `OriginChatMark` is the way back: the chat's count of questions and how
 *   its latest answer begins. A press opens that chat beside the mode. It was
 *   drawn inline in ReceptionAndClaimsPanel.tsx § `ClaimsList` until 2026-10-06
 *   (plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D4).
 * - `AskInChatButton` is Glossary's and Bibliography's *Ask in chat*, beside Dig
 *   deeper (plan docs/plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md, D5)
 *   until 2026-10-09, and in its place since (plan 261009k).
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

import { Button } from "@/components/ui/button";

import type { CitedWork, GlossaryEntry, Idea, ThreadSummary } from "../types.js";
import { ControlTip, TipNote, Tooltip } from "./Tooltip.js";

/**
 * What a panel's rows need to start a chat about one of them and to find the
 * way back. `Item` is whatever the sender reads the id and the name from.
 */
export interface ItemChats<Item> {
  /** The reading view's thread summaries, which `Reader` owns and keeps current. */
  summaries: readonly ThreadSummary[];
  /** Start a fresh chat about this item and send its first question. */
  onAsk(item: Item): void;
  /** Open a conversation already started from an item, beside the mode. */
  onOpen(threadId: string): void;
}

/** What Glossary's entries are handed: `onAsk` takes the entry's id and name. */
export type GlossaryEntryChats = ItemChats<Pick<GlossaryEntry, "id" | "name">>;
/** What Bibliography's rows are handed: `onAsk` takes the work's id and what names it. */
export type CitedWorkChats = ItemChats<Pick<CitedWork, "id" | "title" | "authors" | "year">>;
/** What Ideas' rows are handed: `onAsk` takes the idea's id, its name and its statement (plan 261009k, stage 3). */
export type IdeaChats = ItemChats<Pick<Idea, "id" | "name" | "statement">>;

/** The button's accessible name on a Glossary entry, and on a cited work. */
export const ASK_ENTRY_IN_CHAT = "Ask about this term in chat";
export const ASK_WORK_IN_CHAT = "Ask about this work in chat";
export const ASK_IDEA_IN_CHAT = "Ask about this idea in chat";
/** The mark's accessible name on each. Debate's is `SOURCES_CLAIMS_OPEN_CLAIM_CHAT`. */
export const OPEN_ENTRY_CHAT = "Open the chat about this term";
export const OPEN_WORK_CHAT = "Open the chat about this work";
export const OPEN_IDEA_CHAT = "Open the chat about this idea";

/** What the button's card says under its name: where the press goes, and that the press is the Send (since 2026-10-06, plan 261006j). */
export const ASK_IN_CHAT_SAYS = "Opens a new chat and asks a question about it straight away.";
/** The card's two statements (plan 261010g, D3): what the chat is, and what becomes of it. */
export const ASK_IN_CHAT_WHAT = "A conversation with the AI about this one thing, which you can carry on.";
export const ASK_IN_CHAT_HOW = "The chat is kept. This button then becomes the chat's mark, which opens it again.";
/** A prose hover card's second statement (plan 261010g, D3): the card draws no mark, so its press reopens the chat the item already has. */
export const ASK_IN_CHAT_CARD_HOW =
  "Opens your chat about it if there is one. If not, starts one and asks a question straight away.";

/** The mark's tooltip: what a press does, what the number is, and what the words are. */
export function originChatTip(label: string, turns: number, words: "gist" | "answer" | "none"): string {
  const asked = `${turns} ${turns === 1 ? "question" : "questions"} so far.`;
  const said =
    words === "gist"
      ? " The words are the AI's summary of what the chat has covered."
      : words === "answer"
        ? " The words are how its latest answer begins."
        : "";
  return `${label}. ${asked}${said}`;
}

/**
 * **The way back to a chat that was started from this item.**
 *
 * The count and *No answer yet* are the app's words. The line is **the
 * chat's gist** when it has one: a small model's line on what the whole
 * conversation covered (src/chat-gist.ts), the *"short summary of the chat"*
 * Greg asked to see here (spya-pdpnjf, plan 261010g, D4). Until the first gist
 * lands, and after an edit clears it, it is the latest answer's opening,
 * clipped. Either is a model's words, so in the model's face
 * (docs/project/fonts.md, `voice-ai`). *No answer yet* until the first
 * answer has finished.
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
  const line = chat.gist ?? chat.lastLine;
  return (
    <Tooltip
      placement="bottom"
      content={<TipNote>{originChatTip(label, chat.turns, line === undefined ? "none" : chat.gist ? "gist" : "answer")}</TipNote>}
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
        {line ? (
          <span className={chat.gist ? "origin-chat-line origin-chat-gist voice-ai" : "origin-chat-line voice-ai"}>
            {line}
          </span>
        ) : (
          <span className="origin-chat-waiting">No answer yet</span>
        )}
      </button>
    </Tooltip>
  );
}

/**
 * **Glossary's, Bibliography's and Ideas' *Ask in chat*: Chat's two bubbles,
 * with its words in a card.** Where Dig deeper was (plan 261009k). Icon only
 * since plan 261010g, Greg's ask (spya-pdpnjf, 2026-10-09): *"Can we get rid
 * of the words Ask in Chat and just show the chat icon with a rich
 * tooltip?"*, which is icons.md § Navigation. Chat's icon from the bar,
 * because the press takes the reader into Chat. The prose hover cards draw
 * their own smaller button (ProseHoverCard.tsx).
 *
 * **Drawn only while the item has no chat** (plan 261010g, D2). Once it has
 * one, the caller draws `OriginChatMark` in its place, which wears the same
 * bubbles and opens that chat; and the sender behind this button reopens it
 * too, for the hover cards that draw no mark (Reader.tsx § `reopenItemChat`).
 *
 * Never disabled: a chat needs no passage and no finished lookup. **The
 * press sends the question** (since 2026-10-06, Greg's ask in
 * docs/plans/261006j-ask-in-chat-sends-the-question.md), so it is one model
 * call, and the card says so.
 */
export function AskInChatButton({
  label,
  className,
  onAsk,
}: {
  /** The accessible name and the card's head: which thing the chat will be about. */
  label: string;
  /** The caller's hook class. */
  className: string;
  onAsk(): void;
}) {
  return (
    <Tooltip
      placement="bottom"
      className="tip-soon"
      content={<ControlTip head={label} what={ASK_IN_CHAT_WHAT} how={ASK_IN_CHAT_HOW} press={ASK_IN_CHAT_SAYS} />}
    >
      {/* **The run buttons' Button, at their height** (plan 261007m S2):
          `outline`, and `icon-sm` is `sm`'s 32px square, so it still reads as
          one of them where it sits beside one. */}
      <Button type="button" variant="outline" size="icon-sm" className={className} aria-label={label} onClick={onAsk}>
        <MessagesSquare size={14} aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
