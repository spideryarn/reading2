/**
 * Stage 2, before Readability — **the pass that tells Readability something is
 * content, in Readability's own vocabulary.**
 *
 * It is the mirror image of src/furniture.ts. That module deletes what the
 * publisher labelled as chrome; this one deletes nothing and rewrites no text.
 * Rules A and B add **class tokens**, and Readability reads the class attribute
 * in order to answer exactly the question we are answering. **Rule C moves**:
 * it unwraps a `<div>`, putting its children where it was, because no token can
 * do its job (§ *Rule C*, below).
 *
 * ## What rules A and B are for, and it is two losses rather than one class of loss
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
 * | `spya-keep-column` | at twelve rows the table is a table and both prose regions survive; **at twenty-four neither does**, and the paragraph below is what happens then |
 * | `spya-keep-content` | **both prose regions gone at every size**, the table promoted to top candidate and rewritten as a `<div>` |
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
 * `<td>`s alone win candidacy.
 *
 * The identical page with `class="wikitable sortable"` — a string Readability
 * never disliked, so nothing here is stamped — loses the same four paragraphs at
 * the same row count. **That explains the mechanism and it does not absolve this
 * pass**, which is GPT Sol's finding of 2026-09-08 and is accepted rather than
 * argued with: rule A is the *action* that takes the real header-named page from
 * *"prose, missing table"* to *"flattened table, missing prose"*, and that is the
 * same failure class the `positive` token was rejected for at twelve rows. **A
 * rescue that loses the author's prose is not a rescue.** So it is withdrawn,
 * and the next section is how.
 *
 * ## The fallback — every rescue is checked, and a bad one is taken back
 *
 * When **either rule** has stamped anything, stage 2 runs a second time with
 * **exactly the rules that fired** switched off, and compares the two
 * extractions. If the treatment lost prose the control had, the **control** is
 * what ships — which is exactly the behaviour of the day before this pass
 * existed — and `kept` says `a-table-called-header-rolled-back` /
 * `an-amendment-correction-rolled-back` instead of the stamped name, so a
 * withdrawal is as visible in the audit line as a rescue. `readArticle` and
 * `readArticleWithProvenance` (src/extract.ts) both run it through the one
 * shared `armThatKeptTheProse`, because they own the Readability call; the
 * criterion itself is `proseRetention` below and the arm arithmetic is
 * `controlOptionsFor` and `keptWithdrawn`.
 *
 * **The criterion is not length**, and that is the trap in it: in the case that
 * caused all this the treatment was *longer* — 3,726 characters of flattened
 * rows against 801 characters and four paragraphs — so a length comparison
 * scores the disaster as an improvement. What is compared is **prose
 * retention**: every paragraph-level run of text in the control has to still be
 * somewhere in the treatment.
 *
 * **Rule B used to be exempt, and that was wrong.** The argument for the
 * exemption was a measurement — on `plos_biology` not one control run is missing
 * from the treatment, and every construction in tests/extract-protect.test.ts
 * § *rule B's topology* keeps all four paragraphs — plus a story about topology:
 * rule B stamps an *ancestor* of the prose or a sibling too small to win, where
 * rule A stamps the one element on the page built to out-score everything round
 * it. GPT Sol reproduced the counterexample on 2026-09-08 and the story does not
 * survive it: with the notice's four sibling `<article>` sections at the body
 * root and two paragraphs of text inside the notice, the stamped notice wins
 * candidacy and **all four authored paragraphs go**, ~520 characters against the
 * 1,508 the pass leaves alone. `kept` said `{"an-amendment-correction": 2}` and
 * nothing rolled back, because the second arm ran only when rule A had stamped.
 * That is the same positive-token failure class the plan rejected at the design
 * stage, at its third address. **Both rules are now under the fallback.**
 *
 * **When both rules stamped and the treatment lost prose, both are withdrawn** —
 * the control arm has both switched off, and `kept` names both withdrawals. It
 * is the coarse answer and it is deliberate: telling A's fault from B's takes a
 * third and fourth Readability run to find out which single rule the page can
 * keep, for a page shape **no fixture has** (rule A fires on `wiki_gdp_table`
 * and `ar5iv`, rule B on `plos_biology`, and the sets are disjoint). What the
 * coarse answer costs is a rescue, never a paragraph, and it costs it only on a
 * page that was already going to lose one. What would change it is a real
 * fixture where both fire and only one is at fault.
 *
 * **It costs a second parse and a second Readability run**, on the pages one of
 * the rules stamped and no others — three of the thirty-five corpus fixtures.
 * Measured on one busy box in one run, so read the ratios rather than the
 * seconds: `wiki_gdp_table` 6.0s against 1.9s for a single arm, `ar5iv` 2.8s
 * against 1.5s, and `plos_biology` — new to the fallback, since rule B is now in
 * it — 1.5s against 0.7s. Stage 2 is a batch step with nobody waiting on it, and
 * the alternative to spending those seconds is shipping an extraction nobody
 * checked.
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
 * **A lead, recorded rather than built for.** There is a widely-copied Bootstrap
 * pattern in which a scrolling data table is split in two — a detached
 * `<table id="header">` holding only the `<th>` row, beside a second table
 * holding the rows — and the predicate above would stamp that header shell,
 * which is an incomplete half of a table rather than a table. GPT Sol found the
 * construction on 2026-09-08 and did **not** reproduce a reader failure from it:
 * stamping the shell keeps a `<th>` row nobody asked for, and nothing measured
 * says the page loses anything for it. So it is written down here and left
 * alone. What would change it is a real fixture of that shape, with the loss
 * measured — at which point the narrowing is a body-row test on the table, and
 * this paragraph is the reason it exists.
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
 * ## Rule C — a figure deleted with its wrapper, because a picture has no text
 *
 * SPIDERYARN-READING2-6A, and the first rule here found on production rather
 * than in the corpus. A Substack post lost nine of its twenty-three figures:
 * each sits in `div.captioned-image-container`, and where the caption carries a
 * link — *"Source: https://…"* — the container's text is the caption alone,
 * since the picture has none, and its link density runs 0.20 to 0.70 at weight
 * 0. `_cleanConditionally` deletes it on *"Low weight and a little linky"*, and
 * the picture goes with it. The six linked captions whose links are too short to
 * cross 0.2 survive, and so do all the unlinked ones.
 *
 * **No token can do this.** Rule B's token takes a wrapper to weight 25, where
 * the bar is 0.5 — and two of the nine are over it. So rule C takes the wrapper
 * away instead: before Readability, a `div` between a figure and its picture, or
 * one wrapped round the figure alone, is unwrapped — **only if Readability's own
 * two link rules would delete it**, asked by `readabilityWouldTakeItForItsLinks`
 * with Readability's weight and link-density arithmetic copied, its regexes
 * pinned, and the nearby exits mirrored: negative weight, list-dominated divs,
 * allowed videos and div-to-p conversion. The density is measured after the
 * same hidden and unlikely descendants Readability removes. `figure` is not a
 * tag `_cleanConditionally` walks, so once no such `div` is left, those two
 * rules have nothing to take.
 *
 * **The mirror is of Readability's first, weight-on pass.** If an extraction is
 * shorter than 500 characters, Readability retries and eventually switches
 * `FLAG_WEIGHT_CLASSES` off. A positive wrapper between 0.2 and 0.5 is safe on
 * the first pass and linky on that retry. Rule C cannot know before parsing
 * whether the retry will happen; treating every such wrapper as at risk would
 * move wrappers on ordinary pages where it does not. The stage-1 code review
 * records the reproduced 536-character case and leaves that widening decision.
 *
 * **That is the whole guarantee.** Candidate selection is another way to lose a
 * figure — one outside the article Readability picks is never appended — and
 * rule C does not touch it (GPT Sol, plan review).
 *
 * **It is under the fallback like A and B, and it needs to be.** GPT Sol built
 * the page: four sibling `<article>` sections of the author's prose and a
 * figure whose long linked caption sits inside its picture's `div`. Unwrapped,
 * the figure wins candidate selection and all four sections go;
 * `proseRetention` sees four runs missing and the control ships. That page is in
 * tests/extract-figure-wrappers.test.ts.
 *
 * Springer Nature's figures were the other half of the same report and are
 * **not** this rule's: the wrapper there died of the *Full size image* button
 * beside the picture, a control the publisher labels, so it is an entry in
 * src/furniture.ts. docs/plans/260930e-figures-readability-deletes-with-their-wrapper.md.
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
 *
 * The two `…RolledBack` keys are the ones that count something the shipped page
 * does *not* have: what a rule stamped on a run whose result was then thrown
 * away for losing prose. They are in the same object rather than beside it so
 * that the pipeline's audit line (src/pipeline.ts, `extract … kept …`) says
 * them without being taught to — a withdrawal nobody can see is the failure
 * class this whole pass is about.
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
  /**
   * Rule A, stamped and then taken back — the tables that were rescued on a run
   * whose extraction lost prose the control arm had, so the control shipped
   * instead. It appears *in place of* `headerNamedTable`, never beside it: the
   * page that shipped carries no stamp at all. See § *The fallback* above.
   */
  headerNamedTableRolledBack: "a-table-called-header-rolled-back",
  /**
   * Rule B, stamped and then taken back — the same arrangement for the
   * correction notice, and it exists because rule B turned out to be able to
   * cost an author four paragraphs on its own (§ *The fallback*, and GPT Sol's
   * reproduction of 2026-09-08).
   *
   * It can appear **beside** `headerNamedTableRolledBack` where both rules
   * stamped the same page, because the control arm switches both off together.
   * It never appears beside `correctionNotice`.
   */
  correctionNoticeRolledBack: "an-amendment-correction-rolled-back",
  /**
   * Rule C — a figure with a wrapper Readability's link rules would have
   * deleted, picture and all. Counted per figure, not per `div` unwrapped.
   * **A wrapper, not necessarily a picture saved**: a figure outside the article
   * Readability selects is dropped either way, which is what the one corpus
   * fixture this fires on (Quanta's lead video) shows, byte-identical in both
   * arms. See § *Rule C* above.
   */
  figureWrapper: "a-figure-its-wrapper-would-take",
  /** Rule C, unwrapped and then taken back — the same arrangement as A and B. */
  figureWrapperRolledBack: "a-figure-its-wrapper-would-take-rolled-back",
} as const;

