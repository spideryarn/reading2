/**
 * **The critic reader's conversations, two at a time, with the sides
 * shuffled**: the blind read for plan 261005l's C1, C2, C3, C5 and C6.
 *
 *     npx tsx evals/remember-explore-critic-pairs.ts <stem> <pair>…
 *
 * A pair is `<run>:<run>`, each a `--out` name of `remember-explore.ts run`.
 * Both must be of the same article. Writes `<stem>-pairs.md`, which is all a
 * blind reader is given, and `<stem>-key.json`, which says which run was side
 * A. Spends nothing: it only reads result files.
 *
 * A pair of two runs of the SAME prompt is the control
 * (docs/project/prompting-guide.md § Measuring a prompt change, rule 2), and
 * the pairs file does not say which pairs those are.
 *
 * The coin is `blindCoin` (evals/plain-words/run.ts), the tested one. The key
 * prints how many times each arm landed on side A; check it before reading.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMain } from "../src/is-main.js";
import { blindCoin } from "./plain-words/run.js";

const RESULTS = path.resolve(import.meta.dirname, "results");

interface Turn {
  reader: string;
  turn: number;
  said: string;
  text: string;
  failed?: string;
}
interface RunFile {
  out: string;
  set: string;
  promptHash: string;
  turns: Turn[];
}

const load = async (out: string): Promise<RunFile> =>
  JSON.parse(await readFile(path.join(RESULTS, `remember-explore.${out}.json`), "utf8")) as RunFile;

const conversation = (run: RunFile): string =>
  run.turns
    .filter((t) => t.reader === "critic")
    .sort((a, b) => a.turn - b.turn)
    .map((t) => `**Reader, turn ${t.turn}:** ${t.said}\n\n**Reply ${t.turn}:**\n\n${t.failed ? `(failed: ${t.failed})` : t.text}`)
    .join("\n\n");

async function main(): Promise<void> {
  const [stem, ...pairs] = process.argv.slice(2);
  if (!stem || pairs.length === 0) throw new Error("usage: remember-explore-critic-pairs.ts <stem> <run>:<run>…");
  const coin = blindCoin();
  const out: string[] = [
    "# Two conversations at a time",
    "",
    "Each pair is one scripted reader asking the same five things of an AI reading companion, twice. The reader's messages are the same on both sides; the replies differ. `[spya-…]` is a link to a passage of the article.",
    "",
  ];
  const key: { pair: number; set: string; a: string; b: string; aHash: string; bHash: string }[] = [];
  for (const [i, spec] of pairs.entries()) {
    const [left, right] = spec.split(":");
    if (!left || !right) throw new Error(`not a pair: ${spec}`);
    const [one, two] = [await load(left), await load(right)];
    if (one.set !== two.set) throw new Error(`${spec}: two different articles`);
    const [a, b] = coin() ? [one, two] : [two, one];
    key.push({ pair: i + 1, set: one.set, a: a.out, b: b.out, aHash: a.promptHash, bHash: b.promptHash });
    out.push(`## Pair ${i + 1} (article: ${one.set})`, "", "### Side A", "", conversation(a), "", "### Side B", "", conversation(b), "");
  }
  const file = path.join(RESULTS, `remember-explore.${stem}`);
  await writeFile(`${file}-pairs.md`, out.join("\n"));
  await writeFile(`${file}-key.json`, `${JSON.stringify(key, null, 2)}\n`);
  const hashes = [...new Set(key.flatMap((k) => [k.aHash, k.bHash]))];
  for (const h of hashes)
    console.log(`prompt ${h}: side A in ${key.filter((k) => k.aHash === h).length} pairs, side B in ${key.filter((k) => k.bHash === h).length}`);
  console.log(`Written ${path.relative(process.cwd(), file)}-pairs.md and -key.json`);
}

if (isMain(import.meta.url)) await main();
