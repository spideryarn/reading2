/**
 * **What the command bar shows when you have typed something**, as a pure
 * function of the words and the list.
 *
 * Its own module, importing no React and touching no browser API, because the
 * whole of the bar that can be *wrong* is in here and the whole of the bar that
 * needs a DOM is in CommandBar.tsx. A ranking rendered inside a component is a
 * ranking you can only test by rendering it, which means the interesting cases —
 * a tie, a word that is a prefix of one label and a substring of another — get
 * checked through three layers of markup or not at all.
 *
 * **It ranks `Command`s rather than `Mode`s, and has since 2026-09-07**, when
 * Greg asked for `/changelog` to be reachable from the bar as well as from the
 * footer. That is the first row the bar has ever carried that is not a mode.
 * See `Command` below for what that cost and what it deliberately did not.
 *
 * **This module knows nothing about *which* pages or actions are offered**,
 * only how to rank one once it is handed over. The list lives in CommandBar.tsx
 * § `besideTheModes`, next to the `navigate` that acts on it, because naming an
 * href means importing router.ts — and router.ts imports React, which would end
 * the purity this file's second paragraph is about. An action is even further
 * out of reach: what it *does* is a closure over a React context.
 *
 * See docs/plans/260906h-mode-catalog-and-a-command-bar.md § The command bar,
 * and GPT Sol's F5 on that plan, which is why the ranking is written down as
 * five named tiers rather than left to whatever `filter` happened to do.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import { MODE_LABEL } from "../title-text.js";
import type { Mode } from "../modes.js";

/**
 * **What a row that is not a mode has to carry** — its own words, because
 * there is no catalog of pages the way there is one of modes.
 *
 * A `mode` row carries only its `Mode`: the label comes from `MODE_LABEL` and
 * the nicknames and the sentence from `MODE_CATALOG`, so there is no second copy
 * of any of them to fall out of step. (Two tables rather than one, which is not
 * this file's doing: `MODE_LABEL` is what the Dock buttons are labelled with.)
 * Everything else is written out beside the row that needs it.
 */
interface CommandWords {
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  /**
   * **Whether pressing Enter here may start a model call**, drawn as the muted
   * word `generates` (CommandBar.tsx § `GENERATES_MARKER`).
   *
   * **It is a property rather than a `kind` check, and that is the whole of
   * this field.** Until 2026-09-08 the marker was `kind === "mode" &&
   * modeGenerates(mode)`, which was true of every row that existed and was
   * exactly as fragile as GPT Sol said on 2026-09-07: *"the fix, on the day a
   * spending page is proposed, is to move 'does this start work?' into
   * `Command` itself and render off the property — not to add a second name to
   * this condition."* That day is this one. The Tweets row navigates to the
   * thread page **and arms a run over the whole article**, so a `kind` check
   * would have shipped a spending row wearing no marker, and no test could have
   * seen the difference because the check would go on excluding pages.
   *
   * **Required, and that is the whole of its value.** It was optional for
   * about an hour, and GPT Sol refused the design on 2026-09-08 for the reason
   * the field exists: *"a future page/action can start a model call but omit
   * `generates`; it compiles, `commandGenerates()` returns false, and Enter
   * spends without the marker … the design reproduces the precise
   * silent-spending hole it says it closes."* An optional flag moves the
   * failure from a `kind` check nobody would think to change to a field
   * somebody could forget — quieter, not safer.
   *
   * So every row that is not a mode writes `false` out, and the verbosity is
   * the feature: adding a row means **deciding** whether it spends, in a line
   * the compiler will not let you leave out. The mode arm needs no such field
   * because `MODE_TARGET` already answers for all fourteen and a copied boolean
   * per mode would be fourteen chances to disagree with it — `commandGenerates`
   * in CommandBar.tsx is where the two arms meet.
   */
  readonly generates: boolean;
}

