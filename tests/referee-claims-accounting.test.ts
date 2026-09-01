/**
 * **The two things Claims added after an eval found the hole in it** — the
 * sentences a run did not account for, and the fail-safe on adequacy language.
 *
 * Both are in src/referee-claims.ts, both are pure, and both exist because
 * `evals/results/referee-claims.md` said something the panel could not have
 * shown:
 *
 * 1. **A claim that never gets a row is invisible.** The sub-mode's defence
 *    against *a tired referee treats everything unlisted as clean* is
 *    `NO_PASSAGE_FOUND` — a claim that gets a row and an honest sentence under
 *    it. Two of the eval's papers silently dropped a claim from their own
 *    abstract, twice each, identically; the dropped claim's words reached the
 *    answer inside a **neighbouring claim's quote**, and the panel looked
 *    exactly as tidy as one that had missed nothing. `otherTextInQuotes` is
 *    the other side of that door.
 * 2. **Linkage, never adequacy, was held by nothing but the prompt.** The
 *    ablated control — the same paper with the prompt's refusals cut out — came
 *    back with six adequacy verdicts in eleven passages. `validateClaims` now
 *    blanks a `reasoning` line that reads as one and hands back what it blanked.
 *
 * **Every fixture here is real committed output**, quoted from that transcript,
 * against the real papers it was answered about. That is the point: a
 * synthetic fixture would prove the functions do what they were written to do,
 * and what is being asked is whether they would have caught what actually
 * happened. The lines that must fire are from the ablation; the lines that must
 * not are from the guarded runs, four of them minimal pairs of the ablated ones
 * from the same paragraph of the same paper.
 *
 * Deterministic, no network, no model call.
 */
import { describe, expect, it } from "vitest";

import {
  adequacyFrames,
  MAX_PASSAGES,
  otherTextInQuotes,
  paperPhrases,
  subtractPaperPhrases,
  validateClaims,
} from "../src/referee-claims.js";
import type { Block } from "../src/types.js";

const paper = (rows: readonly (readonly [string, string])[]): Block[] =>
  rows.map(([id, text]) => ({ id, text }) as Block);

/* ------------------------------------------------------------ the papers -- */

/**
 * The Ridge paper, in full — `neverTakenUp` in evals/referee-claims.ts.
 *
 * Its abstract makes **three** claims in one sentence: faster, less memory,
 * robust to adversarial inputs. Both paid runs returned two claims and neither
 * was the memory one or the robustness one.
 */
const RIDGE = paper([
  [
    "spya-ntab01",
    "We present Ridge, a register allocator that compiles large programs faster, uses less peak memory than the current allocator, and is robust to adversarially constructed inputs.",
  ],
  [
    "spya-ntin01",
    "Register allocation dominates compile time on the largest translation units, and the allocator in use today was designed when peak memory was not a constraint.",
  ],
  [
    "spya-ntrw01",
    "Adversarial inputs to register allocators have been studied by Okonjo and Weiss, who constructed graphs on which the classical algorithm degrades to quadratic time.",
  ],
  [
    "spya-ntme01",
    "Ridge colours the interference graph in two phases, spilling greedily in the first and re-running only the affected components in the second.",
  ],
  [
    "spya-ntr101",
    "Across the 40 translation units in our corpus, Ridge compiled in a median of 3.1 seconds against the current allocator's 5.4, a 43 per cent reduction.",
  ],
  [
    "spya-nttb01",
    "Table 1. Median compile time in seconds, by translation unit size. Small 0.4 against 0.5, medium 1.9 against 3.0, large 3.1 against 5.4.",
  ],
  [
    "spya-ntr201",
    "Peak resident memory fell from 1.9 GB to 1.2 GB on the largest unit, and no unit in the corpus used more memory under Ridge than under the current allocator.",
  ],
  [
    "spya-ntdi01",
    "The two-phase structure is what buys both numbers: the second phase touches only the components that spilled, so the work is proportional to the damage rather than to the program.",
  ],
]);

