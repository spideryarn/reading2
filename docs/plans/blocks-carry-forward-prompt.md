You are reviewing a design decision in a TypeScript reading app called Spideryarn, before it is built.

Answer with a verdict of SHIP or NO-SHIP on each numbered question, then your findings. Be adversarial. I would rather you find one real problem than agree with five things.

# Background

The app runs a nine-stage pipeline over an article: fetch, extract, blocks, toc, arc, tweets, glossary, summary, ideas. Today every stage writes its output to files under `data/<slug>/` and `output/`. A migration in progress ("delete the importer") moves all of that into Postgres behind an `ArtifactStore` seam. The stage that does the move is called D and has not been built yet.

Every paragraph of an article gets a stable random id like `spya-k3m9qt`. Comments, saved searches, the table of contents, chat anchors and scroll positions all address text by that id and never by offset or selector. Ids must survive re-extraction, because re-extraction rewrites the document from scratch with no ids in it.

I have just found something no previous review of this plan has seen, and written it into the plan. **I want you to attack the finding and the proposed fix.** Below is what I wrote, then the actual code.

# What I wrote into the plan

### Stage 3 carries block ids in a file — **and D takes the file away**

This is not in any earlier draft, no review has seen it, and it is the largest thing D breaks.

[block-ids.md](../project/block-ids.md) is the one contract everything else depends on, and ids
survive re-extraction because stage 3 matches this run's blocks against the previous run's. It gets
the previous run from **a file on disk**:

```ts
// If a previous run's blocks.json is sitting there, use it to carry ids
// across a re-extraction that wiped them from the HTML.
let previous: Block[] | undefined;
try {
  previous = JSON.parse(await readFile(jsonFile, "utf-8")).blocks as Block[];
} catch {
  previous = undefined; // first run for this article
}
```

[`src/blocks.ts:911-918`](../../src/blocks.ts). `jsonFile` defaults to `output/<slug>.blocks.json`,
and the pipeline's only call passes no `jsonFile` at all
([`src/pipeline.ts:1007`](../../src/pipeline.ts)) — so that default path is the **only** channel by
which a previous id reaches stage 3.

D removes the filesystem writes. After it the read fails on every run, and the `catch` reads that
failure as *"first run for this article"*. Every id is re-minted, on every run, and the code says so
in a comment that used to be true. It is the same shape as everything else in § What this has taught
us: a handler that cannot tell "there was nothing" from "I could not look".

**Nothing is deleted; everything comes loose.** Re-ingesting a slug reuses the article row —
`beginDraftIn` inserts `onConflictDoNothing` on `articles.slug` and re-reads
([`src/store/pg-revisions.ts:490-500`](../../src/store/pg-revisions.ts)) — so comments, chat threads,
saved searches and the shelf keep their `article_id` and stay in the database. It is their **block**
ids that stop naming anything in the current revision. The reader does not lose their notes. They
lose the passages the notes were attached to, all at once, and the rows that are left cannot say
which paragraph they meant.

Counted from `data/` rather than from the local database, because six sessions are writing to that
database and its numbers moved twice in an hour: **43 comment anchors, 91 saved search hits and
1,912 ToC entries**, over fifteen article directories.

**The fix is small, and it is a prerequisite for D rather than an addition to it.** Stage 3 must take
its previous blocks from the store instead of from a path. `splitIntoBlocks` matches on exactly four
fields per previous block — `id`, `tag`, `text`, `html` — plus the previous document's order, because
matching is first-come and each id is consumed once ([`src/blocks.ts:300-351`](../../src/blocks.ts)).
`revision_blocks` already holds every one of them:

| what the matcher reads | `revision_blocks` |
|---|---|
| `id` | `block_id` |
| `tag` | `tag` |
| `text` | `text` |
| `html` | `html` |
| the previous document's order | `ordinal` |

So this is a parameter and a store read, not a schema change and not a new artefact. The thing to be
careful about is the one the `catch` got wrong: **"no previous revision" and "I could not read the
previous revision" must not arrive at the same branch.** The first is an ordinary first ingest; the
second is the failure this section is about, and it has to be loud.

