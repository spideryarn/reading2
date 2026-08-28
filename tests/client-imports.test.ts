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
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  // Whether a saved search still describes the article. The panel puts a
  // warning on a row and the server answers the same question at the read seam;
  // src/source-hash.ts computes the fingerprints and needs `node:crypto`, so
  // only the *comparison* is shared. Three lines and no imports but types.
  "search-stale.js",
  "sanitize-policy.js", // the DOMPurify config, shared so both passes agree
  // Every sentence a reader is shown when a model call fails. On the list
  // because it qualifies rather than because it was convenient: it imports
  // nothing at all. The client needs it so /design can render the real
  // failure copy at the width it will actually wrap at — placeholder text is
  // exactly what stops anyone noticing a message reads badly.
  // See docs/project/copy.md.
  "messages.js",
  /* How big a dictation may be, and what containers we can transcribe. On the
     list for the reason the header gives rather than for convenience: it
     imports nothing at all, and the alternative is two copies of one number.
     The recorder's cap, the request's cap and Vercel's 4.5 MB body limit are a
     single arithmetic problem with an end in the browser and an end on the
     server, and a client that records more than the server will take is a 413
     after somebody has talked for two minutes.
     See src/dictation-limits.ts. */
  "dictation-limits.js",
  /* What may be said about a failure when it leaves the machine. On the list
     for the same reason `messages.js` is: it imports nothing but that file and
     types, and both halves of monitoring have to agree on the rules exactly —
     a browser copy and a server copy would be two allowlists, and the looser
     one would be the one nobody read. See docs/plans/error-monitoring-sentry.md
     and src/monitoring-scrub.ts. */
  "monitoring-scrub.js",
  // Whether a failed ingest job is worth offering a Retry for. It imports
  // messages.js and nothing else, and the card is the only thing that asks —
  // so the rule lives in one place rather than being spelled out at the
  // button. See docs/postmortems/toc-max-tokens.md.
  "job-failure.js",
  // What counts as a PDF worth uploading, and how big is too big. The picker
  // asks (src/web/UploadPicker.tsx) and `POST /api/uploads` will ask when it
  // exists, which is the whole reason it is a module rather than a constant in
  // the component — the two disagreeing is invisible until a file is accepted
  // in one place and refused in the other. Imports nothing.
  // See docs/plans/pdf-upload-and-storage.md.
  "uploads.js",
  // Who the administrator is. On the list because it qualifies rather than
  // because it was convenient: one exported constant, one three-line function,
  // no imports at all. The client needs it so the shelf can decide whether to
  // draw an Admin link — a decision that is cosmetic, while the refusal that
  // matters is the server's on `/api/admin/`. Both sides asking one function is
  // the point: two spellings of "is this Greg" is one place for them to
  // disagree. See docs/project/admin.md.
  "admin.js",
  /* What a stranger is served — the wire shapes of `/api/public/…`. On the list
     for the reason the header of the file gives rather than for convenience: it
     imports `types.js` and nothing else, and it is a `.ts` of nothing but
     `interface` declarations, so it erases entirely at compile time.
     The client needs it because the public reader and the public metadata page
     are typed against exactly the shapes the server projects — the whole point
     of an allowlist projection is lost if the browser re-declares its own idea
     of what came back. See docs/plans/public-read-only-access.md § The payload. */
  "public-types.js",
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

/** One import, and whether it survives compilation. */
interface Imported {
  spec: string;
  /**
   * A **whole-statement** type import — `import type { X } from "…"`, or
   * `export type { X } from "…"`.
   *
   * The distinction is exact and it has to be: only this form erases. TypeScript
   * deletes the entire statement, so no edge reaches the bundler and nothing can
   * be dragged along. `import { type A, b } from "…"` is a *different thing*
   * wearing similar clothes — `b` is a value, the module is emitted, and it
   * drags whatever it drags. A scanner that waved that one through would be
   * worse than no scanner, because it would read as a check while permitting
   * the exact import it exists to stop.
   */
  typeOnly: boolean;
}

