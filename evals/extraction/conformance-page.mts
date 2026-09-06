/**
 * **The page the corruption bank is run against**, shared by the test and the
 * runner so the two cannot disagree about what "noticed" means.
 *
 * ## Why a built page rather than a fixture
 *
 * The first version of the runner scored the corruptions against
 * `negative_controls.html`, a real-shaped page with a real manifest, and five of
 * the twelve came back **NOT NOTICED**. None of them was a scorer bug. That page
 * has no `<h3>`, no `<pre>` and no `<img>`, and its manifest deliberately sets
 * `noPunctuationOnlyBlocks: false` — because a scene break *is* punctuation-only
 * article content, which is the whole reason that page exists. So four
 * corruptions had nothing to damage and one had nothing watching.
 *
 * "NOT NOTICED because the metric is not exercised here" and "NOT NOTICED
 * because the metric is blind" are opposite findings that look identical in a
 * table, and the first one reads as an indictment of the scorer. That is the
 * shape of docs/reusable/silent-success.md's "an eval arm the corpus cannot
 * exercise", pointed the other way round.
 *
 * So conformance gets a page built to give **every metric something to hold**
 * and **every corruption something to damage**, and
 * `tests/extraction-scorer.test.ts` asserts both of those before it asserts
 * anything else.
 *
 * @see [corruptions.mts](corruptions.mts) — the damage
 * @see [scorecard.mts](scorecard.mts) — what does the noticing
 */
import type { Candidate } from "./corruptions.mjs";
import type { AssertionManifest } from "./manifest.mjs";
import { type Gold, navRail } from "./scorecard.mjs";

/**
 * Paragraphs that share no long run with each other, so a substring match on one
 * cannot be satisfied by another. `tests/extraction-inventory.test.ts` learned
 * this the hard way: written the obvious way, with one sentence and the number
 * substituted in, every truncation case passed while measuring nothing.
 */
const WORDS = [
  ["orchard", "lantern", "viaduct"], ["gravel", "puffin", "sextant"],
  ["marzipan", "tundra", "kelp"], ["cobalt", "jackdaw", "furlong"],
  ["pewter", "samphire", "glide"], ["quarry", "mistral", "bracken"],
  ["thistle", "beacon", "caravel"], ["lichen", "dovetail", "plume"],
];

export const para = (n: number): string => {
  const w = WORDS[n % WORDS.length]!;
  return (
    `The ${w[0]} of ${n} was first ${w[1]} in a season nobody troubled to write down, ` +
    `and the ${w[2]} it left behind is the reason paragraph ${n} of this piece reads ` +
    `the way it does, some ${n * 37} words after the argument began and a good while ` +
    `before it is settled.`
  );
};

export const CONFORMANCE_PARAS = [0, 1, 2, 3, 4, 5, 6, 7].map(para);

const CODE =
  "def running_total(xs):\n    total = 0\n    for x in xs:\n        total += x\n    yield total";

export const CONFORMANCE_NAV = navRail();

export const CONFORMANCE_HTML =
  `<h1>The measured thing</h1>` +
  `<h2>One</h2><p>${CONFORMANCE_PARAS[0]}</p><p>${CONFORMANCE_PARAS[1]}</p>` +
  `<h3>A sub-heading</h3><p>${CONFORMANCE_PARAS[2]}</p>` +
  /* **Newlines between the cells, and they are load-bearing.** `textContent`
     puts nothing between `<th>Hour</th><th>Speed</th>`, so a minified table
     reads as `HourSpeed` and the gold passage for it cannot be written the way
     a person would write it. Real HTML has whitespace here; so does this. */
  `<table>\n<tr>\n<th>Hour</th>\n<th>Speed</th>\n</tr>\n<tr>\n<td>14:00</td>\n<td>9.4</td>\n</tr>\n` +
  `<tr>\n<td>15:00</td>\n<td>11.8</td>\n</tr>\n</table>` +
  `<h2>Two</h2><p>${CONFORMANCE_PARAS[3]}</p>` +
  `<figure><img src="/x.png" alt="a diagram"><figcaption>Figure one</figcaption></figure>` +
  `<pre><code>${CODE}</code></pre>` +
  `<blockquote><p>${CONFORMANCE_PARAS[4]}</p></blockquote>` +
  `<h2>Three</h2><p>${CONFORMANCE_PARAS[5]}</p><p>${CONFORMANCE_PARAS[6]}</p>` +
  `<p>${CONFORMANCE_PARAS[7]}</p>`;

export const CONFORMANCE_MANIFEST: AssertionManifest = {
  fixture: "conformance-page",
  file: "(built in evals/extraction/conformance-page.mts)",
  note: "Declares something for every metric, so every metric can be mutated out.",
  mustContain: [
    { text: CONFORMANCE_PARAS[0]!, why: "the opening paragraph" },
    { text: CONFORMANCE_PARAS[7]!, why: "the last one, so a tail truncation shows" },
    { text: "    total = 0\n    for x in xs:", why: "code with its own indentation" },
  ],
  mustNotContain: [
    { text: CONFORMANCE_NAV.texts[0]!, why: "a nav item the glue-nav corruption adds" },
    { text: CONFORMANCE_NAV.texts[7]!, why: "and another from the middle of it" },
  ],
  structure: {
    h2: { exactly: 3 }, h3: { atLeast: 1 }, table: { exactly: 1 },
    img: { atLeast: 1 }, blockquote: { exactly: 1 }, pre: { atLeast: 1 },
  },
  byline: "Ada Sorel",
  title: "The measured thing",
  maxBlockChars: 3000,
  noPunctuationOnlyBlocks: true,
};

/**
 * **Everything on this page that is not the nav rail**, and the omissions in the
 * first version were the whole problem.
 *
 * It listed the eight paragraphs and called itself `whole-document`, leaving out
 * the headings, the table, the code block and the figure caption. Two things
 * followed, both found by GPT Sol on 2026-09-05:
 *
 * - the clean page's `bodyPurity` was **0.931**, so the metric's own ceiling was
 *   below 1 on a document with nothing wrong with it;
 * - and since purity is *attributed characters over output characters*, **deleting
 *   the omitted material improved it**. A corruption that removed the table would
 *   have been rewarded by the one metric that exists to notice dilution.
 *
 * `covers: "whole-document"` is a claim, and this is the list that makes it true.
 * Anything added to `CONFORMANCE_HTML` has to be added here too, and the test
 * asserts the clean page scores 1.00 rather than trusting that it was.
 */
export const CONFORMANCE_GOLD: Gold = {
  body: [
    ...CONFORMANCE_PARAS,
    "The measured thing",
    "One",
    "A sub-heading",
    "Two",
    "Three",
    "Hour Speed 14:00 9.4 15:00 11.8",
    "Figure one",
    CODE,
  ],
  chrome: CONFORMANCE_NAV.texts,
  covers: "whole-document",
};

export const CONFORMANCE_CANDIDATE: Candidate = {
  refused: false,
  html: CONFORMANCE_HTML,
  title: "The measured thing",
  byline: "Ada Sorel",
};
