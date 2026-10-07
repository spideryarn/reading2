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
import { type ArgumentKind, PICK_SLUG, type PickKey, type PickOption } from "../command-pick.js";
import { subModeWords, type SubMode } from "./sub-modes.js";

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
   * this condition."* That day is this one. The Tweets row navigated to the
   * owner-only thread page (a mode since 2026-09-29), which started a run on arrival when empty, so a
   * `kind` check would have shipped a spending row wearing no marker, and no
   * test could have seen the difference because the check would go on excluding
   * pages. Until 2026-09-15 the row armed that run itself.
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
  /**
   * **Offered only once something is typed** — absent from the list the bar
   * opens on, and ranked like any other row the moment there is a query.
   *
   * Since 2026-10-02, for the fourteen *Run again* rows (rerun-commands.ts):
   * listed always, they would more than double what a reader sees on opening,
   * and every one of them spends. A reader who wants one names it.
   *
   * **Optional, and the difference from `generates` above is the direction of
   * the mistake.** Forgetting `generates` was silent — a spending row with no
   * marker, and no test that could see it. Forgetting this is loud: the row
   * turns up in the empty list, in front of everybody who opens the bar. So
   * the default can be the ordinary case without the hole `generates` closed.
   */
  readonly typedOnly?: true;
  /**
   * **A muted word after the sentence that is about the reader's state, not
   * the row's meaning** — `current` on the appearance in force
   * (appearance-commands.ts), since 2026-10-05.
   *
   * It is a field of its own, and not a clause on `description`, because the
   * description is what a model is shown and what the checked-in catalogue
   * holds once per (id, label) (`pickOption`; tests/command-pick-catalogue.test.ts):
   * a sentence that changed with the reader's setting would either collide
   * there or be frozen into the server's copy for everybody (GPT Sol's F2 on
   * plan 261005d). Drawn, never matched on and never sent.
   */
  readonly marker?: string;
}

/**
 * **What an action's Enter came to** — close the bar, or keep it open with a
 * sentence for the reader.
 *
 * Since 2026-10-02. `run` returned `void` until then and the bar closed
 * whatever happened, which was right while the only actions were opening a
 * drawer and a dialog — neither can fail. A *Run again* row posts a job, and a
 * refused post closed under the reader would be a press that silently did
 * nothing (GPT Sol's F2 on plan 261002c). So the outcome is a value, and
 * `stay` carries the words to show rather than a flag beside them, so nothing
 * can say *stay* and forget to say why.
 */
export type ActionOutcome =
  | { readonly kind: "close" }
  | { readonly kind: "stay"; readonly message: string };

/**
 * **A row the bar can offer**, and there are four kinds — the fourth,
 * `submode`, is 2026-10-01 and is argued on its arm below; it adds no verb.
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
 * **mode** rows are exactly what the Dock offers — as a button, or since
 * 2026-10-07 under its More button — and everything else comes after them. tests/command-bar.test.tsx holds both halves.
 */
