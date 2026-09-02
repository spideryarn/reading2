# Fable's review of 260902c, before building

The plan is [260902c-concurrent-migrations-across-worktrees.md](260902c-concurrent-migrations-across-worktrees.md);
GPT Sol's earlier review, which reshaped it, is
[260902c-concurrent-migrations-review-sol.md](260902c-concurrent-migrations-review-sol.md).

Run 2026-09-02, in the worktree, ~10 minutes, asked **not** to repeat Sol's findings but to check
whether stages 1–5 *as now written* are correct and buildable against this tree — verifying against
the real files rather than the prose.

**One finding is a genuine gap and it changed the code: finding 1.** The rest confirm the plan,
several with `bin.cjs` line numbers the plan did not have. Two mechanical caveats it recorded about
itself, kept because they bear on how much weight each finding carries: it lost `Bash` partway
through when it hit the worktree-isolation guard, so nothing below was *timed*, only read; and
stages 1 and 3 were being built in the same worktree while it read, so it saw some of the answer.

Verbatim below.

---

## Findings

1. **Stage 2's checklist is missing the one check the stage exists for — the journal→snapshot hole check. Needs a scope change before building.** The plan's stage-1 section says "It does not cover the holes — it is green with `0003` and `0029` missing. That is stage 2." But stage 2's six bullets never include "every journal entry (after the exceptions) has a snapshot": "every physical snapshot maps to exactly one journal prefix" is the *snapshot→journal* direction only, and the chain-link check doesn't catch holes either, because **the physical chain splices cleanly over both holes** — verified: `0004_snapshot.prevId` = `0002_snapshot.id` (`31772517-…`) and `0030_snapshot.prevId` = `0028_snapshot.id` (`f0f58edd-…`). So a validator built exactly from the bullets passes a future `0029`-shaped hole, which is the incident (`drizzle/0030_drop_summary_steer.sql` header) the stage cites as its precedent. Corollary: only **one** of the three named exceptions (0021→0022) is exercised by the listed checks; 0003/0029 become exceptions only once the hole check is added. Add the bullet, and add a missing-snapshot fixture that goes red without the exception list.

2. **The three historical exceptions are exactly what is on disk — verified.** 52 journal entries, 50 snapshot files, no `0003_snapshot.json` or `0029_snapshot.json`, and the only chain break is `0022_snapshot.prevId` = `a65344d1-…` ≠ `0021_snapshot.id` = `dcf76eca-…` (`drizzle/meta/0021_snapshot.json:2`, `0022_snapshot.json:3`). `0022.prevId` matches **no snapshot in the folder** (a deleted pre-renumbering one), and `0023.prevId` = `0022.id`, so "no two snapshots share a prevId" is green today — no hidden fourth exception. One note for fixtures: `0023_snapshot.json` is hand-edited with `id`/`prevId` at the *end* of the file (:2312–2313), so the validator must parse JSON, never grep file heads.

3. **The GRANDFATHERED pattern the plan says to copy lives in the test, and stage 2's exceptions cannot.** The shape is `GrandfatheredInversion` (`scripts/migration-ledger.ts:335-342` — both tags *and* both `when`s, so regeneration lapses the exemption) and the constant plus its pinning test are in `tests/migration-journal.test.ts:52-59, 74-79`. For the preflight to see the snapshot exceptions, the constant must move into production code — a placement difference from the pattern being copied.

4. **"In `journalProblems`" taken literally is the wrong seam.** `journalProblems(journal, hashes)` is pure (`scripts/migration-ledger.ts:297`) and is called *inside* `reconcileLedger` (:210), whose caller is `scripts/db-migrate.ts:224`; adding snapshot data means changing both signatures and every caller. The clean fit is the module's own existing split — a sibling pure `snapshotProblems(...)` plus a reader, mirroring `readJournal`/`hashMigrationFiles` (:640-674), called from the preflight and the test. Also worth one line in the plan: wiring it into the preflight means `db:migrate` will refuse to apply *valid pending SQL* over a metadata-only fault (`migrate()` never reads snapshots) — defensible, but it's a choice, and stage 4's runbook should list "db:migrate refuses" as a symptom of a snapshot fault.

5. **Stage 1 verified, with one trivial wording fix.** `deploy.ts:444` runs `npx drizzle-kit check` as claimed; the exit-code split is exact (`bin.cjs:8226-8229` — generate path `process.exit(0)`; `:91745-91748` — check path `process.exit(1)`). It is genuinely offline: `checkHandler` (bin.cjs:91716) does only filesystem reads, and `drizzle.config.ts` has no `dbCredentials` (:17-23). But `check.ts` runs sub-checks as `npm run --silent <script>` argv arrays (`scripts/check.ts:148`), so it's a package.json script plus a STEPS entry, not "one line".

