# C3's three GPT Sol reviews, verbatim

The reviews behind § C3 of
[260904e-extraction-repair-evals-and-llm-post-processing.md](260904e-extraction-repair-evals-and-llm-post-processing.md),
kept because **each one found a reader-reachable defect the previous had not**, and the plan cites
their findings rather than reproducing them. Three rounds in one day: the plan before any code was
written, the built code, and a narrowly scoped re-check of the fixes for the second round's P0s —
the last under [engineering-manager.md](../reusable/engineering-manager.md)'s clause that *"an
established P0 whose final fix was not in the round-two snapshot still gets a narrowly scoped check
of that fix."*

**Not everything here is right**, and that is part of why it is kept. Round three's rule-B
reproduction does not reproduce as written — it uses `<section>` wrappers where the loss needs
`<article>` — and the plan records the two reasons why. Round two's attribution of a deleted table
row to Readability was wrong; our own furniture pass deletes it. Read these as evidence, not as
verdicts.

The prompts they answered are not kept: they are long, and each one's substance is the list of
claims it asked to have attacked, which the plan states in its own voice.


## Round one — the plan, before any code was written

Do not build C3 as written. Build a narrower version: recover the four demonstrated `header`-collision tables and the exact PLOS correction topology. Drop the generic table rescue, the shared token, and the unattested correction vocabulary.

## Findings

### P0-01 — the shared `content` token can truncate the article

File: [plan:2983](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:2983)

`spya-keep-content` does more to Rule A than defeat `unlikelyCandidates`: it gives the table +25 class weight. Tables become candidate ancestors while their `<td>` descendants are scored ([Readability.js:1230](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/node_modules/@mozilla/readability/Readability.js:1230), [Readability.js:2142](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/node_modules/@mozilla/readability/Readability.js:2142)).

I reproduced a qualifying `table.sticky-header` with a caption, six rows, and genuine prose on both sides:

- `spya-keep-column`: 1,568 characters, table and both prose regions preserved.
- `spya-keep-content`: 1,368 characters, both prose regions gone and the table converted to a `<div>` after becoming the top candidate.

That is the exact candidate-scoring failure you suspected. The corpus does not contain this score topology.

What settles it: Rule A must use a token that matches `okMaybeItsACandidate` but not `positive`, such as `spya-keep-column`, plus a synthetic end-to-end case asserting the table remains a table and both neighbours survive. Rule B can separately use a positive token. One token per job.

### P0-02 — `wiki_ar_ai` is a known false positive, not a newly recovered evidence table

File: [plan:3022](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:3022), fixture [wiki_ar_ai.html:1284](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/evals/extraction/fixtures/wiki_ar_ai.html:1284)

The recovered element is:

```html
<table class="sidebar sidebar-collapse nomobile nowraplinks hlist">
```

It has 61 links and says “Part of a series on Artificial intelligence,” followed by a taxonomy of topics. It is navigation furniture. The parallel English `wiki_transformer` table is the same sidebar shape but also carries `role="navigation"`, explaining why its stamp has no effect.

This disproves the general ordering argument. `_markDataTables`’ accessibility/layout heuristic is not intended to overrule an explicit `sidebar` declaration during candidate pruning.

What settles it: require that `header` is the sole reason the table matches `unlikelyCandidates`—after neutralising `header`, no unlikely term remains. Across all 35 fixtures, that selects exactly the two GDP tables and two ar5iv tables; it selects neither sidebar. The adversarial assertion should require zero stamps and byte-identical output for both Wikipedia sidebars.

### P0-03 — the earlier 239-row claim is false for the current pipeline

File: [plan:2901](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:2901)

The current result is 238, reproducibly:

- Main GDP table: 223 output rows.
- Regional/grouping table: 15 source rows, but its final row is empty and Readability removes it, leaving 14.
- Existing map-legend table: 1 row.
- Total: `223 + 14 + 1 = 238`.

The 239 figure counted the empty raw-source row as surviving. The rewritten table’s 238 is correct.

What settles it: record these per-table counts rather than only the document total.

### P1-01 — the proposed `_markDataTables` “mirror” is not a mirror

Files: [spike:15](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/data/scratch/C3-spike-corpus.mts:15), [Readability.js:2240](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/node_modules/@mozilla/readability/Readability.js:2240)

Differences include:

