/**
 * The fleet bundle's completion manifest, and the check that re-reads the disk
 * against it (`tools/fleet/build-files.ts`).
 *
 * Every refusal below starts from a bundle the check accepts and breaks one
 * thing, and asserts the sentence for THAT thing. A looser assertion — "it
 * returned some problem" — lets a fixture be refused by a different predicate
 * from the one the test is named for, which is how a guard gets deleted with
 * its test still green.
 */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { BUILD_FILES_FILE, buildFilesManifest, fleetBundleProblem, type BuildFilesManifest } from "../tools/fleet/build-files.js";
import { FIXTURE_FONT, FIXTURE_JS, writeFleetBundle, writeManifest, type FixtureStamp } from "./helpers/fleet-bundle-fixture.js";

const SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const OTHER_SHA = "1111111111111111111111111111111111111111";
const CLEAN: FixtureStamp = { kind: "known", sha: SHA, dirty: false };

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** `<scratch>/dist`, so that a test can put something beside it, outside. */
function scratchDist(): string {
  const parent = mkdtempSync(path.join(tmpdir(), "fleet-build-files-test-"));
  dirs.push(parent);
  const dist = path.join(parent, "dist");
  mkdirSync(dist);
  return dist;
}

function without(manifest: BuildFilesManifest, name: string): BuildFilesManifest {
  return { schema: 1, files: manifest.files.filter((file) => file.path !== name) };
}

