/**
 * Are the fixtures the bytes the numbers were measured against?
 *
 *   npx tsx evals/extraction/fixtures/verify.mts            # hash what is here
 *   npx tsx evals/extraction/fixtures/verify.mts --refetch  # and ask the web again
 *
 * **A hash mismatch is a new fixture version, never a quietly updated hash** —
 * the rule evals/pdf/README.md states for its PDFs, and it matters more here,
 * because a web page changes under you without telling anyone. A gold is written
 * against particular bytes; if the bytes move, the gold is about a document that
 * no longer exists.
 *
 * `--refetch` is the check worth running rarely and believing: it re-downloads
 * every URL and reports which pages have drifted since they were captured. It
 * does NOT overwrite anything. Drift is expected and is information — a page
 * that has changed is a page whose fixture is now a historical snapshot, which
 * is fine, as long as nobody thinks it is live.
 *
 * The fetch here is deliberately plain — `fetch` with a browser-ish User-Agent
 * and nothing else. Not src/fetch.ts, whose job is to be careful on the open web
 * on a reader's behalf; this only has to answer "are these bytes still what that
 * URL serves", and borrowing stage 1 would make a fixture check depend on the
 * code the fixtures exist to test.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CORPUS, EXTRA_FIXTURES, FIXTURE_UA } from "../corpus.mjs";

/**
 * Fixtures that are committed and hashed here but are **not** part of the
 * extraction corpus — captured for some other investigation, and deliberately
 * not in `corpus.mts` because they would change that eval's denominator.
 *
 * This list exists because of a real gap rather than for tidiness. This script
 * used to walk `CORPUS` alone, so a fixture with a `hashes.json` entry and no
 * `CORPUS` entry was **skipped in silence** while the last line still read
 * "15 fixtures, all matching" — the check reporting success over a file it had
 * never opened. Worse, `--write-hashes` rebuilds the manifest from what it
 * walked, so it would have quietly deleted that fixture's committed hash.
 * Found 2026-08-28, when the footnote investigation added the first one.
 *
 * The sweep below is the part that makes this durable: any `.html` here covered
 * by neither list is a failure, so the next person to add a fixture cannot
 * repeat it by forgetting.
 */
const EXTRA = EXTRA_FIXTURES;

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MANIFEST = path.join(HERE, "hashes.json");
/** Same string the fixtures were captured with, so a server that varies by UA
 *  varies the same way. Shared with probe.mts — see FIXTURE_UA in corpus.mts. */
const UA = FIXTURE_UA;

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

async function main(): Promise<void> {
  const refetch = process.argv.includes("--refetch");
  const write = process.argv.includes("--write-hashes");
  const stored: Record<string, { sha256: string; bytes: number; url: string; capturedAt: string }> =
    existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf-8")) : {};

  const next: typeof stored = {};
  let bad = 0;
  let drifted = 0;

  const checking = [...CORPUS, ...EXTRA];

  for (const c of checking) {
    const file = path.join(HERE, c.file);
    if (!existsSync(file)) {
      console.log(`${c.name.padEnd(24)} MISSING — ${c.file} is not here`);
      bad++;
      continue;
    }
    const bytes = await readFile(file);
    const hash = sha256(bytes);
    const known = stored[c.name];
    next[c.name] = {
      sha256: hash,
      bytes: bytes.length,
      url: c.url,
      capturedAt: known?.capturedAt ?? new Date().toISOString().slice(0, 10),
    };

    let line = `${c.name.padEnd(24)} ${(bytes.length / 1024).toFixed(0).padStart(5)} KB  ${hash.slice(0, 12)}`;
    if (known && known.sha256 !== hash) {
      line += "  !! DOES NOT MATCH THE COMMITTED HASH — this is a different document";
      bad++;
    } else if (known) {
      line += "  ok";
    } else {
      line += "  (new)";
    }

    if (refetch) {
      try {
        const res = await fetch(c.url, { headers: { "User-Agent": UA }, redirect: "follow" });
        if (!res.ok) {
          line += `  |  refetch ${res.status}`;
        } else {
          const live = sha256(Buffer.from(await res.arrayBuffer()));
          if (live === hash) line += "  |  the URL still serves these exact bytes";
          else { line += "  |  the page has CHANGED since capture (fixture is a snapshot)"; drifted++; }
        }
      } catch (err) {
        line += `  |  refetch failed: ${(err as Error).message.slice(0, 40)}`;
      }
    }
    console.log(line);
  }

  /* Every `.html` in this directory must be accounted for by one of the two
     lists. A fixture nobody hashes is a fixture whose bytes can drift without
     anything saying so — and it looks exactly like a fixture that was checked
     and matched. See EXTRA above for the day that happened. */
  const covered = new Set(checking.map((c) => c.file));
  const orphans = (await readdir(HERE)).filter((f) => f.endsWith(".html") && !covered.has(f));
  for (const f of orphans) {
    console.log(`${f.padEnd(24)} UNCHECKED — not in CORPUS or EXTRA, so its hash is not verified`);
    bad++;
  }

  if (write) {
    await writeFile(MANIFEST, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    console.log(`\nWrote ${MANIFEST}`);
  }
  if (refetch) console.log(`\n${drifted}/${checking.length} pages have changed since capture.`);
  if (bad) {
    console.error(`\n${bad} fixture(s) are missing, unchecked, or do not match. See the header before "fixing" a hash.`);
    process.exit(1);
  }
  console.log(`\n${checking.length} fixtures, all matching.`);
}

void main();
