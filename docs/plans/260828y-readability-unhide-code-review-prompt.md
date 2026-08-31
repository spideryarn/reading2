# Review: shipping the `aria-hidden` un-hide into stage 2, and the instrument change behind it

You are reviewing **built code**, not a plan. Weight this higher than a plan-stage review: a plan
review cannot find a guard that fires on success, and one of the changes below exists precisely
because that happened.

## The project in one paragraph

Spideryarn is a reading app. Stage 1 fetches HTML; **stage 2** (`src/extract.ts`) runs Mozilla
Readability over it and writes a standalone HTML page; stage 3 splits that into blocks and mints
stable `spya-` ids; stages 4 and 5 build a table of contents and a granularity-zoom tree from the
headings. Everything downstream addresses text by block id. A failure at stage 2 is invisible: the
article reaches the shelf looking complete.

## What was already established (do not re-litigate)

An eval harness `evals/extraction/inventory.mts` flattens a fetched page into candidate blocks and
reports which survived Readability. It is tested at a pure-string seam (`compare()`), has 16 tests,
and shipped with five instrument bugs that were each found and fixed. Fourteen fixture HTML pages
are committed with sha256 hashes.

The finding that motivated this work: Readability's visibility check skips `aria-hidden="true"`
nodes, so on anthropic.com/constitution it discards **48,147 characters (26% of the article)** held
in three collapsed accordion `<div>`s. Real body text a human reader would see by clicking.

## What changed in this diff, and the four claims I want attacked

### 1. The fix shipped into stage 2

`unhideCollapsedSections(doc)` in `src/extract.ts` removes `aria-hidden="true"` before Readability
parses. It does **not** touch `[hidden]` or inline `display: none`.

### 2. `[hidden]` was dropped from the fix, on evidence

The original version removed `[hidden]` too. Measured across the fixtures, that half changed exactly
one page — arxiv.org/abs, +95 characters — and those characters are `"View a PDF of the paper titled
Attention Is All You Need, by Ashish Vaswani and 7 other authors"`, a screen-reader link label. So
its whole measured effect was to insert furniture.

### 3. The corpus could not judge its own arm

Two problems, both fixed here:

- **The fourteen fixtures contained no collapsed accordion at all.** The run printed "un-hiding
  regresses 0 of 14, helps 0 of 14" — true, and a safety claim about a change that had nothing to
  act on. A fifteenth fixture (`constitution.html`) was added.
- **Arms were compared by character count, not as documents.** Recovering *furniture* makes
  `droppedChars` go down, which every flag in the runner reads as good. The new `gainedText()` in
  `corpus.mts` prints the blocks the un-hidden arm has and the stock arm does not, and refuses to
  score them; the run says READ THEM.
- The `|| b.ratio > a.ratio + 0.15` half of the regression guard was **deleted**, because recovering
  a quarter of the constitution moves the ratio 0.737 → 0.942 by definition, so the run printed
  "un-hide helps" and "!! UN-HIDE REGRESSES" on the same line.

### 4. The measured result, after both fixes

Over fifteen fixtures, comparing Readability's output HTML as strings:

- **13 of 15 byte-identical.**
- **wikipedia-transformer**: differs by the attribute and nothing else — strip ` aria-hidden="true"`
  from the stock output and it equals the un-hidden output exactly (188 occurrences, 3,572 bytes).
  Claimed as an accessibility *win*: Wikipedia writes each formula twice, MathML inside
  `style="display: none"` for assistive tech and a fallback `<img aria-hidden="true">` for eyes;
  Readability drops the MathML (inline display:none, untouched) and keeps the image, so the attribute
  is left pointing at a twin that no longer exists.
- **constitution**: the only page whose text changes. 94 blocks, 47 more `<li>`, 4 more `<h3>`,
  +39,355 characters.

## What I want from you

Be adversarial. Specifically:

1. **Is dropping the attribute permanently the right design?** The alternative considered and
   rejected was: strip `aria-hidden`, let Readability parse, then **restore** it on the surviving
   nodes — preserving author intent and changing only what Readability *considers*. I chose not to,
   on the argument that Wikipedia's attribute now points at a deleted twin, so keeping it means
   silence for 188 formulas. **Is that argument sound, or am I overreaching by second-guessing the
   publisher's accessibility markup on every page to fix it on one?** Give me the strongest case for
   restore-after-parse.
2. **Is the accessibility claim about Wikipedia actually true?** I verified Readability drops the
   MathML and keeps 188 `<img aria-hidden="true">`. I did NOT verify that those images carry a useful
   `alt` through our sanitiser, or that a screen reader does the thing I claim. Tell me what would
   falsify it.
3. **What page breaks this?** Name a concrete, common pattern where removing `aria-hidden="true"`
   before extraction drags in furniture, and say whether the fifteen-page corpus could see it.
   Fifteen enriched pages is not a prevalence estimate and I know it.
4. **Is `gainedText()` right?** It compares block text with `String.includes` against the whole stock
   article text, with a 40-character floor. Where does that give a false "gained" or miss a real one?
   Note it parses with JSDOM and is only reached when the two HTML strings differ.
5. **Is the test file honest?** `tests/extract-unhide.test.ts`. I checked its assertions against
   three broken rules (a no-op, one that also strips `[hidden]`, one that also strips
   `display: none`) and each broken rule is caught by exactly one assertion. Is anything in it green
   for a reason other than the code being right? The `charThreshold` of 500 in the Readability
   fixtures is the part I trust least.
