/**
 * **Reading `docs/mockups/` from disk**, for the three `/api/admin/mockups`
 * routes and for scripts/mockups.ts. The rules are src/mockups.ts's; this file
 * only finds the files and asks.
 *
 * ## Where the directory is: `process.cwd()`, asked inside the route
 *
 * In production the API is one bundled function (src/vercel.ts), so a path
 * walked up from `import.meta.dirname` names the bundle's directory, not this
 * module's. vercel.json's `includeFiles` copies `docs/mockups/**` into the
 * function at its repository path, and Vercel resolves that from the working
 * directory; on a laptop the working directory is the checkout. `mockupsDir()`
 * is called by a route when it runs, never at import, so a missing directory
 * can only ever be an empty list and never a function that fails to load —
 * which would take every API route down with it. GPT Sol's plan review, F1.
 *
 * ## What the caller cannot reach
 *
 * Only a validated mockup id and an image's index come from a URL. The file
 * names are read out of a mockup that has passed `parseMockupFile`, which
 * allows a bare name starting with the mockup's own id. And nothing here
 * follows a symlink (`lstat`, and a regular file or nothing), so a link
 * committed into the directory cannot serve something from elsewhere on the
 * box.
 */
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  imageBytesAre,
  isMockupId,
  MAX_MOCKUP_IMAGE_BYTES,
  MAX_MOCKUP_IMAGES_TOTAL_BYTES,
  type MockupFile,
  type MockupImageType,
  mockupImageType,
  newestFirst,
  parseMockupFile,
} from "./mockups.js";

/** The directory, from the working directory. Call it when a route runs, not at import. */
export function mockupsDir(): string {
  return path.join(process.cwd(), "docs", "mockups");
}

export interface MockupProblem {
  /** The file's name in the directory, or `(all files)` for the total. */
  file: string;
  problem: string;
}

function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The size of a regular file, `"missing"`, or `"not-a-file"` for a link, a directory or anything else. */
async function regularFileSize(file: string): Promise<number | "missing" | "not-a-file"> {
  try {
    const stat = await lstat(file);
    return stat.isFile() ? stat.size : "not-a-file";
  } catch (err) {
    if (isMissing(err)) return "missing";
    throw err;
  }
}

/** The first thing wrong with a mockup's images, or null. `checkContent` reads each one's first bytes. */
async function imagesProblem(dir: string, mockup: MockupFile, checkContent: boolean): Promise<string | null> {
  for (const file of mockup.images) {
    const size = await regularFileSize(path.join(dir, file));
    if (size === "missing") return `the image ${file} is not there`;
    if (size === "not-a-file") return `the image ${file} is not a file (a link or a directory)`;
    if (size > MAX_MOCKUP_IMAGE_BYTES) {
      return `the image ${file} is larger than ${MAX_MOCKUP_IMAGE_BYTES} bytes (${size})`;
    }
    if (checkContent) {
      const type = mockupImageType(file);
      const bytes = await readFile(path.join(dir, file));
      if (type === null || !imageBytesAre(bytes, type)) return `the image ${file} is not ${type ?? "an image"}`;
    }
  }
  return null;
}

/** One `m-xxxxxx.md`, read and checked, images included. */
async function readChecked(dir: string, name: string, checkContent: boolean): Promise<MockupFile | string> {
  const parsed = parseMockupFile(name, await readFile(path.join(dir, name), "utf8"));
  if (typeof parsed === "string") return parsed;
  return (await imagesProblem(dir, parsed, checkContent)) ?? parsed;
}

const mockupName = (name: string) => name.endsWith(".md") && isMockupId(name.slice(0, -3));

/**
 * **Every mockup that passes, newest first, and what is wrong with the rest.**
 * An absent directory is an empty list with no problems.
 *
 * The server shows `mockups` and logs `problems`; the script and the test fail
 * on any problem — including a file that is neither a mockup nor an image one
 * shows, and every file together being over the total cap, neither of which
 * hides a mockup. `checkContent` reads every image's first bytes; the list route
 * asks for it so it never advertises a mockup whose image route can only refuse
 * the bytes. `totalCap` is for the test.
 */
export async function readMockupDirectory(
  dir: string,
  { checkContent, totalCap = MAX_MOCKUP_IMAGES_TOTAL_BYTES }: { checkContent: boolean; totalCap?: number },
): Promise<{ mockups: MockupFile[]; problems: MockupProblem[] }> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return { mockups: [], problems: [] };
    throw err;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const mockups: MockupFile[] = [];
  const problems: MockupProblem[] = [];
  const shown = new Set<string>();
  for (const entry of entries) {
    if (!mockupName(entry.name)) continue;
    if (!entry.isFile()) {
      problems.push({ file: entry.name, problem: "not a file (a link or a directory)" });
      continue;
    }
    const parsed = parseMockupFile(entry.name, await readFile(path.join(dir, entry.name), "utf8"));
    if (typeof parsed === "string") {
      problems.push({ file: entry.name, problem: parsed });
      continue;
    }
    /* Claimed before they are checked, so a bad image is one problem, the
       mockup's, rather than a second one saying nobody shows it. */
    for (const file of parsed.images) shown.add(file);
    const problem = await imagesProblem(dir, parsed, checkContent);
    if (problem === null) mockups.push(parsed);
    else problems.push({ file: entry.name, problem });
  }

  let total = 0;
  for (const entry of entries) {
    if (entry.isFile()) total += (await lstat(path.join(dir, entry.name))).size;
    if (mockupName(entry.name) || shown.has(entry.name)) continue;
    problems.push({
      file: entry.name,
      problem:
        mockupImageType(entry.name) === null
          ? "neither a mockup (m-xxxxxx.md) nor an image one of them shows"
          : "an image no mockup shows",
    });
  }
  if (total > totalCap) {
    problems.push({
      file: "(all files)",
      problem: `the files together are ${total} bytes, over ${totalCap}: every one is copied into the API function`,
    });
  }
  return { mockups: mockups.sort(newestFirst), problems };
}

/**
 * **One mockup by id**: the mockup, `null` when there is no such file, or what
 * is wrong with the one there is. `id` must already be a mockup id — it is
 * joined onto the directory.
 */
export async function readOneMockup(dir: string, id: string): Promise<MockupFile | string | null> {
  if (!isMockupId(id)) throw new Error("readOneMockup: not a mockup id");
  const name = `${id}.md`;
  const size = await regularFileSize(path.join(dir, name));
  if (size === "missing") return null;
  if (size === "not-a-file") return "not a file (a link or a directory)";
  return readChecked(dir, name, false);
}

/**
 * **One of a checked mockup's images**: its bytes and type, `null` when the
 * index is past the end, or what is wrong with the file. The type comes from
 * the allowlist and is checked against the first bytes before anything is
 * sent.
 */
export async function readMockupImage(
  dir: string,
  mockup: MockupFile,
  index: number,
): Promise<{ bytes: Uint8Array; contentType: MockupImageType } | string | null> {
  const file = mockup.images[index];
  if (file === undefined) return null;
  const type = mockupImageType(file);
  if (type === null) return `the image ${file} has no allowed type`;
  const size = await regularFileSize(path.join(dir, file));
  if (typeof size !== "number") return `the image ${file} is not a file`;
  if (size > MAX_MOCKUP_IMAGE_BYTES) return `the image ${file} is too large`;
  const bytes = new Uint8Array(await readFile(path.join(dir, file)));
  if (!imageBytesAre(bytes, type)) return `the image ${file} is not ${type}`;
  return { bytes, contentType: type };
}
