/**
 * **The reader's other conversations, as links an answer may draw** — plan
 * docs/plans/261024u-chat-links-the-earlier-conversation-it-mentions.md, from
 * Greg's report spya-t7cq2s: *"This chat references a previous conversation.
 * It would be great if that could include a hyperlink that would take me to
 * the previous chat conversation in context."*
 *
 * Chat's prompt is handed the reader's other conversations with their ids
 * (src/reader-notes.ts § `otherConversationsSection`) and asked to put one in
 * square brackets when it mentions that conversation. The renderer finds it by
 * shape, as it finds a block id (citations.ts § `splitCitations`), and draws a
 * chip only when the id is in the set built here.
 *
 * **That set is the security boundary**, and it is built from the threads the
 * server listed for the signed-in owner on this article — never from the
 * answer. The model's bracket selects among them; it cannot name anything else,
 * and the address is built from the row's id and kind. The rule that leaves out
 * Candidates and the conversation on screen is `eligible` in
 * src/reader-notes.ts, the same rows the model was shown.
 *
 * DOM-free and pure, so the per-kind addresses are tested without a browser.
 */
import { MODE_LABEL } from "../title-text.js";
import type { ChatThread } from "../types.js";
import { rowTitle } from "./chat-list-row.js";
import type { ThreadLink, ThreadTarget } from "./citations.js";
import { searchWithoutAny } from "./router.js";
import { LEARN_SUB_MODES } from "./sub-modes.js";
import { GUIDE_LABEL, LEARN_VIEW_OF } from "./thread-source.js";

/** Where each kind opens, and what the reader's list calls it. */
function linkOf(t: ChatThread): ThreadLink | null {
  switch (t.kind) {
    case "chat":
      return { id: t.id, title: rowTitle(t), target: { band: "here" } };
    case "guide":
      return { id: t.id, title: GUIDE_LABEL, target: { band: "chat" } };
    case "learn":
    case "explore": {
      const view = LEARN_VIEW_OF[t.kind];
      return {
        id: t.id,
        title: `${MODE_LABEL.learn} › ${LEARN_SUB_MODES[view].label}`,
        target: { band: "learn", view },
      };
    }
    /* Referee's machinery, not a conversation the reader had; the model's
       index never lists one either. */
    case "candidates":
      return null;
    default:
      return t.kind satisfies never;
  }
}

/**
 * Every conversation an answer in `currentId` may link to, by id. The one on
 * screen is left out: a link to where you already are is a link that does
 * nothing.
 */
export function threadLinks(
  threads: readonly ChatThread[],
  currentId: string | null | undefined,
): ReadonlyMap<string, ThreadLink> {
  const out = new Map<string, ThreadLink>();
  for (const t of threads) {
    if (t.id === currentId) continue;
    const link = linkOf(t);
    if (link) out.set(t.id, link);
  }
  return out;
}

/**
 * The parameters a target replaces. `chatfrom` narrows Chat's list and `guide`
 * asks Chat to open the guide; neither means anything once a conversation is
 * named. `mode` and `learn` go only when the target names its own band.
 */
function replaced(target: ThreadTarget): ReadonlySet<string> {
  switch (target.band) {
    case "here":
      return new Set(["thread", "chatfrom", "guide"]);
    case "chat":
      return new Set(["thread", "chatfrom", "guide", "mode"]);
    case "learn":
      return new Set(["thread", "chatfrom", "guide", "mode", "learn"]);
    default:
      return target satisfies never;
  }
}

/**
 * **The address that opens `link`'s conversation**, from the address the
 * reader is on (`useAddress`: pathname and search). Every other parameter —
 * the block they are at, the margin, the summary's view — is carried, so the
 * article stays where it was and only the conversation changes.
 *
 * A chat keeps the mode: in Chat's band it opens there, and over any other
 * mode the floating chat switches to it (url-state.md § One conversation id,
 * two ways of drawing it). The guide opens in Chat's band, which is the only
 * place it is drawn; a Recall or Explore conversation in its part of Learn,
 * the address a press on its row in Chat's list goes to.
 */
export function threadHref(address: string, link: ThreadLink): string {
  const q = address.indexOf("?");
  const path = q < 0 ? address : address.slice(0, q);
  const kept = searchWithoutAny(q < 0 ? "" : address.slice(q + 1), replaced(link.target));
  const set: string[] = [];
  if (link.target.band === "chat") set.push("mode=chat");
  if (link.target.band === "learn") set.push("mode=learn", `learn=${link.target.view}`);
  set.push(`thread=${encodeURIComponent(link.id)}`);
  return `${path}?${[kept, ...set].filter((s) => s !== "").join("&")}`;
}
