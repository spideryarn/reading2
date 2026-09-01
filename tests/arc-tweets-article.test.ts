/**
 * **What `arc` and `tweets` do with the article they are handed** — since the
 * two stages stopped reading `blocks.json`, `tree.json` and `meta.json` for
 * themselves and started taking an `Article` (src/article-input.ts).
 *
 * Three claims, and not one of them had a test before this file. The conversion
 * was checked by running the two commands, which proves the happy path and
 * nothing else: with `meta` silently dropped inside `generateArc`, the whole
 * suite stayed green — arc.test.ts is about the prompt and the join,
 * arc-freshness.test.ts calls `inputFingerprint` directly and never goes near
 * the stage, and block-policy-prompts.test.ts asks only whether a footnote's
 * word is in the request. Measured, by making that exact break and running all
 * three. docs/reusable/silent-success.md.
 *
 *  1. **The stage writes nothing.** It used to drop its artefact beside the tree
 *     it was written from, which works on a laptop and cannot work through a
 *     store that puts the artefact in a Postgres column. The pipeline writes it
 *     now, and since 2026-09-01 it is the only caller — the stage's own command
 *     line is gone. Checked against the source rather than against a directory,
 *     and `generatorBody` below says why.
 *  2. **The fingerprint describes the article it was given.** A stage that hashed
 *     anything other than the three artefacts it generated from is a stale
 *     artefact reporting itself current for ever, in silence — which is the hole
 *     docs/plans/260831b-finish-the-database-move.md exists to close, and the one thing
 *     this conversion could break without a single error anywhere.
 *  3. **`meta: null` is a state, not a failure.** Both stages tolerate an
 *     article with no metadata on purpose, and both are judged on the head their
 *     prompt actually carried — so a `null` that reaches the prompt has to reach
 *     the hash too.
 *
 * The model is stubbed at `streamMessage`, so nothing here needs a key and
 * nothing costs anything. The stub answers rather than throwing, because these
 * assertions are about the artefact that comes out the far end.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { articleFingerprint } from "../src/source-hash.js";
import type { Block, Meta, Tree } from "../src/types.js";

/** Every request the stage under test made, flattened to text. */
const sent: string[] = [];

/** What the stubbed model answers next. Set before each call. */
let answer = "";

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (_task: string, body: unknown) => {
      sent.push(JSON.stringify(body));
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () =>
          Promise.resolve({
            id: "msg_stub",
            type: "message",
            role: "assistant",
            model: "claude-test",
            content: [{ type: "text", text: answer, citations: null }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 20 },
          }),
      };
    },
  };
});

const TITLE = "Zibblewick on the mythology of conscious machines";

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [
  block("spya-aaaaaa", "Writing is thinking, and there is no way round that."),
  block("spya-bbbbbb", "Most people never had to write anything at all."),
  block("spya-cccccc", "So the pressure to learn it simply went away."),
];

/** Two parts, because the arc returns one sentence per part and checks the count. */
const TREE = {
  version: "toc/1",
  generator: "test",
  slug: "arc-tweets-article",
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1", "n2"],
      range: ["spya-aaaaaa", "spya-cccccc"],
      title: "The whole thing",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-aaaaaa", "spya-bbbbbb"],
      title: "First half",
      gist: "A gist.",
    },
    n2: {
      id: "n2",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-cccccc", "spya-cccccc"],
      title: "Second half",
      gist: "Another.",
    },
  },
} as unknown as Tree;

const META: Meta = {
  slug: "arc-tweets-article",
  title: TITLE,
  byline: "A Writer",
  siteName: "Somewhere",
} as Meta;

const withMeta: Article = { slug: TREE.slug, blocks: BLOCKS, tree: TREE, meta: META };
const withoutMeta: Article = { ...withMeta, meta: null };

