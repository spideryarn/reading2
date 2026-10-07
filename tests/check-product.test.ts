/**
 * The edges of what a step's product may be, asked of the guard directly.
 *
 * `checkProduct` (src/store/session.ts) runs before the transactional session
 * opens its transaction, and `assertProduced` (src/pipeline.ts) inside it. Both
 * are pure enough to be asked without a database.
 *
 * ## Where these came from
 *
 * `tests/store-session.test.ts`, which drove them through `fsStoreSession`: a
 * second session, over the filesystem and with no transaction, that nothing
 * but that test had called since 2026-09-05. Both were deleted on 2026-10-07
 * (docs/plans/261007e-seventh-sweep-pipeline-tidy-one-successor-rule-and-the-dead-filesystem-session.md
 * has the case-by-case table). These four are the cases that assert a rule the
 * one remaining session depends on and that nothing else in the suite held.
 * The session-level ones (a carried artefact left alone, the release that
 * comes back cancelled, the claim not let go on a refusal) are in
 * tests/store-pg-session.test.ts against the real session; the plain
 * missing-part and no-parts refusals are in tests/stage2c-raw-bytes.test.ts.
 *
 * ## The four mutations, watched red on 2026-10-07
 *
 * | mutation | red |
 * |---|---|
 * | `!Object.hasOwn(parts, kind) \|\|` dropped from `checkProduct`, leaving the lookup | *refuses a part inherited from a prototype* → `expected [Function] to throw an error` |
 * | the `extra.length > 0` throw deleted | *refuses an artefact the step does not declare* → `expected [Function] to throw an error` |
 * | the `produces.length === 0` throw deleted | *refuses a step that declares nothing* → `expected [Function] to throw an error` |
 * | `assertProduced` made never to ask the store | *refuses a step with half of what it declares readable* → `promise resolved "undefined" instead of rejecting` |
 */
import { describe, expect, it } from "vitest";

import type { LabelsFile } from "../src/labels.js";
import { assertProduced, STEPS } from "../src/pipeline.js";
import type { PipelineStep, StepContext, StepProduct } from "../src/pipeline.js";
import { checkProduct } from "../src/store/session.js";
import type { Tree } from "../src/types.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

const SLUG = "test-check-product";

/** A tree that satisfies the store's shape check. */
function treeSaying(title: string): Tree {
  return {
    version: "toc/2",
    generator: "test",
    slug: SLUG,
    rootId: "n0000",
    nodes: {
      n0000: {
        id: "n0000",
        depth: 0,
        parent: null,
        children: [],
        range: ["spya-aaaaaa", "spya-aaaaaa"],
        title,
      },
    },
  };
}

/** The same, for the second artefact. */
function labelsSaying(label: string): LabelsFile {
  return {
    version: "labels/1",
    generator: "test",
    slug: SLUG,
    sourceHash: "0".repeat(16),
    structureHash: "0".repeat(16),
    structureVersion: "toc/2",
    labels: { n0000: label },
    /* `[]`, not `null`: a `batches: null` manifest is a pending one.
       src/labels.ts § `PendingLabelsFile`. */
    batches: [],
  };
}

/**
 * A step that declares what the case says, standing in for `structure`.
 *
 * `run` throws: every case here hands the guard a product directly, and the
 * subject is the rule that decides what a `run` may return, so nothing runs
 * one.
 */
function stepProducing(produces: PipelineStep["produces"]): PipelineStep {
  return {
    name: "structure",
    label: "Testing the guard",
    produces,
    run: async () => {
      throw new Error("stepProducing().run is never called");
    },
  };
}

describe("the edges of what a product may be", () => {
  it("refuses a product with no parts for every step", () => {
    for (const step of Object.values(STEPS)) {
      expect(() => checkProduct(step, { detail: "nothing returned" }), step.name).toThrow(
        /returned no artefacts to write/,
      );
    }
  });

  it("requires parts in every step's run return type", () => {
    // @ts-expect-error a new step cannot return an unconverted product.
    const run: PipelineStep["run"] = async () => ({ detail: "nothing returned" });
    expect(typeof run).toBe("function");
  });

  /**
   * **`Object.hasOwn`, not a lookup.** The store's `write` iterates
   * `Object.entries`, which skips the prototype — so an inherited `labels`
   * satisfies `parts.labels !== undefined`, is written nowhere, and then passes
   * the postcondition against the labels the draft carried forward. The same
   * hole as a missing part, through a door the obvious check does not watch.
   */
  it("refuses a part inherited from a prototype, which write() would not write", () => {
    const parts = Object.create({ labels: labelsSaying("Inherited") }) as Record<string, unknown>;
    parts.tree = treeSaying("New");
    /* The fixture is what it says: the lookup finds it and the object does not
       own it. Without this the case could pass over an ordinary missing key. */
    expect(parts.labels).toBeDefined();
    expect(Object.hasOwn(parts, "labels")).toBe(false);

    const product: StepProduct = { detail: "one own, one inherited", parts };
    expect(() => checkProduct(stepProducing(["tree", "labels"]), product)).toThrow(
      /returned a product missing labels/,
    );
  });

  /**
   * The store writes what it recognises and then throws on the unknown
   * `(step, kind)` pair, so a product with one extra key is refused up front
   * rather than part-way through a write.
   */
  it("refuses an artefact the step does not declare", () => {
    const product: StepProduct = {
      detail: "one too many",
      parts: {
        tree: treeSaying("New"),
        labels: labelsSaying("New"),
        arc: { version: "arc/2", generator: "test", slug: SLUG, entries: [] },
      },
    };
    expect(() => checkProduct(stepProducing(["tree", "labels"]), product)).toThrow(
      /returned arc, which it does not declare/,
    );
  });

  /**
   * `has([], …)` deliberately answers false, so a step producing nothing can
   * never satisfy the skip check — it would be committed, marked done, and
   * re-run on every job for ever with nothing to show for it.
   */
  it("refuses a step that declares nothing, which could never be done", () => {
    expect(() => checkProduct(stepProducing([]), { detail: "nothing at all", parts: {} })).toThrow(
      /declares no artefacts/,
    );
  });

  /** The control: the same step and a complete product of its own keys. */
  it("accepts a product that owns exactly what the step declares", () => {
    expect(() =>
      checkProduct(stepProducing(["tree", "labels"]), {
        detail: "1 section",
        parts: { tree: treeSaying("New"), labels: labelsSaying("New") },
      }),
    ).not.toThrow();
  });
});

describe("the postcondition, asked of the store", () => {
  const ctx: StepContext = {
    power: "standard",
    slug: SLUG,
    report: () => undefined,
    preview: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };

  it("refuses a step with half of what it declares readable", async () => {
    const store = memoryArtefacts();
    store.plant(SLUG, "structure", "tree", treeSaying("Half"));
    await expect(assertProduced(stepProducing(["tree", "labels"]), ctx, store)).rejects.toThrow(
      /structure finished without writing labels/,
    );
  });

  it("passes once both are there", async () => {
    const store = memoryArtefacts();
    store.plant(SLUG, "structure", "tree", treeSaying("Whole"));
    store.plant(SLUG, "structure", "labels", labelsSaying("Whole"));
    await expect(
      assertProduced(stepProducing(["tree", "labels"]), ctx, store),
    ).resolves.toBeUndefined();
  });
});
