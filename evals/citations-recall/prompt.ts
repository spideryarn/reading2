/**
 * **The candidate prompt for plan 261101a** — today's `citations/7` system
 * prompt (src/bibliography.ts § SYSTEM) with three changes, made by replacing
 * exact passages so that everything else is byte-for-byte production's:
 *
 * 1. *HOW MANY* asks for every work, up to a hard 300 (`CANDIDATE_CAP`), with no
 *    "keep the ones it leans on most".
 * 2. A *WHAT A CITATION LOOKS LIKE* section of examples, before *WHERE THE ARTICLE CITES IT*.
 * 3. A *HOW TO WORK* section: block by block, in order; ten citations are ten rows.
 *
 * Each replacement throws if its passage is not found, so a drift in the
 * production prompt cannot silently leave an arm running today's text.
 */
import { systemPrompt } from "../../src/bibliography.js";

const OLD_HOW_MANY = /HOW MANY\n\nAt most \d+ rows\. If the article cites more than \d+ works,\nkeep the \d+ it leans on most and set "capped": true\. Otherwise\n"capped": false\./;

/** The hard ceiling the candidate keeps, so `capped` still means "the article cites more than this" (Sol's plan review, 5). */
export const CANDIDATE_CAP = 300;

export const NEW_HOW_MANY = `HOW MANY

EVERY work the article cites: one row for each. Do not choose the important
ones, and do not stop early because the list is long; a paper that cites 250
works needs 250 rows. Only if it cites more than ${CANDIDATE_CAP} works, list the
first ${CANDIDATE_CAP} it cites and set "capped": true. Otherwise "capped": false.

HOW TO WORK

Go through the article block by block, from the first to the last, and list
each work at the first block that cites it. Read every citation in a block, not
only the first: a paragraph that cites ten works gives ten rows. A work cited
again later is the same row, not a new one. Then check the bibliography,
reference list and notes, if the article has them, for any entry you have not
listed whose work the text cites.`;

const BEFORE_WHERE = "WHERE THE ARTICLE CITES IT";

export const FORMATS = `WHAT A CITATION LOOKS LIKE

Citations come in many shapes. Each line below is one place in a text, and how
many works it cites:

  "(Tulving, 1983)" — one. "Tulving (1983) showed" — one.
  "(Craik, 1943; Bryson and Ho, 1969)" — two, split by a semicolon.
  "(Carruthers & Gennaro 2020, Rosenthal 2005)" — two, split by a comma.
  "(e.g. Dehaene et al., 2017; see also Lau 2022, p. 14)" — two; "e.g.",
      "see also" and page numbers do not change that.
  "(Chen et al., 2020a, 2020b)" — two: the letters make them different works.
  "Rosenthal (1997, 2005)" — two: one author, two years.
  "(Block, forthcoming)", "(Smith, in press)", "(Jones, n.d.)" — one each.
  "as Kaplan et al. 2020 argue" — one, with no brackets at all.
  "[12]" — one. "[3, 7, 12]" — three. "[3–6]" — four: 3, 4, 5 and 6.
  "memory1-7", "Wells et al.18", "shown before4,5" — superscript numbers that
      lost their formatting and run into the word: 1 to 7 is seven works.
  "[12]" or "12" before a Wikipedia-style notes list — the note's work.
  A footnote marker, and the work named in that footnote.
  A linked title, "in Attention Is All You Need", or a book named in the text
      with its author — one.

Every one of those is a row. A name on its own ("as Descartes thought") with no
year, note, number or title is a person, not a citation.`;

export function candidateSystem(): string {
  const today = systemPrompt();
  if (!OLD_HOW_MANY.test(today)) throw new Error("candidate prompt: HOW MANY passage not found in systemPrompt()");
  if (!today.includes(BEFORE_WHERE)) throw new Error("candidate prompt: WHERE section not found in systemPrompt()");
  return today.replace(OLD_HOW_MANY, NEW_HOW_MANY).replace(BEFORE_WHERE, `${FORMATS}\n\n${BEFORE_WHERE}`);
}

export const CANDIDATE_USER = "List every work this article cites.";
