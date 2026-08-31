# Review prompt — the built half of the PDF upload work

Re-run with:

```
npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 \
  --prompt-file docs/plans/260826ai-pdf-upload-code-review-prompt.md \
  --output docs/plans/260826ag-pdf-upload-code-review-sol.md
```

---

You reviewed the **plan** for this work earlier today; your review is at
`docs/plans/260826z-pdf-upload-storage-review-sol.md` and the plan it changed is
`docs/plans/260826u-pdf-upload-and-storage.md`. **This is the second review, of code built from it.**
Weight it higher than the plan review: a plan-stage review cannot find an off-by-one in a regex or a
state machine that lets an upload skip a check.

You are read-only. Do not modify files.

## What was built since your last review

Three commits, plus one uncommitted schema change:

1. **`41207a8`** — moved the PDF page cap so it fires before the parse. Diff in
   `git show 41207a8`. This was *your* finding: `readPdf` checked `pass.pages.length > MAX_PAGES`
   after `pass0` returned, by which time pdf.js had walked every page and every text item into
   memory. It now checks `doc.numPages` immediately after `getDocument`, throws `TooManyPages`, and
   destroys the loading task. New test `tests/pdf-page-cap.test.ts` mocks pdfjs and asserts
   `getPage` was never called.
2. **`6c9bd11`** — `src/source.ts`, the source model (pure, no storage client, no database), with
   `tests/source.test.ts`; and the `[storage.buckets.sources]` declaration in
   `supabase/config.toml`.
3. **Uncommitted**: two new tables in `src/db/schema.ts` — `raw_sources` and `uploads` — plus a
   nullable `raw_source_id` on `article_revisions`. See `git diff src/db/schema.ts`. **No migration
   has been generated yet** — deliberately, see "Known gaps" below.

## Greg's decisions since your review, which changed the design

- **Sources are shared across readers; articles are not.** One `raw_sources` row per distinct
  SHA-256, referenced by any number of articles belonging to any number of readers. This is your
  "third option" (content addressing), extended across readers as well as revisions.
- **Sources are kept forever.** Nothing deletes a source while anything references it.
- **The upload endpoints will deploy before the beta gate**, i.e. with no auth and no rate limit,
  knowingly. You flagged this; he accepted it. Do not re-litigate the decision, but **do** tell us
  what specifically becomes exploitable and what the cheapest real mitigations are.

## The central claim I want attacked

Content addressing is being used as a **security** argument, not just a storage one, and I want to
know if the reasoning holds. Measured against the running local stack:

- Replaying a signed upload grant while the object exists → `409 Duplicate`.
- A hostile `x-upsert: true` header → still `409`; the header does not override the token.
- Minting with `{"upsert": true}` → accepted, but the token payload still says `upsert: false`.
- **Replaying the grant after the object is deleted → `200`, re-uploaded.** The grant outlives the
  object it created.

The claimed invariant, in `src/source.ts`'s header:

> A grant is only ever minted for a staging key. A canonical key is never writable by a grant.

…and therefore: an upload lands at `staging/<uploadId>`, is read once, hashed, promoted to
`sha256/<hash>.<ext>`; we never read the staging key again; a replayed grant can only litter a
location nothing consults; and a canonical object cannot be substituted because its name is a claim
about its contents.

**Is that sound?** Specifically:

1. Is there a sequence where a replayed grant causes us to read bytes we did not verify?
2. Is "we never read the staging key again" actually enforceable, or is it a comment that some
   future retry path will violate? What would enforce it?
3. Does promotion (staging → canonical) have a safe implementation on Supabase Storage? `move` is
   not atomic with the database write. What is the correct ordering, and what breaks on each crash
   point?
4. **Cross-reader dedup leaks existence** (reader B learns whether A uploaded a given file, by
   timing). Recorded in the plan. Is that the only leak, or does content addressing leak more than
   we have written down — e.g. via the canonical key being guessable, or via `409`/`200`
   distinctions on any endpoint?
5. If two uploads of the *same* bytes race — both verify, both try to create the `raw_sources` row —
   what happens, and does the `unique` on `sha256` produce a correct outcome or a 500?

## Also review

**`src/source.ts`:**
- `stagingKey` / `canonicalKey` / `isStagingKey` — are the regexes actually tight? Can any input
  produce a key that escapes its prefix, collides, or is accepted by `isStagingKey` when it should
  not be?
- `canTransition` and the `NEXT` table — can an upload reach `verified` without being `claimed`? Is
  `expired` reachable from `claimed`, and should it be?
- `grantExpired` / `sweepable` — is `SWEEP_GRACE_MS = TTL + 1h` enough? Is comparing against
  `mintedAt` right, or should it be the object's own creation time?
- `looksLikePdf`, `cleanFilename` — anything that gets past these?
- `rejectionMessage` — `docs/project/copy.md` is the standard.

**`tests/source.test.ts`** — which of these tests would still pass if the code were wrong? That is
the question I care about most. Name any test that is decorative.

**`src/db/schema.ts`** (uncommitted diff) — the two tables. Are the columns right? What is missing:
indexes, constraints, `CHECK`s on `status` and `media`, `ON DELETE` behaviour, the
`raw_bytes` / `raw_source_id` coexistence rule (currently a comment, not a constraint)?

**`tests/pdf-page-cap.test.ts`** — the mock replaces pdfjs entirely. Does the test still prove
anything about the real library? Is `doc.numPages` genuinely available without page access in
pdf.js 6?

## Known gaps, so you do not spend the review finding them

- **No migration generated.** Another agent has uncommitted `ideas` changes in `src/db/schema.ts`,
  and `drizzle-kit generate` is a whole-schema operation, so generating now would sweep their work
  into our migration and produce a snapshot that disagrees with the SQL. Tell us if there is a
  correct way to do this in a shared tree; we are not using git worktrees.
- No routes, no storage adapter, no upload repository, no file picker yet. Those are the next steps.
- `supabase db reset` was not run to prove the bucket declaration works; the bucket was created via
  the API to match. Fifteen other sessions share the local database.

## Output

Structure as: (1) the central claim — sound or not, and why; (2) blocking problems; (3) should-fix;
(4) decorative tests; (5) what is right; (6) questions for Greg. Be specific, cite `file:line`, and
say plainly when something is fine. Prefer depth on the invariant over breadth.