6. **The doc changes.** `docs/project/block-ids.md` gains a "bare `<svg>` gets no id" section
   recording a hole I deliberately did not fix (it is a different stage and a different document's
   decision). Is deferring that right, or is recording a known unaddressable-element bug and shipping
   worse than fixing it?

Check each claim against the diff. Some of my reasoning will be wrong; say which. If a number in the
prose does not match what the code would produce, say so — that class of error has bitten this work
twice already.

## The diff

```diff
diff --git a/docs/plans/260827ab-readability-repair-pass.md b/docs/plans/260827ab-readability-repair-pass.md
index 58904a1..7b091ca 100644
--- a/docs/plans/260827ab-readability-repair-pass.md
+++ b/docs/plans/260827ab-readability-repair-pass.md
@@ -57,7 +57,9 @@ with collapsible appendices and any long piece with a "read more". The failure i
 
 ### The fix, and what it costs
 
-Remove `aria-hidden="true"` (and `hidden`) before parsing:
+Remove `aria-hidden="true"` before parsing. **Shipped 2026-08-28** as
+`unhideCollapsedSections` in [`src/extract.ts`](../../src/extract.ts), after the corpus below grew
+the page that could actually exercise it.
 
 | Page | stock | un-hidden | probes found |
 |---|---:|---:|---|
@@ -68,10 +70,46 @@ Remove `aria-hidden="true"` (and `hidden`) before parsing:
 **+39,355 characters recovered, nothing lost on the pages that were already right, no model, no
 money, no latency.** The fifth probe is the author-bio block, which is arguably boilerplate.
 
-That is one page's evidence and it must not be shipped on one page's evidence — un-hiding is exactly
-the kind of change that could drag in a hidden mobile nav, an off-screen menu or a
-screen-reader-only duplicate on some other site. It is a candidate with a strong first result, and
-the eval below is what would settle it.
+#### What fifteen pages then said
+
+Three pages were not enough, and the corpus that replaced them nearly repeated the mistake in a
+worse form — see [The corpus](#the-corpus-and-the-finding-that-outranks-everything-above). Against
+the fifteen committed fixtures, run document-against-document rather than by counting characters:
+
+- **Thirteen of fifteen are byte-identical.** Not "unchanged within a threshold" — the same string.
+- **Wikipedia differs by the attribute and nothing else**: strip ` aria-hidden="true"` from the stock
+  output and it equals the un-hidden output exactly. 188 occurrences, 3,572 bytes, no text moved.
+  This one is a small **accessibility win**. Wikipedia writes each formula twice — MathML inside
+  `style="display: none"` for assistive tech, a fallback `<img aria-hidden="true">` for eyes.
+  Readability drops the MathML (inline `display: none`, which we do not touch) and keeps the image,
+  so the attribute is left pointing at a twin that no longer exists and a screen-reader user gets
+  silence for all 188 formulas. The `alt` is the TeX. Removing the attribute is what leaves them
+  audible.
+- **The constitution is the only page whose text changes**: 94 blocks, 47 more `<li>`, 4 more `<h3>`.
+
+#### `hidden` was dropped from the fix, and this is the interesting half
+
+The first version removed `[hidden]` too. Across the same fifteen pages it changed exactly one page,
+arxiv.org/abs, by **+95 characters** — and those characters are *"View a PDF of the paper titled
+Attention Is All You Need, by Ashish Vaswani and 7 other authors"*, a screen-reader label for a link.
+The whole measured effect of that half of the fix was to insert furniture.
+
+It survived because **every number in the runner rewards recovery**. Pulling in boilerplate makes
+`droppedChars` go *down*; the `helped` flag missed it only because 95 < 1,000, and the `regressed`
+flag could not see it at all, because that flag fires on text *lost*. The fix to the instrument is
+[`gainedText`](../../evals/extraction/corpus.mts) — it does not score the added text, it **prints**
+it, and the run says READ THEM. Set side by side, *"Claude's three types of principals"* and *"View a
+PDF of the paper titled"* take a second to tell apart, and no threshold ever would.
+
+The distinction that survives: `hidden` is the HTML spec's own "not currently relevant" and authors
+mean it. `aria-hidden` is an accessibility annotation, and the visual/assistive split is exactly
+where readable text gets marked invisible to a parser. Inline `display: none` is left alone for a
+third reason — stripping it on Wikipedia would restore 188 MathML formulas *beside* the 188 images
+already rendering them.
+
+Pinned in [`tests/extract-unhide.test.ts`](../../tests/extract-unhide.test.ts), whose assertions were
+checked against three broken rules — a no-op, one that also strips `[hidden]`, one that also strips
+`display: none` — and each is caught by exactly one of them.
 
 ### And the external number
 
@@ -229,13 +267,30 @@ fetched over plain HTTP with no browser spoofing and returning 200 with its text
 bytes. [`evals/extraction/corpus.mts`](../../evals/extraction/corpus.mts) runs stock Readability
 against rung 0 over all of them. No model, no money.
 
-**Un-hiding regresses nothing.** 0 of 14. It also helps 0 of 14 — the accordion pattern does not
-recur here — so the fix is *safe on this evidence and narrow*, which is a different thing from
-proven.
+#### The corpus could not judge its own arm, and said so confidently
+
+The first run printed **"un-hiding regresses 0 of 14, helps 0 of 14"** and that was true and nearly
+useless. The fourteen were chosen to fill the failure-mode table, and between them they held **not
+one collapsed accordion** — so the arm had nothing to act on, and thirteen "unchanged" rows were
+thirteen pages where the code never ran. A safety claim measured on an inert change is the shape
+[silent-success.md](../reusable/silent-success.md) is about, and it took the form here of a corpus
+that could not exercise the one thing it existed to decide.
+
+Two changes fixed it, and both were needed:
+
+1. **A fifteenth fixture** — `constitution.html`, the page the failure mode was found on, captured
+   the same way as the other fourteen. Now the arm has something to act on.
+2. **Comparing documents, not counts.** `articleHtml` is carried through the instrument so two arms
+   can be compared as strings. That is how the `[hidden]` regression surfaced: equal character
+   counts are not an unchanged page, and Wikipedia proved the point in the other direction —
+   identical text length, 3,572 fewer bytes, all of it the removed attribute.
+
+With both: **13 of 15 byte-identical, 1 attribute-only, 1 helped**, and 0 regressions that are
+regressions. Written up under [The fix](#the-fix-and-what-it-costs).
 
 And then the number that reframes the whole exercise:
 
-> **12 of 14 pages lose 10% or more of some structural element.** Not prose — tables, formulas,
+> **13 of 15 pages lose 10% or more of some structural element.** Not prose — tables, formulas,
 > code, headings.
 
 | fixture | what it loses |
@@ -517,11 +572,16 @@ number comparable to a published one.
 
 1. ~~The inventory harness~~ — **built**, tested, five bugs and all.
 2. Add source-id provenance beside the text matcher, and report disagreements.
-3. ~~Fixtures~~ — **14 fetched and measured**, one per failure slot, listed in
-   [`corpus.mts`](../../evals/extraction/corpus.mts). The HTML is **not committed**: 6 MB of other
-   people's pages, and whether that belongs in the repo is Greg's call. WCXB's article subset is
-   still the right thing to add for a comparable published number.
-4. ~~Rung 0 across the corpus~~ — **done: 0 regressions, 0 further wins.**
+3. ~~Fixtures~~ — **15 fetched, committed and hashed**, listed in
+   [`corpus.mts`](../../evals/extraction/corpus.mts) and described in
+   [`fixtures/README.md`](../../evals/extraction/fixtures/README.md). Greg's call, 2026-08-28: a URL
+   is not a fixture. WCXB's article subset is still the right thing to add for a comparable published
+   number.
+4. ~~Rung 0 across the corpus~~ — **done, and then done again properly.** The first answer was "0
+   regressions, 0 wins" from a corpus with no instance of the failure mode. Now: 13 of 15
+   byte-identical, 1 attribute-only, 1 helped, 0 regressions. **Shipped** as
+   `unhideCollapsedSections` in [`src/extract.ts`](../../src/extract.ts), without the `[hidden]` half,
+   which was measured and is a regression.
 5. **A structural check, which is now the most valuable thing on this list.** Counting kept-over-
    present per tag is a dozen lines, costs nothing, needs no gold, and it is the only thing that
    sees the failure the corpus says is most common. It belongs in stage 2 as a warning, not in an
@@ -534,10 +594,12 @@ number comparable to a published one.
 
 ## Decisions for Greg
 
-- **Ship rung 0 now?** The corpus answers the risk half: **0 regressions in 14 pages.** It recovers a
-  quarter of an article we hold and, on this set, wins nothing else. Cheap and safe, narrow benefit.
+- ~~**Ship rung 0 now?**~~ **Shipped, 2026-08-28**, `aria-hidden` only. Recovers a quarter of an
+  article we hold, leaves 13 of 15 pages byte-identical, and makes 188 Wikipedia formulas audible to
+  a screen reader as a side effect. Narrow benefit, and now with an instrument that could have
+  detected a wide harm. Back it out by deleting one function if a page turns up where it misfires.
 - **The structural check is the one I would build first**, and it was not in the original question.
-  It is free, deterministic, needs no gold, and it catches the failure 12 of 14 pages exhibit —
+  It is free, deterministic, needs no gold, and it catches the failure 13 of 15 pages exhibit —
   including one that quietly guts the granularity-zoom tree.
 - **Is a second extractor allowed?** The published gap between Readability and trafilatura on
   article pages is larger than anything a repair pass has been shown to buy. It is a new dependency,
diff --git a/docs/project/block-ids.md b/docs/project/block-ids.md
index 586ef73..948b85e 100644
--- a/docs/project/block-ids.md
+++ b/docs/project/block-ids.md
@@ -169,6 +169,35 @@ at a diagram — they simply must not generate a row of their own. On the test a
 pull-quotes are word-for-word repeats of body sentences, so without this the ToC would grow eleven
 phantom rows quoting text it had already listed.
 
+### A bare `<svg>` gets no id, and the ToC cannot point at a diagram
+
+**Known hole, found 2026-08-28** while measuring extraction
+([260827ab-readability-repair-pass.md](../plans/260827ab-readability-repair-pass.md)). The sentence above says the ToC
+may well want to point at a diagram. For a `<figure>`-wrapped one it can. For a bare inline `<svg>`
+it cannot, and nothing says so:
+
+```
+<p id="spya-vrkayh">Before the diagram…</p>
+<svg viewBox="0 0 10 10">…</svg>                          ← no id, no block, no row
+<figure id="spya-vqsgvn"><svg>…</svg><figcaption>…</figcaption></figure>
+```
+
+Two things combine. [`src/blocks.ts`](../../src/blocks.ts) matches tag names in **upper case**,
+because that is what `tagName` gives for an HTML element — but `svg` and `math` are *foreign*
+elements and keep their case, so `svg` matches neither `LEAF_BLOCKS` nor `CONTAINERS`. It falls to
+the unknown-wrapper branch, which keeps an element only if it has text; a diagram usually has none.
+The element survives into the page, with no id on it and no block behind it. A `<math>` block
+escapes by accident — a formula has text.
+
+That matters because keeping inline diagrams was a deliberate choice — Greg, 2026-08-25, recorded in
+[`src/sanitize-policy.ts`](../../src/sanitize-policy.ts), knowingly accepting that foreign content is
+where most historical mXSS bypasses live. We take that risk to keep the diagram and then cannot
+address it: no ToC row, no note anchored to it, nothing for zoom to fold.
+
+The fix is small — a lower-case leaf set — and is **not** made here, because widening what gets an id
+is this document's decision and not an extraction eval's. Note if it is taken: adding `"SVG"` to
+`LEAF_BLOCKS` would look right and do nothing, for the casing reason above.
+
 ## The article's own links
 
 Stage 3 does not only *add* an id. Where the author already put one on a paragraph or a heading, it
diff --git a/docs/project/browser-testing.md b/docs/project/browser-testing.md
index b967b7a..ae8ce74 100644
--- a/docs/project/browser-testing.md
+++ b/docs/project/browser-testing.md
@@ -28,6 +28,25 @@ assumes 5273 gets a refused connection or — worse — *somebody else's* dev se
 page that looks exactly right and is running different code. Read the port off the line Vite prints
 and pass it on to anything you dispatch.
 
+### There is no `file://` shortcut — serve it
+
+**The Chrome extension refuses `file://` URLs.** `navigate` comes back with an error rather than a
+page, and the tab does not move. This costs an hour if you don't know it, because writing a
+throwaway HTML file and opening it is the obvious way to look at one page of markup, and it is the
+one way that cannot work.
+
+Serve the directory instead, on a port nothing else is using, and hand the agent an `http://`
+address:
+
+```bash
+npx http-server <dir> -p 8791 --silent    # then navigate to http://127.0.0.1:8791/page.html
+```
+
+Used on 2026-08-28 to check what fourteen extracted articles actually look like — rebuilt pages
+written to a scratch directory, served, and screenshotted. The related trick for getting a *real
+component* on screen without the auth gate is a throwaway Vite page, which the dev server already
+serves over HTTP and so never runs into this.
+
 ### A phone-width window does not exist, so use an iframe
 
 **Chrome on macOS will not make a window narrower than 605 CSS px.** `resize_window` returns
