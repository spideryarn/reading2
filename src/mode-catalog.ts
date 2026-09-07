/**
 * **What each mode *is*, in a module that only knows the vocabulary.**
 *
 * Three facts per mode and nothing else: the sentence a reader is shown about
 * it, the words they might type meaning it, and whether it is finished enough
 * to draw for everybody. All three are facts about the **mode**; none of them
 * is a fact about the bottom bar, which is where two of them lived until now.
 *
 * ## Why it exists
 *
 * `description` and `experimental` were fields on the `MODES_UI` rows in
 * src/web/Dock.tsx — a 2,300-line React component. That was the right home
 * while the Dock was the only thing that asked. A **second reader** is now
 * arriving (the command bar, docs/plans/260906h-mode-catalog-and-a-command-bar.md),
 * and the moment a fact has two readers on two sides of a seam, the file that
 * holds it has to be one both can reach. A component that imports React,
 * `lucide-react`, the router and eleven client hooks is not that file.
 *
 * `aliases` is new and has nowhere else it could go. `toc` for Hierarchy,
 * `define` for Glossary — they are not layout, not policy, and not a label.
 * Adding them as a fifth field on a Dock row is exactly how `MODES_UI` became
 * the place everything about a mode ended up.
 *
 * ## Why it imports only `./modes.js`
 *
 * So that both runtimes can read it. The serverless function that composes a
 * shared article's `<title>` may not reach anything under `src/web/`
 * (tests/public-imports.test.ts), and the browser must not drag a server
 * module into its bundle (tests/client-imports.test.ts, which lists this file
 * among the shared leaves and **checks** the claim rather than trusting it).
 * `modes.ts` imports nothing at all for the same reason, and this file sits one
 * step above it.
 *
 * The arrow points this way round on purpose. `Mode` is **not** derived from
 * this record's keys, tempting as that is: deriving it would give every
 * consumer of the word `Mode` — the server included — a transitive dependency
 * on fourteen paragraphs of product copy, and would invert the dependency that
 * makes `modes.ts` safe to import from anywhere. `Record<Mode, …>` is the same
 * totality guarantee with `modes.ts` still owning the vocabulary.
 *
 * ## What deliberately did NOT move here
 *
 * Saying why is most of the value of this docblock, because each of these
 * looks like a duplicate until you ask what question it answers.
 *
 *  - **`label` stays in `MODE_LABEL`** (src/title-text.ts). It is already a
 *    total, single-home record that the tab title, the bar and the
 *    shared-inventory dialog all read, and that file is already
 *    browser-and-server safe. Moving it buys nothing and touches many files.
 *  - **`icon` stays in `MODES_UI`.** It is a `lucide-react` component, and
 *    putting it in a module the server imports drags React straight across the
 *    seam this file exists to keep clean.
 *  - **`keepLabel` stays in `MODES_UI`.** A fit-ladder fact about the bar
 *    (src/web/dock-fit.ts), and nothing else will ever read it.
 *  - **`POLICY` (src/web/visitor.ts) and `MODE_TARGET` (src/web/activation.ts)
 *    stay exactly where they are.** They are per-layer policy adapters, not
 *    copies of anything here: *what a visitor may see* and *whether pressing
 *    this spends money* are different questions that happen to be keyed by the
 *    same word. `MODE_TARGET` was made total over a tagged union on
 *    2026-09-06; folding it into a catalog would undo that in the same week.
 *
 * `MODES_UI` also keeps its order and its array-ness. The order is Greg's,
 * hand-maintained, and `ModesMissingFromDock` keeps it exhaustive.
 *
 * See docs/plans/260906h-mode-catalog-and-a-command-bar.md § The catalog, and
 * docs/project/new-mode.md for the checklist a fifteenth mode has to satisfy.
 */
import type { Mode } from "./modes.js";

