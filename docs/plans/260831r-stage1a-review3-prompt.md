# Review 3: stage 1a + 1b, and a new cross-session interaction

Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`. Built code, nothing committed. You
have returned NO-SHIP on this stage twice (`docs/plans/260831f-stage1a-review-sol.md`,
`docs/plans/260831h-stage1a-review2-sol.md`); every finding was accepted, none disputed.

**The scoped diff:**
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/e9d59148-0422-4f78-824d-44c35b090da5/scratchpad/stage1a-r3.diff`

**Scope warning.** `src/pipeline.ts` and `src/store/pg.ts` contain another session's entire `quotes`
stage as well as my work — they are unavoidably interleaved and that session is committing
separately. Ignore everything `quotes`; it is not under review. Other sessions' work also appears in
`src/types.ts` (already committed elsewhere), `src/auth.ts`, `src/vercel-health.ts`,
`src/spend-declarations.ts` and `evals/*` — all excluded.

## What was fixed since your last review

**Finding 1 — the guard over-stripped.** `blockIdentityFree` removed every Spideryarn-shaped id and
collapsed `#spya-…` references, so a moved block id and a repointed internal link both read as
current. Replaced by **`canonicalBlock`**: sorted-key JSON of a whole block, **id included, nothing
normalised**. The guard is now membership as a cheap early rejection, then `run.html !== stamped`
byte-for-byte, then `canonicalBlock` per block. It passes the baseline —
`splitIntoBlocks(extracted, file.blocks)` — which is what gives unchanged candidates their old ids
and makes the exact comparison possible, as you said. Your three cases claimed red-then-green: moved
id, repointed link, changed `<title>` outside any block.

**Finding 2 — the importer committed a poisoned pair.** `.returning()` on the guarded upsert; no row
back means `setWhere` refused it, so the row is the pipeline's, and
**`ImportContradictsPipelineRun`** throws *inside* the transaction so the artefact write rolls back
with it. The test asserts rejection, an untouched row, **and that the artefact column still holds the
old value** — the third assertion separating "threw" from "threw after writing".

**Finding 3 — `sketch` in `isCurrent`.** Added `sketchIsCurrent` (and extracted `glossaryIsCurrent`
to stay under the complexity ceiling). Rather than a test naming `sketch`, a **source-reading** test:
every step with a `stamp` in `STEPS` must have a `case` in `isCurrent`'s switch. It went red naming
exactly `["sketch"]`, and immediately caught a second bug — the new `quotes` projection took `tree`
while `REVISION_READ_POLICY` had not listed it.

**Finding 4 — stale comments** in `source-hash.ts` and `artifacts.ts` corrected; every
"renamed article" now says "the extracted title changed".

**Also in this diff — stage 1b's `sendSource`.** The last ungated route. A new `SourceStore` seam in
`contracts.ts`, selected in `index.ts` like every other store: `fsSourceStore` in `artifacts-fs.ts`,
`pgSourceStore` in the new `pg-source.ts`. `readPdf`, not `readSource`, because the content type is
the security boundary. `node:fs` and `node:path` are gone from `routes.ts` and a test says they stay
gone. **Caveat: that agent died mid-way through mutation-testing its own assertions**, so I do not
yet know its Postgres tests can go red. Please treat those tests as unproven and say whether they
would actually fail if the implementation were wrong.

## The new question — a cross-session interaction I did not design

Another session raised `SANITIZER_VERSION` from **3 to 4** in `src/sanitize-policy.ts` while this
work was in flight, newly forbidding `hit`, `data-hit` and `data-hues`.

What I have verified:

- `blocksArtefact` stamps `sanitizer: SANITIZER_VERSION` and sanitises on write
  ([`src/blocks.ts`](../../src/blocks.ts)).
- `sanitizeStoredBlocks` re-cleans and reports `stale` **only when called**
  ([`src/sanitize.ts`](../../src/sanitize.ts)).
- **Neither `artifacts-fs.ts` nor `artifacts-pg.ts` calls it** — so `store.read(slug,"blocks","blocks")`
  returns blocks exactly as written, at whatever version stamped them.

So my guard compares stored blocks (written at v3) against `splitIntoBlocks(extracted)` (sanitising
at v4). For any article whose HTML carries a newly-forbidden attribute, `canonicalBlock` differs and
the guard reports **not current**, re-running stage 3 across much of the corpus on first read.

**My reading, which I want tested rather than confirmed:** this is benign or even correct — the
stored blocks genuinely *are* stale under the stricter policy, stage 3 makes no model call, and
`assertIdsCarried` keeps the ids. But it couples block freshness to sanitiser version implicitly,
which nobody designed, and I would rather you told me it is wrong now than discover it after the
flip. Specifically:

1. Is the mass re-run safe, given `assertIdsCarried` now refuses loudly when ids do not carry?
   Could a sanitiser change alter enough of a block's text to make the id matcher fail, turning a
   policy bump into a **refused job** on real articles?
2. Should the guard read the sanitiser stamp explicitly instead of discovering the difference
   through byte comparison?
3. Is there a state where the two versions disagree *silently* — the guard saying current when the
   stored blocks are dirty under the new policy?

## Also

- Anything the fixes got wrong, or a fourth direction the guard still misses.
- Anything in the diff that is not stage 1a/1b's business (you caught `src/types.ts` last time; my
  scoping is now a whitelist, but check me).
- Anything that will still break at the flip.

Be specific: file, line, the concrete state that fails. Say plainly where you are uncertain.
