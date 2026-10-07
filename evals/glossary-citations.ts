/**
 * **Does the glossary list the works a piece cites?** It should not: Citations
 * lists those (Greg, 2026-10-03, spya-zn97q5;
 * docs/plans/261003o-glossary-keeps-cited-works-out-citations-are-not-terms.md).
 *
 * ```
 * npx tsx evals/glossary-citations.ts generate --arm before   <slug>...   # paid, on the commit before the change
 * npx tsx evals/glossary-citations.ts generate --arm before-2 <slug>...   # the same prompt again: the wobble
 * npx tsx evals/glossary-citations.ts generate --arm after    <slug>...   # paid, on the commit with the change
 * npx tsx evals/glossary-citations.ts report                              # free: the screens, per arm
 * ```
 *
 * **The arms are separated in time, not in code**, as in
 * evals/plain-words/run.ts: `generate` calls production's `generateGlossary`
 * (no profile, a first pass) and records a hash of the prompt's source files
 * beside the answer. There is no copy of the prompt in here to drift.
 *
 * Reads the local database, writes nothing there beyond the `ai_calls` row each
 * call records (`generate` runs inside `withLedger`). Output under
 * `evals/results/glossary-citations/<arm>/`.
 *
 * **What the screen cannot say.** `looksCited` is a regex over names and
 * aliases: it flags "Blade Runner (1982)" and "Tokyo 2020" as readily as
 * "Stenhoff (1999)". Every hit is printed so it can be read, and so is every
 * person and work entry, because the regression to watch is the other way
 * round: people and works the piece talks about, dropped
 * (docs/project/prompting-guide.md § Measuring a prompt change, step 8).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";

const REPO = path.join(import.meta.dirname, "..");
const OUT = path.join(REPO, "evals", "results", "glossary-citations");
const SOURCES = ["glossary.ts", "paperwork.ts", "plain-words.ts"];

/** "et al", or a year: the two marks of an author-and-year citation. A screen, not a verdict. */
export function looksCited(text: string): boolean {
  return /\bet\.?\s+al\b/i.test(text) || /\b(1[5-9]|20)\d\d[a-z]?\b/.test(text);
}

interface Entry {
  name: string;
  kind: string;
  aliases: string[];
  senseHere?: string;
  background?: string;
}

interface ArmFile {
  slug: string;
  arm: string;
  promptVersion: string;
  sourceSha256: Record<string, string>;
  entries: Entry[];
}

async function generate(arm: string, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const { loadArticle } = await import("../src/store/index.js");
  const { generateGlossary, PROMPT_VERSION } = await import("../src/glossary.js");
  const sourceSha256 = Object.fromEntries(
    SOURCES.map((f) => [f, createHash("sha256").update(fs.readFileSync(path.join(REPO, "src", f))).digest("hex")]),
  );
  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  await runAsOwner(environmentOwnerId(), async () => {
    await Promise.all(
      slugs.map(async (slug) => {
        const out = path.join(OUT, arm, `${slug}.json`);
        /* Never overwrite an arm: a second run under the same name would replace
           the evidence the first one was. */
        if (fs.existsSync(out)) throw new Error(`${out} exists; pick another arm name`);
        const article = { ...(await loadArticle(slug)), slug };
        const run = await generateGlossary({ power: "standard", article, previous: null, profile: null });
        const entries: Entry[] = run.glossary.entries.map((e) => ({
          name: e.name,
          kind: e.kind,
          aliases: e.aliases,
          ...(e.senseHere ? { senseHere: e.senseHere } : {}),
          ...(e.background ? { background: e.background } : {}),
        }));
        const file: ArmFile = { slug, arm, promptVersion: PROMPT_VERSION, sourceSha256, entries };
        fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
        console.log(`${arm} ${slug}: ${entries.length} entries written`);
      }),
    );
  });
}

function report(): void {
  const arms = fs.existsSync(OUT)
    ? fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort()
    : [];
  const rows = ["arm\tslug\tprompt\tentries\tpeople\tworks\tcited-names\tcited-aliases"];
  const hits: string[] = [];
  const named: string[] = [];
  for (const arm of arms) {
    for (const f of fs.readdirSync(path.join(OUT, arm)).filter((x) => x.endsWith(".json")).sort()) {
      const file = JSON.parse(fs.readFileSync(path.join(OUT, arm, f), "utf8")) as ArmFile;
      const people = file.entries.filter((e) => e.kind === "person");
      const works = file.entries.filter((e) => e.kind === "work");
      const citedNames = file.entries.filter((e) => looksCited(e.name));
      const citedAliases = file.entries.flatMap((e) =>
        e.aliases.filter(looksCited).map((alias) => `${alias}  (alias of [${e.kind}] ${e.name})`),
      );
      rows.push(
        [arm, file.slug, file.promptVersion, file.entries.length, people.length, works.length, citedNames.length, citedAliases.length].join("\t"),
      );
      for (const e of citedNames) hits.push(`[name]  ${arm} ${file.slug}: [${e.kind}] ${e.name}`);
      for (const a of citedAliases) hits.push(`[alias] ${arm} ${file.slug}: ${a}`);
      named.push(
        `${arm} ${file.slug}\n  people: ${people.map((e) => e.name).join(" | ") || "(none)"}\n  works:  ${works.map((e) => e.name).join(" | ") || "(none)"}`,
      );
    }
  }
  console.log(rows.join("\n"));
  console.log(`\n=== every name or alias the screen flagged (read them: a year is not always a citation) ===\n${hits.join("\n") || "(none)"}`);
  console.log(`\n=== every person and work entry (read them: these are what must not be lost) ===\n${named.join("\n")}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "report") return report();
  if (command === "generate" && rest[0] === "--arm" && rest[1] && rest.length > 2) {
    const [arm, slugs] = [rest[1], rest.slice(2)];
    loadEnvLocal();
    const { withLedger } = await import("../src/cli-ledger.js");
    /* The ledger is open around the paid command only: an eval's spend is refused without one (src/ai-spend.ts § UnrecordedSpendRefused). */
    return withLedger("eval", () => generate(arm, slugs));
  }
  throw new Error("usage: glossary-citations.ts generate --arm <name> <slug>... | report");
}

if (isMain(import.meta.url)) await main();
