/**
 * The invariants a tree has to hold, as a function anything can call.
 *
 * The client renders the tree as an HTML table with `rowSpan`
 * (src/web/tree.ts), which only works if every node covers a contiguous range
 * and a node's children exactly partition it
 * (docs/project/granularity-zoom.md#the-tree). A tree that breaks those
 * invariants doesn't crash the client — it silently draws a wrong article.
 *
 * ## Why this is a module and not just the CLI it came out of
 *
 * All of this lived inside src/validate-tree.ts, which reads `process.argv` at
 * the top level and calls `process.exit`. So it could only ever be *run*, never
 * *called* — and the one place that most needs it is
 * `publishRevision` (src/store/pg-revisions.ts), which must refuse to make a
 * draft current when its tree does not describe its blocks.
 *
 * A review of the step 11 design caught the shape of the mistake that would
 * have followed: the publication guard as designed checked only that every
 * `range` endpoint names a block that exists, which proves *tree ids ⊆ block
 * ids* and nothing more. Two ways to pass it and still be wrong — append a
 * block, keeping every old id, and no leaf covers the new one; reorder the same
 * ids, and every endpoint still resolves while the ranges stop partitioning.
 * The full check was already written here; it simply was not reachable.
 * docs/plans/260826e-postgres-storage-implementation.md § What the review found.
 *
 * **The asymmetry worth remembering:** a valid tree is never rejected by the
 * stronger check, so the dangerous outcome is acceptance, not rejection.
 *
 * src/validate-tree.ts is now the CLI over this:
 *
 *   npm run validate-tree -- example
 *   npm run validate-tree -- data/<slug>
 */
import { isBody, isStructural } from "./block-policy.js";
import { isSupplementNode } from "./supplement.js";
import type { Block, Tree, TreeNode } from "./types.js";

/**
 * Are these two heading strings the same heading?
 *
 * Not `===`, and the reason is worth stating because the obvious version of
 * this check was wrong for a year's worth of articles that simply never had the
 * character in them.
 *
 * `sourceHeading` is the author's heading text **quoted back by a model**, and a
 * model quoting text does not reproduce bytes — it reproduces the heading. Ask
 * one to repeat `Claude’s Constitution` and a fair share of the time you get
 * `Claude's Constitution`: same heading, straight apostrophe. Publishers emit
 * the curly one (U+2019) because their CMS does, so the mismatch is between two
 * spellings of the same punctuation mark and nothing else.
 *
 * That is not a hypothetical. The first article to reach this check with
 * apostrophes in its headings — the Anthropic constitution, 36 headings — failed
 * on **eleven** of them, and every one of the eleven was an apostrophe. Zero of
 * the failures were a heading the model had got wrong, which is what this check
 * is for. A validator whose errors are all false is worse than no validator: it
 * teaches whoever reads it to stop reading it.
 *
 * So the comparison folds the characters that have a typographic and a
 * typewriter spelling — quotes, apostrophes, the dashes, the ellipsis — and
 * collapses runs of whitespace. It deliberately does **not** fold case or strip
 * words: a heading rewritten rather than quoted is exactly what should still
 * fail here, and this stays strict about every part of the text that carries
 * meaning.
 */
export function sameHeading(a: string, b: string): boolean {
  return normalisePunctuation(a) === normalisePunctuation(b);
}

