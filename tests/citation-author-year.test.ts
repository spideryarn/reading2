/**
 * Author–year citations read by code — src/citation-author-year.ts, plan 261027b
 * (feedback spya-ez2vus: Levine 2021 was cited in LeCun's paragraph and never
 * listed). The paragraphs are the article's own, from
 * `10356-a-path-towards-autonomous-mach-spya-jwqnrf`.
 */
import { describe, expect, it } from "vitest";
import { authorYearCites, citeKey } from "../src/citation-author-year.js";

const LEVINE =
  "The idea that humans, animals, and intelligent systems use world models goes back a long time in psychology (Craik, 1943). The use of forward models that predict the next state of the world as a function of the current state and the action being considered has been standard procedure in optimal control since the 1950s (Bryson and Ho, 1969) and bears the name model-predictive control. The use of differentiable world models in reinforcement learning has long been neglected but is making a comeback (see for example (Levine, 2021))";

const LISTS =
  "The idea of learnable models has recently enjoyed a renewal of interest in various contexts (Ha and Schmidhuber, 2018b; Ha and Schmidhuber, 2018a; Hafner et al., 2018; Hafner et al., 2020) (see (Moerland et al., 2020) for a recent survey of model-based reinforcement learning).";

const UNBALANCED =
  "four classes of methods: discretization/quantification (e.g. as in VQ-VAE (Walker et al., 2021), dimensionality/rank minimization (e.g. as in Implicit Rank-Minimizing AE (Jing et al., 2020), sparsification (as in linear sparse modeling (Olshausen and Field, 1996), LISTA (Gregor and LeCun, 2010b), and fuzzyfication (as in noisy AE (Doi et al., 2007), VAE (Kingma and Welling, 2013)";

const keys = (text: string) => authorYearCites(text).map((c) => citeKey(c));
const quotes = (text: string) => authorYearCites(text).map((c) => text.slice(c.start, c.end));

