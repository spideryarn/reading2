/**
 * **The command bar's argument verbs, checked without rendering anything** —
 * `parseArgumentQuery`, Stage 1 of
 * docs/plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md.
 *
 * Greg, 2026-09-29 (spya-wh2xys): *"the command panel can take a sort of an
 * argument like a search term or whatever"*, and *"jump to the first place
 * where X"*.
 *
 * What a happy path would not see:
 *
 *  - **A bare verb is not a request.** `jump to first`, typed and not yet
 *    finished, offers no row about nothing.
 *  - **Each verb belongs to one command**, so `find X`, `jump to first X` and
 *    `look up X` never produce each other's rows.
 *  - **Nothing the bar already names becomes an argument row** (GPT Sol's F7):
 *    `take me to glossary` is how a reader names a mode, not a search for
 *    *glossary*. The collision matrix at the foot runs every parser over every
 *    label and alias the bar offers, and over the ways a reader asks to go
 *    somewhere.
 */
import { describe, expect, it } from "vitest";
import { MODES } from "../src/modes.js";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODE_LABEL } from "../src/title-text.js";
import { METADATA_RERUN_STEPS } from "../src/rerun-steps.js";
import {
  type ArgumentQuery,
  type Command,
  commandText,
  modeCommand,
  parseArgumentQuery,
  parseFindQuery,
  subModeCommand,
} from "../src/web/command-match.js";
import { rerunCommand } from "../src/web/rerun-commands.js";
import { SECTION_ROWS, archiveCommand, exportCommand, sectionCommand } from "../src/web/article-commands.js";
import { subModesOf } from "../src/web/sub-modes.js";
import { besideTheModes, experimentalCommand } from "../src/web/CommandBar.js";
import { FIND_MORE_MODES } from "../src/web/find-more.js";

const close = () => ({ kind: "close" }) as const;
const one = (query: string): readonly ArgumentQuery[] => parseArgumentQuery(query);

describe("jump to the first place it says X", () => {
  it("reads the words after each of the explicit verbs", () => {
    for (const [query, words] of [
      ["jump to first free energy", "free energy"],
      ["first occurrence of Friston", "Friston"],
      ["first mention of dopamine", "dopamine"],
      ["where does it first say wet hardware", "wet hardware"],
      ["where does it first mention priors?", "priors"],
      ['Jump To First "wet hardware"', "wet hardware"],
    ] as const) {
      expect(one(query), query).toEqual([{ kind: "jump-first", words }]);
    }
  });

  it("is not `take me to` or a bare `jump to`, which name a mode or a page", () => {
    expect(one("jump to glossary")).toEqual([]);
    expect(one("take me to glossary")).toEqual([]);
    expect(one("jump to first")).toEqual([]);
    expect(one("first mention of")).toEqual([]);
    /* With the article, it is how a reader names a place: the verbs are the
       plan's, explicit only (GPT Sol's F7). */
    expect(one("jump to the first section")).toEqual([]);
  });
});

describe("look X up in the glossary", () => {
  it("reads the term after each verb, and out of `what does … mean`", () => {
    for (const [query, words] of [
      ["look up entropy", "entropy"],
      ["define free energy", "free energy"],
      ["what does entropy mean", "entropy"],
      ["what does “active inference” mean?", "active inference"],
      ["what is meant by priors", "priors"],
      ["look up entropy in the glossary", "entropy"],
    ] as const) {
      expect(one(query), query).toEqual([{ kind: "glossary", words }]);
    }
  });

  it("needs the `mean` to make `what does` a lookup", () => {
    expect(one("what does it say about priors")).toEqual([]);
    expect(one("what does mean")).toEqual([]);
  });

  it("offers nothing for a bare verb", () => {
    expect(one("look up")).toEqual([]);
    expect(one("define")).toEqual([]);
  });
});

describe("tags", () => {
  it("reads the tag after every way of asking to add one", () => {
    for (const [query, words] of [
      ["tag reading group", "reading group"],
      ["add tag neuroscience", "neuroscience"],
      ["add the tag neuroscience", "neuroscience"],
      ["add a tag of to read", "to read"],
      ["add a tag of to read to this paper", "to read"],
      ["add a tag of priors to this article", "priors"],
      ["tag this neuroscience", "neuroscience"],
      ["tag this as neuroscience", "neuroscience"],
      ["tag as neuroscience", "neuroscience"],
      ['tag "Free Energy"', "Free Energy"],
    ] as const) {
      expect(one(query), query).toEqual([{ kind: "tag-add", words }]);
    }
  });

  it("reads the tag after every way of asking to remove one", () => {
    for (const [query, words] of [
      ["untag neuroscience", "neuroscience"],
      ["remove tag neuroscience", "neuroscience"],
      ["remove the tag to read", "to read"],
      ["remove the tag to read from this paper", "to read"],
    ] as const) {
      expect(one(query), query).toEqual([{ kind: "tag-remove", words }]);
    }
  });

  it("offers nothing for a verb glued to a word or with nothing after it", () => {
    expect(one("tags")).toEqual([]);
    expect(one("tag")).toEqual([]);
    expect(one("tag this")).toEqual([]);
    expect(one("untag")).toEqual([]);
    expect(one("tagging")).toEqual([]);
  });
});

