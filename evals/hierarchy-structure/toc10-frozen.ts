/** The exact toc/10 request retained as the pre-registered quality baseline. */
import { estimateHierarchyTokens, STRUCTURE_HEADROOM, TOC10_SYSTEM } from "../../src/hierarchy.js";
import { renderBlocks } from "../../src/hierarchy-prompt.js";
import type { MessagesBody } from "../../src/messages-stream.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import { budgetFor } from "../../src/token-budget.js";
import type { Block } from "../../src/types.js";
import type { ModelNode } from "../../src/hierarchy.js";

/** The ranged parse path toc/10 used, kept only for its frozen eval arm and replay. */
export function parseToc10StructureAnswer(raw: string): { root: ModelNode } {
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
    estimateHierarchyTokens(body),
    STRUCTURE_HEADROOM,
  );
  return {
    system: TOC10_SYSTEM,
    user,
    maxTokens,
    params: {
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: TOC10_SYSTEM,
      messages: [{ role: "user", content: user }],
    },
  };
}
