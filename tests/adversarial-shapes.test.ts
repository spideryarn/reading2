/**
 * # The pipeline, run over the shapes the corpus never had
 *
 * Two postmortems asked for a fixture rather than a fix, and both gave the same
 * reason: the corpus could not exercise the arm, so three separate suites were
 * green about behaviour none of their inputs could produce
 * (docs/reusable/silent-success.md).
 *
 * The shapes are in tests/fixtures/adversarial-shapes.ts. This file runs the
 * real functions over them. Built by
 * docs/plans/260908a-adversarial-fixtures-for-four-postmortems.md, which records
 * per assertion how it was made to fail — a test that was never meaningfully red
 * proves nothing, and that is the whole reason this tier exists.
 *
 * ## Two kinds of test live here, and the difference is deliberate
 *
 * **Assertions.** Where the code handles the shape, the test says so, and the
 * plan records the mutation that reddens it.
 *
 * **Pins.** Three tests below are marked `PINS AN OPEN DEFECT`, and they pin
 * **one** root defect and its two downstream witnesses: stage 3 promotes a
 * sentence fragment to a block, and that block then reaches a label batch on
 * two different articles. Counted this way on purpose — the fix is one change,
 * and a reader who thinks there are three will go looking for three. Its real
 * fix moves block
 * ids — up to ~178 of `greatwork`'s 330 — so it needs the stage's owner and Greg
 * (docs/project/block-ids.md). For those the test pins **what the code does
 * today**, marked `PINS AN OPEN DEFECT`.
 *
 * > **If a pin goes red, read it as news rather than as a regression.** A
 * > partial improvement reddens it too, which is the point: somebody looks.
 * > When the fix lands, invert the assertion and strike the open item from the
 * > postmortem it names.
 *
 * A pin rather than an aspirational red test because 260830a wrote three
 * assertions, watched them go red, and deliberately did **not** commit them:
 * their fixes are unapplied, so committing would have left the gate permanently
 * red, "and a permanently-red test is one everybody learns to ignore".
 *
 * Not `it.fails`, which turns *any* throw into a pass, so a defect changing into
 * a different defect would stay green — and not `it.todo`, which does not run.
 * An exact pin keeps the current failure mode observable. It does not make it
 * immortal: a pin can still go semantically stale, and the comment on each says
 * what would make it so.
 */
import { describe, expect, it } from "vitest";

import { splitIntoBlocks } from "../src/blocks.js";
import { type BuildReport, type ModelNode, buildTree } from "../src/hierarchy.js";
import { isSpideryarnId } from "../src/ids.js";
import { planBatches } from "../src/labels.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block } from "../src/types.js";
import {
  OLD_HTML_ONE_HEADING,
  STRIPPED_MEDIA_LEAD_INS,
  flatTree,
  syntheticId,
} from "./fixtures/adversarial-shapes.js";

/**
 * Every block `planBatches` would put in front of the label model.
 *
 * `planBatches` walks sibling sets, so a batch needs a tree to walk;
 * `flatTree` is the least structure that puts every block in exactly one batch,
 * which is what makes "was this block asked about" a question about the label
 * policy rather than about the carving.
 */
function blocksAskedAbout(blocks: Block[], slug: string): Block[] {
  const tree = flatTree(blocks, slug);
  /* The tree the question is asked over must itself be sound, or the answer is
     about a malformed tree rather than about the article. */
  expect(checkTree(blocks, tree).problems).toEqual([]);
  return planBatches(tree, blocks).flatMap((b) => b.blocks);
}

describe("the fixture module's own guarantees", () => {
  it("mints ids the id format actually accepts", () => {
    /* An earlier draft of adversarial-shapes.ts wrote `spya-adv001` under a
       comment explaining that `1` is not in the alphabet — the exact mistake the
       committed corpus had already made once, where it surfaced as a
       check-constraint violation three files from its cause. Asserted rather
       than commented, since the comment is what failed last time. */
    const ids = Array.from({ length: 64 }, (_, i) => syntheticId(i));
    expect(ids.filter((id) => !isSpideryarnId(id))).toEqual([]);
    expect(new Set(ids).size, "and they are distinct").toBe(ids.length);
  });
});

