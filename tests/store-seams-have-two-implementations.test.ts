/**
 * **A store seam must not be able to arrive with only one side — and a seam that
 * deliberately has one side has to say so somewhere a test reads.**
 *
 * `notMigrated` is a deliberate, loud, *runtime* refusal, and a refusal nothing
 * ever calls is silent. `SPIDERYARN_STORE` unset means `files`
 * (src/store/live.ts), so every test, every local run and every browser pass
 * exercises the configuration that is not deployed, and a seam with no Postgres
 * implementation looks exactly like a seam that works. That is how Claims
 * shipped on 2026-08-31 filesystem-only and answered 501 in production for four
 * hours with the whole suite green.
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md
 * asks for exactly this test:
 *
 * > A test that enumerates the store seams and asserts each has two
 * > implementations, derived from the contract rather than from a list somebody
 * > maintains — the same move `tests/store-export-covers-tables.test.ts` makes
 * > for tables, which was written the day before this and would have caught this
 * > if it had been pointed at stores instead of tables.
 *
 * ## Derived, never listed — twice over
 *
 * `tests/store-export-covers-tables.test.ts` § the header has the argument, and
 * it is the same one: a second hand-written list beside the data is the thing
 * this file exists to make impossible (docs/reusable/silent-success.md § "Never
 * write a 'should I emit this?' condition as a second list beside the data").
 *
 * So **the seams come from `src/store/contracts.ts`** — every exported interface
 * — and **the implementations come from the source of `src/store/`**: every
 * module-level `export const <name>: <Contract>` whose name begins `fs` or `pg`.
 * Neither list is written down anywhere. An interface that nothing implements is
 * a data shape (`RawSource`, `SweepOptions`, `Turn`) and is not a seam; that is
 * why "is it implemented" is the test rather than a naming rule.
 *
 * A selector is not an implementation, and the `fs`/`pg` prefix is what tells
 * them apart: `export const commentStore: CommentStore = guarded(…)` in
 * index.ts is the *choice* between two implementations, and counting it as one
 * would make every seam look complete by construction.
 *
 * ## Why a parser and not a regular expression
 *
 * tests/helpers/ts-ast.ts § the header: both of this repo's earlier source scans
 * were wrong in both directions, and the direction that matters is a scan that
 * quietly stops matching. A gate that goes quiet is worse than one that goes red.
 *
 * ## The hard part: `notMigrated` is sometimes right
 *
 * `AdminStore`, `VisibilityStore` and `FeedbackStore` have a Postgres
 * implementation and a filesystem **refusal**, deliberately and permanently —
 * there is no user list, no visibility column and no feedback table on a
 * filesystem. Those are correct and must not be flagged. What must be flagged is
 * the other direction, and the undeclared case.
 *
 * `SEAM_ASYMMETRIES` in src/store/live.ts is where a one-sided seam declares
 * itself, and its type is what makes the two directions different things: a
 * missing **files** side needs a reason, and a missing **postgres** side needs a
 * reason *and* one plain sentence saying what a reader cannot do on the deployed
 * app. That sentence is the check. Nobody would have written it about *"Pull the
 * paper's claims"* and shipped.
 *
 * **No database, no network, no imports of the stores themselves** — this reads
 * the source. So it runs everywhere, always, which for a gate about a
 * configuration nobody exercises is the point.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SEAM_ASYMMETRIES } from "../src/store/live.js";
import { type AstNode, parseSource, walkAst } from "./helpers/ts-ast.js";

const STORE_DIR = path.resolve(import.meta.dirname, "..", "src", "store");
const CONTRACTS = path.join(STORE_DIR, "contracts.ts");

/** Which store an implementation belongs to, by the prefix it is named with. */
type Side = "files" | "postgres";

/** One implementation found in the source: `pgCommentStore`, in `pg-comments.ts`. */
interface Implementation {
  readonly name: string;
  readonly file: string;
  readonly side: Side;
  /** True if its body calls `notMigrated` — a refusal wearing a store's name. */
  readonly refuses: boolean;
}

