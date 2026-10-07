/**
 * **The guide acts without a press** — plan
 * docs/plans/261007o-the-guide-acts-without-a-press-and-opens-every-new-article.md
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
 * - **it only moves the reader** (`actsAlone`): a jump, or a mode that makes
 *   nothing and writes nothing (src/acts-alone.ts). A quick search, a look-up,
 *   a find, a tag, a bookmark, and every mode that generates stay presses, so a
 *   planted instruction in the article can at worst move the reader, which
 *   Back undoes;
 * - **it is the first such chip in the answer.** Two moves would undo each
 *   other, and the reader could not follow what happened.
 *
 * The act *is* the chip's own press (CommandChip.tsx § `press`), so it is
 * checked by `chipFor` again at that moment, exactly as a press is.
 *
 * `GuideAct` is one object per finished answer, made by the conversation that
 * heard it and handed to that answer's chips through `GuideActContext`. The
 * first eligible chip's effect sets `used`; the conversation's own effect,
 * which React runs after its children's in the same commit, sets it too, so a
 * chip that mounts later — a re-render that redraws the answer — finds it spent
 * rather than acting late. StrictMode's second effect run finds it spent.
 */
import { createContext } from "react";
import { modeActsAlone } from "../acts-alone.js";
import type { ChatMessage } from "../types.js";
import type { ChatChip } from "./chat-commands.js";

/** One finished answer's single act, and whether it has been spent. */
export interface GuideAct {
  readonly messageId: string;
  used: boolean;
}

/** The act for the answer a chip is drawn in, or `null`: every chip outside a guide's just-finished answer. */
export const GuideActContext = createContext<GuideAct | null>(null);

/**
 * **May this finished answer act at all?** Not one the reader stopped, and not
 * one the server cut short: its last line may be a token the model never meant
 * to be the end.
 */
export function answerMayAct(message: ChatMessage): boolean {
  return message.role === "assistant" && message.status === "done" && message.stopped !== true && message.truncated !== true;
}

/**
 * **Would pressing this chip only move the reader?** A jump to the first place
 * the article has some words, or a mode `modeActsAlone` allows. Everything
 * else — including a glossary look-up that happens to resolve to an entry, so
 * that what the model told the reader (*"the button will look it up"*) stays
 * true — is a press.
 */
export function actsAlone(chip: ChatChip): boolean {
  switch (chip.proposal.id) {
    case "jump-first":
      return true;
    case "mode":
      return chip.target !== undefined && modeActsAlone(chip.target.key, chip.target.generates);
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
