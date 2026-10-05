/* Try to break tests/no-undeclared-spend.test.ts WITHOUT touching the repo.
   Makes a scratch copy of the test's matcher (everything above its describe
   block, which is the pure functions capabilitiesOf / offenceFor) in the OS
   temp directory, then hands it made-up source files and prints the verdict
   for each. Makes no request. The made-up files are in
   break-the-scan-cases.json beside this one: they are text that names
   provider hosts and credentials, and a .json file is not something the scan
   reads, so this script names none itself.
   Run:  npx tsx evals/cost/audit-261005/break-the-scan.ts */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const src = readFileSync(path.join(ROOT, "tests/no-undeclared-spend.test.ts"), "utf8");
const cut = src.indexOf('describe("no undeclared spend"');
if (cut < 0) throw new Error("the describe block moved");
const copy = src
  .slice(0, cut)
  .replace('from "@babel/parser"', `from ${JSON.stringify(path.join(ROOT, "node_modules/@babel/parser/lib/index.js"))}`)
  .replace('import { describe, expect, it } from "vitest";', "")
  .replace('"../src/spend-declarations.js"', JSON.stringify(path.join(ROOT, "src/spend-declarations.ts")))
  .replace('path.resolve(import.meta.dirname, "..")', JSON.stringify(ROOT));
const dir = path.join(os.tmpdir(), "spideryarn-audit-261005");
mkdirSync(dir, { recursive: true });
const copyPath = path.join(dir, "scan-copy.ts");
writeFileSync(copyPath, copy);
const { capabilitiesOf, offenceFor } = await import(pathToFileURL(copyPath).href);

/* [label, the path the made-up file pretends to have, its source]. */
const cases = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "break-the-scan-cases.json"), "utf8"),
) as [string, string, string][];
for (const [label, file, source] of cases) {
  const scan = capabilitiesOf(file, source);
  const offence = offenceFor(file, scan);
  console.log(
    `${offence ? "CAUGHT " : "PASSED "} ${label}\n         findings: ${[...new Set(scan.findings.map((f: { what: string }) => f.what))].join(", ") || "(none)"}`,
  );
}