describe("buildFilesManifest", () => {
  test("records each file's length in bytes and its sha256, sorted by path", () => {
    expect(buildFilesManifest([
      { path: "b.txt", content: "é" },
      { path: "a.txt", content: "abc" },
      { path: "c.bin", content: new Uint8Array([0x61, 0x62, 0x63]) },
    ])).toEqual({
      schema: 1,
      files: [
        { path: "a.txt", bytes: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
        /* Two bytes, not one character: measured as the UTF-8 that is written. */
        { path: "b.txt", bytes: 2, sha256: "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c" },
        { path: "c.bin", bytes: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
      ],
    });
  });
});

describe("fleetBundleProblem", () => {
  test("accepts a whole bundle stamped clean at the target sha", () => {
    const dist = scratchDist();
    writeFleetBundle(dist, CLEAN);
    expect(fleetBundleProblem(dist, SHA)).toBeNull();
  });

  test.each<[string, (dist: string, manifest: BuildFilesManifest) => void, RegExp]>([
    [
      "no manifest",
      (dist) => rmSync(path.join(dist, BUILD_FILES_FILE)),
      /^no build-files\.json in /,
    ],
    [
      "a directory where the manifest should be",
      (dist) => {
        rmSync(path.join(dist, BUILD_FILES_FILE));
        mkdirSync(path.join(dist, BUILD_FILES_FILE));
      },
      /build-files\.json is not a regular file$/,
    ],
    [
      "a manifest cut off part way",
      (dist) => {
        const file = path.join(dist, BUILD_FILES_FILE);
        writeFileSync(file, readFileSync(file, "utf8").slice(0, 40));
      },
      /is not a build-files manifest$/,
    ],
    [
      "a manifest of another schema",
      (dist, manifest) => writeManifest(dist, { schema: 2, files: manifest.files }),
      /is not a build-files manifest$/,
    ],
    ["a manifest that is JSON null", (dist) => writeManifest(dist, null), /is not a build-files manifest$/],
    [
      "a manifest with an entry that is not an object",
      (dist, manifest) => writeManifest(dist, { schema: 1, files: [...manifest.files, null] }),
      /is not a build-files manifest$/,
    ],
    [
      "a manifest with an entry that has no path",
      (dist, manifest) => writeManifest(dist, { schema: 1, files: [...manifest.files, { ...manifest.files[0], path: "" }] }),
      /is not a build-files manifest$/,
    ],
    [
      "a manifest whose lengths are strings",
      (dist, manifest) =>
        writeManifest(dist, { schema: 1, files: manifest.files.map((file) => ({ ...file, bytes: String(file.bytes) })) }),
      /is not a build-files manifest$/,
    ],
    [
      "a manifest whose hashes are not lowercase hex",
      (dist, manifest) =>
        writeManifest(dist, { schema: 1, files: manifest.files.map((file) => ({ ...file, sha256: file.sha256.toUpperCase() })) }),
      /is not a build-files manifest$/,
    ],
    [
      "a manifest that does not list index.html",
      (dist, manifest) => writeManifest(dist, without(manifest, "index.html")),
      /does not list index\.html$/,
    ],
    [
      "a manifest that does not list the stamp",
      (dist, manifest) => writeManifest(dist, without(manifest, "build-stamp.json")),
      /does not list build-stamp\.json$/,
    ],
    [
      "an empty index.html",
      (dist) => truncateSync(path.join(dist, "index.html"), 0),
      /^index\.html is 0 bytes, and the build wrote \d+$/,
    ],
    [
      "a directory at index.html",
      (dist) => {
        rmSync(path.join(dist, "index.html"));
        mkdirSync(path.join(dist, "index.html"));
      },
      /^index\.html in .* is not a regular file$/,
    ],
    [
      "a symlink at index.html, to a file with the right content",
      (dist) => {
        const outside = path.join(path.dirname(dist), "index-elsewhere.html");
        renameSync(path.join(dist, "index.html"), outside);
        symlinkSync(outside, path.join(dist, "index.html"));
      },
      /^index\.html in .* is not a regular file$/,
    ],
    [
      "truncated JavaScript",
      (dist) => truncateSync(path.join(dist, FIXTURE_JS), 10),
      /index-AbCd1234\.js is 10 bytes, and the build wrote \d+$/,
    ],
    [
      "JavaScript of the right length and the wrong content",
      (dist) => {
        const file = path.join(dist, FIXTURE_JS);
        writeFileSync(file, readFileSync(file, "utf8").replace("all of it", "ALL OF IT"));
      },
      /index-AbCd1234\.js does not have the content the build wrote$/,
    ],
    [
      "a missing font",
      (dist) => rmSync(path.join(dist, FIXTURE_FONT)),
      /\.woff2 is listed in build-files\.json but missing from /,
    ],
    [
      "a listed path that climbs out of the directory",
      (dist, manifest) => {
        writeFileSync(path.join(path.dirname(dist), "outside.txt"), "abc");
        const [outside] = buildFilesManifest([{ path: "../outside.txt", content: "abc" }]).files;
        if (outside === undefined) throw new Error("fixture");
        writeManifest(dist, { schema: 1, files: [...manifest.files, outside] });
      },
      /lists \.\.\/outside\.txt, which is outside /,
    ],
    [
      "a listed absolute path",
      (dist, manifest) => {
        const target = path.join(dist, FIXTURE_JS);
        const [absolute] = buildFilesManifest([{ path: target, content: readFileSync(target) }]).files;
        if (absolute === undefined) throw new Error("fixture");
        writeManifest(dist, { schema: 1, files: [...manifest.files, absolute] });
      },
      /index-AbCd1234\.js, which is outside /,
    ],
    [
      "an assets directory that is a link to the same files somewhere else",
      (dist) => {
        const outside = path.join(path.dirname(dist), "assets-elsewhere");
        renameSync(path.join(dist, "assets"), outside);
        symlinkSync(outside, path.join(dist, "assets"), "dir");
      },
      /resolves through a link to somewhere outside /,
    ],
    [
      "a file the manifest does not list",
      (dist) => writeFileSync(path.join(dist, "assets", "index-OLD00000.js"), "left behind\n"),
      /holds 1 file\(s\) build-files\.json does not list, the first being assets\/index-OLD00000\.js$/,
    ],
  ])("refuses %s", (_name, damage, expected) => {
    const dist = scratchDist();
    const manifest = writeFleetBundle(dist, CLEAN);
    expect(fleetBundleProblem(dist, SHA)).toBeNull();

    damage(dist, manifest);

    expect(fleetBundleProblem(dist, SHA)).toMatch(expected);
  });

  /* These three are a consistent bundle whose stamp says the wrong thing: the
     stamp is listed and hashed like any other file, so it cannot be edited
     after the fact without tripping the content check instead. */
  test.each<[string, FixtureStamp, RegExp]>([
    ["built at another sha", { kind: "known", sha: OTHER_SHA, dirty: false }, /^the bundle was built at 1{40}, not 0f1e2d3c/],
    ["built from a dirty tree", { kind: "known", sha: SHA, dirty: true }, /with uncommitted changes in the tree$/],
    ["built from a checkout git could not read", { kind: "unknown", why: "git status timed out" }, /git could not read: git status timed out$/],
    ["whose stamp is not a stamp", { raw: "{}\n" }, /build-stamp\.json is not a build stamp/],
  ])("refuses a whole bundle %s", (_name, stamp, expected) => {
    const dist = scratchDist();
    writeFleetBundle(dist, stamp);
    expect(fleetBundleProblem(dist, SHA)).toMatch(expected);
  });

  test("refuses an index.html the build itself wrote empty", () => {
    const dist = scratchDist();
    writeFleetBundle(dist, CLEAN, { entry: "" });
    expect(fleetBundleProblem(dist, SHA)).toBe("index.html is empty, and the build said so itself");
  });

  test("says there is no manifest when the directory itself is not there", () => {
    const dist = path.join(scratchDist(), "absent");
    expect(fleetBundleProblem(dist, SHA)).toMatch(/^no build-files\.json in /);
  });

  /* A NUL in a name is something `lstat` throws on rather than answers. The
     caller runs every tick of an unattended loop and reads the answer as a
     sentence; it must get one. */
  test("turns a check that cannot be carried out into a reason, never a throw", () => {
    const dist = scratchDist();
    const manifest = writeFleetBundle(dist, CLEAN);
    const [unstatable] = buildFilesManifest([{ path: "assets/bad\u0000name.js", content: "x" }]).files;
    if (unstatable === undefined) throw new Error("fixture");
    writeManifest(dist, { schema: 1, files: [...manifest.files, unstatable] });

    expect(fleetBundleProblem(dist, SHA)).toMatch(/dist could not be checked: /);
  });
});
