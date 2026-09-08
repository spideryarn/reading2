/**
 * **The command bar's ranking, checked without rendering anything.**
 *
 * `rankCommands` is a pure function of a string and a list precisely so that the
 * interesting cases can be stated here rather than through three layers of
 * markup — a tie, a word that is a prefix of one label and a substring of
 * another, a query with a doubled space in it. GPT Sol's F5 on
 * docs/plans/260906h-mode-catalog-and-a-command-bar.md is why the ranking is
 * five named tiers at all: "substring match, ordered somehow" is not a
 * specification and cannot be tested.
 *
 * **Most of this file says `rankModes`**, which is now the local adapter below
 * rather than an export — the ranking widened to `Command` on 2026-09-07 and
 * the mode half of its behaviour did not change, so neither did these. The
 * `Command` half is the last two describes, and *which pages the bar offers*
 * is not here at all: that list lives in CommandBar.tsx and is checked in
 * tests/command-bar.test.tsx, where the bar is really drawn.
 *
 * ## The subset is the instrument
 *
 * `rankCommands` takes the list to search, so most of these hand it three or five
 * modes rather than all fourteen. That is not a shortcut — it is what makes an
 * expectation about *tiers* readable: with all fourteen, one query's answer is
 * fourteen modes long and a change to one description rewrites the expectation
 * for reasons that have nothing to do with ranking. With five chosen modes, one
 * per tier, the assertion is the tier order and nothing else.
 *
 * **These do lean on the real catalog and the real labels**, deliberately: a
 * fixture would let the ranking pass here and be wrong about Hierarchy, which
 * is the mode a reader is most likely to reach for by a nickname (`toc`).
 * Where a test depends on a particular word, the comment says which word and
 * why it was chosen, so that whoever breaks it by editing copy can see what to
 * do.
 */
import { describe, expect, it } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES, type Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import {
  canonical,
  commandId,
  commandText,
  modeCommand,
  rankCommands,
  type Command,
} from "../src/web/command-match.js";

/**
 * **The ranking, asked the way this file has always asked it** — modes in,
 * modes out — now that `rankCommands` takes the wider `Command`.
 *
 * **The input side is production code**: `modeCommand` is exactly what
 * `CommandBar` builds its list with, so this cannot quietly exercise a shape
 * production never mints — the way a helper like this usually goes wrong.
 *
 * The output side is a projection written here, and it **throws** rather than
 * coercing: handed a page it would otherwise print a confusing diff about a
 * mode that is not one. It used to be `commandId`, until that started
 * namespacing its output (`mode:search`) and this file's expectations would
 * have had to be rewritten to match an id format they are not about.
 *
 * The alternative was rewriting every expectation below as an array of objects,
 * which would have made the *tiers* — the thing this file is about — the least
 * legible part of each line.
 */
const rankModes = (query: string, modes: readonly Mode[]): Mode[] =>
  rankCommands(query, modes.map(modeCommand)).map((command) => {
    if (command.kind !== "mode") throw new Error(`ranked a ${command.kind}, not a mode`);
    return command.mode;
  });

/**
 * **One mode per tier, for the query `"s"`**, and the whole point of the file.
 * Each line says which field carries the hit, because that is the fact the
 * ordering is about:
 *
 *  | mode | tier | why |
 *  |---|---|---|
 *  | `search` | label-prefix | *Search* begins with it |
 *  | `diagram` | alias-prefix | its alias *sketch* begins with it |
 *  | `ideas` | label-substring | *Ideas* has an `s`, not at the front |
 *  | `timeline` | alias-substring | *Timeline* has no `s`; its alias *dates* does |
 *  | `remember` | description-substring | neither *Remember* nor *recall* has one; its sentence does |
 *
 * `"s"` rather than a longer word because a single letter is the only query
 * that can reach all five tiers at once across five different modes.
 */
const ONE_PER_TIER: readonly Mode[] = ["search", "diagram", "ideas", "timeline", "remember"];

