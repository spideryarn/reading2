/**
 * Stage 2, before Readability — **the one deliberate deletion of publisher
 * furniture this pipeline performs.**
 *
 * Other things in stage 2 remove elements: `canonicaliseNotes` lifts a sidenote
 * out of its `<label>` and drops what is left, Readability prunes most of the
 * page, and the sanitiser drops what it will not carry. What is unique here is
 * the *policy*: this is the only place that deletes something **because of what
 * the publisher called it**, and the licence for that is written down below.
 *
 * ## What was decided, and by whom
 *
 * C4 of docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md put
 * two-tier deletion to Greg and he refused it:
 *
 * > I care mostly about what the reader sees. And a bit of junk in the structure
 * > that's getting ignored seems a low price to pay for making things
 * > inspectable and undoable.
 * >
 * > — Greg, 2026-09-06
 *
 * and then, the same day, added the one exception this module is:
 *
 * > But if the agent is very very sure it's junk, maybe it's fine to delete it
 * > altogether.
 * >
 * > — Greg, 2026-09-06
 *
 * The class where that certainty is real, and the whole of it:
 *
 * > **Platform-generated controls beside content, recognised by the platform's
 * > own selector, that contain no block-level descendants.**
 *
 * `.mw-editsection` is the class MediaWiki puts on the edit link it generates
 * beside every section heading; `a.headerlink` is Sphinx's own permalink anchor.
 * Reading that is not a judgement about whether text *looks* like junk, it is
 * reading the publisher's own label — this plan's rule *rule on markup, model on
 * meaning*, exactly.
 *
 * ## Why deleting rather than marking, for this class only
 *
 * Because marking was never available. The mark model is **block-granular**, and
 * `[edit]` is an inline `<span>` inside an `<h2>`: there is nothing to mark, the
 * heading is either *"History[edit]"* or *"History"*. PLOS's `ul.reflinks` is 26
 * lists interleaved one per reference, so marking them would put 26 fold
 * placeholders *between the citations*, which is a worse reading view than
 * leaving them alone. For this class the honest options were always delete or
 * leave. ⟨Fable, 2026-09-06, correcting the plan's own argument.⟩
 *
 * Everything else C4 names is still only *marked*, and that machinery does not
 * exist yet. **Do not add a selector here because it looks like junk.** The test
 * of admission is not "is this furniture" but "did the platform label it, in its
 * own markup, as a control it generated" — and then the entry has to be narrowed
 * until the same class name used for something else is declined.
 *
 * ## The line, and it is not a judgement call
 *
 * `.ambox`, `.navbox`, sidebars, related-links and maintenance banners **stay**.
 * Those *say something* — a publisher's statement about the piece that a reader
 * may want — and they are for stage D to classify, not for this module to
 * delete. Visible labels are never sufficient selectors either: `acx.html` is
 * 133,669 characters of real essay that uses the phrase *"just a moment"* twice
 * in ordinary prose. **Nothing in this file reads what text says.** Three
 * functions look at text nodes — `isEmptyOfWords`, `isBareLinkList` and
 * `isControlStripBesideContent` — and every one of them asks only *whether there
 * is any*, never what it is.
 *
 * ## The guards, and how far they actually go
 *
 * `BLOCK_DESCENDANTS` is the floor the plan specified. It is **not sufficient on
 * its own**, and saying so is the point of this paragraph: `querySelector` asks
 * about *descendants*, so it says nothing about the matched element's own tag or
 * its own direct text, and `td`, `th`, `li`, `dd`, `div` and `section` are not
 * in the list. Eleven author-text deletions got through it — two found by
 * walking the corpus, eight by two GPT Sol reviews on 2026-09-06, one by us —
 * and every one is a named test in tests/extract-furniture.test.ts. Every entry
 * below therefore carries its own narrowing as well.
 *
 * **Two rounds of that, and the shape of the second is the lesson**: restricting
 * `.mw-editsection` to a `<span>` and `a.headerlink` to a heading proved *where*
 * an element sits and nothing about *what it is for*, so an edit span used
 * inline in a sentence and a cross-reference inside a heading both still went.
 * The narrowings that hold ask the second question — a link into the edit form,
 * a fragment that names the heading it hangs off, a button that opens elsewhere.
 *
 * **What is honestly claimed**: no shape anybody has constructed gets an
 * author's words past these guards, and every one that did is pinned. What is
 * **not** claimed is that deletion is structurally impossible. `ul.reflinks` is
 * the entry where markup runs out: a button labelled *View Article* and a
 * citation whose every word is inside its link are the same thing to a parser.
 * Three conditions bound it — the strip sits beside a citation that still says
 * something, every item is one bare link, and every link opens elsewhere — and
 * they bound it rather than close it.
 *
 * Declining is not a failure and does not fall back to anything — the element
 * simply stays where it is, and stage D's marking will pick it up when it
 * exists.
 *
 * ## What is deliberately not here
 *
 * C4 also licenses *caption toggles and skip-links where the platform names
 * them in its own markup*. No selector for either is in this file, because the
 * fifteen scored fixtures contain no instance of one and this plan's own rule
 * is that a recogniser ships with a fixture that scores it. A recogniser nobody
 * can measure is a recogniser nobody can tell is wrong.
 */

