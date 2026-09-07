/**
 * Parity pin for the structure call — the exact bytes generateHierarchy sends.
 *
 * Written BEFORE the structureRequest extraction and seen passing against the
 * un-refactored src/hierarchy.ts, so the refactor is provably a pure extraction: the
 * pinned bytes are a snapshot of what production sent on 2026-08-30, copied
 * here once, not derived at run time from the code under test (an expectation
 * derived from the thing it checks agrees with every value of it).
 *
 * It exists because the eval executor (evals/hierarchy-structure/model-arms.ts)
 * builds the same request through the shared structureRequest export, and an
 * executor that drifted by one byte of prompt would be measuring a recipe the
 * pipeline does not ship — GPT Sol's finding 7, the phase-2 blocker.
 *
 * SEEN RED, 2026-08-30, twice, before being trusted: once with a single space
 * added to SYSTEM (the system-bytes assertion fired), once with EFFORT flipped
 * to "medium" (the output_config assertion fired). Both perturbations reverted.
 *
 * **RE-PINNED 2026-09-06 for `toc/6`**, and this is the only reason to touch the
 * literal below: the GISTS block gained a per-depth length ceiling, a ban on
 * meta-narration and a plain-word rule, so the bytes moved on purpose. It fired
 * exactly as designed — the change reached this pin before it reached anything
 * that costs money. Re-pin only alongside a deliberate edit to SYSTEM, and say
 * which in the commit message.
 * docs/plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md.
 *
 * **RE-PINNED AGAIN 2026-09-07 for `toc/7`**, and it fired the same way: the
 * QUESTIONS block became V4 — the reading order Greg drew, `<topic> —
 * <question>? (<shape hint>)` — so the bytes moved on purpose a second time.
 * The block below is byte-identical to `evals/summaries/variants.md` § V4,
 * which is the copy the eval measured; `tests/summaries-eval.test.ts` asserts
 * that identity, so this pin and that one cannot drift apart quietly.
 * docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md.
 */

import { describe, expect, it, vi } from "vitest";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import type { Block } from "../src/types.js";

/* The capture. streamMessage is mocked to record the one body generateHierarchy
   hands it and then fail the call, so nothing model-shaped runs and nothing
   past the structure call (the label pass, the artefact writes) executes. */
const captured: { task: string; body: Record<string, unknown> }[] = [];

/* The real module, with only the two functions replaced. It was a bare factory
   until 2026-09-04, and that is a shape worth not going back to: the day
   src/hierarchy.ts started importing `MESSAGES_PROVIDER` as well — for the
   structure checkpoint's key — the factory answered "no such export" and the
   stage threw before it ever reached the capture, so this pin failed as *no
   request made* rather than as a request that differed. Spreading the original
   means a new import over there cannot break the pin over here. */
vi.mock("../src/messages-stream.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/messages-stream.js")>()),
  streamMessage: (task: string, body: Record<string, unknown>) => {
    captured.push({ task, body });
    return {
      onText: () => {},
      finalMessage: () => Promise.reject(new Error("parity-sentinel: request captured")),
      aborted: () => false,
    };
  },
  wasRefused: () => false,
}));

const { generateHierarchy, structureRequest } = await import("../src/hierarchy.js");