describe("the ranking ranks by how a query hits a mode", () => {
  it("puts the five tiers in order: label-prefix, alias-prefix, label-, alias-, description-substring", () => {
    expect(rankModes("s", ONE_PER_TIER)).toEqual([
      "search",
      "diagram",
      "ideas",
      "timeline",
      "remember",
    ]);
  });

  /**
   * **The ordering is the tiers and not the input**, which is the half the test
   * above cannot show on its own: handed in already-sorted, a function that did
   * no ranking at all would pass it.
   */
  it("reorders a list handed in worst-tier-first", () => {
    expect(rankModes("s", [...ONE_PER_TIER].reverse())).toEqual([
      "search",
      "diagram",
      "ideas",
      "timeline",
      "remember",
    ]);
  });

  it("prefers a label prefix to an alias prefix", () => {
    /* `sketch` is Diagram's alias and `Summary` is a label, so a matcher that
       ranked aliases first — or ranked nothing — would answer the other way. */
    expect(rankModes("s", ["diagram", "summary"])).toEqual(["summary", "diagram"]);
  });

  it("prefers a prefix to a substring of the same field", () => {
    /* Both hits are on the **label**: `Search` begins with `s` and `Ideas`
       merely contains one. So this separates the two label tiers from each
       other, where the test above separates labels from aliases. */
    expect(rankModes("s", ["ideas", "search"])).toEqual(["search", "ideas"]);
  });

  it("finds a mode by its alias alone", () => {
    /* `toc` was Hierarchy's name until 2026-08-29 and is still what most people
       call the thing, so it is the alias most likely to be typed. Nothing else
       in the app contains the letters. */
    expect(rankModes("toc", MODES)).toEqual(["hierarchy"]);
  });
});

describe("the ranking breaks ties in the order it was handed", () => {
  /**
   * **The tie-break is the promise that makes the result total.**
   *
   * `Search` and `Summary` are both label-prefix matches for `"s"`, so nothing
   * about the query separates them and the only honest answer is *the order the
   * Dock draws them in* — which arrives as the order of the array. Both
   * directions are asserted, because a function that always returned one fixed
   * order would pass either one alone.
   */
  it("keeps two equal matches in input order, whichever order that is", () => {
    expect(rankModes("s", ["search", "summary"])).toEqual(["search", "summary"]);
    expect(rankModes("s", ["summary", "search"])).toEqual(["summary", "search"]);
  });

  it("keeps every mode in input order for an empty query", () => {
    /* The bar opens showing everything, so the reader can see what there is to
       ask for rather than guessing a first letter. */
    expect(rankModes("", MODES)).toEqual([...MODES]);
    expect(rankModes("", [...MODES].reverse())).toEqual([...MODES].reverse());
  });

  it("treats a query of nothing but whitespace as empty", () => {
    expect(rankModes("   ", ["chat", "plain"])).toEqual(["chat", "plain"]);
  });
});

describe("the ranking normalises what the reader typed", () => {
  it("ignores case", () => {
    expect(rankModes("TOC", MODES)).toEqual(["hierarchy"]);
  });

  it("ignores padding", () => {
    expect(rankModes("  toc  ", MODES)).toEqual(["hierarchy"]);
  });

  /**
   * **The doubled internal space, which is the one that is easy to get wrong.**
   *
   * `peer review` is Referee's alias, and GPT Sol reproduced the hole on
   * 2026-09-07: a normaliser that trims and lowercases but does not *collapse*
   * lets `"peer  review"` sit in a table looking correct and match nothing. The
   * same function guards the table itself — tests/mode-catalog.test.ts imports
   * this one — so the two cannot disagree.
   */
  it("collapses runs of internal whitespace", () => {
    expect(rankModes("peer  review", MODES)).toEqual(["referee"]);
    expect(rankModes("PEER \t REVIEW ", MODES)).toEqual(["referee"]);
  });

  it("matches nothing when nothing matches, rather than falling back to everything", () => {
    /* The empty query returns all fourteen, so a matcher that treated "no hits"
       as "no filter" would be indistinguishable from one that worked, right up
       until a reader typed a typo and got the whole list back. */
    expect(rankModes("zzzq", MODES)).toEqual([]);
  });
});

