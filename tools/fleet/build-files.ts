/**
 * **Is the fleet bundle on disk whole, and which commit does it say it is?**
 *
 * `build-stamp.ts` answers "what checkout was observed when the build started".
 * That is not enough to trust a bundle: an `index.html` can exist beside a
 * truncated script or a missing font and the stamp says nothing about either.
 * So the build also writes {@link BUILD_FILES_FILE}, last: every file it
 * emitted, with its length and sha256, taken from the bundle **in memory**
 * rather than read back off the disk — a list made by reading the disk would
 * agree with whatever the disk happened to hold. {@link fleetBundleProblem}
 * re-reads the disk against that list.
 *
 * The manifest is the build's completion marker. A build that died half way
 * leaves none, and one that is there describes exactly the files that should
 * be.
 *
 * ## What a clean answer here does NOT claim
 *
 * That this bundle was built from the commit it names. The stamp is an
 * observation of HEAD when the config loaded, and it ignores untracked files:
 * a hand-run build can consume an untracked source file, stamp itself
 * `{sha, dirty: false}`, and survive that file's removal (GPT Sol's P3R-01,
 * 2026-10-06). The manifest proves the files are the ones that build wrote; it
 * cannot prove what that build read. So the readiness runner never reuses a
 * bundle it did not build itself — `scripts/readiness-loop.ts` §
 * `ensureFleetClient` — and this function is its postcondition and its
 * "is it still there" check, not a licence to skip a build.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { BUILD_STAMP_FILE, readBuildStamp } from "./build-stamp.js";

/** Beside `index.html` in `tools/fleet/web/dist/`, and written after everything else. */
export const BUILD_FILES_FILE = "build-files.json";

/** The page itself. A bundle whose manifest does not list it is not a bundle. */
export const BUILD_ENTRY_FILE = "index.html";

export type BuildFile = {
  /** Relative to the dist directory, with forward slashes, as rollup names it. */
  path: string;
  bytes: number;
  sha256: string;
};

export type BuildFilesManifest = { schema: 1; files: BuildFile[] };

const sha256 = (content: Uint8Array): string => createHash("sha256").update(content).digest("hex");

/**
 * The manifest for a set of emitted files. A string is measured as the UTF-8
 * it is written as, which is what rollup writes.
 */
export function buildFilesManifest(
  emitted: Iterable<{ path: string; content: string | Uint8Array }>,
): BuildFilesManifest {
  const files: BuildFile[] = [];
  for (const { path: name, content } of emitted) {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    files.push({ path: name, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { schema: 1, files };
}

function parseManifest(text: string): BuildFilesManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record["schema"] !== 1 || !Array.isArray(record["files"])) return null;
  const files: BuildFile[] = [];
  for (const entry of record["files"] as unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const file = entry as Record<string, unknown>;
    const name = file["path"];
    const bytes = file["bytes"];
    const hash = file["sha256"];
    if (typeof name !== "string" || name === "") return null;
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) return null;
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return null;
    files.push({ path: name, bytes, sha256: hash });
  }
  return { schema: 1, files };
}

/** Every regular file, symlink or other non-directory under `dir`, relative to it. */
function filesUnder(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesUnder(path.join(dir, entry.name), relative));
    else found.push(relative);
  }
  return found;
}

/**
 * Why the bundle in `distDir` is not a whole, clean build of `targetSha` — or
 * null when it is. One sentence, the first thing found wrong.
 *
 * Never throws: a directory that cannot be read is a reason like any other.
 * `expectedManifest` binds reuse to the manifest this process accepted after
 * its own build; a different whole bundle at the same sha is not that build.
 */
