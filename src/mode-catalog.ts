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
 * `aliases` is new and has nowhere else it could go. `toc` for Structure,
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
 * docs/project/mode.md for the checklist a fifteenth mode has to satisfy.
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
   * A blurb is sometimes doing more work than it looks. `learn`'s ends
   * *"not saved notes or flashcards"* because the mode's **name** promises two
   * things it does not do, and that denial is the named cost of the 2026-09-01
   * rename — if the line is ever shortened, the denial is the part to keep.
   * `debate`'s named the empty case, because most pieces have no reception at
   * all and a mode that is empty four times in five reads as broken unless the
   * button said so first. Since 2026-10-09 Debate is Peer review's Reception,
   * which opens on Bibliography, so the button no longer promises the empty
   * case; Reception's own empty state says it.
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
   *    the loose link in the same bar on the metadata page, and
   *    either of those seen by a **visitor** rather than the owner. Those
   *    surfaces do not behave alike — the loose link only navigates and arms
   *    nothing (`DockModeLinks` in src/web/Dock.tsx), and a visitor with no
   *    artefact opens an explanatory band rather than a generator — so a
   *    sentence beginning *"Opening it runs…"* is false on three of the four.
   *    Four of the fourteen said exactly that in first draft and GPT Sol caught
   *    all four (2026-09-07). Write about the **artefact and where it comes
   *    from** — *"one model call over the article, written once and then
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
   * Destination synonyms, and **as many as a reader would naturally type**:
   * six to twelve a mode. Until 2026-10-04 this said *deliberately sparse, two to
   * four each*, and that stance is superseded:
   *
   * > In the command bar, add more aliases. So, for example, structure mode
   * > could have aliases for hierarchy, table of contents, TOC, headings, etc.
   * >
   * > — Greg, 2026-10-04 (report spya-uzkmn3)
   *
   * The matcher asks whether a nickname *contains* what was typed and never
   * the reverse (src/web/command-match.ts § `TIERS`), so `contents` did not
   * catch `table of contents`: a phrase a reader would type whole has to be
   * written out whole.
   *
   * What still limits a word is what the old stance was protecting. The cost
   * of a loose one is not a missed match — it is the *wrong* row ranked first
   * for somebody who typed the right thing. Seven rules, the first four checked
   * in tests/mode-catalog.test.ts and the rest in
   * tests/command-match-mode-aliases.test.ts, which types every word here into
   * the whole list the bar holds, because none of them is visible at the point
   * somebody adds a word:
   *
   *  1. **Unique across every mode.** Two modes claiming `terms` makes the bar
   *     ambiguous, and an ambiguous bar is worse than a bare one.
   *  2. **Never another row's label, unless both open the same place.** Typing
   *     `search` must open Search and not something that borrowed the word. The
   *     rows are the modes, their sub-modes, the pages and the actions.
   *     `recall`, `sketch` and `reception` are chips of the mode that lists
   *     them, so the chip's row comes first and lands where the mode would.
   *  3. **Stored already-canonical** — lowercase, trimmed, and internal runs of
   *     whitespace collapsed to one space. The matcher normalises what the
   *     reader types before comparing; an alias with a capital or a stray space
   *     would sit in this table looking correct and never match anything. The
   *     collapse is the part that is easy to forget, and forgetting it lets
   *     `"peer review"` and `"peer  review"` pass a uniqueness check on raw text
   *     and then collide the moment anybody types either (GPT Sol, 2026-09-07).
   *  4. **Not twice in one mode.**
   *  5. **Typed in full, it puts its own mode first.** The one that is easy to
   *     break: a word that *starts with* a nickname of a mode later in the bar
   *     takes that nickname from it. `questions and answers` on FAQ would put
   *     FAQ above Chat for `question`, and `highlights` on Quotes would put
   *     Quotes above Search for `highlight`; both were left out for that.
   *  6. **It does not take a word that is a page's or an action's own.**
   *     Comments answers to `notes`, Feedback to `help`. The modes come first
   *     in the list, so a mode nickname that starts with one of those wins it.
   *     Two older words already do, and the test names them rather than
   *     hiding them: `annotations` (Marginalia over Comments) and `sources`
   *     (Citations over Metadata's `source`).
   *  7. **It does not start with a verb the argument parser owns** — `find`,
   *     `search`, `look up`, `define`, `tag` and the rest of `VERBS` in
   *     src/web/command-match.ts — or the bar would also offer *Find “in
   *     page” in this article*. A bare verb is fine (`find`, `define`). The
   *     collision matrix in tests/command-match-arguments.test.ts runs the
   *     parser over every word here.
   *
   * **Eight modes lend these words to their *Run again* row** (`rerunNames`
   * in src/web/rerun-commands.ts): `rerun jargon` forces the glossary. So a
   * word on one of those modes must also be a fair name for the step.
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
   * them somewhere (Reception's row, since 2026-10-09). Likewise `review` and
   * `reviewer`, which `referee` was named around (src/modes.ts § referee): the
   * word is free, it is what a person would type, and it belongs to the mode
   * for somebody doing a peer review.
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
   * proves each entry *made the decision*, and docs/project/mode.md says
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
    how: "Nothing here is generated — this is the same text every other mode annotates, with the middle band closed. It is also the way out of a mode: choosing it shuts whatever was open.",
    /* The way *out* of a mode, so the words are the ones somebody reaches for
       when they want the piece and nothing else. `article` first because that
       is what they are asking for; the mode's own name is a description of
       what is missing rather than of what they get. */
    aliases: ["article", "text", "reading", "just the article", "prose", "original", "no mode", "no panel"],
    experimental: false,
  },
  chat: {
    description: "Ask about this article — answers point back at the paragraphs they came from",
    how: "Nothing runs until you ask. It can reach past the article when it needs to — the open web, your other saved articles, a page this one links to — and where an answer used one of those, a strip above it says so.",
    /* Not `ai`: *AI processing* is a row's own name (article-commands.ts).
       Not `discussion`, which belongs to neither this nor Reception: there it
       would take `discuss` from here, and here it is already found by it. */
    aliases: ["ask", "question", "talk", "discuss", "conversation", "assistant"],
    experimental: false,
  },
  glossary: {
    description: "The terms this piece uses in a non-obvious way, defined from the piece itself",
    how: "The list is one model call over the whole article, written once and then stored, so it is instant every time after the first. Terms are defined from this piece rather than from a dictionary, and once they exist they are underlined in the prose in every mode, not only this one.",
    /* Not `concepts`: a reader could as well mean Ideas, and `rerun concepts`
       would then force the wrong list. */
    aliases: [
      "define", "terms", "definitions", "vocabulary", "jargon", "dictionary", "key terms", "terminology",
      "lexicon",
    ],
    experimental: false,
  },
  search: {
    description: "Find a passage by the words it uses, or by what it says",
    how: "Two matchers behind one box, and they cost differently: words matches against the text already in front of you, while meaning sends the query to a model and finds passages that say what you asked for without using your words. Meaning searches are saved, so you can switch several on together and come back to them.",
    /* `highlight` because highlighting is what search *does to the page* rather
       than a separate thing to press — the two dimmed placeholders this mode
       was built out of are one mode now, and the word should still land.
       docs/project/search.md.

       Nothing longer may start with `find` or `search`: those are the argument
       parser's verbs, so `find in page` would be read as a search for *in
       page* (rule 7 on `aliases`). `look for` is not one of its verbs. */
    aliases: ["find", "highlight", "locate", "look for", "ctrl f", "ctrl+f", "cmd f", "keyword", "semantic search"],
    experimental: false,
  },
  referee: {
    description:
      "Refereeing it? What to weigh before you decide: your criteria, its claims, and a second look at your notes",
    /* **"No model call" and not "nothing"**, which was the draft: the mode does
       start a source scan on mount, so the flat claim was false — GPT Sol,
       2026-09-07. "Can start" because an existing Claims list is reused
       (`useAutoRun` retires the activation when the artefact is ready).
       `?referee=` survives leaving the mode, so its opening panel need not
       be Criteria and cannot be described as waiting for a criterion. */
    /* The last sentence is the line between this mode and Sources (once Peer
       review), from Greg's report spya-h5aypq: "referee is more like making a
       decision on the paper itself". It names the other mode by what it holds,
       not by its label, which is mid-rename (queue item qi-m9tmnpy3).
       docs/research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md. */
    how: "This button starts no model call. Of the chips inside, only Claims can start one; every other run waits for its own button. It never returns a verdict — no accept or reject, no score, no grade. That judgement is yours, and the mode refuses to make it for you. For where the piece sits among other work, what it cites and what others have said about it, there is a mode of its own in the bar.",
    /* The three words this mode was deliberately *not* named, and they are free
       to point here: `review` was vacated by the `review` → `remember` rename,
       and `reviewer` was passed over only because it would have sat beside it.
       `referee` is what journals call the person; `review` is what everyone
       else calls the job. src/modes.ts § referee has the whole argument. */
    /* Not `critique`: Reception has `critiques`, and Referee comes first in the
       bar, so the shorter word here would take every start of the longer one.
       Not `criteria`, which is the chip's own row. */
    /* "peer review" was here until 2026-10-09, when it went to the mode
       named Peer review (plan 261009l § The name). `peer reviewer` stays: it
       is about the person doing one, which is who this mode is for. */
    aliases: ["review", "reviewer", "peer reviewer", "referee report", "assess", "assessment"],
    experimental: true,
  },
  summary: {
    description: "The piece restated: in plain words, brief or fuller, or as a thread of short posts",
    /* Checked against the source, claim by claim (docs/project/mode.md § The
       card on the button):
       - "writes the plain-words lengths in one go … kept": src/simple-summary.ts
         — one job writes every level (a call each, side by side) and stores
         them together; every paragraph keeps one to three passage ids. A third
         level, Simple, is still written and not shown (plan 261003l), so this
         says "the lengths" and no number.
       - "the thread is one more pass over the whole article": the `tweets`
         step, one messages-wire call over `articleWithIds` (src/tweets.ts §
         generateTweets).
       - "each post points to the passages it came from": `Tweet.blocks`,
         validated against the blocks sent (src/tweets.ts § checkBlocks); a post
         whose ids were all dropped keeps its text and draws no link, and a
         thread from before `tweets/5` has none — hence "points", not "links".
       - "a post over the length limit is kept as written and marked":
         `buildThread` keeps each post's text and counts it; the band marks an
         overrun.
       About the mode, not the press — a visitor reads what is stored and
       starts nothing. No price. Until 2026-10-01 this mode was the tree's gists
       at Parts or Sections (plan 261001p); until 2026-10-03 the thread was a
       mode of its own, Tweets. */
    how: "A model writes the plain-words lengths in one go, the first time you ask, and they are kept; each paragraph links to the passages it rests on — the article says it better. The thread is one more pass over the whole article: each post points to the passages it came from, and a post over the length limit is kept as written and marked.",
    /* Both spellings, because the reader's keyboard is not ours to choose.
       **Not `tweets`, `thread` or `twitter`**, though mode.md § Retiring a mode
       says to give the successor the retired name: those words belong to the
       *Summary › Thread* row (src/web/sub-modes.ts § `SUMMARY_SUB_MODES`). On
       this row they would select Summary at whatever view the address names —
       Brief, by default — and could start the plain-words run (GPT Sol, F3 of
       the 261003l review). `gist` went with the outline on 2026-10-01 and came
       back on 2026-10-04 as a word for the piece restated, which is what this
       mode now is. **Not `abstract`**: a paper has one of its own, and this
       is not it. Not `brief`, which is the chip's row. */
    aliases: ["summarise", "summarize", "tldr", "tl;dr", "gist", "overview", "synopsis", "key points", "recap"],
    experimental: false,
  },
  diagram: {
    description: "The article's shape as a picture: a model reads the argument and draws it",
    /* **No superlative here, and that is measured rather than modest.** The
       first draft said this was the longest wait any button in the bar starts;
       the Sketch takes 121–194 s (docs/project/diagram.md) and Debate's spike
       run took 146.7 s (docs/plans/260905f-debate-mode-stage-0-spike-results.md
       § the completed run), so the two are the same size and the claim was one
       measurement away from being false. "About a minute" since 2026-10-02:
       the Sketch moved to a lower effort and now takes 30–101 s, averaging
       42 s (research 261001c), which is `SKETCH_WAIT` in src/job-state.ts —
       the words every pre-press surface quotes. */
    how: "The Sketch — the picture you get unless you ask for another — is a model reading the argument and drawing it, which is about a minute of work the first time and stored afterwards. Its empty state names what that costs before anything runs.",
    /* `sketch` is the artefact a press actually draws, and it is the word the
       empty state and the pipeline both use, so a reader who has seen the mode
       once will type it. **Not `figure`, `image` or `illustration`**: the
       first two are the pictures the article came with, and the third is the
       Illustrated chip's word. */
    aliases: [
      "sketch", "picture", "visual", "drawing", "chart", "graph", "argument map", "mind map", "visualisation",
      "visualization",
    ],
    experimental: true,
  },
  ideas: {
    description:
      "The propositions this piece needs you to hold — the ones it assumes, and the ones it adds",
    how: "One model call over the article, written once and then stored. The split between what you have to bring and what the piece adds is the model's reading rather than something the article marks, and each idea carries the passages it was drawn from, where they can still be found.",
    /* **Not `claims`**, which was the first draft and which GPT Sol caught on
       2026-09-07: Referee has a built sub-mode labelled exactly "Claims", so
       the commonest word for a proposition is already spoken for by a different
       mode's control. A textual uniqueness test cannot see that — the collision
       is with a label inside another mode, not with an alias — so it is a thing
       a person has to notice. `premises` is the unoverloaded word. */
    aliases: ["premises", "propositions", "assumptions", "arguments", "key ideas", "main ideas", "theses", "beliefs"],
    experimental: false,
  },
  learn: {
    description:
      /* Rewritten 2026-10-05 with the name (plan 261005l). *Remember* wrongly
         suggested saved memories, and the sentence ended by denying them;
         *Learn* suggests a course, so it denies that instead. Explore's half
         follows Greg's widening of it the same day: your own view, and where
         the piece may be weak (spya-mvmpks). */
      "Take the piece in and think it through: Recall, a short Tutorial, a Quiz, or Explore your own view of it and where it may be weak — not a course or flashcards",
    /* **Two sentences about the whole mode, since 2026-10-04.** It was a
       110-word walk through Recall, Tutorial and Explore; Greg (spya-usyhwy):
       *"it's like one big paragraph. Prefer smaller paragraphs or bullet
       points"*, and *"each submode button should have its own tooltip"*. So
       what each part does is on its chip (QuizPanel.tsx § `LEARN_VIEW_HOW`)
       and listed in the band's (i) (LearnAbout.tsx).
       Claims: no conversation turn runs before the reader's first message;
       Quiz's questions are one stored batch written from the article, and
       each answer is marked against it (src/quiz.ts, src/quiz-mark.ts). It
       describes the mode, not a press, so it is true for the Help page too. */
    how: "Recall, Tutorial and Explore are conversations, and each waits on you: the AI does not reply until you say or type something. Quiz writes its questions from the piece and marks your answers against it.",
    /* `recall` is this mode's own default sub-mode, so the word lands where the
       reader expects.

       **`quiz` is deliberately absent**, and it is the clearest example of the
       rule these aliases follow. Quiz is one of Learn's *other* sub-modes, and
       opening the mode lands on Recall (`params.ts`), so `quiz` here would name
       a destination and then not go there. GPT Sol found this, 2026-09-07.
       Since 2026-10-01 a command *can* encode `{ mode: "learn", learn:
       "quiz" }` — the bar's *Learn › Quiz* row (src/web/sub-modes.ts, plan
       261001d) — and that row, not an alias here, is where `quiz` lands.
       `test me` is left out for the same reason, and `flashcards` because the
       description denies it. Both spellings of *practise*. */
    /* `remember` since 2026-10-05: it was the mode's name until then, and the
       word a reader already knows should still find it, as `trajectory` finds
       Skim. `learn` left the list the same day, because it is the name now.
       The sub-mode rows get the old compounds (*remember quiz*) from
       command-match.ts § `FORMER_PARENT_NAMES`. */
    aliases: ["recall", "remember", "memorise", "memorize", "study", "revise", "revision", "practice", "practise"],
    /* In every reader's bar since 2026-10-05. Greg, 2026-10-04 (spya-cnqcjf):
       *"I think recall submode for sure. I think quiz mode as well. And then
       let's try tutorial too."* Explore, the fourth part, stays behind the
       switch one level down (src/web/sub-modes.ts § `LEARN_SUB_MODES`).
       docs/project/experimental-features.md. */
    experimental: false,
  },
  quotes: {
    description: "The lines worth keeping — the piece's own sentences, chosen and checked against it",
    how: "The model only locates a line; the words you read are sliced out of the article itself, so nothing here is the model's typing. What that proves is that the sentence is in the piece, not who wrote it — a quotation the article left unmarked cannot be told from its own prose.",
    /* Not `highlights`: Search has `highlight`, and Quotes comes first in the
       bar, so the longer word here would take the shorter one from it. `quote`
       needs no entry — it is the start of the mode's own name. */
    aliases: ["quotations", "excerpts", "extracts", "passages", "pull quotes", "key quotes", "best lines"],
    experimental: false,
  },
  timeline: {
    description: "When the piece says these things happened, in order — and how sure it actually is",
    how: "One model call over the article, written once and then stored. Anything the piece never dated stays undated rather than being guessed at, and the order is the model's reading of the piece rather than a sort by date.",
    aliases: ["chronology", "dates", "events", "history", "sequence", "chronological", "time line", "order of events"],
    experimental: true,
  },
  /* **Citations and Debate until 2026-10-09**, now this mode's three
     sub-modes (src/web/sub-modes.ts § `PEER_REVIEW_SUB_MODES`, where the
     retired words and the bibliography words are the sub-mode rows' own
     aliases, so each opens the view it means).
     docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md. */
  "peer-review": {
    /* Greg's frame for it, 2026-10-09 (spya-vcvxu5): *"what this article
       cites and what other people say about it, this article might be a good
       sort of TLDR somehow for the different submodes"*. Each chip's card
       leads with one half of it. */
    description: "What this piece cites, and what others say about it",
    /* **Checked against the source, claim by claim**, in the two halves the
       two modes' cards were checked in (docs/project/mode.md § The card on
       the button):
       - Bibliography, "one model call … written once and then stored": the
         `citations` step, one messages-wire call over `articleWithIds`,
         written to the `citations` column (src/citations.ts, src/pipeline.ts §
         STEPS). "Every address … is one the article gave, found by code":
         `linkFor` in src/citations.ts derives DOI → arXiv → a title-matching
         anchor → a mention anchor from the article's own text and hrefs; a URL
         the model writes is counted in `CitationDrops.modelUrls` and never
         read. "Otherwise a Scholar search": `linkFrom: "search"`, labelled on
         the row (CitationsPanel.tsx § Source).
       - Reception, "a pass over the open web … stored once it lands": the
         `debate` step since `debate/7` (2026-10-08) is one pass, for
         Reception only (src/debate.ts). "A pass" rather than "a search",
         because one pass has run 36 searches on its own (GPT Sol,
         2026-09-07).
       - Claims, "listed by one model call … with no web search": the
         `debate-claims` step (plan 261008i § 2); a check is the reader's own
         press, per claim (src/debate.ts § `admitDebateCheck`).
       - "Every source links out": every Reception and checked-claim row is a
         page with its address (DebatePanel.tsx § Row).
       No price — mode.md § The card on the button. */
    how: "Bibliography is one model call over the article, written once and stored, and every address shown for a work is one the article itself gave, found by code rather than typed by the model, or else a Scholar search marked as one. Reception comes from a pass over the open web, and Claims lists the piece's claims with one model call and no web search, for you to check against the web; each is stored once it lands. Every source links out, so you can check it rather than take our word for it.",
    /* "peer review" left Referee's aliases on 2026-10-09: it is this mode's
       name, so the label finds it and an alias saying it again would be a
       second copy (tests/mode-catalog.test.ts § never another mode's label).
       Referee keeps `peer reviewer`, which is about the person (plan 261009l §
       The name). The two retired mode words are the sub-mode rows' aliases,
       not these. */
    aliases: ["sources", "literature", "further reading"],
    /* Out of the switch on the day it was made. Greg, 2026-10-09
       (spya-vcvxu5): *"let's move this out of experimental, this combined
       mode"*. Both halves were behind it until then.
       docs/project/experimental-features.md. */
    experimental: false,
  },
  structure: {
    /* **True of both faces**, since 2026-09-10: the two columns and the nested
       list each show every part and the sections of the one the reader is in.
       It said "in two linked columns" until then, which a narrow band's list
       would have contradicted. **True of both views too**, since 2026-10-01:
       it said "the sections of the one you are in", which Expanded (every
       part's sections) contradicts. GPT Sol's plan review of 261001q. */
    description: "The document's shape — every part, and its sections",
    /* Checked against the code rather than written from the plan, which is the
       failure this field has already had twice (docs/project/mode.md § The
       card on the button). What a press does not tell you: that Fisheye
       depends on the room, and how to read each face — the reading order of
       the columns is what a reader would otherwise have to infer from watching
       the right-hand one change at a boundary — that Expanded is there, and
       the keys (tooltips.md § A shortcut is named on its card).
       StructureMode.tsx § `structureFace` is the switch.

       **No "nothing to generate" since 2026-10-01.** It opened this card as
       "The same already-built tree as Summary, so there is nothing to
       generate", and Greg asked for it to go (spya-ukr9dp): not much use to a
       reader, and Summary was about to stop drawing parts and sections. It is
       still true — the tree arrives in the page's own payload. */
    how: "Fisheye opens up around the part you are reading: with room, two columns read left to right — the right-hand one is always the inside of the row marked in the left; without it, one nested list. Expanded shows every part and section with its summary. ← and → step section by section.",
    /* `columns` is about the wide face. `tree`, `map` and `outline` came from
       Outline on 2026-09-10 with its list: `outline` so the retired mode's own
       name still finds the mode that holds it, the other two because they were
       Outline's nicknames and Outline is now this. `hierarchy`, `toc` and
       `contents` came from Hierarchy on 2026-09-29 for the same reason, when
       it retired into this mode.
       docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md.
       `table of contents` and `headings` are Greg's own examples of 2026-10-04
       (see `aliases` above); `contents` never caught the first. */
    aliases: [
      "columns", "outline", "tree", "map", "hierarchy", "toc", "contents", "table of contents", "headings",
      "headers", "sections", "chapters",
    ],
    /* **Out of the switch since 2026-09-10.** It was behind it as an
       instrument — a third structural view for Greg to compare against the
       other two, kept off an ordinary reader's bar while the comparison ran.
       The comparison answered: Structure took Outline's place, and Outline was
       on every reader's bar, so keeping this hidden would have taken the list
       away from everybody without the switch.
       docs/plans/260910g-structure-mode-subsumes-outline.md. */
    experimental: false,
  },
  faq: {
    description: "The questions a careful reader would ask this piece, and where it responds",
    /* **Checked against the source, claim by claim** (docs/project/mode.md §
       The card on the button):
       - "one model call over the article, written once and stored": the `faq`
         step, one messages-wire call over `articleWithIds`, written to the `faq`
         column and replaced on a re-run (src/faq.ts, src/pipeline.ts § STEPS).
       - "no answer is written": `FaqQuestion` has `question` and `passages` and
         nothing else (src/types.ts) — docs/plans/260916d-faq-mode.md § The one
         product call. This is the half a press would not tell somebody who
         expects an FAQ to have answers under it.
       - "the broadest, most central first; reading order is one tap away":
         since `faq/4` the model is asked for `difficulty` and `centrality` on
         every question (src/types.ts), and the default order is
         `orderQuestions` in src/web/faq-order.ts — highest
         `centrality × (1 − difficulty)` first, under a threshold. The stored
         order is still reading order (`inReadingOrder`, src/faq.ts), which
         the *reading order* button shows and a list without scores falls back
         to. No frequency score exists: nobody's asking is counted.
       Not the "checked against it" sentence, which the panel's (i) already
       says (GPT Sol D3). About the mode, not the press, and no price. */
    how: "One model call over the article, written once and stored. No answer is written: each question points to passages of the piece itself. The broadest, most central questions come first; reading order, most central and hardest are one tap away.",
    /* Not `questions`, and nothing that starts with it — `questions and
       answers` — because `question` is Chat's and FAQ comes first in the bar:
       the longer word here would take it. `faq` itself is this mode's label,
       which an alias may not repeat (tests/mode-catalog.test.ts). */
    aliases: ["faqs", "frequently asked questions", "q&a", "q and a", "qa", "common questions", "key questions"],
    /* A new mode on an unmeasured prompt — docs/project/experimental-features.md. */
    experimental: true,
  },
  skim: {
    description: "A route through the piece's quotes, a little deeper each time round",
    /* **Checked against the source, claim by claim** (docs/project/mode.md §
       The card on the button):
       - "a short model call over its quotes": the `skim` step reads the
         stored Quotes, the tree and the profile; `renderPrompt` in
         src/skim.ts sends each quote's words, section path and priority,
         and never the article's prose.
       - "puts them in an order and a depth": `SkimStop` is a quote id, a
         depth 1–3 and a role line, in array order (src/types.ts).
       - "for you, if you have said who you are": `profileSection(profile)` in
         the same prompt, and `routeProfileIsStale` marks the route outdated
         when the profile changes.
       - "chosen first when there are none": the step refuses without Quotes
         (`SKIM_NO_QUOTES`), and the band asks for `quotes` before it
         (`precededBy`, src/web/useSkim.ts).
       About the mode, not the press, and no price. */
    how: "A short model call over the article's Quotes and its key Ideas — never the rest of its prose — puts the Quotes in an order and gives each a depth, so each pass covers as many of the Ideas as the quotes reach, shaped by your profile if you have one. When there are no Quotes or Ideas yet, they are made first; finding the Ideas is the longer part.",
    /* "spiral" and "route" are the two words Greg used for it in the brief —
       docs/project/skim.md. `trajectory` was the mode's own word until
       2026-10-01 (261001r), and Greg asked to keep it as a keyword. */
    aliases: ["spiral", "route", "trajectory", "skim read", "speed read", "quick read", "preview", "scan"],
    /* Behind the switch from 2026-09-28 until later that day, when Greg asked
       for it in the mainstream: "take Skim and Quotes modes out of
       Experimental features" — docs/project/experimental-features.md. Still
       owners-only (`POLICY.skim`, src/web/visitor.ts). */
    experimental: false,
  },
  marginalia: {
    description: "Notes in a column right of the text, each level with the passage it is about",
    /* **Checked against the source** (docs/project/mode.md § The card on
       the button): the questions are `TreeNode.question` on the root and the
       top-level parts (src/structure.ts § `questionFor`), the sentence at the
       top is the arc (src/arc.ts), and the stamps are the stored ideas, read
       and never generated (src/web/marginalia/MarginaliaColumn.tsx). The one
       thing it generates is its own relation words — so, but, vs
       (src/relations.ts, plan 261003f), asked for the first time the owner's
       column is shown (src/web/useRelations.ts, plan 261005d), never on
       import; other modes' lists are only read. The
       width is
       `fitView`'s `margW` (src/web/layout.ts): below it the column is not
       drawn. */
    how: "It marks where the argument turns, with so, but or vs beside those paragraphs. One model call makes those words, the first time the article's owner opens the column; the notes are there meanwhile and the words join them when they are ready. Everything else is read, never made here: the questions come with the article's parts, the sentence at the top is where the argument has got to, and ideas, FAQ, Timeline, and Peer review's claims and cited works appear once they have been made in their own modes. It needs a wide window; on a narrow one the notes are hidden.",
    /* `annotations` was the mode's own word until 2026-10-01 (261001n); the
       Comments row has it too and this row wins it. **Nothing here may start
       with `notes`**, which is the Comments row's. */
    aliases: ["annotations", "margin notes", "margin", "margins", "sidenotes", "side notes", "marginal notes"],
    /* **Out from behind the switch on 2026-10-05.** It went in on 2026-10-01
       as a first experiment with a column on the right. Greg, 2026-10-04
       (spya-vv54j2): "Let's take the annotations mode out of experimental
       features, i.e. make it a mainstream feature available to everybody."
       docs/plans/261005d-marginalia-out-of-the-experimental-switch.md. */
    experimental: false,
  },
};

