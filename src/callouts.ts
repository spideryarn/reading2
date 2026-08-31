/**
 * Stage 2, before Readability — the boxes an author set apart from the prose,
 * marked so that stage 3 can still tell.
 *
 * A callout is the shaded box a piece drops into the middle of an argument: a
 * Substack "callout", a MkDocs admonition, an RFC's editorial `<aside>`. It is
 * not a quotation — the author is usually still speaking — and it is not
 * ordinary prose either, which is how it arrives today.
 *
 * **Why this has to run before Readability.** Substack writes
 *
 *     <div data-callout="true" class="callout-block"><p><span>Whoa! …</span></p></div>
 *
 * and Readability unwraps the `<div>`, taking `data-callout` and `class` with
 * it. Measured on the stored `raw.html` of `/read/openai-huggingface`: nine
 * callouts in the source, zero occurrences of `data-callout` or `callout` in
 * Readability's output, and nine paragraphs that reach the reader
 * indistinguishable from body prose. `keepClasses: false` does the same to every
 * class-based shape. By stage 3 there is nothing left to recognise, which is the
 * same reason `canonicaliseNotes` sits here — see src/notes.ts, and
 * docs/plans/callout-blocks.md.
 *
 * ## What it does, and what it deliberately does not
 *
 * It **stamps and moves nothing.** `data-spya-callout` goes onto the container
 * *and onto every block-level element inside it*, because the container is
 * precisely the thing Readability is about to delete; the paragraphs survive,
 * and the stamp survives on them. Nothing is rebuilt, re-worded or relocated.
 *
 * That matters for the one contract everything rests on: stage 3 carries a
 * block's id over by matching its tag and its text (`exactKey`, src/blocks.ts),
 * so a pass that rewrote a callout into a `<blockquote>` — the tempting version
 * of this, and the first one drafted — would re-mint an id for every callout in
 * the library the first time each article was re-extracted, orphaning any
 * comment on one. A stamped `<p>` has the same tag and the same words as an
 * unstamped one.
 *
 * ## Reading a stranger's DOM before it has been sanitised
 *
 * Same rule as src/notes.ts, and for the same reason: reading is not the danger,
 * carrying is. Every copy of our attribute the document arrived with is removed
 * first — `<template>` contents included, since a DOM query does not enter a
 * template's fragment — and the only value we ever write is the empty string.
 * There is no id to mint here and so nothing of the page's own can ride along.
 *
 * ## Recognised shapes, and nothing else
 *
 * The four in the corpus plus hand-written ARIA. Recognition is by the markup a
 * publisher actually writes, never by inference from shape or length: notes.ts
 * has the write-up of what happened the one time this stage guessed.
 *
 * Epigraphs are deliberately absent. gwern's `.epigraph` already wraps a
 * `<blockquote>`, so it is a quote today and is set as one.
 */

/**
 * Ours, and therefore forgeable — scrubbed off the input before we write ours.
 *
 * Exported because stage 3 reads it back (`describeBlock`, src/blocks.ts) and a
 * second spelling of the string is how the writer and the reader drift apart
 * without either side going red.
 */
export const CALLOUT_ATTR = "data-spya-callout";

/**
 * Where a callout container starts.
 *
 * `~=` rather than `*=`: it matches a whole word of the class list, so
 * `class="admonition error"` matches and MDN's
 * `class="Sidebar-module-scss__callout-wrapper"` does not. `*=` would make this
 * a substring hunt across every hashed CSS-module name in the corpus.
 *
 * **`[role="note"]` is deliberately not in it, and the corpus is why.** It reads
 * like the one piece of hand-written ARIA that would mean exactly this, and it
 * was in the first version. Then it was measured: Wikipedia writes its *hatnotes*
 * with it — `<div role="note" class="hatnote">Main article: Seq2seq § History</div>`
 * — seven of them on the *Transformer* fixture alone, and every one is
 * navigation. The link-density guard rejects six and keeps "Further information:
 * Word embedding", whose link is only 41% of its text. A big quote mark over that
 * line is the app inventing a remark the author never made, so the whole signal
 * goes rather than the guard being bent around one publisher. Measured
 * 2026-08-31, and tests/callouts.test.ts holds it so that putting it back is a
 * decision rather than an oversight.
 */
const CONTAINER_SELECTOR = [
  '[data-callout]', // Substack
  '[class~="callout"]',
  '[class~="callout-block"]',
  '[class~="admonition"]', // gwern, MkDocs, Sphinx
  '[class~="theme-admonition"]', // Docusaurus, whose own class map names this exact token
  '[class~="pullquote"]',
  '[class~="pull-quote"]',
  "aside", // RFCs, and every CMS's sidebar — see `isNavigation`
].join(", ");