/**
 * **A row the bar can offer**, and there are three kinds.
 *
 * Greg, 2026-09-07: *"add the Changelog to the footer (e.g. of the Homepage,
 * and also as a command from the Command Bar."*
 *
 * That **overrode product call 1** of the four the bar was built to
 * (CommandBar.tsx § the header, and 260906h § The four product calls), which
 * was *modes only*. Worth saying out loud rather than quietly widening a type,
 * because the reasoning behind that call held for everything it refused: a
 * passage jump, an "ask this article", a generation row. Each of those needed
 * a **verb the bar would have to invent**. A page did not — `navigate` is the
 * verb every `<Link>` in the app already calls, so nothing was designed and an
 * existing operation was reached for.
 *
 * **The third kind is 2026-09-08, and it does invent a verb**, which is why it
 * is argued rather than announced. Greg asked for a Feedback row
 * (SPIDERYARN-READING2-2D, and 260908e § Feedback is the one new verb):
 *
 * > Add Library, Feedback, Metadata, Tweets, Homepage, Profile, and a few more
 * > likely/useful commands to Command Bar.
 *
 * Feedback is not a place — it is a `<dialog>` mounted once for the life of the
 * page, opened through a context (FeedbackButton.tsx § One dialog, two
 * triggers). So `action` carries a `run()`, and `CommandBar` § `activate` is a
 * three-armed switch. **What the earlier calls refused is still refused**, and
 * for the reason they gave rather than because the type has run out of room: a
 * passage jump and an "ask this article" would each need the bar to grow an
 * *argument* — which passage, which question — and this bar has one text box
 * and it is the filter. An `action` takes no argument. That is the line.
 *
 * It also **retires product call 4** as stated (*the bar lists exactly what the
 * Dock lists*), and the replacement is narrower rather than looser: the bar's
 * **mode** rows are exactly what the Dock lists, and everything else comes
 * after them. tests/command-bar.test.tsx holds both halves.
 */
export type Command =
  | { readonly kind: "mode"; readonly mode: Mode }
  | (CommandWords & {
      readonly kind: "page";
      /** Where it goes. `CommandBar` hands this to `navigate`. */
      readonly href: string;
      /**
       * **What has to happen before the navigation**, and the name is
       * `DockLink`'s (Dock.tsx) rather than a new one, because it means exactly
       * what that prop means: a press that is going to leave this page, and the
       * work to arm before it does.
       *
       * One caller, and it is the reason the field exists: Tweets arms a run
       * over the whole article on the way to its page, so the row and the Dock
       * button do the same thing rather than the bar being *"a second, faster
       * door"* into a different behaviour. See `generates` above, which such a
       * row must also carry.
       */
      readonly onNavigate?: () => void;
    })
  | (CommandWords & {
      readonly kind: "action";
      /**
       * **What tells this row from every other one**, and it has to be given
       * because an action has no href to be identified by — `commandId` below
       * says why that matters and why the kind is in the string.
       */
      readonly id: string;
      /** What pressing Enter does. Takes no argument; see the type's docblock. */
      readonly run: () => void;
    });

/**
 * **The one form a typed word and a stored word are ever compared in**:
 * lowercase, trimmed, and internal runs of whitespace collapsed to one space.
 *
 * **This function is the shared one, and sharing it is the point.** It lived in
 * tests/mode-catalog.test.ts first, where it was checking that no two modes
 * claim the same alias; that test now imports this, so the table's uniqueness
 * and the matcher's comparison are provably the same rule rather than two
 * spellings that agree today. The collapse is the half that is easy to leave
 * out, and leaving it out opens the hole GPT Sol reproduced on 2026-09-07:
 * `"peer review"` and `"peer  review"` are different strings, so they pass a
 * uniqueness check on raw text, and identical queries, so they collide the
 * moment anybody types either.
 *
 * **Idempotent**, which is what lets `rankCommands` below call it on input the
 * caller may already have canonicalised: `canonical(canonical(s)) === canonical(s)`.
 *
 * Deliberately *not* Unicode-folding, stripping accents or stemming. Every
 * alias in the catalog is ASCII and every mode label is English, so a folding
 * step would be machinery with nothing yet to do — and the first accented alias
 * is the moment to add it, with a test that shows what it buys.
 *
 * **It does not touch punctuation either, and two page aliases exist because of
 * that**: the changelog's label is *What’s new* with a typographic apostrophe,
 * and the three ways a reader might type that — `’`, `'`, or nothing at all —
 * are three different strings here, so `PAGES` spells all three out. Folding
 * punctuation would remove that need and would also quietly change what the
 * *mode* aliases match; one page is not the evidence for that.
 * CommandBar.tsx § `PAGES`.
 */
