/**
 * **The mockups `/admin/mockups` shows: start one, or check them all.**
 *
 *     npx tsx scripts/mockups.ts                 # check every file in docs/mockups/ and list them
 *     npx tsx scripts/mockups.ts --new "<title>"  # a fresh id, path and header; creates nothing
 *
 * A mockup is a file `docs/mockups/m-xxxxxx.md` (src/mockups.ts has the
 * format), with any images beside it. It is on the page after the next deploy,
 * not at once as a question is. With no arguments this exits 1 if any file
 * would be left off the page or the directory is over its cap; the test suite
 * runs the same check (tests/mockups.test.ts). docs/project/admin.md §
 * `/admin/mockups`; plan 261028b, Stage 3.
 */
import { readdirSync } from "node:fs";

import { mockupsDir, readMockupDirectory } from "../src/mockups-dir.js";
import { newMockup } from "../src/mockups.js";

async function main(argv: readonly string[]): Promise<number> {
  const dir = mockupsDir();
  if (argv[0] === "--new") {
    const title = argv[1];
    if (title === undefined || argv.length > 2) {
      console.error('usage: npx tsx scripts/mockups.ts --new "<title>"');
      return 1;
    }
    let taken: Set<string>;
    try {
      taken = new Set(readdirSync(dir).map((name) => name.replace(/\.md$/, "")));
    } catch {
      taken = new Set();
    }
    const made = newMockup(title, taken);
    console.log(`${made.path}\n\n${made.text}`);
    return 0;
  }
  if (argv.length > 0) {
    console.error(`unknown argument: ${argv[0]}`);
    return 1;
  }

  const { mockups, problems } = await readMockupDirectory(dir, { checkContent: true });
  for (const m of mockups) {
    const images = m.images.length === 0 ? "" : ` · ${m.images.length} image${m.images.length === 1 ? "" : "s"}`;
    console.log(`${m.id}  ${m.made}  ${m.title}${images}`);
  }
  for (const p of problems) console.error(`✗ ${p.file}: ${p.problem}`);
  console.log(
    `${mockups.length} mockup${mockups.length === 1 ? "" : "s"}, ${problems.length} problem${problems.length === 1 ? "" : "s"} (${dir})`,
  );
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