function normalisePunctuation(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What one pass over a tree found.
 *
 * **`problems` and `advice` are not two severities of the same thing.** A
 * problem means the article would render wrongly — a gap in the partition, a
 * range that names a block that is not there. Advice means a label reads badly.
 * Failing a build, or refusing a publication, over prose would train everyone
 * to route around the check, so only `problems` is ever allowed to stop
 * anything.
 */
export interface TreeCheck {
  /** Structural. Non-empty means the tree must not be rendered or published. */
  readonly problems: string[];
  /** Editorial. Worth printing, never worth failing. */
  readonly advice: string[];
  /** How many nodes at each depth, for the CLI's summary line. */
  readonly byDepth: ReadonlyMap<number, number>;
}

/**
 * Check a tree against its blocks. Pure: it reads nothing and writes nothing.
 *
 * The messages are the CLI's, word for word, because tests/validate-tree.test.ts
 * and tests/validate-tree-rows.test.ts match on them — and because a publication
 * refusal is read by the same person who reads the CLI output.
 */
/**
 * **The same invariants, as a gate rather than as a report.**
 *
 * `checkTree` returns its problems, which is what a CLI wants
 * (src/validate-tree.ts) and what a publish guard wants
 * (src/store/pg-revisions.ts, which turns them into reasons an article may not
 * be published). Neither of those runs when a tree is *written* to the
 * filesystem, so `generateHierarchy` could produce a structurally invalid tree, write
 * it, and report the step done — and every later stage would read it and agree
 * with it. That is the whole of GPT Sol's F5: the invariants existed and the
 * one path most of this repo's testing goes through never asked them.
 *
 * Throwing rather than warning is deliberate. An invalid tree is not a
 * recoverable representation of an article; publishing one converts a visible
 * pipeline failure into a silent reader-facing one, and a warning at this point
 * is the guard that goes quiet exactly when it is defeated
 * (docs/reusable/silent-success.md). The step throws, src/jobs.ts records it,
 * and the queue's retry asks the model again.
 *
 * **Capped at ten**, because a root whose range is wrong reports once per block
 * and the message would otherwise be a megabyte — the same cap and the same
 * reason as the publish guard.
 *
 * **And no problem string carries article prose.** That is a property of the
 * messages in this file rather than of this function, and it became load-bearing
 * the moment they could be thrown: a thrown step error is written to the log by
 * src/jobs.ts with `errorFields`, which keeps `message` and `stack`. The
 * `sourceHeading` message quoted the author's own heading until 2026-08-29 —
 * see it above. docs/project/logging.md.
 */
export function assertTreeSound(blocks: Block[], tree: Tree): void {
  const { problems } = checkTree(blocks, tree);
  if (problems.length === 0) return;
  const shown = problems.slice(0, 10);
  const more = problems.length > 10 ? ` … and ${problems.length - 10} more` : "";
  throw new Error(
    `The table of contents is not a valid tree, so it was not written ` +
      `(${problems.length} problem${problems.length === 1 ? "" : "s"}): ` +
      `${shown.join("; ")}${more}`,
  );
}

export function checkTree(blocks: Block[], tree: Tree): TreeCheck {
  /** Document order lives here and nowhere else — see block-ids.md. */
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);

  /**
   * Editorial complaints, not structural ones. A tree that trips these still
   * renders correctly, so they must not fail the build — but they are how a
   * drifting prompt shows up before a human notices the sidebar reads badly.
   */
  const advice: string[] = [];
  const warn = (msg: string) => advice.push(msg);

  const wordsIn = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

  /** Which blocks may never anchor a navigable row — `isStructural`, src/block-policy.ts. */
  const structural = new Map(blocks.map((b) => [b.id, isStructural(b)]));
  const blockKind = new Map(blocks.map((b) => [b.id, b.kind]));

  const span = (n: TreeNode): [number, number] | null => {
    const lo = index.get(n.range[0]);
    const hi = index.get(n.range[1]);
    if (lo === undefined) {
      fail(`${n.id}: range start "${n.range[0]}" not in blocks.json`);
      return null;
    }
    if (hi === undefined) {
      fail(`${n.id}: range end "${n.range[1]}" not in blocks.json`);
      return null;
    }
    if (lo > hi) {
      fail(`${n.id}: range is reversed (index ${lo} > ${hi})`);
      return null;
    }
    return [lo, hi];
  };

  const root = tree.nodes[tree.rootId];
  if (!root) fail(`rootId "${tree.rootId}" is not in nodes`);
  else {
    if (root.depth !== 0) fail(`root ${root.id}: depth is ${root.depth}, expected 0`);
    if (root.parent !== null) fail(`root ${root.id}: parent should be null`);
    const rootSpan = span(root);
    if (rootSpan && (rootSpan[0] !== 0 || rootSpan[1] !== blocks.length - 1))
      fail(
        `root ${root.id}: covers indices ${rootSpan[0]}–${rootSpan[1]}, expected 0–${blocks.length - 1}`,
      );
  }

  const covered = new Map<number, string>(); // block index -> leaf node id

  for (const node of Object.values(tree.nodes)) {
    const mySpan = span(node);
    if (!mySpan) continue;

    if (node.parent !== null) {
      // Same shape as the child loop below: look the node up once, and let the
      // "not in nodes" case be the thing that narrows the type.
      const parent = tree.nodes[node.parent];
      if (!parent) fail(`${node.id}: parent "${node.parent}" is not in nodes`);
      else {
        if (!parent.children.includes(node.id))
          fail(`${node.id}: parent ${parent.id} does not list it as a child`);
        if (node.depth !== parent.depth + 1)
          fail(`${node.id}: depth ${node.depth} but parent ${parent.id} is depth ${parent.depth}`);
      }
    }

    if (node.children.length === 0) {
      // Leaf: exactly one block, no gist (a summary must never replace real prose).
      if (mySpan[0] !== mySpan[1])
        fail(`${node.id}: leaf spans ${mySpan[1] - mySpan[0] + 1} blocks, expected 1`);
      if (node.gist)
        fail(
          `${node.id}: leaf carries a gist — leaves render verbatim text (granularity-zoom.md#node-shape)`,
        );

      /* Every block must be tiled by some leaf, media included — so a media
         block legitimately HAS a leaf, and so does a footnote. What neither
         must have is a navigable row: a sidebar entry captioning an image, or
         one per endnote, is the phantom-row failure `isStructural` exists to
         prevent. The tree's *shape* is unchanged by that predicate — only which
         leaves carry a label. */
      const blockId = blocks[mySpan[0]]?.id;
      if (blockId && structural.get(blockId) === false && node.navLabel)
        fail(
          `${node.id}: carries a navLabel but anchors ${blockId} ` +
            `(${blockKind.get(blockId)}, isStructural:false) — leave it unlabelled`,
        );
      if (blockId && structural.get(blockId) === true && !node.navLabel)
        warn(`${node.id}: labellable leaf ${blockId} has no navLabel — it will be unreachable in the ToC`);

      // Deep rows are long on purpose: a paragraph has no name of its own, and
      // its siblings are numerous and similar. See hierarchy.md. A
      // heading leaf is exempt — its label is the author's own title, and
      // "Soul Machine" is exactly right at two words.
      if (node.navLabel && blockId && blockKind.get(blockId) !== "heading") {
        const n = wordsIn(node.navLabel);
        if (n < 6 || n > 20)
          warn(`${node.id}: navLabel is ${n} words, expected 6–20 — ${JSON.stringify(node.navLabel)}`);
      }

      for (let i = mySpan[0]; i <= mySpan[1]; i++) {
        if (covered.has(i)) fail(`block index ${i} covered by both ${covered.get(i)} and ${node.id}`);
        covered.set(i, node.id);
      }
    } else {
      /* **The gist rule, stated in both directions**, and that is the whole
         reason `treatment` exists on a node rather than being read off the
         absent gist. Keyed on absence alone, a pipeline bug that drops a gist
         becomes indistinguishable from a deliberate supplement, and the
         dangerous outcome here is acceptance (see the header). So: an internal
         node must carry a gist *unless* it is a supplement, **and** a
         supplement must not carry one. Never infer the role from a missing
         gist.

         **The third exception, added 2026-08-30, obeys that rule rather than
         bending it.** A provisional tree — one carved from the author's own
         headings, with no model call and so nowhere to get a gist
         (src/heading-tree.ts) — is exempt here. The exemption is keyed on
         `tree.provisional`, a flag the builder sets and a bug cannot
         accidentally produce, and it buys exactly one thing: the gist. Every
         other rule below still applies to it in full, and a *finished* tree
         missing a gist fails exactly as it always did. If this were instead
         written as "an internal node with no gist is presumed provisional", it
         would be the same mistake in a third place. */
      if (isSupplementNode(node)) {
        if (node.gist)
          fail(
            `${node.id}: supplement carries a gist — the apparatus is shown as written, ` +
              `never summarised (docs/plans/260828o-footnotes.md § The tree)`,
          );
      } else if (!node.gist && !tree.provisional) {
        fail(`${node.id}: internal node has no gist — nothing to render at its level`);
      }

      // Titles stay short at every internal depth; it is navLabel that grows.
      const t = wordsIn(node.title ?? "");
      if (t === 0) fail(`${node.id}: internal node has no title`);
      else if (t > 8) warn(`${node.id}: title is ${t} words, expected 2–6 — ${JSON.stringify(node.title)}`);
      // Only our own titles are held to this. An authored heading reproduced
      // verbatim keeps its punctuation — "What (Not) To Do?" is the author's.
      if (!node.sourceHeading && /[.!?]$/.test(node.title ?? ""))
        warn(`${node.id}: title ends with sentence punctuation — it is a label, not a sentence`);

      // A node claiming an authored heading must actually contain one.
      if (node.sourceHeading) {
        const heading = node.sourceHeading;
        const inRange = blocks
          .slice(mySpan[0], mySpan[1] + 1)
          .some((b) => b.kind === "heading" && sameHeading(b.text, heading));
        if (!inRange)
          /* **The heading itself is deliberately not in the message.** These
             strings were a CLI's output and a publish guard's reasons when this
             was written; `generateHierarchy` now throws them (src/hierarchy.ts), and a
             thrown step error is written to the log by src/jobs.ts with
             `errorFields`, which keeps `message` and `stack`. That would put a
             line of the article's own prose into the logs, which nothing here
             may ever do — docs/project/logging.md. The node id is enough to
             find it, and the reader-facing text stays out. GPT Sol, 2026-08-29. */
          fail(
            `${node.id}: its sourceHeading does not match any heading block in ` +
              `its range`,
          );
      }

      // Children must tile the parent exactly, in order.
      let cursor = mySpan[0];
      for (const childId of node.children) {
        const child = tree.nodes[childId];
        if (!child) {
          fail(`${node.id}: child "${childId}" is not in nodes`);
          continue;
        }
        const childSpan = span(child);
        if (!childSpan) continue;
        /**
         * **No child may cover its parent's whole range** — unless it is a leaf.
         *
         * A rung that restates the one above it gives the reader two adjacent
         * gist columns of identical extent, neither marked `continuation`, so
         * both render in full and both are fisheye items. One rung finer buys a
         * restatement of the same paragraphs, against
         * docs/project/granularity-zoom.md's promise that level N is a
         * compression of level N+1.
         *
         * **A range statement, not a count**, and the exemption is why. In a
         * built tree a leaf is always *grown* — `buildTree` mints them from a
         * range, never from a proposal — so a leaf child covering the whole of
         * its parent means the parent spans exactly one block, which is the
         * ordinary shape of a one-block section (208 instances across every
         * saved tree, none of them a fault) and of a supplement holding exactly
         * one note block (docs/plans/260829a-footnotes-finish-upfront-sol.md §
         * F6). Phrased over `children.length` it would flag all of those, and a
         * validator whose errors are mostly false teaches people to stop
         * reading it — see `sameHeading` above.
         *
         * Silent here until 2026-09-05, and the silence was a gap rather than a
         * decision: `git log -S` finds nobody ever adding, removing or arguing
         * about such a rule, while `assertCascadeComplete` has rejected the
         * shape all along. `buildTree` now splices these away
         * (src/hierarchy.ts § `collapseRestatedRungs`); this is what says so for
         * every *other* producer of a tree, and for the ones already stored.
         */
        if (
          child.children.length > 0 &&
          childSpan[0] === mySpan[0] &&
          childSpan[1] === mySpan[1]
        )
          fail(
            `${node.id} → ${childId}: covers its parent's whole range, so one rung finer ` +
              `restates the same blocks instead of compressing them ` +
              `(granularity-zoom.md#the-tree)`,
          );
        if (childSpan[0] !== cursor)
          fail(
            `${node.id} → ${childId}: starts at index ${childSpan[0]}, expected ${cursor}` +
              (childSpan[0] > cursor ? " (gap)" : " (overlap)"),
          );
        cursor = childSpan[1] + 1;
      }
      if (cursor !== mySpan[1] + 1)
        fail(`${node.id}: children end at index ${cursor - 1}, parent ends at ${mySpan[1]}`);
    }
  }

  blocks.forEach((block, i) => {
    if (!covered.has(i)) fail(`block ${block.id} (index ${i}) is not covered by any leaf`);
  });

  checkSupplements(blocks, tree, index, fail);

  const byDepth = new Map<number, number>();
  for (const n of Object.values(tree.nodes)) byDepth.set(n.depth, (byDepth.get(n.depth) ?? 0) + 1);

  // A bad range is reported once by the node itself and once by its parent's
  // tiling check; the reader only needs to be told once.
  const unique = (xs: string[]) => [...new Set(xs)];

  return { problems: unique(problems), advice: unique(advice), byDepth };
}

