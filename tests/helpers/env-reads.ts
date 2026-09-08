/**
 * **Every environment-variable read is one of two literal shapes, or it is
 * refused.** This is the sweep; tests/env-reads-are-literal.test.ts is the gate.
 *
 * Sol's boundary, quoted because every line below is an instance of it
 * (docs/plans/260908a-design-prompt-sol.md § 3):
 *
 * > Application configuration is read only through two literal AST forms.
 * > Everything else is refused unless it is one of a handful of individually
 * > checked mechanisms.
 *
 * ## What this does and does not reason about
 *
 * **It does no scope analysis, no alias-following and no read-versus-write
 * classification, and those words are meant literally.** An earlier draft of
 * this file claimed them while doing approximate versions of the first two, and
 * Sol broke all five of its mechanism contracts with a shadowed binding or a
 * nested closure. Nothing here resolves a binding, follows a value, or asks
 * which declaration an identifier refers to. There are exactly two mechanisms:
 *
 * 1. **Flat syntactic refusals.** A shape is refused because of what it *is*,
 *    never because of what it might evaluate to.
 * 2. **Pinned regions.** Where the tree legitimately does something the two
 *    shapes cannot express, the region is pinned by a **checksum of its
 *    normalised AST**, and the names it yields are written down beside the
 *    checksum. Change the region's *code* and the gate goes red.
 *
 *    **The guarantee is over the normalised AST, not over bytes**, and the
 *    difference is deliberate: comments, whitespace, semicolons and quote style
 *    are dropped, so a layout change is invisible **on purpose** — a pin nobody
 *    can maintain is a pin somebody deletes. A code change is not invisible.
 *    An earlier version of this paragraph claimed "the bytes inside are the
 *    bytes somebody read"; that was false, and this file's own checksum tests
 *    prove it.
 *
 *    **And a pin only covers what is inside it**, which is a narrowing of the
 *    Stage-1 guarantee and is written here rather than in a plan document,
 *    because here is where somebody meets it. Declared names can drift whenever
 *    they originate outside the pinned node. The instance is
 *    `src/vercel-health.ts`'s `value`: its pin freezes the reporter, but the
 *    names it reads are supplied by its **callers**, which the pin does not
 *    cover — so a caller can hand it a name this sweep never sees, and
 *    `sweep.names` would not have it. Stage 3's `ReportedEnvName` branding is
 *    what closes that, by making `value("NEW_ONE")` a type error rather than a
 *    thing a walker has to notice. Until then the seam is open and named.
 *
 * The remaining positional work is a byte-range containment test — is this
 * refusal inside that pinned region — and a flat scan for a declaration with a
 * given name. Neither asks what an identifier means.
 *
 * ## How the door is closed
 *
 * You cannot obtain the process object without naming it **in this tree**. A
 * package can name it for you — and that is the boundary, not an oversight.
 *
 * Within the tree, every naming is refused: the identifier `process` outside the
 * accepted shape; the string `"process"`, `"node:process"` or `"env"` **anywhere
 * at all** (there is not one under `src/` — grepped 2026-09-08 — so this costs
 * nothing and closes `globalThis["process"]`, `Reflect.get(process, "env")`,
 * `require("process")` and every re-export in one rule);
 * `require`/`createRequire`/`nodeRequire`, at every use rather than only at the
 * declaration; a computed property on `globalThis`; an imported binding named
 * `env`; and any property of `process` outside a short allowlist, which is what
 * makes `process.getBuiltinModule("node:process")` — a value that `===`
 * `process` on this Node — a refusal rather than a miss.
 *
 * **What this claims is a syntax policy with a named boundary, never
 * soundness.** Every "this gate is now sound" claim written during this stage
 * has turned out to be wrong, three times running, so the claim is bounded here
 * instead and the bound is *executable*: see `package-bridge-boundary.ts` in
 * tests/env-reads-are-literal.test.ts, a control that is deliberately **green**.
 * Anyone who closes this hole has to come and flip it. A limit written in prose
 * decays; a limit written as an assertion cannot — which is the postmortem's own
 * rule, that a requirement recorded in prose is not a requirement.
 *
 * **The boundary in one line.** `import { anything } from "some-pkg"` can hand
 * back the real environment, and nothing here resolves a package. This is the
 * same class docs/postmortems/260827b-health-check-green-while-uploads-dead.md
 * excluded on the day it was written: `ANTHROPIC_API_KEY` is in `EXPECTED` while
 * nothing under `src/` reads it by name, because the SDK takes it from the
 * environment itself. A package bridge is that, with the last hop lexically
 * inside `src/`. Sol's § 3 named "an imported module" among the ways a finite
 * AST recogniser cannot cover, before any of this was built.
 *
 * It is acceptable rather than merely admitted because of an asymmetry: crossing
 * it is **one reviewed line**. A declared bridge is a `package.json` diff; an
 * undeclared one — `std-env`, the package Sol demonstrated with, is not a
 * dependency of this project at all, only a transitive dev dependency of vitest
 * hoisted into `node_modules` — is an unlisted import that knip reports in
 * `npm run check` (advisory, not a gate). Either way it is visible, rather than
 * a change hidden among 532 files.
 *
 * **The other residue**: a name assembled at runtime from fragments
 * (`"proc" + "ess"`), or reached through `eval`, `Function` or a proxy.
 *
 * ## The two things that must not be softened
 *
 * 1. **Every `.ts`/`.tsx` file is parsed. No text prefilter, and no directory
 *    is skipped** — not hidden ones, which is how a read hid from an earlier
 *    draft of this file.
 * 2. **`parseSource` sets `errorRecovery: true`**, so a file it cannot parse
 *    comes back looking fine. `errors` is read and a throw is caught; both are
 *    a refusal, never a clean file. docs/reusable/silent-success.md.
 *
 * ## What is accepted
 *
 * `process.env.NAME` and `import.meta.env.NAME` — the root exactly the bare
 * identifier or the `import.meta` meta-property, both members non-computed, and
 * `NAME` a plain identifier. Counted **wherever it occurs**, including on the
 * left of an assignment, so `process.env.X ||= …` and `X++` cannot be got wrong:
 * there is no read-versus-write classifier to get wrong.
 *
 * `new.target.env.X` contains neither door and is untouched — it is a
 * `MetaProperty` too, so this keys on `meta.name`, not on the node type.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { type AstNode, dynamicImportSpec, lineOf, parseSource, walkAst } from "./ts-ast.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * The strings that name the door, refused wherever they appear.
 *
 * There is not one of these under `src/` today, so the rule costs nothing and
 * is the flattest possible closure: a spelling that has to name the door as
 * text is refused without anyone having thought of the spelling.
 */
