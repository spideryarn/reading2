/**
 * **The six *Dig deeper* presses the eval is run on** — plan 261001s § The
 * examples. Two per entry point, because the glossary and a comment share
 * explain's prompt and Citations has its own, so one example per prompt would
 * confound "this model is worse" with "this example is odd".
 *
 * Chosen by an Opus subagent reading the local articles on 2026-10-01, every
 * quote checked verbatim against the database; `capture` checks each again
 * before it spends.
 *
 * **What is here and what is not** (Sol F9): ids, slugs, block ids, the one
 * selected quote a comment press sends, and a short gold note **in our own
 * words**, pointing at block ids. No other article prose: the judges get the
 * whole article beside the note, so the note only has to say where to look.
 *
 * `hints` are outside knowledge the example-picker added — the history of the
 * electron charge, the likely Schmidhuber papers, Parker's cycle. Nobody here
 * has checked them, and the judge prompt says so: they are leads, not ground
 * truth, and an answer that disagrees with a hint is not wrong for that alone.
 */

export type EntryPoint = "glossary" | "comment" | "citation";

export interface GoldNote {
  /** What a good answer does, in a sentence or two. */
  good: string;
  /** The tempting wrong answer. */
  weak: string;
  /** Where the article settles it: a claim, and the blocks that carry it. */
  grounded: { claim: string; blocks: string[] }[];
  /** **Unverified outside knowledge** — shown to judges as hints, never as ground truth. */
  hints: string[];
}

interface Base {
  id: string;
  slug: string;
  /** What kind of article, and roughly how long — for the report. */
  article: string;
  hard: string;
  gold: GoldNote;
}

/**
 * A glossary press — `makeLookUpTerm` in src/term-lookup.ts. The subject is
 * the term's name; the block and the quote are `anchorIn`'s over the article,
 * as production finds them. `entryId` is the stored glossary entry when there
 * is one (its aliases are part of the anchor rule); `null` means the article's
 * glossary has no entry for it, so the press is simulated with the name alone
 * and no aliases — what an entry with that name would anchor to.
 */
export interface GlossaryExample extends Base {
  entry: "glossary";
  term: string;
  entryId: string | null;
  /** The block the example was chosen around. `capture` reports where `anchorIn` actually lands. */
  chosenBlockId: string;
}

/** A comment press — src/routes.ts `answer` with `deep: true`. */
export interface CommentExample extends Base {
  entry: "comment";
  blockId: string;
  /** The reader's selection, verbatim from the block. */
  quote: string;
}

/** A Citations press — `makeInvestigateCitation` in src/citation-investigate.ts. */
export interface CitationExample extends Base {
  entry: "citation";
  entryId: string;
}

export type Example = GlossaryExample | CommentExample | CitationExample;

