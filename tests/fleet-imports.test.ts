/**
 * **What the fleet dashboard depends on from `src/`, pinned so it cannot grow
 * quietly.**
 *
 * docs/project/orchestrator-direction.md § Principles: this tool *"runs on the
 * box, spans repos, and must not depend on the product database or on anything
 * under `src/`. If it ever earns its own repo, that should be a move, not a
 * rewrite."*
 *
 * On 2026-09-08 that was narrowed rather than dropped, because Greg asked for
 * the product's dictation to be **reused** rather than copied and there are
 * ~3,000 lines of browser audio machinery behind it that took a day of debugging
 * to make believable. The rule now reads:
 *
 * > Only LEAF, BROWSER-ONLY, PRODUCT-AGNOSTIC modules may be imported from
 * > `src/`. Nothing that reaches the database, an auth session, a slug, an
 * > article, or a route under `src/routes.ts`. If a module is nearly leaf but
 * > for one product coupling, extract the coupling behind a parameter rather
 * > than importing the coupling.
 *
 * **A rule in a document is a rule until somebody adds one import.** So this
 * file walks the fleet's whole transitive import graph and asserts that the set
 * of `src/` files it reaches is exactly {@link ALLOWED}. Adding one is a diff
 * somebody reviews; the failure message says what to think about.
 *
 * The number in that list is the cost of the move. If it ever grows past what a
 * person would move by hand, the answer is to say so in the plan doc rather than
 * to keep extending the array.
 *
 * ## Why a walker rather than a grep
 *
 * A grep over `tools/` finds the imports somebody *wrote*, and the expensive
 * ones are the imports somebody inherited: `useDictation.ts` looked leaf and
 * reached `@supabase/supabase-js` through two hops. So this follows every edge.
 *
 * And the walker itself is checked, because **a closure walker that sees nothing
 * looks exactly like one that found a leaf**. The first version of it matched
 * `import … from` on a single line, so every multi-line braced import was
 * invisible and `mic-devices.ts` vanished out of a closure that imports it. The
 * self-check below asks it a question whose answer is known.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * **All of `tools/`, not just `tools/fleet/`.**
 *
 * The principle is about the box utilities as a family — orchestrator-direction.md
 * says *"it runs on the box, spans repos, and must not depend on the product
 * database or on anything under `src/`"* — and `tools/overseer/` arrived on
 * 2026-09-08 under exactly that sentence. A rule scoped to one directory is one
 * that a sibling directory silently escapes, which is the shape of the gap that
 * left 15,000 lines of `tools/` linted by nothing until somebody looked.
 */
const TOOLS = path.join(ROOT, "tools");

/**
 * **Every file under `src/` the fleet dashboard reaches, and why it is allowed.**
 *
 * All of them import nothing but `react` and each other — that is what "leaf"
 * means here, and it is the property that makes them movable.
 */
const ALLOWED: Record<string, string> = {
  /* The microphone itself: four phases, one owned track, the recorder, the
     upload. The prize, and the reason this rule was narrowed at all. */
  "src/web/useDictation.ts": "the microphone",
  /* Wiring it to a text box: the caret, the one span, the closed box. */
  "src/web/useDictationField.ts": "the text box",
  /* The seam that made the two above importable: where the words come from, as
     a parameter rather than an import of the product's authenticated fetch. */
  "src/web/transcriber.ts": "the transcriber contract",
  /* One microphone per page, however many boxes have a button. */
  "src/web/mic-lock.ts": "the page's one microphone",
  "src/web/mic-recording.ts": "the tape, its container fallback and its caps",
  "src/web/mic-devices.ts": "which microphone, and why the constraint is exact",
  "src/web/dictation-errors.ts": "every recogniser error code to a sentence",
  "src/web/useAudioLevel.ts": "the meter, reading the track being recorded",
  "src/web/audio-level.ts": "the RMS itself",
  /* The two ends of one arithmetic problem. The browser checks the cap before a
     megabyte goes over the wire and the server checks it again; two copies of
     the number is how they come to disagree, which is what this file exists to
     stop. It imports nothing at all, by construction. */
  "src/dictation-limits.ts": "the size caps and the container list, shared by both ends",
  /* The ums, deleted — and its whole design is that it can only ever DELETE. */
  "src/dictation-fillers.ts": "the hesitation sounds",
  /* `packTerms` and `MAX_TERM`: the cap, the de-duplicate, and the angle-bracket
     strip that a session title needs for the same reason an article title does. */
  "src/vocabulary.ts": "packing a term list, and fencing it",
};

/**
 * Every module specifier in a file — including multi-line braced imports, which
 * is the case the first version of this got wrong.
 */
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|[\n;])\s*(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g))
    out.push(m[1] as string);
  for (const m of src.matchAll(/(?:^|[\n;])\s*import\s+["']([^"']+)["']/g)) out.push(m[1] as string);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1] as string);
  return out;
}