**And the guard cannot save us, because it has the same dependency.** The pipeline does warn about
this exact thing —

```ts
if (previousBlocks > 0 && kept === 0 && minted > 0) {
  … `blocks ${ctx.slug}: all ${minted} ids re-minted — ${previousBlocks} previous ids lost, anchors orphaned`
```

[`src/pipeline.ts:1059-1062`](../../src/pipeline.ts) — and `previousBlocks` comes from
`previousBlockCount`, which counts blocks in **two files on disk**
([`src/pipeline.ts:453-457`](../../src/pipeline.ts)). After D both are gone, `previousBlocks` is `0`,
and the condition that keeps a first ingest quiet keeps *every* ingest quiet. The warning goes silent
at the exact moment it becomes true.

So the check has to be made from outside the thing it is checking: count how many comment and search
anchors still name a block in the current revision, before and after. A number taken from the same
files the fix removes cannot report on the fix.
[block-id-matching-non-latin.md](../postmortems/block-id-matching-non-latin.md) is the same failure
from the other end — a matcher that lost every id on every re-extraction, and nobody would have seen
it either.

### The switchover, and what "preserve what we have" costs

Greg asked, 2026-08-28, whether there is one destructive switchover and how much work it is to keep
what is already there. Three things came out of answering it, and the first two correct this
document.

**Production is already Postgres.** `src/store/index.ts:162-182` refuses to boot the filesystem store
under `NODE_ENV=production` or on Vercel, because it has no owner column. So there is no switchover
of the deployed install to do. What is still on files is **the local development corpus** — the
fifteen directories under `data/` — and that is the thing the re-ingest assumption is about.

**The re-ingest assumption has a consequence nobody wrote down.** § What it does not delete records
the assumption and the check behind it, and both are about *raw documents*: every source is
recoverable, three from git and two from the web. That check is sound and it is not the whole
question. Re-ingesting an article runs stage 3 again, and the section above is what stage 3 does once
its file is gone. **The re-ingest is the event that orphans the anchors** — not a later accident, but
the planned afternoon itself. Fix stage 3 first and the same afternoon costs nothing.

**Only `raw_bytes` is irreversible, and it is now empty.** Measured on the local database: five
revisions carry a source reference and **none carries `raw_bytes`**. Demolition step 5 drops a column
holding nothing. That is the step this plan called out as the one-way door, and it has quietly become
the cheapest one.

So the work to preserve what we have is not a migration. It is:

1. **Stage 3 takes its previous blocks from the store** — above, and a prerequisite for D anyway.
2. **`db:export` fails closed** — § `db:export` must fail closed. It is the rollback tool, and on
   2026-08-28 it was found silently dropping `shelf.purpose`
   ([the postmortem](../postmortems/export-never-wrote-the-readers-purpose.md)). A backup nobody has
   watched fail is not a backup.
3. **`noema`'s raw document** — one decision, still Greg's, in § What it does not delete.



# The code

## src/blocks.ts — the matcher and runBlocks

