/**
 * **Can our OpenRouter key call Jev?** — the first spike of
 * docs/plans/260929c-shelf-topics-chosen-by-a-model.md.
 *
 *     npx tsx evals/shelf-topics/spike-jev.ts
 *
 * One tiny call per candidate id, through the gateway (`openRouterJson`, job
 * `eval`, inside `withLedger`), so the spend lands in `npm run cost`. Prints the
 * status, the model OpenRouter says answered, the tokens and the cost — never
 * the key.
 */
import { openRouterJson } from "../../src/ai-call.js";
import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();

const CANDIDATES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["typesafe/jev-router", "~typesafe/jev-latest", "typesafe/jev-latest"];

async function main(): Promise<void> {
  for (const model of CANDIDATES) {
    try {
      const call = await openRouterJson("eval", {
        model,
        max_tokens: 20,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
      });
      const body = call.json as {
        model?: string;
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      console.log(
        JSON.stringify({
          asked: model,
          answeredBy: body.model,
          text: body.choices?.[0]?.message?.content?.slice(0, 40),
          usage: body.usage,
        }),
      );
    } catch (e) {
      const err = e as { status?: number; message?: string };
      console.log(JSON.stringify({ asked: model, failed: err.status ?? "?", message: String(err.message).slice(0, 300) }));
    }
  }
}

await withLedger("eval", main);
