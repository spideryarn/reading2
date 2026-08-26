/**
 * **Nothing under `src/web/` may reach a server module.**
 *
 * Not a style rule. Vite bundles whatever the client imports, transitively, so
 * a single `import { helper } from "../converse.js"` pulls that file's whole
 * module graph into the browser — pino, `node:fs`, the system prompts, the
 * request shapes. It compiles, it passes the type-check, and the app keeps
 * working; the only symptom is a bigger bundle containing things nobody meant
 * to ship.
 *
 * That is not hypothetical. On 2026-08-26 `ChatPanel.tsx` imported one
 * four-line URL check from `src/converse.ts`, and the client bundle grew 24KB
 * and gained the string `OPENROUTER_API_KEY`. The key's *value* was never in it
 * — it is read from `process.env`, which does not exist in a browser — but the
 * prompt and the OpenRouter request shape were, and the next edit in that
 * direction is a real leak rather than an embarrassing one.
 *
 * AGENTS.md already names the hazard: *"One `import type` away from a node
 * module is one careless edit away from a broken browser bundle."* This is that
 * sentence, enforced.
 *
 * The fix when this fails is never to add the file to the allowlist. It is to
 * move the shared thing into a module that imports nothing — src/types.ts,
 * src/ids.ts, src/urls.ts are the existing examples.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "src", "web");

/**
 * Modules at `src/` that the client is allowed to import.
 *
 * Every one of these is pure: no `node:` imports, no side effects, no
 * dependencies of its own beyond the others in this list. That is the whole
 * qualification, and it is checked below rather than trusted.
 */
const SHARED = new Set([
  "types.js", // the shapes both sides speak in
  "ids.js", // minting and validating block ids
  "urls.js", // the http(s) allowlist, used by the server and the panel
  "reading-time.js",
  "ingest.js", // slug derivation, so the client can show the same one the server will mint
  "term-match.js", // where a glossary term appears in a block
  "quote-match.js",
  "sanitize-policy.js", // the DOMPurify config, shared so both passes agree
  // Every sentence a reader is shown when a model call fails. On the list
  // because it qualifies rather than because it was convenient: it imports
  // nothing at all. The client needs it so /design can render the real
  // failure copy at the width it will actually wrap at — placeholder text is
  // exactly what stops anyone noticing a message reads badly.
  // See docs/project/copy.md.
  "messages.js",
  // Whether a failed ingest job is worth offering a Retry for. It imports
  // messages.js and nothing else, and the card is the only thing that asks —
  // so the rule lives in one place rather than being spelled out at the
  // button. See docs/postmortems/toc-max-tokens.md.
  "job-failure.js",
]);

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The specifiers one file imports — `import` and `export … from` alike. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^;'"]*from\s*["']([^"']+)["']/g)) {
    if (m[1]) found.push(m[1]);
  }
  // `import "./side-effect.css"` and dynamic `import("…")` too.
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    if (m[1]) found.push(m[1]);
  }
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    if (m[1]) found.push(m[1]);
  }
  return found;
}

describe("the client's imports", () => {
  it("never reaches out of src/web except to a shared pure module", () => {
    const offenders: string[] = [];
    for (const file of sourcesUnder(WEB)) {
      for (const spec of importsOf(file)) {
        // Only relative imports can escape; a bare specifier is a package.
        if (!spec.startsWith("../")) continue;
        // `../../src/x` cannot occur from src/web, so one `../` means src/.
        const target = spec.slice(3);
        if (target.includes("/")) {
          offenders.push(`${path.relative(ROOT, file)} → ${spec} (outside src/)`);
          continue;
        }
        if (!SHARED.has(target)) {
          offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * And the allowlist has to keep earning its place.
   *
   * A module on it that grows a `node:` import takes the whole client with it,
   * and the test above would not notice: the import in `src/web` still points
   * at an allowed name. So the allowlist is checked too, and it is checked for
   * the thing that actually breaks a browser bundle — `node:` built-ins.
   *
   * Deliberately NOT a ban on package imports. `sanitize-policy.ts` takes a
   * `import type` from dompurify, which erases at compile time and is a package
   * the client bundles anyway. Flagging that would push somebody to duplicate a
   * type rather than share it, which is worse than the thing being prevented.
   */
  it("keeps the shared modules free of node built-ins", () => {
    const impure: string[] = [];
    for (const name of SHARED) {
      const file = path.join(ROOT, "src", name.replace(/\.js$/, ".ts"));
      for (const spec of importsOf(file)) {
        if (spec.startsWith("node:")) impure.push(`src/${name} → ${spec}`);
        // A shared module reaching further into src/ can drag anything with it.
        if (spec.startsWith("./") && !SHARED.has(spec.slice(2))) {
          impure.push(`src/${name} → ${spec}`);
        }
      }
    }
    expect(impure).toEqual([]);
  });
});