const FORBIDDEN_STRINGS = new Set(["process", "node:process", "env"]);

/**
 * The only properties of `process` that `src/` uses — an **allowlist**, so a
 * Node API nobody has thought of is a refusal rather than a silent door.
 * `process.getBuiltinModule("node:process")` returns `process` itself, which is
 * how an earlier draft's "non-`env` properties are not doors" was wrong.
 */
const PROCESS_PROPERTIES = new Set(["env", "argv", "exit", "cwd", "pid", "version"]);

/**
 * `require`/`createRequire` hand back a module under any name the caller likes.
 * Working out which binding holds one is unbounded, so the identifier itself is
 * refused and the one legitimate user is pinned.
 */
const REQUIRE_NAMES = new Set(["require", "createRequire", "nodeRequire"]);

/**
 * Keys in a **type**, which are names rather than the global. Keys in an
 * *object* are not on this list and are refused, because
 * `const { process: p } = globalThis` is an `ObjectProperty` key too — Sol's
 * twentieth spelling, 2026-09-08. Telling a pattern from a literal is analysis;
 * refusing both is not, and it costs nothing because no object in this repo has
 * a key spelled `process` or `require`.
 */
const TYPE_MEMBERS = new Set(["TSPropertySignature", "TSMethodSignature"]);

/**
 * An imported binding actually **named** `env` — `import { env } from "std-env"`
 * hands back the real `process.env` under a name with no `process` in it.
 *
 * **This does not close the class, and saying so plainly is the point.**
 * `import * as m from "pkg"; m.env.X` stays invisible, and refusing `.env`
 * generally is not available to us: there are 189 `.env` member accesses under
 * `src/` outside the two doors. A bare package remains an unchecked bridge.
 */
const BRIDGED_BINDING = "env";

const IMPORT_SPECIFIERS = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);

/** Everything that carries a module specifier — imports and both re-export forms. */
const MODULE_DECLARATIONS = new Set([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
]);

/**
 * **Every executable TypeScript extension, and the test enumerates the same
 * set from this constant.** Both sides used to spell `/\.tsx?$/` separately,
 * so they agreed while both missed `.mts` and `.cts` — an independent
 * enumeration that shares a bug with the thing it checks is not independent.
 * Sol swept a `read.mts` holding an ordinary literal read and got
 * `filesParsed: []`, 2026-09-08.
 */
export const SOURCE_EXTENSION = /\.(?:m|c)?tsx?$/;

const MEMBER_TYPES = new Set(["MemberExpression", "OptionalMemberExpression"]);
const isMember = (n: AstNode | null | undefined): boolean => !!n && MEMBER_TYPES.has(String(n.type));

/** Which door a name came through. `pin` is a name a pinned region declares. */
type Door = "process.env" | "import.meta.env";

export type Shape =
  | `${Door}-whole`
  | `${Door}[computed]`
  | "import.meta-whole"
  | "process-alias"
  | "process-api"
  | "process-computed"
  | "process-optional"
  | "process-property"
  | "computed-global"
  | "forbidden-string"
  | "module-specifier"
  | "outward-import"
  | "require-identifier"
  | "parse-error"
  | "pin-broken";

export interface Refusal {
  /** Repo-relative, so a message names a path somebody can open. */
  file: string;
  line: number;
  /** The offending line, trimmed — a refusal nobody can act on is half a gate. */
  source: string;
  shape: Shape;
  why: string;
  /** Byte offset, so a pinned region can say whether it covers this. */
  at: number;
}

export interface NameSite {
  name: string;
  file: string;
  line: number;
  door: Door | "pin";
}

