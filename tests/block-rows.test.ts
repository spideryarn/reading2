/**
 * `blockOf` and `publicBlockOf` (src/store/block-rows.ts) on rows the database
 * cannot be made to hold, and the one thing about them a type has to say.
 *
 * The rows a database *can* hold are driven through the real reads in
 * tests/block-row-mapper-pg.test.ts. That file cannot seed half a context — the
 * table's CHECK refuses the row — so what the mapper does with one is here.
 */
import { describe, expect, it } from "vitest";

import { blockOf, publicBlockOf, type BlockColumns, type PublicBlockColumns } from "../src/store/block-rows.js";

const BARE: BlockColumns = {
  tag: "p",
  kind: "text",
  level: null,
  text: "One sentence.",
  words: 2,
  html: "<p>One sentence.</p>",
  gistable: true,
  note: null,
  role: null,
  treatment: null,
  noteId: null,
  contextId: null,
  contextType: null,
};
const BARE_BLOCK = {
  id: "spya-k3m9qt",
  tag: "p",
  kind: "text",
  text: "One sentence.",
  words: 2,
  html: "<p>One sentence.</p>",
  gistable: true,
};

describe("a block row with half a context", () => {
  it.each([
    ["an id and no type", { contextId: "c-0123456789", contextType: null }],
    ["a type and no id", { contextId: null, contextType: "callout" }],
  ])("has no context at all: %s", (_what, half) => {
    expect(blockOf("spya-k3m9qt", { ...BARE, ...half })).toStrictEqual(BARE_BLOCK);
    expect(publicBlockOf("spya-k3m9qt", { ...BARE, ...half })).toStrictEqual(BARE_BLOCK);
  });
});

describe("the note", () => {
  const NOTED: BlockColumns = { ...BARE, note: "the extractor's remark", role: "footnote" };

  it("sits where it always has in the owner's block, between gistable and role", () => {
    /* Key order is the byte order of every exported blocks.json. */
    expect(Object.keys(blockOf("spya-k3m9qt", NOTED))).toEqual([
      "id",
      "tag",
      "kind",
      "text",
      "words",
      "html",
      "gistable",
      "note",
      "role",
    ]);
  });

  it("is not in a visitor's block even when the row handed over has one", () => {
    /* A row with more columns than the type names is still assignable, so this
       is the case a careless SELECT would make. */
    expect(publicBlockOf("spya-k3m9qt", NOTED)).toStrictEqual({ ...BARE_BLOCK, role: "footnote" });
  });

  it("is a column the owner's mapper will not compile without", () => {
    /* A claim about the compiler, which `npm run typecheck` checks: the
       directive below is an error the day the call compiles. Never called,
       because at run time nothing stops it — the row has no `note`, which is
       not `null`, and the block would carry `note: undefined`. */
    const compiles = (row: PublicBlockColumns) =>
      // @ts-expect-error — the visitor's SELECT has no `note`, so it cannot reach the owner's mapper.
      blockOf("spya-k3m9qt", row);
    expect(compiles).toBeTypeOf("function");
  });
});