6. **Stage 3 is buildable and the postcondition is right — verified from `writeResult` (`bin.cjs:32902`).** Write order: snapshot (:32933) → journal (:32950-32957) → `.sql` (:32958), three non-atomic `writeFileSync`s. So "new journal entry + new `.sql` + new snapshot, or acknowledged no-op" is both the cheapest and the correct postcondition. Two useful facts the plan doesn't state: `generate --custom` **does** write a snapshot (the write at :32933 is unconditional; the custom branch :32946-32949 only swaps the SQL body), so the postcondition holds for custom migrations too — and therefore stage 4 should say "hand-write SQL via `generate --custom`, never by creating a file", which is what makes 0029-shaped holes stop happening.

7. **Stage 5 verified: config location, option support, and the sweep.** `migrations.prefix` goes in the existing block at `drizzle.config.ts:35-38`; it is supported in the pinned drizzle-kit 0.31.10 (`index.d.ts:3-4, 123-127`; plumbed as `prefixMode`, `bin.cjs:32916→32928`); timestamp format is UTC `YYYYMMDDhhmmss` (:32988-32998), one-second resolution as the plan now says; `when` stays `Date.now()` (:32950) so nothing in `migration-ledger.ts` is affected. The sweep claim holds: `tests/db-step-constraint.test.ts:106` (`/^\d{4}_.*\.sql$/`) is the only hard dependent — `migration-ledger.ts` strips only `.sql` (:668-671), `deploy.ts` reads `drizzle/${tag}.sql` by tag (:828, :864), `expectedMigrations` builds `${tag}.sql` (:729); everything else is tag-driven. Two nuances: the test goes red not on switch day but on the first timestamp-prefixed migration that re-declares `revision_step_runs_step`; and its lexical sort at :40-43 stays correct (`'0' < '2'`) but the comment "the numeric prefix is the order" becomes stale. Caveat: `api/`, `evals/` and docs were checked file-by-file rather than by regex grep (tooling constraint above); nothing in the read set touches migration filenames.

## Readiness

- **Stage 1 — ready**; "one line" is a wording nit.
- **Stage 2 — needs the scope fix in finding 1 before building** (add the hole check + exceptions + fixture; placement per findings 3-4). Everything else in it checks out against disk.
- **Stage 3 — ready**; write-order and `--custom` behaviour confirm the postcondition as designed.
- **Stage 4 — ready as a runbook**; add "use `generate --custom` for hand-written SQL" (finding 6) and "db:migrate refusing is a metadata symptom" (finding 4).
- **Stage 5 — ready**; option confirmed supported in 0.31.10, single dependent confirmed, wording already corrected.

Nothing in the plan is not worth building; the one over-claim ("one line") is cosmetic, and the one real gap is stage 2's missing hole check — which is fixable with a bullet and a fixture, not a redesign.

---

## What was done with each

1. **Taken.** `snapshotProblems` check 5 runs both directions, `HISTORICAL.missing` names `0003` and
   `0029` with a reason each, and `tests/migration-snapshots.test.ts` has both the fixture that goes
   red without the exception and the assertion that the real holes are still there.
2. **Confirmed independently** by walking the chain; the validator parses JSON, so `0023`'s
   key order costs nothing.
3. **Taken.** `HISTORICAL` is exported from `scripts/migration-snapshots.ts`, with a comment saying
   why it sits in production code where `GRANDFATHERED` does not.
4. **Taken, and one step further.** A sibling function, as suggested — and the preflight **warns**
   rather than refusing, because Fable is right that a metadata fault does not make the pending SQL
   wrong, and that argument goes all the way to not blocking on it.
5. **Taken**; the plan's "one line" wording stands as written, but the build is a package.json
   script (`db:chain`) plus a `STEPS` entry, and `check.ts` says so.
6. **Taken.** `--custom` is now what database.md tells you to use for hand-written SQL, named as the
   thing that stops another `0029`.
7. **Taken.** `migrations()` in `tests/db-step-constraint.test.ts` now reads journal order rather
   than sorting filenames — Fable is right that the sort still happens to work, and "happens to" is
   not a property; a merge can reorder the journal, and journal order is what `migrate()` reads.