/**
 * **Every rule, paired with the key that means "and then taken back"** — the
 * one table both halves of the fallback read, so a third rule cannot be added
 * with a rollback name and no way to reach it, or with a way to reach it and no
 * name.
 *
 * `controlOptionsFor` turns the left column into the control arm's brief and
 * `keptWithdrawn` turns it into the audit line; neither knows any rule by name.
 */
const WITHDRAWALS: ReadonlyArray<{
  readonly stamped: string;
  readonly withdrawn: string;
  readonly switchOff: keyof ProtectOptions;
}> = [
  { stamped: RULES.headerNamedTable, withdrawn: RULES.headerNamedTableRolledBack, switchOff: "withoutHeaderNamedTables" },
  { stamped: RULES.correctionNotice, withdrawn: RULES.correctionNoticeRolledBack, switchOff: "withoutCorrectionNotices" },
  { stamped: RULES.figureWrapper, withdrawn: RULES.figureWrapperRolledBack, switchOff: "withoutFigureWrappers" },
];

/**
 * **The control arm's brief: switch off exactly the rules that fired**, or
 * `null` when none did and there is nothing to check.
 *
 * Exactly those and not all of them, so the arms differ by the thing under
 * test: on a page where only rule A stamped, the control still gets its
 * correction notices, and a rollback of A does not silently cost the reader a
 * notice rule B was right about.
 */
