/**
 * **The unit lane may not have a database or a bucket, and this is what makes
 * that true.**
 *
 * GPT Sol's obligation on T-D, from the T-C review
 * (`260903f-lane-manifest-review-sol.md` § 2), and it is not a suggestion.
 *
 * The lane map is a *syntactic* inventory guard: it reads the text of every test
 * file and assigns a lane to each one that calls `pgReady(` or builds a `pg`
 * `Pool`/`Client`. It therefore cannot see an aliased constructor
 * (`new PgPool()`), a helper of a file's own that connects somewhere else, a
 * dynamic `import()`, or a transitive `getDb()` inside application code. A test
 * that escapes it lands in this project, reaches the shared `postgres`, and
 * **passes** — the exact shape docs/reusable/silent-success.md is about, because
 * the check (is the file in the manifest?) shares its assumption with the thing
 * it checks.
 *
 * Poisoning `DATABASE_URL` is the semantic backstop a syntactic guard cannot be.
 * A missed database test now fails, loudly, naming a database that does not
 * exist, instead of quietly borrowing everybody else's.
 *
 * **It found one on its first full run**, which is the argument for it being
 * here at all: `tests/health.test.ts` drives the health handler, which reads the
 * migration ledger through the application's own `getDb()`, with none of the
 * syntax the scan looks for. Four failures, *"the migration ledger could not be
 * read"*, and 28/28 in the private lane with no edit to the file. It is declared
 * in `LANES_BEYOND_THE_SCAN` — see `tests/store-migration-registry.ts`.
 *
 * A transitive-import guard is **not** an alternative and should not be tried:
 * Sol measured of the order of a hundred and fifty test files outside the lane
 * map that can *reach* a module importing `pg`, nearly all of them legitimate
 * unit tests that mock it or never execute that path.
 *
 * ## The ordering is the whole thing, and it is not the ordering you would guess
 *
 * [`src/env.ts`](../../src/env.ts) applies `.env.local` **over** `process.env`,
 * except where the current value differs from the snapshot it took **at its own
 * module load** — which it reads as "this process meant it". So the line that
 * matters is not `loadEnvLocal()`; it is `import … from "../../src/env.js"`.
 *
 * **Measured three ways, 2026-09-04, against
 * `tests/unit-lane-has-no-database.test.ts`:**
 *
 * | where the assignment goes | what happened |
 * |---|---|
 * | after the static import, after `loadEnvLocal()` — as below | poison survives |
 * | after the static import, **before** `loadEnvLocal()` | poison survives too |
 * | **before** `src/env.ts` is loaded (a dynamic `import()` underneath it) | poison erased — the control read back `postgresql://postgres:…@127.0.0.1:54362/postgres` and **connected to the shared database** |
 *
 * The third row is the shape to remember, because it is also what
 * `DATABASE_URL=… npx vitest` does: the value is in place before any of our code
 * runs, so it *is* the snapshot, and `.env.local` wins.
 *
 * **And it is silent.** `src/env.ts` prints a line when `.env.local` shadows an
 * inherited value — gated on `NODE_ENV !== "test"`, and vitest sets
 * `NODE_ENV=test`. Under the runner the overwrite says nothing at all. That is
 * why the control asserts a failed *connection* and not the string.
 *
 * The assignment stays below `loadEnvLocal()` even though the middle row says it
 * need not: it is the order `tests/setup/private-db.ts` uses, and one order that
 * is right for two reasons beats two orders that are each right for one.
 *
 * ## Why a syntactically valid URL rather than deleting the variable
 *
 * Deleting it makes `pgReady` report the fresh-clone case — "no DATABASE_URL",
 * quiet by design — which is the wrong story and a quieter failure. A URL that
 * parses, points at a closed port and names itself gets the reader to the answer
 * from the first line of the error.
 *
 * ## What this catches, and what it turns into a skip
 *
 * Stated rather than left for somebody to discover. An escapee that opens its
 * own connection — the aliased constructor, the helper, the transitive
 * `getDb()` — gets `ECONNREFUSED` and fails. An escapee that goes through
 * `pgReady` **skips**, with the warning that helper already prints, because that
 * is what `pgReady` does with an unreachable URL. That is a real gap and it is
 * a small one: a file calling `pgReady(` is exactly what the lane scan does see,
 * so it cannot be an escapee in the first place, and under `REQUIRE_POSTGRES=1`
 * — which `npm run check` sets — the skip is a failure too. Measured both ways
 * on 2026-09-04; see docs/plans/260903f… § T-D.
 *
 * ## `DATABASE_URL` was never the only door, and Storage is the other one
 *
 * GPT Sol's first blocking finding on T-D, 2026-09-04, and it was right: the
 * poison covered one variable while `blobStore()` (src/store/blobs.ts) chooses
 * **Supabase Storage** off `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`,
 * which this box has. Sol named four files in this lane reaching the real shared
 * bucket over HTTP — measured, not inferred — and one of them,
 * `tests/raw-source-store.test.ts`, repeatedly removes and re-plants **one
 * deterministic canonical key** with deliberately corrupt bytes, so two runs on
 * this box could destroy each other's oracle.
 *
 * **The poison then found two more on its first full run**, which is the whole
 * case for a semantic backstop rather than a better reading: `job-failure` and
 * `acquire-extract-blocks-end-to-end`, and the second names no store at all —
 * it reaches the bucket through the pipeline's own acquire step, so no amount of
 * reading the lane map would have turned it up. All six have a lane now
 * (`LANES_BEYOND_THE_SCAN` in `tests/store-migration-registry.ts` says why each
 * one), and this lane can no longer reach Storage at all.
 *
 * **Unsetting the credentials would have been the wrong fix and a worse bug** —
 * `blobStore()` falls back to the filesystem adapter when either is missing, so
 * the lane would have got a *working* store rather than a refusal. The poison
 * is therefore a URL: the Supabase adapter stays selected and every call it
 * makes fails. See `UNIT_LANE_STORAGE_POISON`.
 *
 * ## Neither poison survives `spawn` on its own, so a third variable does
 *
 * Also Sol's, and the same review. A child process inherits the poison
 * *before* it loads `src/env.ts`, so the poison becomes part of the child's own
 * `INHERITED` snapshot — `.env.local` then reads it as "the shell said so" and
 * puts the real URL back, saying nothing, because the warning is gated on
 * `NODE_ENV !== "test"`. Several unit tests spawn `tsx` children.
 *
 * The fix is in `src/env.ts` rather than here, because a value assigned in a
 * setup file cannot cross a process boundary and a convention every
 * subprocess-spawning test has to remember is the shape this stage exists to
 * delete. `PINNED` names the variables `.env.local` may not write; being a
 * variable rather than a comparison against a snapshot, it *is* inherited.
 *
 * The values themselves live in
 * [`tests/helpers/unit-lane-poison.ts`](../helpers/unit-lane-poison.ts), so that
 * the control suite can read them without importing this file and applying it.
 */
import { loadEnvLocal, PINNED } from "../../src/env.js";
import { UNIT_LANE_POISON, UNIT_LANE_STORAGE_POISON } from "../helpers/unit-lane-poison.js";

loadEnvLocal();

/* AFTER loadEnvLocal(). See the header. */
process.env.DATABASE_URL = UNIT_LANE_POISON;
process.env.SUPABASE_URL = UNIT_LANE_STORAGE_POISON;

/* And AFTER the two assignments, so that a child inherits the poisons and the
   instruction not to overwrite them together. See the header, and `PINNED` in
   src/env.ts. */
process.env[PINNED] = "DATABASE_URL,SUPABASE_URL";
