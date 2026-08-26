/**
 * Every file an article directory can contain has a home in Postgres — and
 * a new one turns up here as a red test rather than as archaeology.
 *
 * ## Why this exists
 *
 * This migration was written against a schema that was one day old and already
 * behind. Five artefacts had no column and no table at all — `summary.json`,
 * `labels.json`, `chat.json`, `searches.json`, `glossary-lookups.json` — and
 * `src/glossary-lookups.ts` appeared *while the migration was being written*.
 * Several agents work this repo at once, and each new feature brings a new
 * file beside the article.
 *
 * Nothing would have reported that. The importer would have imported what it
 * knew about, the parity test would have compared what the importer imported,
 * and the reader's looked-up terms would simply not have been there. Every
 * check shared the same assumption about what exists, which is the failure mode
 * docs/reusable/silent-success.md is about: **the check must not share the
 * migration's blind spot.**
 *
 * So this test does not ask the migration what it handles. It asks the
 * *filesystem* what is there, and holds the answer against a list somebody had
 * to write down.
 *
 * ## When this fails
 *
 * You added an artefact. Give it a home and then add it here:
 *
 * - **A pipeline artefact** → a whole-artefact JSONB column on
 *   `article_revisions`, plus an entry in the `revision_step_runs` CHECK **if
 *   it is a `StepName`** (`labels.json` is not — it is one of `toc`'s outputs).
 * - **Reader state** → its own table keyed `(article_id, …)` with an
 *   `owner_id`, and **never** on a revision: a revision-keyed blob is deleted
 *   by re-extraction, which is the exact failure the identity split exists to
 *   prevent.
 *
 * Then teach `src/store/import.ts` and `src/store/export.ts` about it, and add
 * it to `ARTEFACTS` in tests/store-roundtrip.test.ts.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Every artefact, and where it lives once it is in Postgres.
 *
 * The value is documentation rather than something the test parses — the test
 * only cares that the *key* is here. But writing the destination down is what
 * makes the list a decision record instead of an allowlist somebody appends to
 * without thinking.
 */
const HOMES: Record<string, string> = {
  "raw.html": "article_revisions.raw_bytes",
  "meta.json": "article_revisions.{title,byline,site_name,lang,excerpt,note,final_url,fetched_at}",
  "blocks.json": "revision_blocks (+ block_identities)",
  "tree.json": "article_revisions.tree",
  "labels.json": "article_revisions.labels — a `toc` output, NOT a step of its own",
  "arc.json": "article_revisions.arc",
  "tweets.json": "article_revisions.tweets",
  "glossary.json": "article_revisions.glossary",
  "summary.json": "article_revisions.summary",
  "comments.json": "comments",
  "chat.json": "chat_threads + chat_messages",
  "searches.json": "search_runs (hits stay JSONB)",
  "glossary-lookups.json": "glossary_lookups",
};

/**
 * Files that are deliberately NOT migrated, with the reason.
 *
 * A separate list from `HOMES` on purpose: "we decided not to" and "we have not
 * got to it" look identical in a single allowlist, and only one of them is a
 * finished decision.
 */
const NOT_MIGRATED: Record<string, string> = {
  ".DS_Store": "macOS. Not ours.",
};

describe("the artefact manifest", () => {
  it("covers every file present in data/", async () => {
    const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true }).catch(
      () => [],
    );

    const seen = new Set<string>();
    for (const entry of entries) {
      // `_jobs` is the queue's, not an article's. `test-` directories are other
      // test files' fixtures, created and removed concurrently.
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith("test-")) {
        continue;
      }
      const files = await readdir(path.join(ROOT, "data", entry.name)).catch(() => []);
      for (const file of files) seen.add(file);
    }

    const known = new Set([...Object.keys(HOMES), ...Object.keys(NOT_MIGRATED)]);
    const unaccounted = [...seen].filter((file) => !known.has(file)).sort();

    expect(
      unaccounted,
      unaccounted.length
        ? `These files sit beside an article and have no home in Postgres:\n` +
            `  ${unaccounted.join("\n  ")}\n` +
            `Read the header of this file — it says what to do.`
        : "",
    ).toEqual([]);
  });

  it("does not list artefacts that no longer exist anywhere", async () => {
    /* The list rotting the other way is quieter and just as real: a feature is
       removed, its file stops being written, and the entry here lingers —
       promising a home for something nobody produces, and making the manifest
       read as more complete than it is.

       `example/` counts as well as `data/`, because the fixture is the only
       place some artefacts survive on a fresh clone. */
    const seen = new Set<string>();
    const roots = [path.join(ROOT, "data"), path.join(ROOT, "example")];
    for (const root of roots) {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      if (entries.some((e) => e.isFile())) {
        for (const entry of entries) if (entry.isFile()) seen.add(entry.name);
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
        const files = await readdir(path.join(root, entry.name)).catch(() => []);
        for (const file of files) seen.add(file);
      }
    }

    // Only warn about the ones we claim to migrate; NOT_MIGRATED entries are
    // about files that may legitimately never appear.
    const stale = Object.keys(HOMES).filter((file) => !seen.has(file));
    expect(
      stale,
      stale.length
        ? `The manifest promises a home for artefacts nothing writes any more:\n  ${stale.join("\n  ")}`
        : "",
    ).toEqual([]);
  });
});
