/**
 * SPIKE (throwaway): run the real migrator against a named database.
 *
 * Exists because the isolation spike needs migrations applied to a database
 * that is not the one in `.env.local`, and this is the one seam that makes that
 * possible without editing anything: `scripts/db-migrate.ts` resolves its target
 * with `resolveTargetUrl({ shellWins: true })`, so a `DATABASE_URL` present in
 * the environment *at the moment `src/env.ts` is first loaded* beats
 * `.env.local`.
 *
 * That ordering is the whole trick, and it is the trap the real harness will
 * have to get right too — in the opposite direction. `src/env.ts` snapshots the
 * environment at module load (`INHERITED`) and then:
 *
 *   - unchanged since startup  → it came from the shell → `.env.local` wins
 *   - differs from the snapshot → this process meant it → the assignment wins
 *
 * So a *script* like this one must assign BEFORE the first import of
 * `src/env.ts` (making the value part of the snapshot, which `shellWins: true`
 * then prefers), while a vitest *setup file* must assign AFTER it (making the
 * value differ from the snapshot). Get either backwards and `.env.local`
 * silently restores the shared database while everything reports success.
 *
 *   npx tsx scripts/spike-migrate-to.ts <path-to-file-holding-the-url>
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: spike-migrate-to.ts <file-with-url>");

const url = readFileSync(file, "utf8").trim();
if (!url.startsWith("postgresql://")) throw new Error(`not a postgres url: ${url.slice(0, 20)}…`);

/* Before the dynamic import below, so `src/env.ts` snapshots it. */
process.env.DATABASE_URL = url;

console.log(`spike: migrating ${url.replace(/:[^:@]*@/, ":***@")}`);

/* Dynamic, because a static import would be hoisted above the assignment. */
await import("./db-migrate.js");