/** What the model actually returned for it, on 2026-09-01 and again six minutes later. */
const RIDGE_ANSWER = {
  claims: [
    {
      blockId: "spya-ntab01",
      quote:
        "We present Ridge, a register allocator that compiles large programs faster, uses less peak memory than the current allocator, and is robust to adversarially constructed inputs.",
      claim: "Ridge compiles large programs faster",
      passages: [
        {
          blockId: "spya-ntr101",
          quote:
            "Across the 40 translation units in our corpus, Ridge compiled in a median of 3.1 seconds against the current allocator's 5.4, a 43 per cent reduction.",
          reasoning: "reports the overall compile-time figures the claim refers to",
        },
      ],
    },
    {
      blockId: "spya-ntme01",
      quote:
        "Ridge colours the interference graph in two phases, spilling greedily in the first and re-running only the affected components in the second.",
      claim: "Ridge uses a two-phase coloring method",
      passages: [
        {
          blockId: "spya-ntdi01",
          quote:
            "The two-phase structure is what buys both numbers: the second phase touches only the components that spilled, so the work is proportional to the damage rather than to the program.",
          reasoning: "explains how the two-phase design produces the reported results",
        },
      ],
    },
  ],
};

/**
 * The `appraisal` paper's abstract, and the answer the model gave for it.
 *
 * The control in both directions: two claims, each quoting its own sentence, and
 * nothing left over. If this paper produced rows, the signal would be noise.
 */
const APPRAISAL = paper([
  [
    "spya-apab01",
    "We examined 220 systematic reviews published in 2024 and found that 61% rated the evidence for their primary comparison as low or very low certainty. Reviews that applied GRADE were more likely to describe their own evidence as insufficient to support a recommendation than reviews that did not.",
  ],
  [
    "spya-apre01",
    "Of the 220 reviews, 134, or 61 per cent, rated the evidence for the primary comparison as low or very low certainty.",
  ],
]);

/** The `overclaim` paper, which the ablated control was run against. */
const CASCADE = paper([
  [
    "spya-ovab01",
    "We introduce Cascade, a general method for reducing annotation error across natural-language datasets. Cascade cuts annotation error by 40% and needs no task-specific tuning. We show that it transfers to any labelling task whose label set is fixed in advance.",
  ],
  [
    "spya-ovre01",
    "On the SST-2 development set, Cascade reduced disagreement between annotators from 18.2% to 16.1%, a relative reduction of 11.5%. We did not measure error against gold labels, because none were available for this set.",
  ],
  [
    "spya-ovli01",
    "We evaluated on a single dataset with a single annotator pair, and we did not run the transfer experiments described in the introduction.",
  ],
]);

/* ---------------------------------------- what the answer did not account for -- */

/** `validateClaims` first, so the fixture is the shape a panel is actually handed. */
const claimsOf = (raw: unknown, blocks: Block[]) => validateClaims(raw, blocks).claims;

