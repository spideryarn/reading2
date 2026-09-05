/**
 * Pipeline stage 3 — split an extracted article into blocks and give each a
 * stable id. See docs/project/architecture.md#pipeline and
 * docs/project/block-ids.md.
 *
 *   npm run blocks -- <slug> [--force]
 *
 * Ids go into the HTML itself (so `#spya-k3m9qt` anchors work with no
 * JavaScript) and into the block rows beside it. Re-running is idempotent: ids
 * already present are kept, only missing ones are minted.
 *
 * **`runBlocks` neither reads nor writes any of that.** It takes the HTML as a
 * string and returns the stamped HTML and the blocks; both callers — the
 * pipeline and `scripts/stage.ts`, which is the same pipeline driven from a
 * terminal — hand them to the artefact store.
 */

/* jsdom is loaded on first use rather than imported here — src/jsdom-lazy.ts
   says why, and it is the largest single thing a cold `GET /api/library` used
   to pay for. `splitIntoBlocks` stays synchronous. */
import { jsdom } from "./jsdom-lazy.js";
import { isSpideryarnId, mintUniqueId } from "./ids.js";
/* The three strings stage 2 stamped into the DOM, from the file that writes
   them. See noteFieldsFor. */
import { BACK_ATTR, CONTAINER_ATTR, NOTE_ATTR, NOTE_ID_PATTERN, REF_ATTR } from "./notes.js";
/* The namespace and the one template-aware scrub, shared with stage 2 — see
   src/reserved.ts, which is the only file allowed to name one of these. */
import { CONTEXT_ATTRS, CONTEXT_ID_PATTERN, RESERVED_ATTRS, scrubReserved } from "./reserved.js";
import { sanitizeInPlace, sanitizeStoredBlocks } from "./sanitize.js";
import { SANITIZER_VERSION } from "./sanitize-policy.js";
/* `Block` and `BlockKind` come from types.ts rather than being declared here.
   This file *writes* blocks.json — the spine every later stage addresses text
   through (docs/project/block-ids.md) — so a second declaration of its shape is
   the one place a silent divergence costs most. There was one until
   2026-08-26: field-for-field identical to types.ts, and nothing checking that
   it stayed so, because pipeline.ts reads only `run.stats` and there is no
   assignment point where the two would ever be compared.

   An `import type` is erased, so this does not put jsdom in anyone's bundle —
   the reason types.ts gives for staying declaration-only still holds. */
import type { Block, BlockContext, BlockKind } from "./types.js";
/* Types only, so nothing runtime crosses from the store into stage 3. Stage 3
   asks the store two questions and does not care which store answers. */
import type { ArtifactKind, ArtifactReads } from "./store/artifacts.js";

/**
 * Blocks are the *finest* unit a reader takes in as one thing, so a `<li>` is a
 * block and the `<ul>` around it is not. Containers become nodes in the tree
 * instead, which is what lets the ToC choose its own granularity: one row for a
 * list of terse bullets, one row per item for a list of real arguments.
 * See docs/project/hierarchy.md#granularity.
 */
const LEAF_BLOCKS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "PRE", "BLOCKQUOTE", "FIGURE", "TABLE", "IMG", "HR", "IFRAME",
]);

/** Descended into, never emitted. */
const CONTAINERS = new Set([
  "DIV", "SECTION", "ARTICLE", "MAIN", "UL", "OL", "DL",
  "HEADER", "FOOTER", "ASIDE", "NAV", "BODY",
]);

/**
 * `IFRAME` is deliberately not here, though it used to be. By the time this
 * runs, src/sanitize.ts has already deleted every iframe except a video embed
 * from an allowlisted origin — so the only ones left are ones Greg decided to
 * keep (2026-08-25), and skipping them here would drop the video out of the
 * reading view while leaving it in the HTML file. That is precisely the bug the
 * allowlist was written to avoid, and it survived until GPT-5's review caught
 * it. Sanitising is what makes this line safe to change.
 */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "FORM", "BUTTON"]);

/**
 * Captions that sit *beside* a figure rather than inside it, so they arrive as
 * ordinary paragraphs. They belong to the image, not to the argument, and a ToC
 * row reading "Figure 2: A modern version of a McCulloch-Pitts neuron…" as a
 * peer of real prose is noise. Matched on the explicit marker only — never on
 * length, because "Given all this, what should we do?" is seven words of
 * genuine argument.
 */
const CAPTION_MARKER = /^(figure|fig\.?|table|chart|diagram|image|photo|plate)\s*\d*\s*[:.—-]/i;

/** Standalone boilerplate labels acting as headings: "Credits", "Sources". */
const BOILERPLATE_LABEL = /^(credits?|sources?|notes?|references?|photo credits?)$/i;

/**
 * Fold text down to what two extractions of the same paragraph agree on: case,
 * punctuation and whitespace all drift between Readability runs, so none of
 * them can be part of a match key.
 *
 * Until 2026-08-26 this was `[^a-z0-9 ]`, which is a correct spelling of
 * "punctuation" only if the only text you have ever looked at is English. In
 * Cyrillic, Greek, Chinese, Arabic or Devanagari it deleted the paragraph, and
 * every one of the five resulting failures reported success — see
 * docs/postmortems/260826d-block-id-matching-non-latin.md.
 *
 * `NFKC` first is load-bearing rather than tidy: `\p{M}` is kept so Devanagari
 * matras and Arabic diacritics survive, which means NFD `café` (e + U+0301)
 * would otherwise key differently from NFC `café`. NFKC composes them. It
 * changes string length, which is fatal in src/quote-match.ts — that file
 * hand-rolls a length-preserving fold because it derives offsets — but nothing
 * here derives offsets, so it is available to us.
 *
 * Whitespace is collapsed *after* the strip, not before, so `and — as` and
 * `and as` agree; stripping the dash first leaves a double space behind.
 */
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();

/**
 * Is there anything here at all?
 *
 * A different question from "what is this text's match key", and it has to be
 * asked separately. `normalize` folds `★ ★ ★` and `©` to nothing, so a
 * paragraph made of symbols reads as empty to it — and three call sites used to
 * take that answer as permission to drop the paragraph.
 *
 * Bare `/\S/` is not the test, though, which is what the first version of this
 * used. A zero-width space, a soft hyphen and a lone variation selector are all
 * non-whitespace and all render as nothing, so `<span>&#8203;</span>` became a
 * paragraph and `<p><img>&#8203;</p>` stopped being an image-only one. Every
 * one of those is `Default_Ignorable_Code_Point`, which is precisely the
 * category "present in the text, absent from the page".
 */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const hasContent = (s: string) => /\S/u.test(s.replace(IGNORABLE, ""));

/** Lists nested directly inside this element. */
const nestedLists = (el: Element) =>
  Array.from(el.children).filter((c) => c.tagName === "UL" || c.tagName === "OL");

/**
 * An `<li>` holding a nested list is a leaf *and* a container: "Nested outer"
 * is its own readable unit, and the items beneath it are separate ones. We emit
 * the item's own content as a block and descend into the sublist, so every item
 * at every level is addressable. Without this the sublist is swallowed into its
 * parent's text and cannot be linked to at all.
 *
 * The block's text and html come from a clone with the sublists stripped, so no
 * two blocks ever contain the same text — the flat sequence the tree ranges
 * over must not overlap.
 */
function ownContent(el: Element): Element {
  const nested = nestedLists(el);
  if (nested.length === 0) return el;
  const clone = el.cloneNode(true) as Element;
  for (const child of nestedLists(clone)) child.remove();
  return clone;
}

/** The separator insertion, shared by both branches of `extractText`. */
const BOUNDARY_TAGS = "p,div,br,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th,tr";

/**
 * The mark `codeText` puts where a line break belongs, before deciding whether
 * one is already there.
 *
 * A NUL, because the HTML parser rewrites any literal U+0000 in a document to
 * U+FFFD before we ever see it — so this cannot collide with the page's own
 * text, which a sentinel of any printable character could. It never survives:
 * every one of them is consumed by the collapse below.
 */
const INSERTED_BREAK = "\u0000";

/**
 * A run of break signals — inserted marks, the source's own newlines, and the
 * trailing spaces between them — taken together, because how many line breaks
 * they add up to cannot be decided one at a time.
 *
 * Leading indentation is deliberately outside the run: `[ \t]*` appears only
 * *before* a newline or a mark, never after one, so `<pre>if x:<br>    return`
 * keeps its four spaces.
 */
const BREAK_RUN = new RegExp(
  `(?:[ \\t]*[\\n${INSERTED_BREAK}])*[ \\t]*${INSERTED_BREAK}(?:[ \\t]*[\\n${INSERTED_BREAK}])*`,
  "gu",
);

/**
 * **In a `<pre>`, whitespace is the content**, so this branch exists.
 *
 * `extractText` below ends `.replace(/\s+/g, " ")`, which is right for prose —
 * a newline in the markup is not a newline in the sentence — and destroys the
 * only structure code has. It had no `<pre>` branch until 2026-09-05, though
 * `classify` has known since it was written that `PRE` is `kind: "code"`.
 *
 * **545 blocks changed** when this branch was added, over the 21 fixtures that
 * had a pre-change baseline to diff against (11,656 blocks along the shipping
 * route; evals/extraction/block-census.mts --cut pre-0904): RFC 9110's
 * request/response examples and its ABNF as one unbroken line each, man(2)'s
 * column layout, and all 400 of Whitman's poems, which Project Gutenberg sets in
 * `<pre>`. `html` was intact throughout, so the reading view was fine
 * (src/web/TableView.tsx renders `block.html`) and the damage was to everything
 * that reads `text`: word counts, search, every AI prompt.
 *
 * **Blank lines are kept, and this paragraph is here because they briefly were
 * not.** The first version of this function filtered them out, arguing that
 * `articleWithIds` and `articleText` (src/article-prompt.ts) join blocks with
 * `"\n\n"`, so a block carrying a blank line would split itself in two inside a
 * prompt and the second half would arrive with no `[i] spya-…:` prefix for a
 * citing stage to hang it on. **That argument was wrong and is retracted** (GPT
 * Sol, 2026-09-05): nothing in production parses those prompts by splitting on
 * `"\n\n"`, and Ideas and Quiz — the two stages that cite a block id as evidence
 * — validate that the text they quote occurs in the block they cite, so the
 * misattribution cannot land there. What the deletion cost was real and
 * measured: 223 of 674 corpus code blocks have an internal blank line, and 153
 * of Whitman's 400 poem blocks lost their stanza breaks. A stanza break is
 * meaning.
 *
 * **The residual risk, recorded rather than designed around:** Sketch validates
 * the cited id alone, so a model could in principle attribute the second half of
 * a blank-line-bearing block to the id that follows it. If that ever shows up in
 * a Sketch, the fix is one change to the framing in `articleWithIds` — indent or
 * fence the continuation lines — and not a second mutilation of the canonical
 * text, which four other consumers read.
 *
 * **Rooted at the `<pre>` itself, and no wider — which leaves two shapes still
 * broken, named here so they are a limitation rather than a surprise.**
 *
 *  - **A `<pre>` inside a `<blockquote>`** never reaches this function. The
 *    blockquote is terminal (`collectElements` below does not descend into one),
 *    so quoted code takes the prose branch and loses its indentation and its
 *    line breaks together. Pinned in tests/block-text-fidelity.test.ts so that
 *    whoever fixes it changes an expectation rather than nothing.
 *  - **A `<pre>` containing a `<table>`** gets a break before every `td`, `th`
 *    and `tr` — so cells land on their own lines, the row structure is gone, and
 *    text following the table is glued to the last cell, because nothing inserts
 *    a break *after* an element.
 *
 * Fixing either properly means giving `extractText` a real recursive
 * layout-aware walk instead of a flat separator insertion. Not today.
 *
 * The narrow fix is the one that can be shown inert: over the same corpus,
 * **0 non-code blocks changed** and nothing's tag, kind or `gistable` moved —
 * diffed before and after rather than argued.
 *
 * **Ids do not churn, and that had to be checked rather than assumed**, because
 * `text` is what a block is matched on across a re-extraction. `exactKey`
 * normalises whitespace itself before hashing (`/\s+/gu` → `" "`), so the key is
 * computed from the collapsed form either way and every id carries. Pinned in
 * tests/block-text-fidelity.test.ts. **`hashBlocks` is a different matter** and
 * does change for every code-bearing article — see the plan doc, § A.
 */
