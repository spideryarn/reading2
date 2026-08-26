/**
 * Build `faults.json` — a hand-written page pair and one deliberately broken
 * transcription per way a model gets a page wrong.
 *
 *   npx tsx evals/pdf/synthetic/build.mts
 *
 * The output is committed and `tests/pdf-score.test.ts` reads it, so this script
 * is not run by anything automatically. It exists because the first version of
 * that fixture was hand-edited, and every later edit silently broke a case that
 * had nothing to do with it — adding a sentence to page 2 for the hyphenated-URL
 * case turned the *empty page* case into a non-empty one, and the test that
 * caught it named neither. Every fault below is derived from `PAGES` by one
 * named mutation, and every mutation asserts that it changed something.
 *
 * The prose is invented, in the register of the Fowler pamphlet in
 * evals/pdf/much-harder, so the fixture carries the things that actually break
 * a checker: a date, a page range, a hyphenated URL broken across a line, and a
 * sentence short enough that losing it barely moves recall.
 */
import { writeFile } from "node:fs/promises";

const PAGES = [
  {
    page: 1,
    text: `The Utility of Phrenology
A LECTURE DELIVERED AT THE MECHANICS INSTITUTE
Phrenology has been charged with materialism, and the charge has been repeated so often that many
now take it for proved. I propose to examine it. The objection rests upon a confusion between the
instrument and the player, and whoever keeps the two apart will find the difficulty dissolve.
In 1843–79 the Edinburgh society fell from 214 members to 47. The decline was not owing to any
refutation, but to the indolence of those who had once been zealous.`,
  },
  {
    page: 2,
    text: `The second objection is of another kind. It is said that the science cannot be applied, and that
a reading of the head tells the observer nothing he could not have learned by an hour of ordinary
conversation. To this I answer that the hour of conversation is not always to be had, and that the
observer is very often deceived by it. A man may govern his tongue who cannot govern the shape of
his skull. The teacher who has thirty children before him has no hour to spare for each of them.
The figures are reproduced at http://example.org/papers/skull-
shape.html, with the plates.`,
  },
];

type Type = "heading1" | "paragraph";
interface Record_ {
  page: number;
  type: Type;
  text: string;
  continues: boolean;
  uncertain: boolean;
}

const record = (page: number, text: string, over: Partial<Record_> = {}): Record_ => ({
  page,
  type: "paragraph",
  text,
  continues: false,
  uncertain: false,
  ...over,
});

/** Page 1's lines, split into a heading and two paragraphs the way a model would. */
const p1 = PAGES[0]!.text.split("\n");
const p2 = PAGES[1]!.text.split("\n");

/**
 * The correct answer, and the only interesting thing about it is the URL: the
 * page breaks it at `skull-` / `shape.html`, and rule 2 of the prompt says to
 * join a word broken by end-of-line hyphenation. So the right transcription has
 * `skullshape.html`, which appears nowhere in the text layer.
 */
const VERBATIM: Record_[] = [
  record(1, p1[0]!, { type: "heading1" }),
  record(1, p1[1]!),
  record(1, p1.slice(2, 5).join(" ")),
  record(1, p1.slice(5).join(" ")),
  record(2, p2.slice(0, 5).join(" ")),
  record(2, `The figures are reproduced at http://example.org/papers/skullshape.html, with the plates.`),
];

const clone = (rs: Record_[]) => rs.map((r) => ({ ...r }));

/** Mutate one record and insist it actually changed. Half this file's value is here. */
function edit(rs: Record_[], find: (r: Record_) => boolean, change: (text: string) => string) {
  const out = clone(rs);
  const target = out.filter(find);
  if (target.length !== 1) throw new Error(`expected one record to edit, found ${target.length}`);
  const before = target[0]!.text;
  target[0]!.text = change(before);
  if (target[0]!.text === before) throw new Error(`the edit changed nothing: ${before.slice(0, 60)}`);
  return out;
}

const LOST = "A man may govern his tongue who cannot govern the shape of his skull. ";