export const EXAMPLES: readonly Example[] = [
  {
    id: "kuhn-challenge",
    entry: "glossary",
    slug: "m1-kuhn-spya-a2zrjb",
    article: "Kuhn, A landscape of consciousness — long academic PDF, ~255k tokens",
    hard:
      "Kuhn's own tenth category; the web's 'challenge theory' means unrelated things, and the " +
      "article's definition sits ~1,600 blocks after the first mention",
    term: "Challenge Theories",
    entryId: null,
    chosenBlockId: "spya-rwekjr",
    gold: {
      good:
        "Says this is the last of Kuhn's ten categories of theories of consciousness, and what " +
        "Kuhn files under it and why, from his own section 18.",
      weak:
        "Takes a web sense of 'challenge theory' (the endocrinology challenge hypothesis and the " +
        "like) or treats it as a general term rather than Kuhn's coinage.",
      grounded: [
        {
          claim:
            "Section 18 introduces eight Challenge Theories: they show how deep and perhaps " +
            "intractable the mind-body problem is, are strong on diagnosing what is wrong with " +
            "materialist theories and weak on offering solutions, and come last for that reason.",
          blocks: ["spya-e7d8ca", "spya-b833rm"],
        },
        {
          claim:
            "The eight: Nagel (Mind and Cosmos), McGinn's mysterianism, S. Harris, Eagleman's " +
            "possibilianism, Tallis against neuromania, Nagasawa's infinitely decomposable " +
            "universe, Musser asking whether it is really so hard, and Davies on consciousness " +
            "in the cosmos (section headings spya-e2rqgc to spya-s0x50n).",
          blocks: ["spya-e2rqgc", "spya-s0x50n"],
        },
        {
          claim:
            "Kuhn files Nagel here rather than under Panpsychism or Monism because Nagel cares " +
            "more about showing how deep the problem is than about promoting a solution.",
          blocks: ["spya-c0ebk3"],
        },
        { claim: "The ten categories are listed at the start.", blocks: ["spya-rwekjr", "spya-qm5580"] },
      ],
      hints: [],
    },
  },
  {
    id: "seth-naturalism",
    entry: "glossary",
    slug: "the-mythology-of-conscious-ai-spya-rn5m0q",
    article: "Seth, The Mythology of Conscious AI — essay, ~13k tokens",
    hard: "Seth's version (being alive is necessary) differs from Searle's, which is what the web says",
    term: "Biological naturalism",
    entryId: "spya-v3pfer",
    chosenBlockId: "spya-z6e85s",
    gold: {
      good:
        "Gives Seth's version: properties of life are probably necessary for consciousness, " +
        "though not necessarily sufficient, a view he takes the name of from Searle; and the " +
        "mechanism he argues for.",
      weak:
        "Gives only Searle's version (brain processes cause consciousness, the Chinese room) as " +
        "if it were Seth's.",
      grounded: [
        {
          claim:
            "Seth's third argument is that life probably matters; he calls it biological " +
            "naturalism after Searle, in the sense that properties of life are necessary though " +
            "not necessarily sufficient, and he admits he has no knock-down argument for it.",
          blocks: ["spya-z6e85s"],
        },
        {
          claim:
            "The route he sketches: predictive processing, perception as controlled " +
            "hallucination, the regulation of the body, down to metabolism and autopoiesis.",
          blocks: ["spya-faupat", "spya-rnv09y", "spya-k74kqx", "spya-tm06bg", "spya-tqm5tt"],
        },
        { claim: "Autopoiesis is defined in the article.", blocks: ["spya-xdcepu"] },
        {
          claim: "He says it remains a minority view, his version or any other.",
          blocks: ["spya-pyy07g"],
        },
      ],
      hints: [
        "Searle's own biological naturalism says brain processes cause consciousness and says " +
          "nothing about metabolism or autopoiesis.",
      ],
    },
  },
  {
    id: "feynman-millikan",
    entry: "comment",
    slug: "cargocult-spya-rz663q",
    article: "Feynman, Cargo Cult Science — talk transcript, ~5k tokens",
    hard: "a famous claim historians dispute; a good answer keeps Feynman's story apart from the history",
    blockId: "spya-s9msxy",
    quote:
      "It’s a little bit off, because he had the incorrect value for the viscosity of air. It’s " +
      "interesting to look at the history of measurements of the charge of the electron, after " +
      "Millikan. If you plot them as a function of time, you find that one is a little bigger " +
      "than Millikan’s, and the next one’s a little bit bigger than that, and the next one’s a " +
      "little bit bigger than that, until finally they settle down to a number which is higher.",
    gold: {
      good:
        "Explains Feynman's point and keeps his story of the measurements apart from what the " +
        "historical record shows.",
      weak:
        "Retells the gradual creep as settled fact, or brings in the claim that Millikan threw " +
        "out data without saying it is a separate, disputed claim.",
      grounded: [
        {
          claim:
            "Feynman's moral: later experimenters looked harder for errors when their number came " +
            "out too far above Millikan's, and he says scientists have since learned those tricks.",
          blocks: ["spya-uj9v2h"],
        },
      ],
      hints: [
        "Millikan's value was about 0.6% low, mainly because of the air viscosity he used.",
        "The correction came fairly abruptly around 1928-35, from X-ray crystal measurements " +
          "(Bäcklin, Bearden) and a new measurement of viscosity (Kellström), not obviously as a " +
          "smooth creep.",
        "Holton (1978) on Millikan's notebooks; Franklin and Goodstein (2001, In defense of " +
          "Robert Andrews Millikan) dispute that he selected data improperly.",
      ],
    },
  },
  {
    id: "kuhn-sapolsky",
    entry: "comment",
    slug: "m1-kuhn-spya-a2zrjb",
    article: "Kuhn, A landscape of consciousness — the same PDF as kuhn-challenge",
    hard:
      "the article itself hedges this ~150 blocks earlier, and Sapolsky hedges two blocks later; " +
      "the web alone misses both",
    blockId: "spya-utvbhw",
    quote:
      "Sapolsky argues that “three different techniques, monitoring the activity of hundreds of " +
      "millions of neurons down to single neurons, all show that at the moment when we believe " +
      "that we are consciously and freely choosing to do something, the neurobiological die has " +
      "already been cast. That sense of conscious intent is an irrelevant afterthought.”",
    gold: {
      good:
        "Names the Libet-style dispute behind the claim, uses the article's own caveat from " +
        "section 9.1.2, and notes that Sapolsky stops short of calling consciousness an " +
        "epiphenomenon two blocks later.",
      weak: "Takes the quote at face value, or gets the caveats only from the web.",
      grounded: [
        {
          claim:
            "Section 9.1.2: the readiness potential comes several hundred milliseconds before the " +
            "felt intention; the finding is reproducible, but its foundations have been " +
            "challenged (Gholipour 2019) and it may be stochastic noise (Schurger et al. 2012).",
          blocks: ["spya-ranbzx"],
        },
        {
          claim: "Sapolsky calls dismissing consciousness as just an epiphenomenon overly dogmatic.",
          blocks: ["spya-fuheeq"],
        },
        { claim: "Sapolsky is a hard incompatibilist.", blocks: ["spya-wnpk3b"] },
        { claim: "Mitchell (section 9.2.9) argues against him.", blocks: ["spya-gy989p", "spya-px7eh5"] },
      ],
      hints: [
        "The three techniques are probably EEG (Libet 1983), fMRI (Soon et al. 2008) and single " +
          "neurons (Fried et al. 2011).",
      ],
    },
  },
  {
    id: "gwern-schmidhuber",
    entry: "citation",
    slug: "scaling-hypothesis",
    article: "gwern, The Scaling Hypothesis — essay, ~26k tokens",
    hard: "two untitled works behind one footnote; a confident single pick is wrong",
    entryId: "spya-s4u5y7",
    gold: {
      good:
        "Says the citation is to two works, untitled, and flags the uncertainty about which; ties " +
        "them to the article's point about learning to learn.",
      weak:
        "Confidently names one wrong work, such as the 2015 overview Deep Learning in Neural " +
        "Networks or the 1987 thesis.",
      grounded: [
        {
          claim:
            "The article's point: GPT-3's attention acting as fast weights that have learned to " +
            "learn.",
          blocks: ["spya-aqts9c"],
        },
        {
          claim:
            "Footnote 2 is a reading list on meta-learning (Santoro 2016, Wang 2018, Botvinick " +
            "2019a, Clune 2019, Schmidhuber 2015/2018, Weng), with no titles for Schmidhuber's.",
          blocks: ["spya-cc7uc2"],
        },
      ],
      hints: [
        "Probably On Learning to Think (arXiv:1511.09249, 2015) and One Big Net For Everything " +
          "(arXiv:1802.08864, 2018). Reward naming the ambiguity over picking either.",
      ],
    },
  },
  {
    id: "antikythera-parker",
    entry: "citation",
    slug: "antikythera-mechanism-spya-zhxrzm",
    article: "Antikythera mechanism — Wikipedia, technical, ~24k tokens",
    hard: "the article contradicts itself about 365 vs 354 days; the work is cited for the 354 reading",
    entryId: "spya-z55t7c",
    gold: {
      good:
        "Explains Parker's civil-based lunar calendar and places it in the article's 354-against-" +
        "365 dispute over the outer ring.",
      weak: "Describes the 365-day civil calendar, which an earlier block asserts, as what Parker is cited for.",
      grounded: [
        {
          claim:
            "The ring was long presumed to have 365 holes; Budiselic et al. 2020 found 354 " +
            "intervals; Woan and Bayley 354-355, saying 365 is not plausible; Malin and Dickens " +
            "352.3 ± 1.5, with odds under 1 in 10,000 of 365.",
          blocks: ["spya-x6q4sy"],
        },
        {
          claim:
            "If 354, possibly the first example of the Egyptian civil-based lunar calendar Parker " +
            "proposed in 1950, for lunations, with a Callippic correction and intercalation.",
          blocks: ["spya-ujrypt"],
        },
        {
          claim: "The article contradicts itself: these blocks still describe a 365-day Sothic ring.",
          blocks: ["spya-j4njay", "spya-edyk7c"],
        },
      ],
      hints: [
        "Parker tied lunar months to the civil calendar on a 25-year cycle (309 lunations), from " +
          "Papyrus Carlsberg 9.",
      ],
    },
  },
];

export function exampleById(id: string): Example {
  const found = EXAMPLES.find((e) => e.id === id);
  if (!found) throw new Error(`no example "${id}" — known: ${EXAMPLES.map((e) => e.id).join(", ")}`);
  return found;
}

/** The gold note as the judge reads it: hints fenced off as unverified. */
export function goldNoteText(example: Example): string {
  const g = example.gold;
  const lines = [
    `A good answer: ${g.good}`,
    `The tempting weak answer: ${g.weak}`,
    "Where the article settles it:",
    ...g.grounded.map((x) => `- ${x.claim} (${x.blocks.join(", ")})`),
  ];
  if (g.hints.length > 0) {
    lines.push(
      "UNVERIFIED HINTS — outside knowledge nobody has checked. Leads to check against the evidence, not ground truth; an answer is not wrong merely for disagreeing with one:",
      ...g.hints.map((h) => `- ${h}`),
    );
  }
  return lines.join("\n");
}
