/**
 * The committed fixture corpus asserts its own preconditions.
 *
 * ## Why this file exists rather than a prose list in the README
 *
 * The review of docs/plans/260901b-committed-fixture-corpus.md made one finding
 * sharper than the rest: **named slugs are not coverage.** A slug can survive
 * in the corpus while the field it was retained *for* quietly disappears —
 * somebody regenerates `constitution` and its `labels.json` gains a
 * `sourceHash`, and the negative fixture is now a positive one that nothing
 * refuses; somebody trims `writes` to eighteen blocks and
 * `tests/store-block-roles-pg.test.ts` starts classifying a row that is not
 * there. Both of those are green-until-they-are-not, and neither is visible in
 * a directory listing.
 *
 * So each property the corpus is kept for is asserted here, **derived from the
 * bytes** rather than maintained as a second prose list that can drift from the
 * first. The README says which test needs which property; this file makes the
 * corpus prove it still has them.
 *
 * These run with no database and no network. They are the cheapest test in the
 * repo and the one that fails first when the corpus is wrong.
 *
 * See tests/fixtures/data-root/README.md.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isSpideryarnId } from "../src/ids.js";
import { hashBlocks } from "../src/source-hash.js";
import { checkTree } from "../src/tree-invariants.js";
import { REVIEW_STANCES } from "../src/types.js";
import type { Block, ChatThread, Comment, SearchRun, ShelfState, Tree } from "../src/types.js";
import { FIXTURE_ROOT, fixturePath, requireFixture } from "./helpers/require-fixture.js";

/* Module scope, above the describes, the way pg-ready is called — so a corpus
   that is not there fails before a single test registers, rather than
   thirty-eight assertions into a beforeAll. Each list is what the named suites
   actually read; the README's table says which suite wants which. */
requireFixture("writes", [
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
  "summary.json",
  "chat.json",
  "comments.json",
  "searches.json",
  "shelf.json",
  "glossary-lookups.json",
  "output.html",
  "output.blocks.json",
]);
requireFixture("constitution", ["meta.json", "blocks.json", "tree.json", "labels.json"]);
requireFixture("noema-mythology-of-conscious-ai", [
  "meta.json",
  "blocks.json",
  "tree.json",
  "labels.json",
  "sketch.json",
]);
requireFixture("openai-huggingface", [
  "meta.json",
  "blocks.json",
  "tree.json",
  "labels.json",
  "quotes.json",
  "timeline.json",
  "assets.json",
]);
requireFixture("todo", ["raw.json", "raw.html", "meta.json", "blocks.json", "tree.json"]);

/** Every article directory in the corpus. */
const SLUGS = readdirSync(path.join(FIXTURE_ROOT, "data")).sort();

function read<T>(slug: string, part: string): T {
  return JSON.parse(readFileSync(fixturePath(slug, part), "utf8")) as T;
}

