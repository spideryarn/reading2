/**
 * **Whatever the fallback head says, the fingerprint has to have said it too.**
 *
 * `ideas` and `sketch` are the two stages whose prompt head cannot be empty:
 * `articleWithIds` needs one, so when an article has no metadata they
 * synthesise a stub `{ title: fallbackHeadTitle(tree) }` rather than dropping
 * the head. The stamp in src/pipeline.ts asks the store, finds nothing, and
 * fingerprints `null`. If those two ever describe different heads, every
 * article without metadata is stale for ever while looking perfectly healthy —
 * the stage re-runs on every job, spends a model call, and no check goes red.
 *
 * ## The property this file pins, and the one it used to pin instead
 *
 * Until 2026-08-31 the sentence here — and in four other places — was *"hash
 * the real `null`, never the stub"*. That is not the property. It cannot be:
 * `articleWithIdsFingerprint` (src/source-hash.ts) resolves `fallbackHeadTitle`
 * **itself** when it is handed `null`, and the stub carries that one field and
 * nothing else, so `fingerprint(blocks, tree, null)` and
 * `fingerprint(blocks, tree, stub)` are the same sixteen characters. Measured
 * on `example/`, both `…6a2b21a9397b6af2`. Hashing the stub was applied to the
 * real source and nothing anywhere went red, because there was nothing to go
 * red — the two sides agree by construction, and hashing *either* is correct
 * today.
 *
 * The measurement stands; the conclusion drawn from it was wrong, and it was
 * repeated into two source comments, this file, tests/stage-stamp-agreement.ts
 * and docs/plans/260831b-finish-the-database-move.md before GPT Sol took it apart.
 * Adding `byline: "Unknown"` to the stub puts a `BY: Unknown` line in the
 * prompt that no fingerprint anywhere represents, and every one of those five
 * claims — and both of the tests written from them — stays green.
 *
 * So the load-bearing property is not about which of two identical values gets
 * hashed. It is:
 *
 * > **Every field the fallback renders into the prompt is a field the
 * > fingerprint represents, with the value the fingerprint gives it.**
 *
 * `headTheFingerprintDescribes` below is how that is asked. It builds the meta
 * the *hash* describes for an article with no metadata, checks that meta really
 * does fingerprint to the same value as `null`, renders its head with the same
 * function the stages render with, and requires the head the stage actually
 * sent to be that head **exactly** — not to contain it. A field the stub grows
 * has to appear on both sides or the two heads differ.
 *
 * Watched failing, 2026-08-31: `byline: "Unknown"` on the stub in src/ideas.ts
 * reddens the ideas case with `- TITLE: <slug>` against
 * `+ TITLE: <slug> / BY: Unknown`. Swapping either stage to
 * `articleFingerprint`, the other head's function, reddens its hash assertion
 * (`…8d51245d20e5514a` where `…6a2b21a9397b6af2` was wanted); one function for
 * both heads was the NO-SHIP finding of the same day.
 *
 * **Nothing else tests the writing side.**
 * tests/pipeline-artifact-store.test.ts holds the *checking* side and says so
 * outright — *"It cannot reach inside `generateIdeas`"*. It is cheap to write
 * here only because the stages now take an `Article` rather than a directory
 * (src/article-input.ts): "an article with no metadata" is a field set to
 * `null` instead of a fixture tree with a file deliberately missing from it.
 *
 * **Every assertion is a pair**, because either half alone passes on code that
 * is wrong. The hash must equal the no-metadata fingerprint *and* the prompt
 * must carry the whole of the head that fingerprint stands for — otherwise a
 * stage that had simply stopped rendering a head would pass, and that is the
 * other way this can break.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Article } from "../src/article-input.js";
import { articleWithIds } from "../src/article-prompt.js";
import {
  type BlockFingerprint,
  articleWithIdsFingerprint,
  datedArticleFingerprint,
  fallbackHeadTitle,
} from "../src/source-hash.js";
import type { Block, Meta, Tree } from "../src/types.js";

/** What the next call answers, and what it was sent. One of each per test. */
let answer = "";
const sent: string[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (_task: string, body: unknown) => {
      sent.push(JSON.stringify(body));
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text: answer, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The real fixture, read once — and then handed in twice, with and without its
 * metadata.
 *
 * `example/` rather than a hand-built article: the fingerprint is over the
 * blocks and the tree as well as the head, and a two-block toy would let a
 * change to `hashBlocks` or `structureHash` pass unnoticed here.
 */
let withMeta: Article;
let withoutMeta: Article;

beforeAll(async () => {
  const { readArticleFromDir } = await import("./helpers/article-from-dir.js");
  withMeta = await readArticleFromDir(path.join(ROOT, "example"));
  expect(withMeta.meta, "the fixture is supposed to have metadata").not.toBeNull();
  withoutMeta = { ...withMeta, meta: null };
});

beforeEach(() => {
  sent.length = 0;
  answer = "";
});

/** The first block long enough to quote from, so `findQuote` keeps the occurrence. */
const quotable = (blocks: Block[]): Block => {
  const found = blocks.find((b) => b.text.split(/\s+/).length > 8);
  if (!found) throw new Error("the fixture has no block long enough to quote");
  return found;
};

/** The rule `articleWithIds` (src/article-prompt.ts) puts under the head. */
const RULE = "\n\n---\n\n";

/**
 * Every string anywhere in the bodies the stubbed model was handed.
 *
 * Parsed rather than grepped. The head is a multi-line string inside a JSON
 * document, so a `toContain` over the serialised body is really matching
 * `TITLE: x\\nBY: y` with a literal backslash in it — which works by accident
 * for one line and quietly stops working the moment the assertion is about
 * more than one.
 */
function stringsSent(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const v of value) walk(v);
    else if (value && typeof value === "object") for (const v of Object.values(value)) walk(v);
  };
  for (const body of sent) walk(JSON.parse(body));
  return out;
}