```ts
    }
  };
  walk(root);
  return out;
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
 * So when the previous blocks.json is available we re-attach ids by matching
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
function exactKey(tag: string, text: string, html: string): string | null {
  const written = text.replace(/\s+/gu, " ").trim();
  if (written) return `x:${tag}:${written}`;
  // Images and rules carry no text, so match them on what they point at —
  // otherwise every figure is re-minted on each re-extraction and any ToC row
  // aimed at a diagram goes stale.
  const src = /\bsrc="([^"]+)"/.exec(html)?.[1];
  return src ? `s:${tag}:${src}` : null;
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
function foldedKey(tag: string, text: string): string | null {
  const words = normalize(text);
  return words && /[\p{L}\p{N}]/u.test(words) ? `f:${tag}:${words}` : null;
}

function bucketBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
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

  // Pass one. Each previous id is consumed once, so a page with several
  // identical short paragraphs cannot hand the same id to two blocks.
  const byExact = bucketBy(previous, (b) => exactKey(b.tag, b.text, b.html));
  const unmatched: number[] = [];
  candidates.forEach((c, i) => {
    const key = exactKey(c.tag, c.text, c.html);
    const bucket = key === null ? undefined : byExact.get(key);
    let id: string | undefined;
    while (bucket?.length && id === undefined) {
      const next = bucket.shift()!.id;
      if (claim(next)) id = next;
    }
    if (id === undefined) unmatched.push(i);
    else out[i] = id;
  });

  // Pass two, over what is left on both sides.
  const byFolded = bucketBy(
    previous.filter((b) => !taken.has(b.id)),
    (b) => foldedKey(b.tag, b.text),
  );
  const claimants = bucketBy(unmatched, (i) => foldedKey(candidates[i]!.tag, candidates[i]!.text));
  for (const [key, indices] of claimants) {
    const bucket = byFolded.get(key);
    if (indices.length !== 1 || bucket?.length !== 1) continue; // ambiguous → mint
    return fragment;
  }
}

export function splitIntoBlocks(html: string, previous?: Block[]): SplitResult {
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
    Array.from(doc.querySelectorAll("[id]"), (el) => el.id).filter(Boolean),
  );

  // Prose text, for spotting pull-quotes that merely repeat it.
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
 *
 * **Ids are carried over from the existing blocks.json, not re-minted.** That
 * is the whole reason a re-extraction is survivable — see
 * docs/project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters.
 */
export async function runBlocks(opts: {
  htmlFile: string;
  jsonFile?: string;
}): Promise<BlocksRun> {
  const htmlFile = opts.htmlFile;
  const jsonFile = opts.jsonFile ?? `${htmlFile.replace(/\.html$/, "")}.blocks.json`;

  // If a previous run's blocks.json is sitting there, use it to carry ids
  // across a re-extraction that wiped them from the HTML.
  let previous: Block[] | undefined;
  try {
    previous = JSON.parse(await readFile(jsonFile, "utf-8")).blocks as Block[];
  } catch {
    previous = undefined; // first run for this article
  }

  const source = await readFile(htmlFile, "utf-8");
  const result = splitIntoBlocks(source, previous);

  await writeFile(htmlFile, result.html, "utf-8");
  /* `blocksArtefact`, not a bare `{ blocks }` — see its own comment. The stamp
     is what makes a stale artefact visible at all; without it a blocks.json
     written before DOMPurify existed is indistinguishable from one written this
     morning, and "re-run stage 3 to clean them" is advice nothing ever asks
     for. Re-running this stage *is* the migration: it rewrites the file anyway. */
  await writeFile(jsonFile, JSON.stringify(blocksArtefact(result.blocks), null, 2), "utf-8");

  return { ...result, htmlFile, jsonFile };
}

async function main() {

```

## src/pipeline.ts — previousBlockCount, and the blocks stage