/** What one mode is, to anything that offers it to a reader. */
export interface ModeCatalogEntry {
  /**
   * **One sentence about what this mode gives you**, in the reader's words.
   *
   * The Dock draws it in the tooltip under the button; the command bar will
   * draw it inline beside the name when it lands (stage 2 of 260906h). The
   * **name** is not here — it is `MODE_LABEL[mode]`
   * in src/title-text.ts, a total record the tab title already reads, so
   * renaming a mode stays one edit and cannot leave the bar and the tab saying
   * different words.
   *
   * No trailing full stop. These are fragments in furniture rather than
   * sentences in prose, and all fourteen were written that way; the test in
   * tests/mode-catalog.test.ts holds the convention so the fifteenth matches
   * the fourteen it will sit beside.
   *
   * A blurb is sometimes doing more work than it looks. `remember`'s ends
   * *"not saved notes or flashcards"* because the mode's **name** promises two
   * things it does not do, and that denial is the named cost of the 2026-09-01
   * rename — if the line is ever shortened, the denial is the part to keep.
   * `debate`'s names the empty case because most pieces have no reception at
   * all, and a mode that is empty four times in five reads as broken unless the
   * button said so first.
   */
  description: string;
  /**
   * **Other words a reader might type meaning this mode.**
   *
   * Destination synonyms, and deliberately **sparse**: two to four each, and an
   * empty list where nothing natural exists. This is not a keyword-stuffing
   * field. Every alias widens what the command bar's matcher will accept, and
   * the cost of a loose one is not a missed match — it is the *wrong* mode
   * ranked first for somebody who typed the right thing.
   *
   * Three rules, all of them checked in tests/mode-catalog.test.ts because
   * none of them is visible at the point somebody adds a word:
   *
   *  1. **Unique across every mode.** Two modes claiming `terms` makes the bar
   *     ambiguous, and an ambiguous bar is worse than a bare one.
   *  2. **Never another mode's label.** Typing `search` must open Search and
   *     not something that borrowed the word.
   *  3. **Stored already-canonical** — lowercase, trimmed, and internal runs of
   *     whitespace collapsed to one space. The matcher normalises what the
   *     reader types before comparing; an alias with a capital or a stray space
   *     would sit in this table looking correct and never match anything. The
   *     collapse is the part that is easy to forget, and forgetting it lets
   *     `"peer review"` and `"peer  review"` pass a uniqueness check on raw text
   *     and then collide the moment anybody types either (GPT Sol, 2026-09-07).
   *
   * They name a **destination**, never an action. `summarise` is fine, because
   * opening Summary is what produces one. A phrase like *"jump to where it
   * says…"* is not: v1 has exactly one verb, *open a mode*, and an alias that
   * promises more is a promise the bar cannot keep.
   *
   * A word this repo once rejected as a **mode name** is often the right alias
   * for the mode that took its place. `reception` and `critiques` were refused
   * for `debate` because each presumes something false about the piece — but
   * they are the words a reader reaches for, and reaching for them should land
   * them somewhere. Likewise `review` and `reviewer`, which `referee` was named
   * around (src/modes.ts § referee): the word is free, it is what a person
   * would type, and it belongs to the peer-review mode.
   */
  aliases: readonly string[];
  /**
   * **Is this mode still being built?** If so it is drawn only for a reader who
   * turned the experimental-features switch on — or who is in it right now.
   * docs/project/experimental-features.md is the operating manual, and
   * `visibleModes` in src/web/Dock.tsx is the rule.
   *
   * **Required on every row, and not an optional flag on five.** The
   * `Record<Mode, …>` proves each mode has an entry; only a required field
   * proves each entry *made the decision*, and docs/project/new-mode.md says
   * the author must make it. An optional flag would quietly enrol mode fifteen
   * among the polished ones. (GPT Sol, finding 8, written when this field lived
   * on a `MODES_UI` row; the argument is about the field and moved with it.)
   *
   * **Which modes are on which side is not written down here**, and moving one
   * is this boolean and nothing else in this file. The membership and the
   * reason for each is docs/project/experimental-features.md; the independent
   * copy that stops a flag moving unnoticed is
   * tests/dock-experimental-modes.test.tsx § `BEHIND_THE_SWITCH`, which is
   * hand-written on purpose and must never be derived from this record.
   */
  experimental: boolean;
}

/**
 * **Every mode, and what it is.**
 *
 * Total over `Mode` and checked by the compiler, so a fifteenth word in
 * `MODES` is red here until somebody has written its sentence, chosen its
 * aliases and decided which side of the experimental switch it is on.
 *
 * In `MODES` order rather than the bar's, because this file knows the
 * vocabulary and not the layout — the bar's order is Greg's and lives in
 * `MODES_UI` (src/web/Dock.tsx), which is where a reordering belongs.
 *
 * The fourteen descriptions and the fourteen booleans arrived here verbatim
 * from `MODES_UI` on 2026-09-07. Not one word was changed in the move: a
 * wording change hidden inside a move is a wording change nobody reviewed.
 */