/**
 * Counts of what was removed, per selector, exactly as the selector is written
 * in `ENTRIES`.
 *
 * **A selector that matched nothing is absent, not zero.** Zero and absent are
 * the same fact here — nothing was removed — and an object of four zeroes on
 * every page in the library would make the one page where something *was*
 * removed harder to see, not easier.
 */
export type FurnitureRemovals = Readonly<Record<string, number>>;

/**
 * **The floor under every entry, and only the floor.** A matched element
 * containing any of these is declined, whatever its class says.
 *
 * The list is the plan's, and it is the block-level tags that carry an author's
 * own words. It is deliberately *not* every block-level tag — `div` and
 * `section` are absent, because a platform control is very often a `div`.
 *
 * **`td`, `th` and `li` are absent too, and they cannot be added**: a data table
 * is rows of cells and a list is items, so a rule that declined anything
 * containing one would decline `ul.reflinks` and every `<tr>`. That is exactly
 * why each entry below narrows itself as well, and why this constant is not
 * described anywhere as a proof.
 */
const BLOCK_DESCENDANTS = "p, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6, pre, figure";

/** Things a reader can see that carry no text for `textContent` to find. */
const MEDIA = "img, picture, video, audio, iframe, svg, canvas, object, embed";

/**
 * Markup that gives an element a name or a description somebody would meet — a
 * screen-reader name, a tooltip, a pointer at text elsewhere on the page.
 *
 * `[title]` and `[aria-labelledby]` are here because Sol asked for them and the
 * corpus said they were free: not one of the 96 `.mw-empty-elt` elements carries
 * either, and this list is used by `isEmptyOfWords` alone — every
 * `span.mw-editsection`, `a.headerlink` and `ul.reflinks` in the corpus *does*
 * have a `title`, and putting this list under them would decline the class.
 */
const ACCESSIBLE_NAME =
  '[aria-label], [aria-labelledby], [aria-describedby], [title], [alt], [role="img"]';

/** Tags Sphinx and MkDocs hang a permalink anchor off. Measured, not guessed. */
const PERMALINK_HOSTS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "DT"]);

/** MediaWiki's own classes on the wrapper it builds round a heading. */
const MW_HEADING_CLASS = /^mw-heading[1-6]?$/u;

/** One platform's label for one kind of control it generates. */
interface Entry {
  /** The platform's own selector. This string is also the key in `FurnitureRemovals`. */
  readonly selector: string;
  /**
   * The entry's own narrowing, over and above `BLOCK_DESCENDANTS` — which is a
   * floor rather than a guard. Returning false declines the element.
   */
  readonly also: (el: Element) => boolean;
}

/**
 * The whole class, and there are four of them.
 *
 * Each is a selector a platform writes onto chrome it generated, plus the
 * narrowing the corpus and the adversary showed was needed. Growing this list is
 * a decision about the licence above, not a tidy-up.
 */
