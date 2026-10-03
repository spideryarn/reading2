/**
 * Parity pin for the structure call — the exact bytes generateStructure sends.
 *
 * Written BEFORE the wholeDocumentRequest extraction and seen passing against the
 * un-refactored src/structure.ts, so the refactor is provably a pure extraction: the
 * pinned bytes are a snapshot of what production sent on 2026-08-30, copied
 * here once, not derived at run time from the code under test (an expectation
 * derived from the thing it checks agrees with every value of it).
 *
 * It exists because the eval executor (evals/structure-whole-document/model-arms.ts)
 * builds the same request through the shared wholeDocumentRequest export, and an
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
 * The block below was then byte-identical to `evals/summaries/variants.md`
 * § V4, which is the copy the eval measured; since `toc/8` it is V4 with one
 * bullet replaced (below). `tests/summaries-eval.test.ts` asserts exactly that
 * relation, so this pin and that one cannot drift apart quietly.
 * docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md.
 *
 * **RE-PINNED 2026-09-26 for `toc/8`**, and it fired the same way a third
 * time: the GISTS block's plain-word bullet became three — a name is a
 * handhold, not an explanation, so a term the reader would not know must be
 * made understandable; that explaining counts toward the word limit; and
 * plainer means equally specific. Greg, SPIDERYARN-READING2-44. And the
 * QUESTIONS block's last bullet moved with them: the topic keeps the
 * article's term as the handhold, and the question after it must make sense
 * to a reader who does not know that term — because a blind eval showed
 * depth-1 questions did not get plainer from the GISTS cross-reference alone.
 * So QUESTIONS is now `evals/summaries/variants.md` § V4 with that one bullet
 * replaced, and nothing else. Once more before `toc/8` shipped, on 2026-09-28:
 * the depth-1 gist ceiling went from 25 to 30 words, because the plain lines
 * needed the room (Greg: "plain beats short"; plan 260926a § Stage 2).
 * **RE-PINNED 2026-09-28 for `toc/9`**: the shared plain-words core,
 * `plainWords()` from src/plain-words.ts, now ends SYSTEM, after OUTPUT. The
 * pin holds its text literally, not by calling `plainWords()`, so an edit to the
 * shared rule reddens this pin too — which is what it should do, since every
 * byte of it is sent. Plan 260926a § Stage 3.
 * **RE-PINNED 2026-10-01 for `toc/10`**: the paperwork rule,
 * `paperwork("structure")` from src/paperwork.ts, follows the plain-words core,
 * held literally for the same reason (Greg, SPIDERYARN-READING2-8M; plan 261001p).
 * **RE-PINNED 2026-10-03 for `toc/12`**: the paperwork list names the title
 * block and the reference list, and Structure's abstract paragraph follows it
 * (Greg, spya-abs6bj; plan 261003c).
 * docs/plans/260926a-plainer-summaries-and-glossary.md.
 */

import { describe, expect, it, vi } from "vitest";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import type { Block } from "../src/types.js";

/* The capture. streamMessage is mocked to record the one body generateStructure
   hands it and then fail the call, so nothing model-shaped runs and nothing
   past the structure call (the label pass, the artefact writes) executes. */
const captured: { task: string; body: Record<string, unknown> }[] = [];

