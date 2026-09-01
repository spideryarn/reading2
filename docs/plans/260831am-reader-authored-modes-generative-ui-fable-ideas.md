# Dreaming pass: reader-authored modes

> **Provenance.** Written by Claude Fable, 2026-08-31, answering the brief in
> [260831am-reader-authored-modes-generative-ui.md](260831am-reader-authored-modes-generative-ui.md).
> This is the deliberately unconstrained pass — Greg asked it to *"ignore the risks/expense/latency,
> and just dream"*. The adversarial pass is
> [260831am-reader-authored-modes-generative-ui-review-sol.md](260831am-reader-authored-modes-generative-ui-review-sol.md),
> and three of the claims below do not survive it. Read the plan for which.


The claim this whole document makes: **Sketch already answered the hard question, and the answer generalises.** Sketch let a model design a picture without ever writing markup, by giving it a small vocabulary with numbers in it, and then *measuring* what came back. A mode is the same problem one level up. A reader-authored mode should be a small document with checkable claims in it — what to ask, over what slice of the article, in what shape, drawn with which of our layouts — and the app should be able to read that document, run it, verify it, score it, and render it in the house style, exactly the way `readSketch` reads a scene.

If that works, then Ideas, Quotes and Timeline stop being three hand-built panels and become three rows in a table of mode definitions. And the reader's "I wish there were a mode that…" becomes a sentence typed into a composer, a model call, and a new tab in the bar thirty seconds later.

---

## 1. The design space

Five genuinely distinct architectures, most constrained first. They are not rivals so much as floors of one building — but each could be shipped alone, and each has a distinct feel.

### (a) Prompt-only over a fixed renderer

**The reader does:** types "show me every claim in this piece that the author hedges" into a DIY box. **The model emits:** a JSON list of `{text, block}` rows against a fixed schema. **What runs it:** a single generic panel — a list of rows, each a door to a block, painted into the spine. **Checkable:** block ids resolve; quoted text is really in the block. **When it's good:** it feels like chat that left a residue — the answer stays, is revisitable, and lights up the spine. The ceiling is low: everything is a list, and the reader's instruction lives only as a prompt, so two runs of "hedged claims" may disagree and nothing explains why. Honestly, (a) is not an architecture; it is the degenerate case of (b) with one layout and no typed fields. Build (b) and you get (a) on day one.

### (b) A declarative mode DSL — Sketch's move, generalised

