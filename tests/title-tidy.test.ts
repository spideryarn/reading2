import { describe, expect, it } from "vitest";

import { tidiedTitle, tidyTitle } from "../src/title-tidy.js";

describe("tidyTitle: a title wholly in capitals becomes title case", () => {
  it.each([
    ["THE ORDER OF TIME", "The Order of Time"],
    ["A BRIEF HISTORY OF NEARLY EVERYTHING", "A Brief History of Nearly Everything"],
    ["WHAT ARE WE WAITING FOR", "What Are We Waiting For"],
    ["THINKING, FAST AND SLOW", "Thinking, Fast and Slow"],
    ["THE GENE: AN INTIMATE HISTORY", "The Gene: An Intimate History"],
    ["HOFSTADTER, ESCHER, BACH — AN ETERNAL GOLDEN BRAID", "Hofstadter, Escher, Bach — An Eternal Golden Braid"],
    ["WHO WROTE IT? A STUDY IN AUTHORSHIP", "Who Wrote It? A Study in Authorship"],
    ["“THE ORDER OF TIME”", "“The Order of Time”"],
    ["THE STATE-OF-THE-ART IN SELF-ESTEEM", "The State-of-the-Art in Self-Esteem"],
  ])("%s", (given, wanted) => {
    expect(tidyTitle(given)).toBe(wanted);
  });

  it.each([
    ["WORLD WAR II AND AFTER", "World War II and After"],
    ["HENRY VIII: A LIFE", "Henry VIII: A Life"],
    ["THE CHEMISTRY OF CO2 CAPTURE", "The Chemistry of CO2 Capture"],
    ["J.R.R. TOLKIEN AND THE GREAT WAR", "J.R.R. Tolkien and the Great War"],
    ["J. R. R. TOLKIEN AND THE GREAT WAR", "J. R. R. Tolkien and the Great War"],
    ["THE PAPERS OF J. A. SMITH", "The Papers of J. A. Smith"],
    ["ROVELLI'S ORDER OF TIME", "Rovelli's Order of Time"],
    ["O'BRIEN AND D’ARTAGNAN DON'T AGREE", "O'Brien and D’Artagnan Don't Agree"],
  ])("keeps what a rule can recognise: %s", (given, wanted) => {
    expect(tidyTitle(given)).toBe(wanted);
  });

  it("a small word is capitalised first, last, and after a colon", () => {
    expect(tidyTitle("OF MICE AND MEN: A STORY TO LIVE BY")).toBe("Of Mice and Men: A Story to Live By");
  });
});

describe("tidyTitle: what it leaves alone", () => {
  it.each([
    "The Order of Time",
    "Why NASA Failed",
    "the order of time",
    "UNESCO",
    "NASA",
    "BBC NEWS",
    "DNA AND RNA",
    "IBM",
    "",
    "E = mc²",
    "Catch-22",
    "iPhone review: the BEST one yet",
  ])("%s", (title) => {
    expect(tidyTitle(title)).toBe(title);
  });

  it("a page that declares another language keeps its capitals", () => {
    expect(tidyTitle("DIE ORDNUNG DER ZEIT", { lang: "de" })).toBe("DIE ORDNUNG DER ZEIT");
    expect(tidyTitle("L'ORDRE DU TEMPS", { lang: "fr-FR" })).toBe("L'ORDRE DU TEMPS");
  });

  it("a page that declares English, in any spelling, is tidied", () => {
    expect(tidyTitle("THE ORDER OF TIME", { lang: "en-GB" })).toBe("The Order of Time");
    expect(tidyTitle("THE ORDER OF TIME", { lang: "EN" })).toBe("The Order of Time");
    expect(tidyTitle("THE ORDER OF TIME", { lang: null })).toBe("The Order of Time");
  });
});

describe("tidyTitle: an acronym is recognised from the article's own body", () => {
  const body =
    "NASA was founded in 1958. The future of NASA is the future of the agency. " +
    "Some say NASA has lost its way. The agency's future is open.";

  it("a word the body writes in capitals stays in capitals", () => {
    expect(tidyTitle("THE FUTURE OF NASA", { body })).toBe("The Future of NASA");
  });

  it("and without a body no word is taken for one", () => {
    expect(tidyTitle("THE FUTURE OF NASA")).toBe("The Future of Nasa");
  });

  it("one shout in the body is not evidence", () => {
    expect(tidyTitle("THE FUTURE OF EVERYTHING", { body: "EVERYTHING changes. But everything stays." })).toBe(
      "The Future of Everything",
    );
  });

  it("the title repeated in the body, as a heading or a running head, does not count", () => {
    const heads = Array.from({ length: 12 }, () => "THE ORDER OF TIME\nTime passes, and its order with it.").join("\n");
    expect(tidyTitle("THE ORDER OF TIME", { body: heads })).toBe("The Order of Time");
  });

  it("a body printed in capitals is evidence of nothing", () => {
    const shouted = "THE FUTURE OF NASA IS THE FUTURE. THE FUTURE OF NASA IS NOW. NASA NASA.";
    expect(tidyTitle("THE FUTURE OF NASA AGAIN", { body: shouted })).toBe("The Future of Nasa Again");
  });

  it("a shortened running head does not make its words acronyms, because the prose uses them too", () => {
    const pages = Array.from({ length: 12 }, () => "ORDER OF TIME\nTime passes, and its order with it.").join("\n");
    expect(tidyTitle("THE ORDER OF TIME", { body: pages })).toBe("The Order of Time");
  });

  it("a name the rule cannot know is a known miss", () => {
    expect(tidyTitle("THE MCDONALD PAPERS")).toBe("The Mcdonald Papers");
  });

  it("with no language declared, a title with an accented capital is left as it came", () => {
    expect(tidyTitle("GÖDEL, ESCHER, BACH")).toBe("GÖDEL, ESCHER, BACH");
    expect(tidyTitle("İSTANBUL VE ZAMAN ÜZERİNE")).toBe("İSTANBUL VE ZAMAN ÜZERİNE");
    expect(tidyTitle("GÖDEL, ESCHER, BACH", { lang: "en" })).toBe("Gödel, Escher, Bach");
  });

  it("a possessive acronym keeps its capitals and its lower-case s", () => {
    expect(tidyTitle("NASA'S LONG FUTURE", { body })).toBe("NASA's Long Future");
  });
});

describe("tidyTitle: trailing footnote markers", () => {
  it.each([
    ["Attention Is All You Need*", "Attention Is All You Need"],
    ["Attention Is All You Need †", "Attention Is All You Need"],
    ["Attention Is All You Need*†‡", "Attention Is All You Need"],
    ["THE ORDER OF TIME*", "The Order of Time"],
  ])("%s", (given, wanted) => {
    expect(tidyTitle(given)).toBe(wanted);
  });

  it.each(["Pathfinding with A*", "C*", "*", "M*A*S*H"])("but not %s", (title) => {
    expect(tidyTitle(title)).toBe(title);
  });
});

describe("tidiedTitle: the pair the extractors store", () => {
  it("keeps the original only when the title changed", () => {
    expect(tidiedTitle("THE ORDER OF TIME")).toEqual({ title: "The Order of Time", titleOriginal: "THE ORDER OF TIME" });
    expect(tidiedTitle("The Order of Time")).toEqual({ title: "The Order of Time" });
  });

  it("is settled: tidying a tidied title changes nothing", () => {
    for (const title of ["THE ORDER OF TIME", "THE FUTURE OF NASA*", "HENRY VIII: A LIFE"]) {
      const once = tidyTitle(title);
      expect(tidyTitle(once)).toBe(once);
    }
  });
});