- Readability adds `rowspan` found on each `<tr>`; the mirror uses `table.rows.length`.
- Readability counts descendant `<td>` elements only; the mirror counts every direct child.
- Readability parses `colspan` with `parseInt`; the mirror uses `Number`.

All 192 corpus tables happen to agree. Two constructed cases do not:

- Two rows with `colspan="3x"`: Readability `true`, mirror `false`.
- Two `<tr rowspan="6">` rows: Readability `true`, mirror `false`.

Do not call the private method in production: it replaces a small copied dependency with an underscored runtime API and still classifies the Arabic sidebar as data.

What settles it: preferably avoid the numerical tail entirely—the four desired tables all have a non-empty caption or `<th>`, and are uniquely selected by the sole-`header` collision. If the full mirror remains, copy it exactly and add parity mutation cases against the private method in tests.

### P1-02 — Rule B’s scope and “safe asymmetry” argument do not hold

File: [plan:3056](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:3056)

There are three unattested tokens, not four: `correction`, `erratum`, and `retraction`. More importantly, the stated narrow alternative—`amendment` alone—does not work:

- Parent `div.amendment` only: no correction, date, or DOI recovered.
- Child `div.amendment-citation` only: likewise.
- Both: 28,112→28,460 characters; correction, date, and DOI all recovered.

A false match also does not merely “keep one block.” A constructed `div.correction` given positive weight became the preferred candidate and dropped neighbouring genuine paragraphs. Candidate selection is global.

What settles it: recognise the measured PLOS topology—an outer `div.amendment.amendment-correction` with its `div.amendment-citation` child—and stamp both. Add other publishers only with positive and adversarial fixtures for their actual topology. No registry is justified yet.

### P1-03 — the table oracle cannot compare raw source and output as currently specified

File: [plan:3075](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:3075)

The current GDP fixture already contains legitimate differences:

- The regional table is 15 source rows versus 14 output rows because the last source row is empty.
- A GDP cell’s source `textContent` contains inline stylesheet text that `_prepArticle` removes.
- The ar5iv tables have no `<caption>`; their labels are sibling `<figcaption>` elements.

Matching by caption plus first-row signature is also unnecessarily fuzzy. The provenance instrument already stamps exact source identities.

What settles it: define the source snapshot point and allowed normalisation explicitly, match tables by provenance ID, remove non-visible nodes before text comparison, and explicitly normalise wholly empty rows if that is accepted Readability behaviour.

### P1-04 — coordinate text alone misses semantic table corruption

File: [plan:3075](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:3075)

A table can retain identical row counts, cell counts, and coordinate text while:

- `<th>` cells become `<td>`.
- `rowspan` or `colspan` disappears.
- Header associations or row groups change.
- Links disappear while their text survives.

This is concrete here: recovered ar5iv Table 2 contains one `rowspan` and four `colspan` attributes. Removing them would pass the proposed oracle while changing the table’s meaning.

What settles it: the semantic cell projection should include at least tag name, normalised visible text, `rowSpan`, and `colSpan`. Mutation tests deleting a span or converting `th` to `td` must make the oracle fail.

### P1-05 — the current residual script does not establish its unchanged-output claim

File: [C3-spike-corpus.mts:83](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/data/scratch/C3-spike-corpus.mts:83)

For a zero-stamp fixture it sets `b = a`; it never runs the treatment arm. It then compares only table, row, and character counts. Its catch also turns every exception—not only the capability floor—into `-1`.

There are 30 zero-stamp fixtures, not 31: ar5iv, PLOS, Arabic Wikipedia, GDP Wikipedia, and Transformer are the five stamped fixtures.

I independently replayed the exact existing `prepareDocument` sequence, inserted the proposed pass in the same DOM, and compared the complete Readability article objects: all 30 were byte-identical, including the two refused pages’ underlying results. So there is no discovered output P0 here; the problem is that the supplied spike does not prove the claim.

What settles it: the durable corpus test must actually execute both arms, compare `extractedHtml` bytes, and separately assert the typed refusal for `medium_about` and `pmc_article`.

## What is fine

