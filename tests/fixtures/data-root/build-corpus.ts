/**
 * Rebuild `tests/fixtures/data-root/` from a laptop's `data/` + `output/`.
 *
 *     npx tsx tests/fixtures/data-root/build-corpus.ts
 *
 * **This is provenance, not a build step.** Nothing runs it in CI and nothing
 * depends on it at test time — the corpus is committed and the committed bytes
 * are the fixture. It exists so that "how was this file made?" has an answer a
 * reader can run rather than a paragraph they have to believe, and so that the
 * one *derived* fixture in the corpus (`constitution`, sliced) is derived by a
 * program instead of by hand.
 *
 * It reads `data/` and `output/` and never writes to them.
 *
 * ## The three techniques, in the order docs/plans/260901b-committed-fixture-corpus.md
 * prefers them
 *
 * - **Copied whole.** Genuine pipeline output, small because the article was
 *   short. Everything in `writes`, `todo`, `noema…` and `openai-huggingface`.
 * - **Sliced at a clean semantic boundary**, then validated. `constitution`
 *   only: its first top-level section, with the tree pruned to match and
 *   `checkTree` run over the result. Same technique as `example/`.
 * - **Synthesised.** The five reader-state files, and only those. See
 *   `READER_STATE` below — the reason is privacy, not size.
 *
 * ## What is deliberately never copied
 *
 * `chat.json`, `comments.json`, `searches.json`, `glossary-lookups.json` and
 * `shelf.json` hold a real reader's questions, notes and searches, and the
 * model's answers to them. They are not derived from public article text and
 * they do not go in git. `copy()` refuses them by name rather than by the
 * whitelist happening not to mention them, so that adding a file to a whitelist
 * cannot leak one by accident.
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { checkTree } from "../../../src/tree-invariants.js";
import type { Block, Tree } from "../../../src/types.js";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const CORPUS = path.resolve(import.meta.dirname);

/** Never copied from `data/`, whatever a whitelist says. See the header. */
const READER_STATE = [
  "chat.json",
  "comments.json",
  "searches.json",
  "glossary-lookups.json",
  "shelf.json",
] as const;

/**
 * What each slug contributes, and what it is in the corpus *for*.
 *
 * The comments are the membership argument; `tests/fixtures/data-root/README.md`
 * carries the same table with the consuming tests named.
 */
const WHOLE: Record<string, readonly string[]> = {
  /* The load-bearing one. tests/artefact-copy.test.ts hardcodes this slug and
     an explicit list of every file the artefact store owns, and
     scripts/deploy-checks.ts uses the same set as the deploy gate's sentinels.
     19 blocks and 55 KB — small because the essay is short, not because
     anything was cut. */
  writes: [
    "raw.json",
    "raw.html",
    "meta.json",
    "blocks.json",
    "tree.json",
    "labels.json",
    "arc.json",
    "tweets.json",
    "glossary.json",
    "ideas.json",
    /* Not an artefact any more — the `summary` kind went with stage 5e on
       2026-08-31 — but tests/store-artefact-manifest.test.ts enumerates the
       files beside an article and checks each one is either homed or knowingly
       exempt, and `summary.json` is the entry that proves the exempt list is
       being read. A corpus without one turns that row green by absence. */
    "summary.json",
  ],
  /* The smallest complete article there is: 10 blocks, no reader state ever
     written, and no arc/tweets/glossary/ideas — so it is the fixture that
     exercises the ABSENT branch of every "agrees about X, present or absent"
     row in tests/store-parity.test.ts. It also supplies the two-clock case:
     its raw.json and meta.json fetchedAt are 37 seconds apart, and
     store-parity fails if no article in the corpus has them differ. */
  todo: ["raw.json", "raw.html", "meta.json", "blocks.json", "tree.json", "labels.json"],
  /* The article with no stage 1. tests/store-parity.test.ts names this slug as
     NO_FETCH_SLUG and asserts Postgres has neither `url` nor `fetchedAt` for
     it, because there is no raw.json to have written them; the filesystem
     still has both, from meta.json. tests/pipeline-artifact-store.test.ts reads
     its labels.json by path.

     `raw.html` is NOT copied: with no raw.json naming it, nothing reads it, and
     it is 176 KB. It is the only file dropped from this slug for size. */
  "noema-mythology-of-conscious-ai": [
    "meta.json",
    "blocks.json",
    "tree.json",
    "labels.json",
    "arc.json",
    "tweets.json",
    "glossary.json",
    "ideas.json",
    "summary.json",
    /* The only sketch.json among the corpus slugs, and
       tests/store-roundtrip.test.ts fails if no article carries one. */
    "sketch.json",
  ],
  /* The only carrier of `quotes.json`, `timeline.json` and `assets.json`
     anywhere in `data/`. tests/store-roundtrip.test.ts has a test whose whole
     job is to notice a corpus that has quietly stopped covering an artefact —
     "has at least one article carrying each artefact it claims to preserve" —
     and without this slug three rows of the round trip would assert only that
     the export invented nothing.

     **Stage 1 is dropped from this slug, and the pair goes together.** Its
     `raw.html` is 219 KB of a Substack page's embedded configuration — public
     bytes, with no credential and nothing of the reader's in them, but also
     nothing any test reads. `writes` already covers a stage-1-complete article
     with matching clocks and `todo` covers one with differing clocks, so this
     one carries no property those two do not.

     `raw.json` goes with it rather than staying: the manifest is a *reference*,
     and tests/helpers/load-article.ts reads the file it names and rehashes it.
     A manifest with no bytes beside it would be the one thing that helper
     exists to refuse. Without either, this article is simply a second one with
     no stage 1 — which is a state the pipeline really produces (see noema
     above), not an invented one.

     `summary.json` is not copied — `writes` already covers that name. */
  "openai-huggingface": [
    "meta.json",
    "blocks.json",
    "tree.json",
    "labels.json",
    "arc.json",
    "assets.json",
    "glossary.json",
    "quotes.json",
    "timeline.json",
  ],
};