export function controlOptionsFor(kept: KeptStructure): ProtectOptions | null {
  const opts: { -readonly [K in keyof ProtectOptions]: boolean } = {};
  let any = false;
  for (const rule of WITHDRAWALS) {
    if ((kept[rule.stamped] ?? 0) === 0) continue;
    opts[rule.switchOff] = true;
    any = true;
  }
  return any ? opts : null;
}

/**
 * **`kept`, rewritten for the run that was thrown away** — every stamped rule
 * renamed to its rolled-back key, its count carried over unchanged.
 *
 * The count is what the *treatment* stamped, which is the number the withdrawal
 * is about: the page that ships carries no stamp at all, so a count read off the
 * control arm would always be zero and the audit line would say nothing.
 */
export function keptWithdrawn(kept: KeptStructure): KeptStructure {
  const out: Record<string, number> = { ...kept };
  for (const rule of WITHDRAWALS) {
    const n = out[rule.stamped];
    if (n === undefined) continue;
    delete out[rule.stamped];
    out[rule.withdrawn] = n;
  }
  return out;
}

/**
 * **What to leave out of a run**, and it is written by one function:
 * `controlOptionsFor` above, which switches off exactly the rules that fired so
 * that the fallback's two arms differ by the thing under test.
 *
 * Deliberately not the `withProtectionDisabled` seam above. That one is module
 * state for mutation testing and switches off *everything* unconditionally;
 * this is a parameter, on the shipping path, and it leaves a rule that did not
 * fire running — so a page that rolls rule A back still gets its correction
 * notice, unless rule B stamped it too and is under the same withdrawal. Two
 * mechanisms because they are two different jobs, and the seam's own header
 * says it is for tests.
 */
export interface ProtectOptions {
  /** Skip rule A entirely — the control arm of the prose-retention check. */
  readonly withoutHeaderNamedTables?: boolean;
  /** Skip rule B entirely — the same, for the correction notice. */
  readonly withoutCorrectionNotices?: boolean;
  /** Skip rule C entirely — the same, for a figure's wrappers. */
  readonly withoutFigureWrappers?: boolean;
}

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

/** Copied from `@mozilla/readability` 0.6.0 `REGEXPS.positive` — rule C's weight. Pinned like the two above. */
export const POSITIVE = /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i;

/** Copied from `@mozilla/readability` 0.6.0 `REGEXPS.negative` — rule C's weight. Pinned like the two above. */
export const NEGATIVE =
  /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i;

/** Copied from `@mozilla/readability` 0.6.0 `REGEXPS.hashUrl` — a fragment link counts 0.3 of its length. */
export const HASH_URL = /^#.+/;

/** Copied from `@mozilla/readability` 0.6.0 `REGEXPS.videos` — these embeds make conditional cleaning return early. */
export const VIDEOS =
  /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i;

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
 * Three rules, applied independently, and **no element can carry both
 * tokens**: rule A selects `<table>` and rule B selects `<div>`. The header of
 * this file used to say an element might carry both; it cannot, and GPT Sol
 * checked it rather than took it (2026-09-08). Rule C runs last and stamps
 * nothing; it could unwrap a `div` rule B stamped only if that notice held a
 * figure's picture, and B's 25 points count in its gate, as they would in
 * Readability's.
 */