- The central diagnosis for the four intended tables is correct: they die before `_markDataTables` solely because `header` appears inside a class token.
- A pre-Readability pass in `prepareDocument` is the correct architectural location.
- A class-token adapter to Readability is acceptable if each token has one job and end-to-end tests pin both its intended effect and candidate-scoring boundary. With the lockfile pinning Readability 0.6.0, a dependency bump should then fail loudly.
- The PLOS two-element repair works and restores the heading, date, and DOI.
- `wiki_transformer`’s one-stamp/no-output result is reproduced; it is useful evidence that the broad predicate is wrong.
- Shrinking C2 to a table-specific semantic check is sound. The proposed oracle needs tightening, not restoring to the old containment system.
- The exposure ladder, counterfactual, real-pipeline wiring test, and independently authored adversary are all appropriate.

## Recommended C3

Build less, not none:

1. Rule A: only tables whose sole unlikely substring is `header`, with a caption or `<th>`, using a non-positive `spya-keep-column` token. This recovers four material tables and excludes both known sidebars.
2. Rule B: only the measured outer/inner PLOS amendment topology, using its separate positive token.
3. Match oracle tables by provenance ID and compare a small semantic projection including cell kind and spans.
4. Report four recovered content tables—not five—and keep the remaining table losses explicit.

Four missing evidence tables, including captions pointing at absent results, plus a deleted correction notice are worth this reduced stage. The general registry, full heuristic mirror, and speculative correction vocabulary are not.

Both spikes were rerun via `node --import tsx` because the sandbox denied `tsx`’s IPC socket. No files were changed; the worktree remains clean.

## Round two — the stage as built, at `ab0dd5c5`

The gold is defective and should be fixed in C3. I would not ship this commit unchanged: I found three reader-relevant P0s, plus false instrumentation/documentation claims under your severity definition.

## Gold decision

Change `articleRegion.within` in [plos-biology.manifest.json](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/evals/extraction/fixtures/plos-biology.manifest.json:50) to:

```json
"within": [
  "div#artText",
  ".article-content > div.amendment.amendment-correction"
]
```

Keep `except: ["ul.reflinks"]`.

Measured on the prepared source and shipped extraction:

| | Current region | Corrected region |
|---|---:|---:|
| region characters | 23,330 | **23,521** |
| credited characters | 22,659 | **22,850** |
| `articleRecall` | 0.97124 | **0.97147** |
| `regionPrecision` | 0.97270 | **0.98090** |

Following the existing “5%, rounded down to 100” policy, `minArticleChars` becomes **22,300**.

This is not gerrymandering because the added selector names the complete semantic correction root, selected from the source before inspecting extraction output. It is independently supported by the pre-existing heading inventory and `h2.atLeast: 12`; it does not select only the descendants C3 happens to recover. All published region and floor numbers should move together.

## Findings

### P0-01 — Rule A knowingly turns a better extraction into a truncated one

[src/protect.ts:58](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:58), [extract-protect.test.ts:1018](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/tests/extract-protect.test.ts:1018)

At 24 and 40 rows, enabling Rule A deletes all four surrounding prose paragraphs; disabling it preserves them. The fact that an otherwise identical table without `header` triggers the same Readability failure explains the mechanism, but does not absolve this pass: Rule A is the action that changes the real header-named page from “prose, missing table” to “flattened table, missing prose.”

The current test reproduces the reader regression and treats it as accepted behavior. That is the same failure class for which the positive table token was rejected at 12 rows.

Evidence that would settle it: treatment must retain the intended table without losing any prose present in the disabled arm at 12, 24 and 40 rows. One plausible narrow fallback is to use the disabled extraction when a stamped table still fails to survive as a `<table>`.

### P0-02 — The claimed ancestor-guard mirror is not a mirror

[src/protect.ts:288](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:288), [src/protect.ts:295](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:295)

Readability’s `_hasAncestorTag` checks only four ancestor levels by default. `parentElement.closest("table, code")` searches without a depth limit.

I reproduced the consequence:

- Shallowly nested qualifying table: unstamped and survives because Readability sees its table ancestor.
- The same table beneath four extra `<div>` wrappers: still unstamped, but Readability no longer sees the distant table ancestor and deletes it.

So Rule A declines a table on the claim that Readability cannot delete it, and Readability deletes it.

Evidence that settles it is already present in the pinned dependency. Add shallow and beyond-depth cases, then mirror `_hasAncestorTag`’s actual depth rather than using unbounded `closest()`.

### P0-03 — The source-candidate oracle still contains the exact broken algorithm

[extract-protect.test.ts:267](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/tests/extract-protect.test.ts:267)

