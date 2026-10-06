# Review: stage 2 of 261005l — LaTeXML pages (arXiv's HTML) through the web extractor

Repo: this worktree, branch `worktree-fbayettj-arxiv-import`. TypeScript + ESM, strict.

## The candidate

Committed: commit `8b66fa4fa`.
`git show --stat 8b66fa4fa` prints the complete list of changed paths; `git show 8b66fa4fa -- src`
the source diff.

Start with `src/latexml.ts` (new), `src/protect.ts` (`proseRetention`, `textRoundTables`),
`src/extract.ts` (`prepareDocument`'s call, and `runExtract`'s `debugPage` byline),
`src/meta-authors.ts` and `src/maths-import.ts`. That is where to begin, not the limit of scope.

## What it is meant to do

The plan is `docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md`
§ "Stage: the HTML arm's faults (LaTeXML pages), and HTML first". Its three rules bind every
rewrite: only beneath `article.ltx_document`; an exact shape of children or the page is left as it
was; the container's id and every linked descendant id kept, or no change. Your own F6, F7 and F8
on the plan shaped those rules and fixes 1 to 4.

The evidence is `docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md`
§ "What the HTML arm gets wrong" and § "The re-run, after the fixes".

What was built, and where it departs from the plan:

1. Aligned equations → one display formula. Handled shapes and the ones left alone are in the
   module's comments (a group with several numbered rows, or four formula cells, is left).
2. `<object type="image/svg+xml">` beneath a LaTeXML figure → `<img>`. Widened from "direct child
   of the figure" to "beneath it", because real pages nest it in `div.ltx_flex_cell`. Nothing
   about hosting changed: no edit to `src/assets.ts`, the bucket's types or the asset route.
3. `.ltx_listing` → one `<pre>`. Two departures: a leading `div.ltx_listing_data` (a `data:`
   download link) is allowed and dropped; a listing whose lines hold `<math>` is left alone.
4. **Not the plan's mechanism.** The table inside a list item was already stamped by an existing
   rule; what removed it was the prose-retention fallback (`armThatKeptTheProse`) counting the
   list item's prose as lost, because the rescued table stands in the middle of the run. The fix
   changes `proseRetention` to re-read a missing run with the treatment's `<table>`s removed
   (`textRoundTables`). **This touches a generic safety check that every web page passes through.**
5. Byline from the title block, through `metaAuthors`; and `debugPage` is now given the chosen
   byline rather than Readability's, for every page.
6. Not built: the missing cross-reference numbers are an empty `ltx_missing_label` in arXiv's own
   HTML.
7. A boxed passage's words lifted out of an SVG that is only a frame round one `foreignObject`.
   The sanitiser's policy is untouched.

**The sanitiser, the asset pipeline and everything else in `docs/project/security-map.md` § Where
the defences physically live must be unedited.** `prepareLatexml` runs on a stranger's page before
Readability and the sanitiser; whatever it moves or creates is still sanitised afterwards. Check
that claim.

## What you can and cannot run, and what you may change

**You may edit this worktree.** Fix what is inside this stage, narrowly and red-first: each fix
with the test that reproduces it. Leave anything wider as a finding for me to decide. Do not
commit. Do not touch `src/jobs.ts`, `src/store/`, `src/pipeline.ts`, `src/paper-sources.ts`,
`src/ingest.ts` (the previous stage, under a separate review). List every file you changed at the
end.

You have no network, not even loopback. Tests you can run, one file at a time:
`tests/latexml.test.ts`, `tests/extract-protect.test.ts`,
`tests/extract-protect-list-item-tables.test.ts`, `tests/maths-import.test.ts`,
`tests/table-oracle.test.ts`, `tests/meta-authors.test.ts`,
`tests/extract-page-byline-is-the-chosen-one.test.ts`, `tests/extract-byline.test.ts`,
`tests/extract-sanitize.test.ts`, `tests/extraction-shapes.test.ts`. The five real arXiv pages the
fixtures were cut from are not in the tree; the fixtures are in `tests/fixtures/latexml/`.

## Attack it

Independently, before you read my questions at the end.

- For each rewrite in `src/latexml.ts`: an input beneath `article.ltx_document` on which it
  deletes or corrupts authored content, breaks a cross-reference target, changes the meaning of an
  equation (rows out of order, a stray or missing `&`, a number attached to the wrong group), or
  produces markup that survives the sanitiser as something it should not. And an input that is
  NOT a LaTeXML page on which anything here changes the output at all.
- `textRoundTables`: is this statement accurate — *"a run is forgiven only when it is present in
  the treatment whole and in order with a `<table>` standing inside it; the failure the fallback
  exists for (a rescued table winning candidacy and the prose gone) is still caught"*? Construct
  the page on which the new second reading hides a real prose loss.
- The `debugPage` byline change reaches every web page: a page for which the line under the title
  is now worse or wrong, or where the block's text changing matters to the block-id contract
  (`docs/project/block-ids.md`) in a way the commit does not say.
- `latexmlAuthorNames`: a title block from which it returns something that is not the authors
  (affiliations, emails, footnote marks, "and"), or returns authors on a page that declares them
  properly elsewhere.
- Whether any existing expectation that was changed (`tests/maths-import.test.ts`,
  `tests/extract-protect.test.ts`, `tests/table-oracle.test.ts`, all on the ar5iv fixture) hides a
  regression rather than recording an intended change.
- The docs claims in 261005e § "The re-run": does the code support each?

For each finding give:
  - an ID continuing the chain (**start at F20**), a severity (P0/P1/P2/P3), established or reasoned
  - (a) the input or mutation that shows it
  - (b) what you changed (if you fixed it) or the smallest change that closes it
A finding with no (a) goes last.

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, or the
service broadly unusable. **P1** user-visible wrong behaviour, or an authoritative contract
violated. **P2** design or maintainability risk with no wrong behaviour today. **P3**
non-behavioural prose or comment defect.

Refuse only on an established P0 or P1 that you could not fix inside the stage, and name what
established it. End with one line:
`VERDICT: ship it` / `VERDICT: ship it after fixing <IDs>` / `VERDICT: do not ship`.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- Whether the equation rebuild can be handed a cell whose TeX itself contains `&` or `\\` at the
  top level, and what it does then.
- Whether an `<img>` made from an `<object>` can carry an address scheme the object would not have
  been allowed to load.
- Whether lifting a `foreignObject`'s children out of an SVG can move script-bearing or styled
  content somewhere the sanitiser treats differently.
- Whether `textRoundTables` removing every `<table>` (not only stamped ones) matters.