export const MODE_CATALOG: Record<Mode, ModeCatalogEntry> = {
  plain: {
    description: "Just the article — no columns, no panel",
    /* The way *out* of a mode, so the words are the ones somebody reaches for
       when they want the piece and nothing else. `article` first because that
       is what they are asking for; the mode's own name is a description of
       what is missing rather than of what they get. */
    aliases: ["article", "text", "reading"],
    experimental: false,
  },
  hierarchy: {
    description: "The article's own shape, one column per level of detail",
    /* `toc` was this mode's name until 2026-08-29 and is still what most people
       call the thing, so it is the alias that will be typed most. It is also
       the pipeline step that builds the tree (src/step-order.ts), which is a
       collision the rename resolved in the *step's* favour — harmless here,
       since nothing a reader types addresses a step. */
    aliases: ["toc", "contents", "structure"],
    experimental: false,
  },
  chat: {
    description: "Ask about this article — answers point back at the paragraphs they came from",
    aliases: ["ask", "question"],
    experimental: false,
  },
  glossary: {
    description: "The terms this piece uses in a non-obvious way, defined from the piece itself",
    aliases: ["define", "terms", "definitions"],
    experimental: false,
  },
  search: {
    description: "Find a passage by the words it uses, or by what it says",
    /* `highlight` because highlighting is what search *does to the page* rather
       than a separate thing to press — the two dimmed placeholders this mode
       was built out of are one mode now, and the word should still land.
       docs/project/search.md. */
    aliases: ["find", "highlight"],
    experimental: false,
  },
  referee: {
    description:
      "Reviewing this for somebody? Your criteria, its claims, and a second look at your own notes",
    /* The three words this mode was deliberately *not* named, and they are free
       to point here: `review` was vacated by the `review` → `remember` rename,
       and `reviewer` was passed over only because it would have sat beside it.
       `referee` is what journals call the person; `review` is what everyone
       else calls the job. src/modes.ts § referee has the whole argument. */
    aliases: ["review", "reviewer", "peer review"],
    experimental: true,
  },
  summary: {
    description:
      "The article, its parts and its sections, a sentence on each — as deep into the piece as you ask",
    /* Both spellings, because the reader's keyboard is not ours to choose. */
    aliases: ["summarise", "summarize", "gist"],
    experimental: false,
  },
  diagram: {
    description: "The article's shape as a picture: a model reads the argument and draws it",
    /* `sketch` is the artefact a press actually draws, and it is the word the
       empty state and the pipeline both use, so a reader who has seen the mode
       once will type it. */
    aliases: ["sketch", "picture", "visual"],
    experimental: false,
  },
  ideas: {
    description:
      "The propositions this piece needs you to hold — the ones it assumes, and the ones it adds",
    /* **Not `claims`**, which was the first draft and which GPT Sol caught on
       2026-09-07: Referee has a built sub-mode labelled exactly "Claims", so
       the commonest word for a proposition is already spoken for by a different
       mode's control. A textual uniqueness test cannot see that — the collision
       is with a label inside another mode, not with an alias — so it is a thing
       a person has to notice. `premises` is the unoverloaded word. */
    aliases: ["premises", "propositions", "assumptions"],
    experimental: false,
  },
  remember: {
    description:
      "Say what you took from this and find out where it holds up — not saved notes or flashcards",
    /* `recall` is this mode's own default sub-mode, so the word lands where the
       reader expects.

       **`quiz` is deliberately absent**, and it is the clearest example of the
       rule these aliases follow. Quiz is Remember's *other* sub-mode, and
       opening the mode lands on Recall (`params.ts`); a command bar that opens
       a mode exactly as its Dock button does cannot carry the reader to a
       sub-mode, so `quiz` would name a destination and then not go there. It
       comes back when a command can encode `{ mode: "remember", remember:
       "quiz" }`, and not before. GPT Sol found this, 2026-09-07. */
    aliases: ["recall"],
    experimental: true,
  },
  outline: {
    description:
      "The whole document in one list, with more detail on the part you are reading and less on the rest",
    aliases: ["tree", "map"],
    experimental: false,
  },
  quotes: {
    description: "The lines worth keeping — the piece's own sentences, chosen and checked against it",
    aliases: ["quotations", "excerpts"],
    experimental: false,
  },
  timeline: {
    description: "When the piece says these things happened, in order — and how sure it actually is",
    aliases: ["chronology", "dates", "events"],
    experimental: true,
  },
  debate: {
    description:
      "What the rest of the web says about this piece — often nobody has written anything, and it says so",
    /* The two names refused for the mode and the one refused on the code, all
       three pointing here rather than nowhere. `reception` presumes the piece
       was noticed and `critiques` presumes the response was hostile — false
       promises in a *name*, which a reader reads before pressing, and harmless
       in an *alias*, which they only meet by having typed it themselves.
       `responses` was refused because `Response` means four things in `src/`;
       that objection is about code and does not reach a reader's keyboard.
       src/modes.ts § debate. */
    aliases: ["critiques", "reception", "responses"],
    experimental: true,
  },
};