`sourceCandidates().headerSole` still removes `/header/gi` and retests at lines 273–275—the substitution the adversary proved wrong.

I reproduced:

```text
headerelated
helperSaysSole: true
actualRuleSaysSole: false
```

Thus the claimed first rung of the exposure ladder disagrees with shipped recognition on the adversary’s defining input.

Evidence that settles it: pass `headerelated` through this helper and require `headerSole: 0`, using an independent correct oracle or `UNLIKELY_EXCEPT_HEADER`.

### P0-04 — The canonical extraction doc gives the wrong cause of row 15 disappearing

[content-extraction.md:347](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/docs/project/content-extraction.md:347), [extract-protect.test.ts:306](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/tests/extract-protect.test.ts:306)

Both say Readability drops the empty regional row. The plan and oracle correctly establish that `removePlatformFurniture` deletes `.mw-empty-elt` before Readability or the oracle snapshot.

Already settled by the post-`prepareDocument` source having 14 rows.

### P1-01 — Rule B is broader than its evidence, and the test converts that deferral into a contract

[src/protect.ts:315](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:315), [extract-protect.test.ts:1126](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/tests/extract-protect.test.ts:1126)

Use `:scope > div.amendment-citation` for this stage. PLOS’s measured citation is direct; the current test expressly requires a citation buried inside an unrelated `<aside>` to qualify. Given that positive weight can globally displace prose, “three constructions did not break it” is not evidence for widening.

“Pinned current behavior” is therefore a deferral wearing a test. Broaden only when a real wrapped notice fixture establishes the need and receives its own adversarial case.

Evidence that would reverse this: a real publisher fixture with a wrapped citation, plus treatment/control evidence that the wider outer stamp loses no authored prose.

### P1-02 — Regex parity does not fully protect a Readability bump

[src/protect.ts:180](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:180), [extract-protect.test.ts:220](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/tests/extract-protect.test.ts:220)

The current derivation is sound for 0.6.0. It requires `|header|` to remain a complete alternative occurring exactly once; the derivation test catches absence, duplication and several behavioral examples.

Anchors or groups do not inherently break it, and `header` being a prefix/suffix of another alternative is not itself a problem—the original-string retest is precisely what catches overlapping alternatives.

What is not pinned:

- Regex flags: parity compares `.source`, not `.flags`.
- Changes to the deletion branch, match string or ancestor behavior while the regex source stays unchanged.
- A structurally different regex that still happens to contain the literal `|header|`.

Evidence that settles it: compare live/copied flags, and make a Readability bump explicitly revalidate the whole line-1119 condition and the ancestor-depth cases.

## Explicitly fine