/** The system prompt production sends, byte for byte. THE pin — do not "tidy" it. */
const EXPECTED_SYSTEM = `You are building a nested table of contents for an article. It goes all the
way down to individual paragraphs, and it will be rendered as a navigation sidebar.

You receive the article as a numbered list of blocks. Each block has an id
(e.g. spya-k3m9qt), a tag, and its text. Some are marked NOT-GISTABLE.

STRUCTURE

Produce a tree of INTERNAL nodes only. Every node covers a contiguous range of
blocks, and a node's children exactly partition its range — no gaps, no
overlaps, no reordering. The first child starts where its parent starts; the
last child ends where its parent ends.

- The article's own headings are HARD boundaries. A node must begin at a
  heading block wherever one exists. Never merge across a heading.
- Where a run between headings is longer than ~9 blocks, propose your own
  boundaries inside it at genuine topic shifts, and title those nodes.
- Aim for 5-9 children per node so each level is an even stride.
- Go 3 levels deep: root (depth 0), chapters (depth 1), sections (depth 2).
- Do NOT emit leaf nodes for individual blocks. Stop at the section level.

TITLES (internal nodes)

- 2-6 words. A title is a landmark, scanned at a glance.
- Where the author gave the section a heading, use that heading's text
  UNCHANGED and repeat it in "sourceHeading". Rewrite it ONLY if it shares no
  content word with its section body, or is a stock label ("Introduction",
  "Background", "Part Two"). Rewriting should be rare.
- A title you write yourself uses the article's own words for what it names and
  ordinary words for the rest. A heading you copy is copied unchanged.
- No trailing punctuation.

GISTS (internal nodes)

- Exactly ONE sentence. This is what the reader sees at the zoom level above.
- It must be a CLAIM or a MOVE, not a topic label.
- Write a parent's gist from its children, not from the raw text.
- LENGTH IS SET BY WHERE THE LINE IS READ, and it runs SHORTER as the node gets
  coarser:
    - the root: AT MOST 18 words. It is the shelf blurb — THE ONE claim the
      piece makes, or its one governing move if it makes no single claim,
      shorter than any chapter's gist. A root that runs "X stems from A and B,
      so we should C while reaffirming D" is four gists wearing one full stop.
      Pick the claim they add up to and stop there.
    - depth 1: AT MOST 25 words. Chapter-level orientation.
    - deeper than that: AT LEAST 22 words, and at most 32. The floor is the
      half that will feel wrong, so obey it: down here a one-clause gist is too
      SHORT, not admirably terse. A reader at this zoom is reading your sentence
      INSTEAD of the paragraphs it covers, so give them the claim AND the ground
      it stands on — its reason, contrast, consequence or example. The floor
      does not apply where the RANGE itself is slight: a title, a credit line, a
      URL, a heading with nothing under it. Never pad, never invent support, and
      never move a boundary to reach a word count.
- No narration of document order: not "the essay opens by", "the essay closes by
  urging", "this section explores", "the author then turns to", "goes on to".
  Say what the section CLAIMS; do not narrate that it is claiming. Ordinary
  "then" and "next" inside a claim are fine — "if X, then Y" may BE the claim.
- Keep the article's own words for the things it names — those are the reader's
  handholds — and ordinary words for everything else. Where a shorter, commoner
  word loses nothing, use it. A gist is read at a glance and has to land first
  time: plainer than the article, never further from it.

QUESTIONS (the root and depth-1 nodes only)

- Exactly ONE question on the root and on each depth-1 node. Omit it entirely
  on deeper nodes.
- It is the question this node is BUILT to answer — the author's question, not
  a reader's. A reader must be able to tell from this line alone whether to go
  in: it carries the same direction as the gist, in a different mood.
- Shape: "<topic> — <question>? (<shape hint>)" — the topic first, in the
  author's own term; then the question, ending in "?"; then an optional hint
  in brackets. Nothing follows the hint.
- The question presupposes where the section lands. "Why isn't computation
  sufficient" carries the claim; "is computation sufficient?" hides it. So
  "why", "how", "what follows if" — never "which", "who", or anything a single
  fact settles.
- Where the section does NOT land — it weighs, describes, or leaves the matter
  open — do not invent a landing. Ask the question it leaves open and let the
  hint say so: "(two options weighed)", "(no settled answer)".
- The hint is the SHAPE of the answer, never its content: a count or a kind
  ("a thought experiment", "two case studies", "a recommendation"). A count
  only when the section itself counts ("four arguments") or you could list
  each item from its text. Never count this node's children — that is a
  different number. Omit the hint when there is no honest shape.
- The root's question is the one the whole piece exists to answer.
- Not rhetorical, not yes/no, never the gist with a question mark on it.
- Under 20 words in all. Digits for counts. The article's own words for what it
  names, ordinary words for the rest, exactly as with gists.

OUTPUT

JSON only, no prose, no code fence:

{"root": {"title": "...", "gist": "...", "question": "...",
          "range": ["<firstBlockId>", "<lastBlockId>"],
          "sourceHeading": "...", "children": [ ... ]}}

Use only block ids that appear in the input. Do not invent ids.`;

