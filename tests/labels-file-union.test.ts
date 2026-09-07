/**
 * **A labels manifest written before any call is a different type from one
 * written after, and the compiler is what keeps them apart.**
 *
 * `LabelsFile` was one interface with `version` and `generator` required, and
 * stage 2 of
 * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md needs a second
 * shape: the `hierarchy` step now writes a manifest holding the three hashes
 * and no labels at all, because the labels have become their own step. Making
 * those two one bag of optionals would have put the decision at every read
 * site. They are `PendingLabelsFile` and `CompletedLabelsFile` instead, and
 * `batches === null` is the discriminant.
 *
 * ## What is actually at stake in the two missing fields
 *
 * `stampOf` (src/store/artifacts.ts) reads `version` as `promptVersion` and
 * `generator` as `model`. A pending manifest carrying either would hand
 * `stampForStep("labels")` a provenance no model produced — and, against a
 * `revision_step_runs` row `beginDraftIn` carried forward from the previous
 * ingest, could make an empty manifest compare *current* and the labels step
 * skip itself for ever. So the absence is a safety property, not tidiness.
 *
 * ## Which instrument reddens this
 *
 * **`npm run typecheck`, not `npm test`** — the same arrangement, and the same
 * reasoning, as tests/step-job-preceded-by.test.ts. The `@ts-expect-error`
 * lines below are the assertions; vitest strips them without looking, and an
 * `@ts-expect-error` over a line that has stopped being an error is itself an
 * error (TS2578). Watched red by giving `PendingLabelsFile` a
 * `version?: string` and making `CompletedLabelsFile.version` optional:
 *
 *     ✗ tests/tsconfig.json
 *       tests/labels-file-union.test.ts(85,3): error TS2578: Unused '@ts-expect-error' directive.
 *       tests/labels-file-union.test.ts(96,3): error TS2578: Unused '@ts-expect-error' directive.
 *
 * The runtime half is not decoration: it proves these are real values rather
 * than types that happen to compile, and the narrowing case is the one every
 * reader of a `LabelsFile` now performs.
 */
import { describe, expect, it } from "vitest";

import type {
  CompletedLabelsFile,
  LabelsFile,
  PendingLabelsFile,
} from "../src/labels.js";

const HASHES = {
  slug: "a-piece",
  sourceHash: "blocks-hash",
  structureHash: "tree-hash",
  structureVersion: "toc/3",
} as const;

describe("the two shapes of a labels manifest", () => {
  it("builds a pending one from the hashes alone", () => {
    const pending: PendingLabelsFile = { ...HASHES, labels: {}, batches: null };
    expect(pending.batches).toBeNull();
    expect(Object.keys(pending.labels)).toEqual([]);
  });

  it("builds a completed one with its provenance and its batches", () => {
    const done: CompletedLabelsFile = {
      ...HASHES,
      version: "labels/2",
      generator: "claude-sonnet-5",
      labels: { "spya-aaaaaa": "the opening" },
      batches: [],
    };
    expect(done.version).toBe("labels/2");
  });

  it("narrows on `batches === null`, which is what every reader does", () => {
    const files: LabelsFile[] = [
      { ...HASHES, labels: {}, batches: null },
      { ...HASHES, version: "labels/2", generator: "m", labels: {}, batches: [] },
    ];
    /* The narrowing itself is the assertion: `file.version` does not compile
       outside this guard, which is the whole point of the union. */
    const versions = files.map((file) => (file.batches === null ? null : file.version));
    expect(versions).toEqual([null, "labels/2"]);
  });

  it("refuses a pending manifest that claims a prompt version", () => {
    const invented: PendingLabelsFile = {
      ...HASHES,
      labels: {},
      batches: null,
      // @ts-expect-error a pending manifest was produced by no prompt, so `version` would be invented provenance — and `stampOf` reads it.
      version: "labels/2",
    };
    expect(invented.batches).toBeNull();
  });

  it("refuses a completed manifest with no provenance at all", () => {
    // @ts-expect-error `version` and `generator` are required on a completed file: a real run knows both.
    const anonymous: CompletedLabelsFile = { ...HASHES, labels: {}, batches: [] };
    expect(anonymous.batches).toEqual([]);
  });
});
