/**
 * **The guide's next steps: what one may be, checked the same way on both
 * sides** — plan
 * docs/plans/261009u-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md.
 *
 * > We obviously don't want to present too many buttons to the user. Maybe
 * > three or four is the maximum, plus the free text input box, of course. So
 * > maybe three would be about right.
 * >
 * > — Greg, 2026-10-09, `spya-pqaftb`
 *
 * The guide's `offer_next_steps` tool (src/chat-tools.ts) runs nothing: it
 * checks what the model asked for with `checkNextSteps` and puts the result on
 * the turn's run (`ToolRun.steps`). The page reads the stored run back through
 * the same function (src/web/GuideNextSteps.tsx), because a stored run is JSON
 * and is checked again rather than trusted. Node-free, so both can import it.
 *
 * Six kinds and no others. Each is a press by the reader; none of them writes,
 * shares or spends on its own:
 *
 * - `ask`: words the reader can send to the guide as their own message;
 * - `chat`: a question about what the piece says, sent as the first question of
 *   a fresh Chat (plan
 *   docs/plans/261012f-guide-hands-content-questions-to-a-new-chat.md). At most
 *   one per answer: it is the one orange button in the row;
 * - `mode`: a mode to open, drawn as the chip `[cmd:mode:<key>]` would be, so
 *   `chipFor` decides at the draw and at the press whether it is offered here;
 * - `search`: words for a quick search, in a box the reader can change first;
 * - `share`: to Metadata's *Access & sharing* card, the one place a private
 *   link or the public switch is pressed;
 * - `archive`: to Metadata, whose own *Archive* or *Put back* button does it.
 */
import type { NextStep } from "./types.js";

/** At most this many buttons under one answer: Greg's "three would be about right". */
export const MAX_NEXT_STEPS = 3;
/** An `ask` step is drawn in full on its button, so it is one short line. */
export const MAX_ASK_CHARS = 80;
/**
 * A `chat` step is a whole question, standing on its own in a conversation
 * that has not seen the guide's, and it too is drawn in full.
 */
export const MAX_CHAT_CHARS = 160;
/** A quick search is a few words. */
export const MAX_SEARCH_CHARS = 60;

/** A catalogue key a `mode` step may name: `mode:<name>` or `submode:<name>:<sub>`. */
const MODE_KEY = /^(mode:[a-z-]+|submode:[a-z-]+:[a-z-]+)$/;

/** One line, whitespace collapsed — or `null` for nothing left. */
function oneLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

/**
 * **One step, or why not.** `modeKeys`, when given, is the set of keys a
 * `mode` step may name (the server passes the catalogue's); the page passes
 * none and leaves that to `chipFor`, which knows what this reader can open now.
 */
export function checkNextStep(raw: unknown, modeKeys?: ReadonlySet<string>): NextStep | string {
  if (typeof raw !== "object" || raw === null) return "a step must be an object";
  const step = raw as Record<string, unknown>;
  switch (step.kind) {
    case "ask": {
      const words = oneLine(step.words);
      if (words === null) return "an ask step needs words";
      if (words.length > MAX_ASK_CHARS) return `an ask step's words were ${words.length} characters, and the most is ${MAX_ASK_CHARS}`;
      return { kind: "ask", words };
    }
    case "chat": {
      const words = oneLine(step.words);
      if (words === null) return "a chat step needs words";
      if (words.length > MAX_CHAT_CHARS) return `a chat step's words were ${words.length} characters, and the most is ${MAX_CHAT_CHARS}`;
      return { kind: "chat", words };
    }
    case "search": {
      const words = oneLine(step.words);
      if (words === null) return "a search step needs words";
      if (words.length > MAX_SEARCH_CHARS) return `a search step's words were ${words.length} characters, and the most is ${MAX_SEARCH_CHARS}`;
      return { kind: "search", words };
    }
    case "mode": {
      const mode = typeof step.mode === "string" ? step.mode.trim() : "";
      if (!MODE_KEY.test(mode) || (modeKeys !== undefined && !modeKeys.has(mode))) {
        return `"${mode.slice(0, 60)}" is not one of the modes listed under WHAT SPIDERYARN CAN SHOW THEM`;
      }
      return { kind: "mode", mode };
    }
    case "share":
      return { kind: "share" };
    case "archive":
      return { kind: "archive" };
    default:
      return `a step's kind must be ask, chat, mode, search, share or archive`;
  }
}

/**
 * **The steps an offer may carry**: each checked, duplicates dropped, at most
 * `MAX_NEXT_STEPS`. `problems` says what was dropped and why, for the model.
 */
export function checkNextSteps(
  raw: unknown,
  modeKeys?: ReadonlySet<string>,
): { steps: NextStep[]; problems: string[] } {
  const steps: NextStep[] = [];
  const problems: string[] = [];
  if (!Array.isArray(raw)) return { steps, problems: ["steps must be a list"] };
  const seen = new Set<string>();
  for (const item of raw) {
    const checked = checkNextStep(item, modeKeys);
    if (typeof checked === "string") {
      problems.push(checked);
      continue;
    }
    /* One orange button, not three (GPT Sol's F1 on plan 261012f). */
    if (checked.kind === "chat" && steps.some((s) => s.kind === "chat")) {
      problems.push("only one chat step is shown");
      continue;
    }
    const key = JSON.stringify(checked);
    if (seen.has(key)) continue;
    if (steps.length === MAX_NEXT_STEPS) {
      problems.push(`only the first ${MAX_NEXT_STEPS} steps are shown`);
      break;
    }
    seen.add(key);
    steps.push(checked);
  }
  return { steps, problems };
}