function codeText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  /* A line break inside a `<pre>` can be spelled three ways: a real newline in
     the text (which needs nothing), a `<br>`, or one element per line, which is
     what every syntax highlighter emits. The last two carry no newline at all,
     so `textContent` alone would glue `alpha` to `beta`. */
  for (const n of Array.from(clone.querySelectorAll(BOUNDARY_TAGS))) {
    n.insertAdjacentText("beforebegin", INSERTED_BREAK);
  }
  return (
    (clone.textContent ?? "")
      .replace(/\r\n?/gu, "\n")
      /* **An inserted break where the source already had one is the same
         break**, and two of them at the same position are still one.

         Markup indented as `<div>a</div>\n<div>b</div>` carries a real newline
         between the divs, and a highlighter that nests a per-line `<div>` inside
         a wrapper `<div>` opens two elements at one spot. Inserting
         unconditionally would put a blank line into the reader's prompt that the
         page does not show and the author did not write — which, now that blank
         lines are kept, is no longer harmlessly filtered out downstream.

         So a run counts as **as many breaks as it has real newlines, and at
         least one**. The cost is a `<br>` written next to a literal newline,
         which reads as one break rather than two: rare, and the safer of the two
         directions to be wrong in. */
      .replace(BREAK_RUN, (run) => "\n".repeat(Math.max(1, (run.match(/\n/gu) ?? []).length)))
      /* **Blank lines at the ends are markup; blank lines in the middle are
         content.** `</code>\n</pre>` is how a page is indented, not something
         the author wrote. Trimmed line-wise rather than with `.trim()`, which
         would take the first line's indentation off — the thing this function
         exists to keep. */
      .replace(/^(?:[ \t]*\n)+/u, "")
      .replace(/(?:\n[ \t]*)+$/u, "")
  );
}

/**
 * Text with block boundaries preserved as spaces. Bare `textContent` runs
 * adjacent blocks together — a blockquote of two paragraphs comes out as
 * "…sentence one.Sentence two…" — which corrupts word counts and any gist
 * written from it.
 *
 * `<pre>` takes the other branch; `codeText` above says why.
 */
function extractText(el: Element): string {
  if (el.tagName === "PRE") return codeText(el);
  const clone = el.cloneNode(true) as Element;
  for (const n of Array.from(clone.querySelectorAll(BOUNDARY_TAGS))) {
    n.insertAdjacentText("beforebegin", " ");
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * **Characters that take up no room and say nothing** — and a `<p>` holding
 * only these is an empty paragraph however many of them there are.
 *
 * `describeBlock` asked `text.length === 0`, which is true of `<p>   </p>` —
 * `extractText` collapses and trims — and **false of `<p>&#8203;</p>`, because
 * a zero-width space is not `\s`. One block of one invisible character then went
 * to the ToC, the summaries and the granularity-zoom tree as content. One French
 * Wikipedia page in the trawl carries 181 empty paragraphs.
 *
 * Deliberately only the invisible family, not "has no letter or number": a
 * block whose text is `€`, `→` or `1–0` is a block a reader can see, and
 * 260830at's ≤6-character rule is exactly the shape this repo has already been
 * wrong with twice. Soft hyphen is included because it renders as nothing unless
 * the line happens to break there; the bidi marks are included because a run of
 * them alone is a formatting artefact, never a passage.
 *
 * `gistable` is not in `hashBlocks` (src/source-hash.ts), so changing this
 * invalidates no cached artefact — but for the same reason it will not
 * *re*-classify an article until something else re-runs stage 3.
 */
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/gu;

const isBlank = (text: string): boolean => text.replace(INVISIBLE, "").trim().length === 0;

function classify(el: Element): { kind: BlockKind; level?: number } {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return { kind: "heading", level: Number(tag[1]) };
  if (tag === "PRE") return { kind: "code" };
  if (tag === "BLOCKQUOTE") return { kind: "quote" };
  if (tag === "FIGURE" || tag === "IMG" || tag === "HR" || tag === "IFRAME") {
    return { kind: "media" };
  }
  if (tag === "TABLE") return { kind: "other" };
  return { kind: "text" };
}

/**
 * What kind of block this is, and whether the ToC should write a row about it.
 *
 * `classify` answers from the tag alone; this is everything that needs the text
 * as well. Split out of `splitIntoBlocks` so the id-assignment logic and the
 * gistable rules can each be read without the other.
 */
function describeBlock(
  el: Element,
  text: string,
  proseText: string[],
): { kind: BlockKind; level: number | undefined; gistable: boolean; note: string | undefined } {
  let { kind, level } = classify(el);
  let gistable = true;
  let note: string | undefined;

  if (kind === "media" || el.tagName === "HR") {
    gistable = false;
    note = "media";
  } else if (el.tagName === "P" && isImageOnly(el)) {
    kind = "media";
    gistable = false;
    note = "image-only paragraph";
  } else if (isBlank(text)) {
    gistable = false;
    note = "empty";
  } else if (CAPTION_MARKER.test(text)) {
    kind = "caption";
    gistable = false;
    note = "figure caption";
  } else if (BOILERPLATE_LABEL.test(text)) {
    gistable = false;
    note = "boilerplate label";
  }

  /* **A context changes no policy, and that is a rule rather than an
     oversight.** For half a day this line read `context !== undefined ||`, so a
     callout repeating body text was demoted to `gistable: false` — which reads
     as tidy and quietly wires presentation into the argument machinery.

     The consequence was concrete, and GPT Sol traced it: `gistable` is not in
     `hashBlocks` (src/source-hash.ts), so a publisher removing a callout
     wrapper flipped a block from `false` back to `true` with the article's
     fingerprint unchanged — same tag, same text, same id — and the hierarchy
     step, which has no currency stamp of its own, skipped. The paragraph came
     back into the argument with no navigation label and nothing said so.

     The fix is not a bigger fingerprint. It is that a box drawn round a
     paragraph is how it is *set*, and the five policy questions stay with
     `gistable` and `treatment` (src/block-policy.ts), exactly as
     docs/plans/260831af-carrying-markup-facts-past-readability.md says. A real
     pull-quote is a `<blockquote>` or lives in a `<figure>`, and both were
     already covered before callouts existed. */
  // Pull-quotes repeat a sentence that is already in the prose. Giving them
  // gists would put the same claim in the ToC twice.
  if (gistable && (kind === "quote" || el.closest("figure"))) {
    const probe = normalize(text).slice(0, 60);
    if (probe.length >= 30 && proseText.some((p) => p.includes(probe))) {
      gistable = false;
      note = "pull-quote duplicating body text";
    }
  }

  return { kind, level, gistable, note };
}

/**
 * **The box the author drew round this block, read off stage 2's stamp**
 * (src/callouts.ts) — the class that said so is gone by now, deleted with the
 * `<div>` it was on before Readability handed us the page.
 *
 * **A context, not a `kind`, and that distinction is the whole point.** `kind`
 * is what this block *is* — the granularity tree is built from heading levels,
 * and a `<blockquote>` in a box is still a quotation — while a context is the
 * authored grouping it *belongs to*. `kind: "callout"` was shipped first and was
 * wrong in a way that showed immediately: a heading inside a callout has to keep
 * `kind: "heading"`, and so lost the box altogether.
 * docs/plans/260831af-carrying-markup-facts-past-readability.md.
 *
 * `closest` rather than `hasAttribute`, because the stamp is on the container
 * *and* on the block-level elements inside it, and which of the two survives
 * Readability depends on the page.
 *
 * The id is re-validated here even though we minted it a stage ago: this is the
 * seam where a string stops being a DOM attribute and becomes a value in
 * `blocks.json`, Postgres and the public payload, and the scrub at stage 2 is
 * the only thing standing between those and a page that wrote its own.
 */
function contextFor(el: Element): BlockContext | undefined {
  /* **The registry, not a second hard-coded `"callout"`.** `CONTEXT_ATTRS` maps
     each transport attribute to the context type it means, and until the typed
     sidecar exists that map *is* the type system for this — so a reader that
     spells the type again is the drift the map was added to prevent. GPT Sol
     noticed the map was exported and unused, 2026-08-31. */
  for (const { attr, type } of CONTEXT_ATTRS) {
    const id = el.closest(`[${attr}]`)?.getAttribute(attr);
    if (id && CONTEXT_ID_PATTERN.test(id)) return { id, type };
  }
  return undefined;
}

/** What `noteFieldsFor` can add to a block. All three absent for body prose. */
type NoteFields = Pick<Block, "role" | "treatment" | "noteId">;

/**
 * Whether this block is apparatus rather than argument, read off the stamps
 * stage 2 left in the DOM (src/notes.ts).
 *
 * **An ancestor lookup, not a check for the stamp itself, and that is the whole
 * point.** A note is a *range* of blocks: gwern has 34 notes and 118
 * block-level elements inside the notes container, so classifying only the
 * elements carrying `data-spya-note` would leave 84 blocks of footnote prose
 * classified as argument — summarised, embedded, and on the clock — with every
 * count still looking plausible. Measured, docs/plans/260828o-footnotes.md.
 *
 * A block is a supplement because it is **inside the container**; it belongs to
 * a note because a `[data-spya-note]` ancestor says which. The container is
 * asked first so that a stamp somewhere else in the document — which stage 2
 * never produces — cannot pull a paragraph out of the argument on its own.
 *
 * **Where the forgery defence lives, because it is not here.** These attributes
 * are ours and therefore forgeable, and stage 3 cannot tell one of ours from a
 * page's. The scrub is at stage 2, where the untrusted document arrives:
 * `scrubReserved` takes every copy off before a single one of ours is written,
 * and it runs unconditionally, before the "no candidates" early return. So the
 * rule stage 3 depends on is that **`splitIntoBlocks` is only ever handed HTML
 * that has been through `canonicaliseNotes`** — which today is the whole of
 * `runExtract`, its only production caller. `NOTE_ID_PATTERN` is the belt: a
 * value that is not the ten hex digits stage 2 mints is not carried, so nothing
 * a page wrote can reach blocks.json, Postgres or the public payload as an id.
 *
 * Only `"footnote"` is assigned. See `Block.role` for why the other four exist.
 */
function noteFieldsFor(el: Element): NoteFields {
  if (el.closest(`[${CONTAINER_ATTR}]`) === null) return {};
  const noteId = el.closest(`[${NOTE_ATTR}]`)?.getAttribute(NOTE_ATTR);
  return {
    role: "footnote",
    treatment: "supplement",
    ...(noteId && NOTE_ID_PATTERN.test(noteId) ? { noteId } : {}),
  };
}

/** A `<p>` whose only real content is an image is a media block, not prose. */
function isImageOnly(el: Element): boolean {
  return (
    el.querySelector("img") !== null && !hasContent(el.textContent ?? "")
  );
}

/**
 * Wrap loose text sitting directly inside a container in a `<p>`, so it becomes
 * addressable instead of vanishing.
 *
 * `walk` iterates `el.children`, which is elements only — so a bare text node
 * between two containers is invisible to it and its words never reach any
 * block. That was survivable while every wrapper the author wrote survived to
 * this point, because the text always had *some* element around it. Sanitising
 * broke that assumption: DOMPurify drops an unrecognised tag but keeps its
 * contents, so `<x-article>real prose</x-article>` — the kind of custom element
 * a modern CMS emits, which Readability passes through untouched — arrives here
 * as naked text and used to be silently dropped, along with whatever id it
 * carried. GPT-5's review caught it, 2026-08-25.
 *
 * Done here rather than in a pass of its own so it inherits `walk`'s decision
 * about what counts as a container: the only elements this touches are ones we
 * were about to descend into and emit nothing for.
 */
function rewrapOrphanText(el: Element): void {
  const doc = el.ownerDocument;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== 3) continue; // TEXT_NODE
    if (!hasContent(node.nodeValue ?? "")) continue;
    const p = doc.createElement("p");
    el.replaceChild(p, node);
    p.appendChild(node);
  }
}