export function protectAuthoredStructure(doc: Document, opts: ProtectOptions = {}): KeptStructure {
  if (protectionDisabled) return {};
  const kept: Record<string, number> = {};

  let tables = 0;
  for (const table of opts.withoutHeaderNamedTables === true ? [] : Array.from(doc.querySelectorAll("table"))) {
    /* **Readability would not have deleted this one anyway**, and the count has
       to know that. Line 1119's condition carries
       `!this._hasAncestorTag(node, "table")` and `!…(node, "code")`, so a table
       nested inside either is never reached by the branch this rule exists to
       defeat. Stamping it is harmless — `KEEP_COLUMN` moves no score — but it
       would report a rescue that rescued nothing, which is the one thing
       `kept` must never say. */
    if (readabilityCannotDeleteIt(table)) continue;
    if (!headerIsTheSoleUnlikelyTerm(table)) continue;
    if (!hasItsOwnHeaderMarkup(table)) continue;
    table.classList.add(KEEP_COLUMN);
    tables += 1;
  }
  if (tables > 0) kept[RULES.headerNamedTable] = tables;

  /* **Elements, counted once each.** `notice += 2` per outer div was wrong the
     moment two notices could share an element, and a bare `querySelector` let
     them: it reached through a nested `div.amendment.amendment-correction`, so
     an outer notice and the inner one it contained both resolved to the *same*
     citation, and one document of two inner notices inside an outer reported 6
     for 5 elements stamped. `:scope >` below has since made that particular
     collision impossible — a citation has one parent — but the set stays,
     because it makes the unit true by construction rather than by argument
     about the selector. */
  const stamped = new Set<Element>();
  /* `div.amendment.amendment-correction` is exact class-token matching — CSS
     `.a.b` is `class~=a` and `class~=b`, never a substring of the attribute.
     A substring match would take `amendment-correction-withdrawn` and anything
     else a publisher coins with the same prefix. */
  const notices =
    opts.withoutCorrectionNotices === true ? [] : Array.from(doc.querySelectorAll("div.amendment.amendment-correction"));
  for (const outer of notices) {
    /* **A direct child, which is the topology this was measured on.** PLOS
       writes `div.amendment-citation` as a child of the notice
       (evals/extraction/fixtures/plos_biology.html), and a plain
       `querySelector` would also take a citation buried anywhere beneath —
       inside an unrelated `<aside>`, say. That width was left in and pinned by
       a test until GPT Sol pointed out what the test was really doing
       (2026-09-08): a deferral wearing a green tick. A `positive` token can
       displace an author's prose from anywhere on the page, so *"three
       constructions did not break it"* is not evidence for stamping a shape
       nobody has seen. **What would widen it again** is a real publisher
       fixture whose citation is wrapped one div deeper, with the treatment and
       control arms measured on it the way this file's other topologies are. */
    const citation = outer.querySelector(":scope > div.amendment-citation");
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

  const figures = opts.withoutFigureWrappers === true ? 0 : unwrapFigureWrappers(doc);
  if (figures > 0) kept[RULES.figureWrapper] = figures;

  return kept;
}

/**
 * **Rule C**: unwrap every `div` Readability's link rules would delete a
 * figure's picture with, and say how many figures had one. A `<div>` here,
 * never a `<figure>`: `figure` is not one of the tags `_cleanConditionally`
 * walks, so the figure itself is never at risk — only a `div` between it and
 * its picture, or one wrapped round it alone.
 */
function unwrapFigureWrappers(doc: Document): number {
  let figures = 0;
  for (const figure of Array.from(doc.querySelectorAll("figure"))) {
    if (figure.querySelector(FIGURE_PICTURE) === null) continue;
    const inside = unwrapInside(figure);
    const around = unwrapAround(figure);
    if (inside || around) figures += 1;
  }
  return figures;
}

/**
 * Inside: every `div` that holds the picture. The order does not matter:
 * unwrapping one changes no other `div`'s text, links or class, so each is
 * judged on exactly what Readability would have judged it on.
 */
function unwrapInside(figure: Element): boolean {
  let unwrapped = false;
  for (const div of Array.from(figure.querySelectorAll("div"))) {
    if (div.querySelector(FIGURE_PICTURE) === null) continue;
    if (!readabilityWouldTakeItForItsLinks(div)) continue;
    unwrap(div);
    unwrapped = true;
  }
  return unwrapped;
}

/**
 * Around: a `div` that wraps nothing but this figure, walking up while that
 * holds. **Each is judged on its own** — GPT Sol, plan review: an outer wrapper
 * inherits the figure's link text whether or not it was at risk, so the walk
 * passes over a safe one rather than unwrapping it.
 */
function unwrapAround(figure: Element): boolean {
  let unwrapped = false;
  let node: Element = figure;
  for (let parent = node.parentElement; parent?.tagName === "DIV"; parent = node.parentElement) {
    if (parent.children.length !== 1 || hasOwnText(parent)) break;
    if (readabilityWouldTakeItForItsLinks(parent)) {
      /* The figure's new parent is the next one up; `node` stays where it is. */
      unwrap(parent);
      unwrapped = true;
    } else {
      node = parent;
    }
  }
  return unwrapped;
}

/**
 * **A picture, as rule C means it** — what a reader would miss. An `<svg>` is
 * left out: in the pages measured it is an icon inside a link, and counting it
 * would put every figure with a download button in scope.
 */
const FIGURE_PICTURE = "img, picture, video";

/**
 * **Would `_cleanConditionally` delete this `div` on one of its two link rules?**
 * Readability 0.6.0, Readability.js around line 2580, and nothing else of it:
 *
 * - it looks only if the text has **fewer than ten commas**;
 * - *"Low weight and a little linky"*: class weight under 25 and link density
 *   over 0.2;
 * - *"High weight and mostly links"*: weight 25 or more and density over 0.5.
 *
 * Asked **before** Readability runs, so `readabilityDomForLinkGate` first takes
 * out the scripts, styles and hidden descendants Readability removes before it
 * measures text and links. The other early exits that bear on the two link rules
 * are mirrored too: a negative weight is already a different deletion, a
 * list-dominated low-weight div is exempt, an allowed video returns early, and
 * div Readability turns into a paragraph is never conditionally cleaned as a
 * div, and the unconditional cleaners ahead of divs no longer contribute text.
 * The fallback still decides whether the changed page ships; this mirror decides
 * whether `kept` may honestly say the wrapper crossed a link rule.
 *
 * Readability's `linkDensityModifier` is 0 here because `readingArm` passes no
 * options. Class weight is the first pass's, for the retry limit in Rule C's
 * header. Other checks are not this rule's and do not qualify a wrapper.
 */
export function readabilityWouldTakeItForItsLinks(div: Element): boolean {
  const staysADiv = readabilityKeepsThisAsADiv(div);
  const judged = readabilityDomForLinkGate(div);
  if (judged === null || !staysADiv) return false;
  readabilityCleanBeforeDivs(judged);
  if (hasAllowedVideo(judged)) return false;
  if (readabilityInnerText(judged).split(",").length - 1 >= 10) return false;
  const weight = readabilityClassWeight(judged);
  /* `_cleanConditionally` returns on negative weight before it asks either link
     question. Calling that a link-rule deletion made `kept` false. */
  if (weight < 0) return false;
  const density = readabilityLinkDensity(judged);
  return (!readabilityTreatsAsList(judged) && weight < 25 && density > 0.2) || (weight >= 25 && density > 0.5);
}

/**
 * Readability's node-preparation removals that can change comma count or link
 * density: scripts and styles, then invisible and unlikely descendants. Work on
 * a clone; the protection pass itself must move only wrappers it accepts.
 */
function readabilityDomForLinkGate(div: Element): Element | null {
  if (readabilityNodePrepRemoves(div)) return null;
  const clone = div.cloneNode(true) as Element;
  for (const removed of Array.from(clone.querySelectorAll("script, noscript, style"))) removed.remove();
  for (const candidate of Array.from(clone.querySelectorAll("*"))) {
    if (readabilityNodePrepRemoves(candidate)) candidate.remove();
  }
  return clone;
}

/** Readability 0.6.0 `_isProbablyVisible`; `aria-hidden` has normally been removed by `prepareDocument`. */
function readabilityProbablyVisible(el: Element): boolean {
  const style = (el as Element & { readonly style?: CSSStyleDeclaration }).style;
  return (
    (style === undefined || (style.display !== "none" && style.visibility !== "hidden")) &&
    !el.hasAttribute("hidden") &&
    (!el.hasAttribute("aria-hidden") || el.getAttribute("aria-hidden") !== "true" || el.classList.contains("fallback-image"))
  );
}

/** The node-preparation removals that happen before divs are scored or cleaned. */
function readabilityNodePrepRemoves(el: Element): boolean {
  if (!readabilityProbablyVisible(el)) return true;
  if (el.getAttribute("aria-modal") === "true" && el.getAttribute("role") === "dialog") return true;
  const match = `${el.getAttribute("class") ?? ""} ${el.id}`;
  if (
    UNLIKELY_CANDIDATES.test(match) &&
    !OK_MAYBE_ITS_A_CANDIDATE.test(match) &&
    !hasNearbyAncestor(el, "TABLE") &&
    !hasNearbyAncestor(el, "CODE") &&
    el.tagName !== "BODY" &&
    el.tagName !== "A"
  ) {
    return true;
  }
  return ["menu", "menubar", "complementary", "navigation", "alert", "alertdialog", "dialog"].includes(
    el.getAttribute("role") ?? "",
  );
}

/** Readability's default ancestor window checks four parents (its default maxDepth is three). */
function hasNearbyAncestor(el: Element, tagName: string): boolean {
  let node = el.parentElement;
  for (let level = 1; node !== null && level <= 4; level += 1) {
    if (node.tagName === tagName) return true;
    node = node.parentElement;
  }
  return false;
}

/** A source `div` with none of these descendants becomes a `p` before conditional div cleaning. */
function readabilityKeepsThisAsADiv(div: Element): boolean {
  return div.querySelector("blockquote, dl, div, img, ol, p, pre, table, ul") !== null;
}

/** The `isList` calculation immediately above Readability's link rules. */
function readabilityTreatsAsList(el: Element): boolean {
  const total = readabilityInnerText(el).length;
  let list = 0;
  for (const node of Array.from(el.querySelectorAll("ul, ol"))) list += readabilityInnerText(node).length;
  return list / total > 0.9;
}

/** An allowed video makes `_cleanConditionally` return `false` before any link rule. */
function hasAllowedVideo(el: Element): boolean {
  return Array.from(el.querySelectorAll("object, embed, iframe")).some(videoIsAllowed);
}

function videoIsAllowed(embed: Element): boolean {
  for (const attr of Array.from(embed.attributes)) if (VIDEOS.test(attr.value)) return true;
  return embed.tagName === "OBJECT" && VIDEOS.test(embed.innerHTML);
}

/** Unconditional cleaners in `_prepArticle` that run before conditional div cleaning. */
function readabilityCleanBeforeDivs(el: Element): void {
  for (const tag of ["object", "embed"]) {
    for (const candidate of Array.from(el.querySelectorAll(tag))) if (!videoIsAllowed(candidate)) candidate.remove();
  }
  for (const removed of Array.from(el.querySelectorAll("footer, link, aside"))) removed.remove();
  for (const candidate of Array.from(el.querySelectorAll("iframe"))) if (!videoIsAllowed(candidate)) candidate.remove();
  for (const removed of Array.from(el.querySelectorAll("input, textarea, select, button"))) removed.remove();
  for (const heading of Array.from(el.querySelectorAll("h1, h2"))) {
    if (readabilityClassWeight(heading) < 0) heading.remove();
  }
}

/** Readability's `_getInnerText`: trimmed, runs of whitespace collapsed to one space. */
function readabilityInnerText(el: Element): string {
  return (el.textContent ?? "").trim().replace(/\s{2,}/g, " ");
}

/** Readability's `_getClassWeight`, with `FLAG_WEIGHT_CLASSES` on — as it is on the first pass. */
function readabilityClassWeight(el: Element): number {
  let weight = 0;
  for (const s of [el.getAttribute("class") ?? "", el.id]) {
    if (s === "") continue;
    if (NEGATIVE.test(s)) weight -= 25;
    if (POSITIVE.test(s)) weight += 25;
  }
  return weight;
}

/** Readability's `_getLinkDensity`: link text over all text, a fragment link at 0.3. */
function readabilityLinkDensity(el: Element): number {
  const total = readabilityInnerText(el).length;
  if (total === 0) return 0;
  let links = 0;
  for (const a of Array.from(el.getElementsByTagName("a"))) {
    const href = a.getAttribute("href");
    links += readabilityInnerText(a).length * (href !== null && HASH_URL.test(href) ? 0.3 : 1);
  }
  return links / total;
}

/** Any text of its own, directly under it — which a wrapper round a figure does not have. */
function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === n.TEXT_NODE && (n.textContent ?? "").trim() !== "");
}

