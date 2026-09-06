/**
 * **A store seam must not be able to arrive without a Postgres implementation.**
 *
 * `notMigrated` was a deliberate, loud, *runtime* refusal, and a refusal nothing
 * ever calls is silent. A seam with no Postgres implementation is a 501 for
 * every reader, and it looks exactly like a seam that works. That is how Claims
 * shipped on 2026-08-31 and answered 501 in production for four hours with the
 * whole suite green.
 * docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md
 * asks for exactly this test:
 *
 * > A test that enumerates the store seams and asserts each has two
 * > implementations, derived from the contract rather than from a list somebody
 * > maintains — the same move `tests/store-export-covers-tables.test.ts` makes
 * > for tables, which was written the day before this and would have caught this
 * > if it had been pointed at stores instead of tables.
 *
 * ## It asked for two until 2026-09-05, and two was never the point
 *
 * It said *two* because `SPIDERYARN_STORE` unset meant `files`, so a seam with
 * no Postgres side was exercised by every test, every local run and every
 * browser pass — in the one configuration that was not deployed. Stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * deleted the filesystem store, so that reason is gone. **The outage it guards
 * is not**, so the assertion narrowed to it rather than being deleted with the
 * store, and `SEAM_ASYMMETRIES` went: with one store there is nothing left for
 * an asymmetry to be asymmetric about, and eleven seams lost their second side
 * in a single commit. A record of exceptions grown to cover every case is a
 * second list of the seams — the thing this file exists to make impossible.
 *
 * What that map used to buy is still bought, and more cheaply. Every entry in it
 * excused a missing *files* side, so nothing that passed then fails now; and the
 * door it left open — declaring away a missing **Postgres** side, the direction
 * its own type called "a production outage with a date on it" — is shut.
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
 * module-level `export const <name>: <Contract>` whose name begins `pg`.
 * Neither list is written down anywhere. An interface that nothing implements is
 * a data shape (`RawSource`, `SweepOptions`, `Turn`) and is not a seam; that is
 * why "is it implemented" is the test rather than a naming rule.
 *
 * A selector is not an implementation, and the prefix is what tells them apart:
 * `export const commentStore: CommentStore = guarded(…)` in index.ts is the
 * wrapper around one, and counting it would make every seam look complete by
 * construction. The `fs` half of `sideOf` is kept deliberately: it costs one
 * regex and it is what would notice somebody reintroducing a filesystem adapter
 * under the old naming, rather than that arriving unremarked.
 *
 * ## A refusal wearing a store's name, and what that check is worth now
 *
 * A `pgFooStore` whose every method refuses is the same 501 by a longer route,
 * so it is flagged below. A refusal belongs beside the selector in
 * `src/store/index.ts`, where a reader looking for the implementation finds the
 * refusal instead of a store's name on an empty box.
 *
 * **`notMigrated` was deleted with `src/store/live.ts` on 2026-09-06**, so that
 * check is a name check for a name nothing defines: a tripwire on a revival
 * that keeps the old spelling, not a live guard on today's source. Kept because
 * it costs nothing and a revival would copy the old shape. The load-bearing
 * case is the structural one above it.
 *
 * **No database, no network, no imports of the stores themselves** — this reads
 * the source. So it runs everywhere, always.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
 * `Pick<GlossaryStore, "deleteGlossary">` is how `fsGlossaryStore` is declared,
 * and reading that as "no contract" would drop `GlossaryStore` — the one live
 * example of the direction this file exists to flag. (`pgArticleReader` was a
 * `Pick` too until 2026-09-02; it is now annotated `: ArticleReader` outright,
 * so a missing loader is a typecheck error rather than a boot-time `TypeError`
 * — src/store/pg.ts.)
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

/** Does this subtree call `notMigrated`? Nothing defines that name since
 *  2026-09-06 — see the header for what this is still worth. */
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

const sideNames = (impls: Implementation[], side: Side) =>
  impls.filter((i) => i.side === side).map((i) => i.name);

/**
 * **The contracts `src/store/index.ts` wires a selector for** — a second, and
 * deliberately different, way of finding a seam.
 *
 * `SEAMS` above is implementations ∩ contracts, so a contract that **nothing
 * implements** never enters it and the Postgres check below cannot look at it.
 * That was fine while the answer to "is this a seam?" was "something implements
 * it": an interface nothing implements was a data shape (`RawSource`,
 * `SweepOptions`, `Turn`), which is what the file header says and why the test
 * is "is it implemented" rather than a naming rule.
 *
 * **It stopped being fine when there was one store.** With two, a seam missing
 * its Postgres side still had a filesystem one, so it was in `SEAMS` and the
 * guard saw it — that is the Claims shape of 2026-08-31, and the check caught
 * it. With one store, the same outage arrives as a contract plus a selector plus
 * **no implementation at all**, which is invisible to a set built from
 * implementations. Found by GPT Sol's review of stage G on 2026-09-05, and
 * reproduced by both of us: a `ReviewMissingStore` contract with a selector and
 * no adapter passed all five tests.
 *
 * A selector is the right second source precisely because a data shape never has
 * one. `export const commentStore: CommentStore = guarded(…)` says *this
 * contract is something the app calls*, which is the whole claim.
 */
