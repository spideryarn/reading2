/**
 * **What each mode *is*, in a module that only knows the vocabulary.**
 *
 * Four facts per mode and nothing else: the sentence a reader is shown about
 * it, the half of that sentence they could not have guessed, the words they
 * might type meaning it, and whether it is finished enough to draw for
 * everybody. All four are facts about the **mode**; none of them is a fact
 * about the bottom bar, which is where two of them lived until now.
 *
 * `how` is the fourth and arrived on 2026-09-07, a few hours after the file
 * did (docs/plans/260907b-rich-tooltips-on-the-dock-modes.md). It belongs
 * beside `description` for the reason the pair exists at all: the two halves of
 * one card are one decision, and a `Record<Mode, …>` that asks for both is the
 * only mechanism here that has reliably kept a per-mode table from drifting.
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
   * **The half a reader could not have guessed by pressing the button.**
   *
   * `description` is what they would have worked out in the second after
   * pressing; this is where the answer comes from, whether pressing it starts
   * work, and what the mode does *not* promise. It is the second paragraph of
   * the `ControlTip` on the bar button (src/web/Dock.tsx), and it is the whole
   * reason the card is worth a hover — the rule, and the failure modes, are
   * docs/project/tooltips.md § `ControlTip`.
   *
   * Three things it must not do, and the first is the one that cost this field
   * a whole review round.
   *
   *  - **Describe a gesture rather than the mode.** Every sentence here is
   *    read on **four** surfaces at least: the bar button on the reading view,
   *    the loose link in the same bar on the metadata and tweets pages, and
   *    either of those seen by a **visitor** rather than the owner. Those
   *    surfaces do not behave alike — the loose link only navigates and arms
   *    nothing (`DockModeLinks` in src/web/Dock.tsx), and a visitor with no
   *    artefact opens an explanatory band rather than a generator — so a
   *    sentence beginning *"Opening it runs…"* is false on three of the four.
   *    Four of the fourteen said exactly that in first draft and GPT Sol caught
   *    all four (2026-09-07). Write about the **artefact and where it comes
   *    from** — *"one model pass over the article, written once and then
   *    stored"* — which is true wherever the card is read and is also what
   *    makes `how` an intrinsic fact about the mode, and so a legitimate
   *    tenant of this file rather than a Dock string parked in it.
   *  - **Restate `description`.** A second paragraph that says the first one
   *    again is worse than no card, because the reader has paid 300ms to learn
   *    nothing. tests/dock-mode-tooltips.test.tsx catches a copy and cannot
   *    catch a paraphrase, so the paraphrase is on the author.
   *  - **Name a price.** Six of the fourteen presses can start a metered call
   *    (`MODE_TARGET`, src/web/activation.ts), and the figure stays out of the
   *    bar. The command bar marks a generating row with the single muted word
   *    `generates` and no number, because a bar with a price on it would be
   *    *more* disclosed than the button beside it
   *    (docs/project/reading-view-overview.md § The command bar) — and a
   *    tooltip on the button itself is the same surface. Say what the work is
   *    and roughly how long it takes; leave the number to the empty state that
   *    already carries it, which is Diagram's and only Diagram's.
   *
   * **Every factual claim here was read out of the source before it was
   * written**, and that is not a formality: four of the nine cards on the
   * shelf's action row were false in first draft, and the restatement check
   * cannot see a card that is arguing with the code rather than with itself
   * (docs/plans/260905h-rich-tooltips-on-the-shelf-action-buttons.md). The
   * table in docs/plans/260907b-rich-tooltips-on-the-dock-modes.md says where
   * each of the fourteen was checked, including the two drafts thrown away for
   * being plausible and wrong.
   *
   * Full sentences with full stops, unlike `description` — this is prose the
   * reader reads, where that is a fragment in furniture.
   */
  how: string;
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
 * `MODES` is red here until somebody has written **both** its sentences, chosen
 * its aliases and decided which side of the experimental switch it is on.
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
    how: "Nothing here is generated — this is the same text every other mode annotates, with the middle band and the gist columns closed. It is also the way out of a mode: choosing it shuts whatever was open.",
    /* The way *out* of a mode, so the words are the ones somebody reaches for
       when they want the piece and nothing else. `article` first because that
       is what they are asking for; the mode's own name is a description of
       what is missing rather than of what they get. */
    aliases: ["article", "text", "reading"],
    experimental: false,
  },
  hierarchy: {
    description: "The article's own shape, one column per level of detail",
    how: "The columns are the tree the pipeline wrote before you opened the article, so there is nothing to generate and nothing to wait for. It is the same tree Structure and Summary read — three views of one structure rather than three passes over the piece.",
    /* `toc` was this mode's name until 2026-08-29 and is still what most people
       call the thing, so it is the alias that will be typed most. It is also
       the pipeline step that builds the tree (src/step-order.ts), which is a
       collision the rename resolved in the *step's* favour — harmless here,
       since nothing a reader types addresses a step. */
    /* **`structure` came out of this list on 2026-09-07**, the day Structure
       became a mode of its own. `label-prefix` outranks `alias-prefix`
       (src/web/command-match.ts § TIERS), so leaving it would not have ranked
       Hierarchy above Structure for somebody typing the word — but it would
       have put Hierarchy in the list underneath, telling a reader that the two
       adjacent buttons are two names for one thing. An alias that is another
       mode's actual name is the loose alias this table refuses. */
    aliases: ["toc", "contents"],
    experimental: false,
  },
  chat: {
    description: "Ask about this article — answers point back at the paragraphs they came from",
    how: "Nothing runs until you ask. It can reach past the article when it needs to — the open web, your other saved articles, a page this one links to — and where an answer used one of those, a strip above it says so.",
    aliases: ["ask", "question"],
    experimental: false,
  },
  glossary: {
    description: "The terms this piece uses in a non-obvious way, defined from the piece itself",
    how: "The list is one model pass over the whole article, written once and then stored, so it is instant every time after the first. Terms are defined from this piece rather than from a dictionary, and once they exist they are underlined in the prose in every mode, not only this one.",
    aliases: ["define", "terms", "definitions"],
    experimental: false,
  },
  search: {
    description: "Find a passage by the words it uses, or by what it says",
    how: "Two matchers behind one box, and they cost differently: words matches against the text already in front of you, while meaning sends the query to a model and finds passages that say what you asked for without using your words.",
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
    /* **"No model call" and not "nothing"**, which was the draft: the mode does
       start a source scan on mount, so the flat claim was false — GPT Sol,
       2026-09-07. And "the one it opens on" rather than naming Criteria,
       because `?referee=` is persistent query state that survives leaving the
       mode (params.ts), so which sub-mode it opens on is not invariant. */
    how: "This button starts no model call: the sub-modes inside arm themselves, and the one it opens on has nothing to run until you have written a criterion. It never returns a verdict — no accept or reject, no score, no grade. That judgement is yours, and the mode refuses to make it for you.",
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
    how: "The sentences are the tree's own, written when the article was ingested, so nothing here is generated on demand. There is one axis and no length control — a shorter summary of the same thing is a different level of the tree, not a second request.",
    /* Both spellings, because the reader's keyboard is not ours to choose. */
    aliases: ["summarise", "summarize", "gist"],
    experimental: false,
  },
  diagram: {
    description: "The article's shape as a picture: a model reads the argument and draws it",
    /* **No superlative here, and that is measured rather than modest.** The
       first draft said this was the longest wait any button in the bar starts;
       the Sketch takes 121–194 s (docs/project/diagram.md) and Debate's spike
       run took 146.7 s (docs/plans/260905f-debate-mode-stage-0-spike-results.md
       § the completed run), so the two are the same size and the claim was one
       measurement away from being false. */
    how: "The Sketch — the picture you get unless you ask for another — is a model reading the argument and drawing it, which is minutes of work the first time and stored afterwards. Its empty state names what that costs before anything runs.",
    /* `sketch` is the artefact a press actually draws, and it is the word the
       empty state and the pipeline both use, so a reader who has seen the mode
       once will type it. */
    aliases: ["sketch", "picture", "visual"],
    experimental: false,
  },
  ideas: {
    description:
      "The propositions this piece needs you to hold — the ones it assumes, and the ones it adds",
    how: "One model pass over the article, written once and then stored. The split between what you have to bring and what the piece adds is the model's reading rather than something the article marks, and each idea carries the passages it was drawn from, where they can still be found.",
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
    how: "Its Recall half waits on you: nothing runs until you have said or typed what you took from the piece. Four stances change how hard it pushes back, from plain corrections to questions that hand the finding back to you.",
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
  quotes: {
    description: "The lines worth keeping — the piece's own sentences, chosen and checked against it",
    how: "The model only locates a line; the words you read are sliced out of the article itself, so nothing here is the model's typing. What that proves is that the sentence is in the piece, not who wrote it — a quotation the article left unmarked cannot be told from its own prose.",
    aliases: ["quotations", "excerpts"],
    experimental: false,
  },
  timeline: {
    description: "When the piece says these things happened, in order — and how sure it actually is",
    how: "One model pass over the article, written once and then stored. Anything the piece never dated stays undated rather than being guessed at, and the order is the model's reading of the piece rather than a sort by date.",
    aliases: ["chronology", "dates", "events"],
    experimental: true,
  },
  debate: {
    description:
      "What the rest of the web says about this piece — often nobody has written anything, and it says so",
    /* **Three drafts of this sentence were wrong, all in the same direction:
       claiming more about provenance than the mode can.** "Written by somebody
       other than this article's author" is false — the author's own later
       correction is one of the most useful rows here, and that is half of why
       `reception` and `critiques` were refused as *names* (src/modes.ts §
       debate). "Nothing here came out of the article itself" is false too: a
       claim row prints the article's own `claimQuote` beside the response
       (DebatePanel.tsx). And "two searches" undercounts — they are two metered
       *passes*, one of which has run 36 searches on its own (src/debate.ts).
       GPT Sol, 2026-09-07. */
    how: "What it finds comes from two passes over the open web rather than from the article, and is stored once it lands. Every row links out, so you can check a source rather than take our word for it.",
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
  citations: {
    description: "The works this piece cites, each with a link — ranked by how much the piece leans on them",
    /* **Checked against the source, claim by claim** (docs/project/new-mode.md §
       The card on the button):
       - "one model pass … written once and then stored": the `citations` step,
         one messages-wire call over `articleWithIds`, written to the
         `citations` column (src/citations.ts, src/pipeline.ts § STEPS).
       - "every address … is one the article gave, found by code": `linkFor` in
         src/citations.ts derives DOI → arXiv → a title-matching anchor → a
         mention anchor from the article's own text and hrefs; a URL the model
         writes is counted in `CitationDrops.modelUrls` and never read.
       - "otherwise a Scholar search, marked as one": `linkFrom: "search"`,
         labelled on the row (CitationsPanel.tsx § Source).
       - "influence is the model's memory, not a count": `CitedWork.influence`
         in src/types.ts; no citation database is consulted (deferred in the
         plan).
       Stage 3's *Find it on the web* will make the second sentence need a
       clause; it is not built. docs/plans/260911g-citations-mode.md. */
    how: "One model pass over the article, written once and then stored. Every address shown for a work is one the article itself gave — a DOI, an arXiv id or its own link, found by code rather than typed by the model — and where it gave none the row offers a Scholar search, marked as a search. How influential a work is comes from the model's memory, not from a citation count.",
    /* `works cited` is two words on purpose: `canonical` collapses whitespace
       and lower-cases, so it is stored already in the form a reader types. */
    aliases: ["references", "bibliography", "sources", "works cited"],
    experimental: true,
  },
  structure: {
    /* **True of both faces**, since 2026-09-10: the two columns and the nested
       list each show every part and the sections of the one the reader is in.
       It said "in two linked columns" until then, which a narrow band's list
       would have contradicted. */
    description: "The document's shape — every part, and the sections of the one you are in",
    /* Checked against the code rather than written from the plan, which is the
       failure this field has already had twice (docs/project/new-mode.md § The
       card on the button). "Nothing to generate" is true: the tree arrives in
       the page's own payload and this mode reaches no artefact and makes no
       request. The rest is the one thing a press does not tell you — that what
       you get depends on the room, and how to read each — and the reading order
       of the columns is what a reader would otherwise have to infer from
       watching the right-hand one change at a boundary.
       StructureMode.tsx § `structureFace` is the switch. */
    how: "The same already-built tree as Hierarchy and Summary, so there is nothing to generate. With room, two columns read left to right — the right-hand one is always the inside of the row marked in the left; without it, one nested list that opens up around the part you are reading.",
    /* `columns` is about the wide face. `tree`, `map` and `outline` came from
       Outline on 2026-09-10 with its list: `outline` so the retired mode's own
       name still finds the mode that holds it, the other two because they were
       Outline's nicknames and Outline is now this. None of them is Hierarchy's
       (`contents`, `toc`), which is the loose alias this table refuses. */
    aliases: ["columns", "outline", "tree", "map"],
    /* **Out of the switch since 2026-09-10.** It was behind it as an
       instrument — a third structural view for Greg to compare against the
       other two, kept off an ordinary reader's bar while the comparison ran.
       The comparison answered: Structure took Outline's place, and Outline was
       on every reader's bar, so keeping this hidden would have taken the list
       away from everybody without the switch.
       docs/plans/260910g-structure-mode-subsumes-outline.md. */
    experimental: false,
  },
};
