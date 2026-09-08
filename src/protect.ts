/**
 * Stage 2, before Readability — **the pass that tells Readability something is
 * content, in Readability's own vocabulary.**
 *
 * It is the mirror image of src/furniture.ts. That module deletes what the
 * publisher labelled as chrome; this one deletes nothing, moves nothing and
 * rewrites no text. It adds **class tokens**, and Readability reads the class
 * attribute in order to answer exactly the question we are answering.
 *
 * ## What it is for, and it is two losses rather than one class of loss
 *
 * Both were diagnosed by a spike before anything was designed, and the
 * diagnosis is in
 * docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md
 * § *The diagnosis, 2026-09-08* and § *C3, rewritten 2026-09-08*.
 *
 * | the branch that deletes | what rescues it | which loss |
 * |---|---|---|
 * | `unlikelyCandidates` in the node-prep walk (Readability.js:1119) | `okMaybeItsACandidate` matching the same string | four data tables |
 * | `_cleanConditionally`'s *"Low weight and a little linky"* (`weight < 25 && linkDensity > 0.2`) | `_getClassWeight` ≥ 25, i.e. a `positive` class token | the PLOS correction notice |
 *
 * The first is an **ordering** accident with a sharp edge: a table is deleted
 * at line 1127 for having the substring `header` somewhere in its class
 * attribute, 385 lines before `_markDataTables` — the pass whose `rows >= 10`
 * rule exists to protect a 223-row table — is ever called. LaTeXML writes
 * `ltx_guessed_headers` **exactly when it inferred header cells**, and
 * MediaWiki writes `sticky-header-multi` on a sortable data table, so both
 * publishers mark their most table-like tables with the token Readability reads
 * as furniture.
 *
 * ## Two tokens, one job each — and this must not be collapsed back into one
 *
 * - `spya-keep-column` matches `okMaybeItsACandidate` (via `column`) and is
 *   deliberately **not** in `positive`, so it defeats the deletion at line 1127
 *   and changes no class weight. **Rule A uses this one.**
 * - `spya-keep-content` matches `positive` (via `content`), so it takes an
 *   element's class weight from 0 to 25. **Rule B uses this one, because weight
 *   is the whole of its mechanism.**
 *
 * The first draft of this pass used one shared token for both jobs, on the
 * observation that `okMaybeItsACandidate` and `positive` both contain
 * `content`. **That was a P0**, and GPT Sol reproduced it rather than arguing
 * it: a `positive` token does not only defeat a deletion, it adds 25 to the
 * element's class weight, and a `<table>` is scored as a candidate ancestor
 * because its `<td>`s are in `elementsToScore`. On a constructed qualifying
 * table with genuine prose either side:
 *
 * | token on the table | result |
 * |---|---|
 * | `spya-keep-column` | the table is a table, both prose regions survive |
 * | `spya-keep-content` | **both prose regions gone**, the table promoted to top candidate and rewritten as a `<div>` |
 *
 * **No fixture in the corpus has that score topology**, which is why a corpus
 * run looked clean, and it is why tests/extract-protect.test.ts carries a
 * synthetic boundary case per token that pins the difference. Never use
 * `spya-keep-content` on a table.
 *
 * **The left-hand row is a reading of one table, and it does not generalise.**
 * That synthetic has twelve body rows; take the same page to twenty-four and
 * `spya-keep-column` produces the right-hand row as well — table flattened into
 * a `<div>`, both prose regions gone. The token really does move no score, and
 * the difference between the rows is real at the size it was measured at; what
 * is not true is that a weightless token makes a rescue safe. **A rescued table
 * is a table that gets scored**, and on a page whose prose is thin beside it,
 * `<td>`s alone win candidacy. What keeps that from being a reason to narrow
 * rule A is that it is not ours: the identical page with `class="wikitable
 * sortable"` — a string Readability never disliked, so nothing here is stamped —
 * loses exactly the same four paragraphs at exactly the same row count. This
 * pass hands a page the extraction it would have had if the publisher had not
 * written `header`, and that includes the bad ones. Both readings are pinned in
 * tests/extract-protect.test.ts § *the adversarial set*.
 *
 * ## Rule A — and the false positive that shrank it
 *
 * **What was proposed first**: stamp any `<table>` that trips
 * `unlikelyCandidates` without matching `okMaybeItsACandidate`, and that is a
 * data table by a mirror of Readability's `_markDataTables`. **Both halves were
 * wrong.** The rule as written stamped
 * `<table class="sidebar sidebar-collapse nomobile nowraplinks hlist">` in
 * `wiki_ar_ai.html` — 61 links, *"Part of a series on Artificial
 * intelligence"*, a taxonomy of topic links — because `sidebar` is itself in
 * `unlikelyCandidates` and **a navigation sidebar has header cells**. Its twin
 * in `wiki_transformer.html` is the same shape, saved only by the
 * `role="navigation"` the Arabic one happens to lack.
 *
 * So there is **no data-table heuristic here, no row or column arithmetic, and
 * no call to Readability's private `_markDataTables`**. A data-table test is
 * not entitled to overrule the publisher's explicit `sidebar` declaration —
 * `_markDataTables` exists to decide whether a table wants accessibility
 * treatment, not to adjudicate furniture, and asking it the second question is
 * asking one it was never written to answer. Both Wikipedia sidebars are
 * standing negatives in the test file.
 *
 * The rule is therefore: **`header` must be the *sole* reason the table matches
 * `unlikelyCandidates`**, and it must carry a non-empty `<caption>` or at least
 * one `<th>` of its own. All four target tables have one, so the arithmetic is
 * never needed.
 *
 * ## Rule B — the measured topology and nothing else
 *
 * `div.amendment-citation` goes on *"Low weight and a little linky"*
 * (`weight=0`, `linkDensity=0.291`, bar `0.2`), the density coming from the
 * citation printing its own DOI as link text; the emptied parent
 * `div.amendment.amendment-correction` then goes on *"No useful content"*,
 * taking `<h2>Correction</h2>` with it. A reader of that paper is never told it
 * was corrected.
 *
 * **Stamping either alone recovers nothing** — confirmed three ways: parent
 * alone, child alone, both. With both at weight 25 the bar becomes
 * `linkDensity > 0.5` and the parent's 0.276 clears it.
 *
 * **There is no registry, and there are no other tokens.** `correction`,
 * `erratum` and `retraction` were proposed and rejected. The defence offered
 * for the width was that a wrong match only *keeps* a block, which Greg has
 * priced as *"a bit of junk in the structure that's getting ignored"*. That
 * argument is false and was falsified rather than disputed: **candidate
 * selection is global**, and a constructed `div.correction` given positive
 * weight became the preferred candidate and dropped neighbouring genuine
 * paragraphs. A wrong positive stamp can delete an author's prose somewhere
 * else on the page. Another publisher's correction notice gets added when
 * somebody has a fixture for its actual topology, positive and adversarial.
 *
 * ## What this is not, and what it does not fix
 *
 * **It is not a trick played on the library.** Adding a class token that says
 * *content* is the sentence Readability reads the class attribute in order to
 * hear. The token never reaches the reader: `keepClasses` defaults to `false`,
 * so it is stripped with every other class.
 *
 * **It adds no forgery surface.** A hostile page can already write
 * `class="content"` on its own junk for the identical effect — that is
 * Readability's behaviour, not something introduced here — so a page
 * pre-placing our token buys nothing it did not have. Recorded rather than
 * guarded, and the reserved-namespace scrub (src/reserved.ts) is deliberately
 * **not** extended to it.
 *
 * **Four tables, and the corpus loses roughly 77.** Only six died on line 1127
 * at all, and only four qualify under the narrow rule. This does not make
 * *"tables survive"* true generally and must not be quoted as though it did.
 * The navboxes stay out too: they carry no unlikely token of their own and die
 * on their wrapper's `role="navigation"`, which no stamp on a table can reach.
 */

