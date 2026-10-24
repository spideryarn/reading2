/**
 * Build the Chrome extension: `extension/dist/<flavour>/`, ready to load
 * unpacked, and for production a zip to upload to the Chrome Web Store.
 *
 *   npm run extension:build                      # both flavours
 *   npm run extension:build -- --dev-origin=http://localhost:5275
 *
 * One bundle, the service worker, by esbuild (already here under vite), **not
 * minified**: the store reviews the code, minified code is reviewed more
 * slowly, and obfuscated code is refused. ES2020, so nothing in `capturePage`
 * is rewritten into a helper call outside it — Chrome serialises that function
 * into the page, and a helper it called would not go with it.
 *
 * docs/plans/261024q-chrome-extension-one-click-add-the-page.md.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { build } from "esbuild";
import { zipSync } from "fflate";

import {
  DEFAULT_DEV_ORIGIN,
  EXTENSION_VERSION,
  type Flavour,
  manifestFor,
  originsFor,
} from "../extension/manifest.js";

const ROOT = join(import.meta.dirname, "..", "extension");
const DIST = join(ROOT, "dist");

const devOrigin =
  process.argv.find((a) => a.startsWith("--dev-origin="))?.slice("--dev-origin=".length) ?? DEFAULT_DEV_ORIGIN;
if (!/^http:\/\/localhost:\d+$/.test(devOrigin)) {
  console.error(`--dev-origin must be http://localhost:<port>, not ${devOrigin}`);
  process.exit(2);
}

async function buildFlavour(flavour: Flavour): Promise<string> {
  const out = join(DIST, flavour);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "icons"), { recursive: true });
  await build({
    entryPoints: [join(ROOT, "src", "background.ts")],
    outfile: join(out, "background.js"),
    bundle: true,
    format: "esm",
    target: "es2020",
    platform: "browser",
    minify: false,
    legalComments: "none",
    define: { SPIDERYARN_ORIGINS: JSON.stringify(originsFor(flavour, devOrigin)) },
    logLevel: "warning",
  });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifestFor(flavour), null, 2)}\n`);
  for (const icon of readdirSync(join(ROOT, "icons"))) {
    copyFileSync(join(ROOT, "icons", icon), join(out, "icons", icon));
  }
  return out;
}

/** The store wants the files at the zip's root, not inside a folder. */
function zip(dir: string, to: string): void {
  const files: Record<string, Uint8Array> = {};
  const walk = (at: string, prefix: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else files[`${prefix}${entry.name}`] = readFileSync(path);
    }
  };
  walk(dir, "");
  writeFileSync(to, zipSync(files, { level: 9 }));
}

const production = await buildFlavour("production");
const dev = await buildFlavour("dev");
const zipPath = join(DIST, `spideryarn-extension-${EXTENSION_VERSION}.zip`);
zip(production, zipPath);
console.log(`production: ${production}\n            ${zipPath}\ndev:        ${dev} (talks to ${devOrigin})`);