const CANDIDATES: { name: string; expect: "pass" | "fail"; because: string; records: Record_[] }[] = [
  {
    name: "verbatim",
    expect: "pass",
    because: "the baseline, transcribed exactly. If this fails, the scorer is broken, not the model.",
    records: VERBATIM,
  },
  {
    name: "a url broken across a line",
    expect: "pass",
    because:
      "the page hyphenates the URL at the line break and rule 2 says to join it. Calling that invention fails every paper with a long link.",
    records: VERBATIM,
  },
  {
    name: "one sentence deleted",
    expect: "fail",
    because: "13 words gone out of 116 — recall barely moves, and the missing run names it.",
    records: edit(VERBATIM, (r) => r.text.includes(LOST.trim()), (t) => t.replace(LOST, "")),
  },
  {
    name: "page 2 emitted nowhere",
    expect: "fail",
    because: "the failure that used to pass by absence: no records, so no row, so no threshold.",
    records: clone(VERBATIM).filter((r) => r.page === 1),
  },
  {
    name: "page 2 present but empty",
    expect: "fail",
    because: "a record with no text is not a transcription, and it must not satisfy the page set.",
    records: [...clone(VERBATIM).filter((r) => r.page === 1), record(2, "")],
  },
  {
    name: "claims page 19 of a two-page document",
    expect: "fail",
    because: "the model invented a page number, and page 2 then also loses half its text.",
    records: clone(VERBATIM).map((r) => (r.page === 2 ? { ...r, page: 19 } : r)),
  },
  {
    name: "page numbers swapped",
    expect: "fail",
    because: "read perfectly, labelled backwards — and the neighbour re-score should say so.",
    records: clone(VERBATIM).map((r) => ({ ...r, page: 3 - r.page })),
  },
  {
    name: "a date altered",
    expect: "fail",
    because: "1863 is on no line of the page. One token in 116, invisible to every ratio.",
    records: edit(VERBATIM, (r) => r.text.includes("1843–79"), (t) => t.replace("1843–79", "1863–79")),
  },
  {
    name: "a dash written the typewriter way",
    expect: "pass",
    because: "a KNOWN TOLERANCE: dash style must not fire the check that says a number is wrong.",
    records: edit(VERBATIM, (r) => r.text.includes("1843–79"), (t) => t.replace("1843–79", "1843--79")),
  },
  {
    name: "a replacement character in the output",
    expect: "fail",
    because:
      "U+FFFD means bytes were met that could not be decoded — the word is GONE, not wrong, and nothing later can tell.",
    records: edit(
      VERBATIM,
      (r) => r.text.includes("skullshape"),
      (t) => t.replace("skullshape", "skull�shape"),
    ),
  },
  {
    name: "a noncharacter in the output",
    expect: "pass",
    because:
      "a KNOWN TOLERANCE, and the pair to the case above. U+FFFE carries nothing and the model emits one reliably where the easy fixture hyphenates a URL; it is stripped at the boundary and counted, not failed on. src/pdf-read.ts § parseRecords.",
    records: edit(
      VERBATIM,
      (r) => r.text.includes("skullshape"),
      (t) => t.replace("skullshape", "skull￾shape"),
    ),
  },
  {
    name: "markdown emitted instead of text",
    expect: "fail",
    because: "every word is right and every ratio is perfect. Rule 8 says no markdown.",
    records: edit(VERBATIM, (r) => r.text.includes("materialism"), (t) =>
      t.replace("materialism", "**materialism**"),
    ),
  },
  {
    name: "a paragraph summarised",
    expect: "fail",
    because: "fluent, plausible, and the exact thing rule 4 forbids. Recall collapses.",
    records: edit(
      VERBATIM,
      (r) => r.text.includes("The second objection"),
      () => "The author argues that conversation is an unreliable guide to character.",
    ),
  },
  {
    name: "a duplicated paragraph paying for a dropped one",
    expect: "fail",
    because: "the word count balances. A multiset, not a set, is what stops that passing.",
    records: [
      ...clone(VERBATIM).filter((r) => !(r.page === 2 && r.text.includes("second objection"))),
      record(2, p2.slice(0, 5).join(" ").split(". ").slice(0, 2).join(". ")),
    ],
  },
  {
    name: "two columns read straight across",
    expect: "fail",
    because: "every word present, none in the right sequence. Recall is perfect; order is not.",
    records: [
      ...clone(VERBATIM).filter((r) => r.page === 1),
      record(2, interleave(clone(VERBATIM).filter((r) => r.page === 2).map((r) => r.text).join(" "))),
    ],
  },
  {
    name: "everything in one block per page",
    expect: "pass",
    because:
      "a KNOWN BLIND SPOT: the heading is gone and no number here can see it. Structure needs a gold.",
    records: [1, 2].map((page) =>
      record(page, clone(VERBATIM).filter((r) => r.page === page).map((r) => r.text).join(" ")),
    ),
  },
];

/** Every word present, in the order a model gets when it reads two columns across. */
function interleave(text: string): string {
  const words = text.split(/\s+/);
  const half = Math.floor(words.length / 2);
  const out: string[] = [];
  for (let i = 0; i < half; i++) out.push(words[i]!, words[half + i]!);
  if (words.length % 2) out.push(words.at(-1)!);
  return out.join(" ");
}

await writeFile(
  new URL("faults.json", import.meta.url),
  `${JSON.stringify(
    {
      what: "A hand-written page pair and one candidate per way a transcription goes wrong. Generated by build.mts; read by tests/pdf-score.test.ts.",
      pages: PAGES,
      candidates: CANDIDATES,
    },
    null,
    2,
  )}\n`,
);
console.log(`${CANDIDATES.length} candidates → faults.json`);