/**
 * **The six things a supplement node has to be**, each stated separately.
 *
 * The exception the gist rule makes for a supplement (see `checkTree` above)
 * has to be paid for, or a malformed body node escapes
 * "every-internal-node-needs-a-gist" simply by calling itself apparatus. Six
 * checks, not one. A supplement node must:
 *
 *  1. be a depth-one child of the root
 *  2. cover exactly one contiguous range
 *  3. contain **only** blocks whose `treatment` is `supplement`
 *  4. contain **every** such block exactly once
 *  5. have only leaves beneath it
 *  6. carry no gist, and never be nested or be the root
 *
 * Each gets its own message and each is mutated separately in
 * tests/supplement.test.ts. "Delete the supplement and watch the validator
 * fail" mostly re-tests the old coverage invariant and proves nothing about any
 * of these.
 *
 * **Invariant 4 is conditional on there being a supplement node at all**, and
 * that condition is doing real work rather than softening the rule. Every tree
 * written before 2026-08-28 has notes and no supplement node; so does an
 * article whose notes are not one trailing run, which `splitBlocks` refuses to
 * build a node for rather than building an invalid one (src/supplement.ts).
 * Both must keep publishing. The trigger is the **presence of a node**, which
 * is explicit — not the absence of a gist, which is the inference this whole
 * design refuses to make.
 */
