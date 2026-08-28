/**
 * Give every `data/<slug>/raw.json` the two fields the object store needs.
 *
 * ## Why this exists
 *
 * `RawManifest` gained `storedSha256` on 2026-08-27 and `storedBytes` on
 * 2026-08-28 (src/fetch.ts). Both describe the object in the `sources` bucket:
 * the key it is under, and how big it is. Every manifest written before those
 * dates has neither, and the Postgres artefact store is about to **refuse** a
 * manifest with no `storedSha256` rather than write a `fetch` step that reports
 * done beside a revision holding no document — docs/plans/delete-the-importer.md
 * § C6. So without this, every article already on a laptop stops being
 * ingestable at the moment that refusal lands.
 *
 * ## Backfill, not re-fetch, and the difference is provenance
 *
 * The plan called this a re-ingest, on the assumption that a manifest with no
 * object needs the document fetching again. It does not: `data/<slug>/raw.pdf`
 * and `raw.html` are still there, and they are *the very bytes* the manifest
 * describes. Re-fetching would stamp today's `fetchedAt` onto an article
 * fetched weeks ago — and the library sorts on that column, so it would quietly
 * reorder the shelf and lose the one fact a re-fetch cannot recover.
 *
 * ## The hash is computed, never copied
 *
 * This is the trap docs/plans/raw-bytes-in-storage.md § The backfill can put
 * the wrong bytes under a hash is about, and it is the subtlest thing in that
 * document. `manifest.sha256` is the hash of the bytes **off the network**; for
 * HTML, `writeRaw` stores the *decoded, UTF-8 re-encoded* text instead —
 * src/fetch.ts's own comment says "`raw.html` is therefore not raw". Putting
 * the stored bytes under the network hash would store bytes that do not hash to
 * their own key, breaking the one invariant content addressing has. And it
 * would break quietly: a later `putIfAbsent` returns `already-there` without
 * verifying anything.
 *
 * So this hands `storeRawSource` the bytes and lets it compute the name. It
 * never reads `manifest.sha256` at all.
 *
 * ## Usage
 *
 * ```
 * npx tsx scripts/backfill-raw-manifests.ts            # report, change nothing
 * npx tsx scripts/backfill-raw-manifests.ts --write    # store the objects and rewrite
 * ```
 *
 * Idempotent: a manifest that already has both fields is skipped, and
 * `storeRawSource` is create-only and verifies a dedup hit rather than trusting
 * it.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvLocal } from "../src/env.js";
import { sniffKind } from "../src/fetch.js";
import type { RawManifest } from "../src/fetch.js";
import { blobStore, storeRawSource } from "../src/store/blobs.js";
import { canonicalKey } from "../src/source.js";
import { isMain } from "../src/is-main.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

interface Outcome {
  slug: string;
  what: string;
  detail?: string;
}

/**
 * The manifest with the two fields added, in the order `writeRaw` writes them.
 *
 * Rebuilt rather than spread-and-append so that a file this touches and a file
 * stage 1 writes are the same shape — otherwise the next person diffing two
 * manifests reads a field order as a difference.
 */
function withStored(
  manifest: RawManifest,
  storedSha256: string,
  storedBytes: number,
): RawManifest {
  const { fetchedAt, backfilled, ...rest } = manifest;
  return {
    ...rest,
    storedSha256,
    storedBytes,
    fetchedAt,
    ...(backfilled === undefined ? {} : { backfilled }),
  };
}

/**
 * Is this file actually a manifest, and does it describe itself consistently?
 *
 * **The cast used to be unchecked**, which let `{ kind: "html", file:
 * "raw.pdf" }` through — and the object would then have gone into the bucket
 * under an *HTML* canonical key while holding PDF bytes, which is the one thing
 * content addressing must never do. GPT Sol, 2026-08-28.
 *
 * Three checks, and the third is the one that would have caught it: the kind,
 * the filename the kind implies, and the bytes themselves. `sniffKind` is the
 * authority on the last, for the reason src/fetch.ts gives — a PDF served as
 * `application/octet-stream` is still a PDF.
 */
export function whyNotUsable(manifest: RawManifest, bytes: Buffer): string | null {
  if (manifest.kind !== "html" && manifest.kind !== "pdf") {
    return `kind is ${JSON.stringify(manifest.kind)}, which is not html or pdf`;
  }
  const expected = manifest.kind === "pdf" ? "raw.pdf" : "raw.html";
  if (manifest.file !== expected) {
    return `kind is ${manifest.kind} and file is "${manifest.file}", which do not match`;
  }
  const sniffed = sniffKind(manifest.contentType, bytes);
  if (sniffed !== manifest.kind) {
    return `kind says ${manifest.kind} and the bytes look like ${sniffed}`;
  }
  return null;
}

/**
 * The object at this key, and whether it is still what its name says.
 *
 * **A manifest that already carries both fields is not proof the object is
 * there.** Reporting "already done" over a deleted or corrupt object is exactly
 * the reassurance this script exists to stop somebody relying on, and the cost
 * of checking is one read of a document we already hold. GPT Sol, 2026-08-28.
 */
async function objectStillGood(manifest: RawManifest, bytes: Buffer): Promise<string | null> {
  const key = canonicalKey(manifest.storedSha256 as string, manifest.kind);
  const there = await blobStore().get(key, { maxBytes: bytes.byteLength + 1 });
  if (!there) return `nothing is at ${key}`;
  if (createHash("sha256").update(there).digest("hex") !== manifest.storedSha256) {
    return `what is at ${key} does not hash to its own name`;
  }
  return null;
}