/** `output/<slug>.html` and `output/<slug>.blocks.json`, copied whole. */
const OUTPUT_WHOLE = ["writes", "todo", "noema-mythology-of-conscious-ai", "openai-huggingface"];

/**
 * The negative fixture, and the one derived file set in the corpus.
 *
 * `constitution`'s `labels.json` was written before stage 4 recorded a
 * `sourceHash`, so `publishRevision` has nothing to check the table of contents
 * against and refuses — the correct answer to real legacy data, and the case
 * tests/store-parity.test.ts and tests/store-roundtrip.test.ts each keep a
 * block for. `scripts/deploy-checks.ts` names `data/constitution/labels.json`
 * as a gate sentinel.
 *
 * Whole it is 1.0 MB for a property expressible in a tenth of that, so it is
 * sliced to its first top-level section — the same cut `example/` makes, at a
 * real heading rather than an arbitrary offset — and `checkTree` is run over
 * the result. **The missing `sourceHash` is not touched**: it is absent in the
 * source file and absent in the slice, so the property this fixture exists for
 * is carried rather than manufactured. Nothing else in the slice is hashed
 * over, which is precisely why this is the one article safe to cut: there is no
 * fingerprint to keep true.
 *
 * `arc.json`, `glossary.json` and `ideas.json` are dropped rather than sliced.
 * Each carries a `sourceHash` over the whole article, so a sliced article would
 * make all three stale — a fixture asserting something false about itself. No
 * test reads them for this slug.
 */
const SLICED_SLUG = "constitution";

/** How many top-level sections of `constitution` to keep. */
const KEEP_SECTIONS = 2;

interface BlocksFile {
  readonly blocks: Block[];
  readonly [k: string]: unknown;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Copy one file from the laptop store into the corpus, refusing reader state. */
async function copy(from: string, to: string): Promise<number> {
  const name = path.basename(from);
  if ((READER_STATE as readonly string[]).includes(name)) {
    throw new Error(
      `refusing to copy ${name}: it is a reader's own words. Synthesise it instead — ` +
        "see tests/fixtures/data-root/README.md § Reader state.",
    );
  }
  const bytes = await readFile(from);
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, bytes);
  return bytes.byteLength;
}

