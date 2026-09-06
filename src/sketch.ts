/**
 * **Stage: Sketch** — ask a model what shape the argument is, and let it draw
 * that shape.
 *
 * **There is no command line here.** Re-running this stage against one
 * article is a job, not a script:
 *
 *   POST /api/jobs { slug, steps: ["sketch"], force: ["sketch"] }
 *
 * That is the path the pipeline itself takes, so it exercises the store
 * writes — the half that actually breaks. The folder-reading CLI this file
 * used to carry was a second way to do the same thing, and was deleted on
 * 2026-09-01 (docs/project/ingest-queue.md § The pipeline is a list, not a function;
 * docs/plans/260831b-finish-the-database-move.md § sub-stage I).
 *
 * The other four diagrams each answer one question with one algorithm. This one
 * has no algorithm and no fixed picture: three arguments that converge, a hub
 * with satellites, a ladder, a funnel, two columns compared — the model decides
 * which the article *is*, and lays it out itself. The whole design and the
 * reasoning are in docs/project/diagram.md § Sketch and
 * docs/plans/260830j-sketch-diagram.md.
 *
 * What it does **not** do is emit SVG. It writes a scene in the five primitives
 * of src/sketch-scene.ts, which `readSketch` then checks against the article
 * before anything is drawn — see that file's header for why that is the whole
 * difference between this and a generated image.
 *
 * Shaped on src/ideas.ts, which is the nearest neighbour: article-reading,
 * on-demand, and it names block ids so it sends `articleWithIds`.
 */
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