function collectElements(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    rewrapOrphanText(el);
    for (const child of Array.from(el.children)) {
      const tag = child.tagName;
      if (SKIP.has(tag)) continue;
      if (LEAF_BLOCKS.has(tag)) {
        out.push(child);
        // A list item is the one leaf that can contain further blocks.
        if (tag === "LI") for (const sublist of nestedLists(child)) walk(sublist);
        continue; // otherwise never descend into a leaf
      }
      if (CONTAINERS.has(tag)) {
        walk(child);
        continue;
      }
      // Unknown wrapper: descend if it holds block-level children, else treat
      // it as a block so no content silently disappears.
      const hasBlockChildren = Array.from(child.children).some(
        (c) => LEAF_BLOCKS.has(c.tagName) || CONTAINERS.has(c.tagName),
      );
      if (hasBlockChildren) walk(child);
      else if (hasContent(child.textContent ?? "")) out.push(child);
    }
  };
  walk(root);
  return out;
}

/**
 * **How many ids survived** between two runs of stage 3 over the same article.
 *
 * The one number that says what a change to extraction, to `extractText` or to
 * a repair pass actually costs, because a re-minted id is not a cosmetic
 * difference: every comment, highlight, saved reading position, ToC row and
 * search hit addresses text by block id (docs/project/block-ids.md), and a
 * block that comes back with a fresh one has quietly taken all of them with it.
 * Nothing raises. So this is instrumentation, deliberately separate from
 * `SplitResult.stats` — those are one run's own counters and cannot compare two.
 *
 * `IdsNotCarried` further down is the *guard* on the same quantity, and it asks
 * a different question: it refuses a run that kept none. This one only counts,
 * so an eval can report a number without a threshold in it — which is what
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md needs
 * before it can argue about whether a repair is worth its churn.
 *
 * `Pick<Block, "id">`, not `Block`, so a bare `{ id }` row out of Postgres and a
 * full block list both satisfy it and neither caller has to widen a query.
 *
 * - `carried` — in both runs.
 * - `reminted` — in the second run only: a block whose text or tag changed
 *   enough that `exactKey` and `foldedKey` both refused to match it.
 * - `lost` — in the first run only: the passage is gone from the article, or it
 *   merged into another block.
 *
 * `reminted + lost` is the churn; `carried` alone means nothing without
 * `before`, which is why all five fields are returned rather than a ratio.
 */
export function idChurn(
  before: readonly Pick<Block, "id">[],
  after: readonly Pick<Block, "id">[],
): { before: number; after: number; carried: number; reminted: number; lost: number } {
  const was = new Set(before.map((b) => b.id));
  const now = new Set(after.map((b) => b.id));
  let carried = 0;
  for (const id of now) if (was.has(id)) carried += 1;
  return {
    before: was.size,
    after: now.size,
    carried,
    reminted: now.size - carried,
    lost: was.size - carried,
  };
}

export interface SplitResult {
  blocks: Block[];
  html: string;
  stats: {
    total: number;
    reused: number;
    carried: number;
    minted: number;
    /** Internal links repointed from the author's id to ours. retargetAnchors. */
    retargeted: number;
    gistable: number;
  };
}

/**
 * Ids already present in the HTML survive a re-run of this stage. They do NOT
 * survive a re-run of *stage 2*, which writes a fresh document from Readability
 * with no ids in it at all — and re-extraction is exactly the case random ids
 * exist to protect against (block-ids.md#why-random-and-not-sequential).
 *
 * So when the previous run's blocks are available — `previousBlocksFrom` below
 * gets them from the store — we re-attach ids by matching
 * block text. A paragraph keeps its id for as long as its words are unchanged,
 * regardless of what was inserted above it. An edited paragraph gets a fresh id
 * and loses its annotations — that is a real limit, and honest: we cannot tell
 * a heavily rewritten paragraph from a new one.
 *
 * Matching is first-come over the previous document's order, and each previous
 * id is consumed once, so a page with several identical short paragraphs can't
 * hand the same id to two blocks.
 */
/**
 * Pass one's key: the tag, plus the text as written with whitespace collapsed.
 * Two runs that produced the same paragraph agree here.
 *
 * **The tag is in the key because the text alone is not enough**, which GPT
 * Sol's review of the first version of this file caught: `<h2>Same words</h2>`
 * and `<p>Same words</p>` keyed identically, so re-rendering them the other way
 * round swapped their ids and reported `carried: 2`. Two paragraphs that really
 * do read alike still share a key, and still take their ids in order — that is
 * correct, because they *are* alike, and minting instead would drop the ids of
 * every repeated `<li>Yes</li>` on the page.
 */
/**
 * A block's words with every footnote control taken out of them, and the notes
 * it is attached to named instead.
 *
 * **Why the key cannot just be the text.** `extractText` walks `textContent`,
 * so a marker's own digits are in `Block.text`. An author inserting one note
 * near the top of a piece shifts every later marker `7 → 8`, and every
 * paragraph below keys differently while not one word of its prose has changed:
 * fresh ids, orphaned comments, a saved position pointing at nothing. Same for
 * a note block, whose author-written back-links Wikipedia numbers `1 2 3`, one
 * per place it is cited.
 *
 * **Nodes, never text patterns**, which is the part a naive fix gets wrong. A
 * marker is not always a digit — letters, stars and roman numerals all occur —
 * and a leading number can be a note's own first word ("1970 was the year…").
 * So what is removed is what stage 2 stamped: `REF_ATTR` on a marker and
 * `BACK_ATTR` on a back-link, both of them written by us and nowhere else
 * (src/notes.ts).
 *
 * **And the notes are folded back in**, because stripping alone is too
 * permissive: two otherwise identical paragraphs citing *different* notes would
 * collapse into one bucket and trade ids, and a citation repointed at another
 * note would keep an id that now sits on a paragraph meaning something else.
 * `noteId` is already a hash of the note's own prose, so the fingerprint costs
 * nothing to compute: if only the numbering changed the id is carried, and if
 * the target or the note's words changed a fresh one is minted.
 *
 * **Read from `html`, and from nothing else.** This runs over stored `Block`s on
 * one side and this run's candidates on the other, and it has to agree with
 * itself across them or nothing matches and every article in the database is
 * re-minted at once — which looks exactly like an article that changed. The
 * candidate's html is read before its id is written and before `retargetAnchors`
 * repoints its hrefs, so `id` and `href` are the two things the two sides
 * disagree about; the stamps are `data-*`, are what both sides carry
 * identically, and are measured to survive into `blocks.json`
 * (tests/note-carry-over.test.ts).
 *
 * A block with no stamp in its html returns its text untouched and an empty
 * fingerprint, so its key is byte-for-byte the one it had before any of this —
 * which is every block of every article ingested before stage 2 existed.
 */
/**
 * Might this html hold one of stage 2's stamps? Built from the constants rather
 * than re-spelled, so a rename cannot leave it quietly matching nothing, and
 * case-insensitive because an attribute name in HTML is.
 *
 * It is a cheap gate and not an answer: prose that merely contains the words
 * gets parsed and then found to have no stamp, which is why the parse returns
 * the caller's own text in that case rather than its own re-derivation.
 */
const MIGHT_BE_STAMPED = new RegExp([REF_ATTR, BACK_ATTR, NOTE_ATTR].join("|"), "i");

/**
 * A note's identity for keying: its content digest, without the counter.
 *
 * `mintNoteId` appends `-2`, `-3` to whichever duplicates of a note come later
 * in the document, so three notes reading "Ibid." are `h`, `h-2`, `h-3` — and
 * inserting a fourth above them rotates all three. That counter is a **position**,
 * and this whole stage exists because a position is not an identity. Two notes
 * that say the same words are the same note as far as a citing passage is
 * concerned. GPT Sol's blocker 1, reproduced in tests/note-carry-over.test.ts.
 */
const digestOf = (noteId: string): string => NOTE_DIGEST.exec(noteId)?.[1] ?? noteId;

/**
 * The **fixed ten-hex field**, captured — never the tail, chopped.
 *
 * `replace(/-\d+$/, "")` reads as "take the counter off" and is not: a digest
 * that happens to be all digits *is* the thing that matches, so
 * `spya-note-9417977611` came back as `spya-note` and every note whose hash
 * began that way shared one identity. About one in a hundred, and GPT Sol found
 * two in the corpus within minutes. A structure is parsed by its structure.
 */
const NOTE_DIGEST = /^(spya-note-[0-9a-f]{10})(?:-\d+)?$/;

interface NoteKeyParts {
  /** The block's words with every recognised control node taken out. */
  text: string;
  /** The notes it belongs to, then the notes it cites, in document order. */
  ids: string[];
  /** Whether a stamp was actually found, which the gate alone cannot say. */
  stamped: boolean;
}

function withoutNoteControls(text: string, html: string): NoteKeyParts {
  if (!MIGHT_BE_STAMPED.test(html)) return { text, ids: [], stamped: false };
  const root = jsdom().JSDOM.fragment(html).firstElementChild;
  if (root === null) return { text, ids: [], stamped: false };

  /* Which notes this block *is part of* — its own, plus any note whose
     back-link sits in it. A set, because Wikipedia writes one back-link per
     place a note is cited and a note gaining a fourteenth citation has not
     changed identity. */
  const belongs = new Set<string>();
  /* Which notes it *cites*, in document order and with repeats, because
     reordering or duplicating a citation is a change to what it asserts. */
  const cites: string[] = [];

  const own = root.getAttribute(NOTE_ATTR);
  if (own !== null && NOTE_ID_PATTERN.test(own)) belongs.add(digestOf(own));

  for (const el of Array.from(root.querySelectorAll(`[${REF_ATTR}], [${BACK_ATTR}]`))) {
    const ref = el.getAttribute(REF_ATTR);
    const back = el.getAttribute(BACK_ATTR);
    /* Not the attribute's presence — the shape stage 2 mints. A value that is
       not one of ours is a page's own text wearing our attribute, and the safe
       thing to do with an element we do not recognise is **leave it alone**:
       removing it while contributing no identity would collapse two blocks that
       differ only in the control we deleted. */
    if (ref !== null && NOTE_ID_PATTERN.test(ref)) cites.push(digestOf(ref));
    else if (back !== null && NOTE_ID_PATTERN.test(back)) belongs.add(digestOf(back));
    else continue;
    el.remove();
  }

  const ids = [...[...belongs].sort(), ...cites];
  /* Nothing recognised: the gate fired on prose that merely says the words. The
     caller's own text goes back untouched, so the key is the one it always had. */
  if (ids.length === 0) return { text, ids, stamped: false };
  return { text: extractText(root), ids, stamped: true };
}