export type Command =
  | { readonly kind: "mode"; readonly mode: Mode }
  /* **A sub-mode, since 2026-10-01** — Greg, SPIDERYARN-READING2-77: *"In the
     Command bar, include sub-modes, e.g. Quiz mode, Illustrated diagram,
     etc."* Like a mode row it carries only what it names, and its words come
     from a registry (src/web/sub-modes.ts) rather than being written beside it.
     No new verb: it opens a mode with one chip already pressed.
     docs/plans/261001d-command-bar-lists-sub-modes.md. */
  | { readonly kind: "submode"; readonly sub: SubMode }
  | (CommandWords & {
      readonly kind: "page";
      /** Where it goes. `CommandBar` hands this to `navigate`. */
      readonly href: string;
    })
  | (CommandWords & {
      readonly kind: "action";
      /**
       * **What tells this row from every other one**, and it has to be given
       * because an action has no href to be identified by — `commandId` below
       * says why that matters and why the kind is in the string.
       */
      readonly id: string;
      /**
       * What pressing Enter does. Takes no argument; see the type's docblock.
       *
       * **Synchronous or not, and the bar treats the two differently on
       * purpose.** A plain `ActionOutcome` is acted on at once, so opening the
       * drawer and shutting the bar stay one step; a promise puts the bar into
       * its pending state, refuses a second press until it settles, and closes
       * only on `close` (CommandBar.tsx § `activate`).
       */
      readonly run: () => ActionOutcome | Promise<ActionOutcome>;
      /**
       * **Whether pressing this only shows the reader something** — opens a
       * drawer, a dialog, a section — and changes and sends nothing.
       *
       * Read by one decision: a row the command bar's model picked from a
       * sentence runs without a second Enter only if it just moves the reader
       * (CommandBar.tsx § `onlyMovesTheReader`, plan 261003k). A mode or a
       * page answers that with `generates`; an action is a closure, so it has
       * to say.
       *
       * **Required, for `generates`'s reason**: an optional flag would let a
       * new action that writes compile without deciding, and the wrong default
       * here is a sentence archiving an article. `false` is the safe answer
       * when unsure — the row is then drawn and waits for Enter.
       */
      readonly opensOnly: boolean;
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
 * are three different strings here, so `besideTheModes` spells all three out. Folding
 * punctuation would remove that need and would also quietly change what the
 * *mode* aliases match; one page is not the evidence for that.
 * CommandBar.tsx § `besideTheModes`.
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
/**
 * **What a mode used to be called**, for the compound names of its sub-mode
 * rows only. A sub-mode row takes its parent's *label* as a nickname, not the
 * parent's catalogue aliases, so when a label changes the old compound
 * (*remember quiz*) would find nothing, though the old word alone still finds
 * the mode through its alias (`MODE_CATALOG.learn.aliases`). GPT Sol, plan
 * review of 261005l, PR-2.
 *
 * Store compounds and not a bare alias. Prefix matching still lists the four
 * sub-modes for the bare old name, as it does for the current parent name, but
 * the mode's own exact alias stays first rather than tying four more exact
 * aliases.
 */
const FORMER_PARENT_NAMES: Partial<Record<Mode, readonly string[]>> = {
  /* Learn was Remember until 2026-10-05 (Greg, spya-mvmpks). The key is the
     mode id, which followed on 2026-10-06; the value is the old word. */
  learn: ["Remember"],
};

export function commandText(command: Command): CommandText {
  if (command.kind === "submode") {
    const words = subModeWords(command.sub);
    /* The parent's name is a nickname, so typing `diagram` lists the pictures
       under the Diagram row — the mode's own row still wins, on its label. And
       the compound names a reader would say aloud — *Illustrated diagram*,
       *Remember quiz*, *Quiz mode*, Greg's own two — because the ranking
       compares the whole query against one word list at a time, so without
       them `illustrated diagram` matched nothing. GPT Sol, plan review. */
    const parent = MODE_LABEL[command.sub.mode];
    return {
      label: words.label,
      aliases: [
        parent,
        `${words.label} ${parent}`,
        `${parent} ${words.label}`,
        `${words.label} mode`,
        ...(FORMER_PARENT_NAMES[command.sub.mode] ?? []).flatMap((former) => [
          `${words.label} ${former}`,
          `${former} ${words.label}`,
        ]),
        /* The sub-mode's own nicknames — Summary's Thread answers to `tweets`
           (sub-modes.ts § `SubModeWords`). Here and not on the parent's catalog
           row, so the word selects this row and not the mode's. */
        ...(words.aliases ?? []),
      ],
      description: words.description,
    };
  }
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
    case "submode":
      return `submode:${command.sub.mode}:${command.sub.view}`;
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
 * **A row's key, as the browser sends it and the server holds it** — its id
 * and its label, since Archive and *Put back* share an id (plan 261003k, F5).
 *
 * **The id is `commandId` with everything about *this* visit taken out of a
 * page's address**, so one list on the server serves every article and every
 * place in it: the slug becomes `PICK_SLUG`, and the query string and the
 * fragment go. `page:/read/my-paper/metadata?at=spya-k3m9qt` and the Help row's
 * `page:/help#glossary` are sent as `page:/read/:slug/metadata` and
 * `page:/help`. Nothing else in an id varies by article.
 *
 * A key is for matching, never for acting: what runs is the row the bar holds
 * today, found again by this function (CommandBar.tsx).
 */
export function pickKey(command: Command, slug?: string): PickKey {
  const { label } = commandText(command);
  if (command.kind !== "page") return { id: commandId(command), label };
  const path = command.href.split(/[?#]/, 1)[0] ?? "";
  const own = slug === undefined ? null : `/read/${encodeURIComponent(slug)}`;
  const shared =
    own !== null && (path === own || path.startsWith(`${own}/`)) ? `/read/${PICK_SLUG}${path.slice(own.length)}` : path;
  return { id: `page:${shared}`, label };
}

/**
 * **One row as a model is shown it**: its key, and the three kinds of words
 * the bar itself matches on. Nothing a row *does* — no closure, no href beyond
 * what the id already holds — so it serialises.
 *
 * These are what src/command-pick-catalogue.generated.json holds, and the
 * model's answer is only ever one of the ids (plan 261003k, decision 2). The
 * eval that chose the model reads the same list: evals/command-pick/README.md.
 */
export type { PickOption };

export function pickOption(command: Command, slug?: string): PickOption {
  const { description, aliases } = commandText(command);
  return { ...pickKey(command, slug), description, aliases: [...aliases] };
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

/** A sub-mode, as a command — `modeCommand`'s twin, for the same reason. */
export function subModeCommand(sub: SubMode): Command {
  return { kind: "submode", sub };
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
 * Dock is offering followed by everything else, which is what makes "the bar's
 * mode rows are exactly what the Dock offers" true by construction rather than
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
  /* Everything but the rows that wait to be asked for — `typedOnly`. */
  if (wanted === "") return commands.filter((command) => !isTypedOnly(command));

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

/** Whether a row waits for a query — `CommandWords.typedOnly`. Modes never do. */
function isTypedOnly(command: Command): boolean {
  return command.kind === "page" || command.kind === "action" ? command.typedOnly === true : false;
}

/**
 * **What a typed query can ask for with an argument** — the bar's rows whose
 * text comes from the query rather than from a list. Since 2026-10-03 (plan
 * 261003f, Stage 1); `find` was the only one from 2026-10-02.
 *
 * A parse, not a resolution: `glossary` says *look these words up*, and which
 * term they name — or whether an ask is offered at all — is
 * command-proposal.ts § `resolveArgument`'s, against the glossary the reader
 * can see.
 */
export type ArgumentQuery =
  | { readonly kind: "find"; readonly words: string }
  | { readonly kind: "jump-first"; readonly words: string }
  | { readonly kind: "glossary"; readonly words: string }
  | { readonly kind: "tag-add"; readonly words: string }
  | { readonly kind: "tag-remove"; readonly words: string };

/* The kinds here and the kinds a sentence can be answered with
   (src/command-pick.ts § `ARGUMENT_KINDS`) are one list written twice, because
   that module cannot import this one (the eval imports it, and this reaches a
   `.tsx`). Either of these two lines fails to compile if they part. */
const _everyKindIsPicked: ArgumentKind = "find" as ArgumentQuery["kind"];
const _everyPickIsAKind: ArgumentQuery["kind"] = "find" as ArgumentKind;
void _everyKindIsPicked;
void _everyPickIsAKind;

/**
 * **One verb phrase, and the command it starts.** `endings` are phrases that
 * may close the query and are not part of the argument — *to this paper* —
 * and `needsEnding` makes the ending the other half of the verb, as `mean` is
 * of *what does … mean*.
 */
interface Verb {
  readonly kind: ArgumentQuery["kind"];
  readonly verb: string;
  readonly endings?: readonly string[];
  readonly needsEnding?: true;
  /** Arguments, lower-case, that make this a phrase the bar already names. */
  readonly except?: readonly string[];
}

const TO_THIS = ["to this paper", "to this article", "to this piece", "to this"] as const;
const FROM_THIS = ["from this paper", "from this article", "from this piece", "from this"] as const;

/**
 * **The verb table — every argument the bar takes, by the words that ask for
 * it.** Lower-case, matched whatever the reader's case and as a whole word;
 * where one verb starts another the longer wins, so `search for X` is a search
 * for X and not for `for X`, and `tag this as X` tags X.
 *
 * Greg's examples (spya-wh2xys, qi-qkjnkwce): *"do a search for X"*, *"look up
 * some word in the glossary"*, *"jump to the first place where X"*, *"add a
 * tag of X to this paper"*. The five `find` verbs are the 2026-10-02 set,
 * unchanged — *"do they talk about X?"* was SPIDERYARN-READING2-8D.
 *
 * **What is deliberately not a verb**, each held by the collision matrix in
 * tests/command-match-arguments.test.ts:
 *
 *  - `take me to`, `go to` and a bare `jump to` — how a reader names a mode or
 *    a page, so *take me to glossary* stays the Glossary row rather than
 *    becoming a search for the word (GPT Sol's F7 on plan 261003f). The jump
 *    verbs say *first*, explicitly.
 *  - `jump to the first` — *jump to the first section* names a place.
 *  - **a bare `glossary X`**, which the plan listed and the matrix refused:
 *    *glossary again* is a *Run again* phrasing (rerun-commands.ts) and
 *    *Glossary › Run again* a row's own label, so either would have grown a
 *    paid *Look up “again”* row under the one the reader meant. `look up`,
 *    `define` and *what does … mean* ask the same without the clash.
 *  - **`define again`**, for the same reason one step on: `define` is one of
 *    Glossary's nicknames (mode-catalog.ts), so *define again* is a *Run
 *    again* phrasing too. The verb stays and that one argument is excepted.
 *    **`define find more`** likewise, since 2026-10-04: a *Glossary › Find
 *    more* phrasing (find-more.ts).
 *
 * **And one collision is declared rather than avoided**: `find more` and
 * `find more terms` are *Find more* rows' own words and also a `find` with
 * words after it. The verb is not narrowed — a reader may be searching for the
 * word *more* — so the bar draws the row and then the *Find “more …”* row
 * under it. The matrix names those two rows as its exception.
 */
const VERBS: readonly Verb[] = [
  { kind: "find", verb: "do they talk about" },
  { kind: "find", verb: "does it mention" },
  { kind: "find", verb: "search for" },
  { kind: "find", verb: "search" },
  { kind: "find", verb: "find" },
  /* *find mentions of dopamine* is a search for dopamine: without these the
     shorter `find` took it and looked for `mentions of dopamine`, which no
     article says (found by the command-pick eval, 261003e). */
  { kind: "find", verb: "find mentions of" },
  { kind: "find", verb: "find all mentions of" },
  { kind: "find", verb: "find every mention of" },
  { kind: "find", verb: "find references to" },
  { kind: "jump-first", verb: "jump to first" },
  { kind: "jump-first", verb: "first occurrence of" },
  { kind: "jump-first", verb: "first mention of" },
  { kind: "jump-first", verb: "where does it first say" },
  { kind: "jump-first", verb: "where does it first mention" },
  { kind: "glossary", verb: "look up", endings: ["in the glossary"] },
  { kind: "glossary", verb: "define", except: ["again", "find more"] },
  { kind: "glossary", verb: "what does", endings: ["mean"], needsEnding: true },
  { kind: "glossary", verb: "what is meant by" },
  { kind: "tag-add", verb: "add a tag of", endings: TO_THIS },
  { kind: "tag-add", verb: "add the tag", endings: TO_THIS },
  { kind: "tag-add", verb: "add tag", endings: TO_THIS },
  { kind: "tag-add", verb: "tag this as" },
  { kind: "tag-add", verb: "tag this" },
  { kind: "tag-add", verb: "tag as" },
  { kind: "tag-add", verb: "tag" },
  { kind: "tag-remove", verb: "remove the tag", endings: FROM_THIS },
  { kind: "tag-remove", verb: "remove tag", endings: FROM_THIS },
  { kind: "tag-remove", verb: "untag", endings: FROM_THIS },
];

/** Longest first, so a verb that starts another never takes its query. */
const LONGEST_FIRST: readonly Verb[] = [...VERBS].sort((a, b) => b.verb.length - a.verb.length);

/** Where a kind's first verb sits in the table — the order rows come back in. */
const kindOrder = (kind: ArgumentQuery["kind"]): number => VERBS.findIndex((v) => v.kind === kind);

/**
 * **The argument commands a query could be** — at most one per kind, in the
 * table's order, and for almost every query none.
 *
 * It is a parse and not a ranking: a query is one **only** when it starts with
 * a verb and has words after it, so *No command matches.* stays the answer to
 * a query that names nothing. That is Greg's call 3 on the bar (CommandBar.tsx
 * § the four product calls) — an honest empty state over a guessed fallback —
 * and it still holds, because here the reader typed the verb.
 *
 * The verb must be a whole word, so `findings` is not `find ings` and `tags`
 * is not `tag s`. The words keep the reader's spelling, minus a trailing `?`,
 * the verb's ending if it has one, and one pair of quotes round them (straight
 * or curly), with runs of space collapsed — a stray quote would otherwise be
 * looked for too.
 */
export function parseArgumentQuery(query: string): readonly ArgumentQuery[] {
  const text = query.trim().replace(/\s+/g, " ").replace(/\?+$/, "").trim();
  const lower = text.toLowerCase();
  /* Half-way through typing a longer verb, `search for` is not a search for
     *for*: a row flickering past with that in it is a row about nothing. */
  if (VERBS.some((v) => v.verb === lower)) return [];
  const found: ArgumentQuery[] = [];
  for (const entry of LONGEST_FIRST) {
    if (found.some((q) => q.kind === entry.kind)) continue;
    if (!lower.startsWith(`${entry.verb} `)) continue;
    const words = argumentOf(text.slice(entry.verb.length).trim(), entry);
    if (words !== null) found.push({ kind: entry.kind, words });
  }
  return found.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
}

/** What follows a verb, as the argument — or `null` when there is none. */
function argumentOf(rest: string, entry: Verb): string | null {
  let words = rest;
  const lower = rest.toLowerCase();
  const ending = entry.endings?.find((e) => lower === e || lower.endsWith(` ${e}`));
  if (ending !== undefined) words = words.slice(0, words.length - ending.length).trim();
  else if (entry.needsEnding) return null;
  if (entry.except?.includes(words.toLowerCase())) return null;
  words = words
    /* A function rather than the `"$1"` pattern, which
       tests/no-ai-cost-for-readers.test.ts reads — rightly, from where it
       stands — as a price in reader copy. */
    .replace(/^["'“‘](.*)["'”’]$/, (_, inner: string) => inner)
    .trim();
  return words === "" ? null : words;
}

/**
 * **The words a `find …` query asks for, or `null` when it is not one** — the
 * `find` entry of `parseArgumentQuery`, kept by name because it was the bar's
 * first argument (2026-10-02) and its tests state every edge of the cleaning
 * all the verbs now share (tests/command-match-rerun-and-find.test.ts). What
 * it returns is matched in the article as one literal phrase (search-hits.ts §
 * `findLiteral`).
 */
export function parseFindQuery(query: string): string | null {
  const find = parseArgumentQuery(query).find((q) => q.kind === "find");
  return find === undefined ? null : find.words;
}
