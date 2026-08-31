# The paragraph matcher that deletes every alphabet but one

**2026-08-26.** Found while planning [PDF ingestion](../plans/260826c-pdf-ingestion.md), not from a report.
Nobody has pasted a Russian article in yet. When they do, every paragraph in it will lose its id on
every re-extraction, and some of them will hand their id to the wrong paragraph on the way.

> **Fixed the same day**, in [`src/blocks.ts`](../../src/blocks.ts) — all three parts below, plus
> four more that a cross-family review of the landed code turned up
> ([the second review](#the-second-review-and-four-more-ways-to-guess)). Fifteen tests in
> [`tests/blocks.test.ts`](../../tests/blocks.test.ts), red first. See [what landed](#what-landed).
> Everything in the present tense above this line describes the code as it was.

The line was [`src/blocks.ts:84`](../../src/blocks.ts):

```ts
const normalize = (s: string) =>
  s.replace(/\s+/g, " ").replace(/[^a-z0-9 ]/gi, "").toLowerCase().trim();
```

Read it as what it does rather than what it is called. It **deletes every character that is not
`a-z`, `A-Z`, `0-9` or a space.** For English that strips punctuation. For Cyrillic, Greek, Chinese,
Japanese, Arabic, Hebrew or Devanagari it strips the paragraph.

## What that costs, measured by running it

Five things go wrong, and none of them says so.

**1. Every non-Latin paragraph re-mints on every re-extraction.** Two Russian paragraphs, split once
and then split again with the first run's blocks passed as `previous`:
`{ carried: 0, minted: 2 }`, both ids new. [`matchKey`](../../src/blocks.ts) gets an empty text key,
falls through to the image `src` branch, finds no `src`, and returns `null`. No bucket is built, so
no match is even attempted. Every note, comment and ToC row anchored to those paragraphs orphans —
the failure that [block-ids.md](../project/block-ids.md#why-random-and-not-sequential) says random
ids exist to prevent.

**2. Worse: ids swap between paragraphs.** Two different Chinese paragraphs that both contain a year
both normalise to `"2024"`. One bucket, two ids, consumed first-come by `.shift()`. Re-extract with
the paragraphs in the other order and the ids trade places:

```
  first run                            after a re-render that swapped them
  ─────────────────────────            ──────────────────────────────────
  spya-fpqzpm  人工智能在 2024 年…      spya-fpqzpm  但是，关于意识的问题在 2024 年…
  spya-j26sn9  但是，关于意识的问题…     spya-j26sn9  人工智能在 2024 年…

  stats: carried 2, minted 0           ← reported as a complete success
```

`carried: 2` is the stage congratulating itself. This is not "the id was lost", it is "the reader's
note is now attached to a different claim", which is the failure the whole id scheme was designed
around.

**3 and 4. Two paths delete the paragraph outright.**
[`rewrapOrphanText`](../../src/blocks.ts) skips a bare text node whose normalised form is empty, and
[`collectElements`](../../src/blocks.ts) drops an unknown wrapper on the same test.
`<x-article>Ελληνικό κείμενο…</x-article>` beside an English `<p>` yields one block: the English one.
`<span>日本語のテキスト…</span>` yields none. `rewrapOrphanText` was written on 2026-08-25 to fix
exactly this — prose losing its wrapper to the sanitiser and vanishing — and it fixed it for Latin
script only.

**5. A non-Latin caption beside an image is demoted.**
`<p><img src=…> صورة توضيحية…</p>` comes back `kind: "media", gistable: false,
note: "image-only paragraph"`, because [`isImageOnly`](../../src/blocks.ts) asks the same question
the same way. The text is still in `Block.text` and still renders — GPT-5.6-sol was right to correct
an earlier draft of this file that called it deleted — but it gets no gist and no ToC row.

Accented Latin is mangled and survives: `café` → `caf`, `Müller-Lyer` → `mllerlyer`. Deterministic,
so matching works — until the two runs disagree about Unicode normalisation form. `normalize` of NFC
`café` is `caf`; of NFD `café` it is `cafe`. Same word, different key, id lost.

## Root cause

Commit `e672d8e`, "Add stage 3: block splitting with stable random ids", 2026-08-24 23:23 — the
commit that created [`src/blocks.ts`](../../src/blocks.ts). The line is byte-identical in that commit
and has never been edited.

It was **not** inherited. The previous app hashed `textContent.slice(0, 100)` verbatim into a UUIDv5
([original-version/ids.md](../project/original-version/ids.md)), so it had no such filter to copy.
This is a first-draft simplification written here.

The reason it was written that way is legible from `matchKey`'s own doc comment: the drift between
two Readability runs of the same page is whitespace and punctuation — a curly apostrophe going
straight, an entity decoding differently, a line break moving. Stripping punctuation makes the key
immune to all of that, and it is one regex. **`[^a-z0-9 ]` is a correct spelling of "punctuation"
if the only text you have ever looked at is English.** That is the whole bug: a right idea, written
against an alphabet rather than against a category.

Worth noting that the function was read again a day later, carefully, by whoever wrote
[260825h-deterministic-block-ids.md](../plans/260825h-deterministic-block-ids.md) — which calls `matchKey` "a
deterministic and position-free fingerprint" and reasons at length about its properties. The regex is
quoted in that document. Nobody saw it, because nobody was thinking in a second script.

## Blast radius

Small, and entirely inside one file. `normalize` has five callers, all in
[`src/blocks.ts`](../../src/blocks.ts): the four above and the pull-quote dedup probe (lines 288 and
348). Nothing else in `src`, `tests` or `scripts` imports it — the other `String.normalize("NFKC")`
calls in [`src/glossary.ts:129`](../../src/glossary.ts) and [`src/ingest.ts:30`](../../src/ingest.ts)
are unrelated.

**Nothing persists the normalised form**, and that is the fact the whole migration question turns on.
`Block` is `{id, tag, kind, level?, text, words, html, gistable, note?}` — raw text, no key.
`blocks.json` is that array. The planned Postgres `revisionBlocks`
([`src/db/schema.ts`](../../src/db/schema.ts)) stores `text` and `html` raw and has no normalised
column. `sourceHash` hashes raw `id + text`. Stage 3's done-check in
[`src/pipeline.ts`](../../src/pipeline.ts) is file existence, not key comparison.

[block-ids.md § Surviving stage 2](../project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters)
says ids are carried over "by matching a new block to an old one by its normalised text" and never
says what normalised means. So the docs neither record this nor contradict it — which is its own
small lesson, since "normalised" is doing a lot of unexamined work in that sentence.

## Can the fix orphan ids on existing articles?

**No migration loss was measured, and the shape of the code says why.** (An earlier version of this
heading answered a flat "no". GPT Sol's later review was right that the evidence supports the
narrower claim: no loss *on the three articles that exist*, plus a structural argument. NFKC creates
equivalence classes the old key did not have, and the ambiguity rule below deliberately re-mints in
rare cases — so "cannot orphan" is too strong for all possible data.)

[`carryOverIds`](../../src/blocks.ts) builds its lookup map by calling `matchKey` on the *previous*
blocks at run time, in the same process, with the same function that keys the new ones:

```
  previous blocks ──► matchKey ──► map ──┐
                                          ├──► same function, same run
  new blocks ──────► matchKey ──► lookup ─┘
```

The key is transient. Today `café` becomes `caf` on both sides; after the change it becomes `café` on
both sides. The pairing does not move. The only way a change here could orphan anything is if a key
computed by the old code were sitting on disk waiting to be compared against one computed by the new
code, and no such key exists anywhere.

Measured against the three real articles in `data/` — 520 blocks — the old key and a Unicode-aware
key differ for **4 blocks out of 520**, all accented Latin (`Müller-Lyer`, an em dash, a curly
quote). No new collisions, no new null keys, and in the impossible old-map-versus-new-lookup
simulation 136 of 141 still matched with **zero mismatches**: the 4 would have failed to carry, not
attached to the wrong block.

So a "try the new key, fall back to the old key" migration is not needed, and shipping one would mean
a frozen copy of the broken regex that nobody could ever delete.

Sol pushed back on the phrasing and is right about one thing: "the pairing is unchanged" is true of
today's data, not of all possible data. A Unicode-aware key creates equivalence classes the old one
did not have — `Ⅳ` and `IV` both become `iv`, `①` and `1` both become `1`. Two blocks that were
distinct keys can become one bucket, and then `.shift()` decides. That is a real hazard, but it is
the *existing* hazard rather than a migration hazard, and the answer to it is below.

## The fix

Two changes, because the one function is doing two different jobs.

**One — a Unicode-aware key, for matching.**

```ts
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();
```

- **NFKC first, and it is load-bearing rather than tidy.** Keeping `\p{M}` means NFD `café`
  (`e` + U+0301) would otherwise key differently from NFC `café`. NFKC composes them, so they agree.
  NFKC changes string length, which is fatal in [`src/quote-match.ts`](../../src/quote-match.ts) —
  that file hand-rolls a length-preserving fold table because it derives offsets. Nothing here
  derives offsets, so NFKC is available to us and is the right tool. (It is *not* needed for
  non-breaking spaces: JavaScript's `\s` already matches those. An earlier draft claimed otherwise.)
- **`\p{M}` stays** so Devanagari matras and Arabic diacritics are not stripped.
- **Whitespace collapsed after the strip**, not before, so `and — as` and `and  as` agree. Today they
  do not: stripping the dash leaves a double space, visible in the real data as
  `"…just metaphors and  as the philosopher…"`.
- `u` flag is required for `\p{…}`; target is ES2022, so it compiles.

Verified: Cyrillic, Greek, Chinese, Arabic and Devanagari survive; `don’t` and `don't` still both
fold to `dont`; `ﬁnd` now equals `find`.

**Two — stop asking this function whether content exists.** `rewrapOrphanText`, `collectElements`
and `isImageOnly` don't want a match key, they want "is there anything here?". They should test for a
non-whitespace character directly. This is Sol's best catch, and it fixes a case the regex change
alone does not: symbol-only prose. `😀`, `★` and `©` normalise to empty under the new function too,
so a paragraph made of them would still be silently dropped.

**Three — refuse to guess when the bucket is ambiguous.** Also Sol's, and the right long-term
answer to the id-swap above. Match on raw text first and consume those ids; fall to the normalised
key second; and if a normalised bucket still holds more than one candidate, **re-mint rather than
`.shift()`**. That follows the rule block-ids.md already states — a lost anchor is safer than a wrong
one — and it defuses both the `Ⅳ`/`IV` class of collision and the `2024` one, without a fallback map
and without freezing the old regex.

Not recommended: hashing the key (the string is readable in a debugger and there is no scale problem
to solve); fuzzy matching (deliberately rejected in block-ids.md, for good reasons that have not
changed); adding `tag` to the key (real but rare, and a separate change with its own argument).

## What landed

All three, in one commit, 2026-08-26. The order of the work was: eight failing tests, then the fix,
then a re-run over the real articles.

- **The Unicode-aware fold**, exactly as written above.
- **`hasContent`**, a separate `/\S/u` test, replacing `normalize(...).length === 0` in
  `rewrapOrphanText`, `collectElements` and `isImageOnly`. This is what saves symbol-only prose,
  which the new fold still folds to nothing.
- **The two-pass matcher with the ambiguity rule**, which meant turning `carryOverIds` from a
  per-block lookup into one that runs over the whole document: whether a bucket is ambiguous cannot
  be answered until every claimant is known. `splitIntoBlocks` now collects content first and hands
  out ids second, and the gistable rules moved into `describeBlock` so the two can be read apart.

Measured after, by re-running stage 3 over the three articles in `data/` against a document with
every id stripped out — the re-extraction case:

```
  constitution                      360 blocks   carried 360   minted 0
  noema-mythology-of-conscious-ai   141 blocks   carried 140   minted 1   ← the <hr>, as documented
  writes                             19 blocks   carried  19   minted 0
```

The counts the estimate predicted, and the one casualty is the horizontal rule that has never had
anything to match on. `npm test` is green apart from one pre-existing failure in another agent's
file; `npm run lint` on `src/blocks.ts` reports exactly what it reported before.

## The second review, and four more ways to guess

GPT Sol reviewed the landed code the same afternoon (`gpt-5.6-sol`, high effort, read-only, against
the diff rather than the plan) and opened **"fix these first"**. It was right four times, and each
one is the same shape as the original bug: a confident carry-over onto content a reader would call
different, reported as a success.

| What it found | Why it happened | What it does now |
|---|---|---|
| `<h2>Same words</h2>` and `<p>Same words</p>` **swap ids** when re-rendered in the other order | the key was the text alone, so pass one — the pass with "no judgement" in it — was quietly guessing | the **tag is part of both keys** |
| A document arriving with **the same `spya-` id on two elements** emitted two blocks with one id, `reused: 2` | `taken` is seeded from every id in the document, so it cannot answer "has a block been given this yet?" | a separate `assigned` set; the second occurrence mints |
| `❤️` and `☀️` **carry the same id** | the fold strips both symbols and keeps U+FE0F, which is a mark, and marks are kept for Devanagari's sake — so both keys are one invisible character | a folded key with **no letter or number** in it is discarded |
| `<span>\u200B</span>` became a paragraph; `<p><img>\u200B</p>` stopped being image-only | `hasContent` was `/\S/u`, and a zero-width space, a soft hyphen and a lone variation selector are all non-whitespace | strip `\p{Default_Ignorable_Code_Point}` first |

Three of its other suggested tests turned out to pass already — folded drift in Cyrillic, a lopsided
folded bucket in either direction, and the exact pass skipping past an id the document had reused.
They are in the suite now anyway, because a behaviour nobody has pinned is a behaviour that can
change without anyone noticing.

**Where it was pushed back on.** Sol wanted *any* exact bucket that is not one-old-to-one-new to
mint, and NFC rather than NFKC.

- **Exact buckets stay first-come**, now that the tag is in the key. Two `<li>Yes</li>` items really
  are alike; minting for them would drop the ids of every repeated short item on the page, on every
  re-extraction, to protect against a case where the anchor lands on text that says the same thing.
- **NFKC stays**, and the reason is the next feature rather than this one. NFC composes NFD `café`,
  which is the case that made normalisation necessary at all, but it does not fold `ﬁ` to `fi` — and
  a ligature surviving into extracted text is ordinary in a PDF. Sol's counter-example, `x²` editing
  to `x2` and keeping its id, is real and is now written down in
  [block-ids.md](../project/block-ids.md#two-passes-and-the-second-one-refuses-to-guess) as the cost.

**And one claim of mine it deflated**, which is the useful kind of correction: "pass one needs no
judgement" was in this file and in block-ids.md, and it was false in exactly the case the tag now
covers. Both now say "pass one asks the least of us".

## Sequencing

**Fixed before PDF ingestion started.** The reasoning, kept as written:

**Fix it before PDF ingestion starts.** Not because PDF causes it — this is today's behaviour for
HTML — but because PDF is where non-Latin text and repeated re-extraction both arrive in volume, and
because two of the five failure modes delete paragraphs from the article. "v1 is Latin-script only"
is a limitation you can write down. "v1 silently drops some paragraphs and occasionally moves a
reader's note to a different one" is not.

Effort, honestly: **two to three hours.** One function rewritten, one presence test extracted, the
matcher's two passes and the ambiguity rule (that is the part with actual design in it), five or six
tests, and a re-run of stage 3 over the three articles in `data/` to confirm the `carried` counts
hold at 360, 140 and 19. The migration check is already done and is in this file.

## Where Sol and I disagreed

Sol reviewed a draft of these findings (`gpt-5.6-sol`, high effort, read-only). Three corrections
accepted, two pushed back on.

Accepted: the image caption is demoted, not deleted, so two failure modes delete content rather than
three; `\s` already matches NBSP, so that half of the NFKC argument was wrong; and "every fixture in
the repo is ASCII" is false — [`tests/fetch.test.ts`](../../tests/fetch.test.ts) has Japanese and
accented fixtures for the encoding work. The accurate claim is narrower and more damning: the only
non-ASCII characters in [`tests/blocks.test.ts`](../../tests/blocks.test.ts) are em dashes in
comments.

Its variation-selector catch is real and I had missed it. U+FE0F is `\p{M}`, so `❤️` and `☀️` both
normalise to the same invisible one-character key. Marginal, but it is the same shape of bug one
level down, and it is another argument for the separate presence test.

Pushed back on two. It called `previousBlockCount` reading `data/<slug>/blocks.json` while
`runBlocks` reads `output/<slug>.blocks.json` a "storage hole". It is deliberate and the comment
above it in [`src/pipeline.ts`](../../src/pipeline.ts) explains it: the second copy is not there to
rescue carry-over, it is there so that losing the first copy produces a warning instead of silence.
And it argued for a fallback matcher on the grounds that new-key-first can return a wrong id before
the fallback is ever reached — which is true, and is precisely why the answer is the ambiguity rule
rather than a fallback.

## What would have caught this

The honest answer is: one non-English test. There isn't one, and the reason there isn't one is the
interesting part.

This is [silent-success.md](../reusable/silent-success.md) in its purest form. Every failure here
reports success — `carried: 2` while the ids are swapped, `minted: 2` looking exactly like an
ordinary first run, a dropped paragraph producing no error at all. And **the check you would
naturally run shares the bug's assumption.** Run the suite: green. Re-run the pipeline over
everything in `data/`: 519 of 520 ids carry. Both of those are true and both are measuring English.

Three habits that would have found it:

- **Write the fixture in a second script whenever a function touches characters.** Not for
  internationalisation as a feature — for the assumption. A single Cyrillic paragraph in
  `tests/blocks.test.ts` fails on line one.
- **Read a character-class regex out loud as its complement.** `[^a-z0-9 ]` says "delete everything
  that is not English". Written that way it does not survive review. Written as "strip punctuation"
  it survived two.
- **When a name generalises but the code does not, believe the code.** `normalize` promises a
  category. The regex names an alphabet. [260826a-toc-max-tokens.md](260826a-toc-max-tokens.md) ends on the same
  observation from the other direction — every fixture in the repo was ASCII, so the curly-apostrophe
  bug could not have been caught by any test in it.

The general shape:

> When a function names a category — punctuation, whitespace, a word — check whether it was
> implemented as a category or as the members of it you happened to have in front of you.

## See also

- [block-ids.md](../project/block-ids.md) — the contract this threatens, and why ids are random
- [260825h-deterministic-block-ids.md](../plans/260825h-deterministic-block-ids.md) — the road not taken, which read
  this same function closely and did not see this
- [260826c-pdf-ingestion.md](../plans/260826c-pdf-ingestion.md) — the work this blocks
- [silent-success.md](../reusable/silent-success.md) — the pattern
- [260826a-toc-max-tokens.md](260826a-toc-max-tokens.md) — the ASCII-fixture observation, from the other end