export interface PinReport {
  file: string;
  kind: PinKind;
  name: string;
  /** How many regions of that kind and name the file holds. Must be 1. */
  found: number;
  /** The checksum as it actually is now. */
  actual: string | null;
  matched: boolean;
  yields: string[];
}

export interface EnvSweep {
  /** Repo-relative paths, every one of which was parsed. */
  filesParsed: string[];
  names: NameSite[];
  /** Sorted and unique — what Stage 2 holds against the inventory doors. */
  uniqueNames: string[];
  refusals: Refusal[];
  pins: PinReport[];
}

/* ────────────────────────────────────────────────────────────────────────────
   The pinned regions.

   Each is somewhere the tree legitimately holds a whole environment, or indexes
   it by something that is not in the source. The sweep cannot reason about any
   of them, so it does not try: a human read the region, wrote down the names it
   yields, and pinned its shape. Change the region and the gate goes red.

   **Never a file-wide exemption.** One of those on src/env.ts hid
   `SPIDERYARN_ENV_PINNED` — a real variable no inventory knew about — through
   the first attempt at this check.
   ──────────────────────────────────────────────────────────────────────────── */

export type PinKind = "function" | "variable" | "import";

export interface Pin {
  file: string;
  kind: PinKind;
  /** The function or variable name, or the module specifier for an import. */
  name: string;
  /** `astChecksum` of the region's normalised AST. Regenerate with `checksumOfPin`. */
  checksum: string;
  /** The names this region puts into the inventory. Hard-coded on purpose. */
  yields: string[];
  /** Why the sweep cannot read it, in one line, for whoever meets it red. */
  why: string;
}

