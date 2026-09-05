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
import type { Block, Meta, Tree } from "./types.js";

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
 * widen the query. docs/plans/260827am-glossary-read-latency.md.
 *
 * ## Four fields since 2026-08-28, and the last two are nullable on purpose
 *
 * `role` and `treatment` joined because **assigning a role changes no text and
 * no range**. Without them, the day footnotes were classified, every summary,
 * idea, glossary entry, tweet thread, vector set and similarity artefact
 * computed *before* the split would have gone on reporting itself current —
 * with the article's summary silently written over its own bibliography and
 * every freshness check agreeing that nothing needed redoing. That is the
 * finding no earlier review caught; docs/plans/260828o-footnotes.md § Reclassification
 * must invalidate the caches.
 *
 * `null` as well as `undefined` because the filesystem store carries an absent
 * field and Postgres carries a null column, and the two must hash identically —
 * see the normalisation in `hashBlocks`.
 *
 * And `string`, not the two unions off `Block`. What is being fingerprinted is
 * the *text* of the classification, and the narrow Postgres reads select a
 * `text` column whose domain is enforced by a CHECK constraint, not by this
 * type. (`checkNoteFields` used to be named here as a second enforcer; it was
 * deleted unused on 2026-09-01 — docs/plans/260831b-finish-the-database-move.md
 * § Stage 4.) Narrowing here would buy a
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
 * (docs/plans/260828o-footnotes-stage345-upfront-sol.md, decision 5).
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
     **Ordinary extraction reaches it now, and that is the point of the
     guard.** This paragraph used to say the opposite — "ordinary extraction
     cannot reach it, `extractText` in src/blocks.ts collapses whitespace, and
     across data/ not one of 890 blocks in 8 articles carries a tab or a
     newline" — and that stopped being true on 2026-09-05, when `extractText`
     grew a `<pre>` branch so that a code block keeps its lines. Every
     code-bearing article now takes the framed form. Nothing had to change here,
     which is the whole argument for having written the guard rather than
     relying on the normalisation: it was defended as insurance against a second
     importer, and what actually arrived was a change to the first one. The
     consequence is a fingerprint change on every article with a `<pre>` — ids
     carry, so nothing is orphaned, but derived artefacts recompute; see
     docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § A.
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
 * docs/plans/260826ac-ideas-mode.md § Freshness.
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

/**
 * The three metadata fields a prompt head is allowed to be judged on.
 *
 * **Named as a type, and narrow on purpose.** `Meta` carries `fetchedAt`,
 * `rawSha256`, `url` and more, and every one of them is a field a caller could
 * pass by accident. Folding `fetchedAt` in would mark every artefact stale on
 * every re-fetch of an unchanged page — a paid re-run bought for nothing — and
 * the type is what stops that being one careless spread away. A `Pick` also
 * makes the call sites that rebuild a `Meta` out of database columns
 * (src/store/pg.ts) say exactly what they are answering for.
 */
export type MetaFingerprint = Pick<Meta, "title" | "byline" | "siteName">;

/**
 * The same three fields **and the URL**, for the stages whose head prints one.
 *
 * `articleWithIds` (src/article-prompt.ts) emits a fourth line, `URL:`, that
 * `articleText` does not — so `ideas` and `sketch` send bytes the other four
 * never send, and a fingerprint that ignored the URL let a redirect rewrite the
 * prompt while the hash stood still. It is a separate type rather than a
 * widened one so that the four stages whose head has no URL line cannot be
 * judged on a field the model was never shown.
 */
export type MetaFingerprintWithUrl = MetaFingerprint & Pick<Meta, "url">;

/**
 * The title `articleWithIds` will actually print when there is no `meta.json`.
 *
 * **Exported so the stage and its fingerprint cannot spell it differently.**
 * `generateIdeas` and `generateSketch` do not skip the head when metadata is
 * absent — they synthesise one out of the tree's slug, because a stage that
 * silently rendered a different head would silently send uncacheable bytes. The
 * fingerprint has to resolve the identical fallback or the two sides describe
 * different prompts, and `structureHash` cannot help: it hashes node ids,
 * ranges, titles and gists, and not `tree.slug`. Two copies of this one line
 * were the whole of GPT Sol's third finding.
 */
export function fallbackHeadTitle(tree: Tree): string {
  return tree.slug;
}

