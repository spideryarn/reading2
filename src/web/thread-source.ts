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
import { type ChatThread, isLensOrigin, type LearnKind, type ThreadKind, type ThreadOrigin } from "../types.js";
import { CHAT_FROM_WORDS, type ChatFrom, type LearnView, type SourcesView } from "./params.js";
import { LEARN_SUB_MODES, SOURCES_SUB_MODES } from "./sub-modes.js";

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

/**
 * **Sources' three origins**, each under the mode's icon and its
 * `sources` filter, and each tooltip naming the sub-mode it came from
 * (GPT Sol's F5 on plan 261009l). A stored origin keeps its old mode word as
 * data — `citations` for a cited work, `debate` for a claim or an angle —
 * until the deep rename (that plan § Stage 3); this file is where it is read
 * as the new mode.
 */
const SOURCES_IN = `${MODE_LABEL.sources} ›`;
/** What the tooltip says for a chat started from one of Claims' claims. */
export const SOURCE_DEBATE_CLAIM = `Started from a claim in ${SOURCES_IN} ${SOURCES_SUB_MODES.claims.label}`;
/** And for one started from an angle the reader typed into Reception's box (plan 261005k, A). */
export const SOURCE_DEBATE_LENS = `Started from an angle in ${SOURCES_IN} ${SOURCES_SUB_MODES.reception.label}`;

/** And for one started from a Glossary entry's *Ask in chat* (plan 261006d, D6). */
export const SOURCE_GLOSSARY_ENTRY = "Started from a glossary entry";
/** And for one started from a cited work's *Ask in chat*. */
export const SOURCE_CITED_WORK = `Started from a cited work in ${SOURCES_IN} ${SOURCES_SUB_MODES.bibliography.label}`;
/** And for one started from an idea's *Ask in chat* (plan 261009k, stage 3). */
export const SOURCE_IDEA = "Started from an idea";

/** …and for a chat anchored to a block or to words in one: the "?" and a comment's question. */
export const SOURCE_PASSAGE = "About a passage";

/**
 * Which part of Learn each of its kinds is. `learn` is the stored word
 * for Recall's conversation (src/types.ts § ThreadKind). A `Record`, so a new
 * Learn kind has to say. Keyed by `LearnKind`, not `SingleThreadKind`: the
 * guide is single-thread but is not a part of Learn.
 */
const LEARN_VIEW_OF: Readonly<Record<LearnKind, LearnConversationView>> = {
  learn: "recall",
  tutorial: "tutorial",
  explore: "explore",
};

/**
 * **Does Chat's list show this conversation?** Every kind but Candidates,
 * which is Referee's machinery and not a conversation the reader had, and the
 * guide, which Chat is to pin above its list rather than list among the rest,
 * outside the source filter (GPT Sol's F2 on
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md).
 *
 * Listing is not opening: Chat's band opens only `chat`-kind conversations
 * (`ConversationBand`, the plan review's F3).
 */
export function listedInChat(thread: { kind: ThreadKind }): boolean {
  return thread.kind !== "candidates" && thread.kind !== "guide";
}

/**
 * **Can Chat's band open this conversation, and send to it?** A chat, and the
 * guide (plan 261007j, GPT Sol's F2: *openable in Chat* is its own idea, apart
 * from single-thread and from Learn). Not the same set as `listedInChat`: a
 * Learn row is listed and opens Learn; the guide is pinned rather than listed,
 * and opens here.
 */
export function openableInChat(kind: ThreadKind): boolean {
  return kind === "chat" || kind === "guide";
}

/** What the pinned row and the open guide's header call it. */
export const GUIDE_LABEL = "Guide";

export function threadSource(thread: SourcedThread): ThreadSource | null {
  const { origin, kind, anchor } = thread;
  if (origin) {
    switch (origin.mode) {
      case "debate":
        /* Two shapes under one stored word, so the word does not say which. */
        return isLensOrigin(origin)
          ? { from: "sources", mode: "sources", label: SOURCE_DEBATE_LENS, quote: origin.lens, voice: "reader" }
          : { from: "sources", mode: "sources", label: SOURCE_DEBATE_CLAIM, quote: origin.quote };
      /* The quote is the entry's name as it was when the chat started. */
      case "glossary":
        return { from: "glossary", mode: "glossary", label: SOURCE_GLOSSARY_ENTRY, quote: origin.quote };
      case "citations":
        return { from: "sources", mode: "sources", label: SOURCE_CITED_WORK, quote: origin.quote };
      case "ideas":
        return { from: "ideas", mode: "ideas", label: SOURCE_IDEA, quote: origin.quote };
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
    /* Never listed (`listedInChat`), so it has nothing to say here. The guide
       is pinned above the list, never filtered by source. */
    case "candidates":
    case "guide":
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
  sources: MODE_LABEL.sources,
  glossary: MODE_LABEL.glossary,
  ideas: MODE_LABEL.ideas,
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

/**
 * **The way back from an open chat to the item it was started from** — the
 * line above the transcript in Chat's band (ChatPanel.tsx § `OriginBack`;
 * plan docs/plans/261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md,
 * stage 2). Greg, 2026-10-09: *"I want to be able to go back to the
 * citations mode, and also sort of highlight the … block or whatever that
 * the chat is relevant to."*
 *
 * `mode` is the mode the press opens, whose icon the line wears
 * (docs/project/icons.md). `quote` is the item's name as the chat stored it,
 * in `threadSource`'s voice; a lens has none, since an angle is the reader's
 * own words and not an item in the article, and reads *your angle*.
 */
export interface OriginBackWords {
  mode: Mode;
  /** Sources' sub-mode the press opens, on a Sources origin and no other. */
  view?: SourcesView;
  /**
   * The word on the button the press lands on: the mode's (*Glossary*), or
   * for Sources its sub-mode's (*Bibliography*, *Reception*, *Claims*),
   * the more exact of the two, under the mode's icon.
   */
  modeLabel: string;
  /** The item's name snapshot, or `null` for a lens. */
  quote: string | null;
  /** The whole line as one sentence, for its accessible name and its tooltip. */
  text: string;
}

export function originBack(origin: ThreadOrigin): OriginBackWords {
  const quote = isLensOrigin(origin) ? null : origin.quote;
  const what = quote === null ? "your angle" : `“${quote}”`;
  switch (origin.mode) {
    case "glossary":
    case "ideas": {
      const modeLabel = MODE_LABEL[origin.mode];
      return { mode: origin.mode, modeLabel, quote, text: `Back to ${what} in ${modeLabel}` };
    }
    case "citations":
    case "debate": {
      const view = origin.mode === "citations" ? "bibliography" : isLensOrigin(origin) ? "reception" : "claims";
      const modeLabel = SOURCES_SUB_MODES[view].label;
      return { mode: "sources", view, modeLabel, quote, text: `Back to ${what} in ${modeLabel}` };
    }
    default:
      return origin satisfies never;
  }
}