/**
 * The key's shape, and it is load-bearing rather than cosmetic.
 *
 * `x:p:n[<id>]prose` was ambiguous: an *unstamped* block whose prose literally
 * began `n[<id>]` spelled the same string as a stamped block citing that note,
 * so the migration fallback below could reach a stamped block and take the id of
 * a passage that had not changed. GPT Sol's blocker 2, reproduced in
 * tests/note-carry-over.test.ts.
 *
 * So the fields are counted and delimited: a tag holds no `:` and a note id
 * holds neither `:` nor `,`, so every field boundary is fixed and the encoding
 * is injective, and no prose can spell a key that is not its own.
 *
 * **The stamped flag is redundant today, and is here on purpose.** `stamped` is
 * true exactly when `ids` is non-empty, so the count already separates the two
 * families — a legacy key is always `0:0:`. Probing it out reddens nothing, and
 * that is worth saying rather than leaving the flag looking like the guard that
 * holds the line. It is insurance against one specific future edit: change what
 * contributes an id — stop back-links from doing it, say — and a stamped block
 * could key with a count of zero and quietly re-merge the namespaces. The flag
 * cannot be broken by that change. The guard actually doing the work is the
 * legacy bucket's filter, in `carryOverIds`.
 */
const keyOf = (tag: string, parts: NoteKeyParts, written: string): string =>
  `x:${tag}:${parts.stamped ? 1 : 0}:${parts.ids.length}:${parts.ids.join(",")}:${written}`;

/**
 * The prefix that says "this key is a position, not a description" — named
 * rather than spelled twice, because `carryOverIds` treats such a bucket
 * differently and a typo there would silently turn the rule off.
 */
const EMPTY_KEY = "e:";

/**
 * **Nothing inside it at all** — no text, no `src`, and no child element either.
 *
 * The third clause is the one with a bug behind it. `<hr>`, `<p></p>` and
 * `<figure>\n \n</figure>` are interchangeable with any other block of their tag:
 * there is nothing in them to tell two apart, so matching them by position is
 * matching them on the only thing they have. **`<figure><svg>…</svg></figure>`
 * is not**, and it reaches this function looking identical, because a bare
 * `<svg>` has no text and no `src` — so keying it by tag alone put the circle's
 * id on the rectangle when a page reordered two diagrams, with `minted: 0` and
 * an unchanged fingerprint to say everything was fine. GPT Sol found it and
 * reproduced it, 2026-09-05, and block-ids.md § *A bare `<svg>` gets no id* is
 * explicit that a figure-wrapped diagram is a thing Hierarchy points at.
 *
 * So a text-less block **with markup in it** goes on minting, exactly as it did
 * before any of this: a lost anchor is safer than a moved one, and keying it
 * properly means a structural digest of the html with our own ids normalised out
 * of it — a bigger change, weighed and deferred in
 * docs/postmortems/260905a-empty-blocks-remint-their-ids-on-every-extraction.md.
 *
 * **The attributes and the inner text are part of the answer, not stripped from
 * it** — `class` and `data-*` survive the sanitiser, so `<hr
 * class="section-break">` is not a plain `<hr>`, and `<p>&#160;</p>` draws a
 * blank line where `<p></p>` draws nothing. The encoding, and why `id` is the
 * one attribute left out, are in the body.
 *
 * Parsed rather than pattern-matched: an attribute value can carry a `<`
 * in it and this is the file that has been wrong about "counts as text" twice.
 * Only reached for a block that has already been found to have no text and no
 * `src`, so it costs nothing on ordinary prose.
 */