```ts
 * into it. Mere existence would confuse them, because an article whose first
 * extraction produced nothing leaves a perfectly real `{"blocks": []}` behind.
 *
 * **Both copies, and the second one is the point.** Stage 3 carries ids over
 * from its own copy beside the HTML, so that is what it reads and what this asks
 * first. But block-ids.md calls `data/<slug>/blocks.json` a source artefact
 * rather than a cache precisely because losing it loses the ids for good — and
 * if only stage 3's copy has gone missing, carry-over silently has nothing to
 * work from while stage 4's copy still sits there recording every id that used
 * to exist. Asking that copy too is what turns the worst case from an invisible
 * one into a warn. Read second because it is only needed when the first is
 * empty.
 */
async function previousBlockCount(ctx: StepContext): Promise<number> {
  const own = await countBlocksIn(blocksPathFor(ctx));
  if (own > 0) return own;
  return countBlocksIn(path.join(ctx.dir, "blocks.json"));
}

/**
 * Has this step already produced everything it produces, and is what it
 * produced still current?
 *
 * Two questions, asked in that order, and the order matters: the artefacts must
 * be there whatever else is true, so presence runs first and a freshness check
 * only ever narrows the answer. It can never declare a missing artefact fine.
 *
 * **Presence is the store's answer now, and the store parses.** This used to be
 * `access()` over `outputs(ctx)` — pure existence — and that is how a
 * half-written file reported its step finished. A `writeFile` killed midway
 * leaves a file that exists and will not parse; the step skipped, and the stage
     * skip itself.
     */
    outputs: (ctx) => [blocksPathFor(ctx), ctx.htmlFile],
    produces: ["blocks", "stampedHtml"],
    /* Presence is not enough here, and this is the only step where that is
       true for a reason other than cost — see `htmlCarriesItsIds`. */
    isDone: (ctx, store) => htmlCarriesItsIds(ctx, store),
    async run(ctx) {
      // Read before the stage runs, because the stage overwrites blocks.json
      // with its own output. Afterwards there is no way to ask what was there.
      const previousBlocks = await previousBlockCount(ctx);

      const run = await runBlocks({ htmlFile: ctx.htmlFile });
      const { total, minted, carried, reused, retargeted } = run.stats;
      const kept = reused + carried;

      const fields = {
        slug: ctx.slug,
        step: "blocks",
        total,
        minted,
        carried,
        reused,
        /* Zero on nearly every article and on every re-run, which is the point:
           a page that links to its own sections is the case where stage 3
           renaming an id used to break something (blocks.ts § retargetAnchors),
           and this is the only place that says it happened. */
        retargeted,
        previousBlocks,
      };
      plog.info(fields, `blocks ${ctx.slug}: ${total} blocks, ${minted} minted, ${kept} kept`);

      /*
       * The one thing in this pipeline that quietly destroys reader data.
       *
       * Block ids are the spine: every comment, and later every note and
       * highlight, is anchored to one (docs/project/block-ids.md). Stage 3 is
       * meant to be idempotent — ids already in the HTML are reused, and ids the
       * previous blocks.json knew are carried over by matching the block's
       * words, which is what makes a re-extraction survivable. When that works,
       * `minted` is 0 or nearly 0 on a re-run.
       *
       * So: we had blocks before, and not one of them kept its id. Every anchor
       * into this article now points at nothing. The step still *succeeds* —
       * that is the whole problem, and it is the shape of failure this project
       * keeps meeting (docs/reusable/silent-success.md). A warn is the only
       * thing that would tell you.
       *
       * **`kept === 0`, deliberately, and not a ratio.** Zero survivors is
       * unambiguous, and it has three causes: carry-over is broken, the previous
       * blocks.json went missing, or the publisher rewrote every paragraph. The
       * reader's anchors are equally gone in all three, so all three deserve the
       * line, and none of them needs a threshold anyone has to tune. This warn
       * therefore says *what happened*, not whose fault it was — which is the
       * honest thing a log line can say from here.
       *
       * A *partial* loss — 5 of 139 survive — is just as real and is **not**
       * warned about, because any cutoff would be a guess and a guessed alarm
       * gets ignored. `previousBlocks`, `carried` and `reused` are all in the
       * info line above, so that case is one query away instead.
       *
       * `previousBlocks > 0` is what keeps a first ingest quiet: everything is
       * minted and nothing is lost, which is the opposite of a problem.
       */
      if (previousBlocks > 0 && kept === 0 && minted > 0) {
        plog.warn(
          fields,
          `blocks ${ctx.slug}: all ${minted} ids re-minted — ${previousBlocks} previous ids lost, anchors orphaned`,
        );
      }
      return `${total} blocks, ${minted} new ids (${kept} kept)`;
    },
  },

  /* Stages 4 + 5 — one model call writes the structure and the gists together;
     src/toc.ts says why they are not two passes. */

```

## src/db/schema.ts — revision_blocks

```ts
 * never inferred from insertion order, a sequence, or anything that could be
 * reordered on the way in. Block ids are random and carry no position
 * (docs/project/block-ids.md#why-random-and-not-sequential), so if this column
 * is wrong there is nothing to recover the order from.
 */
export const revisionBlocks = spideryarn.table(
  "revision_blocks",
  {
    articleId: uuid("article_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    blockId: text("block_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    tag: text("tag").notNull(),
    kind: text("kind").notNull(),
    /** Heading depth 1–6, on headings only. */
    level: smallint("level"),
    text: text("text").notNull(),
    words: integer("words").notNull(),
    html: text("html").notNull(),
    /** False for media, rules and code — blocks with no prose to summarise. */
    gistable: boolean("gistable").notNull(),
    note: text("note"),

    /**
     * The block's prose, as Postgres's full-text type — the home page's search box.
     *

```