/**
 * The head the stage actually sent: the article part, cut at the rule.
 *
 * **It throws rather than returning `""` when there is none**, because "no head
 * was sent" and "the head was empty" are the two states this file exists to
 * tell apart, and an assertion against an empty string cannot.
 */
function headSent(): string {
  const heads = new Set(
    stringsSent()
      .filter((s) => s.startsWith("TITLE: ") && s.includes(RULE))
      .map((s) => s.slice(0, s.indexOf(RULE))),
  );
  if (heads.size !== 1) {
    throw new Error(
      `expected exactly one article head in the request, saw ${heads.size}: ` +
        `${JSON.stringify([...heads])}`,
    );
  }
  return [...heads][0]!;
}

/**
 * **The head an article with no metadata is allowed to carry**, derived from
 * the fingerprint rather than from the stage.
 *
 * The chain is the whole point of this function, so it is worth stating: the
 * fingerprint canonicalises four head fields, and `articleWithIds` prints those
 * same four and nothing else. So the meta below — each field set to what the
 * fingerprint resolves it to for a `null` meta — is the meta the *hash*
 * describes, and the head rendered from it is the head the hash stands for.
 * Anything the stage renders on top of that is a byte the model sees and the
 * stamp cannot know about.
 *
 * The `expect` inside it is not decoration either: it is what stops the
 * reconstruction drifting from the thing it claims to reconstruct. If somebody
 * adds a field here whose fallback is not the fingerprint's own, this says so
 * rather than silently widening what the stages are allowed to send.
 */
function headTheFingerprintDescribes(
  article: Article,
  fingerprint: (blocks: readonly BlockFingerprint[], tree: Tree, meta: Meta | null) => string,
): string {
  const asHashed: Meta = {
    slug: article.slug,
    title: fallbackHeadTitle(article.tree),
    byline: "",
    siteName: "",
    url: "",
  };
  expect(
    fingerprint(article.blocks, article.tree, asHashed),
    "the reconstruction is not the `null` the stamp hashes",
  ).toBe(fingerprint(article.blocks, article.tree, null));

  const rendered = articleWithIds(asHashed, []);
  return rendered.slice(0, rendered.indexOf(RULE));
}