function emptyKey(tag: string, html: string): string | null {
  const root = jsdom().JSDOM.fragment(html).firstElementChild;
  if (root === null || root.children.length > 0) return null;
  /* **`id` is left out, and that is a decision with a measured price on both
     sides.** It is the one attribute the two sides are guaranteed to disagree
     about: by the time a block is stored, `splitIntoBlocks` has overwritten the
     author's `id` with ours, so a stored `<hr>` no longer knows it was
     `#section-break-2` while the candidate still does. Leaving it out is the
     only way the two can agree at all.

     What that concedes is narrow, and is stated rather than left to be found:
     **two empty blocks of the same tag differing only in an id the author wrote
     will trade ids if a page reorders them.** GPT Sol argued the other branch —
     refuse such a block, let it mint (2026-09-05) — and it was measured rather
     than argued: refusing leaves **33 blocks re-minting on 3 of the 35 corpus
     fixtures** (rfc9110's named empty `<li>`s, distill's figures), and those
     three go on flipping their fingerprint and go on never reporting the
     `blocks` step done. That is this whole bug, left in place for a tenth of the
     corpus, to buy safety in a case that needs an author to reorder two *empty*
     named blocks of one tag. The author's own anchors are unaffected either way:
     `#section-break-2` is re-resolved from the current document on every run
     (`stampAuthorAnchors`, `retargetAnchors`), never from a stored id. */
  /* `JSON.stringify` of sorted pairs and the inner text together, not
     `name=value` joined by a space, for the reason `keyOf` gives above: a
     delimiter a page can write into an attribute value is not a delimiter.
     `aria-label="x title=y"` and `aria-label="x" title="y"` spell the same
     joined string and are two different rules. JSON escapes, so the encoding is
     injective.

     **`innerHTML` is in it, and is safe to put in it precisely because the
     element has no children.** `<p></p>` and `<p>&#160;</p>` are two different
     paragraphs — the second draws a blank line — and `\s` folds the second to
     nothing, so `written` cannot tell them apart. What is left inside a
     childless element is text, which means none of the things that make the two
     sides of a match disagree about markup: no id of ours, no href
     `retargetAnchors` repointed. That is the whole reason the general
     structural digest is deferred and this narrow one is not. */
  const attrs = Array.from(root.attributes)
    .filter((a) => a.name !== "id")
    .map((a) => [a.name, a.value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${EMPTY_KEY}${tag}:${JSON.stringify([attrs, root.innerHTML])}`;
}

/**
 * **A key, not `null`, for a block with nothing in it** — and until 2026-09-05
 * this returned `null`.
 *
 * A block with no written text and no `src` anywhere in its html — an `<hr>`, an
 * empty `<p>`, an empty `<li>`, a `<figure>` the sanitiser emptied — returned
 * `null` here, and `null` in `foldedKey` and `legacyKey` too. `bucketBy` drops a
 * `null` key, so such a block was in no bucket on **either** side of the match
 * and **re-minted on every run over byte-identical input**: 218 blocks across 17
 * of the 35 corpus fixtures. Pre-existing since `84ce16bf`, and half of what it
 * cost was invisible on the filesystem store, where `extracted === stamped` and
 * the ids are simply reused off the document.
 * docs/postmortems/260905a-empty-blocks-remint-their-ids-on-every-extraction.md.
 *
 * `e:${tag}:${attributes and inner text}` is deliberately the whole key, for
 * exactly the blocks `emptyKey` admits. Position among the identical empty
 * blocks of its own tag is the only signal such a block has, and pass one
 * already hands a shared bucket out in document order, consuming each id once —
 * the same rule that keeps every
 * repeated `<li>Yes</li>`'s id today, and blessed for the same reason:
 * **two blocks that really are alike may trade ids, because they are alike.**
 * Two blocks sharing this key are not merely alike: they are the same element
 * with the same attributes and nothing inside either of them.
 *
 * **Position is only trusted where nothing was inserted or removed.**
 * `carryOverIds` refuses an `e:` bucket outright when the two sides hold
 * different numbers of it, so adding one rule to an article cannot slide every
 * id after it onto the rule below. The reasoning, and the measurement that says
 * the refusal is free, are at that guard.
 *
 * **And "nothing can be anchored to these anyway" is not the argument**, though
 * it was until Sol checked: a chat is anchored by `{ blockId }` alone when it is
 * started from a block's chat button, and `BlockGutter` gives every block one.
 * A comment cannot land here (it needs a quote) and the reading position is a
 * section, not a block — but the reason this stayed machine-side is that nobody
 * had started a chat about a horizontal rule, not that they could not.
 *
 * **Not an ordinal in the key**, which is the obvious other answer: that is the
 * sequential-id failure block-ids.md § *Why random and not sequential* exists to
 * refuse, and it buys nothing this does not.
 */
function exactKey(tag: string, text: string, html: string): string | null {
  const parts = withoutNoteControls(text, html);
  const written = parts.text.replace(/\s+/gu, " ").trim();
  if (written || parts.ids.length) return keyOf(tag, parts, written);
  // Images and rules carry no text, so match them on what they point at —
  // otherwise every figure is re-minted on each re-extraction and any ToC row
  // aimed at a diagram goes stale.
  const src = /\bsrc="([^"]+)"/.exec(html)?.[1];
  if (src) return `s:${tag}:${src}`;
  return emptyKey(tag, html);
}

/**
 * Pass two's key: the same words, once punctuation and case are folded away.
 *
 * **A key with no letter or number in it is not a key**, and returning one is
 * how `❤️` and `☀️` came to share an id: the fold strips both symbols and keeps
 * the variation selector, because U+FE0F is a mark and marks are kept for
 * Devanagari's sake. One old block, one new one, an unambiguous bucket, and
 * completely different content. Anything that folds down to marks and spaces
 * alone gets a fresh id instead.
 */
/**
 * The key a block would have if it carried no stamps at all — its whole text,
 * with nothing stripped and no notes named.
 *
 * Only ever used as a *second* lookup, and only for the migration described at
 * its call site. It is deliberately what an **unstamped** block keys as, because
 * that is what an article split before stage 2 existed is stored as; and because
 * it says `stamped: false`, it can never spell a stamped block's key.
 */
function legacyKey(tag: string, text: string): string | null {
  const written = text.replace(/\s+/gu, " ").trim();
  return written ? keyOf(tag, { text, ids: [], stamped: false }, written) : null;
}

function foldedKey(tag: string, text: string, html: string): string | null {
  /* The same strip and the same fingerprint as pass one, and for the same
     reason. Without it pass two would quietly undo pass one's work: a paragraph
     that correctly minted because it now cites a different note folds to the
     identical string it folded to before, finds a single unambiguous claimant,
     and takes the old id back. */
  const parts = withoutNoteControls(text, html);
  const words = normalize(parts.text);
  if (!words || !/[\p{L}\p{N}]/u.test(words)) return null;
  return `f:${tag}:${parts.stamped ? 1 : 0}:${parts.ids.length}:${parts.ids.join(",")}:${words}`;
}

function bucketBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

interface Candidate {
  tag: string;
  text: string;
  html: string;
}

/**
 * Re-attach previous ids to this run's blocks — the whole reason a
 * re-extraction is survivable, since stage 2 hands us a fresh document from
 * Readability with no ids in it at all
 * (block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters).
 *
 * **Two passes, and the second one refuses to guess.**
 *
 *   pass 1  exact text (or, for a block with none, its src)  → consume the id
 *   pass 2  the folded key, and only where exactly one previous block and
 *           exactly one new block claim it                   → consume the id
 *   else    re-mint
 *
 * Pass one first because it needs no judgement, and because it is what stops
 * two paragraphs trading ids when a re-render merely reorders them. Pass two
 * catches the ordinary drift the fold exists for — a curly apostrophe going
 * straight, an entity decoding differently.
 *
 * The ambiguity rule is the part with design in it. A fold creates equivalence
 * classes the raw text does not have — `Ⅳ` and `IV` both become `iv`, `①` and
 * `1` both become `1` — so a bucket can hold two genuinely different
 * paragraphs, and the old code handed the id to whichever came first. That is
 * not "the id was lost", it is "the reader's note is now attached to a
 * different claim", and block-ids.md is explicit that a lost anchor is the
 * safer failure. So an ambiguous bucket re-mints and says so in `minted`.
 *
 * Runs over the whole document at once rather than block by block, because
 * "is this bucket ambiguous?" cannot be answered until every claimant is known.
 *
 * Returns one entry per candidate: the id it may keep, or undefined to mint.
 */
function carryOverIds(
  previous: Block[] | undefined,
  candidates: Candidate[],
  taken: Set<string>,
): (string | undefined)[] {
  const out: (string | undefined)[] = candidates.map(() => undefined);
  if (!previous?.length) return out;

  const claim = (id: string | undefined): boolean => {
    if (id === undefined || taken.has(id)) return false;
    taken.add(id);
    return true;
  };

  /** The first id in this bucket nobody has taken, consuming what it passes. */
  const takeFrom = (bucket: Block[] | undefined): string | undefined => {
    while (bucket?.length) {
      const next = bucket.shift()!.id;
      if (claim(next)) return next;
    }
    return undefined;
  };

  // Pass one. Each previous id is consumed once, so a page with several
  // identical short paragraphs cannot hand the same id to two blocks.
  const byExact = bucketBy(previous, (b) => exactKey(b.tag, b.text, b.html));
  /* Still a `null` branch, and a narrower one than it was: a text-less block
     gets a key when there is nothing in it to tell it from its neighbours, and
     goes on minting when there is. `exactKey` says why. */
  const keys = candidates.map((c) => exactKey(c.tag, c.text, c.html));

  /**
   * **An empty block is matched on its position, so the two sides must agree
   * about how many positions there are.**
   *
   * A block keyed `e:` has nothing in it: the *only* thing distinguishing the
   * second `<hr>` from the third is which paragraphs it sits between. Consume
   * such a bucket greedily and adding one rule to an article slides every id
   * after it onto the wrong rule — and a chat can be anchored to a block by its
   * id alone, so that is a reader's question re-attached to a different place in
   * the argument, which is exactly what block-ids.md refuses to do.
   *
   * **And refusing costs no fingerprint**, which is what made this decision
   * easy: `hashBlocks` runs over every block, so an article that gained or lost
   * one has a different fingerprint whatever these ids do. The only thing given
   * up is the anchors on the *other* rules, and block-ids.md is explicit that a
   * lost anchor is the safer failure. I argued the other way first — "churn on a
   * real edit" — and GPT Sol was right, 2026-09-05:
   * docs/postmortems/260905a-empty-blocks-remint-their-ids-on-every-extraction.md.
   *
   * **It catches a net change in the count, and no more than that**, which is
   * worth saying plainly because the first version of this comment claimed it
   * meant "nothing was inserted or removed". Delete one rule and add another and
   * the count is unchanged, so the ids slide by one after all. That residual is
   * the same irreducible ambiguity the contract already accepts for two
   * paragraphs that read alike, and it is pinned in
   * tests/empty-blocks-keep-their-ids.test.ts rather than argued away.
   *
   * **Count the ids still going spare, not the whole bucket.** This function is
   * handed only the *pending* candidates — anything already carrying one of our
   * ids in the document was settled before we were called — while the bucket
   * holds every previous block. A part-stamped document (one rule with its id, one
   * without) therefore looked like an article that had lost a rule, and the
   * survivor re-minted for nothing. `taken` is seeded from every id in the
   * document, so "untaken" is exactly "not already spoken for". Sol's finding.
   */
  const wanted = new Map<string, number>();
  for (const key of keys) {
    if (key?.startsWith(EMPTY_KEY)) wanted.set(key, (wanted.get(key) ?? 0) + 1);
  }
  const refused = new Set<string>();
  for (const [key, bucket] of byExact) {
    if (!key.startsWith(EMPTY_KEY)) continue;
    const spare = bucket.filter((b) => !taken.has(b.id)).length;
    if (spare !== (wanted.get(key) ?? 0)) refused.add(key);
  }

  const missed: number[] = [];
  candidates.forEach((_c, i) => {
    const key = keys[i]!;
    const id = key === null || refused.has(key) ? undefined : takeFrom(byExact.get(key));
    if (id === undefined) missed.push(i);
    else out[i] = id;
  });

  /* Pass one-and-a-half: the one-way bridge across stage 2.
   *
   * An article split before `canonicaliseNotes` existed has no stamps in its
   * stored html, so its blocks key on their raw text — marker digits and all —
   * while this run's candidates key on the stripped text and the notes they
   * cite. Nothing would match, and every paragraph citing a note and every note
   * block in the database would be re-minted at once (206 of 356 blocks on
   * wiki_transformer.html, measured 2026-08-29).
   *
   * **Three things keep it one-way**, and the first version had none of them —
   * it reached a stamped block and took the id of a passage that had not
   * changed (GPT Sol's blocker 2, reproduced in tests/note-carry-over.test.ts).
   *
   *  1. The key's encoding: a legacy key is always `0:0:`, so no prose can spell
   *     a stamped block's key. `n[<id>]prose` used to be writable by an
   *     unstamped block, which was the hole.
   *  2. The bucket is built only from previous blocks that **parse** with no
   *     stamp in them, rather than from the whole document.
   *  3. It runs only after **every** candidate has had its exact match, so an
   *     earlier candidate's fallback cannot consume an id that a later one would
   *     have claimed outright.
   *
   * **Measured, rather than assumed: (2) is the one holding the line.** Keep it
   * and probe the other two out, together or singly, and nothing reddens; remove
   * it and three tests fail even with both of the others in place. (1) and (3)
   * are defence in depth against a future edit to this function, not the reason
   * it is correct today, and calling all three load-bearing would have been a
   * guess dressed as a safeguard.
   *
   * It is also what tests/notes-canonical.test.ts requires — turning the pass on
   * must not cost a single note block its id.
   */
  const byLegacy = missed.length
    ? bucketBy(
        previous.filter((b) => !withoutNoteControls(b.text, b.html).stamped),
        (b) => legacyKey(b.tag, b.text),
      )
    : new Map<string, Block[]>();
  const unmatched: number[] = [];
  for (const i of missed) {
    const c = candidates[i]!;
    const legacy = legacyKey(c.tag, c.text);
    const id = legacy === null ? undefined : takeFrom(byLegacy.get(legacy));
    if (id === undefined) unmatched.push(i);
    else out[i] = id;
  }

  // Pass two, over what is left on both sides.
  const byFolded = bucketBy(
    previous.filter((b) => !taken.has(b.id)),
    (b) => foldedKey(b.tag, b.text, b.html),
  );
  const claimants = bucketBy(unmatched, (i) =>
    foldedKey(candidates[i]!.tag, candidates[i]!.text, candidates[i]!.html),
  );
  for (const [key, indices] of claimants) {
    const bucket = byFolded.get(key);
    if (indices.length !== 1 || bucket?.length !== 1) continue; // ambiguous → mint
    if (claim(bucket[0]!.id)) out[indices[0]!] = bucket[0]!.id;
  }

  return out;
}

/**
 * Where the author's own anchor names are parked while the sanitiser runs.
 *
 * Stage 3 has to know an element's *old* name to repoint the links that use it,
 * and there is exactly one window in which to read it: after the sanitiser has
 * decided which elements survive, and before ids are handed out. Those are two
 * different documents — `sanitizeInPlace` replaces `innerHTML`, so every node
 * is re-parsed and nothing can be remembered across it by identity.
 *
 * Hence an attribute, which is text and does survive. DOMPurify keeps `data-*`
 * by default, and keeps these in the very cases the `id` itself is deleted
 * (see stampAuthorAnchors).
 *
 * **Two of them, because `id` and `<a name>` are not equal claims.** The HTML
 * spec resolves a fragment by looking at every `id` in the document *first* and
 * only then at named anchors, so a `name` that matches an `id` elsewhere never
 * wins — and one attribute could not tell the two apart. GPT Sol's review,
 * 2026-08-26.
 *
 * **They are scrubbed twice**, and both matter. Every copy the document arrived
 * carrying is removed before we write ours, so an article cannot forge one; and
 * every one of ours is removed the moment it has been read, which is before a
 * single block's html is serialised. Nothing with these attributes on it has
 * ever reached `blocks.json`, and tests/blocks.test.ts pins that.
 */
const WAS_ID = RESERVED_ATTRS.wasId;
const WAS_NAME = RESERVED_ATTRS.wasName;
/** Both of them as a selector, for reading them back. The scrub is shared. */
const STAMPS = `[${WAS_ID}], [${WAS_NAME}]`;

/**
 * Take every stamp off, **including the ones `querySelectorAll` cannot see.**
 *
 * A DOM query does not enter `<template>`: its children live in a separate
 * document fragment, so `doc.querySelectorAll("[data-…]")` walks straight past
 * them while `outerHTML` serialises them in full. A stamp inside a template
 * therefore survived both scrubs and reached `blocks.json` — inert, but the
 * invariant above said it could not happen, and an invariant that is false is
 * worse than one nobody claimed. Found by GPT Sol's review, 2026-08-26.
 */
function scrubStamps(root: ParentNode): void {
  scrubReserved(root, [WAS_ID, WAS_NAME]);
}

/**
 * Record what each element is called *by the article*, before we rename it.
 *
 * `id` and `<a name>` both, because a named anchor is what a page written
 * before ids were universal uses for the same job, and `href="#note"` cannot
 * tell you which one it is aiming at.
 *
 * Runs **before the sanitiser**, which is the whole point. DOMPurify's
 * `SANITIZE_DOM` deletes any `id` or `name` whose value happens to name a
 * property of `document` or of a form element — `target`, `title`, `name`,
 * `method`, `action`, `links`, `images`, `forms` and a long tail of others. Ids
 * like that are common enough in real headings, and without this pass they are
 * gone before stage 3 has ever seen the element, taking every link to them with
 * them.
 *
 * **The name is also written onto the first child**, and that is not
 * belt-and-braces. The sanitiser deletes elements it does not know while
 * *keeping their contents* — `<x-section id="methods"><h2>Methods</h2>` loses
 * the wrapper and keeps the heading — so a name living only on the wrapper dies
 * with it. Realistic CMS markup, and reproduced by GPT Sol's review,
 * 2026-08-26. When the wrapper survives, both stamps say the same thing and the
 * outer one is read first, so the copy costs nothing and changes no answer.
 *
 * `<html>` and `<body>` are cleared but never stamped. They sit outside the
 * subtree the sanitiser rewrites, so an attribute there crosses it untouched —
 * which is exactly what a forged one would need. Nothing links to `<body>`
 * anyway; `#top` is a fragment the browser handles itself.
 */
function stampAuthorAnchors(doc: Document): void {
  scrubStamps(doc.body);
  for (const root of [doc.documentElement, doc.body]) {
    root?.removeAttribute(WAS_ID);
    root?.removeAttribute(WAS_NAME);
  }
  for (const el of Array.from(doc.body.querySelectorAll("[id], a[name]"))) {
    const id = el.getAttribute("id");
    const name = el.tagName === "A" ? el.getAttribute("name") : null;
    // Ours already: nothing to rename, and nothing to link back to.
    if (id && !isSpideryarnId(id)) stamp(el, WAS_ID, id);
    if (name && !isSpideryarnId(name)) stamp(el, WAS_NAME, name);
  }
}

/** On the element, and on its first child in case the element is unwrapped. */
function stamp(el: Element, attr: string, value: string): void {
  el.setAttribute(attr, value);
  const heir = el.firstElementChild;
  if (heir && !heir.hasAttribute(attr)) heir.setAttribute(attr, value);
}

interface AuthorAnchor {
  el: Element;
  was: string;
  /** `id` beats `name`, always — see WAS_ID. */
  kind: "id" | "name";
}

/** Read the stamps back, in document order, and take them all off again. */
function readAuthorAnchors(doc: Document): AuthorAnchor[] {
  const out: AuthorAnchor[] = [];
  for (const el of Array.from(doc.body.querySelectorAll(STAMPS))) {
    const id = el.getAttribute(WAS_ID);
    const name = el.getAttribute(WAS_NAME);
    if (id) out.push({ el, was: id, kind: "id" });
    if (name) out.push({ el, was: name, kind: "name" });
  }
  scrubStamps(doc.body);
  return out;
}

/**
 * Which block a reader would be looking at if they followed a link to this
 * element — and the order of the four cases is the whole content of it.
 *
 *  1. The element **is** a block. Itself.
 *  2. The element **contains** blocks — `<section id="methods">`, or the nested
 *     `<ul>` inside an `<li>`. Its first one, because that is where the thing
 *     being pointed at begins. This has to be tried before case 3: a nested
 *     list is both inside a block and around one, and the answer the link meant
 *     is the inner one.
 *  3. The element is **inside** a block — a footnote span, an emphasised
 *     phrase. The block containing it, because a block is the finest thing the
 *     reading view can put under your eye.
 *  4. The element is **between** blocks — a standalone `<a name="note"></a>`,
 *     which is what a table's foster-parented anchor also collapses to. The
 *     next block after it, which is where a browser would have landed.
 *
 * Wrappers are the case that most looks like it needs no work and gets it most
 * wrong: their ids survive stage 3 untouched, so the link looks fine, but a
 * wrapper is never in anybody's `block.html` and so is not in the rendered page
 * at all. Cases 2 and 4 both came out of GPT Sol's review, 2026-08-26.
 *
 * Undefined when it resolves to nothing — an element after the last block with
 * nothing inside it — and the link is then left exactly as the author wrote it.
 *
 * `order` is built once for the document rather than walked per anchor. The
 * first version descended each element's subtree with `querySelectorAll("*")`,
 * which is quadratic on nested markup: Sol measured 1.5s on a synthetic page
 * with 750 nested ids, against 188ms for the same page without them.
 */
function blockFor(
  el: Element,
  blockOf: Map<Element, string>,
  blocksInOrder: Element[],
  order: Map<Element, number>,
): string | undefined {
  const own = blockOf.get(el);
  if (own !== undefined) return own;

  const at = order.get(el);
  // Not in the walk at all — nothing sane to say about where it sits.
  if (at === undefined) return undefined;
  const next = blocksInOrder.find((b) => (order.get(b) ?? -1) > at);

  // Case 2 before case 3: the first block after this element is a descendant of
  // it exactly when this element wraps something.
  if (next && el.contains(next)) return blockOf.get(next);
  for (let node = el.parentElement; node; node = node.parentElement) {
    const above = blockOf.get(node);
    if (above !== undefined) return above;
  }
  return next ? blockOf.get(next) : undefined;
}

/**
 * Point the article's own internal links at our ids.
 *
 * A published page links to its own sections — the Anthropic constitution has
 * five, `<a href="#how-we-think-about-corrigibility">` among them — and the
 * target is an `id` the author put on a heading. Stage 3 then gives that
 * heading a spideryarn id and **overwrites the author's**, because a block can
 * only have one id and everything in this project addresses text by ours
 * (docs/project/block-ids.md). The link survives the sanitiser intact and now
 * points at a fragment that exists nowhere in the document, so clicking it puts
 * the fragment in the address bar and moves nothing.
 *
 * Silent in the way this codebase keeps meeting
 * (docs/reusable/silent-success.md): nothing throws, the link still looks like
 * a link, and the article reads fine until someone follows one.
 *
 * So the id is not really destroyed, it is *renamed*, and this renames the
 * references with it. Done here rather than in the client because here is the
 * only place both names are known at once — one stage-3 run later the author's
 * id is gone from the HTML for good.
 *
 * Two things it deliberately does not touch:
 *
 *  - **Links that leave this document.** `href` has to start with `#`. A link
 *    out to `https://example.test/page#section` is a link to somebody else's
 *    page and must stay one. That also means a page that links to *itself* the
 *    long way round — `href="https://this.article/#section"` — is not repaired,
 *    because stage 3 is not told what the article's own address is. No article
 *    we have ingested does that; see docs/plans/260826af-internal-anchor-links.md.
 *  - **Fragments no element answers to.** A dead link stays dead rather than
 *    being pointed somewhere plausible.
 *
 * And on a re-run there is simply nothing to do: every href already says
 * `#spya-…`, no stamp is written for an id of ours, and the map comes out
 * empty. Idempotent, like the rest of the stage.
 *
 * The fragment is compared raw *and* percent-decoded, because an id with a
 * space or a non-ASCII letter in it is written encoded in the href and plain in
 * the attribute.
 */
function retargetAnchors(doc: Document, renamed: Map<string, string>): number {
  if (renamed.size === 0) return 0;
  let count = 0;
  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href");
    if (!href || href.length < 2 || !href.startsWith("#")) continue;
    const fragment = href.slice(1);
    const target = renamed.get(fragment) ?? renamed.get(decodeFragment(fragment));
    if (target === undefined) continue;
    a.setAttribute("href", `#${target}`);
    count++;
  }
  return count;
}

/** `decodeURIComponent` throws on a lone `%`; a malformed fragment is just text. */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function splitIntoBlocks(html: string, previous?: Block[]): SplitResult {
  const { JSDOM } = jsdom();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  /*
   * Before anything reads this document, and before a single id is minted.
   *
   * This is the only gate between a stranger's HTML and the reading view: the
   * client renders `block.html` with dangerouslySetInnerHTML, and Readability
   * upstream is not a sanitiser and does not claim to be. Doing it here rather
   * than in the client means the stored blocks.json is clean, so every later
   * consumer inherits that instead of having to remember. See src/sanitize.ts
   * for what survives and docs/project/security.md for why.
   *
   * Order matters: sanitising first means ids are stamped onto elements that
   * are staying. Sanitising afterwards would mint ids for elements about to be
   * deleted, and the blocks array would list ids that the HTML no longer has.
   */
  /* Before the sanitiser, because the sanitiser deletes some of what this is
     here to read; and read back straight after, because the sanitiser re-parses
     the document and these are the only nodes that outlive it. See WAS_ID. */
  stampAuthorAnchors(doc);
  sanitizeInPlace(doc.body);
  const authored = readAuthorAnchors(doc);
  /* Document order for every element, once. blockFor needs to ask "what is the
     next block after this?" and asking it by walking subtrees is quadratic. */
  const order = new Map<Element, number>();
  Array.from(doc.body.querySelectorAll("*")).forEach((el, i) => {
    order.set(el, i);
  });

  const elements = collectElements(doc.body);

  // Reserve every id already in the document, ours or the author's, so a minted
  // id can never collide with one.
  const taken = new Set<string>(
    Array.from(doc.querySelectorAll("[id]"), (el) => el.id).filter(Boolean),
  );

  /* Prose text, for spotting pull-quotes that merely repeat it.

     **Callouts are back in this list**, which is where they were before they
     were recognised at all: they are ordinary paragraphs as far as this rule is
     concerned, and the rule no longer asks about them (see `describeBlock`).
     While it did, they had to be excluded here or every callout matched itself
     — nine of nine on the article the feature was built for. Both halves are
     gone; a context changes no policy. */
  const proseText = elements
    .filter((el) => el.tagName === "P" && !el.closest("figure, blockquote"))
    .map((el) => normalize(el.textContent ?? ""));

  let reused = 0;
  let carried = 0;
  let minted = 0;

  /* Content first, ids second. The matcher works over the whole document at
     once — whether a folded bucket is ambiguous cannot be answered until every
     claimant is known — so every candidate has to exist before any id is handed
     out. See carryOverIds. */
  /* **The contexts are read here, and the transport is taken off the document
     immediately afterwards.**

     Stage 2's callout stamp is on the container and on everything inside it, so
     without this it is serialised into every block's html and reaches the
     reader — the same fact twice, in `block.context` and in the markup, with
     nothing keeping them in step. The note stamps *do* cross on purpose, because
     the browser reads them (src/web/notes-view.ts); nothing reads this one.
     GPT Sol, 2026-08-31.

     Before the ids are settled rather than after, so the html `exactKey` matches
     on for a text-less block — an image, a rule — is the same string whether or
     not the block was in a box. */
  const contextOf = new Map<Element, BlockContext | undefined>(
    elements.map((el) => [el, contextFor(el)]),
  );
  scrubReserved(
    doc,
    CONTEXT_ATTRS.map((c) => c.attr),
  );

  const found = elements.map((el) => {
    const content = ownContent(el);
    return { el, content, text: extractText(content) };
  });

  // Three ways to get an id, in descending order of confidence: it is already
  // in the document; the previous run had a block with these words; or this is
  // genuinely new text.
  /* `taken` is seeded from every id in the document, so it cannot answer "has
     this one been given to a block yet?" — and a document can arrive with the
     same id on two elements, from a hand-edit or a CMS that duplicated a node.
     Both used to be reused, and blocks.json came out with a duplicate key that
     would corrupt everything addressed by it. The second one mints. */
  const assigned = new Set<string>();
  const ids: (string | undefined)[] = found.map(({ el }) => {
    const existing = el.getAttribute("id");
    if (!isSpideryarnId(existing) || assigned.has(existing!)) return undefined;
    reused++;
    taken.add(existing!);
    assigned.add(existing!);
    return existing!;
  });

  const pending = ids.flatMap((id, i) => (id === undefined ? [i] : []));
  const recovered = carryOverIds(
    previous,
    pending.map((i) => ({
      tag: found[i]!.el.tagName.toLowerCase(),
      text: found[i]!.text,
      html: found[i]!.content.outerHTML,
    })),
    taken,
  );
  pending.forEach((i, n) => {
    const id = recovered[n];
    if (id === undefined) minted++;
    else carried++;
    ids[i] = id ?? mintUniqueId(taken);
    found[i]!.el.setAttribute("id", ids[i]!);
  });

  /* After every id is settled and before a single block's html is read: the
     rewrite has to see the final ids, and the html has to see the rewrite. */
  const blockOf = new Map<Element, string>();
  found.forEach(({ el }, i) => {
    blockOf.set(el, ids[i]!);
  });
  const blocksInOrder = found.map(({ el }) => el);
  const renamed = new Map<string, string>();
  /* Every `id` in the document, and only then the named anchors — the order the
     HTML spec resolves a fragment in, so a `name` never beats an `id` that
     matches it. Within each pass, first in document order wins, which is what a
     browser does with a document that uses the same id twice (and CMS output
     does). `authored` is in document order because querySelectorAll is. */
  for (const kind of ["id", "name"] as const) {
    for (const anchor of authored) {
      if (anchor.kind !== kind || renamed.has(anchor.was)) continue;
      const block = blockFor(anchor.el, blockOf, blocksInOrder, order);
      if (block !== undefined) renamed.set(anchor.was, block);
    }
  }
  const retargeted = retargetAnchors(doc, renamed);

  const blocks: Block[] = found.map(({ el, text }, index) => {
    const id = ids[index]!;
    /* Recomputed rather than reused. `ownContent` may have cloned this element
       before it had an id and before its links were repointed, and the stored
       html has to be the document's, not a snapshot of it part-way through.
       Patching the id onto the clone (which is what this used to do) fixed the
       half of that we knew about. */
    const content = ownContent(el);

    const { kind, level, gistable, note } = describeBlock(el, text, proseText);
    const context = contextOf.get(el);
    return {
      id,
      tag: el.tagName.toLowerCase(),
      kind,
      ...(level !== undefined ? { level } : {}),
      text,
      words: text.length ? text.split(/\s+/).length : 0,
      html: content.outerHTML,
      gistable,
      ...(note ? { note } : {}),
      ...(context ? { context } : {}),
      /* Read from `el`, which is still in the document: the note stamps are
         `data-*`, so neither the sanitiser nor `scrubStamps` (which only takes
         WAS_ID/WAS_NAME off) has touched them. */
      ...noteFieldsFor(el),
    };
  });

  return {
    blocks,
    html: dom.serialize(),
    stats: {
      total: blocks.length,
      reused,
      carried,
      minted,
      retargeted,
      gistable: blocks.filter((b) => b.gistable).length,
    },
  };
}

// ---------------------------------------------------------------- CLI

/* The CLI lives in a function rather than at the top level so this module has
   no top-level `await`. With one, the module becomes an *async module* and any
   CommonJS consumer gets ERR_REQUIRE_ASYNC_MODULE on import — which the isMain
   guard does not prevent, since it is the syntax that matters, not whether the
   branch runs. ESM importers are unaffected either way; this just keeps
   splitIntoBlocks importable from anywhere. */

/**
 * What one run of stage 3 produced, and **the two artefacts are both in here**
 * — `html` is the stamped document and `blocks` is the spine, inherited from
 * `SplitResult`. The step hands them to the store as
 * `parts: { stampedHtml, blocks }`; `main()` below writes them to two files.
 *
 * `html` keeps its name rather than becoming `stampedHtml`, because
 * `blocksMatchTheirHtml` (src/pipeline.ts) reads the same field off a bare
 * `SplitResult` and the two must not be two names for one string.
 */
export interface BlocksRun extends SplitResult {
  /**
   * How many blocks the baseline held — what the pipeline used to work out for
   * itself by counting two files, and now simply gets told.
   */
  previousBlocks: number;
}

/**
 * The contents of a `blocks.json`, cleaned and then stamped. **Every writer of
 * that file must go through this**, and there are three of them: stage 3 here,
 * stage 4 in src/hierarchy.ts, and the Postgres export in src/store/export.ts.
 *
 * The stamp is what lets the read seam tell an artefact cleaned by the current
 * policy from one cleaned by nothing (`sanitizeStoredBlocks` in
 * src/sanitize.ts, and docs/project/security.md). Two things had to be true for
 * that to work, and the first version of this had neither.
 *
 * **It has to reach the file that is actually read.** Stage 3 stamps
 * `output/<slug>.blocks.json`; the server opens `data/<slug>/blocks.json`, and
 * stage 4 rewrites *that* one from scratch. A plain `{ blocks }` there dropped
 * the stamp, so every article read back as stale — safe, since stale means
 * re-sanitise, but it paid 33ms a load to re-clean files that were already clean
 * and fired the "predates the sanitiser" warning on every article, which is how
 * a warning stops being read.
 *
 * **And it has to be true.** This is why the sanitise is here rather than left
 * to the caller. Stage 3 has genuinely just sanitised its blocks; the other two
 * have not. Stage 4 reads whatever `blocks.json` it was pointed at, and the
 * export reads rows out of Postgres that were imported from some file of unknown
 * age — so a bare stamp at those two call sites would take content that may
 * predate the sanitiser entirely and **certify it as clean**, which is worse
 * than the gap it was written to close. A stamp that can be wrong is not a
 * weaker version of this feature, it is the opposite of it.
 *
 * So the stamp is a fact by construction: nothing can be stamped without having
 * been through the policy on the way. Sanitising is idempotent, so for stage 3
 * this is a no-op, and all three of these are batch stages that make model calls
 * — 33ms for a large article is not a number any of them can notice.
 *
 * A shared helper rather than a rule written down, for the reason
 * docs/project/security.md gives about the slug check: a rule stated in one
 * function is not a rule the codebase follows. The two things that make it one
 * are a helper whose absence is visible at the call site, and a test that fails
 * when it is missing — tests/sanitize-stale-artefact.test.ts has the test.
 */
export function blocksArtefact(blocks: Block[]): { sanitizer: number; blocks: Block[] } {
  return { sanitizer: SANITIZER_VERSION, blocks: sanitizeStoredBlocks(blocks, undefined).blocks };
}

/* ------------------------------------------------- the baseline this run carries from -- */

/**
 * **The HTML kind stage 3 consumes: stage 2's, and never its own.**
 *
 * On the filesystem this is not a choice anybody could make — `extractedHtml`
 * and `stampedHtml` are the same path, so stage 3 reads whatever the last
 * writer left there. Postgres holds them in two columns on purpose
 * (src/store/artifacts.ts § `ArtifactKind`), so once the pipeline reads its
 * input from the store the choice becomes real, and it decides whether
 * identity carries or not — silently, in both directions:
 *
 * - Reading `stampedHtml` would hand stage 3 a document that already has our
 *   ids in it. They are reused directly (`splitIntoBlocks`, the `isSpideryarnId`
 *   branch), so ids survive — but they survive *the wrong text*. After a
 *   re-extraction that stamped HTML is the previous article, and stage 3 would
 *   happily re-emit last week's paragraphs with last week's ids, reporting a
 *   clean run.
 * - Reading `extractedHtml` hands stage 3 the article as stage 2 just produced
 *   it, with no ids anywhere. Every id then comes from the baseline below, by
 *   matching text — which is the mechanism block-ids.md actually specifies, and
 *   the only one that can tell an unchanged paragraph from a changed one.
 *
 * So `extractedHtml`, and the reuse-ids-found-in-the-document path stays as the
 * safety net it was written to be rather than becoming the main road. Stated
 * here as a value rather than as a sentence in a comment because a rule written
 * only in prose is not a rule the code follows —
 * tests/blocks-baseline.test.ts holds it, and landing D reads it.
 *
 * ## There is no fallback to `stampedHtml`, and the review asked for one
 *
 * GPT Sol's review (docs/plans/260828an-blocks-carry-forward-sol.md, question 1) said:
 * *"prefer `extractedHtml`, falling back to `stampedHtml` for legacy/blocks-only
 * cases"*. That fallback is deliberately **not** here, and this is the paragraph
 * that says why, because the next person will meet both columns and have to work
 * out which one and on what grounds.
 *
 * **A fallback to `stampedHtml` is a fallback to HTML that still carries our
 * ids.** So on every run that took it, the ids would survive whether or not the
 * baseline read worked — the reuse branch would supply them, and `carried` would
 * read 0 while `reused` read 139, which looks like a healthy idempotent re-run.
 * The stage would report success, the seam this whole change exists to build
 * would be doing nothing, and nobody would find out until the first genuine
 * re-extraction, when stage 2 hands over a document with no ids in it and every
 * one of them is minted at once. That is the same shape as the bug being fixed,
 * moved one step further from the thing that causes it.
 *
 * **The two cases the review had in mind are covered without it.** A legacy
 * article, and a `{ steps: ["blocks"] }` re-run over an article stage 2 has not
 * touched, both still have their `extractedHtml` — it is a carried column
 * (`REVISION_CARRY_POLICY`), so a draft inherits stage 2's last output even when
 * stage 2 did not run in this job. There is no state in which `stampedHtml`
 * exists and `extractedHtml` does not; if there ever is, the honest answer is
 * that stage 2 has not run and stage 3 has nothing to do, which is a failure and
 * not a fallback.
 *
 * The general form of the rule, worth keeping when this is next weighed: prefer
 * the arrangement in which the thing you depend on is **exercised**. Reading
 * stage 2's output means the baseline is load-bearing on every single run, so a
 * broken baseline fails immediately rather than eventually.
 */
export const BLOCKS_INPUT_HTML = "extractedHtml" satisfies ArtifactKind;

/**
 * The carry-forward did not happen, and stage 3 refuses to paper over it.
 *
 * The three cases stage 3 has to tell apart, which used to be two:
 *
 * | | what it means | what happens |
 * |---|---|---|
 * | no earlier blocks | a genuine first ingest | mint, quietly |
 * | earlier blocks, no readable baseline | this | **throw** |
 * | the store read throws | an infrastructure fault | propagates, untouched |
 *
 * Warning and minting — which is what the pipeline did until 2026-08-28 — turns
 * a database hiccup into permanent, silent reader data loss: every comment,
 * saved search and ToC row anchored into this article stops naming anything,
 * the step reports success, and the reader finds out by scrolling.
 */
export class BaselineMissing extends Error {
  constructor(readonly slug: string) {
    super(
      `blocks "${slug}": this article has blocks from an earlier run, but the baseline ` +
        "stage 3 carries ids from could not be read. Minting would give every paragraph a " +
        "new id and orphan every comment, saved search and ToC row anchored to it " +
        "(docs/project/block-ids.md). Refusing rather than re-minting.",
    );
    this.name = "BaselineMissing";
  }
}

/**
 * Every id changed at once, which is what losing the baseline looks like from
 * the far side.
 *
 * **The message is the whole justification for having no escape hatch.** A stage
 * that stops with something a person can act on is fine; a stage that continues
 * and orphans forty-three comments is not. So it says four things, and each one
 * is there because a reader of the log would otherwise have to go and find it:
 * what was compared, how many ids were on each side, that **nothing has been
 * written** — so the article is exactly as it was and the fix is not a
 * restoration — and what the one legitimate cause is and who has to decide about
 * it.
 */
export class IdsNotCarried extends Error {
  constructor(readonly slug: string, before: number, after: number) {
    super(
      `blocks "${slug}": compared the ${before} block ids carried in as the baseline against ` +
        `the ${after} ids this run produced, and not one is in both. Every comment, saved ` +
        "search and ToC row anchored into this article would stop naming anything " +
        "(docs/project/block-ids.md).\n" +
        "Nothing has been written — the blocks and the HTML are still the previous run's, " +
        "so there is nothing to restore.\n" +
        "The usual causes are that this URL now serves a different article, that a re-fetch " +
        "got a paywall or error page, or that extraction went wrong; in all three, stopping " +
        "is the right outcome. The one legitimate case is a piece genuinely rewritten from " +
        "end to end, and there is deliberately no flag for it: somebody has to add the " +
        "exemption on purpose (`assertIdsCarried` in src/blocks.ts).",
    );
    this.name = "IdsNotCarried";
  }
}

/**
 * An article with nothing in it, which is never an article.
 *
 * **The sibling of `IdsNotCarried`, for the case that one returns early on.**
 * `assertIdsCarried` compares two sets of ids and cannot compare against a
 * baseline that is not there, so on a first ingest — the exact run that mints
 * every id in the article — an extraction that produced nothing had no guard at
 * all: `{"blocks":[]}` satisfies the store's shape check (`SHAPE` in
 * src/store/artifacts.ts takes any array), every path exists and parses, and
 * every stage after stage 3 reads an article with no blocks in it.
 *
 * Same four things as `IdsNotCarried`, for the same reason — a reader of the log
 * should not have to go and find any of them: what was produced, that **nothing
 * has been written**, what the usual causes are, and that all of them are
 * transient in a way stopping does not make worse.
 *
 * **Deliberately no exemption**, for a reason `IdsNotCarried` does not have to
 * argue: there is no such thing as an article this app can do anything with that
 * has no blocks in it. Every later stage — the ToC, the summaries, the gists,
 * every anchor a reader can leave — is a function of the blocks. An empty run is
 * not an article that happens to be short; it is a fetch or an extraction that
 * failed while returning normally.
 *
 * **The message is fixed prose around `slug` and must stay that way.** Stage
 * 3's catch (src/pipeline.ts § `blocks`) forwards it to Sentry under
 * `{ authored }`, which is the claim that we wrote every character of it;
 * `slug` is permitted there because docs/project/logging.md permits ids and
 * slugs outright and `captureFailure` already sends this one as a tag.
 * Interpolating a stretch of the document, or another error's message, would
 * break that claim without anything going red.
 *
 * The reader is shown `ARTICLE_HAD_NO_TEXT` (src/messages.ts) instead; this
 * half is the log's.
 */
export class NoBlocksProduced extends Error {
  constructor(readonly slug: string) {
    super(
      `blocks "${slug}": this run produced no blocks at all, so there is no article here to ` +
        "write. Every later stage — the table of contents, the summaries, the gists, and every " +
        "comment or search a reader can anchor — is built from the blocks, so writing this " +
        "would record an empty article as a finished one (docs/project/block-ids.md).\n" +
        "Nothing has been written — the HTML is still stage 2's and any previous blocks are " +
        "still the previous run's, so there is nothing to restore.\n" +
        "The usual causes are a paywall, an error page, or a page whose text only appears once " +
        "its JavaScript has run, and in all three the fetch or the extraction is what needs " +
        "looking at; re-running stage 3 over the same HTML will produce nothing again.",
    );
    this.name = "NoBlocksProduced";
  }
}

/**
 * The previous run's blocks, from the store — the parameter `splitIntoBlocks`
 * has always taken, now fetched through the seam rather than from a path.
 *
 * **`read`, not `has`.** `beginDraftIn` copies the published revision's block
 * rows into a new draft before any stage runs, and it copies the completion
 * rows with them (src/store/pg-revisions.ts), so `has` answers *"did an earlier
 * run finish"* rather than *"are the blocks here"* — a different question with
 * the same shape.
 *
 * Reading the draft's own carried rows is not matching against itself: before
 * stage 3's first write those rows **are** the previous published blocks, a
 * failed computation has not replaced them, and a deliberate second stage-3 run
 * matching the immediately preceding result is what idempotence means.
 *
 * A store read that throws is left alone. It is an infrastructure fault, and
 * the one thing that must not happen to it is being turned into an answer.
 */
export async function previousBlocksFrom(
  /* `ArtifactReads`, not the whole store, since 2026-08-29. This runs inside a
     stage's `run`, which is the half that may only read — see
     src/store/artifacts.ts § `ArtifactReads`. The real store still satisfies it,
     so every caller is unchanged. */
  store: ArtifactReads,
  slug: string,
): Promise<Block[] | undefined> {
  const artefact = await store.read(slug, "blocks", "blocks");
  const previous = artefact?.blocks;
  if (previous && previous.length > 0) return previous;
  /* Asked only when the baseline came back empty, because it is the *second*
     question: "there is nothing here" is fine on a first ingest and fatal on
     everything else, and nothing about the empty answer itself can tell which. */
  if (await store.hasEarlierBlocks(slug)) throw new BaselineMissing(slug);
  return undefined;
}

/**
 * Did anything at all survive?
 *
 * The runtime half of the guard, and it replaces a warn in src/pipeline.ts that
 * counted blocks in two files on disk — a count that returns 0 once there are
 * no files, so the warning would have gone silent at the exact moment it became
 * true.
 *
 * **Ids, not counts.** The question is whether the baseline and the output name
 * any of the same blocks; two equal totals made of entirely different ids is
 * the failure, not the healthy case. One shared id is enough to say the matcher
 * ran — a partial loss is real but any threshold for it would be a guess, and a
 * guessed alarm gets ignored (the numbers are in the info line instead).
 *
 * **An empty run is a failed run, not an exempt one.** This used to return early
 * when `produced` was empty, and that is the same mistake in a smaller costume:
 * zero shared ids is zero shared ids however few blocks are on the other side.
 * A paywall, an error page or a fetch that came back as an empty shell all
 * extract to nothing, and the early return let stage 3 overwrite the HTML and
 * the blocks file with that nothing and report success. GPT Sol, 2026-08-28.
 *
 * There is deliberately **no exemption**, because there is no operation in this
 * repo that explicitly asks for a whole-article replacement: `force` on a step
 * means *run it again*, which is the ordinary idempotent path and must keep its
 * ids. If one is ever added, this is where it is honoured, and it must be a
 * flag somebody set on purpose rather than anything inferred from the article.
 */
function assertIdsCarried(slug: string, previous: Block[] | undefined, produced: Block[]): void {
  if (!previous?.length) return;
  const before = new Set(previous.map((b) => b.id));
  if (produced.some((b) => before.has(b.id))) return;
  throw new IdsNotCarried(slug, before.size, produced.length);
}

/**
 * Did this run produce an article at all?
 *
 * **The first-ingest half, which `assertIdsCarried` above cannot cover.** That
 * one returns early when there is no baseline, and no baseline is precisely the
 * state of the run that mints every id — so before this existed, an extraction
 * that produced nothing on a first ingest was written out and reported done.
 * There is a read-side guard for the same emptiness in `htmlCarriesItsIds`
 * (src/pipeline.ts), but it can only notice at the *next* skip check, by which
 * time the empty artefact has been the article for however long. This refuses at
 * the moment it would be created.
 *
 * **Order: after `assertIdsCarried`, and that is a decision rather than an
 * accident.** An empty run against a full baseline trips both, and the two
 * errors say different things: `IdsNotCarried` names the baseline it was
 * measured against and the anchors that were about to be orphaned, which is the
 * more serious fact and the one already tested for. This one is what is left —
 * the run with no baseline to be measured against — so it is asked second.
 */
function assertSomethingWasProduced(slug: string, produced: Block[]): void {
  if (produced.length > 0) return;
  throw new NoBlocksProduced(slug);
}

/* **`previousBlocksInFile` went on 2026-09-05**, with the command line that was
   its only caller. It read the baseline out of a `blocks.json` and swallowed the
   error, so *"there is no file"* and *"I could not read the file"* were one
   answer — and the second costs every id in the article. That was tolerable for
   a CLI holding files and no store, and it is not a shape the pipeline ever
   used: `previousBlocksFrom` above reads the draft's own block rows.
   docs/project/block-ids.md. */

/**
 * Stage 3 as a function of its input: the article's HTML in, the stamped HTML
 * and the blocks out. **It reads nothing and writes nothing.**
 *
 * Until 2026-08-31 it took an `htmlFile`, read it, and wrote the two artefacts
 * back over it and beside it. Both halves have gone with the filesystem: the
 * step reads `BLOCKS_INPUT_HTML` out of the store and hands the string in, then
 * gives what comes back to the store as `parts: { stampedHtml, blocks }`.
 * `main()` below does its own reading and writing, and that is now the entire
 * difference between the command line and the pipeline.
 *
 * Exported because there are still two callers and they must not drift.
 * Everything interesting remains in `splitIntoBlocks`; this is the baseline,
 * the two guards and the slug.
 *
 * **Synchronous, and deliberately so.** There is nothing left to await, and an
 * `async` wrapper around a pure function turns both refusals below into
 * rejected promises — which a caller that forgets the `await`, or writes `void
 * runBlocks(…)`, converts into an unhandled rejection while carrying on. A
 * throw is a throw at the call site.
 *
 * **Ids are carried over from the previous run's blocks, not re-minted.** That
 * is the whole reason a re-extraction is survivable — see
 * docs/project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters.
 *
 * **`previous` is required, and it is the load-bearing part of this signature.**
 * It used to be read here, from `jsonFile`, inside a `try/catch` whose `catch`
 * said "first run for this article" — so the day the pipeline's artefacts leave
 * the filesystem, that read fails on every run and every article silently
 * becomes a first ingest. A required argument cannot be dropped by a landing
 * that removes the files; an optional one can, and would compile.
 */
export function runBlocks(opts: {
  /**
   * The article's name, for the two refusals to say out loud. It used to come
   * from `path.basename(htmlFile)`; with no path there is no basename, and a
   * refusal that cannot name the article is much less use than one that can.
   */
  slug: string;
  /**
   * **Stage 2's document, and never stage 3's own `stampedHtml`** — the choice
   * is real once the two stop being one file, and `BLOCKS_INPUT_HTML` above is
   * where the reasoning lives. Named for the artefact rather than called `html`
   * so that handing over the wrong one is visible at the call site.
   */
  extractedHtml: string;
  /**
   * The previous run's blocks — `undefined` **only** for a genuine first
   * ingest. `previousBlocksFrom` above is how the pipeline gets it.
   */
  previous: Block[] | undefined;
}): BlocksRun {
  const { slug, extractedHtml, previous } = opts;

  const result = splitIntoBlocks(extractedHtml, previous);

  /* **Before the `return`, which is now the whole of the mechanism.** These two
     used to run "before either write"; there are no writes left here to stand
     in front of, so what a refusal has to withhold is not a half-finished file
     but the *value* — the `BlocksRun` its caller would otherwise go on to store.
     There is exactly one `return` in this function and it is below both, so a
     refused run yields nothing at all and the previous revision's blocks and
     HTML are still the article, in either store. Keeping them here rather than
     in the step matters for the same reason: a guard the caller has to remember
     is a guard the next caller forgets. The order between the two is unchanged
     and argued at `assertSomethingWasProduced`. */
  assertIdsCarried(slug, previous, result.blocks);
  assertSomethingWasProduced(slug, result.blocks);

  return { ...result, previousBlocks: previous?.length ?? 0 };
}

/* **`npm run blocks` used to be here, and it is `scripts/stage.ts` now.**
 *
 * It took an HTML file, read it, ran `runBlocks` with `previousBlocksInFile` as
 * the baseline, and wrote the stamped HTML back over its input and a
 * `blocks.json` beside it — two paths off `process.cwd()`, which under Postgres
 * are files nothing reads.
 *
 * `npm run blocks -- <slug> [--force]` runs the same `runBlocks` through the
 * queue, against a draft revision that carries the published revision's block
 * rows as its baseline. **That is what keeps the ids** — the property the old
 * command kept by reading a file, kept now by the mechanism the product uses:
 * three consecutive runs over one article, two of them forced, produced three
 * revisions and one distinct id set (stage E, 2026-09-05).
 */
