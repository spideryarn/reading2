/**
 * **What the API function carries besides its bundle** — vercel.json's
 * `includeFiles`, which is one glob string, not a list (Vercel's schema). Two
 * directories ride along and each is read from disk at runtime:
 *
 * - `certs/`, the database's CA certificate (src/db/ssl.ts, certs/README.md);
 * - `docs/mockups/`, the files `/admin/mockups` shows (src/mockups-dir.ts,
 *   plan 261028b Stage 3, GPT Sol's plan review F1).
 *
 * Dropping either from the glob deploys cleanly and fails only at runtime —
 * the certificate silently, the mockups as an empty list — so it is pinned.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("vercel.json includeFiles", () => {
  it("is one glob carrying certs/ and docs/mockups/", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      functions: Record<string, { includeFiles?: unknown }>;
    };
    expect(config.functions["api/**"]?.includeFiles).toBe("{certs/**,docs/mockups/**}");
  });
});

/**
 * **…and `.vercelignore` must let them be uploaded in the first place.** It
 * prunes the upload before the build or `includeFiles` sees anything, and it
 * pruned all of `docs/` — so `includeFiles` would have found no mockups and
 * the page would have been empty in production, with every other test green.
 * Asked of git's own gitignore matcher (`check-ignore --no-index` with the
 * file as the excludes file), since .vercelignore is gitignore syntax and a
 * hand-rolled reading of it is the thing that gets negation wrong: a child of
 * an excluded *directory* cannot be re-included, only a child of `dir/*`.
 * The rest of `docs/` stays out (the positive control).
 */
describe(".vercelignore", () => {
  const ignored = (file: string): boolean =>
    spawnSync("git", ["-c", "core.excludesFile=.vercelignore", "check-ignore", "--no-index", "-q", file]).status === 0;

  it("uploads docs/mockups/ and certs/, and still leaves the rest of docs/ out", () => {
    expect(ignored("docs/project/admin.md"), "the control: the rest of docs/ is pruned").toBe(true);
    expect(ignored("docs/mockups/m-n0gnmu.md")).toBe(false);
    expect(ignored("docs/mockups/m-n0gnmu-example.png")).toBe(false);
    expect(ignored("certs/supabase-ca.crt")).toBe(false);
  });
});
