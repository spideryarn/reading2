/**
 * **`runtimeImportsOf`, against the spellings an import can take.**
 *
 * tests/helpers/import-graph.ts is a shared defence: the public-door guards, the
 * owner-isolation inventory, the client-sanitiser check and the recovery route's
 * import list all ask it what a file loads. Until 2026-10-06 it read specifiers
 * with three regular expressions anchored at a line start, and had no test of
 * its own. GPT Sol found two spellings it lost while reviewing
 * tests/sanitize-client.test.ts's move onto it (plan
 * docs/plans/261006j-sixth-sweep-s4-test-defences.md § Review, round one):
 *
 * - an import that follows a comment on the same line,
 *   `/* parser *\/ import { JSDOM } from "jsdom";`
 * - a dynamic import with a space before the parenthesis, `import ("x")`.
 *
 * Both are an edge that executes a module and both came back as no edge at all,
 * which is the quiet direction. The cases marked RED below failed against the
 * regex reader; it parses now (tests/helpers/ts-ast.ts).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { runtimeImportsOf } from "./helpers/import-graph.js";

const dir = mkdtempSync(path.join(tmpdir(), "import-graph-helper-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** What the reader says a file with this text loads. */
function importsOf(source: string, ext = "ts"): string[] {
  const file = path.join(dir, `case-${n++}.${ext}`);
  writeFileSync(file, source);
  return runtimeImportsOf(file);
}

describe("what counts as a run-time import", () => {
  it("a plain import, in either quote style", () => {
    expect(importsOf('import { a } from "./a.js";')).toEqual(["./a.js"]);
    expect(importsOf("import { a } from './a.js'")).toEqual(["./a.js"]);
  });

  it("an import after a block comment on the same line (RED before the fix)", () => {
    expect(importsOf('/* parser */ import { JSDOM } from "jsdom";')).toEqual(["jsdom"]);
  });

  it("an import after another statement on the same line (RED before the fix)", () => {
    expect(importsOf('const x = 1; import { a } from "./a.js";')).toEqual(["./a.js"]);
  });

  it("a side-effect import after a block comment on the same line (RED before the fix)", () => {
    expect(importsOf('/* shim */ import "./shim.js";')).toEqual(["./shim.js"]);
  });

  it("an import under a line comment", () => {
    expect(importsOf('// the parser\nimport { JSDOM } from "jsdom";')).toEqual(["jsdom"]);
  });

  it("a multi-line import", () => {
    expect(importsOf('import {\n  a,\n  b,\n} from "./a.js";')).toEqual(["./a.js"]);
  });

  it("a default, a namespace and a side-effect import", () => {
    expect(importsOf('import a from "./a.js";\nimport * as b from "./b.js";\nimport "./c.js";')).toEqual([
      "./a.js",
      "./b.js",
      "./c.js",
    ]);
  });

  it("export … from, named and star", () => {
    expect(importsOf('export { a } from "./a.js";\nexport * from "./b.js";')).toEqual(["./a.js", "./b.js"]);
  });

  it("a dynamic import", () => {
    expect(importsOf('const m = await import("./a.js");')).toEqual(["./a.js"]);
  });

  it("a dynamic import with whitespace before the parenthesis (RED before the fix)", () => {
    expect(importsOf('const m = await import ("./a.js");')).toEqual(["./a.js"]);
    expect(importsOf('const m = await import\n  (\n    "./b.js"\n  );')).toEqual(["./b.js"]);
  });

  it("a dynamic import written as a template with no holes (RED before the fix)", () => {
    expect(importsOf("const m = await import(`./a.js`);")).toEqual(["./a.js"]);
  });

  it("a mixed clause, because one value specifier is enough to load the module", () => {
    expect(importsOf('import { type A, b } from "./a.js";')).toEqual(["./a.js"]);
  });

  it("an import in a .tsx file, beside JSX", () => {
    expect(importsOf('import { A } from "./a.js";\nexport const x = <A b="import(\'./no.js\')" />;', "tsx")).toEqual([
      "./a.js",
    ]);
  });
});

describe("what does not", () => {
  it("import type, and export type", () => {
    expect(importsOf('import type { A } from "./a.js";\nexport type { B } from "./b.js";')).toEqual([]);
  });

  it("a clause whose every specifier is a type", () => {
    expect(importsOf('import { type A, type B } from "./a.js";')).toEqual([]);
  });

  it("the text of an import inside a comment (RED before the fix)", () => {
    expect(importsOf('/*\nimport { a } from "./a.js";\n*/\nexport const x = 1;')).toEqual([]);
    expect(importsOf('// import("./a.js")\nexport const x = 1;')).toEqual([]);
  });

  it("the text of an import inside a string (RED before the fix)", () => {
    expect(importsOf('export const x = `\nimport { a } from "./a.js";\n`;')).toEqual([]);
    expect(importsOf("export const y = 'await import(\"./a.js\")';")).toEqual([]);
  });
});

describe("what it refuses", () => {
  it("a dynamic import it cannot name, rather than dropping the edge", () => {
    expect(() => importsOf('const t = "./a.js";\nawait import(t);')).toThrow(/not a string literal/);
  });

  it("a file it cannot parse, rather than reporting the imports it happened to reach", () => {
    expect(() => importsOf('import { a } from "./a.js";\nconst = ;')).toThrow(/could not be parsed/);
  });
});
