/**
 * **The command bar's new words, checked without rendering anything** — the
 * *Run again* rows and `find <words>`, stage A of
 * docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md.
 *
 * Greg, 2026-10-01 (SPIDERYARN-READING2-8D): *"Add a lot more Metadata
 * functionality to Commands, e.g. to reprocess (a particular mode)"*, and
 * *"'do they talk about X?' would add a search"*.
 *
 * Three things here are about ranking rather than about React, so they are
 * stated on the pure half (command-match.ts, rerun-commands.ts) and the bar
 * itself is in tests/command-bar-rerun-and-find.test.tsx:
 *
 *  - **`rerun glossary` finds the row.** GPT Sol's F3: the matcher compares the
 *    whole query with one alias at a time, so a generic `rerun` alias beside a
 *    label did not combine into it, and the plan's own example matched nothing.
 *  - **`glossary` still puts the Glossary mode first.** The re-run row ties it
 *    on the label and loses on the order the bar hands the list in.
 *  - **A `typedOnly` row is absent from the empty list**, so fourteen re-run
 *    rows do not join what the bar shows on opening.
 */
import { describe, expect, it } from "vitest";
import { METADATA_RERUN_STEPS } from "../src/rerun-steps.js";
import {
  type Command,
  commandText,
  modeCommand,
  parseFindQuery,
  rankCommands,
} from "../src/web/command-match.js";
import { RERUN_LABEL, rerunCommand, rerunWords } from "../src/web/rerun-commands.js";
import { MODES } from "../src/modes.js";

const close = () => ({ kind: "close" }) as const;

/** The list as the bar builds it: the modes first, then the re-run rows. */
const LIST: readonly Command[] = [
  ...MODES.map(modeCommand),
  ...METADATA_RERUN_STEPS.map((step) => rerunCommand(step, close)),
];

const labels = (commands: readonly Command[]): string[] => commands.map((c) => commandText(c).label);

describe("the Run again rows", () => {
  it("are found by a verb and the step's name, for every phrasing the plan names", () => {
    for (const query of [
      "rerun glossary",
      "re-run glossary",
      "regenerate glossary",
      "redo glossary",
      "refresh glossary",
      "glossary again",
      "run glossary again",
      "Rerun  Glossary",
    ]) {
      expect(labels(rankCommands(query, LIST))[0], query).toBe("Glossary › Run again");
    }
  });

  it("are found by the mode's name and its nicknames, not only by the label", () => {
    /* `terms` is one of Glossary's own nicknames (mode-catalog.ts). */
    expect(labels(rankCommands("regenerate terms", LIST))[0]).toBe("Glossary › Run again");
    expect(labels(rankCommands("rerun cross references", LIST))[0]).toBe(
      "Cross-references › Run again",
    );
  });

  /* **Summary shows two artefacts, and each re-run answers only to its own
     words** — GPT Sol's F5 on plan 261003l. The thread's row borrowed the
     Tweets mode's name and aliases through `RERUN_MODE` until the mode went on
     2026-10-03; pointing that at Summary instead would have made `rerun
     summary` force a thread. */
  it("keeps `rerun tweets` on the thread now that Tweets is not a mode", () => {
    for (const query of ["rerun tweets", "regenerate thread", "redo tweet thread", "twitter again"]) {
      const ranked = rankCommands(query, LIST);
      expect(labels(ranked)[0], query).toBe("Thread › Run again");
      expect(ranked[0], query).toMatchObject({ kind: "action", id: "rerun-tweets" });
    }
  });

  it("keeps the retired Social nickname on the thread's re-run row (F5)", () => {
    for (const query of ["rerun social", "regenerate social", "social again"]) {
      const ranked = rankCommands(query, LIST);
      expect(ranked[0], query).toMatchObject({ kind: "action", id: "rerun-tweets" });
      expect(ranked, query).not.toContainEqual(expect.objectContaining({ id: "rerun-simple" }));
    }
  });

  it("`rerun summary` writes the plain-words lengths again, and never a thread", () => {
    for (const query of ["rerun summary", "regenerate summary", "summary again", "rerun summarise"]) {
      const ranked = rankCommands(query, LIST);
      expect(ranked[0], query).toMatchObject({ kind: "action", id: "rerun-simple" });
      expect(
        ranked.map((c) => (c.kind === "action" ? c.id : "")),
        query,
      ).not.toContain("rerun-tweets");
    }
  });

  /* **Sources shows three artefacts, and each re-run answers only to its
     own words** — GPT Sol's F8 on plan 261009l, the same shape as Summary's
     above. Citations' and Debate's rows borrowed their modes' names until
     those modes became Sources' sub-modes on 2026-10-09; borrowing Sources'
     name (or Peer review, its old one) for both would make `rerun sources`
     pick one paid run at random. */
  it("labels Citations' and Debate's re-runs by their sub-modes, and keeps the old words", () => {
    expect(rerunWords("bibliography").label).toBe("Bibliography › Run again");
    expect(rerunWords("debate").label).toBe("Reception › Run again");
    for (const query of ["rerun bibliography", "rerun citations", "regenerate references", "citations again"]) {
      const ranked = rankCommands(query, LIST);
      expect(ranked[0], query).toMatchObject({ kind: "action", id: "rerun-bibliography" });
      expect(ranked, query).not.toContainEqual(expect.objectContaining({ id: "rerun-debate" }));
    }
    for (const query of ["rerun reception", "rerun debate", "redo critiques", "debate again"]) {
      const ranked = rankCommands(query, LIST);
      expect(ranked[0], query).toMatchObject({ kind: "action", id: "rerun-debate" });
      expect(ranked, query).not.toContainEqual(expect.objectContaining({ id: "rerun-bibliography" }));
    }
  });

  it("`rerun sources` and `rerun peer review` pick neither of its paid runs", () => {
    for (const query of ["rerun sources", "rerun peer review", "regenerate peer review", "peer review again"]) {
      const ids = rankCommands(query, LIST).map((c) => (c.kind === "action" ? c.id : ""));
      expect(ids, query).not.toContain("rerun-bibliography");
      expect(ids, query).not.toContain("rerun-debate");
    }
  });

  it("leaves the plain name to the mode, which comes first", () => {
    const ranked = labels(rankCommands("glossary", LIST));
    expect(ranked[0]).toBe("Glossary");
    /* And the re-run row is still there, second — the bar is how a reader
       learns it exists. */
    expect(ranked).toContain("Glossary › Run again");
  });

  it("has one row per step, each labelled with the name Metadata's row uses", () => {
    for (const step of METADATA_RERUN_STEPS) {
      expect(rerunWords(step).label).toBe(`${RERUN_LABEL[step]} › Run again`);
    }
  });

  it("says each one may spend, and is offered only once something is typed", () => {
    for (const step of METADATA_RERUN_STEPS) {
      const row = rerunCommand(step, close);
      expect(row.kind).toBe("action");
      if (row.kind !== "action") continue;
      expect(row.generates, step).toBe(true);
      expect(row.typedOnly, step).toBe(true);
    }
  });
});

