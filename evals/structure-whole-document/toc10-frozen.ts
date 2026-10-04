/**
 * The toc/10 arm, retained as the pre-registered quality baseline. Only its system
 * prompt is frozen (toc10-system.ts). The block rendering, the token estimate and
 * the budget are today's, from `src/`, and move with production.
 */
import { estimateStructureTokens, STRUCTURE_HEADROOM } from "../../src/structure.js";
import { renderBlocks } from "../../src/structure-prompt.js";
import type { MessagesBody } from "../../src/messages-stream.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import { budgetFor } from "../../src/token-budget.js";
import type { Block } from "../../src/types.js";
import type { ModelNode } from "../../src/structure.js";
import { TOC10_FROZEN_SYSTEM } from "./toc10-system.js";

/** The ranged parse path toc/10 used, kept only for its frozen eval arm and replay. */
export function parseToc10WholeDocumentAnswer(raw: string): { root: ModelNode } {
  return parseJsonAnswer(raw, "the table-of-contents response");
}

export function toc10FrozenRequest(body: Block[]): {
  system: string;
  user: string;
  maxTokens: number;
  params: MessagesBody;
} {
  const user = renderBlocks(body);
  const maxTokens = budgetFor(
    "table of contents",
    estimateStructureTokens(body),
    STRUCTURE_HEADROOM,
  );
  return {
    system: TOC10_FROZEN_SYSTEM,
    user,
    maxTokens,
    params: {
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: TOC10_FROZEN_SYSTEM,
      messages: [{ role: "user", content: user }],
    },
  };
}