/**
 * Cut `constitution` down to its first `KEEP_SECTIONS` top-level sections.
 *
 * The tree is pruned rather than rebuilt: the kept nodes keep their own ids,
 * ranges, titles and gists, and the root's range is narrowed to the last block
 * that survives. That leaves children still exactly partitioning their parent,
 * which is the invariant `checkTree` is about to be asked to confirm.
 */
async function sliceConstitution(): Promise<void> {
  const fromDir = path.join(REPO, "data", SLICED_SLUG);
  const toDir = path.join(CORPUS, "data", SLICED_SLUG);

  const blocksFile = await readJson<BlocksFile>(path.join(fromDir, "blocks.json"));
  const tree = await readJson<Tree>(path.join(fromDir, "tree.json"));
  const labels = await readJson<{ labels: Record<string, string>; [k: string]: unknown }>(
    path.join(fromDir, "labels.json"),
  );

  const root = tree.nodes[tree.rootId];
  if (!root) throw new Error("constitution tree has no root");
  const keptTop = root.children.slice(0, KEEP_SECTIONS);
  if (keptTop.length !== KEEP_SECTIONS) {
    throw new Error(`constitution root has only ${root.children.length} sections`);
  }

  /* Everything reachable from the kept sections, and nothing else. */
  const kept = new Set<string>([tree.rootId]);
  const walk = (id: string): void => {
    kept.add(id);
    for (const child of tree.nodes[id]?.children ?? []) walk(child);
  };
  for (const id of keptTop) walk(id);

  const lastNodeId = keptTop[keptTop.length - 1] as string;
  const lastRange = tree.nodes[lastNodeId]?.range;
  if (!lastRange) throw new Error(`no range on ${lastNodeId}`);
  const lastBlockId = lastRange[1];

  const cut = blocksFile.blocks.findIndex((b) => b.id === lastBlockId);
  if (cut < 0) throw new Error(`${lastBlockId} is not a block of constitution`);
  const blocks = blocksFile.blocks.slice(0, cut + 1);
  const blockIds = new Set(blocks.map((b) => b.id));

  const nodes: Tree["nodes"] = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (!kept.has(id)) continue;
    nodes[id] =
      id === tree.rootId
        ? { ...node, children: keptTop, range: [node.range[0], lastBlockId] }
        : node;
  }

  const { problems } = checkTree(blocks, { ...tree, nodes });
  if (problems.length) {
    throw new Error(`sliced constitution tree is not sound:\n  ${problems.join("\n  ")}`);
  }

  if ("sourceHash" in labels) {
    throw new Error(
      "data/constitution/labels.json now has a sourceHash. That is the fixture's whole " +
        "point gone — see tests/store-parity.test.ts, which says to retire the case rather " +
        "than restore the file.",
    );
  }

  await writeJson(path.join(toDir, "blocks.json"), { ...blocksFile, blocks });
  await writeJson(path.join(toDir, "tree.json"), { ...tree, nodes });
  await writeJson(path.join(toDir, "labels.json"), {
    ...labels,
    labels: Object.fromEntries(
      Object.entries(labels.labels).filter(([id]) => blockIds.has(id) || kept.has(id)),
    ),
  });
  await copy(path.join(fromDir, "meta.json"), path.join(toDir, "meta.json"));

  /* `output/<slug>.blocks.json` is the same array under a different name — it
     is what stage 3 wrote and `data/<slug>/blocks.json` is what stage 4 read.
     Written from the same value so the two cannot disagree. */
  await writeJson(path.join(CORPUS, "output", `${SLICED_SLUG}.blocks.json`), {
    ...blocksFile,
    blocks,
  });
  await sliceStampedHtml(blockIds);

  console.log(
    `constitution: sliced to ${blocks.length} of ${blocksFile.blocks.length} blocks ` +
      `(${keptTop.length} sections), tree sound`,
  );
}

/**
 * The stamped HTML, cut to the same blocks.
 *
 * Every block is stamped with `id="spya-…"` on the element that produced it
 * (src/blocks.ts), so the cut is "drop every stamped element whose id did not
 * survive, and any wrapper left with nothing in it". Done with jsdom rather
 * than a regex because the article's elements nest — a `<figure>` holds a
 * `<figcaption>`, a list holds its items — and a regex that cut on tag
 * boundaries would leave the document unbalanced.
 */