/**
 * Counts of what was stamped, per rule, keyed by the rule names in `RULES`.
 *
 * **A rule that matched nothing is absent, not zero**, for the reason
 * `FurnitureRemovals` (src/furniture.ts) gives: zero and absent are the same
 * fact, and an object of zeroes on every page in the library would make the one
 * page where something *was* stamped harder to see rather than easier.
 *
 * The unit is **elements stamped**, not notices found — so the PLOS correction
 * counts 2, because both the outer `div` and its citation child are stamped and
 * stamping either alone recovers nothing.
 */
export type KeptStructure = Readonly<Record<string, number>>;

/**
 * The token for rule A. In `okMaybeItsACandidate` via `column`, in neither
 * `positive` nor `negative` — so it defeats the deletion at Readability.js:1127
 * and moves no score. tests/extract-protect.test.ts asserts all three.
 */
export const KEEP_COLUMN = "spya-keep-column";

/**
 * The token for rule B. In `positive` via `content`, which takes
 * `_getClassWeight` from 0 to 25 — the whole of rule B's mechanism, and the
 * reason it must never be put on a table.
 */
export const KEEP_CONTENT = "spya-keep-content";

/** The keys of `KeptStructure`, so a caller can name one without a string. */
export const RULES = {
  /** Rule A — a data table Readability deletes for saying it has headers. */
  headerNamedTable: "a-table-called-header",
  /** Rule B — the PLOS correction notice, outer div and citation child. */
  correctionNotice: "an-amendment-correction",
} as const;