describe("an article with no metadata", () => {
  it("ideas: hashes the absent metadata, and still sends a head", async () => {
    const { generateIdeas } = await import("../src/ideas.js");
    const block = quotable(withoutMeta.blocks);
    answer = JSON.stringify({
      ideas: [
        {
          name: "Writing is a test of thought",
          provenance: "introduced",
          statement: "A claim you could carry to another article.",
          occurrences: [{ blockId: block.id, quote: block.text.split(/\s+/).slice(0, 6).join(" ") }],
        },
      ],
    });

    const run = await generateIdeas({ article: withoutMeta, previous: null });

    /* The stamp's own value: `articleWithIdsFingerprint(blocks, tree, null)`,
       which is what src/pipeline.ts computes when the store has no metadata. */
    expect(run.ideas.sourceHash).toBe(
      articleWithIdsFingerprint(withoutMeta.blocks, withoutMeta.tree, null),
    );
    /* And the other half, which is the one with teeth: the head that reached
       the model is *exactly* the head that hash stands for. Without it a stage
       that had stopped sending a head would pass the line above, and so would
       one that had grown a `BY:` line out of nothing. */
    expect(headSent()).toBe(headTheFingerprintDescribes(withoutMeta, articleWithIdsFingerprint));
  });

  it("sketch: hashes the absent metadata, and still sends a head", async () => {
    const { generateSketch } = await import("../src/sketch.js");
    /* Three nodes is `MIN_OVERVIEW_NODES`, all of them linked to a real block,
       stacked down the page in article order and not touching — the smallest
       picture `accept` will let through. Anything less and the stage throws
       before it reaches the line under test. */
    const ids = withoutMeta.blocks.slice(0, 3).map((b) => b.id);
    answer = JSON.stringify({
      caption: "Three claims in the order the piece makes them.",
      title: "A short chain",
      scenes: [
        {
          id: "overview",
          title: "Overview",
          caption: "A chain.",
          height: 600,
          items: ids.map((id, i) => ({
            kind: "node",
            id: `n${i}`,
            shape: "box",
            x: 40,
            y: 60 + i * 160,
            w: 200,
            h: 72,
            text: `Step ${i + 1}`,
            size: "sm",
            block: id,
          })),
        },
      ],
    });

    const run = await generateSketch({ article: withoutMeta });

    expect(run.sketch.sourceHash).toBe(
      articleWithIdsFingerprint(withoutMeta.blocks, withoutMeta.tree, null),
    );
    expect(headSent()).toBe(headTheFingerprintDescribes(withoutMeta, articleWithIdsFingerprint));
    /* The slug comes off the article the caller was holding, not off
       `tree.slug` — they agree on this fixture, so this only says the field was
       stamped at all. src/sketch.ts says why the two are not the same claim. */
    expect(run.sketch.slug).toBe(withoutMeta.slug);
  });

  it("timeline: hashes the absent metadata with ITS fingerprint, and still sends a head", async () => {
    /* The third stage of this shape, and the one where a metadata-less article
       is not an edge case: the publication date arrives only on re-extraction,
       so every article ingested before 2026-08-31 takes this path on every run.
       It is also the one stage that does NOT hash with
       `articleWithIdsFingerprint` — the date is in its stamp and in no other's
       (src/source-hash.ts § `MetaFingerprintDated`), so the two assertions
       below are a pair: the right value, and not the neighbours' value. */
    const { generateTimeline } = await import("../src/timeline.js");
    const block = quotable(withoutMeta.blocks);
    answer = JSON.stringify({
      events: [
        {
          label: "Something happens",
          order: 1,
          modality: "happened",
          phrase: null,
          occurrences: [{ blockId: block.id, quote: block.text.split(/\s+/).slice(0, 6).join(" ") }],
        },
      ],
    });

    const run = await generateTimeline({ article: withoutMeta, previous: null });

    expect(run.timeline.sourceHash).toBe(
      datedArticleFingerprint(withoutMeta.blocks, withoutMeta.tree, null),
    );
    expect(run.timeline.sourceHash).not.toBe(
      articleWithIdsFingerprint(withoutMeta.blocks, withoutMeta.tree, null),
    );
    /* Its head is `articleWithIds`'s, like the two above, so the same property
       holds against its own fingerprint — the date it hashes as well is a line
       the head does not print, which is why the reconstruction is the same
       four fields here. */
    expect(headSent()).toBe(headTheFingerprintDescribes(withoutMeta, datedArticleFingerprint));
  });

  /**
   * **The control, and without it the two tests above are worthless.**
   *
   * They assert a hash equals `fingerprint(…, null)`. A stage that ignored its
   * metadata entirely — hashing `null` always — would satisfy both. So: the
   * same fixture *with* its metadata must hash differently, and to the value
   * that metadata gives.
   */
  it("is a different input from the same article with its metadata", async () => {
    const meta = withMeta.meta as Meta;
    const present = articleWithIdsFingerprint(withMeta.blocks, withMeta.tree, meta);
    const absent = articleWithIdsFingerprint(withMeta.blocks, withMeta.tree, null);
    expect(present).not.toBe(absent);

    /* And the fixture's own title is really the thing that separates them, so
       the difference is not coming from some other field. */
    const raw = JSON.parse(await readFile(path.join(ROOT, "example", "meta.json"), "utf-8")) as Meta;
    expect(raw.title).toBeTruthy();
    expect(raw.title).not.toBe(withMeta.tree.slug);
  });
});