describe("an old hand-written HTML page whose only heading is its title", () => {
  const { blocks } = splitIntoBlocks(OLD_HTML_ONE_HEADING);

  it("has exactly one heading block, though a reader can see two section headers", () => {
    /* The gap is the whole of 260830a's symptom 2. `Notes` is a <b>, so stage 3
       gives it kind "text"; the structure model reads the rendered article, sees
       a heading, and quotes it as `sourceHeading` — four calls out of four did on
       the real page. */
    const headings = blocks.filter((b) => b.kind === "heading");
    expect(headings.map((b) => b.text)).toEqual(["The Need To Read"]);
    expect(
      blocks.map((b) => b.text),
      "the bolded section header must survive as a text block, or the fixture " +
        "has stopped carrying the shape it is kept for",
    ).toContain("Notes");
  });

  it("drops a sourceHeading claiming the bolded header, and still builds a sound tree", () => {
    /* **260830a's recommendation 2, and it is built** — `buildTree` strips an
       unbacked `sourceHeading` rather than throwing on it, because four calls in
       four made the same wrong claim on this article, which makes a refusal a
       guaranteed failure loop rather than an occasional loss.

       This is the assertion the postmortem's own parked test could not make: it
       asserted `checkTree` had nothing to complain about, which is a statement
       about a validator branch. This one runs the repair over this article's
       real block list and asks what the pipeline now does with it. */
    /* **The Notes child must actually contain the `Notes` block**, or the claim
       is dropped merely for being out of range and the test passes without ever
       reaching the branch it is about — it would then keep passing after `<b>`
       became a real heading. Anchored to the block's own index rather than
       counted back from the end. GPT Sol's stage review, 2026-09-08. */
    const notesAt = blocks.findIndex((b) => b.text === "Notes");
    expect(notesAt, "the fixture must still carry the bolded section header").toBeGreaterThan(0);

    const proposal: ModelNode = {
      title: "The Need To Read",
      gist: "The piece argues that reading and writing cannot be separated.",
      range: [blocks[0]!.id, blocks[blocks.length - 1]!.id],
      sourceHeading: "The Need To Read",
      children: [
        {
          title: "The Argument",
          gist: "It opens with the claim.",
          range: [blocks[0]!.id, blocks[notesAt - 1]!.id],
        },
        {
          /* Starts *at* `Notes`, so the range contains the block the claim
             names. It is still refused, because that block is a <b> and so has
             kind "text" — which is the whole of symptom 2. */
          title: "Notes",
          gist: "The footnotes qualify the argument.",
          range: [blocks[notesAt]!.id, blocks[blocks.length - 1]!.id],
          sourceHeading: "Notes",
        },
      ],
    };

    const report: BuildReport = {
      repairs: [],
      droppedChildren: [],
      droppedHeadings: [],
      collapsedRungs: [],
      droppedQuestions: [],
    };
    const tree = buildTree(proposal, {}, blocks, "old-html-one-heading", report);

    expect(report.droppedHeadings, "the unbacked claim is counted, not silently lost").toHaveLength(
      1,
    );
    const kept = Object.values(tree.nodes).filter((n) => n.sourceHeading === "Notes");
    expect(kept, "a badge saying the author wrote this heading would be a lie").toEqual([]);
    expect(
      checkTree(blocks, tree).problems,
      "and the repair is complete: the tree publication would refuse now passes",
    ).toEqual([]);
  });

  it("PINS AN OPEN DEFECT: the splitter emits one-word fragments claiming prose of their own", () => {
    /* **The producer half, and it is deliberately not filtered through
       `isStructural`.** 260830a § The fix, item 4: stage 3 should merge a
       contentful inline element into the adjacent block rather than stand it
       beside one. Not built, and not ours — it re-identifies every paragraph
       that absorbs a fragment, and everything anchors on block id.

       Reading this through the label policy, as an earlier draft did, would
       conflate two separable defects: tightening the *policy* would redden it
       while stage 3 went on emitting exactly these blocks, and the failure
       message would then tell the next agent that item 4 was fixed. It is not
       one defect wearing two coats — the postmortem is explicit that
       labellability wants a **sixth predicate in block-policy.ts, not a widened
       `isStructural`**, precisely because widening drags search, reading time
       and embedding along with it. GPT Sol's stage review, 2026-09-08. */
    const fragments = blocks.filter((b) => b.gistable && b.words <= 1);
    expect(
      fragments.map((b) => b.text),
      "if this fails, find out whether the splitter improved or regressed; if " +
        "260830a item 4 landed, replace this pin with its desired invariant " +
        "and strike the item — do not merely refresh the expected value",
    ).toEqual(["[1]", "[", "1"]);
  });

  it("PINS AN OPEN DEFECT: asks the label model for a nav label it can only refuse", () => {
    /* The consequence one stage on, and why the article cost $0.39 without ever
       producing a table of contents. Every one of the nine ordinals dropped
       across two attempts was a one-word fragment; picking those nine at random
       from 21 would happen about three times in a hundred thousand. */
    const asked = blocksAskedAbout(blocks, "old-html-one-heading");
    expect(
      asked.filter((b) => b.words <= 1).map((b) => b.text),
      "a one-word fragment cannot ground a claim, so the model omits it. If " +
        "this fails, find out whether the label policy or the splitter changed — " +
        "they are separable defects — and replace this pin with the invariant " +
        "whichever fix earned, rather than refreshing the expected value",
    ).toEqual(["[1]", "[", "1"]);
  });
});

describe("a page whose media was stripped, leaving lead-ins pointing at nothing", () => {
  const { blocks } = splitIntoBlocks(STRIPPED_MEDIA_LEAD_INS);

  it("leaves an empty paragraph where each stripped cell was", () => {
    /* A fixture-integrity guard, not a behaviour assertion: the two assertions
       either side of it are meaningless if the emptied paragraphs quietly stop
       existing. If a future splitter drops them, check whether the lead-ins
       still strand before touching this. */
    expect(blocks.filter((b) => b.text.trim() === "")).toHaveLength(3);
  });

  it("never asks the label model about an emptied media paragraph", () => {
    /* This half the pipeline gets right, and it is worth pinning precisely
       because the other half does not. */
    const asked = blocksAskedAbout(blocks, "stripped-media");
    expect(
      asked.filter((b) => b.text.trim() === ""),
      "an empty paragraph has nothing to describe and must never reach a batch",
    ).toEqual([]);
  });

  it("PINS AN OPEN DEFECT: asks the label model about a bare one-word lead-in", () => {
    /* 260830e's article had fifteen bare lead-ins and one was the single word
       "or". The prompt asks for a CLAIM or a MOVE and forbids introducing a fact
       not in the paragraph; for a lead-in whose case *was* the stripped image
       those are jointly unsatisfiable. The model skipped it — the compliant
       answer — and a call that had done its job 57 times out of 58 was thrown
       away. Same root cause as the pin above; this is its second witness.

       What happens *after* this point is exercised against these same blocks in
       tests/labels-shortfall.test.ts § a hostile article. */
    const asked = blocksAskedAbout(blocks, "stripped-media");
    expect(
      asked.filter((b) => b.words === 1).map((b) => b.text),
      "if this fails, find out whether the label policy or the splitter changed, " +
        "and replace this pin with the invariant whichever fix earned",
    ).toEqual(["or"]);
  });
});