/**
 * **Copied from `@mozilla/readability` 0.6.0**, `Readability.prototype.REGEXPS`.
 *
 * Copied rather than read off the prototype at runtime, because reaching into
 * a library's private table is a dependency on something it never promised.
 * The copy is pinned instead: tests/extract-protect.test.ts asserts `.source`
 * equality against the live prototype, so a version bump that moves either
 * regex fails at test time rather than degrading quietly in production.
 */
export const UNLIKELY_CANDIDATES =
  /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i;

/** Copied from `@mozilla/readability` 0.6.0 — see `UNLIKELY_CANDIDATES`. */
export const OK_MAYBE_ITS_A_CANDIDATE = /and|article|body|column|content|main|shadow/i;

/**
 * **`unlikelyCandidates` with its one `header` alternative taken out**, which is
 * the *sole* rule stated directly: an element is only this pass's business if
 * `header` is the one unlikely term in its class and id.
 *
 * Derived from the copy above rather than typed out again, so the two cannot
 * drift; `tests/extract-protect.test.ts` pins the derivation, and pins that the
 * result still declines `header` and still accepts `sidebar` and `related`.
 *
 * **This replaced a substitution, and the substitution was wrong.** The rule
 * used to replace `/header/gi` with a space and re-test, on the reasoning that a
 * space cannot be part of any term so nothing could be glued into existence.
 * That half is true. The other half is not: **replacing can destroy a term that
 * overlaps the one it removed.** `header` ends in `r` and four unlikely terms
 * begin with one, so `headerelated`, `headerss`, `headeremark` and
 * `headereplies` each contain a second, genuine unlikely term sharing that
 * letter — and taking `header` out takes the second term with it. The pass then
 * rescued a `<table>` the publisher had labelled `related`, and on a measured
 * synthetic that cost the reader **all four paragraphs of the page's prose**,
 * because a rescued table enters candidate selection and a table-dominated page
 * lets it win. Asking the original string whether it says anything unlikely
 * *besides* `header` cannot be fooled that way, and it is the sentence the rule
 * was always trying to say.
 */
export const UNLIKELY_EXCEPT_HEADER = new RegExp(UNLIKELY_CANDIDATES.source.replace("|header|", "|"), "i");

/**
 * **The seam that lets a test run the pipeline with this pass switched off**,
 * and nothing else uses it.
 *
 * `false` in every normal run, and tests/extract-protect.test.ts asserts that
 * it was left that way. It exists because a counterfactual is the only thing
 * that distinguishes *"the fixture passes"* from *"the fixture passes because
 * of this pass"* — the rule in docs/reusable/silent-success.md, and the shape
 * of `withPlacementFloor` in evals/extraction/scorecard.mts.
 */
let protectionDisabled = false;

/**
 * Run `fn` with this pass switched off. **For mutation testing only** —
 * restored in a `finally`, so a throwing case cannot leave the pass disabled
 * for the next one, and nesting restores the outer state rather than the
 * default.
 *
 * **Asynchronous on purpose, unlike `withPlacementFloor`**, which refuses a
 * thenable. The reason that one refuses is that `finally` would restore at the
 * callback's first `await` while everything after it appeared to run mutated;
 * this one awaits the callback *inside* the `try`, so the restore happens after
 * the callback has finished rather than after it has suspended. It has to:
 * `runExtract` is `async`, so a synchronous-only seam could not wrap the
 * shipping entry point at all — and wrapping something other than the shipping
 * entry point is how a counterfactual ends up proving nothing.
 *
 * **Not safe under concurrent callers.** The flag is module state, so two tests
 * running at once would see each other's. Vitest runs the tests in a file in
 * sequence, and nothing here is `it.concurrent`.
 */
export async function withProtectionDisabled<T>(fn: () => T | Promise<T>): Promise<T> {
  const was = protectionDisabled;
  protectionDisabled = true;
  try {
    return await fn();
  } finally {
    protectionDisabled = was;
  }
}

/** Whether the seam above is on, so a test can assert nothing left it that way. */
export function protectionIsDisabled(): boolean {
  return protectionDisabled;
}

/**
 * **Tell Readability that certain elements are content, and count what was
 * said.**
 *
 * Called from `prepareDocument` (src/extract.ts) **last**, after
 * `canonicaliseNotes` and `canonicaliseCallouts`. The order is safe because
 * nothing else in that pass reads a class token we invent, and running last
 * means our token cannot influence the note or callout recognisers — both of
 * which know their shapes by the publisher's own class names, and either of
 * which could in principle be nudged by a class appearing on a container.
 * Running last is the version of that with no argument required.
 *
 * Two rules, applied independently; an element could in principle qualify for
 * both and would then carry both tokens, which no page in the corpus does.
 */