/* ------------------------------------------------------------- the parsing -- */

/**
 * The interface a `const` is annotated with, unwrapping the type operators that
 * still name one seam.
 *
 * `Pick<ArticleReader, …>` is how `pgArticleReader` and `fsGlossaryStore` are
 * both declared, and reading those as "no contract" would drop two real seams —
 * including `GlossaryStore`, which is the one live example of the direction this
 * file exists to flag.
 */
function contractOf(annotation: unknown): string | undefined {
  const node = annotation as AstNode | undefined;
  if (!node || typeof node.type !== "string") return undefined;
  if (node.type === "TSTypeAnnotation") return contractOf(node.typeAnnotation);
  if (node.type !== "TSTypeReference") return undefined;
  const typeName = node.typeName as AstNode | undefined;
  if (typeName?.type !== "Identifier") return undefined;
  const name = typeName.name as string;
  const wrappers = new Set(["Pick", "Omit", "Readonly", "Partial", "Required"]);
  if (!wrappers.has(name)) return name;
  const params = (node.typeParameters as AstNode | undefined)?.params;
  return Array.isArray(params) ? contractOf(params[0]) : undefined;
}

/** Every exported `interface` in `contracts.ts` — the candidate seams. */
async function contractInterfaces(): Promise<string[]> {
  const ast = parseSource(await readFile(CONTRACTS, "utf8"));
  const names: string[] = [];
  walkAst(ast, (node) => {
    if (node.type !== "ExportNamedDeclaration") return;
    const declaration = node.declaration as AstNode | undefined;
    if (declaration?.type !== "TSInterfaceDeclaration") return;
    const id = declaration.id as AstNode | undefined;
    if (id?.type === "Identifier") names.push(id.name as string);
  });
  return names;
}

/** Does this subtree call `notMigrated`? */
function callsNotMigrated(node: unknown): boolean {
  let found = false;
  walkAst(node, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = n.callee as AstNode | undefined;
    if (callee?.type === "Identifier" && callee.name === "notMigrated") found = true;
  });
  return found;
}

/** Every `.ts` file under `src/store/`, recursively. */
async function storeSources(dir = STORE_DIR): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await storeSources(at)));
    else if (entry.name.endsWith(".ts")) out.push(at);
  }
  return out.sort();
}

/**
 * Which store a name belongs to — `fs`/`pg` and then a capital.
 *
 * The capital matters: without it `pgReady` and a hypothetical `fsync` are
 * implementations. And a **selector** is named for the thing rather than for a
 * store (`commentStore`, `refereeClaimsStore`), so this is also what keeps
 * `src/store/index.ts` out of the count.
 */
function sideOf(name: string): Side | undefined {
  if (/^fs[A-Z]/.test(name)) return "files";
  if (/^pg[A-Z]/.test(name)) return "postgres";
  return undefined;
}

/** One `export const name: Contract = …`, if that is what this declarator is. */
function asImplementation(raw: AstNode, file: string): [string, Implementation] | undefined {
  const id = raw.id as AstNode | undefined;
  if (id?.type !== "Identifier") return undefined;
  const name = id.name as string;
  const side = sideOf(name);
  if (!side) return undefined;
  const contract = contractOf(id.typeAnnotation);
  if (!contract) return undefined;
  return [
    contract,
    {
      name,
      file: path.relative(path.resolve(STORE_DIR, "..", ".."), file),
      side,
      refuses: callsNotMigrated(raw.init),
    },
  ];
}

