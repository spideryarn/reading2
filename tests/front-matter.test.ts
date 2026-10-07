/**
 * **Which leading blocks are the byline** — src/web/front-matter.ts.
 *
 * Greg, spya-duh4w3, 2026-10-06: *"A lot of articles start with a list of
 * authors … default collapse them so that you kind of jump straight into the
 * article itself."*
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md
 * § The rule, v1; each case below is a line of it, or one of the false
 * positives its plan review constructed.
 *
 * The names and affiliation lines are public papers', written by hand in the
 * shapes production holds (fused, stacked, marker-glued). None is copied from a
 * reader's article.
 */
import { describe, expect, it } from "vitest";
import type { Author, Block, BlockId } from "../src/types.js";
import { frontMatter } from "../src/web/front-matter.js";

const id = (s: string) => `spya-${s}` as BlockId;

const heading = (key: string, text: string, tag = "h1"): Block => ({
  id: id(key),
  tag,
  kind: "heading",
  level: Number(tag.slice(1)),
  text,
  words: text.split(/\s+/).length,
  html: `<${tag} id="${id(key)}">${text}</${tag}>`,
  gistable: true,
});

const para = (key: string, text: string): Block => ({
  id: id(key),
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p id="${id(key)}">${text}</p>`,
  gistable: true,
});

const NO_ECHO: ReadonlySet<BlockId> = new Set();

const run = (
  blocks: Block[],
  meta: { authors?: Author[]; byline?: string } = {},
  echo: ReadonlySet<BlockId> = NO_ECHO,
): string[] => frontMatter({ blocks, meta }, echo).map((b) => b.replace("spya-", ""));

const title = heading("title0", "Attention Is All You Need");
const abstractHead = heading("abshd0", "Abstract", "h2");
const abstract = para(
  "abstr0",
  "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. We propose a new simple network architecture.",
);
const author = (name: string, ...affiliations: string[]): Author => ({ name, affiliations });

describe("frontMatter: what counts as evidence", () => {
  it("folds a line with an email address", () => {
    expect(run([title, para("a", "Ashish Vaswani Google Brain avaswani@google.com"), abstractHead, abstract])).toEqual(["a"]);
  });

  it("folds a line that holds an author's full name from meta.authors", () => {
    const blocks = [title, para("a", "Ashish Vaswani∗, Noam Shazeer∗, Niki Parmar∗"), abstractHead, abstract];
    expect(run(blocks, { authors: [author("Ashish Vaswani"), author("Noam Shazeer")] })).toEqual(["a"]);
  });

  it("folds a line that holds a name from meta.byline, split on semicolons", () => {
    const blocks = [title, para("a", "Ashish Vaswani1,2*, Noam Shazeer1"), abstractHead, abstract];
    expect(run(blocks, { byline: "Ashish Vaswani; Noam Shazeer" })).toEqual(["a"]);
  });

  it("reads the names out of a byline that is the front page's own line, marks and all", () => {
    const line = "Taylor Webb1,*, Keith J. Holyoak1 , and Hongjing Lu1,2";
    expect(run([title, para("a", line), abstractHead, abstract], { byline: line })).toEqual(["a"]);
    const amp = "Dylan Layfield1,2*, Nathan Sidell2 & Ehren Lee Newman1,2";
    expect(run([title, para("a", amp), abstractHead, abstract], { byline: amp })).toEqual(["a"]);
  });

  it("splits a byline at and, and at an ampersand", () => {
    /* Unsplit, each of these is one piece that is in neither block. */
    const and = { byline: "Samantha P. Sherrill 2 and John M. Beggs 3" };
    expect(run([title, para("a", "John M. Beggs3"), abstract], and)).toEqual(["a"]);
    const amp = { byline: "Sister Vajira & Francis Story" };
    expect(run([title, para("a", "Francis Story"), abstract], amp)).toEqual(["a"]);
  });

  it("takes the footnote marks off a name in the byline before looking for it", () => {
    const meta = { byline: "Savir Basil 1, Ina Shapiro 1,2" };
    expect(run([title, para("a", "Savir Basil, Ina Shapiro"), abstract], meta)).toEqual(["a"]);
  });

  it("matches a name with its capitals, not without", () => {
    const meta = { authors: [author("Mark Field")] };
    expect(run([title, para("a", "MARK FIELD NOTES"), abstract], meta)).toEqual([]);
    expect(run([title, para("a", "Mark Field"), abstract], meta)).toEqual(["a"]);
  });

  it("takes nothing longer than five words for a name", () => {
    const meta = { authors: [author("The Editors Of The Example Quarterly")] };
    expect(run([title, para("a", "The Editors Of The Example Quarterly"), abstract], meta)).toEqual([]);
    const five = { authors: [author("The Event Horizon Telescope Collaboration")] };
    expect(run([title, para("a", "The Event Horizon Telescope Collaboration"), abstract], five)).toEqual(["a"]);
  });

  it("takes no name from a byline written surname first", () => {
    /* "Hasson" and "Uri" are one word each, and one word is never a name. */
    expect(run([title, para("a", "Hasson, Uri"), abstract], { byline: "Hasson, Uri" })).toEqual([]);
  });

  it("finds a name with a superscript letter glued to it, and not a longer surname", () => {
    const meta = { authors: [author("Dhairyya Singh"), author("Anna C. Schapiro")] };
    expect(run([title, para("a", "Dhairyya Singha,1 , and Anna C. Schapiroa,1"), abstract], meta)).toEqual(["a"]);
    expect(run([title, para("a", "Dhairyya Singhal and Anna C. Schapiros"), abstract], meta)).toEqual([]);
    expect(run([title, para("a", "Dhairyya Singha, Nobel Laureate"), abstract], meta)).toEqual([]);
    expect(run([title, para("a", "McDhairyya Singh"), abstract], meta)).toEqual([]);
  });

  it("does not take bare names for evidence when the article names nobody", () => {
    expect(run([title, para("a", "Ashish Vaswani, Noam Shazeer, Niki Parmar"), abstractHead, abstract])).toEqual([]);
  });

  it("does not take a byline that is not a list of names for names", () => {
    const blocks = [title, para("a", "Staff Writer"), abstractHead, abstract];
    expect(run(blocks, { byline: "Staff Writer Affiliation: nobody in particular, somewhere" })).toEqual([]);
    /* One word is a surname or a first name, and either is a word. */
    expect(run([title, para("a", "Madonna"), abstract], { byline: "Madonna" })).toEqual([]);
  });

  it("folds an affiliation line by its institution word", () => {
    expect(run([title, para("a", "Department of Computer Science, University of Toronto"), abstractHead, abstract])).toEqual(["a"]);
    expect(run([title, para("a", "1Departments of Psychology and Computer Science"), abstractHead, abstract])).toEqual(["a"]);
    /* A whole word with its capital: not "the school", and not "Schooling". */
    expect(run([title, para("a", "Schooling Reform Movement"), abstract])).toEqual([]);
    expect(run([title, para("a", "Max Planck Institute for Human Development, Berlin, Germany"), abstract])).toEqual(["a"]);
  });

  it("folds a correspondence line and an equal-contribution note by their lead phrase", () => {
    const blocks = [
      title,
      para("a", "Department of Psychology, Princeton University"),
      para("b", "* Corresponding author"),
      para("c", "†These authors contributed equally to this work"),
      abstractHead,
      abstract,
    ];
    expect(run(blocks)).toEqual(["a", "b", "c"]);
  });

  it("folds eight stacked author blocks, one per author", () => {
    const names = ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan Gomez", "Lukasz Kaiser", "Illia Polosukhin"];
    const stacked = names.map((n, i) => para(`s${i}`, `${n}∗ Google Brain ${n.split(" ")[0]!.toLowerCase()}@google.com`));
    expect(run([title, ...stacked, abstractHead, abstract])).toEqual(stacked.map((_, i) => `s${i}`));
  });

  it("folds a fused paragraph of names, institutions and emails", () => {
    const fused =
      "Timur Galimzyanov Affiliation: Institute of Physical Chemistry, Moscow Anna Petrova Affiliation: Department of Physics, Lomonosov Moscow State University Correspondence: timur@example.org";
    expect(run([title, para("a", fused), abstractHead, abstract])).toEqual(["a"]);
  });
});

describe("frontMatter: what must not fold", () => {
  it("leaves a standfirst that names a university", () => {
    const standfirst = para("a", "Researchers at Stanford University developed a cheaper method for sequencing tumours.");
    expect(run([title, standfirst, abstract])).toEqual([]);
  });

  it("leaves a heading that uses School as a noun", () => {
    expect(run([title, heading("a", "Why Medical School Costs So Much", "h2"), abstract])).toEqual([]);
  });

  it("leaves a title-like block that holds a surname which is also a word", () => {
    const meta = { authors: [author("Rachel Long"), author("Emma Young")] };
    const text = "Long COVID outcomes in young adults: a cohort study";
    expect(run([title, para("a", text), abstract], meta)).toEqual([]);
    expect(run([title, heading("a", text, "h2"), abstract], meta)).toEqual([]);
  });

  it("stops at a prose paragraph after the byline, with the byline folded", () => {
    const significance = para(
      "sig",
      "Significance: Scientists at Harvard University have long assumed that coauthorship is the tie that matters. We show that informal connections outweigh it, which changes how impact should be measured.",
    );
    const blocks = [title, para("a", "Jane Roe, Department of Sociology, Harvard University"), significance, abstractHead, abstract];
    expect(run(blocks)).toEqual(["a"]);
  });

  it("does not resume after the first block that fails, even for a later byline block", () => {
    const blocks = [title, abstract, para("late", "Department of Sociology, Harvard University")];
    expect(run(blocks)).toEqual([]);
  });

  it("leaves a long statement that opens with a lead phrase but reads as prose", () => {
    const statement = para(
      "a",
      "Corresponding author: Jane Roe. All authors approve the paper and have read it. Competing interests: the authors declare that they have no competing interests, and that the funders had no role in the design of the study, which was conducted in the absence of any commercial relationship that could be construed as a conflict.",
    );
    expect(run([title, statement, abstract])).toEqual([]);
  });

  it("leaves a contact line that runs on into a statement and the keywords", () => {
    /* 29 words: under the plan's first allowance of forty, and that folded it. */
    const fused = para(
      "a",
      "Corresponding Author: Jane Roe, 1 Main Street, Springfield, USA Email: jane@example.edu All authors approve the paper. Competing interest statement: The authors declare no conflict of interest. Keywords: memory, attention",
    );
    expect(run([title, fused, abstract])).toEqual([]);
  });

  it("leaves a short line of prose that only mentions a lead phrase further in", () => {
    const line = para("a", "A long and bitter correspondence followed the paper");
    expect(run([title, line, abstract])).toEqual([]);
  });

  it("leaves a short sentence that starts with a lead word", () => {
    expect(run([title, para("a", "Correspondence followed for years."), abstract])).toEqual([]);
  });

  it("leaves a short institution-dominated sentence", () => {
    expect(run([title, para("a", "Harvard University Press declined."), abstract])).toEqual([]);
  });

  it("leaves labelled content that is not author detail", () => {
    expect(
      run([title, para("a", "Acknowledgements: We thank Harvard University."), abstract]),
    ).toEqual([]);
    expect(
      run([title, para("a", "Keywords: Correspondence, University, ORCID"), abstract]),
    ).toEqual([]);
    expect(run([title, para("a", "Funding: Stanford University."), abstract])).toEqual([]);
  });

  it("leaves prose in a script without upper and lower case", () => {
    const sentence = para("a", "清华 University 的研究人员发现了一种新的治疗方法。");
    expect(run([title, sentence, abstract])).toEqual([]);
  });

  it("leaves a title-cased subtitle that mentions correspondence mid-line", () => {
    const subtitle = para(
      "a",
      "Letters Reveal How Private Correspondence Changed Modern Literature",
    );
    expect(run([title, subtitle, abstract])).toEqual([]);
  });

  it("leaves a title-cased subtitle with a lead phrase near its start", () => {
    const subtitle = para("a", "How Correspondence Changed Modern Literature");
    expect(run([title, subtitle, abstract])).toEqual([]);
  });

  it("does not turn an outlet fragment in a comma-separated byline into a name", () => {
    const deck = para("a", "The New York Times Reports From Kyiv");
    expect(run([title, deck, abstract], { byline: "Jane Doe, The New York Times" })).toEqual([]);
  });

  it("leaves a title-cased subtitle that mentions one of the authors", () => {
    const deck = para("a", "Jane Doe On Why Memory Matters");
    expect(run([title, deck, abstract], { authors: [author("Jane Doe")] })).toEqual([]);
  });

  it("leaves a title-cased subtitle that mentions two of the authors", () => {
    const deck = para("a", "Jane Doe And John Roe Discuss Memory");
    const meta = { authors: [author("Jane Doe"), author("John Roe")] };
    expect(run([title, deck, abstract], meta)).toEqual([]);
  });

  it("folds nothing when block 0 is not an h1", () => {
    const byline = para("a", "Department of Computer Science, University of Toronto");
    expect(run([para("furn", "Journal of Things, Vol 3"), title, byline, abstract])).toEqual([]);
    expect(run([heading("h2", "Attention Is All You Need", "h2"), byline, abstract])).toEqual([]);
    expect(run([])).toEqual([]);
  });

  it("never puts block 0 in the run, whatever it says", () => {
    const first = heading("title0", "Department of Computer Science, University of Toronto");
    expect(run([first, abstract])).toEqual([]);
  });
});

describe("frontMatter: given names and initials are not sentence words", () => {
  it("folds a line with an initial", () => {
    const blocks = [title, para("a", "Victor I. Petrov, I. M. Gelfand, Steklov Institute, Moscow"), abstract];
    expect(run(blocks)).toEqual(["a"]);
  });

  it("folds a line whose given names are Will and Can", () => {
    const blocks = [title, para("a", "Will Smith and Can Xu, Department of Physics, Tsinghua University"), abstract];
    expect(run(blocks)).toEqual(["a"]);
  });

  it("counts the same words in lower case as a sentence's", () => {
    /* Nine capitals and three sentence words: a quarter lower case, so the
       first measure passes and only the count of sentence words can stop it. */
    const places = "Harvard University Cambridge Massachusetts Boston Princeton Yale Stanford Oxford";
    expect(run([title, para("a", `${places} is was not`), abstract])).toEqual([]);
    expect(run([title, para("a", `${places} Is Was Not`), abstract])).toEqual(["a"]);
    /* Two are allowed: "These authors contributed equally to this work". */
    expect(run([title, para("a", `${places} is was`), abstract])).toEqual(["a"]);
  });
});

describe("frontMatter: what is left out of the count of lower-case words", () => {
  it("does not count a link, an email or a number as a word of a sentence", () => {
    /* Four capitals. Counted, the three addresses would make it 3 of 7 lower case. */
    const line = "Jane Roe, Harvard University https://orcid.org/0000-0002-1825-0097 www.example.org/roe jane@harvard.edu";
    expect(run([title, para("a", line), abstract])).toEqual(["a"]);
  });

  it("does not count a number as a capitalised word either", () => {
    /* One lower-case word in three. Counted as capitals, the six numbers would make it one in nine. */
    expect(run([title, para("a", "Harvard University room 12 14 16 18 20 22"), abstract])).toEqual([]);
  });

  it("does not count the joining words", () => {
    /* Three capitals and "of the for": counted, half the line is lower case. */
    expect(run([title, para("a", "Institute of the Americas for Peace"), abstract])).toEqual(["a"]);
  });

  it("allows a long affiliation block a sentence word for every twenty-five words", () => {
    /* 100 words, 3 of them sentence words: over the two a short block may have, inside 4%. */
    const places = Array.from({ length: 32 }, () => "Harvard University, Cambridge").join(" ");
    expect(run([title, para("a", `${places} Boston is was not`), abstract])).toEqual(["a"]);
    expect(run([title, para("a", `${places} is was not it its`), abstract])).toEqual([]);
  });
});

describe("frontMatter: headings", () => {
  it("keeps a known label and what is under it", () => {
    const blocks = [title, heading("lab", "Authors", "h2"), para("a", "Jane Roe, Harvard University"), abstractHead, abstract];
    expect(run(blocks)).toEqual(["lab", "a"]);
  });

  it("keeps a heading that is an author's name", () => {
    const blocks = [title, heading("n", "Jane Roe1,*", "h3"), para("a", "Harvard University, jane@harvard.edu"), abstractHead, abstract];
    expect(run(blocks, { authors: [author("Jane Roe")] })).toEqual(["n", "a"]);
  });

  it("stops at a heading that has an author's name in it and other words too", () => {
    const blocks = [title, para("a", "Jane Roe, Harvard University"), heading("k", "A Tribute to Jane Roe", "h2"), para("b", "Harvard University")];
    expect(run(blocks, { authors: [author("Jane Roe")] })).toEqual(["a"]);
  });

  it("stops at any other heading", () => {
    const blocks = [title, para("a", "Jane Roe, Harvard University"), heading("k", "Key Points", "h2"), para("b", "Harvard University"), abstract];
    expect(run(blocks)).toEqual(["a"]);
  });

  it("does not end on a label with nothing folded under it", () => {
    const blocks = [title, para("a", "Jane Roe, Harvard University"), heading("lab", "Correspondence", "h2"), abstract];
    expect(run(blocks)).toEqual(["a"]);
    expect(run([title, heading("lab", "Authors", "h2"), abstract])).toEqual([]);
  });
});

describe("frontMatter: the caps", () => {
  const line = (i: number) => para(`l${i}`, `Department ${i}, University of Toronto`);

  it("folds fifteen blocks and refuses sixteen", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => line(i));
    expect(run([title, ...fifteen, abstract])).toHaveLength(15);
    expect(run([title, ...fifteen, line(15), abstract])).toEqual([]);
  });

  it("stops at a single block of more than 300 words", () => {
    const big = (n: number) => para("big", Array.from({ length: n / 3 }, () => "Harvard University, Cambridge").join(" "));
    expect(run([title, big(300), abstract])).toEqual(["big"]);
    expect(run([title, big(303), abstract])).toEqual([]);
  });

  it("refuses a run of more than 600 words in all", () => {
    const part = (k: string, n: number) => para(k, Array.from({ length: n / 3 }, () => "Harvard University, Cambridge").join(" "));
    expect(run([title, part("a", 300), part("b", 300), abstract])).toEqual(["a", "b"]);
    expect(run([title, part("a", 300), part("b", 300), part("c", 3), abstract])).toEqual([]);
  });
});

describe("frontMatter: beside the masthead's echo", () => {
  it("starts after the wrapper's reading-time line when that is hidden", () => {
    const ours = para("ours", "Jane Roe · Example · ~5 min read");
    const blocks = [title, ours, para("a", "Jane Roe, Harvard University"), abstract];
    expect(run(blocks, {}, new Set([title.id, ours.id]))).toEqual(["a"]);
  });

  it("stops at the line when it is not the echo's", () => {
    const line = para("ours", "Jane Roe · Example · ~5 min read");
    expect(run([title, line, para("a", "Jane Roe, Harvard University"), abstract])).toEqual([]);
  });

  it("returns the run in document order, as ids", () => {
    const blocks = [title, para("a", "Jane Roe, Harvard University"), para("b", "jane@harvard.edu")];
    expect(frontMatter({ blocks, meta: {} }, NO_ECHO)).toEqual([id("a"), id("b")]);
  });
});