export function fleetBundleProblem(distDir: string, targetSha: string, expectedManifest?: string): string | null {
  try {
    return bundleProblem(distDir, targetSha, expectedManifest);
  } catch (cause) {
    return `${distDir} could not be checked: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

function bundleProblem(distDir: string, targetSha: string, expectedManifest?: string): string | null {
  const manifestPath = path.join(distDir, BUILD_FILES_FILE);
  const manifestStat = lstatSync(manifestPath, { throwIfNoEntry: false });
  if (manifestStat === undefined) {
    return `no ${BUILD_FILES_FILE} in ${distDir}: the build did not finish, or was not made by vite.fleet.config.ts`;
  }
  if (!manifestStat.isFile()) return `${manifestPath} is not a regular file`;
  const manifestText = readFileSync(manifestPath, "utf8");
  if (expectedManifest !== undefined && manifestText !== expectedManifest) {
    return `${BUILD_FILES_FILE} does not match the build this process recorded`;
  }
  const manifest = parseManifest(manifestText);
  if (manifest === null) return `${manifestPath} is not a build-files manifest`;

  const listed = new Set(manifest.files.map((file) => file.path));
  for (const required of [BUILD_ENTRY_FILE, BUILD_STAMP_FILE]) {
    if (!listed.has(required)) return `${manifestPath} does not list ${required}`;
  }

  const root = realpathSync(distDir);
  for (const file of manifest.files) {
    const problem = listedFileProblem(root, distDir, file);
    if (problem !== null) return problem;
  }

  /* The other direction. The manifest claims to list every emitted file, and
     nothing else checks that claim: a file the build wrote without listing is a
     file nobody is hashing. */
  const unlisted = filesUnder(root).filter((name) => name !== BUILD_FILES_FILE && !listed.has(name));
  if (unlisted.length > 0) {
    return `${distDir} holds ${unlisted.length} file(s) ${BUILD_FILES_FILE} does not list, the first being ${unlisted.sort()[0]}`;
  }

  return stampProblem(distDir, targetSha);
}

/** Is this one listed file on disk, inside `root`, and byte for byte what the build wrote? */
function listedFileProblem(root: string, distDir: string, file: BuildFile): string | null {
  /* The manifest is a file on disk like any other, so a path in it is not
     trusted to stay inside the directory it describes. Lexically first, then
     through symlinks: `assets` could itself be a link to somewhere else. */
  const lexical = path.resolve(root, file.path);
  if (path.isAbsolute(file.path) || !lexical.startsWith(root + path.sep)) {
    return `${BUILD_FILES_FILE} lists ${file.path}, which is outside ${distDir}`;
  }
  const stat = lstatSync(lexical, { throwIfNoEntry: false });
  if (stat === undefined) return `${file.path} is listed in ${BUILD_FILES_FILE} but missing from ${distDir}`;
  if (!stat.isFile()) return `${file.path} in ${distDir} is not a regular file`;
  if (!realpathSync(lexical).startsWith(root + path.sep)) {
    return `${file.path} resolves through a link to somewhere outside ${distDir}`;
  }
  if (stat.size !== file.bytes) {
    return `${file.path} is ${stat.size} bytes, and the build wrote ${file.bytes}`;
  }
  if (sha256(readFileSync(lexical)) !== file.sha256) {
    return `${file.path} does not have the content the build wrote`;
  }
  /* Hashes agreeing says the disk matches the build, not that the build made a
     page. An entry the build itself wrote empty would pass everything above. */
  if (file.path === BUILD_ENTRY_FILE && file.bytes === 0) {
    return `${BUILD_ENTRY_FILE} is empty, and the build said so itself`;
  }
  return null;
}

/** Does the stamp say a clean checkout of `targetSha`? An observation, not a proof: see the header. */
function stampProblem(distDir: string, targetSha: string): string | null {
  const reading = readBuildStamp(distDir);
  if (reading.kind !== "stamp") return reading.why;
  const stamp = reading.stamp;
  if (stamp.kind !== "known") return `the bundle was built from a checkout git could not read: ${stamp.why}`;
  if (stamp.sha !== targetSha) return `the bundle was built at ${stamp.sha}, not ${targetSha}`;
  if (stamp.dirty) return `the bundle was built at ${stamp.sha} with uncommitted changes in the tree`;
  return null;
}