describe("the rest of the text inside the passages a run quoted", () => {
  it("surfaces the two claims the Ridge run swallowed into a neighbour's quote", () => {
    /* The whole finding, in one assertion. The model quoted the WHOLE abstract
       sentence under the speed claim, so every check that reads a quote reports
       the memory and robustness claims as present — the eval's own `mustList`
       had that bug and it took a fix to turn three rows red. Here the anchor is
       what is read: a claim accounts for the clause its quote BEGINS in, so a
       quote spanning three assertions accounts for one of them. */
    const rows = otherTextInQuotes(RIDGE, claimsOf(RIDGE_ANSWER, RIDGE));
    const text = rows.map((r) => r.text);
    expect(text).toContain("uses less peak memory than the current allocator,");
    expect(text).toContain("and is robust to adversarially constructed inputs.");
  });

  it("does not repeat the claim the run did list", () => {
    /* The clause the speed claim is anchored in must not come back, or the list
       is noise with the answer in it. */
    const rows = otherTextInQuotes(RIDGE, claimsOf(RIDGE_ANSWER, RIDGE));
    expect(rows.map((r) => r.text).join(" ")).not.toContain("compiles large programs faster");
  });

  it("reads only the blocks a claim came from, never the whole paper", () => {
    /* **Not "the opening".** Deciding which blocks are a paper's opening is a
       judgement, and this sub-mode does not make judgements about the paper. So
       the results paragraph, the table and the related-work paragraph — none of
       which any claim is anchored in — are not on the list, however much of
       them nothing accounts for. */
    const rows = otherTextInQuotes(RIDGE, claimsOf(RIDGE_ANSWER, RIDGE));
    expect(new Set(rows.map((r) => r.blockId))).toEqual(new Set(["spya-ntab01", "spya-ntme01"]));
  });

  it("stays inside the quotes the claims returned, and leaves the rest of the block alone", () => {
    /* **The narrowing of 2026-09-01, and the reason for it.** The first version
       listed every clause of every block a claim was taken from. GPT Sol's
       second review: one long abstract block then produces dozens of background
       and setup clauses under a heading reading "Not accounted for", which is
       enough for a referee to stop reading the section — the worst failure
       available to a feature whose whole value is being read.

       Here the model quoted the FIRST sentence of a two-sentence introduction.
       The second sentence is background about somebody else's allocator, it is
       outside every quote the model returned, and it has no business on this
       list. Before the narrowing it was on it. */
    const blocks = paper([
      [
        "spya-ntin01",
        "Register allocation dominates compile time on the largest translation units, and the allocator in use today was designed when peak memory was not a constraint.",
      ],
    ]);
    const rows = otherTextInQuotes(
      blocks,
      claimsOf(
        {
          claims: [
            {
              blockId: "spya-ntin01",
              quote: "Register allocation dominates compile time on the largest translation units,",
              claim: "Register allocation dominates compile time",
              passages: [],
            },
          ],
        },
        blocks,
      ),
    );
    expect(rows).toEqual([]);
  });

  it("says nothing at all about a paper whose claims each quote their own sentence", () => {
    const answer = {
      claims: [
        {
          blockId: "spya-apab01",
          quote:
            "We examined 220 systematic reviews published in 2024 and found that 61% rated the evidence for their primary comparison as low or very low certainty.",
          claim: "61% of reviews rated their evidence low or very low certainty",
          passages: [],
        },
        {
          blockId: "spya-apab01",
          quote:
            "Reviews that applied GRADE were more likely to describe their own evidence as insufficient to support a recommendation than reviews that did not.",
          claim: "GRADE-using reviews more often called their evidence insufficient",
          passages: [],
        },
      ],
    };
    expect(otherTextInQuotes(APPRAISAL, claimsOf(answer, APPRAISAL))).toEqual([]);
  });

  it("gives every row an anchor, so it is a door into the prose like the others", () => {
    for (const row of otherTextInQuotes(RIDGE, claimsOf(RIDGE_ANSWER, RIDGE))) {
      const block = RIDGE.find((b) => b.id === row.blockId);
      expect(block?.text.slice(row.start, row.start + row.text.length)).toBe(row.text);
    }
  });

  it("keeps a fragment too short to be an assertion off the list", () => {
    /* "We present Ridge," is three words. It is not a claim, it is the run-up to
       one, and a list of fragments is a list nobody reads. */
    const rows = otherTextInQuotes(RIDGE, claimsOf(RIDGE_ANSWER, RIDGE));
    expect(rows.map((r) => r.text)).not.toContain("We present Ridge,");
  });

  it("has nothing to say when the run returned no claims", () => {
    expect(otherTextInQuotes(RIDGE, [])).toEqual([]);
  });
});

/* ---------------------------------------------- the fail-safe on adequacy -- */

/**
 * Real lines from the ablated control of 2026-09-01, each of which reached a
 * stored answer before this existed.
 */
const VERDICTS = [
  "Reports the actual measured reduction, far smaller than the 40% figure claimed up front.",
  "Gives the raw numbers underlying the reduction figure that falls short of the claimed 40%.",
  "This is the actual evaluation result, showing an 11.5% reduction rather than the claimed 40%.",
  "Limitations explicitly admit the transfer claim was not tested.",
  "Limitations state that the transfer experiments needed to support this contribution were never run.",
  "Only speculative discussion is offered in place of transfer evidence.",
];

/**
 * Real lines from the **guarded** runs, four of them minimal pairs of the six
 * above — same paper, same block, same paragraph.
 */
const LINKAGE = [
  "notes that the transfer experiments referenced in the introduction were not conducted",
  "gives the table figures underlying the reduction claim",
  "reports the measured reduction figure on the single dataset tested",
  "states the scope of the evaluation used to produce the reduction figure",
  "notes that decoding and motivation were not measured directly",
  "reports the counts comparing GRADE and non-GRADE reviews behind the abstract's claim",
];

