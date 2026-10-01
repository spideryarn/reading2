/**
 * **The provenance check on a PDF's authors** — src/pdf-authors.ts, plan
 * 260929d § 3. The byline and affiliation texts are the real records from
 * evals/pdf/titles/ (transcribed first pages), so the marker shapes are the ones
 * that actually arrive: digits glued and spaced, superscripts, asterisks, and a
 * letter glued to the surname.
 */
import { describe, expect, it } from "vitest";
import {
  AuthorsUnreadable,
  type AuthorsReader,
  authorsPrompt,
  parseAuthors,
  readAuthors,
  markersAfter,
  trimAffiliation,
  trimName,
  verifyAuthors,
  words,
} from "../src/pdf-authors.js";
import type { PdfRecord } from "../src/pdf.js";
import { frontMatterWindow } from "../src/pdf-frontmatter.js";

const FRONTIERS_BYLINE = "Mei-jun Ou1, Xiang-hua Xu2, Hong Chen1, Fu-rong Chen3 and Shuai Shen4*";
const FRONTIERS_AFFILIATIONS =
  "1 Head and Neck Surgery Department, Hunan Cancer Hospital, Changsha, China, 2 Health Service Center, Hunan Cancer Hospital, Changsha, China";
const ARNN_BYLINE = "Salim Rukhsara,∗\n, Anil K.Tiwaria\n aDepartment of Electrical Engineering, IIT Jodhpur, 342037, India";
const COPERNICUS_BYLINE = "Alexander G. Keul¹,☆";
const COPERNICUS_AFFILIATION = "¹Environmental Psychology, Salzburg University, Salzburg, Austria\n☆retired";

const one = (name: string, affiliations: string[] = []) => ({ name, affiliations });

describe("words", () => {
  it("folds case and diacritics, reads a superscript as its digit, and splits on everything else", () => {
    expect(words("María Angélica ¹Farfán-Casadiego")).toEqual(["maria", "angelica", "1farfan", "casadiego"]);
  });
});