const ENTRIES: readonly Entry[] = [
  /**
   * MediaWiki's per-section edit link — `[edit]`, or `[عدل | عدل المصدر]` on the
   * Arabic Wikipedia. 47 in `wiki_transformer.html`, 56 in `wiki_ar_ai.html`.
   *
   * **`span`, in the selector rather than in a guard**, because that is what
   * MediaWiki writes: all 103 in the corpus are a `<span>` inside a
   * `div.mw-heading`, and not one is anything else. It is also the whole answer
   * to two of Sol's four shapes — `<p class="mw-editsection">` holding a
   * paragraph of prose, and `<tr class="mw-editsection">` holding real cells —
   * because neither is a span and neither now matches. The floor could not have
   * caught either: it asks about descendants, and a `<p>`'s own text and a
   * `<tr>`'s `<td>`s are not descendants it looks at.
   */
  { selector: "span.mw-editsection", also: isSectionEditControl },
  /**
   * MediaWiki's marker for an element a template rendered to nothing. Ninety-six
   * across the three Wikipedia fixtures and ArchWiki: mostly empty `<span>`s
   * holding category links, some holding a deduplicated `<style>` block, one an
   * empty `<li>` in ArchWiki's install list, two empty `<p>`s — **and one
   * `<tr>`**.
   *
   * That `<tr>`, in `wiki_gdp_table.html`, is why `isEmptyOfWords` exists. `td`
   * is not in `BLOCK_DESCENDANTS` and cannot be, so the floor on its own would
   * have accepted a table row full of GDP figures and deleted it — out of the
   * one table this whole plan is trying to rescue. The class name is the fix,
   * read literally: *empty* means empty. Found 2026-09-06 by enumerating the
   * corpus rather than by reasoning about the rule.
   */
  { selector: ".mw-empty-elt", also: isEmptyOfWords },
  /**
   * Sphinx's permalink anchor — the `¶` beside a heading, and the same class in
   * Material for MkDocs. 24 in `python_docs_itertools.html`, 8 in
   * `mkdocs_tabs.html`.
   *
   * Two narrowings, and the second is the one that matters. **The `href` must
   * point into this same document**, which is what a permalink is. And **the
   * anchor must hang off a heading or a `<dt>`**, which is where Sphinx puts it:
   * all 32 in the corpus sit in `h1`, `h2`, `h3` or `dt`, and nowhere else.
   * Without that, `<p>See <a class="headerlink" href="#methods">the methods and
   * their caveats</a>.</p>` — Sol's third shape — is deleted, sentence and all.
   */
  { selector: "a.headerlink", also: isPermalinkOnAHeading },
  /**
   * PLOS's per-reference button strip — *View Article*, *PubMed/NCBI*, *Google
   * Scholar* — 26 of them in `plos_biology.html`, one inside each citation's own
   * `<li>`.
   *
   * `isBareLinkList` is the guard C4 specifies. `isControlStripBesideContent` is
   * the one C4 needed and did not have: a strip of buttons sits **beside** a
   * citation, so its parent `<li>` still says something once the strip is taken
   * out. All 26 in the corpus do. A `ul.reflinks` that is the whole of its item
   * is not a control strip beside a citation — it *is* the citation, wholly
   * inside its link, and in markup that is indistinguishable from three buttons.
   * Sol's fourth shape, and the reason this entry is the one with a stated
   * limit rather than a proof.
   */
  { selector: "ul.reflinks", also: isBareLinkList },
];

/**
 * No text anywhere inside except whitespace, nothing a reader can *see* that
 * carries no text, and no accessible name — where `<style>`, `<script>`,
 * `<link>`, `<meta>` and `<template>` do not count, because none of them is
 * something a reader would ever meet.
 *
 * **`matches` as well as `querySelector`, on both halves.** An element is not a
 * descendant of itself, so `<img class="mw-empty-elt">` and
 * `<span class="mw-empty-elt" role="img" aria-label="…">` passed a check written
 * only over descendants — Sol, 2026-09-06, and both are named tests now.
 *
 * This is the only function here that looks at a text node, and it asks only
 * whether there is one. **It never reads what it says**, which is the rule the
 * whole module runs on.
 */
function isEmptyOfWords(el: Element): boolean {
  if (el.matches(MEDIA) || el.querySelector(MEDIA) !== null) return false;
  if (el.matches(ACCESSIBLE_NAME) || el.querySelector(ACCESSIBLE_NAME) !== null) return false;
  const clone = el.cloneNode(true) as Element;
  for (const invisible of Array.from(clone.querySelectorAll("style, script, link, meta, template"))) {
    invisible.remove();
  }
  return (clone.textContent ?? "").trim() === "";
}

/**
 * **MediaWiki's section edit control, in the place MediaWiki puts it and doing
 * what MediaWiki generates it to do.**
 *
 * Three conditions, and all 103 in the corpus meet all three: the span sits in a
 * `div.mw-heading`, that wrapper holds a heading, and the span contains a link
 * into the edit form. Restricting the selector to `span` was not enough — Sol,
 * second pass, 2026-09-06: `<p>The <span class="mw-editsection">author's own
 * analysis</span> matters.</p>` was still deleted, because the tag says where an
 * element is in the DOM and nothing about what it is for.
 *
 * The `action=edit` link is the strongest of the three and the one that answers
 * *"is this the control?"* rather than *"is this where the control goes?"*.
 */
