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
import {
  type ChatThread,
  isLensOrigin,
  isSituateOverviewId,
  type LearnKind,
  type SimpleLevel,
  summaryLevelOf,
  type ThreadKind,
  type ThreadOrigin,
} from "../types.js";
import { CHAT_FROM_WORDS, type ChatFrom, type LearnView } from "./params.js";
import { LEARN_SUB_MODES, SOURCES_SUB_MODES, SUMMARY_SUB_MODES, type SubMode, subModeWords } from "./sub-modes.js";

/** The parts of Learn that are a conversation: every part but Quiz. */
export type LearnConversationView = Exclude<LearnView, "quiz">;

export interface ThreadSource {
  /** The filter's word for it (`?chatfrom=`). Never `chats`: a plain chat has no source. */
  from: Exclude<ChatFrom, "chats">;
  /** Whose icon the row wears; `null` for a passage, which is not a mode. */
  mode: Mode | null;
  /** The tooltip's first line. */
  label: string;
  /**
   * **Where it came from, in the words of the chip that goes there**:
   * *Investigate*, *Claims*, *Glossary*, *Recall*. The row's meta line says it
   * (report spya-twsm7t: an icon with a hover card did not make an Investigate
   * chat look like one). Absent for a passage, which is not a mode.
   */
  place?: string;
  /** The item's or the passage's words, for the tooltip's second line. */
  quote?: string;
  /**
   * Whose words `quote` is, for its face (docs/project/fonts.md), when they
   * are not the article's: a question asked in Sources › Investigate is the reader's,
   * a literature search's overview the model's. Absent means the author's.
   */
  voice?: "reader" | "ai";
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
 * **Sources' origins** (a claim, a lens, a cited work, a citation's check and
 * a finding), each under the mode's icon and its
 * `sources` filter, and each row and tooltip naming the sub-mode it came from
 * (GPT Sol's F5 on plan 261009l). A stored origin keeps its old mode word as
 * data — `debate` for a claim or an angle (a cited work's `citations` is read
 * as `bibliography` by the server since plan 261009w) — until Stage 3 of plan
 * 261009w; this file is where it is read as the new mode.
 */
const SOURCES_IN = `${MODE_LABEL.sources} ›`;
/** What the tooltip says for a chat started from one of Claims' claims. */
export const SOURCE_SOURCES_CLAIM = `Started from a claim in ${SOURCES_IN} ${SOURCES_SUB_MODES.claims.label}`;
/**
 * And for one started from a question in Sources › Investigate: the box, or a
 * suggested question (plan 261020n). The stored word is still `reception`
 * with a lens, Reception's angle box's until that plan moved it to Investigate, so an
 * older angle chat says this too, and is listed there.
 */
export const SOURCE_RECEPTION_LENS = `Started from a question in ${SOURCES_IN} ${SOURCES_SUB_MODES.investigate.label}`;

/**
 * And for one started from a finding of the literature search, in Sources ›
 * Where it sits (plan 261025h, decision 9). A finding's chat stored a lens
 * before then, and such a chat still says `SOURCE_RECEPTION_LENS`.
 */
export const SOURCE_SITUATE_FINDING = `Started from a finding in ${SOURCES_IN} ${SOURCES_SUB_MODES.where.label}`;
/** The same origin when its item is the dossier's overview (plan 261026g § Stage 2). */
export const SOURCE_SITUATE_OVERVIEW = `Started from the overview in ${SOURCES_IN} ${SOURCES_SUB_MODES.where.label}`;

/**
 * And for one started from the sources digest: its ask box, or one
 * paragraph's *Ask in chat* (plan 261030b). One label for both; the quote says
 * which words.
 */
export const SOURCE_SOURCES_DIGEST = `Started from the digest in ${SOURCES_IN} ${SOURCES_SUB_MODES.digest.label}`;

/** And for one started from the ask box under a Summary level (plan 261030b): *Started from Summary › Fuller*. */
export function sourceSummaryLevel(level: SimpleLevel): string {
  return `Started from ${MODE_LABEL.summary} › ${SUMMARY_SUB_MODES[level].label}`;
}

/** And for one started from a Glossary entry's *Ask in chat* (plan 261006d, D6). */
export const SOURCE_GLOSSARY_ENTRY = "Started from a glossary entry";
/** And for one started from a cited work's *Ask in chat*. */
export const SOURCE_CITED_WORK = `Started from a cited work in ${SOURCES_IN} ${SOURCES_SUB_MODES.bibliography.label}`;
/**
 * And for one a citation's *Does it say that?* started, by a rest on its card
 * or the card's button (plan 261024m): the work, checked against one paragraph.
 */
export const SOURCE_CITE_CHECK = "Started from Does it say that? on a citation";
/** And for one started from an idea's *Ask in chat* (plan 261009k, stage 3). */
export const SOURCE_IDEA = "Started from an idea";
/** And for one started from a mark's *Discuss this in chat* in Learn › Quiz (plan 261024i, stage 2). */
export const SOURCE_QUIZ_MARK = `Started from a mark in ${MODE_LABEL.learn} › ${LEARN_SUB_MODES.quiz.label}`;

/** …and for a chat anchored to a block or to words in one: the "?" and a comment's question. */
export const SOURCE_PASSAGE = "About a passage";

/**
 * Which part of Learn each of its kinds is. `learn` is the stored word
 * for Recall's conversation (src/types.ts § ThreadKind). A `Record`, so a new
 * Learn kind has to say. Keyed by `LearnKind`, not `SingleThreadKind`: the
 * guide is single-thread but is not a part of Learn.
 */
export const LEARN_VIEW_OF: Readonly<Record<LearnKind, LearnConversationView>> = {
  learn: "recall",
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

/**
 * **The mode a chat with this origin came from, and its sub-mode when the
 * mode has them** — the one place an origin is mapped to where it lives
 * (plan docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md).
 * The list's icon, filter word and place (`threadSource`) and the way back
 * (`originBack`) all read it, so a new origin names its place once. A stored
 * origin keeps its old mode word as data (`reception` is Investigate's lens);
 * this is where it is read as the place it now is.
 *
 * A mode with no sub-modes, or one of `SubMode`'s arms (sub-modes.ts), so the
 * mode and its sub-mode cannot disagree. Only the arms an origin can come
 * from today, since each mode here must also be a filter word (`ChatFrom`).
 */
export type OriginPlace =
  | { mode: "glossary" | "ideas" }
  | Extract<SubMode, { mode: "sources" }>
  /* Quiz alone of Learn's: a mark's chat. Recall and Explore are Learn kinds,
     not origins. A narrowing of `SubMode`'s Learn arm, so it is still one. */
  | { mode: "learn"; view: Extract<LearnView, "quiz"> }
  /* Brief or Fuller, where the ask box sits (plan 261030b); not Thread. */
  | { mode: "summary"; view: SimpleLevel };

export function originPlace(origin: ThreadOrigin): OriginPlace {
  switch (origin.mode) {
    case "glossary":
    case "ideas":
      return { mode: origin.mode };
    /* A citation's check is about a cited work, so it lives with the work. */
    case "bibliography":
    case "cite-check":
      return { mode: "sources", view: "bibliography" };
    /* A lens lands on Investigate, where *Your questions* lists it (plan 261020n). */
    case "reception":
      return { mode: "sources", view: "investigate" };
    case "sources-claims":
      return { mode: "sources", view: "claims" };
    /* A finding lives in the dossier, which is in Where it sits (plan 261025h). */
    case "situate":
      return { mode: "sources", view: "where" };
    /* The digest and its paragraphs live in Sources › Digest (plan 261030b). */
    case "sources-digest":
      return { mode: "sources", view: "digest" };
    /* A summary level lives on its own chip. A malformed id cannot be stored
       (the route and `chat_threads_origin_summary` refuse it), so the
       fallback is only the type's. */
    case "summary":
      return { mode: "summary", view: summaryLevel(origin.itemId) };
    /* A mark in Quiz. Learn's place and filter word, but a `chat`-kind
       thread, so the row opens in Chat (`threadSource` gives it no `learn`). */
    case "quiz":
      return { mode: "learn", view: "quiz" };
    default:
      return origin satisfies never;
  }
}

/** The level a summary origin is about; Brief for an id the route would have refused. */
function summaryLevel(itemId: string): SimpleLevel {
  return summaryLevelOf(itemId) ?? "brief";
}

/** A place's name as its chip says it: the sub-mode's when there is one, else the mode's. */
function placeLabel(place: OriginPlace | SubMode): string {
  return "view" in place ? subModeWords(place).label : MODE_LABEL[place.mode];
}

export function threadSource(thread: SourcedThread): ThreadSource | null {
  const { origin, kind, anchor } = thread;
  if (origin) {
    const place = originPlace(origin);
    /* Each mode an origin can come from is also its own filter word. */
    const at = { from: place.mode, mode: place.mode, place: placeLabel(place) };
    switch (origin.mode) {
      case "reception":
        return { ...at, label: SOURCE_RECEPTION_LENS, quote: origin.lens, voice: "reader" };
      case "sources-claims":
        return { ...at, label: SOURCE_SOURCES_CLAIM, quote: origin.quote };
      /* The quote is the entry's name as it was when the chat started. */
      case "glossary":
        return { ...at, label: SOURCE_GLOSSARY_ENTRY, quote: origin.quote };
      case "bibliography":
        return { ...at, label: SOURCE_CITED_WORK, quote: origin.quote };
      case "ideas":
        return { ...at, label: SOURCE_IDEA, quote: origin.quote };
      /* The quote is the work's title as it was when the chat started. */
      case "cite-check":
        return { ...at, label: SOURCE_CITE_CHECK, quote: origin.quote };
      /* The question's words. No `learn`: that field sends a row to Learn,
         and this is a chat, opened in Chat like any other. */
      case "quiz":
        return { ...at, label: SOURCE_QUIZ_MARK, quote: origin.quote };
      /* The finding's passage: the article's words, so no voice. The
         overview's words are the model's. */
      case "situate":
        return isSituateOverviewId(origin.itemId)
          ? { ...at, label: SOURCE_SITUATE_OVERVIEW, quote: origin.quote, voice: "ai" }
          : { ...at, label: SOURCE_SITUATE_FINDING, quote: origin.quote };
      /* The digest's words and a summary's are the model's. */
      case "sources-digest":
        return { ...at, label: SOURCE_SOURCES_DIGEST, quote: origin.quote, voice: "ai" };
      case "summary":
        return { ...at, label: sourceSummaryLevel(summaryLevel(origin.itemId)), quote: origin.quote, voice: "ai" };
      default:
        return origin satisfies never;
    }
  }
  switch (kind) {
    case "learn":
    case "explore": {
      const view = LEARN_VIEW_OF[kind];
      return {
        from: "learn",
        mode: "learn",
        label: `From ${MODE_LABEL.learn} › ${LEARN_SUB_MODES[view].label}`,
        place: placeLabel({ mode: "learn", view }),
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
  summary: MODE_LABEL.summary,
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
 * in `threadSource`'s voice; a lens has none, since a question is the
 * reader's own and not an item in the article, and reads *your question*.
 */
export interface OriginBackWords {
  mode: Mode;
  /** The sub-mode the press opens: Sources' on a Sources origin, Quiz on a mark, a Summary level's, none otherwise. */
  view?: Extract<OriginPlace, { view: unknown }>["view"];
  /**
   * The word on the button the press lands on: the mode's (*Glossary*), or
   * for Sources its sub-mode's (*Bibliography*, *Claims*, *Investigate*),
   * the more exact of the two, under the mode's icon.
   */
  modeLabel: string;
  /** The item's name snapshot, or `null` for a lens. */
  quote: string | null;
  /** The whole line as one sentence, for its accessible name and its tooltip. */
  text: string;
}

/** What the way back calls a lens, which has no name of its own. ChatPanel.tsx § `OriginBack` draws it. */
export const LENS_BACK = "your question";

export function originBack(origin: ThreadOrigin): OriginBackWords {
  const quote = isLensOrigin(origin) ? null : origin.quote;
  const what = quote === null ? LENS_BACK : `“${quote}”`;
  const place = originPlace(origin);
  const modeLabel = placeLabel(place);
  return {
    mode: place.mode,
    ...("view" in place ? { view: place.view } : {}),
    modeLabel,
    quote,
    text: `Back to ${what} in ${modeLabel}`,
  };
}