describe("authorYearCites", () => {
  it("finds Levine 2021 inside a nested bracket, beside the two the model did list", () => {
    expect(keys(LEVINE)).toEqual(["craik 1943", "bryson 1969", "levine 2021"]);
    expect(quotes(LEVINE)).toEqual(["Craik, 1943", "Bryson and Ho, 1969", "Levine, 2021"]);
  });

  it("reads the authors as the text gives them", () => {
    const [craik, bryson, levine] = authorYearCites(LEVINE);
    expect(craik).toMatchObject({ surnames: ["Craik"], etAl: false, year: "1943" });
    expect(bryson).toMatchObject({ surnames: ["Bryson", "Ho"], etAl: false, year: "1969" });
    expect(levine).toMatchObject({ surnames: ["Levine"], etAl: false, year: "2021" });
  });

  it("splits a list on semicolons and keeps a year's letter", () => {
    expect(keys(LISTS)).toEqual([
      "ha 2018b",
      "ha 2018a",
      "hafner 2018",
      "hafner 2020",
      "moerland 2020",
    ]);
    expect(authorYearCites(LISTS)[2]).toMatchObject({ surnames: ["Hafner"], etAl: true });
  });

  it("finds a cite after an opening bracket that the article never closes", () => {
    expect(keys(UNBALANCED)).toEqual([
      "walker 2021",
      "jing 2020",
      "olshausen 1996",
      "gregor 2010b",
      "doi 2007",
      "kingma 2013",
    ]);
  });

  it("gives each year of one author its own cite, over the same words", () => {
    const text = "as shown before (Hafner et al., 2018, 2020).";
    expect(keys(text)).toEqual(["hafner 2018", "hafner 2020"]);
    expect(quotes(text)).toEqual(["Hafner et al., 2018, 2020", "Hafner et al., 2018, 2020"]);
  });

  it("reads the narrative form, its closing bracket included", () => {
    expect(quotes("As Becker and Hinton (1992) and Block (1995, 2002) showed")).toEqual([
      "Becker and Hinton (1992)",
      "Block (1995, 2002)",
      "Block (1995, 2002)",
    ]);
    expect(keys("As Becker and Hinton (1992) and LeCun et al. (2006) showed, and Levine (2021) reviews.")).toEqual([
      "becker 1992",
      "lecun 2006",
      "levine 2021",
    ]);
  });

  it("keeps a particle and an accent in the surname, and folds them in the key", () => {
    const text = "contrastive coding (van den Oord et al., 2018; Lavoisier, 1789; Grill-Spielberg, 2020; Dürer, 1525)";
    expect(keys(text)).toEqual(["oord 2018", "lavoisier 1789", "grill-spielberg 2020", "durer 1525"]);
    expect(authorYearCites(text)[0]!.surnames).toEqual(["van den Oord"]);
  });

  it("reads a surname from a script without letter case", () => {
    expect(keys("Earlier work reached the same result (李, 2020).")).toEqual(["李 2020"]);
  });

  it("reads three authors with a serial comma", () => {
    expect(authorYearCites("(Porter, Vollrath, and Shao, 2019)")[0]).toMatchObject({
      surnames: ["Porter", "Vollrath", "Shao"],
      year: "2019",
    });
  });

  it("reads nothing in a reference entry the extraction did not mark as one", () => {
    for (const text of [
      'Edmunds, Mike & Morgan, Philip (2000). "The Antikythera Mechanism: Still a Mystery of Greek Astronomy".',
      "James, Peter; Thorpe, Nick (1995). Ancient Inventions. Ballantine.",
      "Ptolemy (1998). Ptolemy's Almagest. Translated by Toomer, G. J.",
      "Russo, Lucio (2004). The Forgotten Revolution: How Science Was Born in 300 BC.",
      "OECD (2020). A review of competing accounts (Smith 2019, Jones 2018).",
      "李 (2020). 一项研究的标题。",
    ]) {
      expect(keys(text), text).toEqual([]);
    }
  });

  it("does not discard a prose block merely because its first sentence starts like an entry", () => {
    expect(keys("Smith (2020). Jones (2021) gives the contrasting account.")).toEqual([
      "smith 2020",
      "jones 2021",
    ]);
  });

  it("does not take a title's last word for an author", () => {
    expect(keys("The film Indiana Jones and the Dial of Destiny (2023) features a plot around it.")).toEqual([]);
    expect(keys("We met in Paris (2019) and again in Rome (2020).")).toEqual([]);
  });

  it("drops a possessive from the surname", () => {
    expect(keys("Following Marr’s (1982) levels, and Schneider's (2019) test")).toEqual(["marr 1982", "schneider 2019"]);
    expect(authorYearCites("Marr’s (1982) levels")[0]!.surnames).toEqual(["Marr"]);
  });

  it("is not fooled by a date, a figure, a decade or a year on its own", () => {
    for (const text of [
      "since the 1950s (Figure 3, 2021 version)",
      "It was released (January, 2021) to the public.",
      "In 2021, the field moved on.",
      "the model (GPT-3, 2020) was large",
      "(see Section 4, 2019)",
      "The results (Table 2, 2020) agree.",
      "a summer (2019) of work",
    ]) {
      expect(keys(text), text).toEqual([]);
    }
  });

  it("does not treat arbitrary lowercase prose inside parentheses as a citation lead-in", () => {
    expect(keys("The software was (released for Linux, 2020), and the paper was (published in Nature, 2021)."))
      .toEqual([]);
  });

  it("does not rescan every suffix of a long malformed author list", () => {
    const hostile = `(${"Smith, ".repeat(7_200)})`;
    const started = performance.now();
    expect(authorYearCites(hostile)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(750);
  });
});

/* Wikipedia's synesthesia article (plan 261027b's measurement): a title
   followed by its year, in a page that cites by footnote. */
describe("a name in capitals is not a surname", () => {
  it("reads nothing in the manual's numeral", () => {
    expect(keys("not listed in the Diagnostic and Statistical Manual of Mental Disorders IV (1994) or elsewhere")).toEqual([]);
    expect(keys("as the agency reported (OECD, 2019)")).toEqual([]);
  });
});

describe("the form of each citation", () => {
  it("is said, so a lone name before a year can be weighed against the article", () => {
    expect(authorYearCites("Rimbaud later wrote Voyelles (1871), and (Craik, 1943) and Hafner et al. (2018).").map((c) => c.form)).toEqual([
      "narrative",
      "parenthetical",
      "narrative",
    ]);
  });
});

/* After the code review narrowed the lead-in to citation signals: the signals
   NIHMS 536461 and arXiv 2308.08708 actually use (plan 261027b). */
describe("the citation signals before the names", () => {
  it("reads each one", () => {
    expect(
      keys(
        "a (e.g., Miller & Cohen, 2001) b (see also Banich, 2009) c (see e.g. Block, 1995) d (but see Tye, 1995) e (for recent reviews, see Seth, 2022) f (i.e., Lamme, 2006) g (cf. Baars, 1988)",
      ),
    ).toEqual(["miller 2001", "banich 2009", "block 1995", "tye 1995", "seth 2022", "lamme 2006", "baars 1988"]);
  });
});

/* Butlin et al., *Consciousness in Artificial Intelligence* (arXiv 2308.08708,
   `arxiv-2308-08708-spya-xax6v4`), which separates the items of a list with a
   comma rather than a semicolon. Only the first item was read, so Rosenthal
   2005 was never marked in the paragraph Greg reported (spya-d5e2jk, plan
   261029b). */
describe("a list whose items are separated by commas", () => {
  const HOT =
    "Higher-order theories have long been advocated by philosophers (Carruthers & Gennaro 2020, Rosenthal 2005). One of the main motivations for the view is the so-called “simple argument” (Lycan 2001): if a mental state is conscious, the subject is aware that they are in that state";
  const GWT =
    "a neural version of the theory (Dehaene et al. 1998, 2003, Dehaene & Naccache 2001, Dehaene & Changeux 2011, Mashour et al. 2020). P";

  it("reads every item, not only the first", () => {
    expect(keys(HOT)).toEqual(["carruthers 2020", "rosenthal 2005", "lycan 2001"]);
    expect(quotes(HOT)).toEqual(["Carruthers & Gennaro 2020", "Rosenthal 2005", "Lycan 2001"]);
  });

  it("reads past an author's second year to the next author", () => {
    expect(keys(GWT)).toEqual(["dehaene 1998", "dehaene 2003", "dehaene 2001", "dehaene 2011", "mashour 2020"]);
    expect(keys("(e.g. Franklin & Graesser 1999, Shanahan 2006, Bao et al. 2020).")).toEqual([
      "franklin 1999",
      "shanahan 2006",
      "bao 2020",
    ]);
  });

  it("does not start a list from a year that was not itself a citation", () => {
    expect(keys("(founded in 2019, Kenya 2021, and Peru 2022)")).toEqual([]);
    expect(keys("In 2019, Smith 2020, and so on")).toEqual([]);
  });

  it("stops at a word that is not a surname", () => {
    expect(keys("(Lycan 2001, Table 2)")).toEqual(["lycan 2001"]);
    expect(keys("(Lycan 2001, p. 5)")).toEqual(["lycan 2001"]);
  });
});