describe("verifyAuthors", () => {
  it("takes names with their glued digit markers dropped, and affiliations cut out of a packed record", () => {
    const verdict = verifyAuthors(
      [
        one("Mei-jun Ou", ["Head and Neck Surgery Department, Hunan Cancer Hospital, Changsha, China"]),
        one("Xiang-hua Xu", ["Health Service Center, Hunan Cancer Hospital, Changsha, China"]),
        one("Hong Chen"),
        one("Fu-rong Chen"),
        one("Shuai Shen"),
      ],
      FRONTIERS_BYLINE,
      [`${FRONTIERS_BYLINE}\n${FRONTIERS_AFFILIATIONS}`],
    );
    expect(verdict.authors?.map((a) => a.name)).toEqual(["Mei-jun Ou", "Xiang-hua Xu", "Hong Chen", "Fu-rong Chen", "Shuai Shen"]);
    expect(verdict.authors?.[1]?.affiliations).toEqual(["Health Service Center, Hunan Cancer Hospital, Changsha, China"]);
  });

  it("takes a name with an affiliation LETTER glued to the surname dropped — Rukhsara is Rukhsar", () => {
    const verdict = verifyAuthors(
      [one("Salim Rukhsar", ["Department of Electrical Engineering, IIT Jodhpur, 342037, India"]), one("Anil K. Tiwari")],
      ARNN_BYLINE,
      [ARNN_BYLINE],
    );
    /* The PAGE's characters, not the model's: it printed "K.Tiwari", no space. */
    expect(verdict.authors?.map((a) => a.name)).toEqual(["Salim Rukhsar", "Anil K.Tiwari"]);
  });

  it("reads a superscript marker glued before an affiliation", () => {
    const verdict = verifyAuthors(
      [one("Alexander G. Keul", ["Environmental Psychology, Salzburg University, Salzburg, Austria"])],
      COPERNICUS_BYLINE,
      [`${COPERNICUS_BYLINE}\n${COPERNICUS_AFFILIATION}`],
    );
    expect(verdict.authors).toEqual([
      { name: "Alexander G. Keul", affiliations: ["Environmental Psychology, Salzburg University, Salzburg, Austria"] },
    ]);
  });

  it("does not trim a real leading number from an affiliation without the same marker on the name", () => {
    expect(trimAffiliation("3M Company", new Set())).toBe("3M Company");
    expect(trimAffiliation("3M Company", new Set(["1"]))).toBe("3M Company");
    expect(verifyAuthors([one("Jane Doe", ["3M Company"])], "Jane Doe", ["3M Company"]).authors).toEqual([
      { name: "Jane Doe", affiliations: ["3M Company"] },
    ]);
    expect(verifyAuthors([one("Jane Doe", ["123 Main Street"])], "Jane Doe", ["123 Main Street"]).authors).toEqual([
      { name: "Jane Doe", affiliations: ["123 Main Street"] },
    ]);
  });

  it("reads the markers off the PAGE, so a model that left them off the name still gets the affiliation trimmed", () => {
    /* The model wrote "Mei-jun Ou" (no marker); the page says Ou1, so the "1 " comes off. */
    /* The byline cut to its first author: one name of five would now be a trailing author dropped (C4). */
    const verdict = verifyAuthors([one("Mei-jun Ou", ["1 Head and Neck Surgery Department"])], "Mei-jun Ou1,", [
      FRONTIERS_AFFILIATIONS,
    ]);
    expect(verdict.authors?.[0]?.affiliations).toEqual(["Head and Neck Surgery Department"]);
    /* A spaced marker after the name counts too: "Newman 1,* ,". */
    expect(markersAfter("Ehren L. Newman 1,* , Thomas F. Varley 2", "Ehren L. Newman".length)).toEqual(new Set(["1"]));
    /* And two markers on one name: "Ou1,2". */
    expect(markersAfter("Ou1,2, Xu3", 2)).toEqual(new Set(["1", "2"]));
  });

  it("cuts a glued letter marker off an affiliation only when it is the author's", () => {
    expect(trimAffiliation("aDepartment of Electrical Engineering", new Set(["a"]))).toBe("Department of Electrical Engineering");
    expect(trimAffiliation("eBay Research", new Set(["a"]))).toBe("eBay Research");
  });

  it("always cuts leading symbols — no institution starts with * or ☆ — and keeps the rest", () => {
    expect(trimAffiliation("* Universidad Francisco de Paula Santander", new Set())).toBe("Universidad Francisco de Paula Santander");
    expect(trimAffiliation("☆ 1 Somewhere", new Set(["1"]))).toBe("Somewhere");
  });

  it("refuses a list that leaves out somebody printed before or between the names it gives", () => {
    const middle = verifyAuthors([one("Mei-jun Ou"), one("Hong Chen")], FRONTIERS_BYLINE, [FRONTIERS_BYLINE]);
    expect(middle.authors).toBeNull();
    const first = verifyAuthors([one("Xiang-hua Xu")], FRONTIERS_BYLINE, [FRONTIERS_BYLINE]);
    expect(first.authors).toBeNull();
    /* The control: all five, with markers and "and" between them, pass. */
    const all = ["Mei-jun Ou", "Xiang-hua Xu", "Hong Chen", "Fu-rong Chen", "Shuai Shen"].map((n) => one(n));
    expect(verifyAuthors(all, FRONTIERS_BYLINE, [FRONTIERS_BYLINE]).authors).toHaveLength(5);
    /* A spaced marker between names is not a person: "Newman 1,* , Thomas". */
    const newman = "Ehren L. Newman 1,* , Thomas F. Varley 1,* and John M. Beggs 3";
    expect(verifyAuthors([one("Ehren L. Newman"), one("Thomas F. Varley"), one("John M. Beggs")], newman, [newman]).authors).toHaveLength(3);
  });

  describe("stacked bylines: an affiliation already verified, or an email, is not a skipped person (plan 261001l)", () => {
    /* The NeurIPS shape: name / institution / email per author, which the
       byline record reads as one run. Lu et al. on production was refused
       whole and the reader got this run as the byline (260930e). */
    const STACKED =
      "Qihong Lu Princeton University qlu@princeton.edu Po-Hsuan Chen Princeton University pohsuan@princeton.edu Kenneth A. Norman Princeton University knorman@princeton.edu";
    const lu = [
      one("Qihong Lu", ["Princeton University"]),
      one("Po-Hsuan Chen", ["Princeton University"]),
      one("Kenneth A. Norman", ["Princeton University"]),
    ];

    it("takes a stacked byline whole", () => {
      expect(verifyAuthors(lu, STACKED, [STACKED]).authors?.map((a) => a.name)).toEqual([
        "Qihong Lu",
        "Po-Hsuan Chen",
        "Kenneth A. Norman",
      ]);
    });

    it("still refuses a stacked byline with an author left out — in the middle or at the end", () => {
      expect(verifyAuthors([lu[0]!, lu[2]!], STACKED, [STACKED]).authors).toBeNull();
      expect(verifyAuthors([lu[0]!, lu[1]!], STACKED, [STACKED]).authors).toBeNull();
    });

    it("does not let an affiliation account for words before the author it belongs to", () => {
      /* "Princeton University" is only accounting once some author printed
         before the gap has verified it; author 1 has none here. */
      const answer = [one("Qihong Lu"), one("Po-Hsuan Chen", ["Princeton University"]), one("Kenneth A. Norman")];
      expect(verifyAuthors(answer, STACKED, [STACKED]).authors).toBeNull();
    });

    it("refuses a dropped author whose name and institution were passed off as the previous author's affiliation", () => {
      /* GPT Sol, plan review P1-1: both "affiliations" are printed, so both
         verify; the second email is what gives Bob away. */
      const byline = "Alice Adams Acme University alice@acme.edu Bob Brown Beta Institute bob@beta.edu Carol Clark";
      const answer = [one("Alice Adams", ["Acme University", "Bob Brown Beta Institute"]), one("Carol Clark")];
      expect(verifyAuthors(answer, byline, [byline]).authors).toBeNull();
      /* Nor the names alone, when an unrelated affiliation also fails. */
      const namesOnly = [answer[0]!, one("Carol Clark", ["Nowhere Institute"])];
      expect(verifyAuthors(namesOnly, byline, [byline])).toMatchObject({ authors: null, note: expect.stringMatching(/as printed/) });
      /* The control: all three are taken. */
      const all = [one("Alice Adams", ["Acme University"]), one("Bob Brown", ["Beta Institute"]), one("Carol Clark")];
      expect(verifyAuthors(all, byline, [byline]).authors).toHaveLength(3);
    });

    it("takes names printed together and their institutions and addresses after — one address per author", () => {
      const grid =
        "Ashish Vaswani∗ Noam Shazeer∗ Google Brain Google Brain { avaswani,noam } @ google.com Niki Parmar∗ Google Research nikip@google.com";
      const answer = [
        one("Ashish Vaswani", ["Google Brain"]),
        one("Noam Shazeer", ["Google Brain"]),
        one("Niki Parmar", ["Google Research"]),
      ];
      expect(verifyAuthors(answer, grid, [grid]).authors?.map((a) => a.name)).toEqual([
        "Ashish Vaswani",
        "Noam Shazeer",
        "Niki Parmar",
      ]);
      /* Without Noam, the braces hold two addresses for a block of one. */
      expect(verifyAuthors([answer[0]!, answer[2]!], grid, [grid]).authors).toBeNull();
      /* Fewer addresses than authors is not a block either: nothing delimits it. */
      const shared = "Jason Wei Denny Zhou Google Research {jasonwei}@google.com";
      expect(verifyAuthors([one("Jason Wei", ["Google Research"]), one("Denny Zhou", ["Google Research"])], shared, [shared]).authors).toBeNull();
    });

    it("refuses an affiliation printed after the addresses — a person without an address passed off as one", () => {
      /* The eval's row-major Attention byline (plan 261001l). */
      const rows = "Llion Jones Łukasz Kaiser Google Research Google Brain llion@google.com lukaszkaiser@google.com ∗ ‡ Illia Polosukhin";
      const answer = [one("Llion Jones", ["Google Research"]), one("Łukasz Kaiser", ["Google Brain", "Illia Polosukhin"])];
      expect(verifyAuthors(answer, rows, [rows]).authors).toBeNull();
      expect(verifyAuthors([...answer.slice(0, 1), one("Łukasz Kaiser", ["Google Brain"]), one("Illia Polosukhin")], rows, [rows]).authors).toHaveLength(3);
    });

    it("an email address never swallows the name beside it", () => {
      const spaced = "Qihong Lu Princeton University qlu@princeton.edu Po-Hsuan Chen";
      expect(verifyAuthors([one("Qihong Lu", ["Princeton University"])], spaced, [spaced]).authors).toBeNull();
      /* Fused: a greedy domain would read "eduDeepMind" as its top-level label. */
      const fused = "Qihong Lu Princeton University qlu@princeton.eduDeepMind";
      expect(verifyAuthors([one("Qihong Lu", ["Princeton University"])], fused, [fused]).authors).toBeNull();
      /* The control: punctuation straight after the address is not a word. */
      const comma = "Qihong Lu Princeton University qlu@princeton.edu, Po-Hsuan Chen Princeton University pchen@princeton.edu";
      expect(verifyAuthors(lu.slice(0, 2), comma, [comma]).authors).toHaveLength(2);
    });
  });

  it("refuses an ordinary list that leaves out an author printed after the last name it gives (260930e C4)", () => {
    expect(verifyAuthors([one("Mei-jun Ou")], FRONTIERS_BYLINE, [FRONTIERS_BYLINE]).authors).toBeNull();
    /* The control: an affiliation fused onto the byline record, led by the
       marker the page printed on its author's name, is not a person. */
    const verdict = verifyAuthors(
      [one("Salim Rukhsar", ["Department of Electrical Engineering, IIT Jodhpur, 342037, India"]), one("Anil K. Tiwari")],
      ARNN_BYLINE,
      [ARNN_BYLINE],
    );
    expect(verdict.authors).toHaveLength(2);
  });

  it("says nothing when nothing was offered — the byline stands as printed, with no note", () => {
    expect(verifyAuthors([], FRONTIERS_BYLINE, [FRONTIERS_BYLINE])).toEqual({ authors: null, note: null });
  });

  describe("refuses the whole list, with a note, when any author was not copied", () => {
    const refused = (answer: Parameters<typeof verifyAuthors>[0], pages = [FRONTIERS_BYLINE + FRONTIERS_AFFILIATIONS]) => {
      const verdict = verifyAuthors(answer, FRONTIERS_BYLINE, pages);
      expect(verdict.authors).toBeNull();
      expect("note" in verdict && verdict.note).toMatch(/Kept the byline as printed/);
    };

    it("an invented name", () => refused([one("Mei-jun Ou"), one("Ignore Previous Instructions")]));
    it("a respelt name", () => refused([one("Meijun Oh")]));
    it("a name's last word truncated rather than a marker dropped", () => refused([one("Mei-jun O")]));
    it("a name's earlier word truncated", () => refused([one("Mei-j Ou")]));
    it("a name with an invented word inside it", () => refused([one("Mei-jun 999 Ou")]));
    it("a name with no words at all", () => refused([one("--- ,,, ***")]));
    it("names reordered", () => refused([one("Ou Mei-jun")]));
    it("real authors reordered", () => refused([one("Xiang-hua Xu"), one("Mei-jun Ou")]));
    it("one printed author repeated", () => refused([one("Mei-jun Ou"), one("Mei-jun Ou")]));
    it("a name stitched from two authors", () => refused([one("Hong Xu")]));
    it("a name with a word the page does not print after it", () => refused([one("Mei-jun Ou <b>")]));
    it("too many authors", () => refused(Array.from({ length: 101 }, () => one("Hong Chen"))));
    it("a bad name even when an affiliation also failed first", () =>
      refused([one("Mei-jun Ou", ["Evil Corp, visit example dot com"]), one("Ignore Previous Instructions")]));
    it("a skipped author even when an affiliation also failed first", () =>
      refused([one("Mei-jun Ou", ["Evil Corp, visit example dot com"]), one("Hong Chen")]));
    it("a trailing omitted author when an affiliation also failed", () =>
      refused([one("Mei-jun Ou", ["Evil Corp, visit example dot com"])]));
  });

  describe("keeps the names, and no list, when every name is on the page and an affiliation is not", () => {
    /* Until 2026-09-30 an affiliation that did not verify threw the names away
       with it, and the byline fell back to the record as printed — on Webb et
       al. (production, feedback SPIDERYARN-READING2-69) `Taylor Webb1,*, Keith
       J. Holyoak1 , and Hongjing Lu1,2`, markers and all, though all three names
       had verified. No list is stored, because an author with no affiliations
       reads as "none printed". docs/plans/260930e-pdf-transcription-glitches.md. */
    const namesOnly = (answer: Parameters<typeof verifyAuthors>[0], names: string[], pages = [FRONTIERS_BYLINE + FRONTIERS_AFFILIATIONS]) => {
      const verdict = verifyAuthors(answer, FRONTIERS_BYLINE, pages);
      expect(verdict.authors).toBeNull();
      expect("names" in verdict && verdict.names).toEqual(names);
      expect("note" in verdict && verdict.note).toMatch(/Kept the names without their affiliations/);
    };
    const allNames = ["Mei-jun Ou", "Xiang-hua Xu", "Hong Chen", "Fu-rong Chen", "Shuai Shen"];
    const everyName = (firstAffiliation: string) => [
      one("Mei-jun Ou", [firstAffiliation]),
      ...allNames.slice(1).map((name) => one(name)),
    ];

    it("an affiliation not on the page", () =>
      namesOnly(everyName("Evil Corp, visit example dot com"), allNames));
    it("an affiliation that skips a word", () =>
      namesOnly(everyName("Head and Surgery Department"), allNames));
    it("an affiliation stitched across two pages", () =>
      namesOnly(everyName("China 2 Health Service Center"), allNames, [
        "Hunan Cancer Hospital, Changsha, China",
        "2 Health Service Center",
      ]));

    it("Webb et al.: two lines of the affiliation block run together, and three good names", () => {
      const byline = "Taylor Webb1,*, Keith J. Holyoak1\n, and Hongjing Lu1,2";
      const block =
        "1Department of Psychology\n2Department of Statistics\nUniversity of California, Los Angeles, CA, USA\n*Correspondence to: taylor.w.webb@gmail.com";
      const ucla = "Department of Psychology, University of California, Los Angeles, CA, USA";
      const verdict = verifyAuthors(
        [one("Taylor Webb", [ucla]), one("Keith J. Holyoak", [ucla]), one("Hongjing Lu", [ucla])],
        byline,
        [`Emergent Analogical Reasoning in Large Language Models\n${byline}\n${block}`],
      );
      expect(verdict).toEqual({
        authors: null,
        names: ["Taylor Webb", "Keith J. Holyoak", "Hongjing Lu"],
        note: "Kept the names without their affiliations: the front-matter pass's author list gave author 1 an affiliation not printed on the page.",
      });
    });
  });

  it("cuts off the digit and symbol markers a model copies along — which is what it does, measured", () => {
    const verdict = verifyAuthors(
      [
        one("Mei-jun Ou1", ["1 Head and Neck Surgery Department, Hunan Cancer Hospital, Changsha, China"]),
        one("Xiang-hua Xu2"),
        one("Hong Chen1"),
        one("Fu-rong Chen3"),
        one("Shuai Shen4*"),
      ],
      FRONTIERS_BYLINE,
      [FRONTIERS_AFFILIATIONS],
    );
    expect(verdict.authors?.map((a) => a.name)).toEqual(["Mei-jun Ou", "Xiang-hua Xu", "Hong Chen", "Fu-rong Chen", "Shuai Shen"]);
    expect(verdict.authors?.[0]?.affiliations).toEqual(["Head and Neck Surgery Department, Hunan Cancer Hospital, Changsha, China"]);
    const keul = verifyAuthors([one("Alexander G. Keul¹,☆", ["¹Environmental Psychology, Salzburg University"])], COPERNICUS_BYLINE, [
      COPERNICUS_AFFILIATION,
    ]);
    expect(keul.authors).toEqual([{ name: "Alexander G. Keul", affiliations: ["Environmental Psychology, Salzburg University"] }]);
  });

  it("never cuts a LETTER off a name by rule — Costa keeps its a unless the model dropped it", () => {
    expect(trimName("Ana Costa")).toBe("Ana Costa");
    expect(verifyAuthors([one("Salim Rukhsara")], "Salim Rukhsara,∗", ["Salim Rukhsara,∗"]).authors?.[0]?.name).toBe("Salim Rukhsara");
  });

  it("maps folded offsets through astral letters without extending the stored name", () => {
    expect(verifyAuthors([one("𐐀"), one("Alice Doe")], "𐐀 Alice Doe", ["𐐀 Alice Doe"]).authors).toEqual([
      { name: "𐐀", affiliations: [] },
      { name: "Alice Doe", affiliations: [] },
    ]);
  });

  it("maps decomposed marks and compatibility ligatures back to the page's characters", () => {
    expect(verifyAuthors([one("José Ofﬁce")], "Jose\u0301 Ofﬁce", ["Jose\u0301 Ofﬁce"]).authors).toEqual([
      { name: "Jose\u0301 Ofﬁce", affiliations: [] },
    ]);
  });

  it("stores the page's characters, so decoration the model added between the words is gone", () => {
    const verdict = verifyAuthors(
      [one("Mei-jun\n--- Ou", ["Head   and\nNeck ** Surgery Department"])],
      "Mei-jun Ou1,",
      [FRONTIERS_AFFILIATIONS],
    );
    expect(verdict.authors).toEqual([{ name: "Mei-jun Ou", affiliations: ["Head and Neck Surgery Department"] }]);
  });

  it("refuses a found span that is not shaped like a name — digits the page printed inside it", () => {
    expect(verifyAuthors([one("Jane Doe")], "Jane 42 Doe", ["Jane 42 Doe"]).authors).toBeNull();
    /* …and the control: the same call without the digits passes. */
    expect(verifyAuthors([one("Jane Doe")], "Jane Doe", ["Jane Doe"]).authors).toEqual([{ name: "Jane Doe", affiliations: [] }]);
  });

  it("refuses an affiliation over the character cap even when it is on the page", () => {
    const long = Array.from({ length: 40 }, () => "Laboratory").join(" ");
    expect(verifyAuthors([one("Hong Chen", [long])], "Hong Chen", [long]).authors).toBeNull();
    const short = Array.from({ length: 20 }, () => "Laboratory").join(" ");
    expect(verifyAuthors([one("Hong Chen", [short])], "Hong Chen", [short]).authors).not.toBeNull();
  });

  it("lets a marker be glued only after a name's words and only before an affiliation's first", () => {
    /* A marker in the MIDDLE of an affiliation is not a marker. */
    const verdict = verifyAuthors([one("Hong Chen", ["Hunan Cancer Hospital"])], "Hong Chen1", ["Hunan 1Cancer Hospital"]);
    expect(verdict.authors).toBeNull();
    /* …and the control: the same affiliation printed plainly is found. */
    expect(verifyAuthors([one("Hong Chen", ["Hunan Cancer Hospital"])], "Hong Chen1", ["Hunan Cancer Hospital"]).authors).not.toBeNull();
  });

  it("drops a repeated affiliation and squashes whitespace", () => {
    const verdict = verifyAuthors(
      [one("  Hong   Chen ", ["Hunan Cancer Hospital", "Hunan  Cancer Hospital"])],
      "Hong Chen1",
      [FRONTIERS_AFFILIATIONS],
    );
    expect(verdict.authors).toEqual([{ name: "Hong Chen", affiliations: ["Hunan Cancer Hospital"] }]);
  });
});