const BLOCKS: Block[] = [
  { id: "spya-par001", tag: "h2", kind: "heading", level: 2, text: "First Part", words: 2, html: "<h2>First Part</h2>", gistable: true },
  { id: "spya-par002", tag: "p", kind: "text", text: "Some prose about turnips.", words: 4, html: "<p>Some prose about turnips.</p>", gistable: true },
  { id: "spya-par003", tag: "img", kind: "media", text: "A diagram.", words: 2, html: "<img>", gistable: false },
  { id: "spya-par004", tag: "h2", kind: "heading", level: 2, text: "Second Part", words: 2, html: "<h2>Second Part</h2>", gistable: true },
  { id: "spya-par005", tag: "p", kind: "text", text: "More prose entirely.", words: 3, html: "<p>More prose entirely.</p>", gistable: true },
];

/** What renderBlocks makes of those five, spelled out rather than recomputed. */
const EXPECTED_USER = [
  "[0] spya-par001 <h2>: First Part",
  "[1] spya-par002 <p>: Some prose about turnips.",
  "[2] spya-par003 <img> NOT-GISTABLE: A diagram.",
  "[3] spya-par004 <h2>: Second Part",
  "[4] spya-par005 <p>: More prose entirely.",
].join("\n\n");

/* estimateHierarchyTokens: five blocks cannot force more sections than the tree
   the prompt asks for on any article, so it is the floor — 81 sections plus the
   9 chapters and the root above them, 91 nodes at 175, plus the 500-token
   envelope = 16,425. budgetFor adds STRUCTURE_HEADROOM's 64,000. Literals, not
   the formulae re-run: this pin fired when the estimator and the reservation
   both moved on 2026-09-04, which is it working. */
const EXPECTED_MAX_TOKENS = 80_425;

/* No temp directory: the stage takes the blocks themselves and writes nothing,
   so the fixture is the array above and the pinned bytes are unaffected. */

describe("the structure call's request", () => {
  it("sends exactly the pinned bytes and settings", async () => {
    captured.length = 0;
    await expect(
      generateHierarchy({ blocks: BLOCKS, slug: "fixture", checkpoints: nullCheckpointStore() }),
    ).rejects.toThrow(); // the mocked call fails on purpose, after capture
    expect(captured).toHaveLength(1);

    const { task, body } = captured[0]!;
    expect(task).toBe("hierarchy");
    expect(body.system).toBe(EXPECTED_SYSTEM);
    expect(body.messages).toEqual([{ role: "user", content: EXPECTED_USER }]);
    expect(body.thinking).toEqual({ type: "adaptive" });
    /* `low` since 2026-09-04, `medium` from 2026-08-30 before that. Written out
       rather than read from `EFFORT`, which is the whole point of a pin:
       importing the constant would make this agree with any value the stage
       happens to hold. It has now fired on both changes, which is it working.
       See the note on `EFFORT` in src/hierarchy.ts for the evidence behind the
       current value. */
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.max_tokens).toBe(EXPECTED_MAX_TOKENS);
    // Nothing else rides along: the exact key set is part of the request.
    expect(Object.keys(body).sort()).toEqual([
      "max_tokens", "messages", "output_config", "system", "thinking",
    ]);
  });

  it("structureRequest is the same request - parity by construction, checked anyway", async () => {
    captured.length = 0;
    await expect(
      generateHierarchy({ blocks: BLOCKS, slug: "fixture", checkpoints: nullCheckpointStore() }),
    ).rejects.toThrow();
    const { body } = captured[0]!;
    const req = structureRequest(BLOCKS);
    expect(req.system).toBe(body.system);
    expect(req.user).toBe((body.messages as { content: string }[])[0]!.content);
    expect(req.maxTokens).toBe(body.max_tokens);
    expect(req.effort).toBe((body.output_config as { effort: string }).effort);
  });
});