async function selectorContracts(): Promise<string[]> {
  const ast = parseSource(await readFile(path.join(STORE_DIR, "index.ts"), "utf8"));
  const named: string[] = [];
  walkAst(ast, (node) => {
    if (node.type !== "ExportNamedDeclaration") return;
    const declaration = node.declaration as AstNode | undefined;
    if (declaration?.type !== "VariableDeclaration") return;
    for (const raw of (declaration.declarations as AstNode[]) ?? []) {
      const id = raw.id as AstNode | undefined;
      if (id?.type !== "Identifier") continue;
      const contract = contractOf(id.typeAnnotation);
      if (contract) named.push(contract);
    }
  });
  return named;
}

const SELECTED = await selectorContracts();

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
       `GlossaryStore` entirely, whose adapters are both declared through
       `Pick<GlossaryStore, "deleteGlossary">` (`lookUpTerm` is orchestration
       that index.ts builds, not a store method on either side).

       Until 2026-09-03 this line asserted `fsGlossaryStore` alone, because the
       Postgres side did not exist; then both, because asking only for the files
       side would go on passing if `pgGlossaryStore` stopped being recognised.
       Since 2026-09-05 it is `pgGlossaryStore` alone again, from the other
       direction: `fsGlossaryStore` went with src/store/fs.ts
       (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G),
       and the side production runs is the side worth naming.
       src/store/pg-glossary.ts. */
    const glossary = SEAMS.get("GlossaryStore") ?? [];
    expect(glossary.map((i) => i.name)).toContain("pgGlossaryStore");
    /* And the plain-annotation path, on the seam that used to take the `Pick`
       route: `pgArticleReader` must still be found as an `ArticleReader`, or
       the reader seam would look one-sided. */
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

describe("every store seam has a Postgres implementation", () => {
  /**
   * **This asked for two implementations until 2026-09-05, and asking for two
   * was never the point.**
   *
   * The postmortem that commissioned this file wanted a seam that could not
   * arrive half-built. It said *"two implementations"* because `SPIDERYARN_STORE`
   * unset meant `files`, so a seam with no Postgres side was exercised by every
   * test, every local run and every browser pass in the one configuration that
   * was not deployed — and looked exactly like a seam that worked. Claims
   * shipped that way and answered 501 in production for four hours with the
   * whole suite green.
   *
   * The reason is gone: stage G of
   * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
   * deleted the filesystem store, and there is one store now. **The failure is
   * not gone**, so the assertion is narrowed to it rather than deleted — a seam
   * with no Postgres implementation is still a 501 for every reader, and that is
   * exactly what this now says.
   *
   * It is also strictly stronger than what it replaces. `SEAM_ASYMMETRIES` could
   * excuse either side; every entry in it excused a missing *files* side, so
   * nothing that was passing is newly failing, and the door that could have
   * excused a missing Postgres side is now shut. That map is deleted with this
   * change, which is the answer to a question the last group had to ask: eleven
   * seams lost their files side in one commit, and a record of exceptions that
   * has grown to cover every case is a second list of the seams — the thing this
   * file's own header says it exists to make impossible.
   */
  it("has a Postgres implementation for every contract the app wires a selector for", () => {
    /* The case above cannot see this one: `SEAMS` is built from implementations,
       so a contract nothing implements is not in it. This asks the question from
       the other end — the app calls it, therefore it needs a store. */
    const wrong: string[] = [];
    for (const contract of SELECTED) {
      const impls = SEAMS.get(contract) ?? [];
      if (sideNames(impls, "postgres").length > 0) continue;
      wrong.push(contract);
    }
    expect(
      wrong,
      `src/store/index.ts wires a selector for ${wrong.join(", ")}, and nothing implements ` +
        "it for Postgres. That is a 501 the moment a reader reaches it, and it is the shape " +
        "the 2026-08-31 Claims outage takes now there is one store: a contract, a selector, " +
        "and no adapter. Build the adapter, or take the selector out.",
    ).toEqual([]);
  });

  it("finds selectors at all, so the check above cannot pass by finding nothing", () => {
    /* The check above is satisfied by an empty list, and an empty list is what a
       parser that stopped matching produces. This is the floor that tells the
       two apart — the same argument the seam count makes for `SEAMS`. */
    expect(SELECTED.length).toBeGreaterThan(8);
    expect(SELECTED).toContain("CommentStore");
    expect(SELECTED).toContain("ChatStore");
  });

  it("has a Postgres implementation for every seam", () => {
    const wrong: string[] = [];
    for (const [contract, impls] of SEAMS) {
      if (sideNames(impls, "postgres").length > 0) continue;
      wrong.push(`${contract} has no Postgres implementation`);
    }
    expect(
      wrong,
      `${wrong.join("; ")}.\n\n` +
        "  Postgres is the only store, so a seam with no Postgres implementation " +
        "is a feature that does not exist for anybody — a 501 with every test " +
        "green, which is how Claims shipped on 2026-08-31. Build the adapter; " +
        "there is no longer a second side to fall back to and no way to declare " +
        "this one away.",
    ).toEqual([]);
  });

  it("has no store that is a refusal wearing an implementation's name", () => {
    /* The structural check above is satisfied by a `pgFooStore` whose every
       method is `notMigrated(…)`, which is the same 501 with a longer route to
       it. A refusal belongs in index.ts beside the selector, where it is
       visible as a refusal — and with one store there is nowhere left to
       declare it away, which is the point of the check above. Nothing defines
       `notMigrated` since 2026-09-06, so a green tick here asserts nothing
       about today's source — see the header. */
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
        "refusal in src/store/index.ts where the selector is — or, better, build " +
        "the adapter: there is one store, so this seam is a 501 for every reader.",
    ).toEqual([]);
  });
});