describe("`typedOnly`", () => {
  it("keeps a row out of the empty list, and lets a query find it", () => {
    expect(labels(rankCommands("", LIST))).not.toContain("Glossary › Run again");
    expect(rankCommands("", LIST)).toHaveLength(MODES.length);
    expect(labels(rankCommands("   ", LIST))).not.toContain("Glossary › Run again");
    expect(labels(rankCommands("run again", LIST))).toContain("Glossary › Run again");
  });
});

describe("parseFindQuery", () => {
  it("reads the words after each verb", () => {
    expect(parseFindQuery("find predictive coding")).toBe("predictive coding");
    expect(parseFindQuery("search wet hardware")).toBe("wet hardware");
    expect(parseFindQuery("search for wet hardware")).toBe("wet hardware");
    expect(parseFindQuery("does it mention dopamine")).toBe("dopamine");
    expect(parseFindQuery("do they talk about free energy")).toBe("free energy");
  });

  it("ignores the case of the verb and keeps the words as typed", () => {
    expect(parseFindQuery("Do They Talk About Friston?")).toBe("Friston");
    expect(parseFindQuery("FIND Bayes")).toBe("Bayes");
  });

  it("drops a trailing question mark and the quotes round the words", () => {
    expect(parseFindQuery("does it mention dopamine?")).toBe("dopamine");
    expect(parseFindQuery('find "wet hardware"')).toBe("wet hardware");
    expect(parseFindQuery("find “wet hardware”?")).toBe("wet hardware");
    expect(parseFindQuery("find 'priors'")).toBe("priors");
    expect(parseFindQuery("  find   wet   hardware  ")).toBe("wet hardware");
  });

  it("takes the longer verb when one is the start of another", () => {
    /* `search for X` is a search for X, not for `for X`. */
    expect(parseFindQuery("search for priors")).toBe("priors");
  });

  it("answers nothing when there is no verb or nothing after it", () => {
    expect(parseFindQuery("find")).toBeNull();
    expect(parseFindQuery("find ")).toBeNull();
    expect(parseFindQuery("search for")).toBeNull();
    expect(parseFindQuery('find ""')).toBeNull();
    expect(parseFindQuery("find ?")).toBeNull();
    expect(parseFindQuery("glossary")).toBeNull();
    expect(parseFindQuery("")).toBeNull();
    /* A verb glued to the next word is not the verb. */
    expect(parseFindQuery("findings")).toBeNull();
    expect(parseFindQuery("searching")).toBeNull();
  });
});