import { anthropicCallFailed } from "./anthropic-call.js";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { isBodyEvidence } from "./block-policy.js";
import { stageFailure } from "./job-failure.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { parseJsonAnswer, readJsonOrNull } from "./parse-json.js";
import { hashProfile, PROFILE_RULES, profileSection } from "./profile.js";
import {
  accept,
  CANVAS_W,
  readSketch,
  SKETCH_VERSION,
  stripInferredOpens,
  scoreSketch,
  type Sketch,
  type SketchReport,
  type SketchScore,
} from "./sketch-scene.js";
import {
  articleWithIdsFingerprint,
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import type { Meta, Tree, TreeNode } from "./types.js";

/**
 * Bumped whenever SYSTEM or `renderPrompt` changes what the model is asked —
 * and it is **`SKETCH_VERSION` itself**, not a second copy of the same string.
 *
 * `readSketch` stamps `SKETCH_VERSION` (src/sketch-scene.ts) onto every sketch
 * it builds, and src/store/pg.ts reports `outdated` by comparing that stamp with
 * this. They were two literals until 2026-09-03, which meant bumping one alone
 * marked every sketch outdated *including ones generated a second later*, with
 * nothing to say which of the two was behind. One name, so there is nothing to
 * keep in step.
 */
export const PROMPT_VERSION = SKETCH_VERSION;

/**
 * How many nodes the overview should have.
 *
 * The floor and the ceiling are both failures and they are different failures.
 * Under about six the picture says less than the article's own first paragraph.
 * Over about sixteen it has quietly become the table of contents with rounded
 * corners, which is a picture this app already has four of.
 */
export const OVERVIEW_MIN = 6;
export const OVERVIEW_MAX = 16;

/**
 * **The blocks, the section boundaries and the head this was drawn against, all
 * three** — `articleFingerprint` in src/source-hash.ts.
 *
 * The tree, for the reason `inputFingerprint` in src/ideas.ts gives at length:
 * the prompt shows the model the outline *before* the article, so re-cutting
 * the sections changes the question being asked while every block stays
 * byte-identical, and a blocks-only hash would report no change at all.
 *
 * **The metadata joined on 2026-08-31.** `generateSketch` hands `meta` to
 * `articleWithIds`, which writes `TITLE:`, `BY:` and `PUBLISHED IN:` at the
 * head of the prompt. Those are stage 2's fields and a re-extraction moves
 * them, so a change there is reachable rather than theoretical — a reader's own
 * rename is a shelf override the generators never see.
 * docs/plans/260831b-finish-the-database-move.md § stage 1.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  return articleWithIdsFingerprint(blocks, tree, meta);
}

/** Has the article moved underneath this picture? */
export function isStale(
  sketch: Sketch,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return sketch.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/**
 * The sketch on disk, or `null` — for the API's filesystem read path.
 *
 * Every road to `null` is the same road: no file, a truncated one, a document
 * of the wrong shape. That is right for the panel, which has one thing to say
 * either way. **Including a scene list that is empty**, which `readSketch`
 * would happily hand back as a valid `Sketch` with nothing in it — the same
 * hole `accept` closes on the writing side, closed again here because a file
 * can arrive from an import or a hand edit without ever passing through
 * `generateSketch`.
 */
export async function readSketchFile(dir: string): Promise<Sketch | null> {
  const found = await readJsonOrNull<Sketch>(path.join(dir, "sketch.json"));
  if (!found || typeof found !== "object") return null;
  if (!Array.isArray(found.scenes) || found.scenes.length === 0) return null;
  return found;
}

export interface SketchRun {
  sketch: Sketch;
  /**
   * **The model's answer, exactly as it arrived.** Kept because the artefact is
   * the *cleaned* scene, so re-reading the artefact can never reproduce the
   * faults `readSketch` recorded — a `--render` of a saved sketch revalidates
   * data that has already been validated and reports it spotless. Without this
   * an eval run's fault counts are unreproducible, which makes them a claim
   * rather than evidence. GPT Sol, 2026-08-30.
   */
  raw: string;
  report: SketchReport;
  score: SketchScore;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

/* ------------------------------------------------------------------ prompt */

const SYSTEM = `You are drawing ONE picture of how this article is put together, for a
reader who has not read it yet.

WHAT THE PICTURE IS FOR

Not decoration, and not a table of contents. A reader should be able to look at
it for five seconds and be able to say: what kind of thing is this piece, how
do its parts stand to each other, and where in it is the bit I want.

So the SHAPE has to carry the meaning. If the writer says "there are three
reasons to think X", draw three columns that converge on X — do not draw four
stacked boxes labelled 1, 2, 3, 4. The arrangement is the argument.

Shapes that keep coming up. Use whichever the piece actually is, or something
else if it is something else:

  chain        one thing leads to the next leads to the next
  converge     several independent supports, one conclusion they meet at
  diverge      one starting point, several consequences fanning out
  two columns  a comparison, or a claim and its rebuttal, running side by side
  hub          a central claim with satellites that elaborate it
  ladder       levels, each built on the one below
  funnel       broad opening narrowing to one specific answer
  loop         it returns to where it started, changed
  spine        a main line with asides hanging off it

Most real articles are two of these joined: a funnel into a converge, a chain
with a loop at the end. Say which in the caption.

THE ONE RULE YOU MAY NOT BREAK

**Down the page is forwards through the article.** A reader scrolling the piece
and looking at this picture must be able to keep their place. So a node standing
for something early in the article sits ABOVE a node standing for something
late. Sideways is free — that is where parallel, opposed, and central-versus-
peripheral live — but down is time.

Two exceptions, and only two. An arrow may point back UP the page to say the
piece returns to something. A frame, legend or caption may sit anywhere.

THE SHAPES MAKE CLAIMS. YOURS MUST NOT BE STRONGER THAN THE TEXT'S.

This is the way this picture goes wrong, and it is worse than an ugly layout,
because a reader cannot tell a confident drawing from a correct one. A diagram
asserts things through its geometry that you never wrote in words, and those
assertions have to be true of the article.

  A DIAMOND says "this question gets settled, and what follows depends on the
  answer". Never use one for a question the piece says CANNOT be settled. If the
  author's point is that we will not find out, draw the two worries side by
  side, both live, with no fork — because that is the shape of the argument.

  A NUMBERED LIST, or a ladder with a "priority" arrow down it, says "strictly
  in this order, always". Never use one for a ranking the piece calls holistic,
  defeasible, or rare. Draw the same four things unnumbered and grouped, and put
  the qualification in the caption.

  TWO BRANCHES OFF A FORK say "one or the other". If both hold at once, they are
  not branches — they are two things, drawn beside each other.

  AN ARROW says "and therefore" or "and then". If the relation is only "and
  also", use no arrow, or a plain line.

  A REGION says "these belong together as one movement". If you band two parts
  of the piece and leave a third unbanded, you have said the third is an
  appendix. Band all of them or none.

Before you finish, look at each shape you used and ask what it claims. If the
article does not make that claim, change the shape.

THE CANVAS

${CANVAS_W} units wide, and you choose the height (400–1200 for an overview;
taller if the piece really is a long chain). The origin is top left, y grows
downwards. Nothing may be drawn outside it. Leave about 24 units of margin.

Units are not pixels: the picture is scaled to whatever room the reader has. So
what matters is the RELATIVE sizes, and one absolute thing: text at size "sm" is
12 units tall, so a box 200 wide holds about 31 characters on a line.

THE FIVE THINGS YOU CAN DRAW

1. node — a shape with words in it. The only thing a reader can click.

   {"kind":"node","id":"a","shape":"box","x":40,"y":120,"w":200,"h":72,
    "text":"Brains are not computers","sub":"4 arguments","size":"sm",
    "tone":1,"block":"spya-k3m9qt","detail":"One sentence for the card.",
    "opens":"scene-id"}

   shape: box | pill | ellipse | diamond | hex | note | bare
          box for a step or a claim; pill for a name or a label; ellipse for a
          starting point or an end point; diamond for a question or a fork;
          hex for a method or a mechanism; note for an aside or a caveat;
          bare for words with no outline at all.
   text:  what the passage SAYS, in the reader's language — a claim, not a
          heading. "Consciousness may not be computable" beats "Section 3.2".
          Three to eight words. It must fit the box: see the width rule above.
          A diamond, a hexagon, an ellipse and a pill are NARROWER than their
          w away from the middle, so a second line and especially a "sub" get
          much less room than the number says — reckon on about two thirds for
          a hexagon or an ellipse and half for a diamond, or make the shape
          wider. Anything that does not fit is truncated with an ellipsis.
   sub:   OPTIONAL second line, smaller — a count, a name, a qualifier.
   size:  xs | sm | md | lg. sm for ordinary nodes, md or lg for the two or
          three nodes that carry the whole picture, xs for the crowd.
   tone:  OPTIONAL 0–7. A GROUP marker and nothing else — nodes that belong
          together get the SAME number. Never "red means bad".

          **If every node has a different tone you are using colour as
          decoration, and it is worse than no colour**: a reader looking for
          what the hues mean finds there is nothing to find, and stops trusting
          the ones that do mean something. Two to four groups is the useful
          range. If the piece has no groups, leave tone off everywhere and the
          whole picture is one colour, which is a fine picture.
   block: the id of the block this node stands for, from the article below.
          Clicking the node takes the reader there, so this is what makes the
          picture navigable. Put one on EVERY node that stands for a passage.
          Leave it off a node that stands for nothing in particular — a title,
          a junction, a label.
   detail: OPTIONAL one sentence, shown when the reader hovers. Say something
          the box has no room for, not the same words again.
   opens: OPTIONAL id of another scene, which clicking zooms into.

2. region — a labelled area behind the nodes. This is how you say "these four
   belong together" or name a phase.

   {"kind":"region","x":24,"y":90,"w":320,"h":260,"label":"THE CASE AGAINST",
    "style":"band","tone":1,"opens":"inside-the-case"}
   style: band (a filled panel) | dashed | bracket (just a left-hand rule) | plain
   opens: OPTIONAL id of a scene, which clicking the region's LABEL zooms into.
          **This is the main way a reader reaches a zoom scene**, and it is the
          natural one: the region has already said these boxes are one movement
          of the piece, and the zoom is that movement drawn larger. If a zoom
          scene is about the same part as a region, put the scene's id here.
          A region with an "opens" must have a "label" — the label is what gets
          pressed.

3. edge — a connector between two nodes, by id.

   {"kind":"edge","from":"a","to":"b","via":"curve","line":"solid",
    "arrow":"end","label":"therefore","tone":1}
   via:   straight | elbow | curve. curve for a long reach across the canvas,
          elbow for a tidy orthogonal run, straight for a short hop.
   line:  solid (it follows) | dashed (it echoes, or refers back) |
          dotted (a loose association)
   arrow: none | end | start | both
   You may aim at a side: "from":"a:bottom","to":"b:top". Leave the side off
   and the sensible sides are chosen for you — which for two nodes one above
   the other is always bottom-to-top, so an ordinary step needs no sides.

   NAME THE SIDES ON ANY LONG EDGE, and especially on one that travels back UP
   the page. Left unaimed it will be drawn straight between its ends, through
   everything in between. Send it round the outside instead:
   {"from":"conclusion:left","to":"opening:left"} — or ":right" if the left of
   the canvas is the busier side.

4. path — a free path, for what an edge cannot say: a funnel's walls, a big
   arc, a loop back. Absolute M / L / C / Q / A / Z only.

   {"kind":"path","d":"M40 100 L360 100 L260 300 L140 300 Z","fill":true,"tone":0}

5. label — free text belonging to no node. Section titles, an axis, a note.

   {"kind":"label","x":380,"y":40,"text":"WHERE IT TURNS","size":"xs",
    "align":"middle","tone":3}

ZOOMING IN

The overview is the point and it must stand on its own — but it will have had
to compress two or three parts of the piece into one box each, and those are
the parts a reader will want to open.

So return THREE scenes: the overview, then a zoom into each of the TWO parts
that carry the most weight and have the most going on inside them.

**Every scene after the first MUST be reachable**, and the best way is usually a
REGION: if the overview groups that part's boxes inside a labelled region, put
the scene's id in that region's "opens", and the reader gets there by pressing
the part's own name. Where there is no region — the part is one box, or a
junction — put the id in that node's "opens" instead.

This is not a nicety. A scene nothing opens is a picture the reader cannot get
to: you will have drawn it for nothing, and nothing in the answer will look
wrong. Before you finish, take each zoom scene's id and find it in a region's or
a node's "opens". If it is not there, either put it there or drop the scene.

A zoom scene follows every rule above. It draws ONE part of the article at the
granularity the overview had no room for — the individual moves, the specific
claims, the evidence — six to twelve nodes, each with its own block id. It is
not a bigger version of the overview node; it is what was inside it.

Return fewer than three scenes only if the piece genuinely has no part worth
opening, which is rare for anything longer than a few thousand words.

HOW TO LAY IT OUT

Work in a grid you choose, and keep to it. Real numbers, worked:

  THREE COLUMNS CONVERGING on one conclusion, canvas ${CANVAS_W} wide:
    columns at x = 40, 280, 520, each w = 200
    the three supports at y = 140, h = 90
    a second row under two of them at y = 260, h = 70
    the conclusion at x = 240, y = 420, w = 280, h = 90
    three edges, via "curve", arrow "end", into it
    a region behind each column if the columns need naming

  A CHAIN of six steps:
    x = 230, w = 300, boxes at y = 60, 160, 260, 360, 460, 560, h = 70
    five edges via "straight", arrow "end"
    asides as "note" shapes at x = 560, w = 170, joined with dashed edges

  A HUB, for a piece with a central claim and satellites that do not depend on
  each other. Note that a full ring CANNOT keep article order down the page —
  half of it would run upwards — so draw a half-ring instead:
    the hub at x = 280, y = 60, w = 200, h = 90, shape "ellipse", size "md"
    five satellites on an arc BELOW it, sweeping left to right as the article
    goes on: (40,220) (150,380) (300,470) (450,380) (560,220), each w = 170,
    h = 70
    five edges from the hub, via "curve"
    the first satellite is the first one the piece takes up, and the last is
    the last, so the eye travels the arc in reading order.

Rules that make the difference between a picture and a mess:

  - Nothing overlaps anything. Boxes do not touch. 20 units of air minimum.
  - A region needs 30 units of clear space along its top edge for its own
    label, before the first box inside it starts.
  - Line up what belongs together. Two nodes in the same column share an x.
    Two nodes in the same row share a y. An eye reads alignment as meaning.
  - A box must be big enough for its own words. Count the characters.
  - Six to sixteen nodes in the overview. Fewer says nothing; more is the table
    of contents again.
  - Do not label a node with its section number. The reader cannot see the
    contents page and does not care.
  - Plain words everywhere you write words — "text", "sub", "detail", a region's
    label, a scene title, the caption: the article's own for the things it
    names, ordinary words for the rest. Most of these are read in a glance, in a
    box, with no room to re-read — plainer than the article, never further from
    it.
  - If the article has a part that is apparatus — notes, bibliography,
    acknowledgements — leave it out or draw it once, muted, at the bottom.

BEING HONEST

The picture is an interpretation. Say what it claims in "caption", in one plain
sentence, and write it BEFORE you lay anything out — deciding the shape is the
work, and the coordinates follow from it.

If the piece genuinely has no shape — a list of unrelated items, a set of
reviews — then draw THAT, as a row of equals with nothing joining them, and say
so. A picture that invents an argument the article does not make is the worst
thing you can produce here, because it is unfalsifiable at a glance.

OUTPUT

JSON only, no prose, no code fence, keys in this order:

{
  "caption": "one sentence: what shape this is and what the shape claims",
  "title": "two to five words naming the shape, not the article",
  "scenes": [
    {"id":"overview","title":"...","caption":"...","height":700,
     "items":[ ... ]},
    {"id":"inside-the-case","title":"...","caption":"...","height":560,
     "items":[ ... ]},
    {"id":"inside-the-ethics","title":"...","caption":"...","height":560,
     "items":[ ... ]}
  ]
}

${PROFILE_RULES}`;

/** One line per part, with the block a click on it should land on. */
function skeletonLine(node: TreeNode, i: number, kids: TreeNode[]): string {
  const head = `PART ${i + 1}: ${node.title}  [${node.range[0]}]`;
  const gist = node.gist ? `\n  ${node.gist}` : "";
  const children = kids
    .map((k) => `\n  - ${k.title}  [${k.range[0]}]${k.gist ? `\n      ${k.gist}` : ""}`)
    .join("");
  return `${head}${gist}${children}`;
}

/**
 * What the model is shown besides the article: the tree, two levels deep, with
 * the block id each row would jump to.
 *
 * **Two levels, not one and not all.** One level is the parts and nothing about
 * how each is built, which is exactly the information a shape is made of.
 * Everything is the table of contents, and a model handed the table of contents
 * draws the table of contents.
 */
export function renderPrompt(opts: { tree: Tree; profile: string | null }): string {
  const { tree } = opts;
  const root = tree.nodes[tree.rootId];
  const parts = (root?.children ?? [])
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && n.treatment !== "supplement");

  const skeleton = parts
    .map((p, i) =>
      skeletonLine(
        p,
        i,
        p.children.map((id) => tree.nodes[id]).filter((n): n is TreeNode => !!n),
      ),
    )
    .join("\n\n");

  const who = profileSection(opts.profile);

  return `Draw this article.
${who ? `\n${who}\n` : ""}
Between ${OVERVIEW_MIN} and ${OVERVIEW_MAX} nodes in the overview.

=== ITS SHAPE, AS THE TABLE OF CONTENTS HAS IT ===

This is what the outline pass made of the piece. It is a starting point and NOT
the answer: the outline is a hierarchy, and the question here is what the
argument's shape is. Where the two disagree, draw the argument.

${skeleton}`;
}

function parseJson(raw: string): unknown {
  return parseJsonAnswer<unknown>(raw, "the model's answer");
}

/* ------------------------------------------------------------------ the run */

export async function generateSketch(opts: {
  /**
   * The article, read once by whoever has a store or a directory —
   * src/article-input.ts. This stage no longer knows where one comes from, and
   * its `slug` is why that type carries one: `path.basename(opts.dir)` used to
   * be how the picture got stamped with the article it is of.
   */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  cacheArticle?: boolean;
  profile?: string | null;
  /** Overrides SYSTEM, for the prompt harness only. Never set in the app. */
  systemOverride?: string;
}): Promise<SketchRun> {
  const { blocks, tree } = opts.article;
  const realMeta: Meta | null = opts.article.meta;
  /* A stub with the slug in it when there is none — `articleWithIds` needs a
     head, and a stage that silently rendered a different head would silently
     send uncacheable bytes.

     **Nothing may go on this stub that the fingerprint does not represent.**
     One field is safe because `articleWithIdsFingerprint` resolves
     `fallbackHeadTitle` itself for a `null` meta; a second — a byline, a site
     name — would put a line in the prompt that no hash anywhere describes, and
     then this stage is stale for ever while looking healthy. The fingerprint
     below is handed `realMeta` rather than the stub, which is not itself the
     protection: the two hash identically today, and src/ideas.ts § `realMeta`
     has the measurement and the whole argument.
     tests/meta-fallback-fingerprint.test.ts pins the property. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);

  /* The argument, not the apparatus — the same filter and the same reason as
     src/ideas.ts. A picture of an article's shape that gives a third of the
     canvas to its endnotes is a picture of the wrong thing. */
  const evidence = blocks.filter(isBodyEvidence);
  const profile = opts.profile ?? null;
  const started = Date.now();

  /* A scene is a few thousand tokens of coordinates, and there may be four of
     them. Generous rather than tight: undersizing does not degrade here, it
     throws `truncationFailure` and loses the whole pass, and half a scene is
     not half a picture. */
  const answerTokens = 12_000;
  const maxTokens = budgetFor("sketch", answerTokens);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "sketch",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: effortFor("sketch") },
        system: [
          {
            type: "text" as const,
            text: articleWithIds(meta, evidence),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: opts.systemOverride ?? SYSTEM },
        ],
        messages: [{ role: "user", content: renderPrompt({ tree, profile }) }],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`drawing, ${Math.round(chars / 1000)}k characters so far`);
      });
    }
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) throw stageFailure(MODEL_REFUSED, {
      authored: "the model answered with stop_reason: refusal",
    });
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("sketch", maxTokens, answerTokens, {
      outputTokens: message.usage.output_tokens,
      answerChars: message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .reduce((n, b) => n + b.text.length, 0),
    });
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  /* **The blocks the article really has, in document order** — both halves
     matter. The set is what an invented `block` is caught by; the order is what
     "does this still run down the page" is measured against, and `blocks.json`
     order IS document order (docs/project/block-ids.md). */
  const blockOrder = blocks.map((b) => b.id);
  const { sketch, report } = readSketch(parseJson(raw), { blockOrder });
  sketch.generator = CAPABLE_MODEL;
  /* **The article's own slug, not `tree.slug`.** They are usually the same and
     on `data/constitution` they are not: that tree says `"slug": "blocks"`,
     left over from whatever it was called when stage 4 ran. Copying it forward
     writes a fresh artefact that names an article which does not exist, and
     everything downstream that looks the article up by it fails on a path
     nobody can trace back to a stale field in a different file. The slug the
     caller was holding is the article's identity here; a field inside something
     it wrote earlier is a claim about it. It used to be `path.basename(dir)`,
     which is exactly why `Article` carries one. */
  sketch.slug = opts.article.slug;
  /* **Provenance, so a later read can tell current from stale.** Without these
     two a sketch is a picture with no idea which article or which reader it was
     drawn for: a re-ingest moves every block id and the artefact goes on
     claiming to describe the piece, losing its clicks one at a time as
     `readSketch` fails to resolve them. The structure half matters as much as
     the blocks half here — the prompt shows the model the tree, so re-cutting
     the sections changes the question while every block stays byte-identical
     (the reasoning is in src/ideas.ts § inputFingerprint). GPT Sol, 2026-08-30.

     **Through `inputFingerprint`, not spelled out again.** These two lines were
     a second copy of that function's body — the same formula, free to drift,
     and the drift would show as a picture that never regenerates or never stops.
     They drifted the day the metadata joined the fingerprint (2026-08-31). */
  sketch.sourceHash = inputFingerprint(blocks, tree, realMeta);
  sketch.profileHash = profile ? hashProfile(profile) : null;
  const score = scoreSketch(sketch, report, { blockOrder });

  /* **Nothing is written unless it is a picture.** A model answering
     `{"scenes": []}` used to come through with zero faults and be saved as a
     finished sketch — see `accept` in sketch-scene.ts for why that is the worst
     failure this design had. */
  const verdict = accept(sketch, score);
  if (!verdict.ok) {
    throw new Error(
      `the model's picture is not usable: ${verdict.refusals.join("; ")}. ` +
        `Running it again is worth a try — this is a drawing, and they vary.`,
    );
  }

  /* **Nothing is written here**, and that is what makes `sketch` the first
     *converted* step in this pipeline (src/pipeline.ts § LEGACY_UNCONVERTED_STEPS).
     The other nine stages write their own file inside `run`, which works on a
     laptop and cannot work through a store that puts the artefact in a Postgres
     column. This one hands the sketch back and lets its two callers decide:
     the pipeline returns it as `parts`, and `evals/sketch/run.ts` writes it into
     a results directory. A generator
     that wrote the file *and* returned it would give the pipeline two writes,
     one of them to a path that does not exist in production. */
  return {
    /* Stripped of the doors `readSketch` worked out from the blocks, because
       this one is going to be *written* — see `stripInferredOpens`. The score
       above was taken before the strip, so the run still reports how many of
       them there were. */
    sketch: stripInferredOpens(sketch),
    raw,
    report,
    score,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: Date.now() - started,
  };
}

/** Everything `evals/sketch/run.ts` wants to print about a run. */
export function summarise(run: SketchRun): string[] {
  const s = run.score;
  const flow = s.flow === null ? "n/a" : s.flow.toFixed(2);
  return [
    `${s.scenes} scenes, ${s.nodes} nodes, ${s.linked} of them linked to a block` +
      (s.unreachable > 0 ? ` — ${s.unreachable} scene(s) nothing opens` : "") +
      /* Worth printing even when the picture is whole: it is the difference
         between a prompt that is still asking for `opens` and one that has
         quietly stopped, which `unreachable` alone can no longer tell you. */
      (s.inferred > 0 ? ` — ${s.inferred} region link(s) inferred from the blocks` : ""),
    `flow (down-the-page vs article order): ${flow}`,
    `widest run of the article no node points into: ${(s.reach * 100).toFixed(0)}%`,
    `overlap: ${(s.overlap * 100).toFixed(1)}% of node area`,
    `text that will not fit its box: ${s.overflowing} nodes`,
    `dropped or repaired: ${s.faults} (of ${run.report.written} items written)`,
    `tokens: ${run.inputTokens} in, ${run.outputTokens} out; ${(run.elapsedMs / 1000).toFixed(1)}s`,
  ];
}