/**
 * **The shapes this walker cannot follow, refused outright rather than missed.**
 *
 * A regex walker reads `import … from "x"`, a bare `import "x"` and
 * `import("x")` with a literal. It cannot read `require("x")`, an
 * `import(\`…\`)` built from a template, or one built from a variable — so a
 * `src/` import written any of those ways would pass this file in silence, and
 * the architectural rule would be conventional rather than real. GPT Sol's
 * review of the built code, finding 7.
 *
 * The honest options were an AST walker or this. This is chosen because the
 * shapes are ones no file here has any reason to use: the fleet is ESM
 * throughout and every one of its imports is static. **So they are banned rather
 * than parsed**, which is a rule somebody can read in one line, and the failure
 * says which file and which shape rather than silently under-reporting.
 *
 * If a legitimate dynamic import ever arrives, this is the line to revisit —
 * deliberately, with an AST walker, rather than by widening the pattern.
 */
function unfollowableImports(src: string, file: string): string[] {
  const bad: string[] = [];
  if (/\brequire\s*\(/.test(src)) bad.push(`${file}: require(), which this walker cannot follow`);
  /* `import(` not immediately followed by a quote: a template literal, a
     variable, or a concatenation. */
  if (/\bimport\(\s*[^"')\s]/.test(src))
    bad.push(`${file}: a dynamic import whose specifier is not a string literal`);
  return bad;
}

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  let p = path.resolve(path.dirname(from), spec);
  if (p.endsWith(".js")) p = p.slice(0, -3);
  for (const ext of [".ts", ".tsx", ".js", "/index.ts"]) if (existsSync(p + ext)) return p + ext;
  return existsSync(p) ? p : null;
}

/** Every `.ts`/`.tsx` under a directory, recursively, skipping build output. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Every file the box utilities reach, transitively, as repo-relative paths. */
function fleetClosure(): Set<string> {
  const seen = new Set<string>();
  const queue = filesUnder(TOOLS);
  while (queue.length > 0) {
    const f = queue.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of specifiers(readFileSync(f, "utf8"))) {
      const r = resolve(f, spec);
      if (r !== null) queue.push(r);
    }
  }
  return new Set([...seen].map((f) => path.relative(ROOT, f).split(path.sep).join("/")));
}

describe("what the fleet dashboard imports from src/", () => {
  it("has a walker that can see a multi-line braced import", () => {
    /* THE SELF-CHECK, and it is the first test on purpose. Every assertion below
       is of the form "the walker found nothing it should not have", which is
       exactly what a broken walker reports. `useDictation.ts` imports
       `mic-devices.js` in a braced list spread over five lines — the shape the
       first version of this missed. */
    const found = specifiers(readFileSync(path.join(ROOT, "src/web/useDictation.ts"), "utf8"));
    expect(found).toContain("./mic-devices.js");
    expect(found).toContain("react");
  });

  it("refuses the import shapes it cannot follow, rather than missing them", () => {
    /* A walker that silently skips a shape reports the same clean result as one
       that found nothing to report. So the shapes it cannot read are banned. */
    const offenders: string[] = [];
    for (const f of filesUnder(TOOLS)) {
      offenders.push(...unfollowableImports(readFileSync(f, "utf8"), path.relative(ROOT, f)));
    }
    expect(offenders).toEqual([]);
  });

  it("reaches exactly the leaf modules the rule allows, and no others", () => {
    const reached = [...fleetClosure()].filter((f) => f.startsWith("src/")).sort();
    const allowed = Object.keys(ALLOWED).sort();
    /* Exact, not a subset, in BOTH directions. A file that stops being reached
       is as much a change to "the cost of the move" as one that starts being
       reached, and both should be a line in a diff somebody reads. */
    expect(reached).toEqual(allowed);
  });

  it("reaches nothing that touches the database, an auth session or an article", () => {
    /* The rule stated as its consequences rather than as a list, so that a NEW
       module added to ALLOWED without thinking still fails here. These are the
       three doors the principle is actually about. */
    const forbidden = [
      "src/db.ts",
      "src/store/index.ts",
      "src/routes.ts",
      "src/web/lib/api.ts",
      "src/web/lib/supabase.ts",
      "src/transcribe.ts",
      "src/ai-call.ts",
      "src/article.ts",
      "src/env.ts",
    ];
    const reached = fleetClosure();
    for (const f of forbidden) expect([...reached]).not.toContain(f);
  });

  it("reaches no external package the product's server needs", () => {
    /* The bundle is the other witness — `npm run build:fleet` then grepping it
       for `supabase` — and this is the one that runs in CI. `react` and
       `lucide-react` are the browser's; nothing here may reach `pg`,
       `drizzle-orm`, `stripe`, `jsdom` or `@supabase/supabase-js`. */
    const heavy = ["pg", "drizzle-orm", "stripe", "jsdom", "@supabase/supabase-js", "@sentry/core", "pino"];
    const externals = new Set<string>();
    for (const f of fleetClosure()) {
      for (const spec of specifiers(readFileSync(path.join(ROOT, f), "utf8"))) {
        if (!spec.startsWith(".") && !spec.startsWith("node:")) externals.add(spec.split("/")[0] as string);
      }
    }
    for (const pkg of heavy) expect([...externals]).not.toContain(pkg.split("/")[0]);
  });

  it("says what each allowed import is for, so the list stays reviewable", () => {
    for (const [file, why] of Object.entries(ALLOWED)) {
      expect(why.length, `${file} needs a reason`).toBeGreaterThan(10);
    }
  });
});