/**
 * What an article-reading stage was written from: its **prose, its shape and
 * its head**.
 *
 * **For the stages that send `articleText`** — `arc`, `tweets`, `glossary`,
 * `summary`, and `quotes` since it arrived. The two that send `articleWithIds`,
 * `ideas` and `sketch`, use `articleWithIdsFingerprint` below: their head has a
 * fourth line and a fallback title, so it is a different question and hashing
 * it with this one let a redirect or a re-slug move the prompt while the hash
 * stood still (GPT Sol, 2026-08-31).
 *
 * It began in src/arc.ts, which is where it was first got right, and moved here
 * when the others were completed against it. The canonical string is unchanged
 * from arc's, deliberately: every `arc.json` on a shelf today was hashed with
 * it, and a rename of the domain string would mark all of them stale to no
 * purpose.
 *
 * **Why each third is here.**
 *
 * - **The blocks**, because they are the article.
 * - **The tree**, because section boundaries move without a single block
 *   changing, and every one of these prompts is built out of the skeleton —
 *   `structureHash` covers the titles and the gists too, so a reworded gist is
 *   a different question at identical ranges.
 * - **The metadata**, because `articleText` and `articleWithIds` both put
 *   `TITLE:`, `BY:` and `PUBLISHED IN:` at the head of the prompt
 *   (src/article-prompt.ts). Those three are **stage 2's** reading of the page
 *   and they move whenever it is re-extracted — a publisher editing a headline,
 *   or Readability choosing differently — so a changed head is reachable rather
 *   than theoretical.
 *
 *   **Not the reader's own rename**, which earlier versions of this note cited
 *   and which is a different thing entirely: that is a shelf override
 *   (`shelf.json`, `articles.title_override`) and no generator reads it —
 *   src/shelf.ts says why it is kept out of `meta.json`. GPT Sol, 2026-08-31.
 *   The metadata half was raised on 2026-08-29;
 *   docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 2.1.
 *
 * **The one line it knowingly does not cover.** `articleWithIds` emits a
 * fourth head line, `URL:`, which `articleText` does not — so for `ideas` and
 * `sketch` this is one line short of the bytes actually sent. Left out because
 * the URL is an attribution line rather than part of the argument, and because
 * covering it would make every call site that rebuilds a `Meta` from columns
 * responsible for a field none of them carries today: a fingerprint they could
 * silently under-fill is worse than one that is honestly one line narrow.
 * Recorded here so the next reader does not have to work it out again.
 *
 * `null` for an absent meta is a different canonical string from a meta whose
 * fields are all empty, which is correct — they are different states, and a
 * stage may legitimately run before extraction has a title.
 */
export function articleFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprint | null,
): string {
  /* JSON, not a delimiter join, and for the reason this module sets out at
     length above: title, byline and siteName are the page's own text, so any
     unescaped separator is a collision waiting for the page that contains it. */
  const head = meta
    ? JSON.stringify([meta.title ?? "", meta.byline ?? "", meta.siteName ?? ""])
    : "none";
  return withMetaHash(blocks, tree, "spya-arc-meta/1", head);
}

/**
 * The same fingerprint for the two stages that send **`articleWithIds`** —
 * `ideas` and `sketch`.
 *
 * Two differences from `articleFingerprint`, and both are differences in the
 * bytes those prompts actually carry rather than refinements:
 *
 * - **The URL.** `articleWithIds` prints a `URL:` line; `articleText` does not.
 * - **The fallback title.** With no metadata these two synthesise
 *   `TITLE: <tree.slug>` rather than omitting the head, so "no metadata" is not
 *   one input here — it is one input *per slug*. Resolved through
 *   `fallbackHeadTitle` above, which is the same function the stages call, so
 *   the writing side and the checking side cannot drift.
 *
 * Its own canonical domain, so the two families can never be compared by
 * accident. Every `ideas.json` and `sketch.json` already on a shelf is stale
 * against this and regenerates once, which is correct: they were stamped
 * against a question narrower than the one they were asked.
 */
export function articleWithIdsFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  const head = JSON.stringify([
    meta?.title ?? fallbackHeadTitle(tree),
    meta?.byline ?? "",
    meta?.siteName ?? "",
    meta?.url ?? "",
  ]);
  return withMetaHash(blocks, tree, "spya-ids-meta/1", head);
}

/**
 * The `articleWithIds` head **and the publication date**, for a stage that
 * names it.
 *
 * A third type rather than a fourth field on `MetaFingerprint`, and that is the
 * whole design of this module rather than a preference: a stage is judged on
 * the bytes its prompt actually carries. `articleText` prints `TITLE:`, `BY:`
 * and `PUBLISHED IN:`; `articleWithIds` prints a `URL:` line as well; and
 * Timeline prints the publication date, *named as the reference frame*, because
 * the year is the thing the piece never writes down
 * (docs/plans/260831i-timeline-mode.md § What the model is shown). Folding the date
 * into `MetaFingerprint` would have judged `arc`, `tweets`, `glossary`,
 * `summary` and `quotes` on a line none of their prompts contains — the same
 * mistake as folding in `fetchedAt`, which that type's own note exists to
 * prevent — and it would have done it loudly: the date arrives by
 * **re-extraction**, so the first article re-extracted would mark all five of
 * its artefacts stale and re-run five paid stages for bytes no model saw.
 *
 * Built on the `WithUrl` head rather than the three-field one because a stage
 * that dates events has to cite the blocks they came from, and a prompt with
 * block ids in it is `articleWithIds`. A future dated stage that sends
 * `articleText` instead needs its own domain string, not this one.
 *
 * The date is **load-bearing here, not defensive**. It is the reference frame
 * for nineteen of the twenty-four temporal expressions on the test article, so
 * a publisher re-dating a post changes almost every row of the output. That is
 * the first stage where the metadata's presence in the hash is obviously right
 * rather than a hole being closed.
 */
export type MetaFingerprintDated = MetaFingerprintWithUrl & Pick<Meta, "publishedAt">;

export function datedArticleFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintDated | null,
): string {
  const head = JSON.stringify([
    meta?.title ?? fallbackHeadTitle(tree),
    meta?.byline ?? "",
    meta?.siteName ?? "",
    meta?.url ?? "",
    /* An absent date is a real, common state and not an empty one — almost
       every article on the shelf predates the field — but it hashes as `""`
       all the same, which is right: what the prompt carries is the same "no
       frame given" line either way. What must not happen is a date being
       *present* without changing the hash. */
    meta?.publishedAt ?? "",
  ]);
  return withMetaHash(blocks, tree, "spya-dated-meta/1", head);
}

/** The blocks, the tree, and a head canonicalised by whichever caller owns it. */
function withMetaHash(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  domain: string,
  head: string,
): string {
  return `${hashBlocks(blocks)}.${structureHash(tree)}.${createHash("sha256")
    .update(`${domain}\n${head}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
}