/** Every import one file makes — `import` and `export … from` alike. */
function scan(file: string): Imported[] {
  const text = readFileSync(file, "utf8");
  const found: Imported[] = [];
  /* The middle capture is everything between the keyword and `from`, which is
     what decides `typeOnly`: ` type { X } ` says yes, ` { type A, b } ` says
     no. `\s` after `type` and not `\b`, so a default import named `types`
     stays a value import. */
  for (const m of text.matchAll(
    /(?:^|\n)\s*(?:import|export)([^;'"]*)from\s*["']([^"']+)["']/g,
  )) {
    if (m[2]) found.push({ spec: m[2], typeOnly: /^\s*type\s/.test(m[1] ?? "") });
  }
  /* `import "./side-effect.css"` and dynamic `import("…")` too. Neither form has
     a type-only spelling: a side-effect import exists *for* the side effect,
     and a dynamic import is a runtime call. */
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    if (m[1]) found.push({ spec: m[1], typeOnly: false });
  }
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    if (m[1]) found.push({ spec: m[1], typeOnly: false });
  }
  return found;
}

/** Just the specifiers, for the rule that does not care how they were written. */
function importsOf(file: string): string[] {
  return scan(file).map((i) => i.spec);
}

describe("the client's imports", () => {
  it("never reaches out of src/web except to a shared pure module", () => {
    const offenders: string[] = [];
    for (const file of sourcesUnder(WEB)) {
      for (const spec of importsOf(file)) {
        // Only relative imports can escape; a bare specifier is a package.
        if (!spec.startsWith("../")) continue;

        /* **Resolved against the importing file, not counted as `../`s.** The
           check used to read one leading `../` as "this leaves src/web", which
           is only true for a file sitting directly in src/web. `src/web/lib/`
           is two deep, so its own `../offline.js` is a sibling of its parent —
           inside the client, and perfectly legal — and the old rule called it
           an escape. It never came up because everything under lib/ had until
           now imported only its own directory. 2026-08-27. */
        const resolved = path.resolve(path.dirname(file), spec);
        if (resolved === WEB || resolved.startsWith(`${WEB}${path.sep}`)) continue;

        const fromSrc = path.relative(path.join(ROOT, "src"), resolved);
        if (fromSrc.startsWith("..") || fromSrc.includes(path.sep)) {
          offenders.push(`${path.relative(ROOT, file)} → ${spec} (outside src/)`);
          continue;
        }
        if (!SHARED.has(fromSrc)) {
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
   *
   * ## And a type-only import of a local module is the same case
   *
   * That argument never depended on dompurify being a *package*. The rule
   * underneath is that **a shared module reaching further into `src/` can drag
   * anything with it** — and a whole-statement `import type` cannot drag
   * anything, because TypeScript deletes it before a bundler ever sees it.
   *
   * The case that forced this, 2026-08-28: `src/messages.ts` takes
   * `import type { EmbeddingReason } from "./embeddings.js"`, and the comment
   * at `PLACING` in that file explains that the type-only spelling is
   * *load-bearing* — `embeddings.ts` reaches back to `messages.ts` through
   * `ai-call.ts`, so a value import there would close a cycle. A guard that
   * flagged it would have been pushing somebody to duplicate a union rather
   * than share it: exactly the outcome the dompurify paragraph above rejects.
   *
   * **`node:` is deliberately still absolute**, type import or not. A `node:`
   * type in a module the browser loads erases just as cleanly, but it is a
   * sentence about the shape of this code that is worth somebody stopping over,
   * and the cost of being strict there is one conversation rather than a
   * duplicated type.
   *
   * The precision this rests on is in `Imported.typeOnly`, and it is the whole
   * of the risk: `import { type A, b }` still emits the module, and waving that
   * through would leave a check that reads as a check while permitting the one
   * import it exists to stop.
   */
  it("keeps the shared modules free of node built-ins", () => {
    const impure: string[] = [];
    for (const name of SHARED) {
      const file = path.join(ROOT, "src", name.replace(/\.js$/, ".ts"));
      for (const { spec, typeOnly } of scan(file)) {
        if (spec.startsWith("node:")) impure.push(`src/${name} → ${spec}`);
        // A shared module reaching further into src/ can drag anything with it
        // — unless the statement erases, in which case there is no edge at all.
        if (spec.startsWith("./") && !SHARED.has(spec.slice(2)) && !typeOnly) {
          impure.push(`src/${name} → ${spec}`);
        }
      }
    }
    expect(impure).toEqual([]);
  });

  /**
   * **The scanner can tell the two spellings apart**, which is the assumption
   * the rule above rests on and the one place it could go quietly wrong.
   *
   * Asserted against fixture text rather than against a real file, because the
   * property is about the parse and not about any module's current contents —
   * and because the dangerous form (`import { type A, b }`) is one nobody
   * happens to have written in a shared module today, so a check that only read
   * the repo would pass without ever exercising it.
   */
  it("counts only a whole-statement type import as erased", () => {
    const fixture = path.join(ROOT, "node_modules", ".import-scan-fixture.ts");
    writeFileSync(
      fixture,
      [
        'import type { A } from "./a.js";',
        'export type { B } from "./b.js";',
        'import type C from "./c.js";',
        // Mixed: `d` is a value, so the module is emitted and this must be flagged.
        'import { type D, d } from "./d.js";',
        'import { e } from "./e.js";',
        // A default import that merely starts with the letters "type".
        'import types from "./f.js";',
        'import "./g.js";',
      ].join("\n"),
    );
    try {
      const byName = new Map(scan(fixture).map((i) => [i.spec, i.typeOnly]));
      expect(byName.get("./a.js")).toBe(true);
      expect(byName.get("./b.js")).toBe(true);
      expect(byName.get("./c.js")).toBe(true);
      expect(byName.get("./d.js")).toBe(false);
      expect(byName.get("./e.js")).toBe(false);
      expect(byName.get("./f.js")).toBe(false);
      expect(byName.get("./g.js")).toBe(false);
    } finally {
      rmSync(fixture, { force: true });
    }
  });
});