async function sliceStampedHtml(blockIds: Set<string>): Promise<void> {
  const { JSDOM } = await import("jsdom");
  const html = await readFile(path.join(REPO, "output", `${SLICED_SLUG}.html`), "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  for (const el of [...doc.querySelectorAll("[id^='spya-']")]) {
    if (!blockIds.has(el.id)) el.remove();
  }
  /* Wrappers the pipeline emitted around blocks that have now gone. Repeated
     until nothing changes, because emptying an inner one can empty its parent. */
  for (;;) {
    const empty = [...doc.querySelectorAll("div, section, figure")].filter(
      (el) => !el.id && el.children.length === 0 && (el.textContent ?? "").trim() === "",
    );
    if (!empty.length) break;
    for (const el of empty) el.remove();
  }

  await mkdir(path.join(CORPUS, "output"), { recursive: true });
  await writeFile(path.join(CORPUS, "output", `${SLICED_SLUG}.html`), dom.serialize());
}

/**
 * The reader state, hand-authored — **the one place in this corpus where the
 * bytes were never produced by anything.**
 *
 * `data/<slug>/chat.json` and its four siblings hold a real person's reading:
 * the questions they asked, the notes they wrote, what they searched for and
 * what the model told them. None of that is derived from public article text
 * and none of it goes in git, so this is written from the types in
 * `src/types.ts` instead, deliberately obvious about being fake.
 *
 * The block ids, quotes and offsets ARE real — they have to be, because
 * `block_identities` has a format check and `comments_identity_fk` points at
 * it, so a comment anchored to an invented id could not exist in Postgres and
 * the two stores would disagree for a reason that is about the fixture.
 *
 * Three properties here are load-bearing and each has a test that needs it:
 *
 * - a thread with `kind: "review"` whose assistant message carries a `stance`,
 *   or tests/store-roundtrip.test.ts covers neither field and says so;
 * - a comment anchored to `zzzz00`, which is not a `spya-` id — the seeder
 *   drops it and the filesystem store counts it, and that permitted difference
 *   is the one tests/store-parity.test.ts subtracts by rule rather than by a
 *   hardcoded number. With no such comment the rule is never exercised;
 * - a shelf entry with a real `opens` count and `lastOpenedAt`, because
 *   `pgShelfStore.patch` cannot set either and the parity suite is comparing
 *   what the seeder wrote against what the file says.
 */
