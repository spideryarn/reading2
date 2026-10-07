/**
 * **The guide acts without a press** — plan
 * docs/plans/261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md
 * (qi-kc47m5pw). Greg, 2026-10-07, on q-tyvutf: *"yes. err on the side of
 * capability for the guide, unless there's high risk/stakes"*.
 *
 * Everywhere else a model's `[cmd:…]` token is only ever a button
 * (CommandChip.tsx, the line in docs/project/chat-llm-help-commands-vision.md).
 * In the guide, **one** of an answer's buttons presses itself, and only when
 * all of these hold:
 *
 * - **the answer has just finished arriving, in a turn this tab started, with
 *   this conversation on screen** — the chat controller's `Answered` event
 *   (chat/controller.ts), never a transcript loaded, recovered or put back
 *   (GPT Sol's F2). A stopped or cut-off answer does not act;
 * - **the chip is drawn and actually visible** at that moment (`isShown`): a
 *   band stepped aside on a phone is still mounted (F3);
 * - **it only moves the reader** (`actsAlone`): a jump, a mode that makes
 *   nothing and writes nothing (src/acts-alone.ts), or — since 2026-10-08 —
 *   Glossary or Summary's Brief or Fuller when the server found what they show
 *   already stored for this turn (`made`, plan
 *   docs/plans/261008a-guide-opens-glossary-and-summary-when-already-made.md).
 *   A quick search, a look-up, a find, a tag, a bookmark, and every other mode
 *   that generates stay presses, so a planted instruction in the article can at
 *   worst move the reader, which Back undoes;
 * - **and a mode it opens is never armed** (CommandChip.tsx,
 *   `CommandExecutor.openModeUnarmed`): if a stored artefact vanished between
 *   the server's read and the band's, the band shows its empty state and its
 *   own *Write it*, and nothing is bought (GPT Sol's F1 on plan 261008a);
 * - **it is the first such chip in the answer.** Two moves would undo each
 *   other, and the reader could not follow what happened.
 *
 * The act uses the chip's `press` handler (CommandChip.tsx), with an unarmed
 * mode opener in place of the reader's armed runner. `chipFor` checks it again
 * at that moment, exactly as it checks a reader's press.
 *
 * `GuideAct` is one object per finished answer, owned above the keyed
 * conversation and handed to that answer's chips through `GuideActContext`. The
 * first eligible chip's effect sets `used`; the conversation's own effect,
 * which React runs after its children's in the same commit, sets it too, so a
 * chip that mounts later — a re-render that redraws the answer — finds it spent
 * rather than acting late. StrictMode's second effect run finds it spent.
 */
import { createContext, useEffect, useState } from "react";
import { modeActsAlone, OPENS_FREE_ONCE_MADE } from "../acts-alone.js";
import type { ChatMessage, ThreadKind } from "../types.js";
import type { ChatChip } from "./chat-commands.js";
import type { Answered } from "./chat/controller.js";

/** One finished answer's single act, and whether it has been spent. */
export interface GuideAct {
  readonly messageId: string;
  used: boolean;
  /**
   * The generating modes the server found already made for this turn
   * (`Answered.opensFree`) — the snapshot the model was told too, so the
   * sentence it wrote and what opens agree.
   */
  readonly made: ReadonlySet<string>;
}

/** The act for the answer a chip is drawn in, or `null`: every chip outside a guide's just-finished answer. */
export const GuideActContext = createContext<GuideAct | null>(null);

/**
 * Listen above the keyed transcript: `begin` may rename and remount it in the
 * same buffered task as `done`. Match both names, but offer the act only to
 * the confirmed conversation. This is a live event, never replayed on mount.
 */
export function useGuideAct(
  threadId: string | null,
  kind: ThreadKind | undefined,
  visible: boolean,
  onAnswered: ((listener: (answered: Answered) => void) => () => void) | undefined,
): GuideAct | null {
  const [finished, setFinished] = useState<{ answered: Answered; act: GuideAct } | null>(null);
  useEffect(() => {
    if (kind !== "guide" || onAnswered === undefined || !visible || threadId === null) return;
    return onAnswered((answered) => {
      if (answered.threadId !== threadId && answered.startedThreadId !== threadId) return;
      if (!answerMayAct(answered.message)) return;
      setFinished({ answered, act: { messageId: answered.message.id, used: false, made: answered.opensFree } });
    });
  }, [kind, onAnswered, visible, threadId]);
  useEffect(() => {
    if (finished === null) return;
    if (!visible || kind !== "guide" || (threadId !== finished.answered.threadId && threadId !== finished.answered.startedThreadId)) {
      finished.act.used = true;
    }
  }, [finished, visible, kind, threadId]);
  return visible && kind === "guide" && finished?.answered.threadId === threadId ? finished.act : null;
}

/**
 * **May this finished answer act at all?** Not one the reader stopped, and not
 * one the server cut short: its last line may be a token the model never meant
 * to be the end.
 */
export function answerMayAct(message: ChatMessage): boolean {
  return message.role === "assistant" && message.status === "done" && message.stopped !== true && message.truncated !== true;
}

/** Every key `OPENS_FREE_ONCE_MADE` names: `made` can widen the act to these and no others. */
const MAY_BE_MADE: ReadonlySet<string> = new Set(Object.values(OPENS_FREE_ONCE_MADE).flat());

const NOTHING_MADE: ReadonlySet<string> = new Set();

/**
 * **Would acting on this chip unarmed only move the reader?** A jump to the first place
 * the article has some words, a mode `modeActsAlone` allows, or one of the
 * generating modes src/acts-alone.ts § `OPENS_FREE_ONCE_MADE` names whose key
 * is in `made`. Everything else — including a glossary look-up that happens to
 * resolve to an entry, so that what the model told the reader (*"the button
 * will look it up"*) stays true — is a press.
 */
export function actsAlone(chip: ChatChip, made: ReadonlySet<string> = NOTHING_MADE): boolean {
  switch (chip.proposal.id) {
    case "jump-first":
      return true;
    case "mode": {
      const target = chip.target;
      if (target === undefined) return false;
      return modeActsAlone(target.key, target.generates) || (MAY_BE_MADE.has(target.key) && made.has(target.key));
    }
    case "find":
    case "glossary-open":
    case "glossary-ask":
    case "quick-search":
    case "tag-add":
    case "tag-remove":
    case "bookmark":
      return false;
    default: {
      const never: never = chip.proposal;
      return never;
    }
  }
}

/**
 * **Is this element on screen in the sense that matters** — rendered, not
 * inside something with `display: none` (a band stepped aside, a collapsed
 * dialog). `checkVisibility` where the browser has it; otherwise the ancestors'
 * computed `display`, which is all a test DOM can answer.
 */
export function isShown(element: Element): boolean {
  if (typeof element.checkVisibility === "function") return element.checkVisibility();
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return false;
  }
  return element.isConnected;
}
