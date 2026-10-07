/**
 * **The tool list, served as MCP** — plan 261007j § Stages, stage 1.
 *
 * Builds an `McpServer` from `TOOLS`. Every result is JSON as text; every
 * failure is an `isError` result with a readable sentence, so the model can
 * tell the person what Spideryarn said rather than seeing a protocol error.
 *
 * **The asking tools run only after the person approves** the exact operation
 * through the injected `Approver` (approve.ts). Approval happens before any
 * call that changes anything; a no, a timeout or a dialog that could not be
 * shown means the handler never runs, and the answer says nothing was sent —
 * as an ordinary result when the person said no, since choosing no is not a
 * failure, and as an error when nobody could be asked.
 */

import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";

import type { Api } from "./api.js";
import type { Approver } from "./approve.js";
import { describeFailure, TOOLS, type Tool, type ToolContext } from "./tools.js";

export interface ServerOptions {
  readonly api: Api;
  readonly ctx: ToolContext;
  readonly approver: Approver;
  readonly tools?: readonly Tool[];
  readonly version?: string;
}

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function failure(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function buildServer(options: ServerOptions): McpServer {
  const server = new McpServer(
    { name: "spideryarn", version: options.version ?? "0.1.0" },
    { capabilities: { tools: {} } },
  );
  const { api, ctx, approver } = options;

  for (const t of options.tools ?? TOOLS) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.input, annotations: t.annotations },
      async (args: Record<string, unknown>) => {
        try {
          /* Bind before any out-of-band question. In particular, a server that
             started while signed out must not show a dialog and only decide
             which reader it is after the person has approved the operation. */
          if (t.ask) await ctx.identity();
          const approval = t.ask ? await t.ask(api, args, ctx) : null;
          if (approval !== null && !(await approver.approve(approval.operation))) {
            return text(`Not approved, so nothing was sent or published: ${t.name} did not run.`);
          }
          return text(await (approval?.run ? approval.run() : t.handler(api, args, ctx)));
        } catch (err) {
          return failure(describeFailure(t.name, err));
        }
      },
    );
  }
  return server;
}