beforeEach(() => {
  sent.length = 0;
});

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The body of one generator, as source, from its signature to the `main()`
 * below it.
 *
 * **A source scan, because the runtime claim cannot be made to fail.** "The
 * stage wrote no file" looks like something to assert with a temp directory and
 * a `readdir`, and that assertion is vacuous by construction: the stage is no
 * longer told where the article lives, so there is no directory it could write
 * into even if it tried. It would stay green for a stage that had gone back to
 * writing somewhere else entirely — which is the shape
 * docs/reusable/silent-success.md § Test the test warns about, and it is exactly
 * what the first version of this file did.
 *
 * So the claim is made where it is decidable: no `writeFile` inside the
 * generator.
 *
 * **The scan used to stop at `async function main(`**, because the stage's own
 * command line sat below the generator and did — legitimately — write a file.
 * Those command lines were deleted on 2026-09-01
 * (docs/plans/260831b-finish-the-database-move.md § sub-stage I), the generator
 * is now the last thing in each file, and the scan runs to the end. That is
 * strictly stronger, and it is asserted rather than assumed: a `main(`
 * reappearing below the generator would mean the file had grown a second writer
 * this test was written to forbid, so it is an offence here rather than a new
 * cut-off point.
 */
async function generatorBody(file: string, fn: string): Promise<string> {
  const source = await readFile(path.join(ROOT, "src", file), "utf8");
  const from = source.indexOf(`export async function ${fn}(opts: {`);
  expect(from, `${fn} not found in src/${file}`).toBeGreaterThan(-1);
  const body = source.slice(from);
  expect(
    body.includes("async function main("),
    `src/${file} has grown a main() below ${fn}. The stage command lines were deleted on ` +
      "2026-09-01 and the queue is how a stage re-runs (docs/project/ingest-queue.md); a new " +
      "one here is a second writer, which is the thing this test forbids.",
  ).toBe(false);
  return body;
}

describe("generateArc", () => {
  it("hashes the article it was given", async () => {
    answer = JSON.stringify({ arc: ["One sentence.", "Another sentence."] });
    const { generateArc } = await import("../src/arc.js");

    const run = await generateArc({ article: withMeta });

    expect(run.arc.sourceHash).toBe(articleFingerprint(BLOCKS, TREE, META));
    // The title reached the prompt, so the head it is being judged on is the
    // head the model actually saw.
    expect(sent.join("\n")).toContain(TITLE);
    // The pipeline writes through the store now, so there is no path for a
    // caller to pick up and no file for one to name.
    expect(Object.keys(run)).not.toContain("outFile");
  });

  it("writes no file of its own", async () => {
    expect(await generatorBody("arc.ts", "generateArc")).not.toContain("writeFile");
  });

  it("takes a null meta as its own input rather than dropping it", async () => {
    /* The break that nothing else in the suite could see: `meta` never reaching
       the fingerprint looks exactly like this test passing, because both
       articles produce a perfectly good arc. The two hashes have to differ, and
       the one with no metadata has to be the hash of "no metadata". */
    answer = JSON.stringify({ arc: ["One sentence.", "Another sentence."] });
    const { generateArc } = await import("../src/arc.js");

    const bare = await generateArc({ article: withoutMeta });

    expect(bare.arc.sourceHash).toBe(articleFingerprint(BLOCKS, TREE, null));
    expect(bare.arc.sourceHash).not.toBe(articleFingerprint(BLOCKS, TREE, META));
    // And the prompt lost the head it no longer had, which is the other half of
    // the same fact — the hash and the bytes agree about there being no title.
    expect(sent.join("\n")).not.toContain(TITLE);
  });
});

describe("generateTweets", () => {
  it("hashes the article it was given", async () => {
    answer = JSON.stringify({ tweets: ["First post.", "Second post."] });
    const { generateTweets } = await import("../src/tweets.js");

    const run = await generateTweets({ article: withMeta });

    expect(run.thread.sourceHash).toBe(articleFingerprint(BLOCKS, TREE, META));
    expect(sent.join("\n")).toContain(TITLE);
    expect(Object.keys(run)).not.toContain("outFile");
  });

  it("writes no file of its own", async () => {
    expect(await generatorBody("tweets.ts", "generateTweets")).not.toContain("writeFile");
  });

  it("takes a null meta as its own input rather than dropping it", async () => {
    answer = JSON.stringify({ tweets: ["First post.", "Second post."] });
    const { generateTweets } = await import("../src/tweets.js");

    const bare = await generateTweets({ article: withoutMeta });

    expect(bare.thread.sourceHash).toBe(articleFingerprint(BLOCKS, TREE, null));
    expect(bare.thread.sourceHash).not.toBe(articleFingerprint(BLOCKS, TREE, META));
    expect(sent.join("\n")).not.toContain(TITLE);
    /* The thread's prompt says so in words as well: with no byline it must tell
       the model to write "the author" rather than invent a name. src/tweets.ts. */
    expect(sent.join("\n")).toContain("do not guess a name");
  });
});