export function canonical(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * **How a command names itself** — the three fields the ranking reads and the
 * two the row draws, from one function so they cannot describe different rows.
 *
 * Display forms, not canonical ones: the renderer needs *What’s new* with its
 * apostrophe, and `TIERS` canonicalises on the way past.
 */
export interface CommandText {
  readonly label: string;
  readonly aliases: readonly string[];
  readonly description: string;
}

/**
 * **The mode arm is the special case, and the rest is `CommandWords`.**
 *
 * Written as *"is it a mode"* rather than *"is it a page"*, which is what it
 * said until the `action` arm arrived on 2026-09-08 and made the old spelling
 * wrong in the quiet direction: `kind === "page"` would have sent an action
 * down the mode branch and indexed `MODE_CATALOG` with an `id`, giving every
 * action row `undefined` for a label. The compiler would not have minded —
 * `command.mode` does not exist on that arm, so it would have complained — but
 * the shape of the mistake is worth naming, because it is the shape every
 * `kind` check in this file has: **a check that names the minority arm keeps
 * working as arms are added; one that names the majority does not.**
 */
export function commandText(command: Command): CommandText {
  if (command.kind !== "mode") return command;
  return {
    label: MODE_LABEL[command.mode],
    aliases: MODE_CATALOG[command.mode].aliases,
    description: MODE_CATALOG[command.mode].description,
  };
}

/**
 * **What distinguishes one row from another** — a React key, and the `id` that
 * `aria-activedescendant` points at. Two rows sharing one is two rows the
 * keyboard and a screen reader cannot tell apart.
 *
 * **The kind is in the string, and that is the whole guard.** It did not used
 * to be: a mode's id was its own name and a page's was its href, resting on the
 * observation that every href starts with `/` and no `Mode` does. GPT Sol
 * showed that guard was ornamental on 2026-09-07 — `href` is an unrestricted
 * `string`, so a page written as `href: "search"` would have collided with the
 * Search mode, and the test standing behind the claim only ever looked at a
 * hand-made page that was never going to. Prefixing costs nothing and makes the
 * collision impossible instead of unlikely.
 *
 * A `/${string}` href type was the other candidate and is worse: it pins these
 * ids to how routes happen to be spelled, so a future page reached by a
 * fragment or a query string would fail a check about *ids* for a reason about
 * *routes*.
 *
 * **An `action` has nothing else to be named by**, which is why that arm
 * carries an explicit `id`: a page has an href and a mode has its own name, and
 * an action has a closure. Same prefixing rule, so `action:feedback` and a page
 * at `href: "feedback"` cannot meet.
 *
 * **A `switch` rather than the ternary this was**, and the `never` is the
 * point: a fourth kind added to `Command` fails to compile here rather than
 * falling into whichever arm the ternary's `else` happened to be — which is how
 * the third kind would have been given a mode's id.
 */
export function commandId(command: Command): string {
  switch (command.kind) {
    case "mode":
      return `mode:${command.mode}`;
    case "page":
      return `page:${command.href}`;
    case "action":
      return `action:${command.id}`;
    default: {
      const never: never = command;
      return never;
    }
  }
}

/**
 * **A mode, as a command**, and the one place that conversion happens.
 *
 * `CommandBar` builds its list with this and so do the ranking tests, which is
 * what stops those tests exercising a shape production never mints.
 */
export function modeCommand(mode: Mode): Command {
  return { kind: "mode", mode };
}

/**
 * **The five ways a query can hit a command, best first — and this list IS the
 * ranking.**
 *
 * One ordered array rather than a `switch` of `if`s and a number beside each,
 * because those are two statements of one fact and they drift: somebody
 * reorders the tests and forgets the numbers, and the bar quietly starts
 * offering a description match above a name. Here the position in the array is
 * the tier, so there is nothing to keep in step.
 *
 * The shape of the order: a **name** beats a **nickname**, either of those as a
 * *prefix* beats either as a *substring*, and the description comes last
 * because it is a sentence about the command rather than a way of naming it.
 *
 * `name` is not read by the bar. It is here so a failing test can say *which*
 * tier it expected rather than printing a 3.
 */
const TIERS: readonly {
  readonly name: string;
  readonly hit: (query: string, text: CommandText) => boolean;
}[] = [
  { name: "label-prefix", hit: (q, t) => canonical(t.label).startsWith(q) },
  { name: "alias-prefix", hit: (q, t) => aliases(t).some((a) => a.startsWith(q)) },
  { name: "label-substring", hit: (q, t) => canonical(t.label).includes(q) },
  { name: "alias-substring", hit: (q, t) => aliases(t).some((a) => a.includes(q)) },
  {
    name: "description-substring",
    hit: (q, t) => canonical(t.description).includes(q),
  },
];

/**
 * The command's nicknames, in the form a typed word is compared against.
 *
 * A mode's are already canonical in the table — tests/mode-catalog.test.ts
 * asserts that rather than trusting it — and they go through `canonical` here
 * anyway, because a matcher that only works on well-formed data is one whose
 * correctness depends on a test in another file continuing to exist. It is
 * idempotent, so this costs nothing and removes the coupling. A page's aliases
 * are hand-written beside the page, with no table and so no such test, which
 * makes this the only thing normalising them.
 */
function aliases(text: CommandText): readonly string[] {
  return text.aliases.map(canonical);
}

/** Which tier a command lands in, or `TIERS.length` for no match at all. */
function tierFor(query: string, command: Command): number {
  const text = commandText(command);
  const found = TIERS.findIndex((tier) => tier.hit(query, text));
  return found === -1 ? TIERS.length : found;
}

/**
 * **The commands a query matches, best first.**
 *
 * `commands` is the list to search and its **order is part of the answer**: two
 * commands on the same tier come back in the order they were handed in, so the
 * result is total and a test can state it. The caller hands in the modes the
 * Dock is drawing followed by everything else, which is what makes "the bar's
 * mode rows are exactly what the Dock lists" true by construction rather than
 * by a second copy of the experimental-switch rule (`visibleModes` in Dock.tsx
 * is the only copy).
 *
 * **The pages and actions come last on a tie, and that falls out of the order
 * rather than being enforced here.** It is the behaviour we want — the bar is
 * for modes first — and it is the caller's arrangement that produces it, so a
 * caller who wanted otherwise would say so by handing the list over
 * differently.
 *
 * An **empty query returns everything, in input order** — the bar opens showing
 * all of it, so the reader can see what there is to ask for rather than having
 * to guess a first letter.
 *
 * The query is canonicalised here rather than trusted, so a caller passing raw
 * keystrokes and a caller passing an already-normalised string get the same
 * answer. `canonical` is idempotent; see it.
 *
 * **Not fuzzy, and that is a choice with a reason.** Subsequence matching
 * (`glsy` → Glossary) would widen what the bar accepts and would also make the
 * ranking a score, at which point the tie-break stops being "the order Greg put
 * the buttons in" and starts being an arithmetic nobody can predict. Fourteen
 * modes with short names do not need it. If it ever arrives, it arrives as a
 * sixth tier below these five, so exact matching keeps winning.
 */
export function rankCommands(query: string, commands: readonly Command[]): readonly Command[] {
  const wanted = canonical(query);
  if (wanted === "") return [...commands];

  /* The index is carried rather than relied on. `Array.prototype.sort` has been
     stable since ES2019 and this would work without it — but "ties fall back to
     the order the caller handed them in" is a promise this function makes, and
     a promise that rests on an engine's sort being stable is one no test
     failure would ever point at. Comparing the index says it out loud, and it
     is the line the mutation check breaks. */
  return commands
    .map((command, index) => ({ command, index, tier: tierFor(wanted, command) }))
    .filter((row) => row.tier < TIERS.length)
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((row) => row.command);
}
