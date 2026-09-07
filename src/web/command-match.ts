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
 * **This module knows nothing about *which* pages are offered**, only how to
 * rank one once it is handed over. The list lives in CommandBar.tsx § `PAGES`,
 * next to the `navigate` that acts on it, because naming an href means
 * importing router.ts — and router.ts imports React, which would end the purity
 * this file's second paragraph is about.
 *
 * See docs/plans/260906h-mode-catalog-and-a-command-bar.md § The command bar,
 * and GPT Sol's F5 on that plan, which is why the ranking is written down as
 * five named tiers rather than left to whatever `filter` happened to do.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import { MODE_LABEL } from "../title-text.js";
import type { Mode } from "../modes.js";

/**
 * **A row the bar can offer**, and there are two kinds.
 *
 * Greg, 2026-09-07: *"add the Changelog to the footer (e.g. of the Homepage,
 * and also as a command from the Command Bar."*
 *
 * That **overrides product call 1** of the four the bar was built to
 * (CommandBar.tsx § the header, and 260906h § The four product calls), which
 * was *modes only*. Worth saying out loud rather than quietly widening a type,
 * because the reasoning behind that call still holds for everything it refused:
 * a passage jump, an "ask this article", a generation row. Each of those needs
 * a **verb the bar would have to invent**. This one does add a second verb —
 * `CommandBar` § `activate` is a two-armed switch now, and honesty about that
 * is worth more than the tidier claim an earlier draft made — but the verb is
 * `navigate`, which every `<Link>` in the app already calls. Nothing new was
 * designed; an existing operation was reached for.
 *
 * It also **retires product call 4** as stated (*the bar lists exactly what the
 * Dock lists*), and the replacement is narrower rather than looser: the bar's
 * **mode** rows are exactly what the Dock lists, and its page rows come after
 * them. tests/command-bar.test.tsx holds both halves.
 *
 * A `mode` row carries only its `Mode` — the label comes from `MODE_LABEL` and
 * the nicknames and the sentence from `MODE_CATALOG`, so there is no second copy
 * of any of them to fall out of step. (Two tables rather than one, which is not
 * this file's doing: `MODE_LABEL` is what the Dock buttons are labelled with.) A `page` row carries its own, because there is no
 * catalog of pages and one entry does not justify inventing one.
 */
export type Command =
  | { readonly kind: "mode"; readonly mode: Mode }
  | {
      readonly kind: "page";
      /** Where it goes. `CommandBar` hands this to `navigate`. */
      readonly href: string;
      readonly label: string;
      readonly description: string;
      readonly aliases: readonly string[];
    };

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

export function commandText(command: Command): CommandText {
  if (command.kind === "page") return command;
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
 */
export function commandId(command: Command): string {
  return command.kind === "page" ? `page:${command.href}` : `mode:${command.mode}`;
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
 * Dock is drawing followed by the pages, which is what makes "the bar's mode
 * rows are exactly what the Dock lists" true by construction rather than by a
 * second copy of the experimental-switch rule (`visibleModes` in Dock.tsx is
 * the only copy).
 *
 * **The pages come last on a tie, and that falls out of the order rather than
 * being enforced here.** It is the behaviour we want — the bar is for modes
 * first — and it is the caller's arrangement that produces it, so a caller who
 * wanted otherwise would say so by handing the list over differently.
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