function isSectionEditControl(el: Element): boolean {
  const wrapper = el.parentElement;
  if (wrapper === null || !wrapper.matches("div.mw-heading")) return false;
  if (wrapper.querySelector("h1, h2, h3, h4, h5, h6") === null) return false;
  return el.querySelector('a[href*="action=edit"]') !== null;
}

/**
 * An anchor hanging off a heading and pointing **at that heading**, which is
 * what a permalink is.
 *
 * `href="#…"` on its own says only that the link stays on the page, and a
 * heading may perfectly well contain a cross-reference: Sol's
 * `<h2 id="overview">Overview — see <a class="headerlink" href="#methods">methods
 * and caveats</a></h2>` lost its link to the first version of this. So the
 * fragment has to name the host or something the host is inside — which is
 * exactly what the corpus does: 29 of the 32 target their host's own id, and
 * Sphinx's other three target the `<section>` the heading opens.
 */
function isPermalinkOnAHeading(el: Element): boolean {
  const href = el.getAttribute("href") ?? "";
  if (!href.startsWith("#")) return false;
  const host = el.parentElement;
  if (host === null || !PERMALINK_HOSTS.has(host.tagName)) return false;
  const target = href.slice(1);
  if (target === "") return false;
  for (let node: Element | null = host; node !== null; node = node.parentElement) {
    if (node.id === target) return true;
  }
  return false;
}

/**
 * Every child is an `<li>` holding exactly one `<a>` and nothing else — no
 * second link, no text of its own, no other element — **and the list sits beside
 * something rather than being it.**
 *
 * An empty list is not one of these either: there would be nothing to be sure
 * about.
 */
function isBareLinkList(el: Element): boolean {
  const items = Array.from(el.children);
  if (items.length === 0) return false;
  /* **The list's own stray text, which `children` cannot see.** A parser leaves
     `<ul class="reflinks">Smith J (2019)…<li>…` with a text node directly under
     the `<ul>`, and checking only the `<li>`s would have deleted that sentence
     while reporting success. */
  const strayText = Array.from(el.childNodes).some(
    (node) => node.nodeType === node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
  );
  if (strayText) return false;
  const everyItemIsOneBareLink = items.every((li) => {
    if (li.tagName !== "LI") return false;
    const children = Array.from(li.children);
    const only = children[0];
    if (children.length !== 1 || only === undefined || only.tagName !== "A") return false;
    /* **The link opens somewhere else, which is what a "go to article" button
       does and what a citation does not.** All 75 anchors in the corpus carry
       `target="_new"`; a reference list of wholly-linked citations would not.
       This is the condition that declines Sol's second-pass shape — a citation
       inside a `<li>` whose only other content is the ordinal `1.` — where
       "beside content" alone said yes. */
    if (!only.hasAttribute("target")) return false;
    return Array.from(li.childNodes).every(
      (node) => node === only || (node.nodeType === node.TEXT_NODE && (node.textContent ?? "").trim() === ""),
    );
  });
  return everyItemIsOneBareLink && isControlStripBesideContent(el);
}

/**
 * **"Beside content" is in the class definition, so it is checked.**
 *
 * A per-reference button strip is a thing a publisher puts *next to* a citation:
 * take the strip away and the item it sits in still says who wrote what, which
 * is true of all 26 in `plos_biology.html`. A list that is the whole of its item
 * is not beside anything, and the honest reading of it is that its link text is
 * the content.
 *
 * This is what stops a wholly-linked citation being deleted, and it is a bound
 * rather than a proof: nest such a citation inside an item that also carries a
 * date and it is admitted again. Nobody has produced that page; it is written
 * down here so that whoever meets it knows this was the edge and not an
 * oversight.
 */
function isControlStripBesideContent(el: Element): boolean {
  const item = el.parentElement;
  if (item === null || item.tagName !== "LI") return false;
  const clone = item.cloneNode(true) as Element;
  for (const strip of Array.from(clone.querySelectorAll("ul.reflinks"))) strip.remove();
  return (clone.textContent ?? "").trim() !== "";
}