/** Every store implementation in `src/store/`, by the contract it is annotated with. */
async function implementations(): Promise<Map<string, Implementation[]>> {
  const found = new Map<string, Implementation[]>();
  for (const file of await storeSources()) {
    const ast = parseSource(await readFile(file, "utf8"));
    walkAst(ast, (node) => {
      if (node.type !== "ExportNamedDeclaration") return;
      const declaration = node.declaration as AstNode | undefined;
      if (declaration?.type !== "VariableDeclaration") return;
      for (const raw of (declaration.declarations as AstNode[]) ?? []) {
        const one = asImplementation(raw, file);
        if (!one) continue;
        const [contract, impl] = one;
        found.set(contract, [...(found.get(contract) ?? []), impl]);
      }
    });
  }
  return found;
}

/** The seams: every contract something implements, and what implements it. */
async function seams(): Promise<Map<string, Implementation[]>> {
  const impls = await implementations();
  const contracts = new Set(await contractInterfaces());
  return new Map([...impls].filter(([name]) => contracts.has(name)).sort());
}

const SEAMS = await seams();
const SIDES: readonly Side[] = ["files", "postgres"];

const sideNames = (impls: Implementation[], side: Side) =>
  impls.filter((i) => i.side === side).map((i) => i.name);

/* --------------------------------------------------------- the seams exist -- */

describe("the store seams are found by reading the contract, not a list", () => {
  it("finds seams at all, and the ones everybody knows", () => {
    /* **The collector's own alarm**, and it is the assertion the rest of the
       file rests on. A `parseSource` that stopped recognising this syntax, an
       import that resolved to nothing, or a rename of the `fs`/`pg` convention
       would leave `SEAMS` empty — and every assertion about the contents of an
       empty map passes forever while checking nothing.
       docs/reusable/silent-success.md. */
    expect([...SEAMS.keys()].length).toBeGreaterThan(8);
    expect([...SEAMS.keys()]).toContain("CommentStore");
    expect([...SEAMS.keys()]).toContain("RefereeCriteriaStore");
    expect([...SEAMS.keys()]).toContain("RefereeClaimsStore");
  });

  it("counts a store declared through Pick<…>, so a partial adapter cannot hide", () => {
    /* The alarm for the *unwrapping* specifically. Everything above is satisfied
       by the plain `: CommentStore` case alone, so without this the unwrapping
       could break and the list would silently shrink to "the stores annotated
       without a type operator" while staying green — and it would lose
       `GlossaryStore`, the one seam in this repo that is actually missing its
       Postgres side. */
    const glossary = SEAMS.get("GlossaryStore") ?? [];
    expect(glossary.map((i) => i.name)).toContain("fsGlossaryStore");
    const reader = SEAMS.get("ArticleReader") ?? [];
    expect(reader.map((i) => i.name)).toContain("pgArticleReader");
  });

  it("does not count the selector in index.ts as an implementation", () => {
    /* `export const commentStore: CommentStore = guarded(pg, fs)` is the choice
       between two implementations. Counting it as one would make every seam look
       two-sided the moment it was wired, which is precisely the state Claims was
       in when it shipped. */
    for (const impls of SEAMS.values()) {
      for (const impl of impls) {
        expect(impl.file, `${impl.name} is a selector, not an implementation`).not.toBe(
          "src/store/index.ts",
        );
      }
    }
  });
});

/* ------------------------------------------------------ both sides, or a why -- */

