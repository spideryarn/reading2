/**
 * **A source fingerprint**: the sha256 of each prompt source file a harness names,
 * and of the registered shared prompt modules those files import.
 *
 * It says which bytes of `src/` an arm was run on, and that is all it says. It is
 * not a hash of the request that was sent: the harnesses call production's
 * generators, which keep their rendered system prompts to themselves, so there is
 * nothing here to hash but files. Take it before the generators are imported and
 * called, so it names the source the loaded modules came from.
 *
 * The shared modules are found from static imports and re-exports, one hop deep,
 * against SHARED_PROMPT_SOURCES below. That registry is still maintained by hand:
 * register a new shared prompt module there, and name deeper dependencies in a
 * harness's entries. This does not discover the entire prompt dependency graph.
 * Until 2026-10-04 each harness
 * kept the whole list by hand, and wording that arrived through an import
 * (`plainWords()`, `paperwork()`) moved the prompt and left the hash where it was.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

const SRC = path.join(import.meta.dirname, "..", "..", "src");

/** Modules under `src/` whose text ends up in more than one generator's prompt. */
const SHARED_PROMPT_SOURCES: ReadonlySet<string> = new Set([
  "plain-words.ts",
  "paperwork.ts",
  "article-prompt.ts",
  "profile.ts",
  "structure-prompt.ts",
  "referee-candidates-prompt.ts",
]);

export function sourceFingerprint(entries: readonly string[], src: string = SRC): Record<string, string> {
  const files = new Set(entries);
  for (const entry of entries) {
    const text = fs.readFileSync(path.join(src, entry), "utf8");
    const ast = parse(text, { sourceType: "module", sourceFilename: entry, plugins: ["typescript", "jsx"] });
    for (const statement of ast.program.body) {
      if (
        statement.type !== "ImportDeclaration" &&
        statement.type !== "ExportNamedDeclaration" &&
        statement.type !== "ExportAllDeclaration"
      ) continue;
      const fileName = statement.source?.value;
      if (!fileName) continue;
      if (!fileName.startsWith("./") || !fileName.endsWith(".js")) continue;
      const name = `${fileName.slice(2, -3)}.ts`;
      if (SHARED_PROMPT_SOURCES.has(name)) files.add(name);
    }
  }
  return Object.fromEntries(
    [...files].map((f) => [f, createHash("sha256").update(fs.readFileSync(path.join(src, f))).digest("hex")]),
  );
}