/**
 * **The experimental modes the guide may still offer as a button, and to
 * whom** — plan
 * docs/plans/261009w-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md.
 *
 * > if the reader says in their Guide chat or their Why You're Reading This
 * > that they are a referee, that should obviously present tools for the
 * > Referee mode etc.
 * >
 * > — Greg, 2026-10-09 (report spya-h5aypq)
 *
 * The switch is about clutter in the bar, not access: `?mode=` opens any
 * mode for anyone (src/web/experimental-visibility.ts). A button the guide
 * offers to the one reader who said they need the mode is not clutter. So a
 * mode here keeps its place behind the switch in the bar, the command bar and
 * ordinary Chat, and gains, with its sub-modes, three things, each read from
 * here through `offeredBehindTheSwitch`:
 *
 *  - a button in the written guide's list of modes, with `audience` and
 *    `guidance` beside it (src/guide.ts § `modeWordsSection`);
 *  - a place in the **guide's** chip door only (src/web/chip-door.ts §
 *    `guideDoorRows`);
 *  - and it is always a press, never opened by the guide itself
 *    (src/acts-alone.ts § `modeActsAlone`): the offer rests on the model's
 *    reading of who the reader is, which the reader confirms.
 *
 * An allowlist of its own, deny by default, so the exceptions to the switch
 * can be read in one place rather than found scattered across the rows above.
 * A mode that is not experimental has no business here;
 * tests/guide-offers-behind-the-switch.test.ts holds that.
 */