describe("every store seam has two implementations, or says why not", () => {
  it("has both sides wherever nothing is declared", () => {
    const wrong: string[] = [];
    for (const [contract, impls] of SEAMS) {
      const declared = SEAM_ASYMMETRIES[contract];
      for (const side of SIDES) {
        if (sideNames(impls, side).length > 0) continue;
        if (declared?.missing === side) continue;
        wrong.push(`${contract} has no ${side} implementation`);
      }
    }
    expect(
      wrong,
      `${wrong.join("; ")}.\n\n` +
        "  A seam with one side is a 501 in whichever store it is missing from, and " +
        "SPIDERYARN_STORE=postgres is what production runs — so a missing Postgres " +
        "side means the feature does not exist for anybody but a developer on a " +
        "laptop, with every test green. Either build the adapter, or declare the " +
        "asymmetry in SEAM_ASYMMETRIES (src/store/live.ts): a missing files side " +
        "needs a reason, a missing postgres side needs a reason and one sentence " +
        "naming what a reader cannot do on the deployed app.",
    ).toEqual([]);
  });

  it("has no store that is a refusal wearing an implementation's name", () => {
    /* The structural check above is satisfied by a `pgFooStore` whose every
       method is `notMigrated(…)`, which is the same 501 with a longer route to
       it. A refusal belongs in index.ts beside the selector, where it is visible
       as a refusal, and it belongs in SEAM_ASYMMETRIES besides. */
    const pretenders: string[] = [];
    for (const impls of SEAMS.values()) {
      for (const impl of impls) {
        if (impl.refuses) pretenders.push(`${impl.name} (${impl.file})`);
      }
    }
    expect(
      pretenders,
      `${pretenders.join(", ")} calls notMigrated, so it is a refusal with a store's ` +
        "name on it. Every check here would count it as an implementation. Put the " +
        "refusal in src/store/index.ts where the selector is, and declare the seam in " +
        "SEAM_ASYMMETRIES.",
    ).toEqual([]);
  });
});

/* ------------------------------------- the declarations are true, and stay true -- */

describe("a declared asymmetry has to still be one", () => {
  it("names nothing that is not a seam any more", () => {
    const stale = Object.keys(SEAM_ASYMMETRIES).filter((name) => !SEAMS.has(name));
    expect(
      stale,
      `SEAM_ASYMMETRIES names ${stale.join(", ")}, which is not a store seam in ` +
        "src/store/contracts.ts any more. Delete the entry, or fix the name.",
    ).toEqual([]);
  });

  it("goes red when the missing side gets built", () => {
    /* The self-correcting direction, and the reason the record cannot rot into a
       list of excuses: the day somebody writes `pgGlossaryStore`, this fails and
       makes them delete the entry that says the deployed app cannot do it. It is
       also what would have made the Claims entry disappear on 2026-09-01 rather
       than surviving as a stale explanation of a fixed problem. */
    const wrong: string[] = [];
    for (const [contract, declared] of Object.entries(SEAM_ASYMMETRIES)) {
      const impls = SEAMS.get(contract) ?? [];
      const built = sideNames(impls, declared.missing);
      if (built.length) {
        wrong.push(`${contract} declares no ${declared.missing} side but has ${built.join(", ")}`);
      }
    }
    expect(
      wrong,
      `${wrong.join("; ")}. The asymmetry was built away — delete the entry from ` +
        "SEAM_ASYMMETRIES in src/store/live.ts, and take the refusal out of " +
        "src/store/index.ts with it.",
    ).toEqual([]);
  });

  it("gives every asymmetry a reason written in words", () => {
    for (const [contract, declared] of Object.entries(SEAM_ASYMMETRIES)) {
      /* A reason, not a shrug — `store-export-covers-tables.test.ts`'s rule and
         its number. "not needed" is what somebody writes when they have not
         thought about it, and it is what the next reader has to re-derive. */
      expect(
        declared.why.length,
        `${contract} declares a one-sided seam and says why in too few words`,
      ).toBeGreaterThan(40);
    }
  });

  it("makes a missing Postgres side name the thing readers cannot do", () => {
    /* The asymmetry between the two directions, enforced. `postgres` is what
       deploys, so this side missing is not a design decision — it is an outage
       with a date on it, and the entry has to say what the outage is in a
       sentence somebody would be embarrassed to ship. The type already requires
       the field; this requires it to be a sentence. */
    for (const [contract, declared] of Object.entries(SEAM_ASYMMETRIES)) {
      if (declared.missing !== "postgres") continue;
      expect(
        declared.productionGap.length,
        `${contract} has no Postgres implementation, which is a 501 on the deployed ` +
          "app. Say in a sentence what a reader cannot do.",
      ).toBeGreaterThan(40);
    }
  });
});
