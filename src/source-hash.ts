/**
 * A fingerprint of the article a generated artefact was written from.
 *
 * **Why this is its own module.** It began life inside src/tweets.ts, where it
 * answered the one question the original version of that feature could never
 * answer: does this thread still describe the article on disk? The glossary
 * needs exactly the same answer, and two stages computing "the same" hash two
 * ways is the second-copy-of-one-fact problem this repo keeps meeting — the two
 * can only ever disagree, and the day they do, one artefact quietly reports
 * itself current against a different definition of current.
 *
 * So it lives here, on its own, and both stages import it. src/tweets.ts
 * re-exports it so nothing that already imported it from there had to change.
 *
 * See docs/project/architecture.md#storage.
 */
import { createHash } from "node:crypto";
import type { Block, Tree } from "./types.js";

/**
 * The ids **and** the text, not the raw bytes of blocks.json.
 *
 * Bytes would change when a field we don't read is recomputed, and would not
 * change if two blocks swapped ids — this changes exactly when what a reader
 * would read changes, which is the only question it is asked.
 *
 * Sixteen hex characters. It is compared for equality, never for closeness, and
 * a full sha256 in every artefact buys nothing but width.
 *
 * **The parameter is the two fields it reads, not `Block`.** Every `Block[]`
 * still satisfies it, so nothing had to change; what it buys is that the
 * Postgres store can hash `select block_id, text from revision_blocks` without
 * inventing a second canonical form — which is the one thing this module exists
 * to prevent. src/store/pg-searches.ts is the caller that needed it.
 */
/**
 * **What a fingerprint of the article actually needs**, which is two fields.
 *
 * Named rather than spelled out at each caller, because the four staleness
 * checks that use it are also the four reads that had been fetching every
 * column of every block row to compute it — including the block HTML and a
 * generated tsvector — and then throwing all of it away (`blockHashInputs` in
 * src/store/pg.ts). A signature taking the whole `Block` is what let that
 * happen quietly: the narrow row would not typecheck, so the obvious fix was to
 * widen the query. docs/plans/glossary-read-latency.md.
 *
 * ## Four fields since 2026-08-28, and the last two are nullable on purpose
 *
 * `role` and `treatment` joined because **assigning a role changes no text and
 * no range**. Without them, the day footnotes were classified, every summary,
 * idea, glossary entry, tweet thread, vector set and similarity artefact
 * computed *before* the split would have gone on reporting itself current —
 * with the article's summary silently written over its own bibliography and
 * every freshness check agreeing that nothing needed redoing. That is the
 * finding no earlier review caught; docs/plans/footnotes.md § Reclassification
 * must invalidate the caches.
 *
 * `null` as well as `undefined` because the filesystem store carries an absent
 * field and Postgres carries a null column, and the two must hash identically —
 * see the normalisation in `hashBlocks`.
 *
 * And `string`, not the two unions off `Block`. What is being fingerprinted is
 * the *text* of the classification, and the narrow Postgres reads select a
 * `text` column whose domain is enforced by a CHECK constraint and by
 * `checkNoteFields` on import, not by this type. Narrowing here would buy a
 * cast at each of those three call sites and nothing else — every `Block[]`
 * still satisfies it, which is the property this whole type exists for.
 */
/**
 * The characters that make a delimiter-joined canonical form ambiguous.
 *
 * A tab or a newline for `hashBlocks`, a NUL or a newline for `structureHash` —
 * asked as one question, because the two legacy forms are the same mistake and
 * a fingerprint that is safe under one set and not the other would be a third
 * thing to keep straight. Any field carrying one routes its whole artefact to
 * the framed form, where JSON escapes it and the question does not arise.
 */
const AMBIGUOUS = /[\t\n\u0000]/;

export type BlockFingerprint = Pick<Block, "id" | "text"> & {
  role?: string | null;
  treatment?: string | null;
};

/**
 * The corpus that predates roles hashes **byte for byte** as it did before.
 *
 * Not "omit the absent fields": this function is not JSON serialisation, it
 * builds `id \t text` by hand, so there is nothing to omit *from* and a
 * conditional field would still change the separators. It needs an explicit
 * branch, which is GPT Sol's correction to the plan
 * (docs/plans/footnotes-stage345-upfront-sol.md, decision 5).
 *
 * So: every block nullish on both axes ⇒ the legacy algorithm, unchanged, and
 * today's whole corpus keeps its fingerprints rather than being mass-invalidated
 * into re-running every paid stage. Any block carrying either ⇒ a versioned,
 * framed representation of all four.
 *
 * **`JSON.stringify` over fixed-position arrays, not delimiters.** The first
 * version of this used U+0000 between fields and U+0001 between blocks, on the
 * reasoning that the legacy tab-and-newline form was ambiguous and that control
 * codepoints would not occur in prose. That is not a framing, it is a rarer
 * delimiter: GPT Sol built two *different* classified articles with the same
 * fingerprint by putting the delimiters into a block's own text, and I
 * reproduced it (`69c5527dd4b70843` from both, before the fix). Nothing about a
 * block's text is under our control — it is whatever the page said — so any
 * unescaped separator is a collision waiting for a page that contains it, and a
 * fingerprint collision means two different articles agreeing that neither has
 * changed. JSON escapes, so the question does not arise. The version prefix
 * means the three forms can never collide with each other either.
 */