const SYNTHESISED: Record<string, Record<string, unknown>> = {
  writes: {
    "shelf.json": {
      opens: 7,
      lastOpenedAt: "2026-08-27T07:57:48.000Z",
    },
    "comments.json": {
      comments: [
        {
          id: "spya-fix001",
          blockId: "spya-arj7ry",
          quote: "you only think you're thinking",
          start: 37,
          createdAt: "2026-08-26T06:12:44.736Z",
          status: "none",
          body: "Fixture note: a bookmark with the reader's own words and no model call.",
        },
        {
          id: "spya-fix002",
          blockId: "spya-hg7u0a",
          quote: "writes and write-nots",
          start: 36,
          createdAt: "2026-08-26T06:20:00.000Z",
          status: "done",
          answer:
            "Fixture answer. Stands in for an explanation the model produced, so that an " +
            "answered comment — which is a different shape from a bookmark — is present in " +
            "the corpus.",
          searches: 0,
          model: "anthropic/claude-sonnet-5",
        },
        {
          /* Deliberately not a `spya-` id. See the header: this is the corpus's
             only exercise of the permitted filesystem/Postgres difference. */
          id: "spya-fix003",
          blockId: "zzzz00",
          quote: "Thanks to Jessica Livingston",
          start: 10,
          createdAt: "2026-08-26T06:30:00.000Z",
          status: "none",
          body: "Fixture note anchored to an id block_identities cannot hold, on purpose.",
        },
      ],
    },
    "chat.json": {
      threads: [
        {
          id: "spya-fix100",
          title: "Fixture thread: an ordinary question",
          createdAt: "2026-08-25T21:12:45.478Z",
          updatedAt: "2026-08-25T21:13:10.000Z",
          kind: "chat",
          messages: [
            {
              id: "spya-fix101",
              role: "user",
              text: "Fixture question. Stands in for something a reader typed.",
              createdAt: "2026-08-25T21:12:45.478Z",
              status: "done",
            },
            {
              id: "spya-fix102",
              role: "assistant",
              text: "Fixture answer, citing a real block id so the citation shape is real [spya-hg7u0a].",
              createdAt: "2026-08-25T21:13:10.000Z",
              status: "done",
              searches: 0,
              model: "anthropic/claude-sonnet-5",
            },
          ],
        },
        {
          id: "spya-fix200",
          title: "Fixture thread: a review",
          createdAt: "2026-08-26T09:00:00.000Z",
          updatedAt: "2026-08-26T09:01:00.000Z",
          /* `kind` and `stance` together are what tests/store-roundtrip.test.ts
             checks the export still carries. Without this thread that test
             warns and covers nothing. */
          kind: "review",
          anchor: { blockId: "spya-z7zzwv" },
          messages: [
            {
              id: "spya-fix201",
              role: "user",
              text: "Fixture review. Stands in for the reader saying what they took from it.",
              createdAt: "2026-08-26T09:00:00.000Z",
              status: "done",
            },
            {
              id: "spya-fix202",
              role: "assistant",
              text: "Fixture response to a review, in the balanced stance.",
              createdAt: "2026-08-26T09:01:00.000Z",
              status: "done",
              stance: "balanced",
              model: "anthropic/claude-sonnet-5",
            },
          ],
        },
      ],
    },
    "searches.json": {
      runs: [
        {
          id: "spya-fix300",
          criterion: "fixture criterion: where the piece says writing is thinking",
          createdAt: "2026-08-25T21:29:52.529Z",
          status: "done",
          model: "anthropic/claude-sonnet-5",
          hits: [
            {
              blockId: "spya-z7zzwv",
              quote: "writing is thinking",
              confidence: 90,
              reasoning: "Fixture reasoning.",
              start: 60,
            },
          ],
        },
        {
          /* A run with no hits, so both branches of the hit list are in the
             corpus rather than only the populated one. */
          id: "spya-fix301",
          criterion: "fixture criterion: something the piece does not say",
          createdAt: "2026-08-25T21:30:10.000Z",
          status: "done",
          model: "anthropic/claude-sonnet-5",
          hits: [],
        },
      ],
    },
    "glossary-lookups.json": {
      lookups: {
        "spya-bhdnef": {
          answer: "Fixture glossary answer. Stands in for a term lookup the reader asked for.",
          citations: [],
          searches: 0,
          model: "anthropic/claude-sonnet-5",
          at: "2026-08-26T01:48:00.000Z",
        },
      },
    },
  },
};

async function main(): Promise<void> {
  await rm(path.join(CORPUS, "data"), { recursive: true, force: true });
  await rm(path.join(CORPUS, "output"), { recursive: true, force: true });

  let bytes = 0;
  for (const [slug, files] of Object.entries(WHOLE)) {
    for (const file of files) {
      bytes += await copy(
        path.join(REPO, "data", slug, file),
        path.join(CORPUS, "data", slug, file),
      );
    }
  }
  for (const slug of OUTPUT_WHOLE) {
    for (const file of [`${slug}.html`, `${slug}.blocks.json`]) {
      bytes += await copy(path.join(REPO, "output", file), path.join(CORPUS, "output", file));
    }
  }

  await sliceConstitution();

  for (const [slug, files] of Object.entries(SYNTHESISED)) {
    for (const [file, value] of Object.entries(files)) {
      await writeJson(path.join(CORPUS, "data", slug, file), value);
    }
  }

  /* Nothing that is a reader's own words may have got in, whatever route it
     took. Checked here as well as in the README's grep, because a whitelist
     that grows is exactly how this would go wrong. */
  for (const slug of await readdir(path.join(CORPUS, "data"))) {
    const files = await readdir(path.join(CORPUS, "data", slug));
    for (const file of files) {
      if (!(READER_STATE as readonly string[]).includes(file)) continue;
      if (SYNTHESISED[slug]?.[file] === undefined) {
        throw new Error(`data/${slug}/${file} is reader state and was not synthesised here`);
      }
    }
  }

  console.log(`copied ${(bytes / 1024).toFixed(0)} KB whole; corpus at ${CORPUS}`);
}

await main();