**The reader does:** describes the mode in a sentence or two; a model turns that into a **mode definition** — a small JSON document (schema in § 2). The reader can then edit the definition directly, or keep talking to the composer ("group them by chapter", "make the uncertain ones dashed"). **The model emits:** twice — once at authoring time (the definition), once at run time (the rows, conforming to the definition's declared field types). **What runs it:** one `GenericModePanel` that interprets any definition: it runs the generation, verifies the rows, and renders them with one of a handful of layouts built from the component kit. **Checkable:** everything — this is the whole point. Field types carry validators (a `quote` field must be a verbatim substring of its block; a `blockref` must resolve; a `timepoint` must parse; an `enum` must be a member), and the finished artefact gets scored the way a sketch does (§ 5). **When it's good:** it is indistinguishable from a built-in. Same typography, same tones, same spine paint, same enlarge modal, dark mode for free — because the definition never mentions a colour or a pixel. The reader's mode sits in the bar next to Quotes and nobody can tell whose is whose.

### (c) Sandboxed capability API + generated code

**The reader does:** asks for something the DSL cannot say — "a force graph of which ideas cite which", "a flashcard drill over the glossary". **The model emits:** actual TypeScript, but written against a narrow typed API (`ModeContext`, § 3) and nothing else — no DOM, no fetch, no imports. **What runs it:** a sandboxed iframe or worker holding the code, talking to the host over a postMessage bridge that *is* the capability API; the host renders what the code asks for, so even here the code composes our components rather than emitting markup. **Checkable:** less. You can typecheck the code against the API, lint away escapes, cap its calls — but you cannot check that the mode is *good* the way you can check a quote is verbatim. The score becomes behavioural: does it anchor its claims, does it paint the spine, does it crash. **When it's good:** it feels like the app grew an organ overnight. This is the tier where genuinely new interaction lives — drills, games, graphs, anything with its own state machine.

### (d) Full generated React in the app's own bundle

The model writes a real component; it runs with the app's own privileges. The reader experience is identical to (c) with the ceiling removed. What's checkable is only what a compiler and a reviewer can check. Even in a dreaming pass I'll say plainly: (d) buys nothing over (c)-with-a-rich-enough-API except the removal of the bridge, and it converts "the model output is untrusted" — the one sentence the whole security posture stands on — into a falsehood. The interesting version of (d) is not "in the browser at run time"; it is (e).

### (e) Feature request → an agent builds a real mode → it ships to everyone

**The reader does:** writes a feature request (the Feedback extension Greg mentioned). **The model emits:** a plan, then a PR: a real panel component, a pipeline stage, tests, a doc — the same artefacts a human-built mode has, reviewed the same way (cross-family review, the existing gates). **What runs it:** the ordinary deploy. **Checkable:** everything the repo already checks — this is the only architecture where `npm test` is the validator. **When it's good:** it is not *your* mode any more; it is everyone's, and that is both the glory and the point. Latency is days, not seconds, so it cannot be the authoring loop. But it is the perfect **promotion path**: a community mode from tier (b) that earns its usage numbers gets handed to an agent with the definition as the spec — "make this real, make it fast, make it beautiful" — and graduates into the bar.

**The shape of the answer:** (b) is the floor everyone stands on, (c) is the ceiling for power users behind the experimental switch, (e) is the graduation ceremony. (a) is subsumed; (d) is (e) done in the wrong place. Browser extensions die here without regret: they can't see the tree or the block ids properly, can't paint the spine, can't share, and every app change breaks them.

---

## 2. What a mode is, if it's data

This is the heart. A mode definition has two halves.

```ts
interface ModeDef {
  version: "mode/1";
  name: string;            // "Hedges"
  icon: IconName;          // from our set, like everything else
  blurb: string;           // the bar tooltip
  ask: Ask;                // the generation half
  show: Show;              // the presentation half
}

interface Ask {
  /** The instruction, in the author's words. Rides inside our system prompt, never instead of it. */
  prompt: string;
  /** What one call sees: the whole article, each tree node at a depth, or a sliding window. */
  scope: { unit: "article" | "section" | "block" | "tree-node"; depth?: number };
  /** The shape of one extracted row: named, typed fields. The types carry their checks. */
  fields: Record<string, Field>;
}

type Field =
  | { type: "text"; role?: "title" | "body" }
  | { type: "quote" }                    // MUST be verbatim in its block — verified, or the row is dropped and counted
  | { type: "blockref" }                 // MUST resolve to a real id — same rule as Sketch's `block`
  | { type: "enum"; values: string[]; open?: boolean }  // open: model may add values on first run, then they freeze
  | { type: "timepoint" }               // date | relative ("three years later") | era, with precision + placeable flag
  | { type: "number"; min?: number; max?: number }
  | { type: "term" };                    // a word/phrase; every occurrence gets painted in the prose (glossary's trick)

interface Show {
  layout: "list" | "grouped" | "axis" | "table" | "cards";
  /** Which field fills which slot of a row card: title, sub, badge, quote, meter. Slots, not styles. */
  slots: Partial<Record<"title" | "sub" | "badge" | "quote" | "meter", string>>;
  /** Grouping/ordering name FIELDS, never values: order "by timepoint", group "by stance". */
  group?: string;
  order?: { by: string; dir?: "asc" | "desc" } | "article";   // "article" = the order the piece says them
  /** Tone is positional (0–7), assigned per group/enum-value by US, not chosen by the model. Sketch's rule. */
  toneBy?: string;
  /** What each row paints: spine mark always (from its blockref); prose highlight if a quote/term field is named. */
  paintProse?: string;
  /** Which fields become controls: an enum → filter chips, a number → threshold slider, depth → the depth control. */
  controls?: string[];
  enlarge?: "same" | "axis-full" | "table-full";
}
```

That's the whole language. Now the test the brief asks for — the three modes as data, and what breaks.

**Ideas** falls out cleanly:

```json
{ "name": "Ideas",
  "ask": { "prompt": "The propositions this piece needs you to hold — the ones it assumes and the ones it adds.",
           "scope": { "unit": "article" },
           "fields": { "statement": {"type":"text","role":"title"},
                       "stance": {"type":"enum","values":["assumed","introduced","contested"]},
                       "evidence": {"type":"quote"}, "at": {"type":"blockref"} } },
  "show": { "layout": "grouped", "group": "stance", "toneBy": "stance",
            "slots": { "title": "statement", "badge": "stance", "quote": "evidence" },
            "order": "article", "paintProse": "evidence", "controls": ["stance"] } }
```

**Quotes** is even smaller — two fields, a `list` layout with the quote in the title slot, `paintProse: "quote"`. The one thing Quotes needed that was special — "verified against the text" — is not special at all: it is the `quote` field type's validator, which Ideas gets for free on its evidence field. That is the vocabulary paying rent.

**Timeline** is where it creaks, in three instructive places. First, ordering by *when it happened* rather than *where it's said* needs a `timepoint` field with real parse semantics — "1848", "three years later", "the Bronze Age" — and an honest `placeable: false` bucket rendered below the axis rather than silently dropped. That's a new field type, not a new architecture. Second, the axis is not a list: `layout: "axis"` has to exist, laying rows along a scale, which is the first layout where the *renderer* has an algorithm. Third, Timeline shows *certainty* — stated vs implied vs inferred — as visual hedging; that's `toneBy`/badge doing double duty, and a `muted` treatment for low-certainty rows, which Sketch already has a word for. So Timeline costs the vocabulary one field type, one layout, one style bit. It does not break the model; it prices it.

What genuinely doesn't fit, and shouldn't: **Hierarchy** (it *is* the app), **Search** (interactive, not an artefact), **Chat**, **Diagram** (Sketch is its own DSL — though "a mode whose enlarge view is a sketch" is a lovely composition, § 7). **Summary** half-fits: `scope: {unit:"tree-node"}` producing one row per node with a depth control is exactly the summary panel, which suggests the depth slider should be what `controls` does with the tree, not a special case. **Glossary** fits once `term` fields exist. So the honest count: five of the ten built-ins are instances of a ~200-line schema, and the other five are the reasons the schema should stay small rather than grow to eat them.

Two more things a definition needs that only show up when you imagine the tenth community mode. A **fixture**: every definition carries one example row, hand-checked at authoring time, so "this used to work" has a referent. And a **cache key**: the artefact for (definition-hash × article-revision-hash), which drops straight into the existing content-hash convention — a shared mode that ten readers open on the same article generates once.

---

## 3. The capability surface

Whether the consumer is the DSL interpreter (tier b) or generated code in a sandbox (tier c), there should be exactly one API, and its name should answer "what can a mode do?" in one file:

```ts
interface ModeContext {
  article: {
    slug: string; title: string;
    blocks: readonly PublicBlock[];              // id, text, kind — the public projection, allowlisted
    tree: TreeNode;                              // the granularity-zoom tree, read-only
    textOf(id: BlockId): string | null;
    find(quote: string): { block: BlockId; start: number; end: number } | null;  // the verbatim check, exposed
  };
  nav: {
    jumpTo(id: BlockId): void;                   // the one action every anchored claim must offer
    current(): BlockId;
    onPosition(cb: (id: BlockId) => void): Unsubscribe;   // fisheye modes need to know where the reader is
  };
  spine: {
    paint(marks: ReadonlyArray<{ block: BlockId; tone?: Tone; weight?: 1|2|3 }>): void;
    clear(): void;
  };
  prose: {
    highlight(spans: ReadonlyArray<{ block: BlockId; quote: string; tone?: Tone }>): HighlightHandle;
    // spans by quote, not by offset — the block-ids contract, kept: an unfound quote is dropped and counted
    gutter(notes: ReadonlyArray<{ block: BlockId; glyph: IconName; card: string }>): GutterHandle;
  };
  ai: {
    ask<T>(req: { prompt: string; scope?: Scope; schema: FieldSpec }): AsyncIterable<RowDelta<T>>;
    // streams rows as they arrive; schema enforcement and verification happen server-side, on our rails,
    // through ai-call.ts — so spend tracking, model choice and prompt caching come for free
  };
  state: {
    get<T>(key: string): Promise<T | null>;      // per-reader, per-mode, per-article; a namespaced KV in Postgres
    set<T>(key: string, value: T): Promise<void>;
  };
  cite(id: BlockId): Citation;                    // block + honest label, rendered by us
  ui: Kit;                                        // § 4 — the only way anything gets drawn
}
```

The load-bearing choice: **and this is also the refactor the ten built-ins want.** Today a new mode reaches into annotate.ts, the spine internals, its own fetch. If the built-ins are migrated to consume `ModeContext`, three things happen at once: the API stays honest (any gap hurts us before it hurts a reader-author); the built-ins become the API's test suite; and "promote a community mode to built-in" (tier e) becomes a rewrite against the *same interface*, not a rewrite into a different world. The interface is small enough to hold in your head, which is the point — it is the mode-author's version of "the seven tools chat can reach for", with the same filter: does it let the mode send the reader somewhere they couldn't otherwise get?

---

## 4. Beauty, and the house style

Generated UI looks generated because the model is allowed to make style decisions, and models make average ones. Sketch's rule — the model chooses arrangement, never colour — generalises to: **the model chooses content and grouping; the kit chooses everything visible.**

Concretely: the DSL has no colour, no font, no pixel anywhere in it. A definition names *slots* (title, sub, badge, quote, meter) and *semantic bits* (tone-by-this-field, muted-when-that). The `Kit` in `ModeContext.ui` is a dozen components that already exist in spirit across the ten panels and want extracting anyway: `Row` (the anchored card every panel is made of — title, sub, badge, the jump affordance), `QuoteCard` (the typographic treatment Quotes already has), `Badge`, `Meter`, `Axis`, `GroupHeader`, `EmptyState`, `ErrorCard` (wired to copy.md's voice), `EnlargeFrame`. Tones are the same positional eight the tree and searches use, assigned by us in order of group appearance — so a reader's "Hedges" mode is coral and teal for the same reason Search's hits are, and dark mode costs nothing because the kit is built on the tokens.

The 288–400px band gets the same dignity Sketch gave it: layouts are designed for the strip (a `Row` is a strip-shaped thing), and anything that wants room — the axis, a table — renders as a thumbnail with the same Enlarge affordance a figure gets. The tier-(c) sandbox obeys the identical rule by construction, because the bridge only accepts kit calls: generated *code*, but never generated *chrome*. The deepest version of "it looks like it belongs": a reader-made mode is drawn by literally the same components as Quotes, so belonging isn't a style guide the model follows — it's the only output the system can produce.

---

## 5. Robustness: seeing it go wrong, and the analogue of "numbers can be checked"

The authoring loop should feel like Sketch's eval harness turned into a room the reader stands in. You type the sentence; the composer model drafts the definition; the definition runs immediately against the article you're on (or a fixture article, for speed); and beside the preview sits the **score card**:

- **anchored** — share of rows whose blockref resolved (Sketch's `linked`)
- **verbatim** — share of quote fields that were really in their block (dropped rows are shown crossed out, not hidden — silent-success.md is a law here)
- **reach** — the longest run of the article no row points into, Sketch's gap measure verbatim
- **flow** — when `order: "article"` is claimed, Kendall's tau between panel order and block order, the same `tau` already in sketch-scene.ts
- **duplication** — near-identical rows, and **density** — rows per thousand words, because forty hedges in a two-thousand-word piece is a prompt problem you can see as a number

And the same `accept()` boundary: below thresholds, the artefact is refused with reasons *worded for a model* — "row 7's quote is not in spya-k3m9qt", "62% of the piece went by with nothing extracted" — because those sentences are the repair loop. Refusals go back to the run-time model automatically, twice; if it still fails, the reader sees the refusal card in plain words with a "loosen it" edit suggestion. Every failure is a card, never a blank band.

Definitions are immutable versions; editing forks a new one; the artefact cache keys on the definition hash, so "this used to work" is answerable by running the old hash. And each definition's hand-checked fixture row becomes a regression test: when we change the extraction prompt scaffolding or the model, every published mode re-runs against its fixture in an offline eval sweep — `evals/modes/`, the exact shape of `evals/sketch/`. That is the answer to "how does a whole mode get measured": the same way a scene does, because we made the mode out of checkable claims on purpose.

---

## 6. Sharing, forking, and the gallery

Because a tier-(b) mode is a small JSON document with no code in it, sharing is structurally cheap: publish puts the definition (not any artefact) into a gallery; installing it adds a row to your bar; the artefact generates against *your* article on *your* first open — and caches, so popular mode × popular article costs one call ever. Forking is copying a document and editing a prompt, which means the gallery is also the tutorial: every published mode is a worked example you can open and read, the way view-source taught a generation HTML.

Rate by use, not stars: "kept in the bar after a week", "rows jumped-to per open" — the second one is beautiful because it measures whether the mode is a *door into the prose*, which is the vision sentence made into a metric. The gallery's top shelf is then a promotion queue for tier (e): a mode that has earned its numbers gets an agent, the definition as spec, the fixture as test, and comes back as a built-in with the author's name in the doc.

Trust, at the shape level: the definition's only free text is the `ask.prompt`, which rides inside our scaffolding and produces rows that are verified against the article before anything renders — so the blast radius of a malicious shared mode is "weird rows", the same blast radius the article itself already has. Provenance is worn openly: "made by reader-name, run on your copy", with the model's rows carrying block anchors like everything else. Tier-(c) code modes share later, behind review, and that's Sol's chapter, not mine.

---

## 7. The wilder ideas

**Modes the article proposes.** During the pipeline, a cheap call looks at the piece and drafts one bespoke mode definition *for this article*: a Dramatis Personae for the profile, an Experiments table for the paper, a Who-Claims-What for the debate. It appears as a dimmed, unlabelled eleventh button — press it and it generates. The article arrives already knowing what lens it deserves. (This is per-article, costs one small call, and is pure tier-(b): the proposal *is* a definition, checkable like any other.)

**A chat turn promoted to a mode.** You ask chat "which claims here rest on the 2019 study?" and the answer is good. A small "make this a mode" affordance turns that turn into a definition — the question becomes the `ask.prompt`, the answer's shape becomes the fields. This is the most natural authoring flow there is: nobody designs a mode cold; they notice a question they keep asking. Chat becomes the composer's front door.

**Modes that compose.** One mode's rows as another's scope: "Timeline, but only over the contested Ideas"; "Quotes, but only inside the sections my Hedges mode lit up". In the schema it is one field: `scope.from: modeId`, and the second mode runs over the blocks the first anchored. Chains of two are already a research tool.

**Library-wide modes.** `scope.unit: "library"` — the same extraction run across everything you've saved, the rows carrying article + block. "Every definition of 'alignment' I've ever read, side by side." The shelf grows a band. The chat tools already believe in this (`search_library`); this is that belief given a persistent, visual form.

**A lens on someone else's reading.** A friend shares not an article but their *reading* of it: their comments, their review-mode answers, the rows their modes extracted — rendered as a mode in your band while you read the same piece. "Read it the way she did" — her marks in the gutter, her quotes lit in the prose, at the moments you reach them. Reading together, asynchronously, without a chat window in sight.

**Gutter modes.** A mode class that renders no band at all: its rows become small glyphs in the prose margin with hover cards — marginalia as an output format. The band stays free for another mode, which quietly introduces *two modes at once* and forces the composition question the current one-band design defers.

**A mode whose enlarge is a sketch.** `enlarge: "sketch"` — the rows are handed to the Sketch prompt as required nodes, and the enlarge modal draws the mode as a picture. The two DSLs meet, and the mode's list view and diagram view are provably the same rows.

---

## 8. Ranked recommendation

**1. Build the mode-definition DSL, the score, and the component kit — tier (b) — and refactor the built-ins onto `ModeContext` as you go.** The v1, shippable in a week or two: `ModeDef` with four field types (text, quote, blockref, enum), two layouts (list, grouped), one `GenericModePanel`, server-side generation through the existing `ai-call` rails with verification and a score, a composer that is one model call from a sentence to a definition, all behind the experimental-features switch — and Ideas re-expressed as a definition to prove the vocabulary on day one. The end state: the gallery, timepoints and the axis, per-article proposed modes, chat-turn promotion, library scope, mode composition — every one of which is a schema addition, not an architecture. The thing that kills it: the vocabulary being wrong rather than small — if the modes people actually want are interactions (drills, games, canvases) rather than extractions, a row-set DSL polishes the wrong ceiling. Watch the gallery's refusal pile for that signal. I'd pick this without much agonising: it is Sketch's own reasoning applied to the thing Sketch was a rehearsal for, it satisfies every principle in the brief *by construction* (anchored, verbatim-checked, house-styled, boring stack), and it is the only architecture where the reader's creation is indistinguishable from ours.

**2. The sandboxed capability tier — (c) — as the pressure valve, later, behind the same switch.** V1: the `ModeContext` bridge into a worker, generated TS against it, kit-only rendering. End state: the mode ecosystem's power-user layer, and the proving ground for new capabilities before they harden into DSL vocabulary. Killed by: the bridge tax — if every good code mode needs one more capability than the API has, you're rebuilding the app through a keyhole.

**3. Feature-request → agent-built mode — (e) — as the promotion path only.** V1: the Feedback extension gains "request a mode", an agent drafts a plan into `docs/plans/` like any other work. End state: the graduation ceremony for gallery winners. Killed by: being the *only* path — days of latency where the product needed thirty seconds, and the result is everyone's rather than yours.

Skip: (a) as a standalone (it's day one of #1), (d) entirely, and browser extensions without a backward glance.