/**
 * Replace `raw.json`, whole or not at all.
 *
 * `writeFile` in place was the first version, and a crash or a full disk part
 * way through it destroys the only copy of a manifest whose provenance cannot
 * be recovered. Same recipe as `writeAtomic` in src/store/artifacts-fs.ts: the
 * rename is atomic within a directory, so a reader sees the old file or the
 * whole new one. GPT Sol, 2026-08-28.
 */
async function replaceAtomically(file: string, body: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, file);
}

async function backfillOne(slug: string, write: boolean): Promise<Outcome> {
  const dir = path.join(DATA, slug);
  const manifestFile = path.join(dir, "raw.json");

  let manifest: RawManifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8")) as RawManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { slug, what: "no manifest" };
    }
    throw err;
  }


  /* **A rebuilt manifest is backfilled too, and the first version of this
     refused it.** `db:export` writes `backfilled` onto every manifest it
     reconstructs from columns, and `readRaw` in src/store/import.ts treats such
     a manifest as absent — so refusing looked like the consistent thing to do.

     It conflates two different claims. What `backfilled` says is unreliable is
     the **provenance**: the content type the server sent, the encoding we
     chose, the hash of what arrived. `storedSha256` and `storedBytes` are
     neither of those. They are facts about *our own bucket*, computed here from
     the bytes in hand, and they stay true however those bytes were recovered.
     `data/writes` is the case that made this concrete: its `sha256` is `null`,
     honestly, and its `raw.html` is nine kilobytes that hash to what they hash
     to.

     So it is a note rather than a refusal, and the note is worth printing: an
     article that reads back this way has lost its origin provenance and only a
     re-fetch will bring that back. */

  if (typeof manifest.file !== "string" || manifest.file.length === 0) {
    return { slug, what: "REFUSED", detail: "the manifest names no file" };
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(dir, manifest.file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { slug, what: "REFUSED", detail: `${manifest.file} is not beside the manifest` };
    }
    throw err;
  }

  const wrong = whyNotUsable(manifest, bytes);
  if (wrong) return { slug, what: "REFUSED", detail: wrong };

  /* **Hashed in the dry run too.** A report that says only the kind and the
     size cannot tell you whether the manifest already there is right, which is
     the question a dry run is for. */
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  if (manifest.storedSha256 && manifest.storedBytes !== undefined) {
    if (manifest.storedSha256 !== sha256 || manifest.storedBytes !== bytes.byteLength) {
      return {
        slug,
        what: "REFUSED",
        detail: "the manifest names an object that is not the file beside it",
      };
    }
    const gone = await objectStillGood(manifest, bytes);
    return gone
      ? { slug, what: "REFUSED", detail: gone }
      : { slug, what: "already done", detail: "and the object is still there" };
  }

  if (!write) {
    return {
      slug,
      what: "would store",
      detail: `${manifest.kind}, ${bytes.byteLength} bytes, ${sha256.slice(0, 12)}…`,
    };
  }

  const stored = await storeRawSource(bytes, manifest.kind);
  await replaceAtomically(
    manifestFile,
    `${JSON.stringify(withStored(manifest, stored.sha256, bytes.byteLength), null, 2)}\n`,
  );
  /* Both numbers, because the interesting cases are the ones where they differ:
     any page that was not already UTF-8 is stored re-encoded, so the stored
     hash and the network hash are about two different byte strings. */
  const notes: string[] = [`${bytes.byteLength} bytes`];
  /* `sha256` is null exactly when nothing ever recorded what the network sent,
     which is not the same as the two hashes differing — and calling that
     "re-encoded" would be inventing a comparison there is nothing to make. */
  if (manifest.sha256 !== null && stored.sha256 !== manifest.sha256) {
    notes.push("re-encoded — the stored hash differs from the network hash");
  }
  if (manifest.backfilled) notes.push("provenance is a reconstruction; only a re-fetch restores it");
  return { slug, what: stored.outcome, detail: notes.join(", ") };
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const slugs = (await readdir(DATA, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();

  console.log(write ? "Backfilling raw manifests.\n" : "Dry run — nothing will be written.\n");

  const outcomes: Outcome[] = [];
  for (const slug of slugs) {
    outcomes.push(await backfillOne(slug, write));
  }

  for (const o of outcomes) {
    if (o.what === "no manifest") continue;
    console.log(`  ${o.slug.padEnd(38)} ${o.what}${o.detail ? `  (${o.detail})` : ""}`);
  }

  const refused = outcomes.filter((o) => o.what === "REFUSED");
  console.log(
    `\n${outcomes.filter((o) => o.what !== "no manifest").length} manifest(s), ` +
      `${refused.length} refused.`,
  );
  if (!write) console.log("Re-run with --write to store the objects and rewrite the manifests.");
  /* A refusal is not a crash — the other articles were done — but it must not
     read as success either, because the whole point is that the store is about
     to refuse these too. */
  if (refused.length) process.exitCode = 1;
}

/**
 * **Only when run as a command.** `tests/backfill-manifest.test.ts` imports
 * `whyNotUsable` from this file, and a bare `void main()` at module scope means
 * importing one pure function starts a run that reads `data/`, talks to the
 * bucket and — with `--write` in `process.argv` — rewrites manifests. Under
 * vitest it began and the process exited before it finished, so it left no
 * output and looked like nothing had happened.
 *
 * The guard used to be `import.meta.url.endsWith(path.basename(process.argv[1]))`,
 * which answers yes to any *other* entry file of the same name and no to a path
 * with a space in it — one `src/is-main.ts` now, and tests/is-main.test.ts holds
 * the failing input for each.
 */
if (isMain(import.meta.url)) void main();