export function hashBlocks(blocks: readonly BlockFingerprint[]): string {
  /* `!= null` catches both spellings of absent in one test. Deliberately not
     truthiness: an empty-string role is not a role, but it is also something no
     writer produces, and reading it as "legacy" would put a role-bearing
     article on the old branch. */
  const classified = blocks.some((b) => b.role != null || b.treatment != null);
  /* **And the legacy branch is taken only when it is unambiguous.** Its
     delimiters are a tab between the two fields and a newline between blocks,
     and `text` is the article's own prose — so a block whose text contains
     either is a block that can be re-read as a different list of blocks. One
     block of `a\nb2\tc` and the two blocks `a` and `c` produce the identical
     canonical string, and did produce the identical fingerprint
     (`88b65f848068e592` from both, before this line). Two different articles
     each reporting that nothing has changed is the whole failure this function
     exists to prevent.
     Ordinary extraction cannot reach it — `extractText` in src/blocks.ts
     collapses whitespace, and across data/ not one of 890 blocks in 8 articles
     carries a tab or a newline — but imported blocks do not go through it, and
     a guard that depends on a normalisation two modules away is a guard that
     ends the day a second importer is written. Routing the ambiguous input to
     the framed form costs nothing on the corpus, by that same measurement.
     GPT Sol, 2026-08-29, who also caught that a compatibility test comparing a
     hash against a clone of its own input is tautological — the pin in
     tests/supplement.test.ts is the literal hex. */
  const ambiguous = blocks.some((b) => AMBIGUOUS.test(b.id) || AMBIGUOUS.test(b.text));
  const canonical =
    classified || ambiguous
      ? `spya-blocks/3\n${JSON.stringify(
          blocks.map((b) => [b.id, b.text, b.role ?? "", b.treatment ?? ""]),
        )}`
      : blocks.map((b) => `${b.id}\t${b.text}`).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/**
 * A fingerprint of the **tree** — every node's id, parent, range, title and
 * gist.
 *
 * The companion to `hashBlocks`, and here for the identical reason: it began in
 * src/labels.ts (which re-exports it, so nothing that imported it from there
 * had to change) and a second stage now needs the same answer. Two modules
 * computing "the same" structure hash two ways can only ever disagree, and the
 * day they do, one artefact reports itself current against a different
 * definition of current.
 *
 * **Not `renderOutline`'s text.** The outline is titles and indentation, which
 * is the right thing to send a model and the wrong thing to compare two trees
 * by: two structures that cut the article in completely different places print
 * an identical outline. Walking the nodes means a boundary that moved changes
 * the hash even when every title stayed put. That correction was GPT-5.6-sol's,
 * 2026-08-26.
 *
 * **Why a second hash exists at all**, which is the thing to read before
 * ignoring it: `StepStamp` in src/store/artifacts.ts says the late stages
 * *"all read the tree as well as the blocks"*, and `inputHashFor` in
 * src/pipeline.ts hashes only the blocks. Section boundaries can move without a
 * single block changing, and a stage that judges what is load-bearing from the
 * skeleton is then answering a different question against an input it reports
 * as unchanged. `ideas` is the first stage to fold this in — see
 * docs/plans/ideas-mode.md § Freshness.
 */
/*
 * **A tree with no supplement node hashes byte for byte as it did before**, and
 * for the same reason `hashBlocks` above has a legacy branch: today's whole
 * corpus predates the supplement node (2026-08-28), and folding a sixth field
 * into the canonical form unconditionally would invalidate every `labels.json`,
 * `ideas.json` and similarity artefact on disk at once — a mass re-run of paid
 * stages bought for nothing, since not one of those trees has apparatus in it.
 * `5bb2ef0284bce2cd` over `example/tree.json`, computed before this stage was
 * written and pinned in tests/supplement.test.ts.
 *
 * The supplemented branch is framed the way `hashBlocks` is, and for the
 * identical reason: `title` and `gist` are model prose, so an unescaped
 * delimiter is a collision waiting for the article that contains it. Keyed on
 * the **tree** rather than per node, so one hash never mixes the two forms.
 */
export function structureHash(tree: Tree): string {
  const ids = Object.keys(tree.nodes).sort();
  const supplemented = ids.some((id) => tree.nodes[id]!.treatment != null);
  const row = (id: string): string[] => {
    const n = tree.nodes[id]!;
    return [id, n.parent ?? "", n.range.join(".."), n.title ?? "", n.gist ?? ""];
  };
  /* Same conditional as `hashBlocks`, and the same reason. The legacy form
     joins the five fields with U+0000 and the rows with a newline, and `title`
     and `gist` are model prose — so a title carrying a NUL can be re-read as a
     title and a gist that were split somewhere else. GPT Sol built the pair;
     so did I: `A<NUL>B` + `C` and `A` + `B<NUL>C` both hashed
     `1eff068c824dec8b`.
     `range.join("..")` needs no such guard — a block id contains no dot, which
     is the block-id contract itself (docs/project/block-ids.md). */
  const ambiguous = ids.some((id) => row(id).some((f) => AMBIGUOUS.test(f)));
  const canonical =
    supplemented || ambiguous
      ? `spya-tree/2\n${JSON.stringify(ids.map((id) => [...row(id), tree.nodes[id]!.treatment ?? ""]))}`
      : ids.map((id) => row(id).join("\u0000")).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}