/** Put an element's children where it was. Moves; deletes nothing and rewrites no text. */
function unwrap(el: Element): void {
  el.replaceWith(...Array.from(el.childNodes));
}

/**
 * **How far up Readability actually looks**, and the number is the library's:
 * `_hasAncestorTag(node, tagName, maxDepth, filterFn)` opens with
 * `maxDepth = maxDepth || 3` and returns `false` once `depth > maxDepth`
 * (Readability.js:2217). The loop checks the parent before incrementing, so the
 * levels it inspects are 1, 2, 3 and 4 — and the call at line 1121 passes no
 * depth at all.
 */
const ANCESTOR_LEVELS_READABILITY_CHECKS = 4;

/**
 * **The mirror of `!_hasAncestorTag(node, "table") && !…(node, "code")`, at the
 * depth Readability really uses.**
 *
 * A table inside one of those is never reached by the branch rule A exists to
 * defeat, so stamping it would report a rescue that rescued nothing — the one
 * thing `kept` must never say.
 *
 * **This used to be `parentElement.closest("table, code")`, and that was not a
 * mirror**: `closest` walks to the root, and Readability stops after four
 * levels. GPT Sol reproduced the consequence on 2026-09-08 — a qualifying table
 * one `<div>` deeper inside a layout table's cell is *out* of Readability's
 * window, so Readability deletes it, while the unbounded check declined to
 * stamp it on the claim that Readability could not. The claim was true of the
 * shallow case and false of the deep one, which is exactly the shape a mirror
 * written from memory takes. Both cases are pinned in
 * tests/extract-protect.test.ts § *what rule A counts*.
 *
 * The two calls are folded into one walk because they scan the same window: if
 * any of those four levels is a `<table>` or a `<code>`, one of the two
 * `_hasAncestorTag` calls returns true and the deletion is skipped.
 */