/* The real module, with only the two functions replaced. It was a bare factory
   until 2026-09-04, and that is a shape worth not going back to: the day
   src/structure.ts started importing `MESSAGES_PROVIDER` as well — for the
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

const { generateStructure, wholeDocumentRequest, STRUCTURE_OUTPUT_SCHEMA } = await import("../src/structure.js");
const { toc10FrozenRequest } = await import("../evals/structure-whole-document/toc10-frozen.js");

/** The system prompt production sends, byte for byte. THE pin — do not "tidy" it. */
const EXPECTED_TOC10_SYSTEM = `You are building a nested table of contents for an article. It goes all the
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
    - depth 1: AT MOST 30 words. Chapter-level orientation.
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
- Keep the article's own name for a thing the reader will meet again in the
  prose: it is their handhold. But a handhold is not an explanation. If a
  curious reader from outside the field would not already know the term, the
  sentence must make it understandable anyway: say it in ordinary words
  instead, or keep it and let the rest of the sentence show what it is. Work
  the meaning into the claim; no dictionary asides in brackets. Never leave a
  hard word bare, and never explain an ordinary one.
- That explaining counts toward the word limit, and the limit wins. The root
  and depth-1 gists keep at most ONE term of art; say the rest in ordinary
  words and leave those terms to the finer lines, which have room to keep them
  and explain them. Cut a clause of detail before you cut the plainness.
- Everything that is not a name gets the commonest word that loses nothing.
  Plainer means equally specific: the same claim in commoner words, never a
  looser one. Do not lose a number, name, direction, comparison or condition
  the claim depends on — "uses a clever method" for "uses gradient descent" is
  vaguer, not plainer. A gist is read at a glance and has to land first time:
  plainer than the article, never further from it.
- Check each gist before you send it: list the words in it a reader from
  outside the field would not know. Each must be either explained by the
  sentence it is in, or gone.
- For example, a depth-1 part of a genetics paper:
  BAD: "The ACE model decomposes phenotypic variance into additive genetic,
  shared-environment and non-shared-environment components."
  GOOD: "Comparing identical with non-identical twins splits how much people
  differ into what genes explain, what a shared home explains, and what neither
  does."
  The GOOD line replaces the terms rather than explaining each one, fits the
  limit, and loses nothing the BAD line claimed; "ACE model" can be kept and
  explained in the finer lines below it.

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
- Under 20 words in all. Digits for counts. The topic keeps the article's own
  term as the handhold; the question after it is in ordinary words and must
  make sense to a reader who does not know that term yet. No other term of
  art, exactly as with gists.

OUTPUT

JSON only, no prose, no code fence:

{"root": {"title": "...", "gist": "...", "question": "...",
          "range": ["<firstBlockId>", "<lastBlockId>"],
          "sourceHeading": "...", "children": [ ... ]}}

Use only block ids that appear in the input. Do not invent ids.

PLAIN WORDS

Write for a curious reader who has not studied this field. If these
instructions, or the reader's own description, say who the reader is, write
for them instead: a specialist does not need their own field's terms explained.

Use the commonest word that loses nothing. This changes the words, never the
meaning: plainer means equally specific. Never drop a number, a direction, a
comparison, a condition or a hedge ("may", "in mice", "in this sample") that
the claim depends on; a sentence that is plainer and less exact is worse. It
never changes which field a fact belongs in, which source may support it, or
the shape and length these instructions set for each field: where those rules
are more specific, they win. Text you are told to copy exactly stays exactly as written.

Plainer than the article, never further from it: never less exact, and never beyond what it says.

PAPERWORK IS NOT THE PIECE

Around a piece's content there may be paperwork: the title block (the title,
subtitle, byline, dates, DOI, keywords and the journal's header), the list of
authors and where they work, contact and correspondence details,
acknowledgements and thanks, funding and grants, conflict-of-interest and other
disclosures, ethics approval, author contributions, data-availability
statements, the publisher's notices, and, at the end, the reference list or
bibliography and any lists of backlinks or related links. Where it only
identifies the piece or records how it was produced, published and sourced, it
is paperwork.
A range that is only paperwork still gets its node, because every block
must be covered. For a paperwork-only node, as an exception to the gist rules
above, its gist is a short plain label of WHAT it is ("The authors and
where they work.", "Funding and conflict-of-interest statements."), never what
it says, with no word floor and no claim. Leave "question" empty on it, at any
depth. Gists outside that node, the root's included, ignore the paperwork.

Judge it by what it does, not by its heading. If the piece uses any of these as
evidence, reasoning, method or a limit on its findings — a funder's role that
it says may bias the result, an ethics rule that shaped the study, an article
ABOUT research funding — it is content, and the usual rules apply.

The abstract at the START of a paper is the author's own summary of all of
it, and the root and the other parts already say what it says. A node whose
range is only the abstract, or only the abstract and paperwork, gets the
paperwork node's treatment above: a short plain label of what it is ("The
authors' summary of the paper."), no claim, no word floor, and no question
(leave "question" empty). Gists outside that node may still draw on the
abstract. A summary or key-points box at the start is treated the same way
only where the body goes on to make each of its claims; where it says something
the body does not, it is content. A "Summary" or "Conclusions" section after
the body has begun is content, and the usual rules apply.`;