## src/store/index.ts — the production refusal I am relying on

```ts
  log("store").info({ store: STORE }, "serving article reads from Postgres");
} else if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  /**
   * **The filesystem store cannot be the live one where strangers can sign in.**
   *
   * It has no owner column and no owner filter — it is one directory per slug
   * under `data/`, and there is nowhere for a second reader's articles to go.
   * Postgres got `owner_id` filtering on 2026-08-27 (src/store/pg.ts §
   * `ownedSlug`); the filesystem side deliberately did not, because it is the
   * local development store and its replacement is the whole point of
   * docs/plans/postgres-migration.md.
   *
   * So this is a boot-time refusal rather than a per-request one. On Vercel it
   * would have failed anyway — there is no writable disk — but it would have
   * failed as ENOENT on the first read, which reads as a missing article rather
   * than as a store that must never have been selected. Loud, at the moment the
   * configuration is wrong, and before anybody's data is involved.
   */
  throw new Error(
    `SPIDERYARN_STORE is "${STORE}" in production. The filesystem store has no ` +
      "owner column, so every signed-in reader would share one library. " +
      "Set SPIDERYARN_STORE=postgres. See src/store/index.ts.",
  );
}

/**

```

# The questions

1. **Is the hazard real as stated?** After D removes the filesystem writes, does stage 3 in fact lose every block id on every run? Is there any path I have missed by which previous ids could still reach it — something in the HTML itself, a caller, a default, anything? Note the comment at src/blocks.ts:300-305 says ids already in the HTML survive a re-run of stage 3 but NOT a re-run of stage 2. Check whether that makes the hazard narrower than I claimed.

2. **Is the fix sufficient?** I propose stage 3 reads its previous blocks from `revision_blocks` instead of from a path, matching on id/tag/text/html plus ordinal. Is that table's content actually equivalent to what `blocks.json` holds? Look hard at `html` in particular — the stage rewrites the HTML file it read and then writes the blocks artefact from the result, so is the `html` stored in Postgres the same string the matcher would have compared against next time, or has it been through a transformation that makes it non-identical? If the two differ even in whitespace, `exactKey` misses and the fix silently does nothing.

3. **Which revision should it read?** The pipeline works on a draft revision that was begun by copying the published one (`beginDraftIn` copies block rows forward). So by the time stage 3 runs, the draft may ALREADY contain a copy of the previous blocks. Does that make the fix trivial (read your own draft's existing rows) or is it a trap (you would match this run's blocks against a copy of themselves and report everything carried when nothing was checked)? This is the question I am least sure about and I think it is where the bug will be.

4. **The distinction I flagged.** I say "no previous revision" and "I could not read the previous revision" must not land on the same branch. Is that the right cut? What is the correct behaviour for each — and specifically, should a store read failure fail the whole stage, or warn and mint?

5. **The guard.** I claim the existing warning (`previousBlocks > 0 && kept === 0 && minted > 0`) goes silent after D because `previousBlockCount` reads files. Confirm or refute. Then: what should the post-D guard actually be? I suggested counting how many comment and search anchors still resolve to a block in the current revision, taken before and after. Is that the right outside measure, and where should it live — a test, a runtime assertion in the stage, or a deploy check?

6. **The order of operations.** The plan's demolition is: (1) delete the importer, (2) enable the publication gate, (3) a compatibility release, (4) rewrite the source and export paths, (5) drop the `raw_bytes` column. The plan also assumes the existing corpus is re-ingested at the demolition rather than migrated. I now claim that the re-ingest is itself the event that orphans the anchors, unless stage 3 is fixed first. Is my ordering right? Is there anything else in that sequence that has to move?

7. **What have I missed?** Most valuable question. Is any OTHER stage of the nine reading its own previous output off disk in order to be idempotent or to carry something forward — such that D breaks it the same way? I found this one by accident and I do not believe it is the only one. If you cannot tell from the excerpts, say what you would need to see.