function readabilityCannotDeleteIt(table: Element): boolean {
  let node: Element | null = table.parentElement;
  for (let level = 1; node !== null && level <= ANCESTOR_LEVELS_READABILITY_CHECKS; level += 1) {
    if (node.tagName === "TABLE" || node.tagName === "CODE") return true;
    node = node.parentElement;
  }
  return false;
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

/**
 * The elements a paragraph-level run of text can live in. Deliberately not
 * `<td>`: a run is something the author wrote as prose, and the failure this is
 * looking for is precisely a table's cells arriving *instead of* the prose.
 */
const PROSE_RUN_TAGS = "p, li, dd, dt, blockquote, figcaption, pre, h1, h2, h3, h4, h5, h6";

/**
 * **How short a run can be and still count as prose, and the number is
 * Readability's own** — `_grabArticle` declines to score any element under 25
 * characters, so below it the library has already said this is not a paragraph.
 *
 * **It was 100 for a day, and 100 was fixture-tuned.** The one thing a
 * 25-character floor fires on across the whole corpus is `wiki_gdp_table`'s
 * *"From Wikipedia, the free encyclopedia"* — 37 characters, written by the
 * source as `<div id="siteSub" class="noprint">`, rewritten by Readability as a
 * `<p>`, and dropped by the treatment arm because `_cleanConditionally`'s
 * arithmetic moves with the article's total score and the article got 237 rows
 * of tables longer. Raising the floor over it withdrew nothing on the corpus and
 * looked free.
 *
 * It was not free. GPT Sol reproduced the price on 2026-09-08: a header-named
 * 24-row table beside eight authored paragraphs of 99 characters each: the
 * control keeps all eight and 797 characters, the treatment keeps none of them
 * and 7,470 characters of flattened table, and `proseRetention` reported
 * `{ runs: 0, lost: 0, retained: true }` — **a whole page of prose gone, below
 * a floor that could not see it.** Short news paragraphs, Q&A answers, list
 * prose, poetry and concise technical documentation all live under 100
 * characters, so that is not an exotic page.
 *
 * The chrome is excluded by what the publisher said about it instead — see
 * `notForPrintText` — which is a statement about the markup, where a length
 * threshold is a statement about nothing. Measured after the change:
 * `wiki_gdp_table` compares 57 runs and loses none, `ar5iv` 127 and loses none,
 * `plos_biology` 75 and loses none.
 */
const PROSE_RUN_FLOOR = 25;

/**
 * **The text of everything the publisher marked as not for print** — flattened,
 * and read off the document *before* Readability, which is the only place it can
 * be read.
 *
 * `keepClasses` defaults to `false`, so by the time there are two extractions to
 * compare the `noprint` class is gone from both and the run is indistinguishable
 * from a paragraph. So the source is asked, and `proseRetention` matches its
 * answers by text.
 *
 * **Why `noprint` and nothing else.** It is a statement the publisher made about
 * their own markup — MediaWiki writes it on `#siteSub`, on the portal bar and on
 * the *"Mobile view"* link — and excluding *"what the publisher said not to
 * print"* from a check about *"what the author wrote"* is this plan's own rule:
 * rule on markup, model on meaning. The near neighbours (`no-print`,
 * `hidden-print`, `d-print-none`) were considered and left out for the reason
 * `correction`/`erratum`/`retraction` were left out of rule B: a token nobody has
 * measured on a real page is a guess, and a wrong guess here is a rollback that
 * should have fired and did not, which is the exact failure this whole section
 * exists for. **What would widen it** is a fixture whose chrome carries one of
 * them and whose retention check goes wrong for the want of it.
 *
 * **Text, and therefore counts nothing** — the strings never leave this module's
 * comparison, and `proseRetention` returns three numbers.
 */
export function notForPrintText(doc: Document): readonly string[] {
  return Array.from(doc.querySelectorAll(".noprint"))
    .map((el) => flatten(el.textContent ?? ""))
    .filter((text) => text !== "");
}

/** Every run of whitespace to one space, so an indentation change is not a loss. */
const flatten = (s: string): string => s.replace(/\s+/gu, " ").trim();

/**
 * **Did the treatment keep the prose the control had?** — the criterion the
 * fallback in `readArticle` (src/extract.ts) turns on, and § *The fallback*
 * above is why there is one.
 *
 * **Not a length comparison**, and that is the whole design: in the case that
 * caused this the bad arm was the *longer* one, 3,726 characters of flattened
 * table rows against 801 characters and four paragraphs. Length scores the
 * disaster as an improvement.
 *
 * What is compared instead: every paragraph-level run in the `control` (see
 * `PROSE_RUN_TAGS` and `PROSE_RUN_FLOOR`) must appear **somewhere** in the
 * treatment's text. Containment in the whole rather than a run-for-run match, on
 * purpose — Readability legitimately re-wraps and merges blocks between two
 * parses of the same page, and this check is about text the reader lost, not
 * about the elements it arrived in. A run split down the middle in the treatment
 * would read as lost, and one thing measured does that: a rescued table standing
 * inside the run. Such a run is read a second time with the treatment's tables
 * taken out — `textRoundTables`, below, which says why that costs the check
 * nothing.
 *
 * **The invariant is *the words are retained somewhere*, not *the prose
 * occurrence is retained*, and the difference is a real blind spot.** A
 * paragraph the page also prints inside a table cell, a footnote or a
 * pull-quote can lose its occurrence in the article body and still be found in
 * the treatment's text, so this returns `retained: true` for a page that has
 * moved a paragraph out of the prose and left a copy behind. Named by GPT Sol
 * on 2026-09-08 and accepted rather than closed: the narrower invariant needs
 * run-for-run identity between two parses, which Readability does not give — it
 * re-wraps and merges legitimately, so the narrow check would roll back pages
 * that lost nothing, and a rollback that fires on a healthy page costs the
 * reader the tables this pass exists to rescue. This one is a floor under
 * *"the reader can still find the words"*, which is the claim it is safe to
 * make.
 *
 * `notForPrint` is the flattened text of what the publisher marked as chrome
 * (`notForPrintText`, read off the pre-Readability document); a control run
 * whose text sits inside one of those strings is not the author's prose and its
 * loss is not a loss. Omitting it makes the check stricter, never looser, which
 * is why it is optional.
 *
 * **Counts, never text.** The return is three numbers, so a caller logging the
 * result cannot log the article — the rule in docs/project/logging.md, made
 * true by the signature rather than by remembering.
 */
export function proseRetention(
  control: Element,
  treatment: Element,
  notForPrint: readonly string[] = [],
): { readonly runs: number; readonly lost: number; readonly retained: boolean } {
  const kept = flatten(treatment.textContent ?? "");
  const runs = Array.from(control.querySelectorAll(PROSE_RUN_TAGS))
    .map((el) => flatten(el.textContent ?? ""))
    .filter((run) => run.length >= PROSE_RUN_FLOOR)
    /* Containment rather than equality, because Readability rewrites the
       publisher's `<div class="noprint">` as a `<p>` and may split or trim it —
       what survives of a marked-up region is still that region's words. */
    .filter((run) => !notForPrint.some((chrome) => chrome.includes(run)));
  const missing = runs.filter((run) => !kept.includes(run));
  /* **A run the treatment's own table interrupts is not a lost run.** Parsed
     only when something is missing, which is almost never. */
  const roundTables = missing.length === 0 ? [] : textRoundTables(treatment);
  const lost = missing.filter((run) => !roundTables.some((candidate) => candidate.includes(run))).length;
  return { runs: runs.length, lost, retained: lost === 0 };
}

/**
 * **Each treatment prose run that contains a `<table>`, with its tables taken
 * out** — the second readings a missing run is given before it is called lost.
 *
 * A rescued table can stand in the middle of a run. Ten tables of arXiv
 * 2610.01658v1 sit inside list items, and six of those items carry on after
 * their table: the control's `<li>` reads *"words before, words after"*, the
 * treatment's reads *"words before, the table's cells, words after"*, and the
 * first is not a substring of the second. `proseRetention` counted six lost
 * runs on a page that had lost nothing, and rule A's rescue — which had kept
 * all ten tables — was withdrawn. Measured 2026-10-05;
 * tests/extract-protect-list-item-tables.test.ts.
 *
 * **Why this is not the loosening it looks like.** The run still has to be in
 * one treatment prose element whole and in order; all that is forgiven is a
 * `<table>` standing inside that same element. Removing tables from the whole
 * document would join unrelated fragments on either side of one and could hide
 * a genuinely missing paragraph. In the failure the fallback exists for, the
 * rescued table has won candidacy and been rewritten as a `<div>`, and the
 * prose is gone: there is then no `<table>` to take out and no prose to find,
 * so the run is lost on this reading exactly as on the first. Prose that
 * survives only *inside* a table cell is found by the first reading and never
 * reaches this one — the blind spot `proseRetention` already names, neither
 * widened nor narrowed.
 *
 * A clone, because `treatment` is the arm that may be about to ship.
 */
function textRoundTables(treatment: Element): string[] {
  return Array.from(treatment.querySelectorAll(PROSE_RUN_TAGS))
    .filter((run) => run.querySelector("table") !== null)
    .map((run) => {
      const clone = run.cloneNode(true) as Element;
      for (const table of Array.from(clone.querySelectorAll("table"))) table.remove();
      return flatten(clone.textContent ?? "");
    });
}