export function protectAuthoredStructure(doc: Document): KeptStructure {
  if (protectionDisabled) return {};
  const kept: Record<string, number> = {};

  let tables = 0;
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    /* **Readability would not have deleted this one anyway**, and the count has
       to know that. Line 1119's condition carries
       `!this._hasAncestorTag(node, "table")` and `!…(node, "code")`, so a table
       nested inside either is never reached by the branch this rule exists to
       defeat. Stamping it is harmless — `KEEP_COLUMN` moves no score — but it
       would report a rescue that rescued nothing, which is the one thing
       `kept` must never say. */
    if (table.parentElement?.closest("table, code") != null) continue;
    if (!headerIsTheSoleUnlikelyTerm(table)) continue;
    if (!hasItsOwnHeaderMarkup(table)) continue;
    table.classList.add(KEEP_COLUMN);
    tables += 1;
  }
  if (tables > 0) kept[RULES.headerNamedTable] = tables;

  /* **Elements, counted once each.** `notice += 2` per outer div was wrong the
     moment two notices could share an element: `querySelector` reaches through
     a nested `div.amendment.amendment-correction`, so an outer notice and the
     inner one it contains can both resolve to the *same* citation, and one
     document of two inner notices inside an outer reported 6 for 5 elements
     stamped. A set of what was actually stamped makes the unit true by
     construction rather than by arithmetic. */
  const stamped = new Set<Element>();
  /* `div.amendment.amendment-correction` is exact class-token matching — CSS
     `.a.b` is `class~=a` and `class~=b`, never a substring of the attribute.
     A substring match would take `amendment-correction-withdrawn` and anything
     else a publisher coins with the same prefix. */
  for (const outer of Array.from(doc.querySelectorAll("div.amendment.amendment-correction"))) {
    const citation = outer.querySelector("div.amendment-citation");
    /* **Both or neither.** Measured three ways: the parent alone recovers
       nothing and the child alone recovers nothing, because whichever is left
       unstamped fails the same linkiness check and takes the other with it. */
    if (citation === null) continue;
    for (const el of [outer, citation]) {
      el.classList.add(KEEP_CONTENT);
      stamped.add(el);
    }
  }
  if (stamped.size > 0) kept[RULES.correctionNotice] = stamped.size;

  return kept;
}

/**
 * **Readability's own delete condition, and then the question it did not ask:
 * would this element still be unlikely if it had not said `header`?**
 *
 * The first two lines are line 1119's test verbatim — matches
 * `unlikelyCandidates`, does not match `okMaybeItsACandidate`. The third asks
 * the **original** string whether it says anything unlikely other than
 * `header`; why it asks that rather than neutralising `header` and asking
 * again is on `UNLIKELY_EXCEPT_HEADER`, and the short version is that a
 * substitution destroys an overlapping term.
 *
 * This is the whole of the narrowing, and it is what declines the Arabic
 * Wikipedia sidebar: `sidebar sidebar-collapse nomobile nowraplinks hlist` says
 * `sidebar` whether or not it says `header`, so the table is unlikely for a
 * reason this pass has no opinion about.
 */
function headerIsTheSoleUnlikelyTerm(table: Element): boolean {
  const matchString = `${table.className} ${table.id}`;
  if (!UNLIKELY_CANDIDATES.test(matchString)) return false;
  if (OK_MAYBE_ITS_A_CANDIDATE.test(matchString)) return false;
  return !UNLIKELY_EXCEPT_HEADER.test(matchString);
}

/**
 * A non-empty `<caption>` of its own, or at least one `<th>` of its own.
 *
 * **"Of its own" is checked rather than assumed.** `querySelector` reaches
 * through a nested table, and a nested table is exactly the shape a layout
 * table wraps round a data one — so a `<caption>` is taken from the direct
 * children and a `<th>` has to have this table as its `closest("table")`.
 *
 * This is deliberately not a data-table heuristic. It is the weakest possible
 * statement that the table declares its own structure, and it is paired with a
 * rule that has already established the only reason Readability disliked it was
 * that declaration.
 */
function hasItsOwnHeaderMarkup(table: Element): boolean {
  const caption = Array.from(table.children).find((child) => child.tagName === "CAPTION");
  if (caption !== undefined && (caption.textContent ?? "").trim() !== "") return true;
  return Array.from(table.querySelectorAll("th")).some((th) => th.closest("table") === table);
}