/**
 * Everything inside a container that stage 3 might emit as a block, so the
 * stamp is on the element that survives rather than on the one that does not.
 *
 * Kept in step with `LEAF_BLOCKS` in src/blocks.ts by hand, and it does not have
 * to be exhaustive: an element this list misses is stamped anyway if the
 * container itself survives Readability, and a stamp on something that never
 * becomes a block is inert.
 */
const INSIDE_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, figure, table, div";

/**
 * The same list as a membership test, for `wrapLooseRuns` — which has to ask it
 * of a node rather than run a query.
 */
const INSIDE_TAGS = new Set(
  INSIDE_SELECTOR.split(",").map((t) => t.trim().toUpperCase()),
);

/**
 * Wrap loose words sitting directly inside a callout in a `<p>`, so there is an
 * element for the stamp to be on.
 *
 * **Without this the feature silently does nothing for a whole shape of
 * markup.** `<div class="callout">Loose words.</div>` has no element to stamp
 * except the `<div>`, which Readability deletes — and Readability then builds a
 * *fresh* `<p>` out of the text, with none of our attributes on it. The words
 * arrive as ordinary prose and every count still looks right. The same goes for
 * a container whose only child is a `<span>`: the span keeps the stamp we put on
 * it, but stage 3 asks `closest`, which looks at a block's ancestors and never
 * at what is inside it. Found by GPT Sol, 2026-08-31, running the real
 * Readability over it.
 *
 * The wrapping is what Readability would have done anyway, one step earlier and
 * with the stamp attached, so it costs no block ids: the paragraph has the same
 * tag and the same words either way, which is what `exactKey` matches on.
 * `rewrapOrphanText` in src/blocks.ts does the identical thing at stage 3 for
 * the identical reason.
 *
 * Contiguous runs, not "wrap everything": a callout of one paragraph plus a
 * stray sentence keeps its paragraph and gains one, rather than becoming a
 * single block that swallows both.
 */
function wrapLooseRuns(container: Element): Element[] {
  const doc = container.ownerDocument;
  const wrapped: Element[] = [];
  let run: ChildNode[] = [];

  const flush = () => {
    const meaningful = run.some((n) => (n.textContent ?? "").trim() !== "");
    if (meaningful) {
      const p = doc.createElement("p");
      const first = run[0] as ChildNode;
      container.insertBefore(p, first);
      for (const node of run) p.appendChild(node);
      wrapped.push(p);
    }
    run = [];
  };

  for (const node of Array.from(container.childNodes)) {
    const isBlock = node.nodeType === 1 && INSIDE_TAGS.has((node as Element).tagName);
    if (isBlock) flush();
    else run.push(node);
  }
  flush();
  return wrapped;
}

/**
 * How the container was recognised, so a shape silently going missing is
 * visible in the stats. Not exported: `CalloutStats` carries it in its own
 * shape and nothing outside this file names it.
 */
type CalloutShape = "callout" | "admonition" | "pullquote" | "aside";

export interface CalloutStats {
  /** Containers recognised. Not the number of blocks, which is usually larger. */
  containers: number;
  /** Elements stamped, containers included. An upper bound on the callout blocks stage 3 will emit. */
  stamped: number;
  /** Containers matched and then rejected by `isNavigation`. */
  skipped: number;
  shapes: Record<CalloutShape, number>;
}

const EMPTY_STATS = (): CalloutStats => ({
  containers: 0,
  stamped: 0,
  skipped: 0,
  shapes: { callout: 0, admonition: 0, pullquote: 0, aside: 0 },
});

function shapeOf(el: Element): CalloutShape {
  const classes = el.classList;
  const named = (name: string) => classes?.contains(name) === true;
  if (el.hasAttribute("data-callout") || named("callout") || named("callout-block")) {
    return "callout";
  }
  if (named("admonition")) return "admonition";
  if (named("pullquote") || named("pull-quote")) return "pullquote";
  return "aside";
}

/**
 * Chrome dressed as a box: a sidebar, a "related reading" list, a table of
 * contents.
 *
 * **Only applied to `<aside>`** — see the call site, which asks `shapeOf`
 * first. Everything else in `CONTAINER_SELECTOR` is a publisher *saying* this is
 * a callout, and a heuristic must not overrule a declaration: a Substack
 * `<div data-callout><p><a href="/warning">Read this warning</a></p></div>` has
 * a link density of 1 and is still a callout. The first version ran this on
 * every match and threw that away. GPT Sol, 2026-08-31.
 *
 * **The guard exists for `<aside>` and nothing else.** Four of the sixteen
 * extraction fixtures use `<aside>` for a sidebar — MDN's two layout rails,
 * Cornell's sponsor panel, the constitution site's nav — while rfc9110 uses it
 * thirty-two times for genuine editorial notes. One element, two jobs, and the
 * tag alone cannot tell them apart.
 *
 * Two tests, both Readability's own idea and both cheap: a container whose links
 * account for more than half its text is a list of links, and a container built
 * round a `<nav>` says what it is itself.
 *
 * The guard is deliberately not stricter than that. Readability throws a real
 * sidebar out on its own in almost every case; where it does not, the sidebar is
 * already being rendered to the reader as body prose, and rendering it as a box
 * instead is not a worse outcome than today.
 *
 * **It also throws the good ones out**, which is worth knowing before anybody
 * reads the corpus numbers as a result: none of rfc9110's 32 editorial asides
 * and none of gwern's 3 admonitions survive Readability at all, so `<aside>` and
 * `admonition` buy nothing on today's fixtures. They are in the list because the
 * shapes are real and because the day extraction stops dropping them is not the
 * day anybody will remember this file. What is measured working end to end is
 * Substack's `<div class="callout-block">`.
 */
