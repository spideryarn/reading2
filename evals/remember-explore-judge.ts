/**
 * **The one paid call evals/remember-explore.ts makes itself**: its blind
 * judge. The product turns go through `converse`; this goes through the
 * gateway's JSON seam under the `eval` scope, inside the `withLedger("eval", …)`
 * the entry module opens, so `npm run cost` sees it.
 *
 * A file of its own for the reason evals/dig-deeper/judge.ts is: a
 * package.json entry module that imports a provider seam has to be accounted
 * for by name (tests/paid-cli-ledger.test.ts), and the entry here is already
 * ledgered as an eval.
 */
import { openRouterJson } from "../src/ai-call.js";

export function askJudge(model: string, system: string, user: string) {
  return openRouterJson(
    "eval",
    {
      model,
      max_tokens: 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    { signal: AbortSignal.timeout(120_000) },
  );
}
