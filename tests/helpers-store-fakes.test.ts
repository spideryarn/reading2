/**
 * **The two stand-in stores stage D introduced, and the two properties a review
 * caught them missing.**
 *
 * [helpers/fixture-artefacts.ts](helpers/fixture-artefacts.ts) reads the
 * committed corpus for `loadArticleIntoPg`;
 * [helpers/memory-artefacts.ts](helpers/memory-artefacts.ts) is the fake handed
 * to a test whose subject is not storage. Both replaced a
 * `createFsArtifactStore`, and both shipped on 2026-09-05 with a hole that the
 * suites using them could not see:
 *
 * 1. **the fixture reader had no size ceiling**, so it copied an artefact the
 *    filesystem store refused — the equivalence the whole stage rests on, broken
 *    for any fixture over 4 MiB;
 * 2. **the memory store handed back its own object**, so a caller that read an
 *    artefact and edited it had already changed the store. That one is not
 *    merely impure: two converted controls in `quiz-step-registration` and
 *    `illustrated-step-registration` were near-constants because of it.
 *
 * Neither was reachable from the suites that use these helpers, and that is the
 * reason this file exists rather than more cases over there. The corpus's
 * largest artefact is 154 KB, so nothing any suite loads is within 27× of a
 * ceiling; and every caller of the memory store happened to write through the
 * same reference it read, so the alias never showed. **A helper's own properties
 * need a test of the helper** — docs/reusable/silent-success.md is the general
 * form, and stage D of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * is where these two came from.
 *
 * There are no `**Mutation.**` markers here because this is a new test rather
 * than a conversion; what it guards is stated in each case.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixtureArtefacts } from "./helpers/fixture-artefacts.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { requireFixture } from "./helpers/require-fixture.js";

requireFixture("writes", ["blocks.json", "output.html"]);

const SLUG = "test-store-fakes";

/** A scratch fixture root with one article's `output/<slug>.html` in it. */
let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spya-store-fakes-"));
  await mkdir(path.join(root, "data", SLUG), { recursive: true });
  await mkdir(path.join(root, "output"), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the fixture reader's size ceiling", () => {
  /**
   * **The reproduction, at the boundary rather than at a round number.**
   *
   * 4 MiB exactly is accepted and one byte more is refused, so the case pins
   * where the line is rather than that a line exists somewhere. A test that
   * only wrote 33 MiB would pass against a ceiling of 32 MiB — which is the
   * value the reader deliberately does *not* use, and the reason it does not is
   * in `MAX_BYTES`.
   */
  it("reads a fixture at the ceiling and refuses one byte over it", async () => {
    const reader = fixtureArtefacts(root);
    const file = path.join(root, "output", `${SLUG}.html`);
    const bound = 4 * 1024 * 1024;

    await writeFile(file, "x".repeat(bound));
    expect(
      (await reader.read(SLUG, "extract", "extractedHtml"))?.length,
      "a fixture exactly at the ceiling must still be readable",
    ).toBe(bound);

    await writeFile(file, "x".repeat(bound + 1));
    await expect(reader.read(SLUG, "extract", "extractedHtml")).rejects.toThrow(
      /over this reader's 4194304-byte ceiling/,
    );
  });

  /**
   * **The half of the finding that a refusal alone does not cover.**
   *
   * What went wrong was not that the reader lacked a bound in the abstract: it
   * was that `copyArtefacts` asked for an artefact, got 34 million characters
   * back, and recorded a step the filesystem store had refused. So this asks
   * the question in the direction the copy asks it — *does the read say no* —
   * rather than asserting on a number.
   */
  it("refuses loudly rather than answering null, which is what shortens `copied`", async () => {
    const reader = fixtureArtefacts(root);
    await writeFile(path.join(root, "output", `${SLUG}.html`), "x".repeat(5 * 1024 * 1024));

    /* `null` is the filesystem store's answer here and is the wrong one for a
       fixture: it drops `extract` out of the copy and fails three assertions
       later in whatever suite needed the article. The throw names the file. */
    const outcome = await reader
      .read(SLUG, "extract", "extractedHtml")
      .then(() => "answered", (err: Error) => err.message);
    expect(outcome).not.toBe("answered");
    expect(outcome).toContain(path.join(root, "output", `${SLUG}.html`));
  });
});

describe("the memory store hands back copies, not its own objects", () => {
  /**
   * **The regression, in the exact shape the review reproduced it.**
   *
   * Both real stores cross a serialisation boundary on every read — the
   * filesystem parses bytes, Postgres decodes JSONB — so neither can be edited
   * through a value it returned. A fake that can is not standing in for either.
   */
  it("does not change when a value it returned is mutated afterwards", async () => {
    const store = memoryArtefacts();
    store.plant(SLUG, "hierarchy", "blocks", {
      blocks: [{ id: "spya-aaaaaa", tag: "p", kind: "text", text: "before", words: 1, html: "", gistable: true }],
    });

    const first = await store.read(SLUG, "hierarchy", "blocks");
    const block = first?.blocks[0];
    if (!block) throw new Error("the planted artefact came back without its block");
    block.text = "mutated";

    const second = await store.read(SLUG, "hierarchy", "blocks");
    expect(
      second?.blocks[0]?.text,
      "editing a read result changed the store — the fake is aliasing, and every " +
        "`read, edit, plant, assert` control built on it is a near-constant",
    ).toBe("before");
    /* And the two reads are not the same object either, which is the property
       underneath: equal by value, distinct by reference. */
    expect(second).not.toBe(first);
  });

  /** The same in the other direction: the caller's own copy is not the store's. */
  it("does not change when the value that was planted is mutated afterwards", async () => {
    const store = memoryArtefacts();
    const planted = { entries: [{ id: "spya-bbbbbb", name: "Corrigibility" }], sourceHash: "abc" };
    store.plant(SLUG, "glossary", "glossary", planted);

    planted.entries[0]!.name = "Something else";

    const read = await store.read(SLUG, "glossary", "glossary");
    expect(read?.entries[0]?.name, "editing what was planted changed the store").toBe(
      "Corrigibility",
    );
  });

  /**
   * **`write` too, because a stage keeps its product after handing it over.**
   *
   * `runAndWrite` in both converted registration suites does exactly this: run
   * the stage, `store.write(...)` its product, then go on asserting about the
   * object it still holds.
   */
  it("does not change when a written artefact is mutated afterwards", async () => {
    const store = memoryArtefacts();
    const quiz = { questions: [{ id: "spya-cccccc", question: "What?" }], sourceHash: "h" };
    await store.write(SLUG, "quiz", { quiz } as never, {});

    quiz.questions[0]!.question = "Something else?";

    const read = await store.read(SLUG, "quiz", "quiz");
    expect(read?.questions[0]?.question, "editing what was written changed the store").toBe(
      "What?",
    );
  });

  /**
   * The anti-empty control. Every assertion above is about a value *not*
   * changing, and a store that held nothing at all would satisfy all three by
   * answering `null` — `?.` swallows it and `undefined` is not the mutated
   * string either. This asks that the store really is holding what it was given.
   */
  it("really is holding the artefact, or the three cases above prove nothing", async () => {
    const store = memoryArtefacts();
    store.plant(SLUG, "arc", "arc", { entries: [{ id: "spya-dddddd", text: "One." }] });
    const read = await store.read(SLUG, "arc", "arc");
    expect(read?.entries).toHaveLength(1);
    expect(await store.has(SLUG, "arc", ["arc"])).toBe(true);
  });
});
