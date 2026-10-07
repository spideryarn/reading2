/**
 * **Where a row in Chat's list came from**, for its icon, its tooltip, where
 * a press on it goes and the filter above the list
 * (plan docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md, D5;
 * report `spya-hyfqkq`).
 *
 * One pure function, so the order of the rules is in one place: a stored
 * origin, then a Learn kind, then an anchor, then a plain chat. The order
 * matters because two can be true of one conversation: a claim check that
 * also had an anchor is still a claim check.
 *
 * `mode` is the mode whose icon the row wears (docs/project/icons.md: a
 * control that takes you into a mode uses that mode's icon), or `null` where
 * the source is not a mode. The icon itself is chosen where it is drawn
 * (ChatPanel.tsx § `ThreadSourceMark`, from mode-icons.ts), so this file
 * imports no component.
 */
import type { Mode } from "../modes.js";
import { MODE_LABEL } from "../title-text.js";
import { type ChatThread, isLensOrigin, type SingleThreadKind, type ThreadKind } from "../types.js";
import { CHAT_FROM_WORDS, type ChatFrom, type LearnView } from "./params.js";
import { LEARN_SUB_MODES } from "./sub-modes.js";

/** The parts of Learn that are a conversation: every part but Quiz. */
export type LearnConversationView = Exclude<LearnView, "quiz">;

export interface ThreadSource {
  /** The filter's word for it (`?chatfrom=`). Never `chats`: a plain chat has no source. */
  from: Exclude<ChatFrom, "chats">;
  /** Whose icon the row wears; `null` for a passage, which is not a mode. */
  mode: Mode | null;
  /** The tooltip's first line. */
  label: string;
  /** The item's or the passage's words, for the tooltip's second line. */
  quote?: string;
  /**
   * Whose words `quote` is, for its face (docs/project/fonts.md), when they
   * are not the article's: an angle typed into Debate's box is the reader's.
   * Absent means the author's.
   */
  voice?: "reader";
  /**
   * **The part of Learn this conversation lives in**, on a Learn row
   * and on no other. A row with this is not opened in Chat's band: a press
   * goes to Learn, and it has no rename or delete (D5).
   */
  learn?: LearnConversationView;
}

/** What the fields of a conversation `threadSource` reads. */
export type SourcedThread = Pick<ChatThread, "kind"> & Partial<Pick<ChatThread, "origin" | "anchor">>;

/** What the tooltip says for a chat started from one of Debate's claims. */
export const SOURCE_DEBATE_CLAIM = "Started from a claim in Debate";
/** And for one started from an angle the reader typed into Debate's box (plan 261005k, A). */
export const SOURCE_DEBATE_LENS = "Started from an angle in Debate";

/** And for one started from a Glossary entry's *Ask in chat* (plan 261006d, D6). */
export const SOURCE_GLOSSARY_ENTRY = "Started from a glossary entry";
/** And for one started from a cited work's *Ask in chat*. */
export const SOURCE_CITED_WORK = "Started from a cited work";

/** …and for a chat anchored to a block or to words in one: the "?" and a comment's question. */
export const SOURCE_PASSAGE = "About a passage";

/**
 * Which part of Learn each of its kinds is. `learn` is the stored word
 * for Recall's conversation (src/types.ts § ThreadKind). A `Record`, so a new
 * single-thread kind has to say.
 */
const LEARN_VIEW_OF: Readonly<Record<SingleThreadKind, LearnConversationView>> = {
  learn: "recall",
  tutorial: "tutorial",
  explore: "explore",
};

/**
 * **Does Chat's list show this conversation?** Every kind but Candidates,
 * which is Referee's machinery and not a conversation the reader had.
 *
 * Listing is not opening: Chat's band opens only `chat`-kind conversations
 * (`ConversationBand`, the plan review's F3).
 */
export function listedInChat(thread: { kind: ThreadKind }): boolean {
  return thread.kind !== "candidates";
}

export function threadSource(thread: SourcedThread): ThreadSource | null {
  const { origin, kind, anchor } = thread;
  if (origin) {
    switch (origin.mode) {
      case "debate":
        /* Two shapes under one mode, so the mode does not say which. */
        return isLensOrigin(origin)
          ? { from: "debate", mode: "debate", label: SOURCE_DEBATE_LENS, quote: origin.lens, voice: "reader" }
          : { from: "debate", mode: "debate", label: SOURCE_DEBATE_CLAIM, quote: origin.quote };
      /* The quote is the entry's name as it was when the chat started. */
      case "glossary":
        return { from: "glossary", mode: "glossary", label: SOURCE_GLOSSARY_ENTRY, quote: origin.quote };
      case "citations":
        return { from: "citations", mode: "citations", label: SOURCE_CITED_WORK, quote: origin.quote };
      default:
        return origin satisfies never;
    }
  }
  switch (kind) {
    case "learn":
    case "tutorial":
    case "explore": {
      const view = LEARN_VIEW_OF[kind];
      return {
        from: "learn",
        mode: "learn",
        label: `From ${MODE_LABEL.learn} › ${LEARN_SUB_MODES[view].label}`,
        learn: view,
      };
    }
    case "chat":
      if (!anchor) return null;
      return {
        from: "passage",
        mode: null,
        label: SOURCE_PASSAGE,
        ...("quote" in anchor ? { quote: anchor.quote } : {}),
      };
    /* Never listed (`listedInChat`), so it has nothing to say here. */
    case "candidates":
      return null;
    default:
      return kind satisfies never;
  }
}

/** The filter's word for a conversation: its source's, or `chats` for a plain one. */
export function chatFrom(thread: SourcedThread): ChatFrom {
  return threadSource(thread)?.from ?? "chats";
}

/**
 * What the filter calls each choice. A mode's is its own name
 * (`MODE_LABEL`), so a renamed mode renames its choice.
 */
export const CHAT_FROM_LABEL: Readonly<Record<ChatFrom, string>> = {
  chats: "Chats",
  debate: MODE_LABEL.debate,
  glossary: MODE_LABEL.glossary,
  citations: MODE_LABEL.citations,
  learn: MODE_LABEL.learn,
  passage: SOURCE_PASSAGE,
};

/** The sources these conversations came from, once each, in the filter's order. */
export function sourcesIn(threads: readonly SourcedThread[]): ChatFrom[] {
  const present = new Set(threads.map(chatFrom));
  return CHAT_FROM_WORDS.filter((word) => present.has(word));
}

/** The conversations from one source, or all of them for no choice. */
export function narrowed<T extends SourcedThread>(threads: readonly T[], from: ChatFrom | null): T[] {
  return from === null ? [...threads] : threads.filter((t) => chatFrom(t) === from);
}