describe("one verb, one command", () => {
  it("keeps find, jump and glossary apart", () => {
    expect(one("find entropy")).toEqual([{ kind: "find", words: "entropy" }]);
    expect(one("jump to first entropy")).toEqual([{ kind: "jump-first", words: "entropy" }]);
    expect(one("look up entropy")).toEqual([{ kind: "glossary", words: "entropy" }]);
    /* The verb is the first words; what follows is the argument, whatever it
       says. */
    expect(one("find first mention of entropy")).toEqual([
      { kind: "find", words: "first mention of entropy" },
    ]);
  });

  /* Found by the command-pick eval (261003e): the bar answered *find mentions
     of dopamine* itself, and looked for `mentions of dopamine`. Every model
     gave `dopamine`. */
  it("looks for the thing, not for the words `mentions of` in front of it", () => {
    for (const [query, words] of [
      ["find mentions of dopamine", "dopamine"],
      ["find all mentions of dopamine", "dopamine"],
      ["find every mention of free energy", "free energy"],
      ["find references to Friston", "Friston"],
      ["Find Mentions Of “wet hardware”?", "wet hardware"],
    ] as const) {
      expect(one(query), query).toEqual([{ kind: "find", words }]);
    }
    /* A bare one is half a request, like every other verb. */
    expect(one("find mentions of")).toEqual([]);
    /* And `find` alone still takes whatever follows it. */
    expect(one("find mentions")).toEqual([{ kind: "find", words: "mentions" }]);
  });

  it("keeps `parseFindQuery` as the find entry of the table", () => {
    expect(parseFindQuery("search for priors")).toBe("priors");
    expect(parseFindQuery("look up priors")).toBeNull();
    expect(parseFindQuery("jump to first priors")).toBeNull();
  });
});

/* -------------------------------------------------- the collision matrix -- */

/** Every row the bar can draw, as the bar builds them (`besideTheModes`). */
function everyRow(): readonly Command[] {
  const article = {
    slug: "a-piece",
    search: "at=spya-k3m9qt",
    view: "article" as const,
    help: "/help",
    shelfRow: {
      archive: { at: null, lost: false, busy: false, error: null, set: async () => ({ kind: "done" }) as const },
      tags: { edit: async () => [] },
    },
    /* Both bands offering an append, so the two *Find more* rows are in the
       list by the path production takes (GPT Sol's F5 on plan 261004k: a
       synthetic list that left them out would keep the matrix green falsely). */
    executor: { runners: {}, sources: {}, findMore: { glossary: close, quotes: close } },
  };
  return [
    ...MODES.map(modeCommand),
    ...MODES.flatMap((mode) => subModesOf(mode).map(subModeCommand)),
    ...besideTheModes({
      article,
      openComments: () => {},
      openFeedback: () => {},
      queue: { run: async () => null, lastFailure: () => null },
    }),
    ...METADATA_RERUN_STEPS.map((step) => rerunCommand(step, close)),
    ...SECTION_ROWS.map((row) => sectionCommand(row, close)),
    archiveCommand(true, close),
    archiveCommand(false, close),
    exportCommand(close),
    experimentalCommand(true, close),
    experimentalCommand(false, close),
  ];
}

/**
 * **The two rows whose words the `find` verb also takes**, by id — the one
 * declared exception to the matrix (plan 261004k, GPT Sol's F5). `find more
 * terms` is *Glossary › Find more*'s own phrase and also a search for *more
 * terms*; the verb is not narrowed, and the bar draws the row first and the
 * *Find “more terms” in this article* row after it
 * (tests/find-more-commands.test.tsx § the rows, in the bar).
 */
const ALSO_A_FIND: ReadonlySet<string> = new Set(FIND_MORE_MODES.map((mode) => `find-more-${mode}`));

describe("the collision matrix (GPT Sol's F7)", () => {
  const declared = (command: Command) => command.kind === "action" && ALSO_A_FIND.has(command.id);
  const namesOf = (commands: readonly Command[]) => [
    ...new Set(
      commands.flatMap((command) => {
        const text = commandText(command);
        return [text.label, ...text.aliases];
      }),
    ),
  ];
  const names = namesOf(everyRow().filter((command) => !declared(command)));
  const findMoreNames = namesOf(everyRow().filter(declared));

  it("holds both Find more rows, so the exception below is about rows the bar draws", () => {
    const ids = everyRow().flatMap((command) => (command.kind === "action" ? [command.id] : []));
    for (const id of ALSO_A_FIND) expect(ids).toContain(id);
    expect(findMoreNames).toContain("find more");
    expect(findMoreNames).toContain("find more terms");
    expect(findMoreNames).toContain("define find more");
  });

  it("lets a Find more row's `find more …` be a find as well, and none of its other words anything", () => {
    for (const name of findMoreNames) {
      const want = name.startsWith("find more") ? [{ kind: "find", words: name.slice("find ".length) }] : [];
      expect(parseArgumentQuery(name), name).toEqual(want);
    }
  });

  it("has every mode's label and nickname in it, so the matrix is not empty", () => {
    for (const mode of MODES) {
      expect(names).toContain(MODE_LABEL[mode]);
      for (const alias of MODE_CATALOG[mode].aliases) expect(names).toContain(alias);
    }
    expect(names).toContain("Archive this article");
    expect(names).toContain("Turn experimental features on");
    expect(names.length).toBeGreaterThan(150);
  });

  it("produces no argument row for any label or alias the bar offers", () => {
    for (const name of names) expect(parseArgumentQuery(name), name).toEqual([]);
  });

  it("produces none for the ways a reader asks to go somewhere", () => {
    const destinations = [
      "glossary",
      "profile",
      "search",
      "library",
      "metadata",
      "help",
      "the glossary",
      "the first section",
      "the top",
    ];
    for (const destination of destinations) {
      for (const verb of ["take me to", "go to", "jump to", "open", "show me", "show", "switch to"]) {
        const query = `${verb} ${destination}`;
        expect(parseArgumentQuery(query), query).toEqual([]);
      }
    }
  });
});