/**
 * **A page is ranked by the same five tiers as a mode**, which is the whole
 * claim of the 2026-09-07 widening: the bar did not grow a second matcher for
 * a second kind of row, it grew a wider input to the one it had.
 *
 * A **hand-made** page rather than the real `besideTheModes` entry, deliberately. This
 * file is about the ranking and runs without a DOM; importing the real list
 * means importing CommandBar.tsx, and therefore React and router.ts, to assert
 * something that is not about either. What the real entry says — that
 * `changelog` and `whats new` reach it — is asserted in
 * tests/command-bar.test.tsx against the bar a reader actually sees.
 */
const A_PAGE: Extract<Command, { kind: "page" }> = {
  kind: "page",
  href: "/somewhere",
  label: "Zebra crossing",
  description: "A sentence about the zebra.",
  aliases: ["stripes"],
  /* **Required, not omitted**, and so is every other row's — GPT Sol refused an
     optional flag on 2026-09-08, because a row that spends could then be
     written without one and ship unmarked. command-match.ts § `CommandWords`.

     **Typed to the arm rather than to `Command`**, for the same reason
     `AN_ACTION` below is: spreading a value declared as the union gives back
     the union, and `{ ...A_PAGE, href: "search" }` then matches no arm. */
  generates: false,
};

/**
 * A second one, whose only job is to tie with a real mode. Its label begins
 * with `s`, as *Search* does, so the query `"s"` puts both on `label-prefix`
 * and nothing but the input order can separate them.
 */
const S_PAGE: Extract<Command, { kind: "page" }> = {
  kind: "page",
  href: "/ships-log",
  label: "Ship's log",
  description: "Where the ship has been.",
  aliases: [],
  generates: false,
};

describe("the ranking handles a page exactly as it handles a mode", () => {
  it("finds a page by its label, its alias and its description", () => {
    /* One per field, and each word appears in exactly one of the three, so a
       matcher that read only the label would fail two of these. */
    expect(rankCommands("zebra", [A_PAGE])).toEqual([A_PAGE]);
    expect(rankCommands("stripes", [A_PAGE])).toEqual([A_PAGE]);
    expect(rankCommands("sentence", [A_PAGE])).toEqual([A_PAGE]);
  });

  it("filters a page out when nothing matches", () => {
    /* The vacuity guard for the three above: a ranker that returned its input
       untouched would have passed every one of them. */
    expect(rankCommands("zzzq", [A_PAGE])).toEqual([]);
  });

  it("puts a page below a mode it ties with, because that is the order it was handed", () => {
    /* Both are `label-prefix` for `"s"` — *Search* and *Ship's log* — so
       nothing about the query separates them and the answer is the input
       order. That is the whole mechanism keeping pages beneath modes in the
       bar: `CommandBar` spreads the Dock's modes first and `besideTheModes` after, and
       there is no rule anywhere that says "pages last".

       **Asserted in both directions**, because a ranker that special-cased
       pages to the bottom would pass the first line on its own — and would then
       be a second rule to keep in step with the caller's arrangement. */
    expect(rankCommands("s", [modeCommand("search"), S_PAGE])).toEqual([
      modeCommand("search"),
      S_PAGE,
    ]);
    expect(rankCommands("s", [S_PAGE, modeCommand("search")])).toEqual([
      S_PAGE,
      modeCommand("search"),
    ]);
  });
});