diff --git a/docs/project/content-extraction.md b/docs/project/content-extraction.md
index e45b41c..778765d 100644
--- a/docs/project/content-extraction.md
+++ b/docs/project/content-extraction.md
@@ -85,10 +85,27 @@ instrument that does — [`evals/extraction/inventory.mts`](../../evals/extracti
 which flattens the fetched page into blocks and says which survived — and it is an eval, run by
 hand, not a gate ([evals/README.md](../../evals/README.md)).
 
-The measurements, the four bugs the instrument shipped with, what a model pass would and would not
-buy, and the four-line deterministic fix that recovers 39,355 of those characters for nothing, are
-all in **[../plans/260827ab-readability-repair-pass.md](../plans/260827ab-readability-repair-pass.md)**. Nothing here
-has changed yet; the plan says what would have to be true first.
+**That one is fixed**, 2026-08-28: `unhideCollapsedSections` in [`src/extract.ts`](../../src/extract.ts)
+removes `aria-hidden="true"` before Readability looks at the page, recovering 39,355 of those
+characters for nothing — no model, no money, no latency. It removes `aria-hidden` and **only** that:
+`[hidden]` and inline `display: none` are stronger claims, and the measurement that says so is on the
+function.
+
+The rest is not fixed, and the largest of it is not truncation at all:
+
+> **13 of the 15 fixture pages lose 10% or more of some structural element** — tables, formulas,
+> code, headings. Wikipedia's *Transformer* article arrives with **0 of its 188 formulas**; a
+> 24,000-word ACX review keeps 19 of 134 headings.
+
+That matters here more than in most reading apps, because the table of contents and the
+granularity-zoom tree are the same structure, built from headings
+([granularity-zoom.md](granularity-zoom.md#the-tree)). An article whose headings were dropped at this
+stage has no tree to build at stages 4 and 5, and nothing reports it. The character comparison barely
+notices — the prose around a discarded formula is intact.
+
+The measurements, the five bugs the instrument shipped with, the fifteen committed fixtures, and what
+a model pass would and would not buy are all in
+**[../plans/260827ab-readability-repair-pass.md](../plans/260827ab-readability-repair-pass.md)**.
 
 ## Where this sits
 
diff --git a/evals/extraction/corpus.mts b/evals/extraction/corpus.mts
index b0ebd99..d887209 100644
--- a/evals/extraction/corpus.mts
+++ b/evals/extraction/corpus.mts
@@ -28,6 +28,7 @@
  * never a quietly updated hash.**
  */
 import { inventoryFile } from "./inventory.mjs";
+import { JSDOM, VirtualConsole } from "jsdom";
 import { existsSync } from "node:fs";
 import { writeFile } from "node:fs/promises";
 import path from "node:path";
@@ -68,6 +69,16 @@ export const CORPUS: { name: string; file: string; url: string; slot: string }[]
     url: "https://www.gutenberg.org/cache/epub/1342/pg1342-images.html" },
   { name: "cornell-17-107", file: "cornell.html", slot: "W/B",
     url: "https://www.law.cornell.edu/uscode/text/17/107" },
+  /* **The fifteenth, added last and for a reason worth stating.** The first
+     fourteen were chosen for the failure-mode table, and between them they
+     contained not one collapsed `aria-hidden` accordion — so the un-hide arm was
+     INERT on the whole corpus, and "zero regressions in fourteen pages" was a
+     safety claim about a change that had nothing to act on. A corpus that cannot
+     exercise the arm it exists to judge is measuring the wrong thing quietly.
+     This page is where the failure mode was found in the first place: a quarter
+     of it lives inside three closed accordions. */
+  { name: "constitution", file: "constitution.html", slot: "T",
+    url: "https://www.anthropic.com/constitution" },
 ];
 
 /**
@@ -107,6 +118,43 @@ function notable(a: Arm, rawChars: number): boolean {
   return a.droppedChars / Math.max(1, rawChars) >= NOTABLE_FRACTION && a.biggestGap >= NOTABLE_RUN;
 }
 
+/**
+ * **The blocks the un-hidden arm has and stock does not, as text a human reads.**
+ *
+ * This exists because of an instrument bug that scored a regression as a win.
+ * The first version of the un-hide arm removed `[hidden]` as well as
+ * `aria-hidden`, and on arxiv.org/abs that recovered 95 characters — so
+ * `droppedChars` went DOWN, `helped` was false only because 95 < 1000, and
+ * `regressed` was false because the check fires on text *lost*. Recovering
+ * furniture is invisible to every number above. The 95 characters were "View a
+ * PDF of the paper titled …", a screen-reader label for a link.
+ *
+ * No arithmetic tells recovered body text from recovered chrome; that is the
+ * same wall the `notable` threshold hits, one paragraph down. So this does not
+ * judge — it prints, and the run says READ THEM. Seeing "Claude's three types of
+ * principals" next to "View a PDF of the paper titled" settles it in a second,
+ * and no threshold ever would.
+ */
+function gainedText(stockHtml: string, unhidHtml: string): string[] {
+  if (stockHtml === unhidHtml) return [];
+  const norm = (t: string): string => t.replace(/\s+/g, " ").trim();
+  const parse = (h: string): { doc: Document; text: string } => {
+    const doc = new JSDOM(`<body>${h}</body>`, { virtualConsole: new VirtualConsole() }).window.document;
+    return { doc, text: norm(doc.body.textContent ?? "") };
+  };
+  const before = parse(stockHtml);
+  const after = parse(unhidHtml);
+  const out: string[] = [];
+  for (const el of Array.from(after.doc.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, pre, blockquote"))) {
+    const t = norm(el.textContent ?? "");
+    /* 40 characters, because a one-word `<li>` matches something somewhere in
+       any long article by accident and would bury the real additions. */
+    if (t.length < 40) continue;
+    if (!before.text.includes(t)) out.push(t);
+  }
+  return out;
+}
+
 async function main(): Promise<void> {
   /* Defaults to the committed fixtures; CORPUS overrides it for a scratch set. */
   const dir = process.env.CORPUS ?? path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures");
@@ -130,15 +178,22 @@ async function main(): Promise<void> {
     const a = arm(stock);
     const b = arm(unhid);
     const raw = stock.rawTextChars;
+    const gained = gainedText(stock.articleHtml, unhid.articleHtml);
 
-    /* A regression is the fix LOSING text it was not losing before, or dragging
-       in so much that the ratio jumps — both directions, because un-hiding can
-       fail either way and only one of them is obvious. */
-    const regressed = b.droppedChars > a.droppedChars + 200 || b.ratio > a.ratio + 0.15;
+    /* **A regression is the fix LOSING text it was not losing before** — and
+       only that. The `|| b.ratio > a.ratio + 0.15` half that used to be here,
+       meant to catch the fix dragging in the whole page, fired on the one page
+       where the fix works: recovering a quarter of the constitution moves the
+       ratio 0.737 → 0.942 by definition, so the run printed "un-hide helps" and
+       "!! UN-HIDE REGRESSES" on the same line. A guard that cannot fire on
+       success is not a guard, it is a synonym. What replaced it is `gained`
+       below, which prints the added text instead of scoring it. */
+    const regressed = b.droppedChars > a.droppedChars + 200;
     const helped = a.droppedChars - b.droppedChars > 1000;
     const verdict =
       (notable(a, raw) ? "look" : "  ") +
       (helped ? "  un-hide helps" : "") +
+      (gained.length && !helped ? `  un-hide adds ${gained.length} block(s) — READ THEM` : "") +
       (regressed ? "  !! UN-HIDE REGRESSES" : "") +
       (a.coverage < 0.8 ? `  (coverage ${(a.coverage * 100).toFixed(0)}% — number unreliable)` : "") +
       (a.title === null ? "  parse() returned nothing" : "") +
@@ -148,7 +203,14 @@ async function main(): Promise<void> {
       `${c.name.padEnd(22)} ${c.slot.padEnd(6)} ${raw.toLocaleString().padStart(8)} ` +
       `${a.droppedChars.toLocaleString().padStart(11)} ${b.droppedChars.toLocaleString().padStart(12)}  ${verdict}`,
     );
-    rows.push({ ...c, rawTextChars: raw, stock: a, unhidden: b, notable: notable(a, raw), helped, regressed });
+    for (const g of gained.slice(0, 3)) console.log(`${" ".repeat(24)}+ ${JSON.stringify(g.slice(0, 110))}`);
+    rows.push({
+      ...c, rawTextChars: raw, stock: a, unhidden: b,
+      notable: notable(a, raw), helped, regressed,
+      identical: stock.articleHtml === unhid.articleHtml,
+      gainedBlocks: gained.length,
+      gained: gained.slice(0, 12),
+    });
   }
 
   const bad = rows.filter((r) => r.notable).length;
diff --git a/evals/extraction/fixtures/README.md b/evals/extraction/fixtures/README.md
index 279a864..9a0eaea 100644
--- a/evals/extraction/fixtures/README.md
+++ b/evals/extraction/fixtures/README.md
@@ -1,4 +1,4 @@
-# `evals/extraction/fixtures/` — fourteen pages Readability has to get right
+# `evals/extraction/fixtures/` — fifteen pages Readability has to get right
 
 Captured **2026-08-28**, hashed, and committed. Run by hand, not by `npm test` — see
 [evals/README.md](../../README.md) and
@@ -6,7 +6,7 @@ Captured **2026-08-28**, hashed, and committed. Run by hand, not by `npm test` 
 which is the plan these were chosen for.
 
 ```bash
-npx tsx evals/extraction/corpus.mts            # stock Readability vs rung 0, all fourteen
+npx tsx evals/extraction/corpus.mts            # stock Readability vs what stage 2 ships, all fifteen
 npx tsx evals/extraction/fixtures/verify.mts   # are these the bytes the numbers came from?
 npx tsx evals/extraction/fixtures/verify.mts --refetch   # and does the web still serve them?
 ```
@@ -40,7 +40,7 @@ article text in the initial bytes.
 Each was re-fetched with a bare default `curl` user-agent and still returned 200, so none of them
 depends on pretending to be a browser.
 
-## The fourteen
+## The fifteen
 
 Slots are the failure modes in
 [the plan's table](../../../docs/plans/260827ab-readability-repair-pass.md#six-ways-it-goes-wrong):
@@ -54,7 +54,7 @@ Slots are the failure modes in
 | `rfc9110.html` | T/S | [rfc-editor.org](https://www.rfc-editor.org/rfc/rfc9110.html) | IETF Trust, no cache restriction | 295 nested sections five heading levels deep, 161 `<pre>` of ABNF, 13 tables, 72k words. RFCs are never revised, so this one cannot drift |
 | `whatwg.html` | T/S | [html.spec.whatwg.org](https://html.spec.whatwg.org/multipage/parsing.html) | CC BY 4.0 | **No wrapper element at all** — 1,543 `<p>` and 1,055 `<li>` are direct children of `<body>`, so scoring has nothing to grab but `<body>` |
 | `wiki_transformer.html` | S/D/B | [Wikipedia](https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)) | CC BY-SA 4.0 | 188 formulas each carrying MathML **and** its LaTeX source, so every one lands in `textContent` twice |
-| `ar5iv.html` | S/T | [ar5iv](https://ar5iv.labs.arxiv.org/html/1706.03762) | per-paper arXiv licence | LaTeXML output for *Attention Is All You Need*: 142 `<math>`, a different math convention from Wikipedia's. The likeliest of the fourteen to disappear |
+| `ar5iv.html` | S/T | [ar5iv](https://ar5iv.labs.arxiv.org/html/1706.03762) | per-paper arXiv licence | LaTeXML output for *Attention Is All You Need*: 142 `<math>`, a different math convention from Wikipedia's. The likeliest of the fifteen to disappear |
 | `arxiv_abs.html` | W | [arXiv](https://arxiv.org/abs/1706.03762) | metadata CC0 | The only prose is a 250-word abstract, competing with metadata panels of comparable weight |
 | `aaronson.html` | B/W | [Shtetl-Optimized](https://scottaaronson.blog/?p=7784) | © the author | 5,560 words of post, **52,776 words of comment thread**, all server-rendered in the initial HTML |
 | `acx.html` | B | [Astral Codex Ten](https://www.astralcodexten.com/p/your-book-review-the-educated-mind) | © the author | A 24k-word review inside six subscribe widgets, a share rail and a comments module |
@@ -63,9 +63,21 @@ Slots are the failure modes in
 | `mdn_cache.html` | B/D/S | [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) | CC BY-SA 2.5 | 550 `<li>` of sidebar, plus an inline "In this article" `<nav>` that repeats every heading |
 | `gutenberg.html` | T/B | [Project Gutenberg](https://www.gutenberg.org/cache/epub/1342/pg1342-images.html) | public domain text | 131k words, 2,147 `<p>`, 65 chapters, all flat siblings — the size stress test — bracketed by two near-identical licence blocks |
 | `cornell.html` | W/B | [Cornell LII](https://www.law.cornell.edu/uscode/text/17/107) | US statute, public domain | The inverse of Aaronson: a 450-word statute buried under Notes and Source Credit ten times its length |
+| `constitution.html` | T | [anthropic.com](https://www.anthropic.com/constitution) | © Anthropic | **A quarter of the article inside three closed accordions**, `aria-hidden="true"` on the containers. Added second, because the first fourteen contained no instance of it |
+
+### Why the fifteenth was added afterwards
+
+The first fourteen were picked to fill the failure-mode table, and between them they held **not one
+collapsed accordion**. So the un-hide arm was inert on the entire corpus, and "zero regressions in
+fourteen pages" — which is what the run printed, truthfully — was a safety claim about a change with
+nothing to act on. It looked like evidence and was the absence of evidence, which is the shape
+[silent-success.md](../../../docs/reusable/silent-success.md) is about.
+
+The page that *had* the failure mode was the one it was found on, and it was not in the corpus. It is
+now, captured the same way as the rest — plain GET, browser-ish `User-Agent`, no JavaScript.
 
 The licence column records what the page says about itself. These are **committed as test inputs in
-a private repo**, not redistributed; none of the fourteen prohibits caching. `gutenberg.html` asks
+a private repo**, not redistributed; none of the fifteen prohibits caching. `gutenberg.html` asks
 that its header be kept with the text, which it is, since the file is byte-identical to what was
 served.
 
diff --git a/evals/extraction/inventory.mts b/evals/extraction/inventory.mts
index 4d1a355..20ddabe 100644
--- a/evals/extraction/inventory.mts
+++ b/evals/extraction/inventory.mts
@@ -31,6 +31,7 @@
  */
 import { JSDOM, VirtualConsole } from "jsdom";
 import { Readability } from "@mozilla/readability";
+import { unhideCollapsedSections } from "../../src/extract.js";
 import { readFile, writeFile } from "node:fs/promises";
 import { existsSync } from "node:fs";
 import path from "node:path";
@@ -334,6 +335,14 @@ export interface Inventory extends Comparison {
   url: string;
   rawBytes: number;
   title: string | null;
+  /**
+   * Readability's own output, verbatim. Carried so a caller can compare two arms
+   * **as documents** rather than as character counts — which is how the `[hidden]`
+   * regression hid for a day (see `gainedText` in corpus.mts). Equal counts are
+   * not an unchanged page, and un-hiding Wikipedia proved it: identical text
+   * length, 3,572 fewer bytes, all of it the removed attribute.
+   */
+  articleHtml: string;
 }
 
 /**
@@ -490,24 +499,11 @@ export function compare(rawHtml: string, articleHtml: string, url: string): Comp
 /**
  * Rung 0 of docs/plans/260827ab-readability-repair-pass.md — **un-hide before parsing.**
  *
- * Readability skips `aria-hidden="true"` and `hidden` nodes in its visibility
- * check (`Readability.js:2701`). That is right for an off-screen menu and wrong
- * for a collapsed section of the article: an accordion is *closed*, not absent,
- * and the reader would see the text by clicking. Readability cannot click.
- *
- * On data/constitution this recovers 39,355 characters and changes nothing on
- * the two pages that were already clean — which is the whole evidence for it,
- * and three pages is not enough to ship on. It is here as an ARM, so the model
- * arm can be measured against a pre-cleaned page rather than against stock. The
- * risk it carries is the obvious one and is unmeasured: some other site's hidden
- * mobile nav, modal or screen-reader duplicate coming along for the ride.
+ * Re-exported from src/extract.ts rather than reimplemented, so this eval scores
+ * the code that ships. The reasoning, the fifteen-page evidence and the reason
+ * `[hidden]` is *not* in it are all on `unhideCollapsedSections`.
  */
-export function unhide(doc: Document): void {
-  for (const el of Array.from(doc.querySelectorAll('[aria-hidden="true"]'))) {
-    el.removeAttribute("aria-hidden");
-  }
-  for (const el of Array.from(doc.querySelectorAll("[hidden]"))) el.removeAttribute("hidden");
-}
+export const unhide = unhideCollapsedSections;
 
 /**
  * Readability over one HTML file, compared with the page it came from.
@@ -532,10 +528,12 @@ function inventoryHtml(html: string, url: string, opts: { unhide?: boolean }): I
   const doc = new JSDOM(html, { url, virtualConsole: new VirtualConsole() }).window.document;
   if (opts.unhide) unhide(doc);
   const article = new Readability(doc).parse();
+  const articleHtml = article?.content ?? "";
   return {
     dir: "", url, rawBytes: Buffer.byteLength(html),
     title: article?.title ?? null,
-    ...compare(html, article?.content ?? "", url),
+    articleHtml,
+    ...compare(html, articleHtml, url),
   };
 }
 
diff --git a/src/extract.ts b/src/extract.ts
index de9ed17..501784b 100644
--- a/src/extract.ts
+++ b/src/extract.ts
@@ -160,6 +160,56 @@ export interface ExtractResult {
   excerpt: string | null;
 }
 
+/**
+ * **Un-hide `aria-hidden="true"` before Readability looks at the page.**
+ *
+ * Readability's visibility check (`Readability.js:2701`) skips any node marked
+ * `aria-hidden="true"`, along with `[hidden]` and inline `display: none`. That
+ * is right for an off-screen menu and wrong for a **collapsed section of the
+ * article**: an accordion is closed, not absent, and a reader would see the text
+ * by clicking on it. Readability cannot click.
+ *
+ * Measured over the fifteen pages in evals/extraction/fixtures/ (run
+ * `npx tsx evals/extraction/corpus.mts`), removing the attribute does exactly
+ * two things and is byte-for-byte inert on the other thirteen:
+ *
+ * 1. **anthropic.com/constitution: 39,355 characters come back** — a quarter of
+ *    the article. Three `ExpandableSection` divs holding *Claude's three types
+ *    of principals*, the verification passage and the hard constraints. Real
+ *    body text, collapsed by default, invisible to every stage after this one.
+ * 2. **Wikipedia: 188 formula images stop being hidden from screen readers.**
+ *    Wikipedia writes each formula twice — MathML inside `style="display: none"`
+ *    for assistive tech, and a fallback `<img aria-hidden="true">` for eyes.
+ *    Readability drops the MathML (inline `display: none`, which this does NOT
+ *    touch) and keeps the image, so the attribute ends up pointing at an
+ *    accessible twin that no longer exists and a screen-reader user gets silence
+ *    for all 188. The `alt` is the TeX, so removing it is what leaves them
+ *    audible.
+ *
+ * **`[hidden]` is deliberately not touched**, though the first version of this
+ * removed it too. Across the same fifteen pages it changed exactly one, arxiv.org
+ * abs, and what it added was 95 characters of *furniture*: "View a PDF of the
+ * paper titled …", a screen-reader label for a link. That is the whole measured
+ * effect, and it is a regression — caught only because the arm was compared
+ * document-against-document rather than by counting recovered characters, which
+ * scored it as a gain. The distinction that matters: `hidden` is the HTML spec's
+ * own "not currently relevant" and authors mean it, whereas `aria-hidden` is an
+ * accessibility annotation, and the visual/assistive split is exactly where
+ * readable text gets marked invisible to a parser.
+ *
+ * Inline `display: none` is left alone for the same reason — it is a stronger
+ * claim, and stripping it on Wikipedia would restore 188 MathML formulas *beside*
+ * the 188 images that already render them.
+ *
+ * Exported because evals/extraction/inventory.mts scores this arm and must score
+ * the code that ships, not a second copy of it.
+ */
+export function unhideCollapsedSections(doc: Document): void {
+  for (const el of Array.from(doc.querySelectorAll('[aria-hidden="true"]'))) {
+    el.removeAttribute("aria-hidden");
+  }
+}
+
 /**
  * Stage 2 — Readability over already-fetched HTML, and the artefacts that fall
  * out of it.
@@ -206,6 +256,7 @@ export async function runExtract(opts: {
     url: opts.url,
     virtualConsole: new VirtualConsole(),
   });
+  unhideCollapsedSections(dom.window.document);
   const article = new Readability(dom.window.document).parse();
   if (!article) {
     throw new Error("Readability could not parse this page.");

=== NEW FILE: tests/extract-unhide.test.ts ===
/**
 * Stage 2 un-hides `aria-hidden="true"` before Readability looks at the page,
 * and leaves `[hidden]` and `display: none` alone.
 *
 * The reasoning and the fifteen-page evidence are on `unhideCollapsedSections`
 * in src/extract.ts. What is pinned here is the *shape* of the rule, because
 * every part of it was arrived at by measurement and each is one careless edit
 * from being widened back:
 *
 * - `[hidden]` is left alone because removing it recovered 95 characters of
 *   furniture on arxiv.org and nothing anywhere else.
 * - inline `display: none` is left alone because stripping it on Wikipedia would
 *   restore 188 MathML formulas *beside* the 188 images already rendering them.
 *
 * The last test is the one that matters most and is the least obvious: this runs
 * before Readability, so a rule that removed too much would not throw — it would
 * quietly enlarge the article, which is the direction nothing downstream checks.
 */
import { describe, expect, it } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { unhideCollapsedSections } from "../src/extract.js";

const doc = (html: string): Document =>
  new JSDOM(`<body>${html}</body>`, { virtualConsole: new VirtualConsole() }).window.document;

describe("unhideCollapsedSections", () => {
  it("removes aria-hidden=true", () => {
    const d = doc('<div aria-hidden="true"><p>A collapsed section of the article.</p></div>');
    unhideCollapsedSections(d);
    expect(d.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it("leaves aria-hidden=false alone, rather than removing the attribute wholesale", () => {
    const d = doc('<div aria-hidden="false"><p>Shown.</p></div>');
    unhideCollapsedSections(d);
    expect(d.querySelector("div")?.getAttribute("aria-hidden")).toBe("false");
  });

  it("does NOT remove [hidden] — measured as furniture, not article text", () => {
    const d = doc("<div hidden><p>View a PDF of the paper titled …</p></div>");
    unhideCollapsedSections(d);
    expect(d.querySelectorAll("[hidden]")).toHaveLength(1);
  });

  it("does NOT touch inline display:none — a stronger claim than aria-hidden", () => {
    const d = doc('<span style="display: none;"><math><mi>x</mi></math></span>');
    unhideCollapsedSections(d);
    expect(d.querySelector("span")?.getAttribute("style")).toContain("display: none");
  });

  it("changes nothing on a page with nothing hidden", () => {
    const html = "<article><p>One paragraph.</p><p>And another.</p></article>";
    const d = doc(html);
    const before = d.body.innerHTML;
    unhideCollapsedSections(d);
    expect(d.body.innerHTML).toBe(before);
  });
});

describe("what Readability then does with it", () => {
  /* Long enough that Readability keeps it: its default charThreshold is 500,
     and a fixture under that falls through to a retry with different rules and
     tests nothing anybody can reason about. */
  const para = (n: number): string =>
    `<p>${`Sentence ${n} of a genuinely long paragraph, written out at length so the extractor has something with real weight to score. `.repeat(6)}</p>`;

  const page = (attr: string): string =>
    `<html><body><article>${para(1)}${para(2)}` +
    `<div ${attr}>${para(3)}${para(4)}</div>` +
    `${para(5)}</article></body></html>`;

  const extract = (html: string, unhide: boolean): string => {
    const d = new JSDOM(html, { url: "https://example.invalid/a", virtualConsole: new VirtualConsole() })
      .window.document;
    if (unhide) unhideCollapsedSections(d);
    return new Readability(d).parse()?.textContent ?? "";
  };

  it("drops a collapsed section without the fix, and keeps it with", () => {
    /* **Watched red first.** Both halves are asserted in one test on purpose:
       either alone passes against broken code — the first against a rule that
       does nothing, the second against one that removes everything. */
    const html = page('aria-hidden="true"');
    expect(extract(html, false)).not.toContain("Sentence 3");
    expect(extract(html, true)).toContain("Sentence 3");
  });

  it("still drops a [hidden] section, because we no longer un-hide those", () => {
    const html = page("hidden");
    expect(extract(html, true)).not.toContain("Sentence 3");
  });

  it("still drops an inline display:none section", () => {
    const html = page('style="display: none"');
    expect(extract(html, true)).not.toContain("Sentence 3");
  });

  it("adds nothing to a page that hides nothing", () => {
    const html = page("data-nothing");
    expect(extract(html, true)).toBe(extract(html, false));
  });
});
```