function checkSupplements(
  blocks: Block[],
  tree: Tree,
  index: Map<string, number>,
  fail: (msg: string) => void,
): void {
  const supplements = Object.values(tree.nodes).filter((n) => isSupplementNode(n));
  if (supplements.length === 0) return;

  const covers = new Map<number, string>(); // block index -> supplement node id

  for (const node of supplements) {
    // 1 — a depth-one child of the root, and 6's "never the root".
    if (node.id === tree.rootId)
      fail(`${node.id}: the root is the whole article and can never be the supplement`);
    if (node.depth !== 1 || node.parent !== tree.rootId)
      fail(
        `${node.id}: supplement is depth ${node.depth} under ${node.parent ?? "nothing"} — ` +
          `a supplement is a depth-one child of the root`,
      );
    // 6 — never nested. Implied by the parent check above, said in its own
    // words because "a supplement inside a supplement" is a different mistake
    // from "a supplement too deep", and the message is what gets read.
    if (node.parent !== null && isSupplementNode(tree.nodes[node.parent] ?? {}))
      fail(`${node.id}: supplement nested inside supplement ${node.parent}`);

    // 5 — only leaves beneath it. The apparatus is never given a structure of
    // its own; one node, then one leaf per block.
    const deep = node.children
      .map((id) => tree.nodes[id])
      .filter((c): c is TreeNode => !!c && c.children.length > 0);
    if (deep.length > 0)
      fail(
        `${node.id}: supplement has ${deep.length} internal child(ren) (${deep[0]!.id}) — ` +
          `only leaves may sit under a supplement`,
      );
    /* **And at least one leaf does.** "No child of mine has children" is
       satisfied vacuously by a supplement with no children at all, and the
       generic tiling rule only catches the shapes where the arithmetic shows:
       a childless node spanning six blocks reddens `leaf spans 6 blocks,
       expected 1`, but the **one-note article** spans exactly one block, where
       that message is exactly right and nothing fires. Measured, not reasoned:
       with six notes the mutation reddens the generic rule, with one note it
       reddened nothing at all. The consequence is that the two projections
       disagree about an article that renders — `navigableItems` (src/web/tree.ts)
       finds no cell to collapse and drops the apparatus, while the `?at=`
       tracker walks blocks and keeps it. GPT Sol, F6.
       Deliberately the weak rule and not "the children tile the range exactly":
       once there is one child, the generic parent invariant already requires the
       tiling and the generic leaf invariant already requires one block each, so
       the strong version would be a second check that can only ever disagree
       with those. */
    if (node.children.length === 0)
      fail(
        `${node.id}: supplement has no leaves — the apparatus is one node over ` +
          `one leaf per block, and a childless one is invisible to half the view`,
      );

    const lo = index.get(node.range[0]);
    const hi = index.get(node.range[1]);
    // A range whose endpoints do not resolve is already reported by `span`.
    if (lo === undefined || hi === undefined) continue;
    // 2 — one contiguous range, read as indices rather than as ids.
    if (lo > hi) {
      fail(`${node.id}: supplement range runs backwards (index ${lo} > ${hi})`);
      continue;
    }

    for (let i = lo; i <= hi; i++) {
      // 3 — only supplement blocks inside it. This is the direction that
      // matters most: a body paragraph swallowed by the supplement disappears
      // from the argument, from every summary and from the arc, and every other
      // check in this file would still pass.
      const block = blocks[i];
      if (block && isBody(block))
        fail(
          `${node.id}: supplement covers ${block.id} (index ${i}), which is body — ` +
            `a supplement contains only blocks whose treatment is "supplement"`,
        );
      const other = covers.get(i);
      // 2 — two supplements may sit side by side (Notes then References) but
      // never over one another.
      if (other) fail(`${node.id}: supplement overlaps supplement ${other} at block index ${i}`);
      else covers.set(i, node.id);
    }
  }

  // 4 — and every supplement block is inside one. See the note above on why
  // this is asked only of a tree that has a supplement node.
  const outside = blocks.filter((b, i) => !isBody(b) && !covers.has(i));
  if (outside.length > 0)
    fail(
      `${outside.length} supplement block(s) sit outside every supplement node ` +
        `(${outside.slice(0, 3).map((b) => b.id).join(", ")}) — a tree with a supplement node ` +
        `must put every note in one`,
    );
}
