// @vitest-environment jsdom
/**
 * **Every word a mode answers to, typed into the bar as production ranks it** —
 * Stage 1 of
 * docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md.
 *
 * Greg, 2026-10-04 (spya-uzkmn3):
 *
 * > In the command bar, add more aliases. So, for example, structure mode could
 * > have aliases for hierarchy, table of contents, TOC, headings, etc.
 *
 * tests/mode-catalog.test.ts checks the table against itself: unique, canonical,
 * never another mode's label. None of that can see the failure a longer list
 * invites, which is a word that is fine in the table and **ranks the wrong row
 * first** — `questions and answers` on FAQ would have put FAQ above Chat for
 * somebody typing Chat's own `question`, because both are a nickname prefix and
 * FAQ comes earlier in the Dock. So this file is generated from the table and
 * run over the whole list the bar holds, not the modes alone (GPT Sol's F7 on
 * the plan): modes in Dock order, sub-modes, the article's rows, the *Run
 * again* rows, the pages and the actions.
 *
 * Five statements:
 *
 *  1. Greg's four words open Structure.
 *  2. **Every nickname, typed in full, puts its own mode first.** Two are
 *     declared exceptions and both open the same place (`ALSO_A_CHIP`).
 *  3. **Every start of a mode's name that names one mode puts it first**, and
 *     the starts that name several come back in Dock order (`SHARED_STARTS`).
 *  4. **No mode takes a word that is another row's own.** Typing a page's or an
 *     action's label or nickname must not put a mode first on the strength of
 *     a nickname; the cases that do are written down (`A_MODE_COMES_FIRST`).
 *  5. **Every *Run again* phrase still names its own step.** Eight modes lend
 *     their nicknames to that row (rerun-commands.ts § `rerunNames`), seven
 *     phrases a nickname, and every one of those rows spends.
 *  6. **Every *Find more* phrase names its own band's row** (Stage 2 of the
 *     same plan; find-more.ts), and takes neither a mode's name nor a *Run
 *     again* phrase from the row that had it.
 */
import { describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES, type Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import { appearanceRows } from "../src/web/appearance-commands.js";
import { besideTheModes, experimentalRows, subModeRows } from "../src/web/CommandBar.js";
import {
  type Command,
  canonical,
  commandId,
  commandText,
  modeCommand,
  rankCommands,
} from "../src/web/command-match.js";
import { visibleModes } from "../src/web/Dock.js";
import { FIND_MORE_MODES, findMoreWords } from "../src/web/find-more.js";
import { METADATA_RERUN_STEPS, rerunWords } from "../src/web/rerun-commands.js";

/**
 * The `commands` memo in CommandBar.tsx with stub closures, for an owner on
 * the reading view with the experimental switch on — the longest list the bar
 * holds. `archived` chooses which face of the Archive row is in it, so both
 * rows' words are ranked against.
 */
function rows(archived: boolean): readonly Command[] {
  const modes = visibleModes(true, undefined).map((m) => m.mode);
  return [
    ...modes.map(modeCommand),
    ...subModeRows(modes, true, { diagram: "sketch", learn: "recall" }),
    ...besideTheModes({
      article: {
        slug: "a-piece",
        search: "at=spya-k3m9qt",
        view: "article",
        help: "/help/mode-glossary",
        shelfRow: {
          archive: {
            at: archived ? "2026-10-01T00:00:00.000Z" : null,
            lost: false,
            busy: false,
            error: null,
            set: async () => ({ kind: "done" }) as const,
          },
          tags: { edit: async () => [] },
        },
        /* Both lists able to be added to, so both *Find more* rows are ranked
           against (plan 261004k, Stage 2). */
        executor: {
          runners: {},
          sources: {},
          findMore: { glossary: () => ({ kind: "close" }), quotes: () => ({ kind: "close" }) },
        },
      },
      openComments: () => {},
      openFeedback: () => {},
      queue: { run: async () => null, lastFailure: () => null },
    }),
    ...experimentalRows({
      on: true,
      loaded: true,
      signedIn: true,
      saving: false,
      set: async () => ({ kind: "saved" }) as const,
    }),
    ...appearanceRows("dark", () => true),
  ];
}

const LISTS: readonly (readonly Command[])[] = [rows(false), rows(true)];

/** The id of the row a query puts first, in each list — one answer or the test says which differ. */
function first(query: string): readonly string[] {
  return [...new Set(LISTS.map((list) => { const top = rankCommands(query, list)[0]; return top ? commandId(top) : "nothing"; }))];
}

describe("the list these are ranked against", () => {
  it("is the whole bar: every mode, sub-modes, pages, actions and the Run again rows", () => {
    const [list] = LISTS;
    const ids = (list ?? []).map(commandId);
    for (const mode of MODES) expect(ids).toContain(`mode:${mode}`);
    expect(ids).toContain("submode:learn:quiz");
    expect(ids).toContain("action:feedback");
    expect(ids).toContain("action:comments");
    expect(ids).toContain("action:rerun-glossary");
    expect(ids).toContain("action:find-more-glossary");
    expect(ids).toContain("action:find-more-quotes");
    expect(ids).toContain("action:archive");
    expect(ids.some((id) => id.startsWith("page:/help"))).toBe(true);
    expect(ids.length).toBeGreaterThan(60);
  });
});

describe("Greg's four words (spya-uzkmn3)", () => {
  it.each(["hierarchy", "table of contents", "toc", "TOC", "headings"])("`%s` opens Structure", (word) => {
    expect(first(word)).toEqual(["mode:structure"]);
  });
});

/**
 * **A nickname that is also one of its own mode's chips**, where the chip's
 * row comes first on its label and opens the mode with that chip pressed —
 * the same place the mode opens on, or the picture the word names.
 * mode-catalog.ts § `learn` and § `diagram` say why each word is there.
 */
const ALSO_A_CHIP: Readonly<Record<string, string>> = {
  recall: "submode:learn:recall",
  sketch: "submode:diagram:sketch",
  /* `reception` was Debate's nickname and its default chip until 2026-10-09;
     it is Sources' Reception chip's own label now, not a nickname. */
};

describe("every nickname, typed in full", () => {
  const claims = MODES.flatMap((mode) => MODE_CATALOG[mode].aliases.map((alias) => ({ mode, alias })));

  it("puts its own mode first", () => {
    const wrong = claims
      .map(({ mode, alias }) => ({ alias, want: ALSO_A_CHIP[alias] ?? `mode:${mode}`, got: first(alias) }))
      .filter(({ want, got }) => got.length !== 1 || got[0] !== want)
      .map(({ alias, want, got }) => `${alias}: wanted ${want}, got ${got.join(" / ")}`);
    expect(wrong).toEqual([]);
  });

  it("has a chip of its own mode behind each declared exception, and no others", () => {
    for (const [alias, id] of Object.entries(ALSO_A_CHIP)) {
      const owner = claims.find((c) => c.alias === alias);
      expect(owner, alias).toBeDefined();
      expect(id.startsWith(`submode:${owner?.mode}:`), alias).toBe(true);
    }
  });
});

/**
 * **The starts of a mode's name that more than one mode shares**, and the
 * order they come back in — the Dock's. Written out so that a new mode, or a
 * reordered bar, changes this table in a diff somebody reads.
 */
const SHARED_STARTS: Readonly<Record<string, readonly Mode[]>> = {
  /* Sources joined `s` on 2026-10-09, when Peer review (which shared Plain's
     `p` for that day) was renamed; `d` and `c`, which Debate and Citations
     shared with Diagram and Chat, name one mode each now. */
  s: ["structure", "summary", "skim", "sources", "search"],
  /* `r` and `re` were shared by Referee and Remember until 2026-10-05, when
     Remember became Learn: each now names Referee alone, and the test below
     that asks for "the one mode it names first" covers them. */
};

describe("every start of a mode's name", () => {
  const starts = new Map<string, Mode[]>();
  for (const mode of MODES) {
    const label = canonical(MODE_LABEL[mode]);
    for (let n = 1; n <= label.length; n++) {
      const start = label.slice(0, n);
      starts.set(start, [...(starts.get(start) ?? []), mode]);
    }
  }

  it("puts the one mode it names first", () => {
    const wrong = [...starts]
      .filter(([, modes]) => modes.length === 1)
      .map(([start, modes]) => ({ start, want: `mode:${modes[0]}`, got: first(start) }))
      .filter(({ want, got }) => got.length !== 1 || got[0] !== want)
      .map(({ start, want, got }) => `${start}: wanted ${want}, got ${got.join(" / ")}`);
    expect(wrong).toEqual([]);
  });

  it("gives the modes that share one in Dock order, ahead of every other row", () => {
    const shared = [...starts].filter(([, modes]) => modes.length > 1).map(([start]) => start);
    expect(shared.sort()).toEqual(Object.keys(SHARED_STARTS).sort());
    for (const [start, want] of Object.entries(SHARED_STARTS)) {
      for (const list of LISTS) {
        const got = rankCommands(start, list).slice(0, want.length).map(commandId);
        expect(got, start).toEqual(want.map((mode) => `mode:${mode}`));
      }
    }
  });
});

/**
 * **Another row's own word that a mode answers first, and why that is right.**
 * Everything not listed here must put a row that is not a mode first, or a
 * mode whose *name* starts with the word.
 */
const A_MODE_COMES_FIRST: Readonly<Record<string, Mode>> = {
  /* Marginalia's own name until 2026-10-01, so the retired word finds the mode
     that took its place (mode.md § Retiring a mode). The Comments row lists it
     too and comes second. Both were so before 2026-10-04. */
  annotations: "marginalia",
  /* The Metadata row's `source` — where the piece came from — was listed here
     until 2026-10-09, when it was the start of Citations' (then Peer review's)
     nickname `sources`. It is the start of the Sources mode's own label now,
     which the walk below allows, so it is no longer an exception. */
};

describe("a word that is another row's own", () => {
  it("is not taken by a mode's nickname", () => {
    const taken: Record<string, string> = {};
    for (const list of LISTS) {
      for (const command of list) {
        if (command.kind === "mode") continue;
        const text = commandText(command);
        for (const name of [text.label, ...text.aliases]) {
          const top = rankCommands(name, list)[0];
          if (top?.kind !== "mode") continue;
          /* The mode's own name: `faq` is Help's nickname and FAQ's label, and
             a sub-mode answers to its parent's name on purpose. */
          if (canonical(MODE_LABEL[top.mode]).startsWith(canonical(name))) continue;
          taken[canonical(name)] = top.mode;
        }
      }
    }
    expect(taken).toEqual(A_MODE_COMES_FIRST);
  });
});

describe("every Run again phrase, typed in full", () => {
  it("puts its own step first", () => {
    const wrong = METADATA_RERUN_STEPS.flatMap((step) =>
      rerunWords(step)
        .aliases.map((phrase) => ({ phrase, want: `action:rerun-${step}`, got: first(phrase) }))
        .filter(({ want, got }) => got.length !== 1 || got[0] !== want)
        .map(({ phrase, want, got }) => `${phrase}: wanted ${want}, got ${got.join(" / ")}`),
    );
    expect(wrong).toEqual([]);
  });

  it("includes the new nicknames, so the check above is about them", () => {
    expect(rerunWords("glossary").aliases).toContain("rerun jargon");
    /* Bibliography's words since 2026-10-09 (plan 261009l, GPT Sol's F8). */
    expect(rerunWords("bibliography").aliases).toContain("references again");
    expect(rerunWords("debate").aliases).toContain("rerun critiques");
  });
});

/* Stage 2: two bands lend their nicknames to a *Find more* row, four phrases a
   nickname, and each of those rows opens a band that spends. */
describe("every Find more phrase, typed in full", () => {
  it("puts its own band's row first — and a bare `find more` puts Glossary's, then Quotes'", () => {
    const wrong = FIND_MORE_MODES.flatMap((mode) =>
      findMoreWords(mode)
        .aliases.filter((phrase) => phrase !== "find more")
        .map((phrase) => ({ phrase, want: `action:find-more-${mode}`, got: first(phrase) }))
        .filter(({ want, got }) => got.length !== 1 || got[0] !== want)
        .map(({ phrase, want, got }) => `${phrase}: wanted ${want}, got ${got.join(" / ")}`),
    );
    expect(wrong).toEqual([]);
    for (const list of LISTS) {
      expect(rankCommands("find more", list).map(commandId)).toEqual([
        "action:find-more-glossary",
        "action:find-more-quotes",
      ]);
    }
  });

  it("leaves each mode's own name to the mode, and `rerun …` to Run again", () => {
    expect(first("glossary")).toEqual(["mode:glossary"]);
    expect(first("quotes")).toEqual(["mode:quotes"]);
    expect(first("rerun glossary")).toEqual(["action:rerun-glossary"]);
    expect(first("rerun quotes")).toEqual(["action:rerun-quotes"]);
  });

  it("includes the nicknames, so the check above is about them", () => {
    expect(findMoreWords("glossary").aliases).toContain("more jargon");
    expect(findMoreWords("quotes").aliases).toContain("excerpts find more");
  });
});
