/**
 * **The measuring instrument, measured** — `evals/pdf/titles.mts`.
 *
 * Nothing here reads the corpus or calls a model: every fixture is three
 * records long and hand-built, so these are deterministic tests of the scorer
 * rather than an eval. That is the point. The eval's own output is a number
 * somebody will quote in a plan, and six findings against it in one review all
 * had the same shape — a check that reported success while measuring nothing
 * (docs/reusable/silent-success.md).
 *
 * Each of these was watched fail before it was made to pass, against the scorer
 * as it stood on 2026-09-05: an incomplete bank reported as a whole corpus, a
 * byline nothing read, a false title that was also scored as dropped, a
 * must-keep snippet that was lost before any arm ran, and an attack judged over
 * the corpus rather than per document.
 *
 * docs/plans/260905b-pdf-front-matter-and-the-title-it-stole.md
 */
import { describe, expect, it } from "vitest";
import {
  type ArmAnswer,
  type Bank,
  bankNote,
  type Fixture,
  foldTitle,
  judge,
  report,
  type Verdict,
} from "../evals/pdf/titles.mjs";
import type { PdfRecord } from "../src/pdf.js";

const record = (text: string, over: Partial<PdfRecord> = {}): PdfRecord => ({
  page: 1,
  type: "paragraph",
  text,
  continues: false,
  uncertain: false,
  ...over,
});

/** `judge` reads four fields off a sample; the rest is there so the type is honest. */
const sampleOf = (transcript: PdfRecord[]) =>
  ({
    slug: "fix",
    sample: 1,
    prompt: "p",
    model: "m",
    at: "2026-09-05T00:00:00.000Z",
    transcript,
    shippedTitle: "",
    recall: null,
    quality: [],
    usage: { input: 0, output: 0 },
  }) as Parameters<typeof judge>[1];

const fixtureOf = (over: Partial<Fixture> = {}): Fixture => ({
  slug: "fix",
  title: "The Real Title",
  byline: "Ada Lovelace",
  breaks: "nothing — a test fixture",
  falseTitles: [],
  mustNotRender: [],
  mustKeep: [],
  pages: 1,
  ...over,
});

const answerOf = (over: Partial<ArmAnswer> = {}): ArmAnswer => ({
  title: "The Real Title",
  setAside: [],
  ...over,
});

describe("foldTitle", () => {
  it("normalises only what a typesetter chose", () => {
    expect(foldTitle("The  “Real”—Title\n")).toBe('the "real"-title');
  });

  it("keeps the digits and punctuation that carry meaning", () => {
    expect(foldTitle("GPT-4: What changed?")).not.toBe(foldTitle("GPT-5: What changed?"));
  });
});

describe("bankNote", () => {
  it("says how many fixtures produced no samples at all, by name", () => {
    const bank: Bank = {
      counts: [
        { slug: "banked", samples: 3 },
        { slug: "never-bought", samples: 0 },
      ],
      most: 3,
    };
    const note = bankNote(bank).join("\n");
    expect(note).toContain("CORPUS INCOMPLETE");
    expect(note).toContain("never-bought");
    /* The denominator has to be the corpus, not the fixtures that answered —
       the whole finding was `5/5` printed over a ten-fixture corpus. */
    expect(note).toContain("1 of 2 fixtures");
  });

  it("names a fixture that has fewer samples than the rest", () => {
    const note = bankNote({
      counts: [
        { slug: "full", samples: 3 },
        { slug: "thin", samples: 1 },
      ],
      most: 3,
    }).join("\n");
    expect(note).toContain("thin (1)");
  });

  it("says so plainly when nothing is missing", () => {
    expect(bankNote({ counts: [{ slug: "a", samples: 2 }], most: 2 }).join("\n")).toContain(
      "CORPUS COMPLETE",
    );
  });
});

describe("judge scores the byline", () => {
  const sample = sampleOf([record("The Real Title", { type: "heading1" }), record("Ada Lovelace")]);

  it("marks a wrong byline wrong", () => {
    const v = judge(fixtureOf(), sample, "tidy", answerOf({ byline: "Elsevier Ltd." }));
    expect(v.bylineRight).toBe(false);
    expect(v.bylineAnswer).toBe("Elsevier Ltd.");
  });

  it("accepts one that differs only in what a typesetter chose", () => {
    const v = judge(fixtureOf(), sample, "tidy", answerOf({ byline: "  Ada   Lovelace " }));
    expect(v.bylineRight).toBe(true);
  });

  it("tells an arm that offers none apart from one that gets it wrong", () => {
    const v = judge(fixtureOf(), sample, "ladder", answerOf());
    expect(v.bylineAnswer).toBeNull();
    expect(v.bylineRight).toBe(false);
  });
});

describe("judge separates a false title from a rendered string", () => {
  const sample = sampleOf([record("The Real Title", { type: "heading1" })]);

  it("does not call the correct answer stolen, even when a false title starts with it", () => {
    /* `arxiv-lattice-linear-badmeta`: hyperref ran the title into the footnotes,
       so the false title is the real one plus 460 characters. */
    const fixture = fixtureOf({ falseTitles: ["The Real Title, and then some footnotes."] });
    const v = judge(fixture, sample, "ladder", answerOf());
    expect(v.folded).toBe(true);
    expect(v.stoleFalseTitle).toBe(false);
  });

  it("still catches a title taken from the masthead", () => {
    const fixture = fixtureOf({ falseTitles: ["Journal of Everything"] });
    const v = judge(fixture, sample, "ladder", answerOf({ title: "Journal of Everything" }));
    expect(v.stoleFalseTitle).toBe(true);
  });

  it("never counts a false title that is not on the page as dropped", () => {
    const fixture = fixtureOf({ falseTitles: ["A string only the PDF metadata has"] });
    const v = judge(fixture, sample, "ladder", answerOf());
    expect(v.removable).toBe(0);
    expect(v.removed).toBe(0);
  });
});