/**
 * **Delete the platform's own controls, and count what went.**
 *
 * Called from `prepareDocument` (src/extract.ts) before Readability and before
 * ids are minted. It runs before `canonicaliseNotes` by preference rather than
 * by need: measured on every fixture this touches plus the two most
 * footnote-heavy in the corpus, running it last instead changes nothing —
 * neither the counts, nor `NoteStats`, nor `CalloutStats`, nor a byte of
 * Readability's output.
 *
 * Entries are applied in order and each re-queries the live document, so an
 * element already carried off inside a removed ancestor is skipped rather than
 * double-counted. `isConnected` is that check. No page in the corpus contains a
 * candidate nested inside another candidate, so it has never fired here — it is
 * a cheap correctness property of the loop, not a fix for something observed.
 *
 * The counts are the audit line: nothing here stores the HTML it removed, and
 * nothing here writes an attribute. Recovering a wrong delete is a
 * re-extraction, which stage 1 keeps the fetched bytes precisely to make cheap.
 */
export function removePlatformFurniture(doc: Document): FurnitureRemovals {
  const removed: Record<string, number> = {};
  for (const entry of ENTRIES) {
    let n = 0;
    for (const el of Array.from(doc.querySelectorAll(entry.selector))) {
      /* Already gone, inside an ancestor an earlier entry removed. */
      if (!el.isConnected) continue;
      /* The floor. A match with an author's words under it is left alone. */
      if (el.querySelector(BLOCK_DESCENDANTS) !== null) continue;
      if (!entry.also(el)) continue;
      const wrapper = el.parentElement;
      el.remove();
      hoistEmptiedHeadingWrapper(wrapper);
      n += 1;
    }
    if (n > 0) removed[entry.selector] = n;
  }
  return removed;
}

/**
 * **The wrapper MediaWiki built to hold a heading and its edit link, once the
 * edit link has gone.**
 *
 * Parsoid writes
 * `<div class="mw-heading mw-heading2"><h2>History</h2><span class="mw-editsection">…</span></div>`,
 * and this replaces that `<div>` with its `<h2>` when the span is all that is
 * left to take out of it. Nothing is deleted: the heading keeps its place, its
 * tag and its words.
 *
 * **It is here because without it the change ships 94 blank rows.** Readability
 * turns the emptied wrapper into `<p></p><h2>History</h2><p></p>`, and the
 * reading view draws one row per block whatever the block holds
 * (`src/web/TableView.tsx`), so `wiki_transformer.html` went from 1 empty block
 * to 95 — about 3,700 pixels of nothing to scroll past. With the hoist it is
 * back to 1, and all 47 headings still come back. Found by GPT Sol, 2026-09-06,
 * who was right that `gistable: false` is not the same as invisible.
 *
 * **Narrow on purpose, five ways.** Only `div.mw-heading`, which is MediaWiki's
 * own name for this wrapper and nobody else's; only when the wrapper's *only
 * attribute is `class`* and every class on it is one of MediaWiki's own; only
 * when one element child is left and it is a heading; only when the wrapper
 * carries no text of its own.
 *
 * The attribute conditions are Sol's, second pass, and they are not fussiness:
 * `replaceWith` throws away everything the wrapper had.
 * `<div class="mw-heading admonition" id="topic" lang="ar" dir="rtl">` became a
 * bare `<h2>`, losing its fragment target, its language, its direction and — Sol
 * ran the callout pass and confirmed it — its classification as a callout, since
 * `canonicaliseCallouts` runs after this and knows a box by its container's
 * classes. All 103 wrappers in the corpus carry `class` and nothing else, so
 * declining the rest costs nothing measurable and closes the whole class.
 */
function hoistEmptiedHeadingWrapper(wrapper: Element | null): void {
  if (wrapper === null || !wrapper.matches("div.mw-heading")) return;
  const attrs = Array.from(wrapper.attributes);
  if (attrs.length !== 1 || attrs[0]?.name !== "class") return;
  if (!Array.from(wrapper.classList).every((name) => MW_HEADING_CLASS.test(name))) return;
  const children = Array.from(wrapper.children);
  const only = children[0];
  if (children.length !== 1 || only === undefined) return;
  if (!/^H[1-6]$/u.test(only.tagName)) return;
  if ((wrapper.textContent ?? "").trim() !== (only.textContent ?? "").trim()) return;
  wrapper.replaceWith(only);
}