function isNavigation(el: Element): boolean {
  if (el.querySelector("nav") !== null) return true;
  return linkDensity(el) > 0.5;
}

/**
 * How much of an element's text is inside a link.
 *
 * Readability's own measure, re-implemented here rather than imported because
 * it is private to that library. Whitespace-collapsed on both sides so that the
 * indentation of pretty-printed markup does not quietly move the ratio; an
 * element with no text at all counts as 0, which lets the emptiness be somebody
 * else's decision.
 *
 * **`<script>` and `<style>` are removed first, and without that the guard does
 * not work.** `textContent` includes the source of every script inside the
 * element, and an ad-and-nav sidebar is mostly scripts: cornell.html's
 * `<aside id="supersizeme">` is four links, two ad slots and about 1,200
 * characters of `googletag` and `addthis` configuration, which put its measured
 * link density at well under a half and walked it straight past this guard.
 * Measured, 2026-08-31, on the first version of this file.
 */
function linkDensity(el: Element): number {
  const clone = el.cloneNode(true) as Element;
  for (const junk of Array.from(clone.querySelectorAll("script, style, noscript, template"))) {
    junk.remove();
  }
  const text = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return 0;
  const linked = Array.from(clone.querySelectorAll("a"))
    .map((a) => {
      const chars = (a.textContent ?? "").replace(/\s+/g, " ").trim().length;
      /* **A link to a fragment of this same page counts for 0.3**, which is
         Readability's own coefficient and not a number of ours. A citation —
         `See <a href="#section-4">Section 4</a>.` — is how an RFC's editorial
         aside is written, and counting it in full rejected exactly the asides
         this pass is for. GPT Sol, 2026-08-31. */
      return (a.getAttribute("href") ?? "").startsWith("#") ? chars * 0.3 : chars;
    })
    .reduce((sum, n) => sum + n, 0);
  return linked / text.length;
}

/**
 * Take every copy of our attribute off, **including the ones
 * `querySelectorAll` cannot see** — a `<template>`'s children live in a separate
 * fragment that a query walks straight past while `outerHTML` serialises them in
 * full. src/blocks.ts § `scrubStamps` is where that was found the hard way.
 */
function scrubReserved(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll(`[${CALLOUT_ATTR}]`))) {
    el.removeAttribute(CALLOUT_ATTR);
  }
  for (const t of Array.from(root.querySelectorAll("template"))) {
    scrubReserved((t as HTMLTemplateElement).content);
  }
}

/**
 * Mark every callout in the document. Returns what it found, for the CLI's
 * report — nothing downstream branches on the stats.
 */
export function canonicaliseCallouts(doc: Document): CalloutStats {
  /* From the document, not from `doc.body`: a document-rooted query matches
     `<html>` and `<body>` themselves, and those two are the ones a page could
     put a stamp on that a body-rooted scrub would walk past. src/blocks.ts §
     `stampAuthorAnchors` clears them by hand for exactly that reason, because
     it queries the body. */
  scrubReserved(doc);

  const stats = EMPTY_STATS();
  if (!doc.body) return stats;

  for (const container of Array.from(doc.body.querySelectorAll(CONTAINER_SELECTOR))) {
    /* A callout inside a callout is one callout. Checked before the guards so
       that a nested container cannot be counted twice, and after the outer one
       has been stamped — `querySelectorAll` is in document order, so the
       ancestor has always been visited first. */
    if (container.parentElement?.closest(`[${CALLOUT_ATTR}]`)) continue;
    const shape = shapeOf(container);
    /* The guard runs on `<aside>`, the one signal that does not mean what it
       says. See `isNavigation`. */
    if (shape === "aside" && isNavigation(container)) {
      stats.skipped += 1;
      continue;
    }

    stats.containers += 1;
    stats.shapes[shape] += 1;
    container.setAttribute(CALLOUT_ATTR, "");
    stats.stamped += 1;
    /* Before the query below, so the paragraphs it creates are stamped by it
       rather than needing a second pass. */
    wrapLooseRuns(container);
    for (const inside of Array.from(container.querySelectorAll(INSIDE_SELECTOR))) {
      inside.setAttribute(CALLOUT_ATTR, "");
      stats.stamped += 1;
    }
  }
  return stats;
}
