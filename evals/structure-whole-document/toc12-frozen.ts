/**
 * The toc/12 arm, the quality baseline for toc/13 (plan 261020aa): each child's
 * `start` is the block's id as a free string, where toc/13 asks for the block's
 * bracketed number as an integer. Built from today's request so that nothing but
 * those two passages and the `start` schema differs — `toc12System` throws if the
 * swap no longer round-trips to production's prompt. The answer is read by
 * production's `parseWholeDocumentAnswer`, which takes string and integer starts.
 */
import { wholeDocumentRequest } from "../../src/structure.js";
import type { MessagesBody } from "../../src/messages-stream.js";
import type { Block } from "../../src/types.js";
import { toc12System, withArm } from "../structure-id-pattern/run.js";

export function toc12FrozenRequest(body: Block[]): {
  system: string;
  user: string;
  maxTokens: number;
  params: MessagesBody;
} {
  const base = wholeDocumentRequest(body);
  const system = toc12System(base.system);
  const format = base.params.output_config?.format as { type: string; schema: unknown } | undefined;
  if (!format) throw new Error("production's Structure request no longer carries a schema");
  return {
    system,
    user: base.user,
    maxTokens: base.maxTokens,
    params: {
      ...base.params,
      system,
      output_config: {
        ...base.params.output_config,
        format: { ...format, schema: withArm(format.schema, "incumbent") },
      } as NonNullable<MessagesBody["output_config"]>,
    },
  };
}