describe("a command says which one it is", () => {
  /**
   * **A page and a mode cannot share an id even when they share a name**, which
   * is the case the first version of this got wrong: it asserted that no mode
   * name begins with `/`, which was true and irrelevant, because nothing stops
   * a page's href being `search`. GPT Sol found it, 2026-09-07.
   *
   * The page here is spelled to collide on purpose. Under the old scheme these
   * two ids were both `"search"`; a row `id` is what `aria-activedescendant`
   * points at, so that made two rows one row for the keyboard.
   */
  it("keeps a page's id apart from a mode's even when the two are spelled alike", () => {
    const collider: Command = { ...A_PAGE, href: "search" };
    expect(commandId(collider)).not.toBe(commandId(modeCommand("search")));
  });

  /**
   * And no two *modes* collide either — the guard that was never in doubt, said
   * here so that a change to `commandId` cannot fix one half by breaking the
   * other.
   */
  it("gives every mode a distinct id", () => {
    const ids = MODES.map((mode) => commandId(modeCommand(mode)));
    expect(new Set(ids).size).toBe(MODES.length);
  });

  /**
   * **A mode's words come from the catalog and are not copied**, which is why a
   * mode command carries only its `Mode`. If `commandText` ever grew its own
   * table, this is the test that would go red rather than the bar quietly
   * drawing last month's wording.
   */
  it("reads a mode's label, aliases and sentence out of the catalog", () => {
    const text = commandText(modeCommand("hierarchy"));
    expect(text.label).toBe(MODE_LABEL.hierarchy);
    expect(text.aliases).toEqual(MODE_CATALOG.hierarchy.aliases);
    expect(text.description).toBe(MODE_CATALOG.hierarchy.description);
  });

  it("reads a page's out of the page itself", () => {
    /* Named fields rather than `toEqual(A_PAGE)` for legibility, not for
       strength: `commandText` returns the page object itself, so the two forms
       cannot distinguish any implementation from any other (GPT Sol, 2026-09-07,
       correcting a claim here that they could). What this pins is the
       *contract* — a page's three words are its own — which is the half the
       mode case above is contrasted against. */
    const text = commandText(A_PAGE);
    expect(text.label).toBe("Zebra crossing");
    expect(text.aliases).toEqual(["stripes"]);
    expect(text.description).toBe("A sentence about the zebra.");
  });

  /**
   * **The `action` arm reads like a page rather than like a mode**, and this is
   * the test that would have gone red on the mistake `commandText`'s docblock
   * names: it asked *is this a page* until 2026-09-08, so a third kind would
   * have fallen down the mode branch and been given `MODE_CATALOG[undefined]`.
   */
  it("reads an action's words out of the action itself", () => {
    const text = commandText(AN_ACTION);
    expect(text.label).toBe("Feedback");
    expect(text.aliases).toEqual(["bug"]);
    expect(text.description).toBe("Tell us what went wrong.");
  });

  /**
   * **An action's id is its own, and cannot meet a page's or a mode's** — the
   * same guard the page/mode pair above holds, extended to the arm that has no
   * href to be named by. Spelled to collide on purpose in all three directions.
   */
  it("keeps an action's id apart from a page's and a mode's spelled alike", () => {
    const action: Command = { ...AN_ACTION, id: "search" };
    const page: Command = { ...A_PAGE, href: "search" };
    const ids = [commandId(action), commandId(page), commandId(modeCommand("search"))];
    expect(new Set(ids).size).toBe(3);
  });
});

/**
 * **The third kind of row, 2026-09-08** — Greg asked for a Feedback command,
 * and Feedback is a dialog rather than a place (260908e § Feedback is the one
 * new verb). Hand-made here for the reason `A_PAGE` is: this file is the
 * ranking, and the real row closes over a React context.
 *
 * `run` is a `noop` because nothing in this file presses anything. What
 * pressing does is tests/command-bar.test.tsx.
 *
 * **Typed to the arm rather than to `Command`**, which `A_PAGE` above is not
 * and does not need to be: spreading a value whose declared type is the union
 * gives back the union, and `{ ...AN_ACTION, id: "search" }` then matches no
 * arm at all, because `id` is not a field the `mode` arm has. `Extract` is the
 * same narrowing `besideTheModes` in CommandBar.tsx uses for its own list.
 */
const AN_ACTION: Extract<Command, { kind: "action" }> = {
  kind: "action",
  id: "feedback",
  label: "Feedback",
  description: "Tell us what went wrong.",
  aliases: ["bug"],
  generates: false,
  run: () => {},
};

describe("the ranking handles an action exactly as it handles a page", () => {
  it("finds an action by its label, its alias and its description", () => {
    expect(rankCommands("feedback", [AN_ACTION])).toEqual([AN_ACTION]);
    expect(rankCommands("bug", [AN_ACTION])).toEqual([AN_ACTION]);
    expect(rankCommands("wrong", [AN_ACTION])).toEqual([AN_ACTION]);
  });

  it("filters an action out when nothing matches", () => {
    expect(rankCommands("zzzq", [AN_ACTION])).toEqual([]);
  });

  /**
   * **Ties still fall to input order**, with three kinds in the list rather
   * than two — so "modes first, then everything else" goes on being the
   * caller's arrangement and not a rule inside the ranker. All three are
   * `label-prefix` for `"s"`.
   */
  it("keeps a mode, a page and an action in the order they were handed", () => {
    const action: Command = { ...AN_ACTION, label: "Send a report" };
    const handed = [modeCommand("search"), S_PAGE, action];
    expect(rankCommands("s", handed)).toEqual(handed);
    expect(rankCommands("s", [...handed].reverse())).toEqual([...handed].reverse());
  });
});