const EXPECTED_SYSTEM = EXPECTED_TOC10_SYSTEM
  .replace(
    `Produce a tree of INTERNAL nodes only. Every node covers a contiguous range of
blocks, and a node's children exactly partition its range — no gaps, no
overlaps, no reordering. The first child starts where its parent starts; the
last child ends where its parent ends.`,
    `Produce a tree of INTERNAL nodes only. The root covers the whole input and has no
"start". Give each child one "start": the id of the first block it covers. Do
not give an end — ends are computed from the next child's start, and the last
child ends where its parent ends. The first child must start where its parent
starts. List children in document order; after the first child, each "start"
must occur strictly later than the previous child's start. Do not write a range
anywhere.`,
  )
  .replace(
    `{"root": {"title": "...", "gist": "...", "question": "...",
          "range": ["<firstBlockId>", "<lastBlockId>"],
          "sourceHeading": "...", "children": [ ... ]}}`,
    `{"root": {"title": "...", "gist": "...", "question": "...",
          "sourceHeading": "...", "children": [
            {"title": "...", "gist": "...", "question": "...",
             "start": "<firstBlockId>", "children": [ ... ]}
          ]}}`,
  );

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

/* estimateStructureTokens: five blocks cannot force more sections than the tree
   the prompt asks for on any article, so it is the floor — 81 sections plus the
   9 chapters and the root above them, 91 nodes at 175, plus the 500-token
   envelope = 16,425. budgetFor adds STRUCTURE_HEADROOM's 64,000. Literals, not
   the formulae re-run: this pin fired when the estimator and the reservation
   both moved on 2026-09-04, which is it working. */
const EXPECTED_MAX_TOKENS = 80_425;

/* No temp directory: the stage takes the blocks themselves and writes nothing,
   so the fixture is the array above and the pinned bytes are unaffected. */

describe("the structure call's request", () => {
  it("keeps the frozen arm on toc/10's exact request bytes", () => {
    const frozen = toc10FrozenRequest(BLOCKS);
    expect(frozen.system).toBe(EXPECTED_TOC10_SYSTEM);
    expect(frozen.user).toBe(EXPECTED_USER);
    expect(frozen.maxTokens).toBe(EXPECTED_MAX_TOKENS);
    expect(frozen.params).toEqual({
      max_tokens: EXPECTED_MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: EXPECTED_TOC10_SYSTEM,
      messages: [{ role: "user", content: EXPECTED_USER }],
    });
  });

  it("sends exactly the pinned bytes and settings", async () => {
    captured.length = 0;
    await expect(
      generateStructure({ power: "standard", blocks: BLOCKS, slug: "fixture", checkpoints: nullCheckpointStore() }),
    ).rejects.toThrow(); // the mocked call fails on purpose, after capture
    expect(captured).toHaveLength(1);

    const { task, body } = captured[0]!;
    expect(task).toBe("structure");
    expect(body.system).toBe(EXPECTED_SYSTEM);
    expect(body.messages).toEqual([{ role: "user", content: EXPECTED_USER }]);
    expect(body.thinking).toEqual({ type: "adaptive" });
    /* `low` since 2026-09-04, `medium` from 2026-08-30 before that. Written out
       rather than read from `EFFORT`, which is the whole point of a pin:
       importing the constant would make this agree with any value the stage
       happens to hold. It has now fired on both changes, which is it working.
       See the note on `EFFORT` in src/structure.ts for the evidence behind the
       current value. */
    expect(body.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: STRUCTURE_OUTPUT_SCHEMA },
    });
    expect(body.max_tokens).toBe(EXPECTED_MAX_TOKENS);
    // Nothing else rides along: the exact key set is part of the request.
    expect(Object.keys(body).sort()).toEqual([
      "max_tokens", "messages", "output_config", "system", "thinking",
    ]);
  });

  it("wholeDocumentRequest is the same request - parity by construction, checked anyway", async () => {
    captured.length = 0;
    await expect(
      generateStructure({ power: "standard", blocks: BLOCKS, slug: "fixture", checkpoints: nullCheckpointStore() }),
    ).rejects.toThrow();
    const { body } = captured[0]!;
    const req = wholeDocumentRequest(BLOCKS);
    expect(req.system).toBe(body.system);
    expect(req.user).toBe((body.messages as { content: string }[])[0]!.content);
    expect(req.maxTokens).toBe(body.max_tokens);
    expect(req.effort).toBe((body.output_config as { effort: string }).effort);
  });
});