const PINS: Pin[] = [
  {
    file: "src/env.ts",
    kind: "variable",
    name: "INHERITED",
    checksum: "d895177a83146237",
    yields: [],
    why: "snapshots the whole environment at module load, which is what the file is for",
  },
  {
    file: "src/env.ts",
    kind: "function",
    name: "loadEnvLocal",
    checksum: "8fa8a34768cc2583",
    yields: [],
    why: "hands the whole environment to applyEnvFile so a .env file can write into it",
  },
  {
    file: "src/env.ts",
    kind: "function",
    name: "resolveTargetUrl",
    checksum: "7d0e91a724dd7622",
    yields: ["DATABASE_URL"],
    why: "reads a name off the INHERITED snapshot, which is a value the sweep cannot see into",
  },
  {
    file: "src/env.ts",
    kind: "function",
    name: "applyEnvFile",
    checksum: "a73370bec74de429",
    yields: [],
    why: "the names it writes come from a .env file's own text, so they are not source-authored",
  },
  {
    file: "src/env.ts",
    kind: "function",
    name: "withoutGitVars",
    checksum: "5926f4ecdec4ef92",
    yields: [],
    why: "copies a whole environment to hand to git, minus four GIT_* names nothing reads",
  },
  {
    file: "src/env.ts",
    kind: "function",
    name: "envProdCandidates",
    checksum: "5391c58c6a1da6b0",
    yields: [],
    why: "passes the whole environment to withoutGitVars",
  },
  {
    file: "src/sanitize-policy.ts",
    kind: "function",
    name: "ownOrigins",
    checksum: "0f9170dad10ba7da",
    yields: ["SPIDERYARN_ORIGINS", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"],
    why:
      "reads three names off a globalThis-guarded alias, because src/web/sanitize.ts imports this " +
      "module into the browser build where a bare `process` is a ReferenceError at load. It is a " +
      "defence (docs/project/security-map.md) and nobody edits it casually",
  },
  {
    file: "src/models.ts",
    kind: "function",
    name: "resolveModel",
    checksum: "af857fa0416c4317",
    yields: [],
    why: "indexes process.env by MODEL_ENV_VAR's value; the twelve names come from that record at runtime",
  },
  {
    file: "src/vercel-health.ts",
    kind: "function",
    name: "value",
    checksum: "dbe16bbe3e6dc3d4",
    yields: [],
    why: "the reporter indexing process.env while iterating EXPECTED, whose names are its own",
  },
  {
    file: "src/jsdom-lazy.ts",
    kind: "import",
    name: "node:module",
    checksum: "8fbb118a9c00eeed",
    yields: [],
    why: "the only legitimate createRequire in the tree: a static import of jsdom bundles the package",
  },
  {
    file: "src/jsdom-lazy.ts",
    kind: "variable",
    name: "nodeRequire",
    checksum: "6158746bdcf2299b",
    yields: [],
    why: "binds that require function",
  },
  {
    file: "src/jsdom-lazy.ts",
    kind: "function",
    name: "jsdom",
    checksum: "f0e9baca2068da56",
    yields: [],
    why:
      "the one call of that require function. Pinned separately because pinning only the binding " +
      'left `nodeRequire("std-env").env.X` in an unpinned function passing — Sol, round 2',
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   The checksum
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Fields that are about *where* a node is or *how it was written*, not what it
 * is. `extra` holds a literal's raw text, so dropping it makes the checksum
 * blind to quote style — which is what keeps it stable under a formatter.
 */
const POSITIONAL = new Set([
  "start",
  "end",
  "loc",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "extra",
]);

function normalise(node: unknown): string {
  if (Array.isArray(node)) return `[${node.map(normalise).join(",")}]`;
  if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    const keys = Object.keys(n)
      .filter((k) => !POSITIONAL.has(k))
      .sort();
    return `{${keys.map((k) => `${k}:${normalise(n[k])}`).join(",")}}`;
  }
  return JSON.stringify(node) ?? "null";
}

/**
 * A checksum of the **tree**, not the text.
 *
 * Whitespace, line breaks, comments, semicolons and quote style are all absent
 * from the AST or dropped above, so a formatter cannot change this — which is
 * the property that makes a pin maintainable rather than a nuisance. A renamed
 * local *does* change it, and that is correct: it is a change worth re-reading.
 */
export function astChecksum(node: unknown): string {
  return createHash("sha256").update(normalise(node)).digest("hex").slice(0, 16);
}

function locate(program: unknown, kind: PinKind, name: string): AstNode[] {
  const found: AstNode[] = [];
  walkAst(program, (n) => {
    const id = n.id as AstNode | undefined;
    if (kind === "function" && n.type === "FunctionDeclaration" && id?.name === name) found.push(n);
    else if (kind === "variable" && n.type === "VariableDeclarator" && id?.name === name) {
      found.push(n);
    } else if (kind === "import" && n.type === "ImportDeclaration") {
      if ((n.source as AstNode | undefined)?.value === name) found.push(n);
    }
  });
  return found;
}

/**
 * The checksum a pin should carry, for a human updating one that has gone red.
 *
 * `null` when the region is absent or ambiguous — which is itself a refusal at
 * sweep time, because a pin that matches nothing guards nothing.
 */
export function checksumOfPin(source: string, kind: PinKind, name: string): string | null {
  const parsed = parseSource(source);
  const found = locate(parsed.program, kind, name);
  return found.length === 1 && found[0] ? astChecksum(found[0]) : null;
}

/* ────────────────────────────────────────────────────────────────────────────
   The sweep
   ──────────────────────────────────────────────────────────────────────────── */

interface FileResult {
  names: NameSite[];
  refusals: Refusal[];
  pins: PinReport[];
}

type Refuse = (n: AstNode, shape: Shape, why: string) => void;

/** Every `.ts`/`.tsx` under `dir`. Nothing is skipped — see the header. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXTENSION.test(entry.name)) out.push(full);
  }
  return out.sort();
}

/** Unwrap the TS-only wrappers, so `(globalThis as X).process` names `globalThis`. */
function unwrap(n: AstNode | undefined): AstNode | undefined {
  let cur = n;
  while (
    cur &&
    (cur.type === "TSAsExpression" ||
      cur.type === "TSNonNullExpression" ||
      cur.type === "TSSatisfiesExpression" ||
      cur.type === "ParenthesizedExpression")
  ) {
    cur = cur.expression as AstNode | undefined;
  }
  return cur;
}

/** A string a literal certainly is, or `null` — a template with a hole is not one. */
function staticString(n: AstNode | undefined): string | null {
  if (!n) return null;
  if (n.type === "StringLiteral" && typeof n.value === "string") return n.value;
  if (n.type === "TemplateLiteral") {
    const quasis = (n.quasis ?? []) as AstNode[];
    const holes = (n.expressions ?? []) as unknown[];
    const cooked = (quasis[0]?.value as { cooked?: unknown } | undefined)?.cooked;
    if (quasis.length === 1 && holes.length === 0 && typeof cooked === "string") return cooked;
  }
  return null;
}

/* ── the flat checks, one per family, so the visitor stays a dispatch ── */

/**
 * **`@/` is this repo's own path alias, not a package** — `vite.config.ts:477`
 * and `src/web/tsconfig.json:27` both point it at `src/web`, and thirteen files
 * under `src/` import through it.
 *
 * It has to go through the boundary arithmetic below, because it does not *look*
 * relative and the boundary check returns early for everything that does not.
 * `@/../../scripts/env-bridge.js` resolves to a real file outside `src/`, both
 * the import and the read are inside `src/`, and the bridge is code this repo
 * wrote — so it is squarely in scope and does not get to shelter under the
 * package boundary. Sol found it in the scoped check, 2026-09-08.
 *
 * **Hard-coded, deliberately.** This is not a resolver and must not become one:
 * a second alias appearing in the config has to be added here by somebody who
 * decided to, rather than silently inheriting the treatment. Written relative to
 * the swept root — `src` + `web` is the real target — so the controls exercise
 * the same arithmetic the real tree gets.
 */
const ALIAS_PREFIX = "@/";
const ALIAS_TARGET = "web";

/**
 * **A package specifier, which is the only thing allowed past the boundary
 * without being resolved.** Everything else is treated as repo-local and must
 * land inside the swept tree.
 *
 * **This is an inversion, and it is the same move as the recogniser's two
 * accepted shapes.** The rule used to be allow-by-default for anything that did
 * not look relative — and three consecutive reviews each found one more
 * non-relative repo-local spelling that walked through it: `@/` (this repo's
 * Vite alias), then `/scripts/x.js` (Vite root-absolute), then `/@fs/<abs>`.
 * A fourth pass would have found `file:` and a fifth a drive letter. Enumerating
 * the escapes is the losing side of that trade, so the grammar below is the
 * allowlist and a specifier form nobody has anticipated now **fails closed**.
 *
 * The grammar is the ordinary npm one — `name`, `@scope/name`, either with an
 * optional `/subpath` — plus `node:` builtins. Note `@/components/ui/button`
 * does *not* match: the scope segment would be empty. That distinction is
 * load-bearing in both directions, since ten scoped packages under `src/` must
 * stay green while the alias must be resolved.
 */
const PACKAGE_SEGMENT = "[A-Za-z0-9~][A-Za-z0-9._~-]*";
const PACKAGE_NAME = new RegExp(
  `^(?:@${PACKAGE_SEGMENT}\\/)?${PACKAGE_SEGMENT}(?:\\/[^\\s]*)?$`,
);
const NODE_BUILTIN = /^node:[a-z][a-z0-9/._-]*$/;

function isPackageSpecifier(spec: string): boolean {
  /* **A `..` segment in a subpath disqualifies it**, even though `pkg/../../x`
     is a form nobody writes — none of the 762 specifiers under `src/` has one.
     It is refused not because we know it resolves outward, but because we would
     have to know a resolver's internals to know it does not, and that is the
     same kind of claim that made `process.getBuiltinModule` a hole and made
     `@/` look like a package. Fail closed. */
  if (spec.split("/").includes("..")) return false;
  return NODE_BUILTIN.test(spec) || PACKAGE_NAME.test(spec);
}

/**
 * Where a repo-local specifier lands, or `null` if this cannot say.
 *
 * `null` is a refusal, not a pass: a form that cannot be resolved to a path is
 * exactly the case that kept getting through.
 */
function resolveRepoLocal(spec: string, b: Boundary): string | null {
  if (spec.startsWith(ALIAS_PREFIX)) {
    /* Leading slashes stripped because Vite resolves `@//components/ui/button`
       inside `src/web` just as it does `@/components/ui/button`, while the
       naive slice reads as filesystem-absolute and would be falsely reported
       outward. Nothing writes that form today; a false refusal is a landmine
       for whoever does. `@//../../scripts/…` still escapes and is still red. */
    return path.resolve(b.root, ALIAS_TARGET, spec.slice(ALIAS_PREFIX.length).replace(/^\/+/, ""));
  }
  if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
    return path.resolve(b.fileDir, spec);
  }
  return null;
}

/** Where the file being swept sits, and where the swept tree ends. Absolute. */
interface Boundary {
  fileDir: string;
  root: string;
}

/**
 * One module specifier, asked the two questions a specifier can be asked.
 *
 * The second makes the sweep's boundary a **checked** boundary rather than a
 * scoped one. Sol's bridge attack — a module that re-exports the process object
 * under an innocent name — works from anywhere the sweep does not read, so a
 * relative import that leaves the swept tree is refused rather than followed.
 * `src/` imports nothing outward today; that was an assumption until this line,
 * and turning an assumption into a check is the whole thesis of this plan.
 *
 * Bare specifiers are not this rule's business: a package cannot be a bridge
 * this repo wrote, and `node:process` is already refused by name above.
 */
function checkSpecifierValue(n: AstNode, spec: string, b: Boundary, refuse: Refuse): void {
  if (FORBIDDEN_STRINGS.has(spec)) {
    refuse(
      n,
      "module-specifier",
      `\`${spec}\` may not be imported or re-exported: the process object would then travel under ` +
        "a name this sweep has no way to recognise",
    );
    return;
  }
  /* The documented boundary, and the only thing not resolved. */
  if (isPackageSpecifier(spec)) return;

  /* Path arithmetic, not module resolution: the specifier carries its own `.js`
     and nothing here needs the file to exist. */
  const resolved = resolveRepoLocal(spec, b);
  if (resolved === null) {
    refuse(
      n,
      "outward-import",
      `\`${spec}\` is neither a package name nor a form this sweep can resolve to a path, so it ` +
        "cannot be shown to stay inside the swept tree. Vite root-absolute (`/scripts/x.js`), " +
        "`/@fs/<abs>`, `file:` URLs and drive letters all land here — each of them reaches " +
        "repo-written code that this sweep never opens. Write it relative, or through `@/`.",
    );
    return;
  }
  if (resolved === b.root || resolved.startsWith(b.root + path.sep)) return;
  refuse(
    n,
    "outward-import",
    `\`${spec}\` resolves outside the swept tree (${resolved}). Everything this sweep reasons ` +
      "about must live inside it: a module it never opens can re-export the process object under " +
      "any name, and nothing here would see it. Move the module in, or bring its directory into " +
      "the sweep — do not add an exemption.",
  );
}

function checkModuleSpecifier(n: AstNode, b: Boundary, refuse: Refuse): boolean {
  if (!MODULE_DECLARATIONS.has(String(n.type))) return false;
  const spec = staticString(n.source as AstNode | undefined);
  if (spec !== null) checkSpecifierValue(n, spec, b, refuse);
  return true;
}

function checkDynamicImport(n: AstNode, b: Boundary, refuse: Refuse): boolean {
  const dyn = dynamicImportSpec(n);
  if (!dyn) return false;
  if (dyn.spec === null) {
    refuse(
      n,
      "module-specifier",
      `a dynamic import() whose specifier is a ${dyn.argType} rather than a string literal — it ` +
        "cannot be named, so it cannot be shown not to be node:process",
    );
  } else {
    checkSpecifierValue(n, dyn.spec, b, refuse);
  }
  return true;
}

function checkForbiddenString(n: AstNode, parent: AstNode | null, refuse: Refuse): boolean {
  if (n.type !== "StringLiteral" && n.type !== "TemplateLiteral") return false;
  /* A module specifier gets the clearer message above rather than this one. */
  if (parent && MODULE_DECLARATIONS.has(String(parent.type))) return true;
  const value = staticString(n);
  if (value !== null && FORBIDDEN_STRINGS.has(value)) {
    refuse(
      n,
      "forbidden-string",
      `the string "${value}" may not appear under src/: naming the process object as text is how ` +
        "every computed spelling reaches it, and there is no other use of this string in the tree",
    );
  }
  return true;
}

function checkRequireIdentifier(
  n: AstNode,
  parent: AstNode | null,
  key: string,
  refuse: Refuse,
): boolean {
  const why =
    "`require`/`createRequire`/`nodeRequire` hands back a module under any name, so the identifier " +
    "itself is refused rather than followed — every use, not only the declaration, because a pin " +
    "on the declaration left `nodeRequire(\"std-env\").env.X` in an unpinned function passing. A " +
    "legitimate call site gets its own pinned region";
  if (IMPORT_SPECIFIERS.has(String(n.type))) {
    const spelled = [n.local, n.imported].map((x) => (x as AstNode | undefined)?.name);
    if (spelled.some((s) => typeof s === "string" && REQUIRE_NAMES.has(s))) {
      refuse(n, "require-identifier", why);
    }
    return true;
  }
  if (n.type !== "Identifier" || !REQUIRE_NAMES.has(String(n.name))) return false;
  if (parent && IMPORT_SPECIFIERS.has(String(parent.type))) return true;
  if (parent && key === "key" && !parent.computed && TYPE_MEMBERS.has(String(parent.type))) {
    return true;
  }
  refuse(n, "require-identifier", why);
  return true;
}

/** `import { env as anything } from "…"`, and the re-export that mirrors it. */
function checkBridgedBinding(n: AstNode, refuse: Refuse): void {
  const imported =
    n.type === "ImportSpecifier"
      ? (n.imported as AstNode | undefined)?.name
      : n.type === "ExportSpecifier"
        ? (n.local as AstNode | undefined)?.name
        : undefined;
  if (imported !== BRIDGED_BINDING) return;
  refuse(
    n,
    "module-specifier",
    `a binding imported under the name \`${BRIDGED_BINDING}\` — \`import { env } from "std-env"\` ` +
      "hands back the real process.env with no `process` anywhere in the spelling. The local alias " +
      "is irrelevant; the imported name is what matters. This does not close the class: a " +
      "namespace import (`import * as m from \"pkg\"; m.env.X`) is still invisible",
  );
}

function checkComputedGlobal(n: AstNode, refuse: Refuse): boolean {
  if (!isMember(n) || !n.computed) return false;
  const obj = unwrap(n.object as AstNode | undefined);
  if (obj?.type === "Identifier" && obj.name === "globalThis") {
    refuse(
      n,
      "computed-global",
      "a computed property on `globalThis`, which can be `process` — refused rather than evaluated",
    );
  }
  return false; // not exclusive: the node may be an env door too
}

/* ── the two doors ── */

interface Ctx {
  relPath: string;
  parents: Map<AstNode, { node: AstNode | null; key: string }>;
  names: NameSite[];
  refuse: Refuse;
}

/**
 * `<root>.env.NAME`, the tail both doors share. `envMember` is the `<root>.env`
 * node; the one hop upwards is positional, not a resolution.
 */
function readThroughEnv(envMember: AstNode, door: Door, ctx: Ctx): void {
  const up = ctx.parents.get(envMember);
  const g = up?.node;
  const named = g?.property as AstNode | undefined;
  if (!g || up?.key !== "object" || g.type !== "MemberExpression" || g.computed) {
    const computed = isMember(g);
    ctx.refuse(
      envMember,
      computed ? `${door}[computed]` : `${door}-whole`,
      computed
        ? `\`${door}\` reached by a key that is not in the source, so the name read cannot be stated`
        : `the whole \`${door}\` object, so every name it carries is invisible to this sweep`,
    );
    return;
  }
  if (named?.type !== "Identifier") {
    ctx.refuse(envMember, `${door}[computed]`, `\`${door}\` read by something that is not a name`);
    return;
  }
  ctx.names.push({ name: String(named.name), file: ctx.relPath, line: lineOf(g), door });
}

function checkProcess(n: AstNode, parent: AstNode | null, key: string, ctx: Ctx): boolean {
  if (n.type !== "Identifier" || n.name !== "process") return false;
  const { refuse } = ctx;
  if (!parent) {
    refuse(n, "process-alias", "a bare `process` reference on its own");
    return true;
  }
  /* A key in a *type* is a name. A key in an *object* is not safe: an
     `ObjectPattern`'s properties are `ObjectProperty` nodes too, so
     `const { process: p } = globalThis` arrives here — Sol's twentieth
     spelling. Both are refused rather than told apart. */
  if (key === "key" && !parent.computed && TYPE_MEMBERS.has(String(parent.type))) return true;
  if (key === "key") {
    refuse(
      n,
      "process-alias",
      "`process` as an object key, which in a destructuring pattern is " +
        "`const { process: p } = globalThis` and hands the object out under another name",
    );
    return true;
  }
  if (isMember(parent) && key === "property") {
    refuse(
      n,
      "process-property",
      "`process` reached as a property of something else, which this cannot identify",
    );
    return true;
  }
  if (!isMember(parent) || key !== "object") {
    refuse(
      n,
      "process-alias",
      "`process` used as a value — assigned, passed, destructured or returned — after which " +
        "nothing syntactic can say which names come off it",
    );
    return true;
  }
  if (parent.type === "OptionalMemberExpression" || parent.optional === true) {
    refuse(n, "process-optional", "`process?.env` is not one of the two accepted shapes");
    return true;
  }
  const prop = parent.property as AstNode | undefined;
  if (parent.computed || prop?.type !== "Identifier") {
    refuse(n, "process-computed", "a computed property on `process`, which can be `env`");
    return true;
  }
  if (!PROCESS_PROPERTIES.has(String(prop.name))) {
    refuse(
      n,
      "process-api",
      `\`process.${String(prop.name)}\` is not one of the properties src/ uses. The allowlist is ` +
        "deliberate: `process.getBuiltinModule(\"node:process\")` returns the process object " +
        "itself, so a Node API nobody thought of must be a refusal rather than a miss",
    );
    return true;
  }
  if (prop.name === "env") readThroughEnv(parent, "process.env", ctx);
  return true;
}

function checkImportMeta(n: AstNode, parent: AstNode | null, key: string, ctx: Ctx): boolean {
  if (n.type !== "MetaProperty") return false;
  const meta = n.meta as AstNode | undefined;
  /* `new.target` is a MetaProperty too, and contains neither door. */
  if (meta?.name !== "import" || (n.property as AstNode | undefined)?.name !== "meta") return true;
  const { refuse } = ctx;
  if (!parent || !isMember(parent) || key !== "object") {
    refuse(n, "import.meta-whole", "`import.meta` used as a value rather than read through");
    return true;
  }
  const prop = parent.property as AstNode | undefined;
  if (parent.type === "OptionalMemberExpression" || parent.computed || prop?.type !== "Identifier") {
    refuse(n, "import.meta-whole", "an optional or computed property on `import.meta`");
    return true;
  }
  /* `import.meta.url` and `import.meta.dirname` are not environment doors. */
  if (prop.name === "env") readThroughEnv(parent, "import.meta.env", ctx);
  return true;
}

/**
 * One file, walked once.
 *
 * **Not exported, and that is structural rather than stylistic.** The first
 * attempt's negative controls called its per-file sweep directly, so when the
 * *file-selection gate* was the thing with the bug, its fixtures stayed green
 * over it. Nothing outside this module can name this function: a control has to
 * enter through `sweepEnvReads`, the door the real assertion uses.
 */
function sweepFile(relPath: string, source: string, boundary: Boundary): FileResult {
  const names: NameSite[] = [];
  const refusals: Refusal[] = [];
  const lines = source.split("\n");
  const unreadable = (line: number, why: string): FileResult => ({
    names: [],
    pins: [],
    refusals: [
      {
        file: relPath,
        line,
        source: (lines[line - 1] ?? "").trim(),
        shape: "parse-error",
        at: 0,
        why: `${why} — so nothing in this file was examined, and a gate that goes quiet is worse than one that goes red`,
      },
    ],
  });

  let parsed: ReturnType<typeof parseSource>;
  try {
    parsed = parseSource(source);
  } catch (err) {
    return unreadable(1, `this file threw while parsing (${String(err)})`);
  }
  /* `?? []` because babel types `errors` as nullable, and the difference
     between `null` and `[]` must not decide whether a file gets examined. */
  const errors = parsed.errors ?? [];
  if (errors.length > 0) {
    const first = errors[0] as { loc?: { line?: number }; message?: string } | undefined;
    return unreadable(first?.loc?.line ?? 1, `this file did not parse (${first?.message})`);
  }

  const parents = new Map<AstNode, { node: AstNode | null; key: string }>();
  walkAst(parsed.program, (n, parent, key) => void parents.set(n, { node: parent, key }));

  const refuse: Refuse = (n, shape, why) => {
    const line = lineOf(n);
    refusals.push({
      file: relPath,
      line,
      source: (lines[line - 1] ?? "").trim(),
      shape,
      why,
      at: Number(n.start ?? 0),
    });
  };
  const ctx: Ctx = { relPath, parents, names, refuse };

  walkAst(parsed.program, (n, parent, key) => {
    if (checkModuleSpecifier(n, boundary, refuse)) return;
    if (checkDynamicImport(n, boundary, refuse)) return;
    checkComputedGlobal(n, refuse);
    checkBridgedBinding(n, refuse);
    if (checkForbiddenString(n, parent, refuse)) return;
    if (checkRequireIdentifier(n, parent, key, refuse)) return;
    if (checkProcess(n, parent, key, ctx)) return;
    checkImportMeta(n, parent, key, ctx);
  });

  /* The pins last: a refusal inside a region whose checksum still matches is a
     refusal a human has already read and signed for. */
  const pinned = applyPins(relPath, parsed.program, lines);
  names.push(...pinned.names);
  refusals.push(...pinned.refusals);
  const kept = refusals.filter(
    (r) => r.at < 0 || !pinned.covered.some((c) => r.at >= c.start && r.at < c.end),
  );
  return { names, refusals: kept, pins: pinned.pins };
}

/**
 * Every pin declared for this file: located, checksummed, and either covering
 * its region or refusing.
 *
 * A pin that matches nothing, or matches twice, is a refusal rather than a
 * silent no-op — a pin guarding nothing is the same failure as no pin at all.
 */
function applyPins(
  relPath: string,
  program: unknown,
  lines: string[],
): FileResult & { covered: { start: number; end: number }[] } {
  const pins: PinReport[] = [];
  const names: NameSite[] = [];
  const refusals: Refusal[] = [];
  const covered: { start: number; end: number }[] = [];

  for (const pin of PINS.filter((p) => p.file === relPath)) {
    const found = locate(program, pin.kind, pin.name);
    const only = found.length === 1 ? found[0] : undefined;
    const actual = only ? astChecksum(only) : null;
    const matched = actual !== null && actual === pin.checksum;
    const line = only ? lineOf(only) : 0;
    pins.push({ ...pin, found: found.length, actual, matched });

    if (!matched) {
      const what =
        found.length === 1
          ? `has changed: pinned ${pin.checksum || "(unset)"}, now ${actual}`
          : `was found ${found.length} times, not once`;
      refusals.push({
        file: pin.file,
        line,
        source: (lines[line - 1] ?? "").trim(),
        shape: "pin-broken",
        at: -1,
        why:
          `the pinned ${pin.kind} \`${pin.name}\` ${what}. It is pinned because the sweep cannot ` +
          `reason about it — ${pin.why}. Read the region, decide what environment names it now ` +
          "yields, and update the checksum and the declared names together in " +
          "tests/helpers/env-reads.ts; `checksumOfPin(source, kind, name)` gives the new value.",
      });
      continue;
    }
    covered.push({ start: Number(only?.start ?? 0), end: Number(only?.end ?? 0) });
    for (const name of pin.yields) names.push({ name, file: pin.file, line, door: "pin" });
  }
  return { pins, names, refusals, covered };
}

/**
 * The twelve model overrides, from `MODEL_ENV_VAR`'s **actual runtime values**.
 *
 * Imported rather than parsed: the record is data, and reading its source would
 * be a second and weaker parser of the same fact. This is a different soundness
 * question from the pin on `resolveModel` — the pin says the function still
 * indexes that record, this says what the record contains.
 */
async function modelOverrideNames(): Promise<{ names: NameSite[]; refusals: Refusal[] }> {
  const names: NameSite[] = [];
  const refusals: Refusal[] = [];
  const mod: { MODEL_ENV_VAR: Record<string, unknown> } = await import("../../src/models.js");
  for (const [task, value] of Object.entries(mod.MODEL_ENV_VAR)) {
    if (value === null) continue;
    if (typeof value !== "string" || value === "") {
      refusals.push({
        file: "src/models.ts",
        line: 0,
        source: "",
        shape: "pin-broken",
        at: -1,
        why: `MODEL_ENV_VAR.${task} is ${JSON.stringify(value)}, which is neither null nor a name`,
      });
      continue;
    }
    names.push({ name: value, file: "src/models.ts", line: 0, door: "pin" });
  }
  return { names, refusals };
}

/**
 * **The one entry point.** The real assertion and every negative control come
 * through here, pointed at different directories; there is no way in below it.
 *
 * @param dir the tree to sweep, absolute — `<repo>/src` in earnest.
 */
export async function sweepEnvReads(dir: string): Promise<EnvSweep> {
  const filesParsed: string[] = [];
  const names: NameSite[] = [];
  const refusals: Refusal[] = [];
  const pins: PinReport[] = [];

  const root = path.resolve(dir);
  for (const full of sourceFiles(root)) {
    const relPath = path.relative(REPO_ROOT, full);
    filesParsed.push(relPath);
    const out = sweepFile(relPath, readFileSync(full, "utf8"), {
      fileDir: path.dirname(full),
      root,
    });
    names.push(...out.names);
    refusals.push(...out.refusals);
    pins.push(...out.pins);
  }

  /* Only when the tree really holds the file: a fixture directory must not drag
     src/models.ts's runtime values into its answer. */
  if (filesParsed.includes("src/models.ts")) {
    const out = await modelOverrideNames();
    names.push(...out.names);
    refusals.push(...out.refusals);
  }

  return {
    filesParsed,
    names,
    uniqueNames: [...new Set(names.map((n) => n.name))].sort(),
    refusals,
    pins,
  };
}

/** Every pin, for a gate that wants to say one is missing rather than skipped. */
export function declaredPins(): readonly Pin[] {
  return PINS;
}