/**
 * **`generates` is a field now, not a `kind`** — CommandBar.tsx § the marker
 * and `CommandWords` § `generates` carry the argument. This file only pins that
 * the field survives the ranking untouched, because the row that needs it
 * (Tweets) reaches the renderer through `rankCommands` and nothing else.
 */
describe("a row that starts work carries it as a property", () => {
  it("keeps `generates` on the command the ranking hands back", () => {
    const spender: Command = { ...A_PAGE, generates: true };
    const [ranked] = rankCommands("zebra", [spender]);
    expect(ranked).toBeDefined();
    expect(ranked?.kind === "page" && ranked.generates).toBe(true);
  });

  it("says `false` on a row that only navigates, rather than saying nothing", () => {
    /* The **vacuity guard** for the line above: a ranker that marked everything
       would pass it, and `A_PAGE` is the ordinary case. What this does *not*
       prove is that the field is required — see the type-level check below,
       which is the honest version of a claim this comment used to make. */
    expect(A_PAGE.generates).toBe(false);
  });

  /**
   * **`generates` is required, checked at the type level** — the assertion the
   * runtime one above cannot make, and GPT Sol said so on 2026-09-08:
   *
   * > Change `generates: boolean` to `generates?: boolean` → this fixture still
   * > explicitly contains `false` → the test and typecheck remain green. A later
   * > spending row can then omit it, and `commandGenerates()` returns false.
   *
   * Exactly right. Every fixture in this file *volunteers* the field, so making
   * it optional again would break nothing — the requirement would quietly stop
   * being one, which is the whole failure the requirement exists to prevent.
   *
   * `@ts-expect-error` is what states it: the literals below are missing
   * `generates`, and the comment **fails to compile if they ever become
   * legal**. One per arm, because the two carry it through the same
   * `CommandWords` and a check on one would go on passing if only the other
   * were loosened.
   *
   * **It goes red at `npm run typecheck`, not at `npm test`** — vitest strips
   * types and never checks them, so this file passing proves nothing about this
   * block. That is a property of the tool, not a weakness here: the gate that
   * catches it is one of the two that run on every change.
   */
  it("cannot be omitted from a page or an action (a type-level check)", () => {
    // @ts-expect-error — a page without `generates` must not be a Command
    const pageWithout: Command = {
      kind: "page",
      href: "/nowhere",
      label: "No marker",
      description: "A page that never said whether it spends.",
      aliases: [],
    };
    // @ts-expect-error — nor an action without one
    const actionWithout: Command = {
      kind: "action",
      id: "no-marker",
      label: "No marker",
      description: "An action that never said whether it spends.",
      aliases: [],
      run: () => {},
    };
    /* Read them, so `noUnusedLocals` does not delete the point of the test.
       The runtime values are beside the point — what is asserted is above. */
    expect(commandText(pageWithout).label).toBe("No marker");
    expect(commandText(actionWithout).label).toBe("No marker");
  });
});

describe("canonical is the one normaliser", () => {
  it("lowercases, trims and collapses", () => {
    expect(canonical("  Peer   Review ")).toBe("peer review");
    expect(canonical("TOC")).toBe("toc");
    expect(canonical("a\t\nb")).toBe("a b");
  });

  /**
   * **Idempotent**, which is what lets `rankModes` canonicalise input a caller
   * may already have canonicalised without the answer depending on how many
   * times it happened.
   */
  it("is idempotent", () => {
    for (const s of ["  Peer   Review ", "toc", "", "   ", "A B  C"]) {
      expect(canonical(canonical(s))).toBe(canonical(s));
    }
  });
});