export interface OfferedBehindTheSwitch {
  /** Who it may be offered to: the end of the prompt's sentence "offer it only when …". */
  readonly audience: string;
  /** What to say alongside the offer, as an instruction to the guide. */
  readonly guidance: string;
}

export const OFFERED_BEHIND_THE_SWITCH: Partial<Record<Mode, OfferedBehindTheSwitch>> = {
  referee: {
    audience:
      "the reader has said, in their own words, that they are refereeing or peer-reviewing this piece, or assessing it for a journal, a conference or a funder. Something in the article saying so is not the reader saying so",
    /* The other mode is named by its description, not its label: it is being
       renamed from Peer review to Sources (queue item qi-m9tmnpy3), and the description,
       Greg's own frame, survives the rename. The confidentiality sentence is
       in the past tense on purpose: the text went when the article was added
       (docs/project/referee-mode.md § Confidentiality). */
    guidance:
      "Suggest Referee for the close read and their own notes, and the mode for what this piece cites and what others say about it for the literature around the piece. And say plainly, in one sentence, that this article's text was already sent to an AI provider when it was added, and that Referee's Notices button says what journals' rules are on that",
  },
};

/**
 * **What `OFFERED_BEHIND_THE_SWITCH` says about a catalogue key**, or
 * `undefined`: `mode:referee` and `submode:referee:criteria` are both
 * Referee's, the word after the first `:` being the mode.
 */
export function offeredBehindTheSwitch(key: string): OfferedBehindTheSwitch | undefined {
  const mode = key.split(":")[1];
  /* `hasOwn`, so a key whose middle word is `constructor` is not handed Object's. */
  return mode !== undefined && Object.hasOwn(OFFERED_BEHIND_THE_SWITCH, mode)
    ? OFFERED_BEHIND_THE_SWITCH[mode as Mode]
    : undefined;
}
