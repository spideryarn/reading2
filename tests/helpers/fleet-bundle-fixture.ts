/**
 * A whole, valid fleet bundle in a directory, for tests that then break exactly
 * one thing about it.
 *
 * Starting from valid is the point (GPT Sol's P3R-05, 2026-10-06): a fixture
 * that is merely "an empty index.html in an otherwise empty directory" is
 * refused for having no manifest, so the test passes with the emptiness check
 * deleted. Every file here is one `fleetBundleProblem` would accept, and the
 * manifest is made by the same `buildFilesManifest` the real build uses.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BUILD_ENTRY_FILE, BUILD_FILES_FILE, buildFilesManifest, type BuildFilesManifest } from "../../tools/fleet/build-files.js";
import { BUILD_STAMP_FILE } from "../../tools/fleet/build-stamp.js";

export const FIXTURE_JS = "assets/index-AbCd1234.js";
export const FIXTURE_CSS = "assets/index-EfGh5678.css";
export const FIXTURE_FONT = "assets/geist-latin-wght-normal-IjKl9012.woff2";

const AT = "2026-10-06T12:00:00.000Z";

export type FixtureStamp =
  | { kind: "known"; sha: string; dirty: boolean }
  | { kind: "unknown"; why: string }
  /** The stamp file's whole text, for a stamp that is not one. */
  | { raw: string };

export function writeFleetBundle(
  distDir: string,
  stamp: FixtureStamp,
  over: { entry?: string } = {},
): BuildFilesManifest {
  const files: Array<{ path: string; content: string | Uint8Array }> = [
    {
      path: BUILD_ENTRY_FILE,
      content:
        over.entry ??
        `<!doctype html><script type="module" src="./${FIXTURE_JS}"></script><link rel="stylesheet" href="./${FIXTURE_CSS}">\n`,
    },
    {
      path: BUILD_STAMP_FILE,
      content: "raw" in stamp ? stamp.raw : `${JSON.stringify({ ...stamp, readAt: AT, builtAt: AT }, null, 2)}\n`,
    },
    { path: FIXTURE_JS, content: "console.log('the fleet client, all of it');\n" },
    { path: FIXTURE_CSS, content: "@font-face{src:url(./geist-latin-wght-normal-IjKl9012.woff2)}\n" },
    { path: FIXTURE_FONT, content: new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3, 250, 251, 252, 253]) },
  ];
  for (const file of files) {
    const target = path.join(distDir, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  const manifest = buildFilesManifest(files);
  writeManifest(distDir, manifest);
  return manifest;
}

export function writeManifest(distDir: string, manifest: unknown): void {
  writeFileSync(path.join(distDir, BUILD_FILES_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}
