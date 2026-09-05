# Empty blocks re-minted their ids on every extraction

**Found 2026-09-05**, by measuring, not by a report. Nobody had noticed: the blocks involved have no
text, so nothing anybody had made was sitting on one — luck rather than design, as § *Why a churning
id was not harmless* explains. It surfaced while stage A
of [260904e](../plans/260904e-extraction-repair-evals-and-llm-post-processing.md) was checking
whether the new `<pre>` handling churned any block ids. It did not — but the ruler said **218 ids
churned anyway**, on both arms of the comparison, and the explanation first written for that number
("an ambiguous folded bucket") was wrong. GPT Sol caught the wrong explanation; re-investigating it
found something larger than a wrong explanation.

Fixed 2026-09-05 in [`src/blocks.ts`](../../src/blocks.ts) § `exactKey` and `emptyKey` — a one-line
change in the first draft, and § *The fix* is largely about why one line was not enough. Pinned in
[`tests/empty-blocks-keep-their-ids.test.ts`](../../tests/empty-blocks-keep-their-ids.test.ts).

## What actually happened

Stage 3 keeps a block's id across a re-extraction by matching this run's blocks against the previous
run's, on a key computed from the tag and the text
([block-ids.md § Two passes](../project/block-ids.md#two-passes-and-the-second-one-refuses-to-guess)).
A block with no written text is keyed on its `src` instead — an image or a figure has nothing else to
match on. And a block with **neither**:

```ts
const src = /\bsrc="([^"]+)"/.exec(html)?.[1];
return src ? `s:${tag}:${src}` : null;   // ← the bug
```

`bucketBy` skips a `null` key. So an `<hr>`, an empty `<p>`, an empty `<li>` or a `<figure>` the
sanitiser had emptied was **in no bucket on either side of the match** — not matched and not
mismatched, simply absent from the comparison — and every one of them minted a fresh id on every run
over byte-identical input. All three passes agree: `foldedKey` and `legacyKey` return `null` for it
too.

Measured over the 35 committed corpus fixtures, re-splitting stage 2's own output with the previous
run's blocks in hand:

| | before | after |
|---|---|---|
| ids re-minted with no word changed | **218** | **0** |
| fixtures whose blocks fingerprint flips | **17 of 35** | **0** |
| fixtures where the Postgres `blocks` step reports itself done | 18 of 35 | **35 of 35** |

The 218 are 122 `<p>`, 59 `<hr>`, 30 `<li>` and 7 `<figure>`. The other 84 text-less blocks in the
corpus have a `src` and carried fine throughout.

> **How that table was made, since the script is not kept** (2026-09-05, `ALL_FIXTURES` at 35). Each
> fixture through `runExtract` → `runBlocks` with `previous: undefined`, then `runBlocks` again over
> **the same `extractedHtml`** with the first run's blocks as `previous` — which is the Postgres
> shape, where stage 2's html carries none of our ids. Re-mints from `idChurn`, the flip from
> `hashBlocks` either side, and "done" by re-implementing `blocksMatchTheirHtml`'s three questions
> against the two html strings directly. The filesystem arm is the same thing with `stampedHtml` fed
> back in as the input. `evals/extraction/block-census.mts` walks the same route and is committed; it
> does not yet carry a churn column, which is item 4 below.

## Why a churning id on an `<hr>` was not harmless

Two machines read the id, and so — it turns out — can a reader.

- **`hashBlocks`** ([`src/source-hash.ts`](../../src/source-hash.ts)) hashes `id` and `text`, on both
  of its branches. So half the corpus reported a changed article after a re-extraction that changed
  no word, taking `assets`, article vectors, `projection`, `similar`, saved searches and `labels`
  stale with it, and `reasonsNotToPublish` compares the same fingerprint against hierarchy's
  `input_hash`.
- **`blocksMatchTheirHtml`** ([`src/pipeline.ts`](../../src/pipeline.ts)) re-derives the document and
  compares it to `stampedHtml` byte for byte. Under Postgres, `extracted_html` carries none of our
  ids, so these blocks could neither reuse nor carry: they minted, the html differed, and **the
  `blocks` step never reported itself done** for 17 of the 35 fixtures. Production is Postgres.

`assertIdsCarried` needs only *one* id to survive a run, so it never fired.

**And "nothing a reader owns can be attached to these blocks" is wrong**, which is worth recording
because this write-up said it, the code comment said it, and the contract doc said it — one claim,
repeated in five places, checked in none. What is true is narrower: a *comment* is `blockId` + the
exact `quote` + a `start` offset, in that order of authority
([comments.md](../project/comments.md#the-two-questions)), so a block with no text cannot hold one;
and the saved reading position stores a *section*, not a block
([url-state.md § The unit is a section](../project/url-state.md#the-unit-is-a-section-not-a-position)).
But a **chat** is anchored by `{ blockId }` alone when it is started from a paragraph's chat button
(`Chat.about`, [`src/types.ts`](../../src/types.ts)), and every rendered block gets that button and a
permalink from `BlockGutter` — including an `<hr>`. So the true statement is *nobody happens to have
anchored anything to one*, and the reason the damage stayed machine-side is luck. GPT Sol,
2026-09-05.

## The commit, and the sentence in its own message

`84ce16bf`, **2026-08-24**, *"Carry block ids across re-extraction"* — the commit that introduced
carry-over at all, and a correct and necessary one: before it, re-running stage 2 re-minted all 139
ids of the test article, which is the precise failure random ids were chosen to avoid. It added
`exactKey`, the `src` fallback and the "each previous id is consumed once" rule that still hold.

Its own message contains the whole of this bug, seen and dismissed:

> Measured: re-extracted with a new paragraph inserted above everything, 138/139 ids survive. The
> one loss is an `<hr>`, which has nothing to match on.

That is not one `<hr>` on one article. It is every text-less, source-less block on every article,
unconditionally, for ever. The `<hr>` was read as a casualty of *that* measurement rather than as
the visible member of a class, and the sentence was copied into
[block-ids.md](../project/block-ids.md) where it read as a footnote for the next fortnight.

## It was pinned as a test, described as a limit

There was a passing test asserting the bug, in `tests/blocks.test.ts`:

```ts
it("re-mints blocks that carry neither text nor a src — currently just <hr>", () => {
  // Not a bug so much as the honest limit of matching on content: a rule has
  // no content. […] Pinned here so a future fix is a deliberate one.
  expect(rule(second)).not.toBe(rule(first));
```

That test is the best thing in this story and the worst. Best, because it named the exact behaviour
and asked for the fix to be deliberate, and this one is: the assertion is now `.toBe` and the comment
says what changed. Worst, because writing a limitation down converts it from a thing that might get
looked at into a thing that has been decided — and **nobody had traced what the limitation cost**.
The distance between "an `<hr>` gets a new id, and nobody annotates an `<hr>`" and "a step in the
Postgres pipeline can never report itself done" is five minutes of following the id into
`hashBlocks`, and it was never walked in either direction.

The lesson is narrow and worth having: **when you pin a known limitation, pin its blast radius in
the same breath.** A comment that says what the limit *is* should also say who reads the value that
is unstable. If you cannot name them, you have not established that it is a limitation rather than a
defect.

## The class: a key function allowed to say "no key", and nothing counting what fell out

**`null` at a matching seam does not mean "matches nothing". It means "is not equal to itself".** A
key function is the definition of identity for the thing it keys; giving it an escape hatch removes
items from *both* sides of the comparison at once, so the two sides cannot disagree and no
consistency check can notice. Every downstream number stays plausible: `carried` is high, `minted`
is small, `assertIdsCarried` passes, the run reports success. The failure is invisible **because**
the mechanism is symmetric — the same property that makes carry-over work at all is what hides this.

The fix is not a better `null`. It is that **`null` must mean a decision, not an omission**: where
the only honest key is "the third `<hr>` of this document", say that rather than saying nothing —
and where there genuinely is no key, the refusal has to be *deliberate and visible*, the way pass
two's ambiguous-bucket refusal is, rather than a value that quietly deletes the block from the
comparison.

**This fix is partial and it is worth being exact about which part**, because "make the function
total" is the tempting summary and it is not what shipped. A text-less block with markup in it —
`<figure><svg>…</svg></figure>` — still returns `null` and still re-mints on every run: it is a
member of the same class, deliberately left in it, because keying it needs the structural digest
described below. What changed is that the *empty* blocks left the class. The rest of them are named
here so the next reader knows the class is not closed.

The general shape, for whoever is reading forty of these: **a partial function at a seam whose two
sides are computed by the same code**. Look for `| null` on any function whose output is compared
against itself across two runs, two stores or two processes, and ask what happens to the items that
return it. If the answer is "they are skipped", the skip needs a counter or the function needs to be
total.

### And the reason it survived a fortnight: the number was measured on the arm that cannot show it

[block-ids.md](../project/block-ids.md) carried a clean idempotence measurement the whole time, and
it was honestly obtained. It was taken on the **filesystem** store, where `extractedHtml` and
`stampedHtml` are one file — so stage 3 re-reads a document that still has last run's ids in it and
**reuses them off the document**, never asking the matcher anything. The property "ids are stable"
was satisfied by a second, cheaper mechanism that masked the one under test. On Postgres the two are
separate columns and only the matcher can answer.

That is [silent-success](../reusable/silent-success.md) with a twist worth naming on its own: not a
check that shares an assumption with the code, but **a check run against the one implementation that
satisfies the contract by accident**. When two backends implement one contract, a measurement taken
on one of them measures that backend, not the contract — and the arm you reach for first is
generally the convenient one, which is generally the one with the extra mechanism in it.

## The fix that is right for the long term

Key such a block in pass one on **everything it has**, which for a block with nothing in it is its
tag and its attributes — and give it a key at all only when there is genuinely nothing in it:

```ts
if (src) return `s:${tag}:${src}`;
return emptyKey(tag, html);   // `e:hr:class=section-break`, or null if it has children
```

Position among the *identical* empty blocks of its own tag is the only signal these blocks have, and
pass one already hands a shared bucket out in document order, consuming each id once — the same rule
that keeps every repeated `<li>Yes</li>`'s id today, and blessed for the same reason: two blocks that
really are alike may trade ids, *because they are alike*. Two blocks sharing this key are the same
element, with the same attributes, and nothing inside either of them.

> **The third clause was not in the first version of this fix, and its absence was a real bug that
> shipped as far as review.** `<figure><svg>…</svg></figure>` — an inline diagram — has no text and
> no `src` either, so keying on the tag alone made two diagrams interchangeable: GPT Sol reordered
> two of them and the circle's id landed on the rectangle, with `minted: 0` and an unchanged
> fingerprint reporting that all was well. I reproduced it before changing anything. That is exactly
> the "attached to a different claim" failure block-ids.md forbids, and it is *worse* than the bug
> being fixed, because a wrong anchor beats a lost one only in a world where nobody looks.
>
> Two lessons, both cheap. **"Has no text" is not "has no identity"** — this file has now been wrong
> about what counts as content three times (Latin-only folding, `\S` as a test for emptiness, and
> now this), and each time the wrongness was invisible in English prose and obvious in the case
> nobody pictured. And **a fix that widens a match is the same shape of risk as the bug it fixes**:
> the original bug made blocks match nothing; the naive fix made blocks match too much. The safe
> version of "key this by position" always carries a clause saying *when position is all there is*.
>
> **Asking that question once more found a second case, unprompted**, and it is the reason the key
> carries attributes: `class` and `data-*` survive the sanitiser, so `<hr class="section-break">` and
> a plain `<hr>` are two rules a page draws differently, and tag alone made those interchangeable
> too. Same shape, one step less visible than the `<svg>`. The generalisable move is to write the
> predicate as *"is there anything at all here that could tell two of these apart?"* and then
> enumerate what "anything" can be — text, a pointer, children, attributes — rather than checking the
> case that prompted the question.

A text-less block that *has* markup therefore goes on minting, exactly as before — a lost anchor is
safer than a moved one. Keying those properly means a structural digest of the html with our own ids
normalised out, which is the deferred alternative below.

**And position is trusted only where the count has not moved.** `carryOverIds` refuses an `e:`
bucket outright when the two sides hold different numbers of it: add one rule to an article and every
rule in it mints, rather than each id sliding onto the rule below. I argued against that first —
"churn on a real edit" — and Sol was right and I was wrong, for a reason that settles it rather than
balances it: **the refusal costs no fingerprint at all**, because `hashBlocks` runs over every block,
so an article that gained or lost one has a different fingerprint whatever these ids do. The only
thing given up is the anchors on the *other* rules, and a lost anchor is the safer failure. Nothing
was being traded away; I had simply not checked what the "churn" consisted of.

Two things about that guard are worth having in writing, both of them Sol's, both found by running
it rather than reading it:

- **It compares net counts, and no more.** Remove one rule and add another and the count is
  unchanged, so the ids slide by one after all. That residual is the same irreducible ambiguity the
  contract already accepts for two paragraphs that read alike, and it is now a test rather than a
  claim — the first version of this paragraph said "nothing was inserted or removed", which is a
  stronger thing than the code does.
- **The two counts have to be the same population.** `carryOverIds` receives only the *pending*
  candidates — anything already carrying one of our ids was settled before it was called — while its
  bucket holds every previous block. So a part-stamped document (one rule with its id, one without)
  looked like an article that had lost a rule, and the survivor re-minted for nothing. It counts the
  ids nobody has claimed yet. Reproduced as a failing test first, in both directions.

The behaviours are asserted rather than assumed, in `tests/empty-blocks-keep-their-ids.test.ts`
(21 tests, every one of them watched red against the code state it guards):

- two `<hr>`s keep their two ids, in order, and an inserted paragraph does not swap them;
- two `<hr>`s with **different classes** keep their own ids when they are reordered, and one whose
  `class` value spells another's whole attribute list does too — the key is JSON, for the injectivity
  reason `keyOf` already gives;
- `<p></p>` and `<p>&#160;</p>` are not the same paragraph, though `\s` folds both to nothing;
- an empty `<p>` and an empty `<li>` keep their own ids **when they trade places**, which is what
  separates "one bucket per tag" from "one bucket for every empty block";
- removing, inserting or appending a rule **refuses the whole `<hr>` bucket**, and refuses only that
  bucket — adding an empty `<p>` leaves the rules alone; a removal and an insertion that cancel out
  are **not** caught, and say so;
- a part-stamped document — one rule carrying its id, one not — carries both;
- two `<figure>`s wrapping different SVGs mint rather than trading ids;
- and the real `STEPS.blocks.isDone`, given a Postgres-shaped store whose `extractedHtml` carries no
  ids, answers **true** for an article containing an `<hr>`.

**One limitation is accepted, and — learning from the `<hr>` above — here is its blast radius.** The
key leaves out `id`, because that is the one attribute the two sides are guaranteed to disagree
about: a stored block carries ours, having overwritten the author's. So two empty blocks of one tag
differing *only* in an author-written id trade ids if a page reorders them. Who reads that: a chat
anchored by block id would move to the other one; a comment cannot be there (it needs a quote); the
reading position is a section; the author's own `#alpha` anchor is unaffected, because retargeting is
re-resolved from the current document every run; and `hashBlocks` does not move, because both ids are
still present. Sol argued for refusing such a block instead — and that was **measured before it was
declined**: refusing every named empty block leaves 33 blocks re-minting on 3 of the 35 fixtures,
and refusing only the ones that could actually trade — a bucket with more than one member — still
leaves 29 on 2 (26 in rfc9110's named empty `<li>`s, 3 distill figures; Sol's recount, and the
tighter of the two numbers is the fair one to quote). Either way those fixtures go on flipping their
fingerprints and never reporting the step done. A tenth of the corpus keeps the original bug, to buy safety in a case needing an author to
reorder two *empty* named blocks of one tag. Pinned as a test that says all of this.

**Three alternatives, weighed and refused.** An ordinal inside the key is the sequential-id failure
[block-ids.md § Why random and not sequential](../project/block-ids.md#why-random-and-not-sequential)
exists to refuse, and buys nothing this does not. A structural digest of the html needs `spya-` ids
normalised out of it first — and the two sides disagree about more than the id, since a stored
block's html has been through `retargetAnchors` and a candidate's has not — so getting the
normalisation wrong re-mints every empty block in the database on rollout. **That is the one worth
coming back to**, because it is what would let an inline-SVG figure keep its id, which nothing here
does. Neighbour anchoring is the most faithful and by far the most machinery.

**Rollout cost: zero, measured rather than argued.** Five stored filesystem articles (349 blocks) and
77 local Postgres revisions (16,607 blocks) were re-split against their own stored blocks under the
old code and the new — the Postgres shape being the harsh one, since `extracted_html` carries none of
our ids. Not one stored id changed position or owner. What changed is that 7 ids which used to
re-mint no longer do (2 on the filesystem, 5 in Postgres) and 5 fingerprint flips disappeared (2 and
3), counted per store because the same article can be in both. The one article still churning — `revistes-ub-30977`, 4 re-mints — churns identically
before and after: its stored blocks were written by an older splitter that emitted `<h1>` where this
one emits `<h2>`, which is ordinary staleness and nothing to do with this.

## Three review rounds, three defects, each narrower than the last

Worth recording on its own, because it is the most transferable thing here. The fix went to GPT Sol
three times and came back "request changes" three times, and none of the three findings was the same
mistake:

1. **round one** — the key made two inline-SVG figures interchangeable (a whole class of block with
   identity, admitted by a predicate that only asked about text);
2. **round two** — `<p></p>` versus `<p>&#160;</p>`, a non-injective attribute encoding, and the
   argument for greedy consumption being wrong (three narrower versions of "what could tell two of
   these apart?");
3. **round three** — the cardinality guard counted *all* previous blocks against only the *pending*
   candidates, so a part-stamped document re-minted for nothing; and the comment claiming the guard
   meant "nothing was inserted or removed" when it only catches a net change.

Every one was found by running the code, not reading it. The shape to take away: **a change that
widens a match wants adversarial review specifically, and one round is not enough** — each round
closes the case you were shown and leaves the next-narrowest one open, so the question to ask the
reviewer is not "is this right?" but "what else is in this class?". Three rounds cost about ninety
minutes of wall-clock, all of it in the background, against a change that would otherwise have put a
wrong anchor into the one contract everything else depends on.

## What would have caught the class — ranked by ease first, value in the notes

1. **Split twice over byte-identical input and assert zero re-mints — for the whole document, not
   for the blocks you were thinking about.** No fixtures, deterministic, under a second. *This now
   exists*, and it is the cheapest and, for this bug, the highest-value check there is. Note what it
   is not: the repo already had a test over this exact article, and it asserted the re-mint. A
   per-shape assertion records the behaviour you have; a whole-document fixed-point assertion records
   the property you want, and only the second kind can be violated by a shape nobody thought of. The
   generalisation worth keeping: **any function whose output is fed back into itself deserves a
   fixed-point test before it deserves anything else, and the fixed point is the whole output.**
2. **Count what a matching pass declined to key.** `bucketBy` silently drops a `null`; had
   `SplitResult.stats` carried an `unkeyed` count, every run of stage 3 since August would have
   printed a non-zero number nobody had to go looking for. Cheap, and it generalises to every filter
   in the repo that quietly narrows a population. Now partly moot for `exactKey`, which cannot
   decline, but `foldedKey` and `legacyKey` still can.
3. **Run the store-shaped invariants against both arms.** `blocksMatchTheirHtml` is the guard that
   was failing, and it is a *store* question — on the filesystem it compares a document with itself,
   on Postgres it compares two. A parametrised freshness test over both stores would have caught this
   and the callout finding below in one run. More work than 1 and 2, and the highest value of the
   three: it closes the whole "measured on the convenient arm" class rather than this instance of it.
   [database.md](../project/database.md) already says new work runs on `SPIDERYARN_STORE=postgres`;
   this is the test-suite half of that rule.
4. **A corpus-level idempotence column in the census.** `evals/extraction/block-census.mts` already
   walks all 35 fixtures through both shipping stages; a re-mint count per fixture is a few lines and
   turns "did anything churn?" into a run rather than a discussion. Lower value than 1–3 because it
   is an eval nobody is obliged to run, higher than nothing because it is what actually found this.

## What else this turned up, not fixed here

**The `src` key has the same hole, and it predates all of this.** `exactKey` returns
`` `s:${tag}:${src}` `` for a text-less block with an image in it and looks at nothing else, so two
`<img src="same.png">` elements with different `alt` text — a real page's before-and-after pair —
trade ids when they are reordered, `minted: 0` and the fingerprint unchanged. Sol found it while
attacking the new key, 2026-09-05. It is exactly the failure this postmortem is about, one branch
earlier, and the fix looks the same: put the attributes in the key. It is **not** taken here because
the rollout question is different and unmeasured — every stored image block would be re-keyed at
once, and an `alt` that drifts between extractions would then re-mint a figure that carries fine
today. It needs its own measurement over stored articles before it is touched.

**Re-splitting stage 3's own output loses every block's callout context, on the filesystem store.**
`splitIntoBlocks` reads `contextFor` and then calls `scrubReserved(doc, CONTEXT_ATTRS)` — correctly,
because nothing downstream reads the transport and it would otherwise reach the reader twice. But the
scrub happens *before* the document is serialised, so `stampedHtml` carries no `data-spya-callout`,
and on the filesystem store `stampedHtml` **is** what stage 3 is handed next time. Measured on
`mkdocs-tabs`: 8 blocks with `context` on the first run, 8 on a Postgres-shaped re-split (which reads
stage 2's html, where the attribute survives), **0** on a filesystem-shaped one. That is the single
remaining `blocksMatchTheirHtml` failure on the filesystem arm, and it is a separate bug with a
separate fix — probably that stage 3 should stop being handed its own output at all, which is what
`BLOCKS_INPUT_HTML` already says and what the Postgres store already does. Left for its own ticket
deliberately: id assignment and context transport should not be changed in one go.

## See also

- [block-ids.md](../project/block-ids.md) — the contract, and the correction blockquote this closes.
- [260904e § A](../plans/260904e-extraction-repair-evals-and-llm-post-processing.md) — the
  investigation, the four options weighed, and the numbers in their original context.
- [260826d-block-id-matching-non-latin.md](260826d-block-id-matching-non-latin.md) — the previous
  time a key function was wrong about what counts as text, and the previous time every resulting
  failure reported success.
- [silent-success.md](../reusable/silent-success.md).
