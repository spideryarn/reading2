/**
 * **The hashes of Summary's system prompts as the source now has them** — free.
 *
 *   npx tsx evals/simple/prompt-hashes.ts
 *
 * `standard pair` is what `evals/simple/probe.ts` records as `systemsSha256`
 * for a piece in the standard length band, so a prompt in the source can be
 * matched to the arm of an eval that measured those exact bytes. `brief` and
 * `fuller` are the two values tests/simple-two-levels.test.ts pins.
 */
import { createHash } from "node:crypto";
import { SIMPLE_PROMPT_VERSION, SIMPLE_SYSTEMS, SIMPLE_SYSTEMS_BY_BAND } from "../../src/simple-summary.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
console.log(`version        ${SIMPLE_PROMPT_VERSION}`);
console.log(`brief          ${sha(SIMPLE_SYSTEMS.brief)}`);
console.log(`fuller         ${sha(SIMPLE_SYSTEMS.fuller)}`);
console.log(`standard pair  ${sha(JSON.stringify(SIMPLE_SYSTEMS_BY_BAND.standard))}`);