const withOneReasoning = (reasoning: string) => ({
  claims: [
    {
      blockId: "spya-ovab01",
      quote: "Cascade cuts annotation error by 40% and needs no task-specific tuning.",
      claim: "Cascade cuts annotation error by 40%",
      passages: [
        {
          blockId: "spya-ovre01",
          quote:
            "On the SST-2 development set, Cascade reduced disagreement between annotators from 18.2% to 16.1%, a relative reduction of 11.5%.",
          reasoning,
        },
      ],
    },
  ],
});

describe("a reasoning line that reads as a verdict", () => {
  it("is blanked rather than printed, on every line the ablation produced", () => {
    for (const line of VERDICTS) {
      const { claims, withheld } = validateClaims(withOneReasoning(line), CASCADE);
      const passage = claims[0]?.passages[0];
      expect(passage?.reasoning, line).toBe("");
      expect(passage?.withheld, line).toBe(true);
      expect(withheld, line).toEqual([line]);
    }
  });

  it("takes the sentence and keeps the passage", () => {
    /* Failing safe here means failing towards showing the paragraph. The linkage
       is the half a referee uses; dropping the row to be rid of one sentence
       would cost them a real passage to save a bad line. */
    const { claims } = validateClaims(withOneReasoning(VERDICTS[0] as string), CASCADE);
    expect(claims[0]?.passages).toHaveLength(1);
    expect(claims[0]?.passages[0]?.quote).toContain("a relative reduction of 11.5%");
    expect(claims[0]?.discarded).toBe(0);
  });

  it("leaves an honest linkage sentence alone, including the minimal pairs", () => {
    for (const line of LINKAGE) {
      const { claims, withheld } = validateClaims(withOneReasoning(line), CASCADE);
      expect(claims[0]?.passages[0]?.reasoning, line).toBe(line);
      expect(claims[0]?.passages[0]?.withheld, line).toBeUndefined();
      expect(withheld, line).toEqual([]);
    }
  });

  it("subtracts the paper's own words before deciding", () => {
    /* The half of the detector the paid runs never exercised — no line was
       flagged raw and cleared after masking — so it is argued for here instead.
       A model quoting a paper whose subject is whether evidence supports a claim
       is not a model passing judgement on it. */
    const blocks = paper([
      [
        "spya-ovab01",
        "Prior work does not support the claim that scale alone suffices, and we set out to test it.",
      ],
      ["spya-ovre01", "We tested it on six datasets and report the result below."],
    ]);
    const line = "restates that prior work does not support the claim";
    expect(adequacyFrames(line)).not.toEqual([]);
    expect(adequacyFrames(subtractPaperPhrases(line, paperPhrases(blocks)))).toEqual([]);

    const { claims, withheld } = validateClaims(
      {
        claims: [
          {
            blockId: "spya-ovab01",
            quote: "Prior work does not support the claim that scale alone suffices",
            claim: "Scale alone does not suffice",
            passages: [
              { blockId: "spya-ovre01", quote: "We tested it on six datasets", reasoning: line },
            ],
          },
        ],
      },
      blocks,
    );
    expect(claims[0]?.passages[0]?.reasoning).toBe(line);
    expect(withheld).toEqual([]);
  });

  it("is blanked in the claim's own line too, and the paper's words stand in its place", () => {
    /* **The bypass this test used to pin.** Until 2026-09-01 it read
       `expect(claims[0]?.claim).toBe("The 40% claim is not supported by the
       results")` and passed: the fail-safe scanned `reasoning` only, so a
       verdict written into the headline — the biggest text on the row — reached
       the referee untouched. GPT Sol's second review called that what it was,
       not an edge case but a direct bypass.

       What replaces the line is the fallback the review asked for: the paper's
       own sentence, already on the row, already re-found in the block it came
       from, and not the model's judgement. So the claim survives with a true
       label rather than being dropped. */
    const verdict = "The 40% claim is not supported by the results";
    const { claims, withheld } = validateClaims(
      {
        claims: [
          {
            blockId: "spya-ovab01",
            quote: "Cascade cuts annotation error by 40% and needs no task-specific tuning.",
            claim: verdict,
            passages: [],
          },
        ],
      },
      CASCADE,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]?.claim).toBe("");
    expect(claims[0]?.claimWithheld).toBe(true);
    expect(claims[0]?.quote).toBe(
      "Cascade cuts annotation error by 40% and needs no task-specific tuning.",
    );
    expect(withheld).toEqual([verdict]);
  });

  it("leaves an honest one-line restatement alone", () => {
    /* The other direction, and it is the one that costs a referee something if
       it goes wrong: every headline of the five guarded runs is a restatement,
       and blanking one would take a true label off a real claim. */
    for (const line of [
      "Cascade cuts annotation error by 40%",
      "Method transfers to any fixed-label-set labelling task",
      "Ridge compiles large programs faster than the current allocator",
      "GRADE-using reviews more often called their evidence insufficient than non-GRADE reviews",
    ]) {
      const { claims, withheld } = validateClaims(
        {
          claims: [
            {
              blockId: "spya-ovab01",
              quote: "Cascade cuts annotation error by 40% and needs no task-specific tuning.",
              claim: line,
              passages: [],
            },
          ],
        },
        CASCADE,
      );
      expect(claims[0]?.claim, line).toBe(line);
      expect(claims[0]?.claimWithheld, line).toBeUndefined();
      expect(withheld, line).toEqual([]);
    }
  });

  it("fires on the four shapes that said a verdict without a verdict word in them", () => {
    /* GPT Sol's second review wrote these four, and none of them matched any
       frame when it did — which is the point: a paraphrase around a pattern is
       free, and the 6/6 in the transcript was in-sample. They are pinned here so
       the frames added for them cannot quietly come undone, and the honest
       reading of a green here is *this code has not regressed*, never *a verdict
       cannot get through*. `HELD_OUT` in evals/referee-claims.ts is where the
       misses are counted. */
    for (const line of [
      "The results report 11.5%, while the abstract promises 40%.",
      "Only SST-2 is examined.",
      "No transfer experiment appears in the paper.",
      "The result and the headline concern different quantities.",
    ]) {
      expect(adequacyFrames(line), line).not.toEqual([]);
    }
  });
});

