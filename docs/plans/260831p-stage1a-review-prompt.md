# Review: stage 1a of the files→Postgres migration, as built

Review **built code, not a plan**. Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`.
Nothing is committed yet; this review decides whether it gets committed.

You have reviewed this migration twice and returned NO-SHIP both times
(`docs/plans/260830aq-late-steps-read-the-store-review-sol.md`,
`docs/plans/260831b-finish-the-database-move-review-sol.md`). Both verdicts were accepted, and the plan was
restaged to your recommended order. This is the first stage of that restaging.

## The evidence

**The scoped diff — 32 files, 1574 insertions, 351 deletions:**
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/e9d59148-0422-4f78-824d-44c35b090da5/scratchpad/stage1a.diff`

That diff is scoped to this stage's files only. Several other agents are working this tree; changes
to `src/auth.ts`, `src/vercel-health.ts`, `src/spend-declarations.ts`, `evals/*`, `.env.example`,
`docs/project/auth.md` and `docs/project/security.md` are **theirs, not part of this review**.

The plan: `docs/plans/260831b-finish-the-database-move.md` § The stages § Stage 1.

## What stage 1a was asked to do

Two guards, no switchover, reads still on the filesystem.

1. **Complete every stage's fingerprint.** `tweets`, `glossary`, `summary` hashed only the blocks
   but their prompts also read the tree and the metadata; `ideas` and `sketch` omitted the metadata.
   Harmless while reads return `null`; once reads succeed, an incomplete stamp lets a **stale
   artefact skip**. `src/arc.ts` § `inputFingerprint` was the worked example.
2. **Replace `htmlCarriesItsIds`**, which works today only because
   `extract.extractedHtml` and `blocks.stampedHtml` resolve to the same file on disk, and returns
   `true` unconditionally once they become separate Postgres columns.

## What was built (the agent's own account — verify it, do not trust it)

- `htmlCarriesItsIds` → **`blocksMatchTheirHtml`**: the old id-membership check, **plus** a
  comparison that `stampedHtml` and `extractedHtml` describe the same article, by parsed visible
  text. Text rather than markup because stage 3 writes `dom.serialize()`, so a healthy pair differs
  by entity decoding, attribute quoting and `retargetAnchors` hrefs. Claimed measurement: raw-markup
  and regex tag-stripping both call a healthy pair stale; parsed text does not. Cost 20 ms at 73 KB,
  208 ms at 693 KB, short-circuiting on identical strings so only Postgres pays.
- New **`articleFingerprint`** in `src/source-hash.ts` (arc's body moved, canonical string
  unchanged so existing arcs stay current), plus `MetaFingerprint = Pick<Meta, "title"|"byline"|"siteName">`.
  All six article-reading stages use it; `assets` deliberately keeps blocks-only.
- **The write side had to move with the read side**: each generator now writes the wider hash, plus
  every `isStale` caller in `src/api.ts` and `src/store/pg.ts`, and
  `REVISION_READ_POLICY`/`REVISION_PROJECTIONS`, with a new `FINGERPRINT_COLUMNS` and
  `metaFingerprintOf`.
- **A self-caught near-miss:** `generateIdeas`/`generateSketch` fall back to a stub `{ title: tree.slug }`
  when `meta.json` is missing. Hashing the stub would write a fingerprint the stamp (which hashes
  `null`) can never produce — every article without metadata stale for ever, looking healthy. They
  now hash `onDiskMeta`.
- **`src/store/import.ts` stamped every step row with `hashBlocks`**, which `stampForStep` rejects
  via `StampDisagrees` — claimed to have been *already* broken for `arc`, `ideas` and `sketch`. Now
  copies each artefact's own `sourceHash`; `toc` deliberately keeps the blocks hash for
  `reasonsNotToPublish`.

## What I want from you

1. **Is `blocksMatchTheirHtml` actually sound?** Does it detect what the old one could not, and can
   it **over-fire** — call a healthy pair stale and force a needless stage-3 re-run? Is parsed
   visible text the right comparison, or is there a cheaper or more exact one? What states can still
   slip past it? The agent notes it is membership rather than binding, and that a markup-only
   re-extraction reads as unchanged — is that acceptable for stage 1, given a generation token needs
   somewhere to live and `STAMP_SOURCE` has no `blocks` entry?

2. **Did the fingerprint widening miss anything, or break anything?** Especially: is there any call
   site where a **stamp can never equal a stored hash**, which is the near-miss above generalised?
   The two sides are now computed in more places; find where they can disagree.

3. **A deliberate gap I want adjudicated.** `articleWithIds` emits a fourth head line, `URL:`, that
   `articleText` does not, so `ideas` and `sketch` fingerprints are one line short of the bytes
   actually sent. The agent excluded it on the grounds that the URL is attribution rather than
   argument, and that including it would make every Postgres call site rebuilding a `Meta` from
   columns responsible for a field none of them carries. **Right call or not?**

4. **The importer change.** Is copying each artefact's own `sourceHash` correct, and is `toc`
   keeping the blocks hash for `reasonsNotToPublish` right? Note the importer is deleted at stage 3
   — does that make this change unnecessary, or is it needed for the stages in between?

5. **Anything here that will break at stage 3**, when reads move to Postgres and the flip happens.
   This stage exists to make that safe; tell me if it has failed to.

6. Anything factually wrong in the agent's account above, and anything in the diff that is not
   stage 1a's business and should be pulled out before commit.

Be specific: file, line, the concrete state that fails. Say plainly where you are uncertain.