describe("the authors pass (a call of its own, plan 260929d)", () => {
  const record = (text: string, over: Partial<PdfRecord> = {}): PdfRecord => ({
    page: 1,
    type: "paragraph",
    text,
    continues: false,
    uncertain: false,
    ...over,
  });
  const records = [
    record("A paper", { type: "heading1" }),
    record("Mei-jun Ou1, Xiang-hua Xu2*"),
    record("1 Hunan Cancer Hospital, Changsha, China, 2 Health Service Center"),
  ];
  const items = frontMatterWindow(records);
  const stub = (answer: unknown, seen: string[] = []): AuthorsReader => ({
    id: "test/stub",
    usage: () => ({ input: 0, output: 0 }),
    async ask(prompt) {
      seen.push(prompt);
      return parseAuthors(JSON.stringify(answer));
    },
  });

  it("tells the model which records are the byline, and shows it the page as inert JSON lines", () => {
    const prompt = authorsPrompt(items, ["p1-r2"]);
    expect(prompt.split("\n")[0]).toBe('BYLINE RECORDS: ["p1-r2"]');
    expect(prompt).toContain(JSON.stringify({ id: "p1-r2", page: 1, type: "paragraph", text: "Mei-jun Ou1, Xiang-hua Xu2*" }));
  });

  it("returns the page's names and affiliations, markers off", async () => {
    const verdict = await readAuthors(
      items,
      ["p1-r2"],
      stub({
        authors: [
          { name: "Mei-jun Ou1", affiliations: ["1 Hunan Cancer Hospital, Changsha, China"] },
          { name: "Xiang-hua Xu2*", affiliations: ["Health Service Center"] },
        ],
      }),
    );
    expect(verdict.authors).toEqual([
      { name: "Mei-jun Ou", affiliations: ["Hunan Cancer Hospital, Changsha, China"] },
      { name: "Xiang-hua Xu", affiliations: ["Health Service Center"] },
    ]);
  });

  it("does not ask at all when there is no byline", async () => {
    const seen: string[] = [];
    expect(await readAuthors(items, [], stub({ authors: [] }, seen))).toEqual({ authors: null, note: null });
    expect(seen).toEqual([]);
  });

  it("cannot take a name from a record that is not the byline", async () => {
    const verdict = await readAuthors(items, ["p1-r2"], stub({ authors: [{ name: "Health Service Center", affiliations: [] }] }));
    expect(verdict.authors).toBeNull();
  });

  it("refuses an answer that is not the schema's shape", () => {
    for (const bad of ["not json", "{}", '{"authors":{}}', '{"authors":["A B"]}', '{"authors":[{"name":"A"}]}']) {
      expect(() => parseAuthors(bad)).toThrow(AuthorsUnreadable);
    }
  });
});