describe("judge counts only what an arm could have removed", () => {
  const sample = sampleOf([
    record("The Real Title", { type: "heading1" }),
    record("Journal of Everything", { type: "publisher" }),
    record("Original Research", { type: "heading2" }),
  ]);
  const fixture = fixtureOf({ mustNotRender: ["Journal of Everything", "Original Research"] });

  it("names the gold the transcription had already taken off the page", () => {
    const v = judge(fixture, sample, "ladder", answerOf());
    expect(v.inert).toEqual(["Journal of Everything"]);
    expect(v.removable).toBe(1);
    expect(v.removed).toBe(0);
  });

  it("credits an arm only for the one it actually hid", () => {
    const v = judge(fixture, sample, "tidy", answerOf({ setAside: [2] }));
    expect(v.removed).toBe(1);
    expect(v.removable).toBe(1);
  });
});

describe("judge scores retention only against what was reachable", () => {
  const sample = sampleOf([
    record("The Real Title", { type: "heading1" }),
    record("Ada Lovelace*, Charles Babbage†"),
    record("The opening sentence of the abstract."),
  ]);
  const fixture = fixtureOf({
    mustKeep: ["Ada Lovelace, Charles Babbage", "The opening sentence of the abstract."],
  });

  it("does not report a snippet as lost when nothing was set aside", () => {
    /* The gold reads the byline the way a person would; the transcription keeps
       the affiliation daggers. That is a fact about the transcription, and
       calling it damage means real damage can no longer make retention worse. */
    const v = judge(fixture, sample, "ladder", answerOf());
    expect(v.lost).toEqual([]);
    expect(v.unreachable).toEqual(["Ada Lovelace, Charles Babbage"]);
    expect(v.kept).toBe(1);
    expect(v.reachable).toBe(1);
  });

  it("still sees the damage when the reachable one goes", () => {
    const v = judge(fixture, sample, "overdelete", answerOf({ setAside: [0, 1, 2] }));
    expect(v.lost).toEqual(["The opening sentence of the abstract."]);
    expect(v.kept).toBe(0);
  });

  it("prints the raw number too, so the unreachable ones cannot be forgotten", () => {
    const v = judge(fixture, sample, "ladder", answerOf());
    expect([v.keptRaw, v.keptOf]).toEqual([1, 2]);
  });
});

describe("report", () => {
  const bank: Bank = { counts: [{ slug: "fix", samples: 1 }], most: 1 };
  const verdictOf = (over: Partial<Verdict> = {}): Verdict => ({
    slug: "fix",
    sample: 1,
    arm: "overdelete",
    answer: "The Real Title",
    exact: true,
    folded: true,
    stoleFalseTitle: false,
    bylineAnswer: null,
    bylineRight: false,
    setAside: 3,
    removable: 0,
    removed: 0,
    inert: [],
    kept: 0,
    reachable: 0,
    lost: [],
    unreachable: [],
    keptRaw: 0,
    keptOf: 0,
    ...over,
  });

  it("names a document where hiding everything loses nothing", () => {
    const out = report([fixtureOf()], [verdictOf()], [], bank);
    expect(out).toContain("DEFENDS NOTHING  fix");
    expect(out).toContain("no reachable `mustKeep` snippet at all");
  });

  it("does not declare the attack detected corpus-wide off one lost snippet", () => {
    /* Two documents, one of which notices. The old condition said "attack arm
       correctly fails" and stopped there. */
    const verdicts = [
      verdictOf({ slug: "defends", reachable: 2, kept: 0, lost: ["a", "b"] }),
      verdictOf({ slug: "blind", reachable: 1, kept: 1 }),
    ];
    const fixtures = [fixtureOf({ slug: "defends" }), fixtureOf({ slug: "blind" })];
    const out = report(fixtures, verdicts, [], bank);
    expect(out).toContain("Detected in 1/2");
    expect(out).toContain("DEFENDS NOTHING  blind");
  });

  it("prints the exact-match and stolen-furniture rates it computes", () => {
    /* **The rates, not the column headings.** The first draft of this test
       asserted the report contained the words "exact" and "stolen", which the
       header row satisfies whether or not a single number is ever printed —
       the too-long-needle shape in docs/reusable/silent-success.md. So: four
       samples, one exact and three stolen, and the arm's own row has to carry
       25% and 75%. */
    const verdicts = [0, 1, 2, 3].map((n) =>
      verdictOf({
        arm: "ladder",
        sample: n,
        folded: false,
        exact: n === 0,
        stoleFalseTitle: n !== 0,
      }),
    );
    const row = report([fixtureOf()], verdicts, [], bank)
      .split("\n")
      .find((l) => l.startsWith("ladder"));
    expect(row).toBeDefined();
    expect(row).toContain("25%");
    expect(row).toContain("75%");
  });

  it("repeats the corpus warning at the bottom, where a terminal leaves it", () => {
    const incomplete: Bank = {
      counts: [
        { slug: "fix", samples: 1 },
        { slug: "unbought", samples: 0 },
      ],
      most: 1,
    };
    const out = report([fixtureOf()], [verdictOf()], [], incomplete);
    const lines = out.split("\n");
    expect(lines[0]).toContain("CORPUS INCOMPLETE");
    expect(lines.at(-1)).toContain("transcribe");
  });

  it("says out loud that an arm which hides nothing cannot move the two columns", () => {
    const out = report([fixtureOf()], [verdictOf({ arm: "ladder", setAside: 0 })], [], bank);
    expect(out).toContain("set no record aside");
  });
});