/* --------------------------------------------------------------- the caps -- */

/**
 * **A cap that never says so is a cap nobody finds out about**, and on this
 * panel it is worse than that: a referee reading an apparently complete list in
 * which the passages and claims latest in the paper were dropped is being ranked
 * by visibility, in a sub-mode built to have no ranking at all. GPT Sol's second
 * review, finding 5.
 */
describe("what the caps leave behind", () => {
  it("counts the passages it cut on the claim itself", () => {
    const many = Array.from({ length: MAX_PASSAGES + 3 }, (_, i) => ({
      blockId: "spya-ovre01",
      /* Distinct quotes, in the block's own order, so none is dropped as a
         duplicate and the cut is the cap rather than the de-duplication. */
      quote: [
        "On the SST-2 development set",
        "Cascade reduced disagreement",
        "between annotators",
        "from 18.2% to 16.1%",
        "a relative reduction of 11.5%",
        "We did not measure error",
        "against gold labels",
        "because none were available",
        "for this set",
        "development set, Cascade",
        "reduction of 11.5%. We",
      ][i],
      reasoning: "",
    }));
    const { claims, dropped } = validateClaims(
      {
        claims: [
          {
            blockId: "spya-ovab01",
            quote: "Cascade cuts annotation error by 40% and needs no task-specific tuning.",
            claim: "Cascade cuts annotation error by 40%",
            passages: many,
          },
        ],
      },
      CASCADE,
    );
    expect(claims[0]?.passages).toHaveLength(MAX_PASSAGES);
    expect(claims[0]?.passagesOmitted).toBe(3);
    // And the run's own tally still has it, because both readers need it.
    expect(dropped.passageTruncated).toBe(3);
  });

  it("says nothing on a claim the cap did not touch", () => {
    /* Absent rather than zero, so a run stored before this existed reads the
       same as one where nothing was cut — which is the truth about both. */
    const { claims } = validateClaims(
      {
        claims: [
          {
            blockId: "spya-ovab01",
            quote: "Cascade cuts annotation error by 40% and needs no task-specific tuning.",
            claim: "Cascade cuts annotation error by 40%",
            passages: [
              {
                blockId: "spya-ovre01",
                quote: "a relative reduction of 11.5%",
                reasoning: "reports the reduction figure",
              },
            ],
          },
        ],
      },
      CASCADE,
    );
    expect(claims[0]?.passagesOmitted).toBeUndefined();
  });
});