function readIfThere<T>(slug: string, part: string): T | null {
  try {
    return read<T>(slug, part);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const blocksOf = (slug: string) => read<{ blocks: Block[] }>(slug, "blocks.json").blocks;

describe("the committed fixture corpus", () => {
  it("has the five articles the suites name, and nothing unaccounted for", () => {
    /* Written out rather than derived, for the reason
       tests/artefact-copy.test.ts writes its list out: a list computed from the
       directory agrees with any directory. A sixth article arriving is not
       wrong, but it should be a deliberate edit here and a line in the README,
       not something that drifts in. */
    expect(SLUGS).toEqual([
      "constitution",
      "noema-mythology-of-conscious-ai",
      "openai-huggingface",
      "todo",
      "writes",
    ]);
  });

  it("holds no reader state except the synthesised set", () => {
    /* **The privacy invariant, as a test.** `chat.json` and its four siblings
       are a real reader's questions, notes and searches. The corpus carries
       hand-authored stand-ins for `writes` and must never carry a copied one
       for anything — so the check is "which slugs have any of these files",
       and the answer is exactly one. tests/fixtures/data-root/build-corpus.ts
       refuses to copy them; this is the second lock, on the committed bytes
       rather than on the program that made them. */
    const readerState = [
      "chat.json",
      "comments.json",
      "searches.json",
      "glossary-lookups.json",
      "shelf.json",
    ];
    const carrying: string[] = [];
    for (const slug of SLUGS) {
      const files = readdirSync(path.join(FIXTURE_ROOT, "data", slug));
      if (files.some((f) => readerState.includes(f))) carrying.push(slug);
    }
    expect(carrying).toEqual(["writes"]);
  });

  it("gives every article a meta.fetchedAt, because git does not keep mtimes", () => {
    /* tests/store-parity.test.ts dates a card by `meta.fetchedAt ?? mtime of
       blocks.json`. On a laptop the mtime is when the pipeline ran; in a fresh
       clone it is when git checked the file out, which is *now* — so an article
       with no `fetchedAt` would be dated differently on every machine and the
       library-order assertions would be about the checkout. Every corpus
       article carries one, and this is what keeps that true. */
    for (const slug of SLUGS) {
      const meta = read<{ fetchedAt?: string }>(slug, "meta.json");
      expect(meta.fetchedAt, `${slug}/meta.json has no fetchedAt`).toBeTruthy();
    }
  });

  describe("writes — the load-bearing article", () => {
    it("has at least nineteen blocks", () => {
      /* tests/store-block-roles-pg.test.ts marks rows 16, 17 and 18 as a note.
         Trimming this article to eighteen blocks would make that suite classify
         a block that is not there. */
      expect(blocksOf("writes").length).toBeGreaterThanOrEqual(19);
    });

    it("is publishable: its labels file is stamped with the hash of its own blocks", () => {
      /* `publishRevision` refuses a draft whose `toc` step ran against blocks it
         cannot prove it saw. Every suite that loads this article asserts
         `published === true`, so the stamp is a precondition of all of them —
         and it is checked against `hashBlocks` rather than against a literal,
         so re-slicing the article can never leave a stale hash looking right. */
      const labels = read<{ sourceHash?: string }>("writes", "labels.json");
      expect(labels.sourceHash).toBe(hashBlocks(blocksOf("writes")));
    });


    it("has a review thread carrying a stance", () => {
      /* Without one, tests/store-roundtrip.test.ts's review test warns and
         covers nothing: `kind` and `stance` could vanish from
         src/store/export.ts and the round trip would stay green. */
      const chat = read<{ threads: { kind?: string; messages: { stance?: string }[] }[] }>(
        "writes",
        "chat.json",
      );
      const reviews = chat.threads.filter((t) => t.kind === "review");
      expect(reviews.length).toBeGreaterThan(0);
      expect(reviews.flatMap((t) => t.messages).filter((m) => m.stance).length).toBeGreaterThan(0);
    });

    it("has a comment anchored to something block_identities cannot hold", () => {
      /* The one permitted filesystem/Postgres difference
         (tests/store-parity.test.ts): `comments.json` has no format check and
         `block_identities` does, so the seeder drops such a comment and the
         filesystem store counts it. The suite subtracts it *by the rule* rather
         than by a number — which means with no such comment in the corpus the
         rule is never exercised and could stop working unnoticed. */
      const { comments } = read<{ comments: { blockId: string }[] }>("writes", "comments.json");
      expect(comments.some((c) => !/^spya-[a-z0-9]+$/.test(c.blockId))).toBe(true);
    });

    it("has reader state shaped the way the types say", () => {
      /* **The synthesised files are the one part of this corpus nothing wrote**,
         so they are the one part that could be shaped subtly wrong — a `kind`
         the union does not have, a `stance` spelled differently from the four.
         Checked against `REVIEW_STANCES`, the exported list the route and the
         client both use, rather than against a literal here that could drift.

         **Not read through `loadThreads`/`loadComments`/`loadRuns`, which would
         be better and is not yet possible.** Those five readers hold
         `const ROOT = path.resolve(import.meta.dirname, "..")` at module scope
         (src/comments.ts:35, src/chat.ts:51, src/searches.ts:50,
         src/shelf.ts:45) — they do not go through `dataRoot()`, so
         `SPIDERYARN_DATA_ROOT` does not move them and they read the laptop's
         `data/` whatever this file sets. That is ranked silent failure 1 in
         docs/plans/260901b-committed-fixture-corpus.md, observed rather than
         predicted: pointed at the corpus, `loadComments("writes")` returned the
         laptop's eleven comments and not this fixture's three. It is fixed by
         the deferred sweep, not here, and when it is fixed this test should
         call the loaders. */
      const { comments } = read<{ comments: Comment[] }>("writes", "comments.json");
      expect(comments.length).toBe(3);
      for (const c of comments) {
        expect(["none", "pending", "done", "error"]).toContain(c.status);
        expect(typeof c.start).toBe("number");
        expect(typeof c.quote).toBe("string");
      }

      const { threads } = read<{ threads: ChatThread[] }>("writes", "chat.json");
      expect(threads.map((t) => t.kind).sort()).toEqual(["chat", "review"]);
      for (const t of threads) {
        expect(t.messages.length).toBeGreaterThan(0);
        for (const m of t.messages) {
          expect(["user", "assistant"]).toContain(m.role);
          expect(["pending", "done", "error"]).toContain(m.status);
          if (m.stance) expect(REVIEW_STANCES).toContain(m.stance);
        }
      }

      const { runs } = read<{ runs: SearchRun[] }>("writes", "searches.json");
      expect(runs.length).toBe(2);
      /* Both branches: a run that found something and a run that found nothing.
         A corpus with only the first would never exercise an empty hit list. */
      expect(runs.some((r) => r.hits.length > 0)).toBe(true);
      expect(runs.some((r) => r.hits.length === 0)).toBe(true);

      const shelf = read<ShelfState>("writes", "shelf.json");
      expect(shelf.opens).toBeGreaterThan(0);
      expect(shelf.lastOpenedAt).toBeTruthy();
    });

    it("gives every synthesised entity an id isSpideryarnId accepts", () => {
      /* **This went wrong, and it went wrong three suites away from the file.**
         The first version of these ids was `spya-fix001`… — six characters,
         `spya-` prefix, and invalid: the alphabet is
         `abcdefghjkmnpqrstuvwxyz023456789` (src/ids.ts), with no `i`, no `l`,
         no `o` and no `1`, because those are the characters people misread
         copying an id out of a URL. Postgres enforces it as
         `chat_threads_id_format` (drizzle/0002), so `seedChatFromFiles` threw a
         check-constraint violation and took the whole of
         tests/store-roundtrip.test.ts down at suite level. Found by another
         session, 2026-09-01.

         The README's reasoning had a hole the same shape: it said the ids in
         the synthesised files are real because `block_identities` has a format
         check. The *block* ids are real. The thread, message, comment, search
         and lookup ids are invented, and every one of them faces that check too.

         `blockId` is deliberately excluded — one comment is anchored to
         `zzzz00` on purpose, and that is the corpus's only exercise of the
         permitted filesystem/Postgres difference. */
      const { comments } = read<{ comments: Comment[] }>("writes", "comments.json");
      for (const c of comments) expect(isSpideryarnId(c.id), c.id).toBe(true);

      const { threads } = read<{ threads: ChatThread[] }>("writes", "chat.json");
      for (const t of threads) {
        expect(isSpideryarnId(t.id), t.id).toBe(true);
        for (const m of t.messages) expect(isSpideryarnId(m.id), m.id).toBe(true);
      }

      const { runs } = read<{ runs: SearchRun[] }>("writes", "searches.json");
      for (const r of runs) expect(isSpideryarnId(r.id), r.id).toBe(true);

      /* A lookup is keyed by the glossary ENTRY it explains, not by a block —
         `entryId` in tests/helpers/seed-reader-state.ts — so it is checked
         against `glossary.json` beside it rather than against the blocks. */
      const { lookups } = read<{ lookups: Record<string, unknown> }>(
        "writes",
        "glossary-lookups.json",
      );
      const entries = read<{ entries: { id: string }[] }>("writes", "glossary.json").entries;
      const entryIds = new Set(entries.map((e) => e.id));
      for (const key of Object.keys(lookups)) {
        expect(isSpideryarnId(key), key).toBe(true);
        expect(entryIds.has(key), `${key} is not an entry of writes/glossary.json`).toBe(true);
      }
    });

    it("anchors every other comment, thread and search hit at a real block", () => {
      const ids = new Set(blocksOf("writes").map((b) => b.id));
      const { comments } = read<{ comments: { blockId: string }[] }>("writes", "comments.json");
      for (const c of comments) {
        if (!/^spya-/.test(c.blockId)) continue;
        expect(ids.has(c.blockId), `comment on ${c.blockId}`).toBe(true);
      }
      const { runs } = read<{ runs: { hits: { blockId: string }[] }[] }>("writes", "searches.json");
      for (const hit of runs.flatMap((r) => r.hits)) {
        expect(ids.has(hit.blockId), `search hit on ${hit.blockId}`).toBe(true);
      }
    });
  });

  describe("constitution — the article the gate refuses", () => {
    it("has a labels file with no sourceHash", () => {
      /* The whole reason this slug is in the corpus.
         tests/store-parity.test.ts and tests/store-roundtrip.test.ts each keep a
         block for it, and scripts/deploy-checks.ts names the file as a gate
         sentinel. If this ever gains a stamp the fix is to retire the case, not
         to restore the file — store-parity says so in its own words. */
      const labels = readIfThere<{ sourceHash?: string }>("constitution", "labels.json");
      expect(labels).not.toBeNull();
      expect(labels?.sourceHash).toBeUndefined();
    });

    it("has a tree that still partitions its blocks after the slice", () => {
      /* This is the one article in the corpus that was cut down, so it is the
         one whose tree could have been left describing text that is no longer
         there. `checkTree` is the same function `publishRevision` runs. */
      const tree = read<Tree>("constitution", "tree.json");
      const { problems } = checkTree(blocksOf("constitution"), tree);
      expect(problems).toEqual([]);
    });

    it("has no artefact that would now be lying about its source", () => {
      /* `arc.json`, `glossary.json` and `ideas.json` each carry a `sourceHash`
         over the whole article. Slicing the blocks would make all three stale —
         a fixture asserting something false about itself — so they were dropped
         rather than cut. This fails if one is ever copied back in. */
      const files = readdirSync(path.join(FIXTURE_ROOT, "data", "constitution"));
      expect(files.filter((f) => ["arc.json", "glossary.json", "ideas.json"].includes(f))).toEqual(
        [],
      );
    });
  });

  describe("noema — the article with no stage 1", () => {
    it("has no raw manifest, and a meta that still has url and fetchedAt", () => {
      /* tests/store-parity.test.ts's NO_FETCH_SLUG: Postgres reads `url` and
         `fetchedAt` from the columns stage 1 wrote and correctly has neither,
         while the filesystem reads `meta.json` and has both. That asymmetry is
         the assertion, so an article with a `raw.json` cannot stand in. */
      expect(readIfThere("noema-mythology-of-conscious-ai", "raw.json")).toBeNull();
      const meta = read<{ url?: string; fetchedAt?: string }>(
        "noema-mythology-of-conscious-ai",
        "meta.json",
      );
      expect(meta.url).toBeTruthy();
      expect(meta.fetchedAt).toBeTruthy();
    });
  });

  it("gives every raw manifest bytes that really hash to what it says", () => {
    /* tests/helpers/load-article.ts rehashes these two and throws if they
       disagree, because the manifest is a *reference* — `storedSha256` is the
       key of an object in the `sources` bucket, and the Postgres adapter writes
       the reference without ever checking the object is there. A fixture whose
       bytes had been edited would produce a revision pointing at somebody
       else's document, with every read of the manifest still succeeding.

       Across every article rather than only `writes`, because a manifest with
       no bytes beside it is the same defect wherever it turns up — and because
       the corpus deliberately holds articles with no stage 1 at all, which must
       stay the ONLY way an article here can lack raw bytes. */
    for (const slug of SLUGS) {
      const raw = readIfThere<{ file: string; storedSha256?: string }>(slug, "raw.json");
      if (!raw?.storedSha256) continue;
      const bytes = readFileSync(fixturePath(slug, raw.file));
      expect(createHash("sha256").update(bytes).digest("hex"), slug).toBe(raw.storedSha256);
    }
  });

  it("has an article whose two clocks really differ", () => {
    /* Verbatim the property tests/store-parity.test.ts asks for by name: if
       every fixture had `raw.fetchedAt === meta.fetchedAt` — and `writes` does —
       then dropping the field from the parity comparison would be free, and the
       day the two stores started disagreeing about it nothing would notice. */
    const differing = SLUGS.filter((slug) => {
      const raw = readIfThere<{ fetchedAt?: string }>(slug, "raw.json");
      const meta = read<{ fetchedAt?: string }>(slug, "meta.json");
      return Boolean(raw?.fetchedAt && meta.fetchedAt && raw.fetchedAt !== meta.fetchedAt);
    });
    expect(differing.length).toBeGreaterThan(0);
  });

  it("carries every artefact the round trip claims to preserve", () => {
    /* The same rule tests/store-roundtrip.test.ts applies to `data/`, applied
       here so the corpus fails rather than the suite going quiet. An artefact
       no article carries turns that suite's `preserves %s exactly` row into
       "the export invented nothing" on every slug — three of these
       (`quotes.json`, `timeline.json`, `assets.json`) live on exactly one
       article, which is why `openai-huggingface` is in the corpus at all. */
    const ARTEFACTS = [
      "meta.json",
      "blocks.json",
      "tree.json",
      "assets.json",
      "arc.json",
      "tweets.json",
      "glossary.json",
      "ideas.json",
      "quotes.json",
      "timeline.json",
      "sketch.json",
      "labels.json",
      "comments.json",
      "chat.json",
      "searches.json",
      "glossary-lookups.json",
      "shelf.json",
    ];
    const carried = new Set(SLUGS.flatMap((s) => readdirSync(path.join(FIXTURE_ROOT, "data", s))));
    expect(ARTEFACTS.filter((a) => !carried.has(a))).toEqual([]);
  });

  it("gives every article both halves of output/, or neither", () => {
    /* `copyArtefacts` refuses the whole `blocks` step when only one of
       `output/<slug>.html` and `output/<slug>.blocks.json` is there, so a corpus
       with one of the two loses a step rather than losing a file — and the
       suites that assert `copied.length > 0` would still pass.
       `constitution` is the article that most looks like it could do without
       them, and it cannot. */
    for (const slug of SLUGS) {
      const html = existsSync(fixturePath(slug, "output.html"));
      const blocks = existsSync(fixturePath(slug, "output.blocks.json"));
      expect([slug, html, blocks]).toEqual([slug, true, true]);
    }
  });

  it("keeps output/<slug>.blocks.json equal to data/<slug>/blocks.json", () => {
    /* Stage 3 writes the first and stage 4 reads the second, and they are the
       same array — so a slice that touched one and not the other would make an
       article whose two halves describe different text. This is the check that
       would have caught a hand-cut `constitution`. */
    for (const slug of SLUGS) {
      expect(read(slug, "output.blocks.json"), slug).toEqual(read(slug, "blocks.json"));
    }
  });
});
