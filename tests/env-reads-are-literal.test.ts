/**
 * **No environment variable is read under `src/` except by name, in the source.**
 *
 * The recogniser is tests/helpers/env-reads.ts and its header carries the
 * reasoning; this file is the gate. Stage 1 of
 * docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md.
 *
 * Five things are asserted, in the order they matter:
 *
 * 1. **Nothing under `src/` is refused.** A refusal is a read the sweep cannot
 *    name, and one of those is the whole failure mode.
 * 2. **The sweep opened exactly the files that are there**, compared against an
 *    independently built list rather than a threshold. A count above 400 cannot
 *    notice one file out of 532 going missing, which is how a read inside a
 *    hidden directory escaped an earlier draft.
 * 3. **Every pinned region is present, unambiguous and unchanged.** A pin is
 *    where the tree does something the two literal shapes cannot express; its
 *    checksum is over the normalised AST, so the claim is *the bytes inside are
 *    the bytes somebody read*.
 * 4. **The named constants still equal the literals beside them**, derived from
 *    the modules' real exports rather than a hand-kept list.
 * 5. **Every attack goes red, through the real file-selection path.** The first
 *    attempt's fixtures called the per-file sweep directly, so when the file
 *    gate was what had the bug they stayed green over it. `sweepEnvReads` is the
 *    only exported way in, and the controls are given a directory exactly as
 *    `src/` is.
 *
 * The controls live in a temp directory rather than tests/fixtures/ for one
 * reason that is not tidiness: one of them must not parse, and an unparseable
 * `.ts` inside the repo is a red typecheck and a red biome, neither of which is
 * this gate speaking.
 *
 * The inventory itself — every collected name accounted for in `EXPECTED` or a
 * written allowlist — is Stage 2 and is not asserted here.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checksumOfPin,
  declaredPins,
  type EnvSweep,
  type Refusal,
  SOURCE_EXTENSION,
  sweepEnvReads,
} from "./helpers/env-reads.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(REPO_ROOT, "src");

const ACCEPTED =
  "The only accepted shapes are `process.env.NAME` and `import.meta.env.NAME`, both members " +
  "non-computed and NAME a plain identifier. Anything else is refused rather than guessed — " +
  "docs/plans/260908a-design-prompt-sol.md § 3.";

function describeRefusals(refusals: Refusal[]): string {
  return refusals
    .map((r) => `  ${r.file}:${r.line}  [${r.shape}]\n    ${r.source}\n    ${r.why}`)
    .join("\n");
}

describe("every environment read under src/ is literal", () => {
  let sweep: EnvSweep;
  beforeAll(async () => {
    sweep = await sweepEnvReads(SRC);
  }, 60_000);

  it("refuses nothing", () => {
    if (sweep.refusals.length === 0) return;
    throw new Error(
      `${sweep.refusals.length} environment read(s) under src/ that this sweep cannot name:\n` +
        `${describeRefusals(sweep.refusals)}\n\n${ACCEPTED}`,
    );
  });

  /* An independent enumeration, by a different API than the sweep's own
     recursion. Set equality, so a directory the sweep never descended into is
     red rather than invisible — docs/reusable/silent-success.md.

     **The extension set comes from the helper on purpose.** Both sides used to
     spell `/\.tsx?$/` separately, which is worse than sharing: they agreed
     while both omitting `.mts` and `.cts`, and an independent enumeration that
     shares a bug with the thing it checks is not independent. What is
     independent here is the traversal, which is the part that was broken. */
  it("opened exactly the files that are under src/, hidden directories included", () => {
    const expected = readdirSync(SRC, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && SOURCE_EXTENSION.test(e.name))
      .map((e) => path.relative(REPO_ROOT, path.join(e.parentPath, e.name)))
      .sort();
    expect(expected.length).toBeGreaterThan(400);
    expect(sweep.filesParsed).toEqual(expected);
  });

  it("found the names that are certainly there", () => {
    for (const name of [
      "DATABASE_URL",
      "OPENROUTER_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      /* Off the sanitiser's globalThis-guarded alias, declared by its pin — in
         no inventory door until GPT Sol found it, and the reason a pin declares
         its names rather than being excused from having any. */
      "SPIDERYARN_ORIGINS",
      /* From MODEL_ENV_VAR's real runtime values, not from its source. */
      "SPIDERYARN_CHAT_MODEL",
      /* Read literally at the boundary of src/env.ts since this stage; before
         it, it appeared only as `env[PINNED]` two hops inside an injected
         environment, and no inventory could see it. */
      "SPIDERYARN_ENV_PINNED",
    ]) {
      expect(sweep.uniqueNames, `${name} should have been collected`).toContain(name);
    }
  });

  describe("the pinned regions", () => {
    it("are all present, unambiguous and unchanged", () => {
      for (const report of sweep.pins) {
        expect(report.found, `${report.file} ${report.kind} ${report.name}`).toBe(1);
        expect(report.matched, `${report.file} ${report.kind} ${report.name}`).toBe(true);
      }
    });

    /**
     * **The roster, written out here rather than derived from the thing it
     * checks.**
     *
     * `sweep.pins` and `declaredPins()` both come from `PINS`, so comparing them
     * was comparing a list with itself: deleting a row removed it from *both*
     * sides and the assertion stayed green — while the alias-based environment
     * operations that row was covering trigger no flat refusal. Sol, round 2.
     * A row vanishing from the helper must be red, so the expectation lives in
     * this file and nowhere else.
     */
    it("are exactly the regions this test expects, so a deleted row is red", () => {
      /* Sorted, because the comparison is ordered: `variable` sorts after
         `function`. */
      const ROSTER = [
        "src/env.ts function applyEnvFile →",
        "src/env.ts function envProdCandidates →",
        "src/env.ts function loadEnvLocal →",
        "src/env.ts function resolveTargetUrl → DATABASE_URL",
        "src/env.ts function withoutGitVars →",
        "src/env.ts variable INHERITED →",
        "src/jsdom-lazy.ts function jsdom →",
        "src/jsdom-lazy.ts import node:module →",
        "src/jsdom-lazy.ts variable nodeRequire →",
        "src/models.ts function resolveModel →",
        "src/sanitize-policy.ts function ownOrigins → SPIDERYARN_ORIGINS, VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL",
        "src/vercel-health.ts function value →",
      ];
      const actual = declaredPins()
        .map((p) => {
          const yields = [...p.yields].sort().join(", ");
          return `${p.file} ${p.kind} ${p.name} →${yields ? ` ${yields}` : ""}`;
        })
        .sort();
      expect(actual).toEqual(ROSTER);
      /* And every one of them was actually reached by the sweep — a pin whose
         file never got opened is a guarantee nobody is holding. */
      expect(sweep.pins.map((p) => `${p.file} ${p.kind} ${p.name}`).sort()).toEqual(
        ROSTER.map((r) => r.slice(0, r.indexOf(" →"))),
      );
    });

    it("declare the names their regions yield", () => {
      const yields = (file: string, name: string) =>
        sweep.pins.find((p) => p.file === file && p.name === name)?.yields ?? null;
      /* This module is a defence (docs/project/security-map.md). A fourth name
         appearing in it is somebody changing a defence, and it must reach the
         inventory rather than hide behind the pin. */
      expect([...(yields("src/sanitize-policy.ts", "ownOrigins") ?? [])].sort()).toEqual([
        "SPIDERYARN_ORIGINS",
        "VERCEL_PROJECT_PRODUCTION_URL",
        "VERCEL_URL",
      ]);
      expect(yields("src/env.ts", "resolveTargetUrl")).toEqual(["DATABASE_URL"]);
      expect(yields("src/vercel-health.ts", "value")).toEqual([]);
    });

    it("leave src/models.ts's thirteen overrides to MODEL_ENV_VAR's runtime values", () => {
      /* A different soundness question from the pin: the pin says `resolveModel`
         still indexes that record, this says what the record contains. */
      const fromRecord = sweep.names.filter((n) => n.file === "src/models.ts" && n.door === "pin");
      expect(fromRecord).toHaveLength(13);
      for (const n of fromRecord) expect(n.name).toMatch(/^SPIDERYARN_[A-Z_]+_MODEL$/);
    });
  });

  /**
   * **The constants that duplicate a literal read**, discovered rather than
   * listed.
   *
   * Making the reads literal did not delete the `*_ENV` constants: tests and
   * evals import them to *set* the variable. So each is a second spelling of a
   * name written a few lines away, and if the two diverged `evals/deepen/run.ts`
   * would set one variable while the code read another, in silence.
   *
   * The set is derived from each module's **real exports** rather than typed out
   * here, so a fifth constant joins on its own. What this asserts, exactly — a
   * smaller claim than the earlier hand-kept version made, and a true one: every
   * exported string constant whose value is a name read literally somewhere in
   * the same file is listed below with that value. It does not prove the
   * particular function paired with the constant is the one that reads it.
   */
  it("every exported constant that duplicates a literal read is named here", async () => {
    const EXPECTED: Record<string, string> = {
      DEEPEN_ENV: "SPIDERYARN_DEEPEN_HIERARCHY",
      REASK_ENV: "SPIDERYARN_DEEPEN_REASK",
      DEEPEN_RECORDS_ENV: "SPIDERYARN_DEEPEN_RECORDS",
      PINNED: "SPIDERYARN_ENV_PINNED",
    };
    const modules = [
      { file: "src/hierarchy-deepen.ts", mod: await import("../src/hierarchy-deepen.js") },
      { file: "src/env.ts", mod: await import("../src/env.js") },
    ];
    const found: Record<string, string> = {};
    for (const { file, mod } of modules) {
      const readHere = new Set(sweep.names.filter((n) => n.file === file).map((n) => n.name));
      for (const [key, value] of Object.entries(mod as Record<string, unknown>)) {
        if (typeof value === "string" && readHere.has(value)) found[key] = value;
      }
    }
    expect(found).toEqual(EXPECTED);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   The checksum, on its own.

   These are unit controls on `checksumOfPin` rather than file-selection
   controls, and they are the evidence for the pin design: every bypass Sol
   found against the previous approximate-scope contracts was a change to a
   function body, and every one of those changes the checksum. The first case is
   the other half — a pin nobody can maintain is a pin somebody deletes.
   ──────────────────────────────────────────────────────────────────────────── */

const PIN_BASE = "function f() {\n  const env = globalThis.process.env;\n  return [env.A, env.B];\n}\n";

describe("a pin's checksum", () => {
  const base = checksumOfPin(PIN_BASE, "function", "f");

  it("survives whitespace, comments, quote style and a trailing comma", () => {
    const laidOutDifferently =
      "function f(){ /* a comment nobody should have to keep */\n\n" +
      "      const env = globalThis.process.env\n  return [ env.A , env.B, ] }\n";
    expect(checksumOfPin(laidOutDifferently, "function", "f")).toBe(base);
  });

  /* Sol's bypass of the old `applyEnvFile` contract: shadow the loop's `name` in
     an inner block. Approximate scope analysis could not see it; a checksum
     does not have to. */
  it("changes when an inner binding is shadowed", () => {
    const shadowed =
      "function f() {\n  const env = globalThis.process.env;\n" +
      '  { const name = "x"; void name; }\n  return [env.A, env.B];\n}\n';
    expect(checksumOfPin(shadowed, "function", "f")).not.toBe(base);
  });

  /* Sol's bypass of the old sanitiser contract: read a fourth name from a nested
     closure, which the enclosing-function test excluded. */
  it("changes when a nested closure reads another name", () => {
    const closure =
      "function f() {\n  const env = globalThis.process.env;\n" +
      "  const g = () => env.HIDDEN_SANITIZER;\n  return [env.A, env.B, g()];\n}\n";
    expect(checksumOfPin(closure, "function", "f")).not.toBe(base);
  });

  it("is null when the region is missing, so a pin cannot match nothing", () => {
    expect(checksumOfPin(PIN_BASE, "function", "notThere")).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   The controls.

   Every one is a spelling somebody could reach for. They are swept as a
   *directory*, through `sweepEnvReads` — the same entry point the assertions
   above use — and there is no exported way to reach the per-file sweep, so a bug
   in file selection fails these too.
   ──────────────────────────────────────────────────────────────────────────── */

/** filename → source. A name containing `/` is written at that relative path. */
const CONTROLS: Record<string, string> = {
  "global-alias.ts": "const p = globalThis.process;\nconst x = p.env.NEW_FROM_GLOBAL;\n",
  "import-alias.ts": 'import proc from "node:process";\nproc.env.MISSED_IMPORT_ALIAS;\n',
  /* The families Sol demonstrated on 2026-09-08, each of which returned
     `names: []` and `refusals: []` from the previous recogniser. */
  "computed-global.ts": 'export const a = globalThis["process"].env.SEVENTEENTH;\n',
  "builtin-module.ts":
    'const p = process.getBuiltinModule("node:process");\nexport const b = p.env.EIGHTEENTH;\n',
  "reexport-bridge.ts": 'export { env as bridged } from "node:process";\n',
  "reexport-all.ts": 'export * from "node:process";\n',
  "reflect-get.ts": 'export const c = Reflect.get(process, "env").REFLECTED;\n',
  /* Sol's twentieth spelling: an ObjectPattern's properties are ObjectProperty
     nodes, so a key named `process` was treated as inert. */
  "destructured-key.ts":
    "const { process: p } = globalThis;\nexport const twentieth = p.env.TWENTIETH;\n",
  /* A package that re-exports the real process.env under a name with no
     `process` in it. `std-env` is in this installed tree and does exactly this.
     The rule keys on the *imported* name, not the local alias. */
  "package-bridge.ts":
    'import { env as bridged } from "std-env";\nexport const packageBridge = bridged.TWENTY_FIRST;\n',
  /* Valid TypeScript that both enumerators used to miss. Both extensions, so a
     future pattern that accepted one and dropped the other cannot stay green. */
  "omitted-extension.mts": "export const omitted = process.env.OMITTED_MTS;\n",
  "omitted-extension.cts": "export const omittedCjs = process.env.OMITTED_CTS;\n",
  /* `nodeRequire` used in a function nobody pinned, with a specifier that is
     **not** a forbidden string — so the only thing that can refuse this is the
     require-identifier rule itself. `loader-alias.ts` above is red for naming
     "node:process", which would have kept the suite green if `nodeRequire` were
     dropped from REQUIRE_NAMES. */
  "unpinned-loader.ts": 'export const escaped = nodeRequire("some-pkg").env.LOADER_ESCAPE;\n',
  /* The twin of the `{ process: p }` narrowing: an ObjectPattern's properties
     are ObjectProperty nodes, so a destructured `createRequire` was inert too. */
  "destructured-create-require.ts":
    "export async function f() {\n" +
    '  const { createRequire: cr } = await import("node:module");\n' +
    "  return cr;\n" +
    "}\n",
  /* **Deliberately green — this is the boundary, written as an assertion.**
     See the `it` below; the reasoning is there. */
  "package-bridge-boundary.ts":
    'import { anything } from "some-pkg";\nexport const viaPackage = anything.TWENTY_SECOND;\n',
  /* Sol's bridge attack, one level up: a module the sweep never opens can
     re-export the process object under an innocent name. `src/` imports nothing
     outward today — but that was an assumption until the rule existed, and
     turning an assumption into a check is what this plan is for. */
  "outward-import.ts": 'export { bridged } from "../outside/bridge.js";\n',
  /* And the other half: a relative import that stays inside is ordinary. */
  "inward-import.ts": 'export { ok } from "./sibling.js";\n',
  /* `@/` is this repo's own alias for `src/web`, not a package — so an outward
     bridge written through it is in scope and must be refused, while an ordinary
     `@/` import must not be. Both directions, because closing the first by
     refusing the prefix outright would break thirteen real imports. */
  "alias-outward.ts":
    'import { bridged } from "@/../../scripts/env-bridge.js";\n' +
    "export const hidden = bridged.VITE_HIDDEN;\n",
  "alias-inward.ts": 'import { Thing } from "@/components/ui/button.js";\nexport const t = Thing;\n',
  /* Vite root-absolute and `/@fs/`, both of which reach repo-written code. They
     are here as instances; what actually closes them is that the rule is now
     refuse-by-default, so a form nobody listed fails closed too. */
  "root-absolute.ts":
    'import { bridged } from "/scripts/env-bridge.js";\nexport const viaRoot = bridged.ROOT_ABS;\n',
  "fs-absolute.ts":
    'import { bridged } from "/@fs/tmp/env-bridge.js";\nexport const viaFs = bridged.FS_ABS;\n',
  "file-url.ts":
    'import { bridged } from "file:///tmp/env-bridge.js";\nexport const viaFile = bridged.FILE_URL;\n',
  /* Repeated slashes after the alias: Vite resolves this inside `src/web`, so a
     naive slice reading `/components/…` as filesystem-absolute would refuse a
     legitimate import. Nothing writes it today; that is why it is a landmine. */
  "alias-double-slash.ts":
    'import { Thing } from "@//components/ui/button.js";\nexport const t2 = Thing;\n',
  "alias-double-slash-outward.ts":
    'import { bridged } from "@//../../scripts/env-bridge.js";\n' +
    "export const hidden2 = bridged.VITE_HIDDEN_2;\n",
  /* A scoped package must not be mistaken for the `@/` alias — ten scoped
     imports under src/ depend on the grammar telling them apart. */
  "scoped-package.ts":
    'import { thing } from "@scope/pkg/sub.js";\nexport const scoped = thing.SCOPED_PKG;\n',
  /* A package subpath that climbs out. Refused not because we know it resolves
     to repo code, but because knowing it does *not* would mean knowing npm's and
     Vite's resolver internals — a claim about somebody else's behaviour rather
     than a syntactic fact. Nothing in the tree writes this. */
  "package-subpath-traversal.ts":
    'import { bridged } from "pkg/../../scripts/env-bridge.js";\n' +
    "export const viaSubpath = bridged.SUBPATH_TRAVERSAL;\n",
  /* A require function reached through an alias the sweep does not follow. It is
     refused for naming the module as text, not for the alias. */
  "loader-alias.ts":
    "declare const nodeRequire: (s: string) => { env: Record<string, string> };\n" +
    'const r = nodeRequire;\nexport const d = r("node:process").env.HIDDEN_JSDOM;\n',
  "dynamic-import.ts":
    "export async function f() {\n" +
    '  const p = await import("node:process");\n' +
    "  return p.env.MISSED_DYNAMIC;\n" +
    "}\n",
  "require-call.ts": 'const p = require("process");\np.env.MISSED_REQUIRE;\n',
  "created-require.ts":
    'import { createRequire } from "node:module";\n' +
    "const nodeRequire = createRequire(import.meta.url);\n" +
    'const p = nodeRequire("jsdom");\nvoid p;\n',
  "unnameable-import.ts": "export function f(spec: string) {\n  return import(spec);\n}\n",
  "late-bind.ts":
    'import { createRequire } from "node:module";\n' +
    "let r;\n" +
    "r = createRequire(import.meta.url);\n" +
    "void r;\n",
  /* F17: counted, not skipped, because there is no read-versus-write classifier
     to get wrong. */
  "compound-or.ts": 'process.env.NEW_COMPOUND ||= "fallback";\n',
  "compound-update.ts": "process.env.NEW_UPDATE++;\n",
  "optional-root.ts": "process?.env.OPTIONAL_ROOT;\n",
  "destructured.ts": "const { env } = process;\nenv.DESTRUCTURED;\n",
  "meta-computed.ts": "const key = 1;\nconst v = import.meta.env[key];\n",
  "escaping-local.ts":
    "export function wrapper() {\n" +
    "  function consume(e: Record<string, string | undefined>) {\n" +
    "    return e.MISSED_LOCAL;\n" +
    "  }\n" +
    "  return consume(process.env);\n" +
    "}\n",
  /* Not a read at all, and it must stay green: `new.target` is a MetaProperty
     like `import.meta`, so the recogniser keys on `meta.name`, not node type. */
  "new-target.ts": "function F() {\n  return new.target.env.NOT_AN_ENV;\n}\n",
  /* parseSource has errorRecovery:true, so this comes back looking clean unless
     `errors` is read. Refused, never skipped. */
  "does-not-parse.ts": "export function broken( {{{ = = ;\n",
  /* Must be **found**, not refused: a hidden directory is still source, and a
     visible module can import it. This one escaped the sweep entirely until
     2026-09-08. */
  ".hidden/read.ts": "export const h = process.env.HIDDEN_DIRECTORY_NAME;\n",
};

/**
 * The cases that must be green: not a read, or a read the sweep must collect.
 *
 * `created-require.ts` and `late-bind.ts` used to be in here, which meant
 * nothing asserted anything about them at all — they were neither required to
 * be red nor required to be green. Both name `createRequire`, so both are
 * refusals, and they are now asserted as such.
 */
const MUST_BE_GREEN = new Set([
  "new-target.ts",
  "compound-or.ts",
  "compound-update.ts",
  ".hidden/read.ts",
  "inward-import.ts",
  "alias-inward.ts",
  "alias-double-slash.ts",
  "scoped-package.ts",
  "omitted-extension.mts",
  "omitted-extension.cts",
  "package-bridge-boundary.ts",
]);

/**
 * **The rule each must-refuse control exists to prove — mandatory, not
 * optional.**
 *
 * A fixture that goes red for an unrelated reason leaves the rule it is supposed
 * to prove free to be deleted: `loader-alias.ts` was red only because it names
 * `"node:process"`, so dropping `nodeRequire` from the recogniser kept the suite
 * green. Declaring the shape fixes that fixture — but while the table was
 * *optional*, a sixth control could simply omit its row and reintroduce the
 * defect, which made the claim broader than the mechanism.
 *
 * So a must-refuse control with no row here is itself a failure, asserted below.
 * Every entry is a shape from `Shape` in tests/helpers/env-reads.ts.
 */
const REFUSED_BY: Record<string, string> = {
  "global-alias.ts": "process-property",
  "import-alias.ts": "module-specifier",
  "computed-global.ts": "computed-global",
  "builtin-module.ts": "process-api",
  "reexport-bridge.ts": "module-specifier",
  "reexport-all.ts": "module-specifier",
  "reflect-get.ts": "forbidden-string",
  "destructured-key.ts": "process-alias",
  "package-bridge.ts": "module-specifier",
  "loader-alias.ts": "forbidden-string",
  "outward-import.ts": "outward-import",
  "alias-outward.ts": "outward-import",
  "alias-double-slash-outward.ts": "outward-import",
  "root-absolute.ts": "outward-import",
  "fs-absolute.ts": "outward-import",
  "file-url.ts": "outward-import",
  "package-subpath-traversal.ts": "outward-import",
  "dynamic-import.ts": "module-specifier",
  "require-call.ts": "require-identifier",
  "created-require.ts": "require-identifier",
  "late-bind.ts": "require-identifier",
  "unpinned-loader.ts": "require-identifier",
  "destructured-create-require.ts": "require-identifier",
  "unnameable-import.ts": "module-specifier",
  "optional-root.ts": "process-optional",
  "destructured.ts": "process-alias",
  "meta-computed.ts": "import.meta.env[computed]",
  "escaping-local.ts": "process.env-whole",
  "does-not-parse.ts": "parse-error",
};

describe("the controls, entered through the same file-selection path as src/", () => {
  let dir: string;
  let sweep: EnvSweep;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "env-reads-controls-"));
    mkdirSync(path.join(dir, "nested"), { recursive: true });
    for (const [name, source] of Object.entries(CONTROLS)) {
      /* Some one level down and one in a hidden directory, so a walk that
         stopped descending fails these rather than passing them. */
      const rel = name.includes("/")
        ? name
        : path.join(name.charCodeAt(0) % 2 === 0 ? "nested" : ".", name);
      const at = path.join(dir, rel);
      mkdirSync(path.dirname(at), { recursive: true });
      writeFileSync(at, source, "utf8");
    }
    sweep = await sweepEnvReads(dir);
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("read every control file", () => {
    /* The harness's own positive control: if the walk found nothing, every
       "must be refused" case would pass over an empty answer. */
    expect(sweep.filesParsed).toHaveLength(Object.keys(CONTROLS).length);
  });

  for (const name of Object.keys(CONTROLS).filter((n) => !MUST_BE_GREEN.has(n))) {
    it(`refuses ${name}`, () => {
      const hit = sweep.refusals.filter((r) => r.file.endsWith(name));
      if (hit.length === 0) {
        throw new Error(
          `${name} was not refused. Its source is\n\n${CONTROLS[name]}\n${ACCEPTED}\n` +
            "A spelling this sweep neither counts nor refuses is a variable nobody will ever " +
            "inventory — docs/reusable/silent-success.md.",
        );
      }
      const expected = REFUSED_BY[name];
      expect(
        hit.map((r) => r.shape),
        `${name} must be refused by the rule it exists to prove, not by an unrelated one`,
      ).toContain(expected);
    });
  }

  it("declares the expected shape for every control that must be refused", () => {
    /* The table is mandatory rather than optional: without this, a new
       must-refuse control could omit its row and go green for an unrelated
       reason, which is the defect the table exists to fix. */
    const mustRefuse = Object.keys(CONTROLS).filter((n) => !MUST_BE_GREEN.has(n));
    expect(Object.keys(REFUSED_BY).sort()).toEqual(mustRefuse.sort());
  });

  /* F17 both ways round. The assertion is *collection*, not refusal: "counted
     wherever it occurs, regardless of position" is the property. */
  for (const [name, collected] of [
    ["compound-or.ts", "NEW_COMPOUND"],
    ["compound-update.ts", "NEW_UPDATE"],
    [".hidden/read.ts", "HIDDEN_DIRECTORY_NAME"],
    /* Both executable TypeScript the project config includes; a sweep that
       cannot see the file cannot see the read. Both, so a future pattern that
       accepted one and dropped the other cannot stay green. */
    ["omitted-extension.mts", "OMITTED_MTS"],
    ["omitted-extension.cts", "OMITTED_CTS"],
  ] as const) {
    it(`collects ${collected} from ${name}`, () => {
      expect(sweep.uniqueNames).toContain(collected);
      expect(sweep.refusals.filter((r) => r.file.endsWith(name))).toEqual([]);
    });
  }

  it("lets a relative import that stays inside the tree through", () => {
    /* The boundary rule has to be a boundary, not a ban on relative imports —
       src/ is ~532 files importing each other. */
    expect(sweep.refusals.filter((r) => r.file.endsWith("inward-import.ts"))).toEqual([]);
  });

  it("lets an ordinary @/ import through — thirteen real ones depend on it", () => {
    /* The other half of the alias rule. Refusing the `@/` prefix outright would
       close the outward bridge and take every shadcn component import with it. */
    expect(sweep.refusals.filter((r) => r.file.endsWith("alias-inward.ts"))).toEqual([]);
  });

  /**
   * **The boundary, as a control rather than a paragraph. This one is meant to
   * be green, and if you are here because you just made it red, read this
   * first.**
   *
   * A package can hand back the real environment under a name with no `process`
   * in it, and nothing here resolves a package: `import { env } from "std-env"`
   * is the demonstrated case. The three-line rule above refuses a binding whose
   * *imported* name is `env`, which closes that one spelling — so this control
   * deliberately imports a name that is **not** `env`, to demonstrate the
   * boundary itself rather than the exception to it.
   *
   * **Why this is a limit and not a hole.** It is the same class the postmortem
   * excluded on the day it was written:
   * docs/postmortems/260827b-health-check-green-while-uploads-dead.md has
   * `ANTHROPIC_API_KEY` in `EXPECTED` while nothing under `src/` reads it by
   * name, because the SDK takes it from the environment itself. A package bridge
   * is that, with the last hop lexically inside `src/`. And Sol's own design
   * answer named "an imported module" among the things a finite AST recogniser
   * cannot cover, before any of this was built.
   *
   * **Why it is acceptable rather than merely admitted.** Crossing it costs one
   * reviewed line. A declared bridge is a `package.json` diff. An undeclared one
   * is an unlisted import that knip reports in `npm run check` — advisory rather
   * than a gate, but visible. `std-env` itself is not a dependency of this
   * project at all: it is a transitive dev dependency of vitest, hoisted into
   * `node_modules`. Either way the crossing is one line somebody reads, not a
   * change hidden among 532 files.
   *
   * So: if you close this hole, come here and flip this control. A limit written
   * in a comment decays into folklore; a limit written as an assertion cannot.
   */
  it("does not see a package bridge — the stated boundary, and it is green on purpose", () => {
    const file = "package-bridge-boundary.ts";
    expect(sweep.filesParsed.some((f) => f.endsWith(file))).toBe(true);
    expect(sweep.refusals.filter((r) => r.file.endsWith(file))).toEqual([]);
    expect(sweep.uniqueNames).not.toContain("TWENTY_SECOND");
  });

  it("leaves new.target.env alone — it contains neither door", () => {
    expect(sweep.refusals.filter((r) => r.file.endsWith("new-target.ts"))).toEqual([]);
    expect(sweep.uniqueNames).not.toContain("NOT_AN_ENV");
  });

  it("claims no pin, because none of these files is one", () => {
    /* Pins are keyed on repo-relative paths under src/, so a fixture can never
       be absorbed by one. Asserted rather than assumed: a pin keyed on a
       basename would quietly cover a control. */
    expect(sweep.pins).toEqual([]);
  });
});
