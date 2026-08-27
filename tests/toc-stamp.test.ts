/**
 * `toc` can finally say it is stale, and the reason it must is not about `toc`.
 *
 * Stage 4 declared no `stamp` (src/pipeline.ts), so `stepIsDone("toc")` was
 * presence and nothing else: the three artefacts exist, therefore done. Re-run
 * stage 3 so its blocks differ from the copy stage 4 made, and the tree now
 * describes text that is no longer there — and nothing could tell.
 *
 * ## Why this lands before the Postgres adapter, rather than with it
 *
 * The publication guard already checks `toc`'s `input_hash` against the stored
 * blocks, and `articleMetadata` checks its own version of the same thing. That
 * is two independently written copies of one rule, and
 * docs/postmortems/toc-status-never-checked.md is about what happened when they
 * disagreed. A Postgres `ArtifactStore` that had to answer "is the toc current"
 * with no stamp to compare would have to grow a **third**, private to storage.
 *
 * Giving `toc` an ordinary stamp removes the reason for that third copy. The
 * comparison stays where every other step's lives — `sameStamp`, called once by
 * `stepIsDone` — and the adapter only has to record and return what it was
 * given. GPT Sol's input round on the adapter's shape, 2026-08-27;
 * docs/plans/artifacts-pg-shape-sol.md finding 4.
 *
 * ## Stage 3's blocks, not stage 4's
 *
 * `inputHashFor` deliberately reads `data/<slug>/blocks.json` — stage 4's copy —
 * because that is what the *late* stages consumed, and reading stage 3's would
 * make every artefact look stale the moment stage 3 ran without stage 4.
 *
 * `toc` is the one step where the opposite is true. Stage 3's output is
 * literally its input, so hashing stage 4's copy would be hashing its own
 * output and could never disagree with itself. That is the whole bug this
 * closes, and it is why this stamp does not call `inputHashFor`.
 *
 * ## What it costs, measured rather than guessed
 *
 * Across the nine articles on this laptop, six have stage-3 blocks, stage-4
 * blocks and `labels.sourceHash` all in agreement, so nothing changes for them.
 * Two have no blocks at all and already fail `has`. One — `constitution` — has
 * a `labels.json` written before `sourceHash` existed, so it now reports `toc`
 * not-current and would re-run. That is the correct answer: nothing records
 * what that tree was built from, and *"we cannot tell"* has to mean not-current
 * or a stale tree is served for ever.
 *
 * ## How to watch it go red
 *
 * Delete the `stamp` from `STEPS.toc` and *"notices stage 3 running again"* and
 * *"cannot tell, and says not done"* both fail. Both were watched failing that
 * way.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { Block } from "../src/types.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE = "writes";

let out = "";
let store: ArtifactStore;
let ctx: StepContext;

/** `output/<slug>.blocks.json` — stage 3's own output, which stage 4 consumes. */
const stage3 = () => path.join(out, "output", `${FIXTURE}.blocks.json`);

beforeEach(async () => {
  out = await mkdtemp(path.join(tmpdir(), "spideryarn-toc-stamp-"));
  await mkdir(path.join(out, "data", FIXTURE), { recursive: true });
  await mkdir(path.join(out, "output"), { recursive: true });

  /* A real article, copied rather than invented: the point is that a consistent
     one stays done, and a hand-built fixture could agree with the code by
     accident about what consistent means. */
  for (const name of ["tree.json", "labels.json", "blocks.json"]) {
    await cp(path.join(ROOT, "data", FIXTURE, name), path.join(out, "data", FIXTURE, name));
  }
  await cp(path.join(ROOT, "output", `${FIXTURE}.blocks.json`), stage3());
  await cp(path.join(ROOT, "output", `${FIXTURE}.html`), path.join(out, "output", `${FIXTURE}.html`));

  store = createFsArtifactStore(() => ({
    dir: path.join(out, "data", FIXTURE),
    htmlFile: path.join(out, "output", `${FIXTURE}.html`),
  }));
  ctx = {
    slug: FIXTURE,
    dir: path.join(out, "data", FIXTURE),
    htmlFile: path.join(out, "output", `${FIXTURE}.html`),
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

/** Change one block's text in stage 3's output, leaving stage 4's copy alone. */
async function reExtract(): Promise<void> {
  const file = JSON.parse(await readFile(stage3(), "utf-8")) as { blocks: Block[] };
  const first = file.blocks[0];
  if (!first) throw new Error("the fixture has no blocks; this test would prove nothing");
  first.text = `${first.text} — and one word more, as a later fetch found it.`;
  await writeFile(stage3(), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

describe("whether stage 4 is still about the current blocks", () => {
  it("is done when stage 3 and stage 4 agree", async () => {
    /* The control, and it is not decoration: a stamp that never matches also
       passes both assertions below. */
    expect(await stepIsDone(STEPS.toc, ctx, store)).toBe(true);
  });

  it("notices stage 3 running again", async () => {
    await reExtract();
    expect(await stepIsDone(STEPS.toc, ctx, store)).toBe(false);
  });

  it("cannot tell, and says not done, when stage 3's output is gone", async () => {
    /* Distinct from staleness and answered the same way. `has` is unaffected —
       it asks about stage 4's copy — so this really does reach the stamp. */
    await rm(stage3());
    expect(await store.has(FIXTURE, "toc", STEPS.toc.produces)).toBe(true);
    expect(await stepIsDone(STEPS.toc, ctx, store)).toBe(false);
  });

  it("says nothing about stage 4's own copy being wrong, and that is the boundary", async () => {
    /* Corrupting `data/<slug>/blocks.json` leaves `toc` current, and that is
       correct rather than a gap: the tree really was built from the blocks
       stage 3 has, which is the only question this stamp asks. A different
       fault, caught in two other places — `checkTree` inside
       `reasonsNotToPublish` refuses to publish a tree that does not describe
       the stored blocks, and the late stages read this copy through
       `inputHashFor` and go stale against it.

       Written down as an assertion rather than left implicit, because the
       tempting "fix" is to hash this file instead — which is stage 4 hashing
       its own output, agrees by construction, and restores the bug. */
    const stage4 = path.join(out, "data", FIXTURE, "blocks.json");
    const file = JSON.parse(await readFile(stage4, "utf-8")) as { blocks: Block[] };
    (file.blocks[0] as Block).text = "something else entirely";
    await writeFile(stage4, `${JSON.stringify(file, null, 2)}\n`, "utf8");

    expect(await stepIsDone(STEPS.toc, ctx, store)).toBe(true);
  });
});
