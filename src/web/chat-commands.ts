/**
 * **Which of a model's tokens chat draws as a button, and what the button
 * would run** — the pure half of chat's command chips (plan 261003f, Stage 2).
 * The drawn half is CommandChip.tsx; the shape of a token is
 * src/command-token.ts; what one means is command-proposal.ts.
 *
 * The line is the one Greg accepted on 2026-10-02
 * (docs/project/chat-llm-help-commands-vision.md § Decided, § The aspiration):
 * chat's context holds the article and fetched pages, which are untrusted, so
 * chat only ever **proposes** — a button the reader presses — and what it wrote
 * is parsed, never trusted. Everything here is that parse.
 */
import type { Known } from "./citations.js";
import {
  canRun,
  type CommandExecutor,
  type CommandProposal,
  type ModeTarget,
  type ProposalId,
  parseProposalToken,
  resolveArgument,
} from "./command-proposal.js";

/**
 * **The ids a chat answer may propose.** Eight of the nine — and the guide's
 * the same eight (plan 261007j: one allowlist, the same token, the same press).
 *
 * `glossary-open` is left out because its argument is a glossary entry's id,
 * and nothing chat is shown carries one: a model writing it would be inventing
 * an id. It asks with the term instead (`glossary-ask`), and `chipFor` turns
 * that into *open the entry* when the visible glossary has the term — the same
 * match the bar makes for *look up X* (command-proposal.ts § `resolveArgument`).
 */
export const CHAT_PROPOSABLE: readonly ProposalId[] = [
  "jump-first",
  "find",
  "glossary-ask",
  "tag-add",
  "tag-remove",
  "bookmark",
  /* Since 2026-10-07: open a mode the reader can open here, and the bar's own
     quick search. Resolved against what is here at the draw and at the press
     (`chipFor`). */
  "mode",
  "quick-search",
];

/**
 * **One chip**: the proposal a press would run, a display name where the
 * proposal's argument is an id, and whether this page has a runner for it now.
 */
export interface ChatChip {
  readonly proposal: CommandProposal;
  readonly shown?: string;
  /** What a `mode` proposal opens here, with its name and its own `generates`. */
  readonly target?: ModeTarget;
  readonly enabled: boolean;
}

/**
 * **A token as a chip — or `null`, and then it is drawn as the characters the
 * model wrote**, exactly as a block id the article lacks is.
 *
 * `null` for a token that does not parse or whose argument its command refuses
 * (`parseProposalToken`), an id outside `CHAT_PROPOSABLE`, a bookmark on a
 * block this article does not have — the case a hostile page would write — and
 * a mode the reader cannot open here: hidden behind the experimental switch,
 * unknown, or anything else the Dock does not offer now (GPT Sol's F3 on plan
 * 261007j). A mode's key is resolved against `commands.sources.modes`, the
 * live set, never against the whole catalogue.
 *
 * A chip with no runner here is still a chip, **not enabled**: the bookmark
 * before the comments read has landed, the look-up before the glossary read
 * has. Hiding it would flash raw syntax for a second on every reload.
 *
 * Called when the answer is drawn and **again at the press** (CommandChip.tsx),
 * so availability is never a fact remembered from the render.
 */
export function chipFor(raw: string, commands: CommandExecutor, blocks: Known): ChatChip | null {
  const parsed = parseProposalToken(raw);
  if (parsed === null || !CHAT_PROPOSABLE.includes(parsed.id)) return null;
  if (parsed.id === "bookmark" && !blocks.has(parsed.blockId)) return null;
  if (parsed.id === "mode") {
    const target = commands.sources.modes?.get(parsed.key);
    if (target === undefined) return null;
    return { proposal: parsed, target, enabled: canRun(commands.runners, "mode") };
  }
  if (parsed.id !== "glossary-ask") {
    return { proposal: parsed, enabled: canRun(commands.runners, parsed.id) };
  }
  /* The bar's own match, first hit: an entry by name, then by alias. No match
     — or no settled glossary to match in — leaves the ask itself, enabled only
     where the page offers it, which is once the read is ready (F1). */
  const row = resolveArgument({ kind: "glossary", words: parsed.term }, commands.sources)[0];
  if (row?.kind === "ready") {
    return {
      proposal: row.proposal,
      ...(row.shown === undefined ? {} : { shown: row.shown }),
      enabled: canRun(commands.runners, row.proposal.id),
    };
  }
  return { proposal: parsed, enabled: canRun(commands.runners, parsed.id) };
}

/**
 * **What the chip says after a press that worked.** A row in the bar shuts the
 * bar, which is its own answer; a chip stays where it is, so a write needs a
 * word. A press that moved the reader needs none — they have moved.
 */
export function doneWords(id: ProposalId): string | null {
  switch (id) {
    case "tag-add":
      return "Added.";
    case "tag-remove":
      return "Removed.";
    case "bookmark":
      return "Bookmarked.";
    /* A mode and a quick search move the reader into a band that shows what
       happened; there is nothing more for the chip to say. */
    case "jump-first":
    case "find":
    case "glossary-open":
    case "glossary-ask":
    case "mode":
    case "quick-search":
      return null;
    default: {
      const never: never = id;
      return never;
    }
  }
}