- The test seam is acceptable as built. Threading a parameter would touch `runExtract → readArticle → prepareDocument`, expose a test mode across three signatures, and still leave test-only branching in shipped code. No production caller invokes the disabling export, and this file runs sequentially. A never-settling thenable has not “left” the dynamic extent; any never-settling Promise has the same property.
- `kept` counts are now true. I checked a document triggering both rules: it reports one table and two correction elements, matching the stamped DOM. A single element cannot qualify for both because Rule A selects `<table>` and Rule B selects `<div>`; [src/protect.ts:279](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:279) should stop claiming otherwise.
- The oracle is working within its declared projection. The 53 disagreements are 50 correlated HN tables and one each in WHATWG, arXiv and Blogger—not 53 independent failure families.
- A corruption it cannot see: moving an unchanged header row from `<thead>` into `<tbody>`. I reproduced that `compareProjections` returns `[]`; it records cells, not row-group ownership or attributes such as `scope`/`headers`. That is an honest scope limit, not evidence the current instrument is broken.
- The two Wikipedia negatives, two-token separation, PLOS both-or-neither behavior, `ExtractResult.kept` threading, and pipeline audit logging all look sound.
- I found no additional real corpus false positive for Rule A. An attested external boundary is a detached `table#header` containing `<th>` cells paired with a separate data table; the current predicate would stamp that incomplete header shell. It is a useful fixture lead, not yet a reproduced reader failure. [Example markup](https://mdbootstrap.com/support/angular/big-list-with-drop-down-list/)

Tests run:

- `tests/extract-protect.test.ts`: **32/32 passed**, 138.58s.
- `tests/table-oracle.test.ts`: **20/20 passed**, 10.34s.
- Full oracle census independently reproduced **118 traced / 65 agree / 53 differ / 74 absent / 0 untraceable**.

No repository files were changed; the worktree remains clean.

## Round three — the narrow re-check of the P0 fixes, at `f61df365`

Verdict: not ready to land. The narrow re-check found two reproducible P0s in the fallback and one P1 in the declared instrumentation divergence. Everything else checked cleanly.

## Findings

- **P0-01a — the 100-character floor allows complete prose loss.** [src/protect.ts:541](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:541), [src/protect.ts:573](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:573)

  I reproduced a header-named 24-row table beside eight distinct authored paragraphs of 99 characters each. The control returned all eight paragraphs and 800 text characters; the treatment returned none of them and 1,781 table characters. `proseRetention` reported `{ runs: 0, lost: 0, retained: true }`, so `kept` remained `a-table-called-header` rather than rolling back.

  The 100 floor is therefore fixture-tuned, not a defensible definition of prose. Short news paragraphs, Q&A answers, list prose, poetry, and concise technical documentation routinely fall below it.

  Containment is the right primary comparison, and length is definitely wrong. But the known Wikipedia false positive should be excluded semantically—ideally as verified furniture such as `#siteSub.noprint`, or through source provenance—not by making every 25–99-character authored run invisible. Restore the 25-character basis and explicitly exclude the known chrome. A regression using several sub-100-character paragraphs settles this.

  Another inherent containment blind spot is a paragraph duplicated in a table or footnote: its main occurrence can disappear while the identical string elsewhere makes `retained` true. That is acceptable only if the invariant is explicitly “words retained somewhere,” not “the prose occurrence retained.”

- **P0-01b — rule B can independently delete prose and never enters the fallback.** [src/extract.ts:421](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/extract.ts:421), [src/protect.ts:412](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/protect.ts:412)

  I reproduced this with the exact accepted topology: `div.amendment.amendment-correction` containing a direct `div.amendment-citation`, no qualifying table anywhere, and four section-wrapped authored paragraphs beside it. With rule B enabled, the stamped notice won candidacy and all four paragraphs disappeared: 675 characters and zero prose markers. With protection disabled, all four remained: 1,031 characters. `kept` reported `{ "an-amendment-correction": 2 }`.

  Because `rescued === 0`, [src/extract.ts:422](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/extract.ts:422) returns immediately. The plan-stage positive-token failure therefore remains reader-reachable after narrowing the selector.

  Settlement requires prose-retention control for rule B as well, including the case where A and B both stamp. The regression must use the exact direct-child topology and show the unprotected prose survives in the shipped result.

- **P1-02 — the provenance arm already demonstrably diverges on the fallback’s synthetic page.** [src/extract.ts:840](/home/greg/code/spideryarn2/.claude/worktrees/extraction-stage-c/src/extract.ts:840)

  On a 24-row rollback construction, `readArticle` returned four prose markers and `a-table-called-header-rolled-back`; `readArticleWithProvenance` returned zero prose markers and `a-table-called-header`. The respective serialized content lengths were 1,323 and 3,805.

  This is not dead behavior; it lacks a corpus fixture, but the committed fallback construction exercises it. The eval’s “shipped” arm will inspect the discarded treatment on the first real rollback page. That is a design that will not survive contact, so it should close in this stage. A byte-equivalence test between the selected shipping result and source-ref-stripped provenance result on a rollback page settles it.

## Fine

- **P0-02 ancestor guard:** correct. Readability checks four ancestors: depths 0–3 correspond to parent levels 1–4; it returns false before checking level 5. The shallow and beyond-depth tests pin the boundary correctly.

- **P0-03 exposure oracle:** genuinely independent enough. It derives alternatives from the live library regex and tests each against the untouched source string; the shipped rule uses the pinned copy with a differently derived combined regex. The overlapping `header…` cases now correctly produce `headerSole: 0`.

- **P1-01 citation topology:** correct. `:scope > div.amendment-citation` matches the measured PLOS topology and declines the buried construction.

- **Gold widening:** the two-arm measurement alone would not disprove gerrymandering—a selector drawn around treatment-only output would produce the same favorable direction. Here it is sufficient in combination with the independent, pre-existing annotation that counted Correction among the article’s twelve `<h2>` sections, plus the exact one-root selector and region-size tripwire. The floor arithmetic is consistent.

- Requested test passed: **1 file, 35/35 tests**, 287.21 seconds.

No files were changed.
