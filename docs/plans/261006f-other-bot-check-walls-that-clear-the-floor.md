# Other bot-check walls that clear the floor: one, and it is Anubis again

Queue item `qi-e49jcjzb`, 2026-10-06. Up: [plans.md](../project/plans.md). Follow-up to
[261006c](261006c-a-bot-check-page-is-refused-by-its-own-markup.md), which built
[`src/challenge-page.ts`](../../src/challenge-page.ts) with one entry. The stage is
[content-extraction.md § The three ways this stage refuses](../project/content-extraction.md#the-three-ways-this-stage-refuses).

## What the item asked

Cloudflare's, reCAPTCHA's and the *"enable JavaScript"* pages are refused today only because they
happen to be short. Fetch some known-walled addresses through our own fetcher; for any bot-check
page that clears the 500-character floor, add a registry entry that reads machine-readable markup
(never visible wording), with a committed fixture, red first.

## What the measurement found

[The investigation](../investigations/261006c-which-bot-check-walls-clear-the-floor-through-our-fetcher.md):
109 addresses. None of the named walls clears the floor (the largest is 306 characters; most are
stopped by stage 1 on a 403). **One bot check does, and the registry misses it:
`bugs.winehq.org`, Anubis v1.15**, 1,106 characters, published as an article titled *"Making sure
you're not a bot!"*. That version's page has no `<script id="anubis_challenge">` element, which is
the only thing the entry reads.

So this plan adds **no new provider**. It fixes the Anubis entry.

## The bug, and its class

The entry was written from one captured page and requires the element that page happened to carry.
The provider's software has versions, and an older one in service writes a different page.
**Class: a recogniser fitted to a single sample of a third party's versioned output.**

## What is built

One stage, one commit.

1. **The fixture.** `evals/extraction/fixtures/winehq_anubis.html`: the 3,780 bytes
   `bugs.winehq.org` answered `fetchDocument` with on 2026-10-06, unedited (this version echoes no
   IP address; checked). sha256 `0153d8fb…418b0e`. It joins the corpus the way `hal_anubis.html`
   did: `EXTRA_FIXTURES` in `evals/extraction/corpus.mts`, a `notAnArticle` manifest,
   `hashes.json`, the fixtures README, and the four places 261006c found that count or name the
   corpus (`MANIFESTS_EXPECTED` in `evals/extraction/score.mts`, the re-recorded
   `evals/results/extraction-score.json`, `NOT_ARTICLES` in
   `tests/extraction-visible-text.test.ts`, the corpus count and `CHALLENGES` in
   `tests/extract-protect.test.ts`).

2. **The entry, widened.** `isAnubis` is true when **either** holds:

   | shape | conclusive markup |
   |---|---|
   | the challenge in the page (as today; v1.26, v1.27, `devel`) | `script#anubis_challenge[type=application/json]` whose JSON is an object with a `rules` object and a `challenge` object |
   | the challenge fetched afterwards (new; v1.15) | `script#anubis_version[type=application/json]` whose JSON is a non-empty string, **and** a `script[type=module]` whose `src` attribute (see F1 below for how it is parsed) has a path ending `/.within.website/x/cmd/anubis/static/js/main.mjs` |

   Both halves of the second row are required. The version element says the page is Anubis's; the
   module script is the one that solves the check, so its presence says the page is a challenge
   and not some other page Anubis writes. The path is matched by its ending because an install may
   put a prefix in front (sourceware.org serves it from `/git/.within.website/…`); the query string
   (`?cacheBuster=…`) is ignored. As before, everything is read from the parsed DOM: a page that
   shows this markup in a code sample has it as text.

   The provider stays `"anubis"`, so the reader's sentence, the codes and the pipeline are
   untouched. Nothing a reader sees changes except that this page is now refused with the sentence
   261006c wrote.

3. **Tests, red first**, added to `tests/extract-challenge-page.test.ts` in its existing shape:
   - the winehq fixture is refused as `ChallengePage` through `readArticle`,
     `readArticleWithProvenance` and `runExtract` (red today: it is an article of 1,106);
   - the counterfactuals: the same bytes less the version element, and the same bytes less the
     module script, are each an article with no refusal, so each half is shown to be required;
   - negative controls on a real article over the floor: the version element alone; the module
     script alone; the version element with JSON that is not a string, or with another `type`; a
     module script whose path only *contains* the Anubis path (`…/main.mjs.map`, or the path in the
     query string); a non-module `<script src>` of that path; both, HTML-escaped in a `<pre>`;
   - the positive control beside them: the same real article with both elements is refused;
   - a prefixed path (`/git/.within.website/…`) is recognised;
   - the harness rungs for the new fixture, as for HAL.

4. **Docs**: the header and the entry's docstring in `src/challenge-page.ts` (it says Cloudflare,
   reCAPTCHA and the shells *"are all refused by the floor today"*, which is now measured and
   dated); content-extraction.md where it describes the entry; the fixtures README; and a short
   postmortem, `docs/postmortems/261006d-…` (name from `scripts/plan-name.ts`), naming the class
   above.

## What it does not do

- **No Cloudflare, reCAPTCHA or "enable JavaScript" entry.** None was seen clearing the floor. An
  entry written without a captured page is a guess about somebody else's markup, which is the
  registry's own rule and the reason this plan is smaller than its title.
- **It does not make a wall under the floor say "bot check".** Those are refused correctly with
  the less specific sentence. Recognising them would need an entry per provider with no reader
  harmed today.
- **It does not change which statuses stage 1 accepts** (AWS WAF's 202). Noted in the
  investigation.

## The simpler option passed over

**Recognise on `script#anubis_version` alone**, one element for every version seen. It is fewer
parts. Passed over because that element says *"Anubis wrote this page"*, not *"this page is a
challenge"*, and Anubis writes other pages; with the solver script beside it the claim stays the
narrow one 261006c settled on. The cost is one more `querySelectorAll`.

**Skip the corpus and keep the fixture for the test only.** Cheaper by five small edits and a
re-recorded results file. Passed over for now because a fixture outside `ALL_FIXTURES` is one the
other instruments never walk; open to the reviewer saying the second Anubis page earns nothing
there.

## If the refusal is wrong

This widens a hard refusal on a reader's path. The fallback, decided now: if any test or the
reviewer shows a real article reaching the new branch, the branch is narrowed or removed, not
kept with a note. The argument that it cannot happen rests on one mechanism, which the tests
exercise directly: both elements are found by the DOM as real `<script>` elements, so quoted
markup, and an article that merely links to Anubis's script, do not match.

## Done means

The winehq page is refused on both read paths and through `runExtract`; every control passes; the
new tests were seen red first; `npm test` and `npm run typecheck` are green; GPT Sol has reviewed
this plan and the code.

## GPT Sol's plan review, 2026-10-06 — all three findings accepted

The review is [261006f-other-bot-check-walls-plan-review-sol.md](261006f-other-bot-check-walls-plan-review-sol.md).
Verdict *change first*. Sol ran the proposed rule over all 38 HTML fixtures: it matches the two
Anubis pages and no real article. The changes below are now part of the plan.

- **F1 (P1, established): an uploaded copy would be missed.** A document with no address has
  `about:blank` as its base, and the module script's root-relative `src` does not resolve against
  it. So the rule does **not** resolve against the document. It reads the raw `src` attribute and
  parses it against a fixed made-up base (`https://anubis.invalid/`) only to separate the path from
  the query string; an attribute that does not parse is a non-match. This is simpler than honouring
  `<base>` and gives one answer with or without an address. The winehq page through
  `runExtract({ url: null })` is a test.
- **F2 (P2, established): HAL's existing counterfactual contradicts the new rule.** HAL's page with
  only `anubis_challenge` removed still carries the version element and the solver script, so it is
  now refused by the second shape. That test is rewritten: the page with *both* shapes disabled is
  an article; the page less only `anubis_challenge` is still refused; and the first shape keeps
  coverage of its own (a page carrying `anubis_challenge` and neither of the second shape's
  elements is refused).
- **F3 (P2, established): the measurement's rows were not in the candidate.** They are now
  `evals/results/bot-walls-261006/results.json`, 109 rows, and the investigation links to them.

Also taken: the header of `src/challenge-page.ts` stops saying the other walls are *"all refused
by the floor"* and says what was measured (most never pass stage 1; the rest are unreadable or
under the floor). The corpus stays in the plan: Sol found the eval's `notAnArticle` assertion fails
on this page today, which is the instrument doing its job.

## What landed

Built 2026-10-06, as planned, with the review's three changes.

**Seen red first.** With the fixture, its manifest and the new tests in place and
`src/challenge-page.ts` untouched, `tests/extract-challenge-page.test.ts` ran
**16 failed, 57 passed (73)**. The sixteen were the ones the plan predicted: the winehq page
through `readArticle`, `readArticleWithProvenance` and `runExtract` (with an address and with
`url: null`), the three harness rungs for it (the eval's own words: *"this page is not an article
and the extractor did not refuse it — it returned 1106 characters as though they were one"*),
HAL's page less only `anubis_challenge` (F2), and every positive control for the second shape.
After the change: **73 passed**.

**The code.** `isAnubis` is two named functions joined by `||`: `isAnubisWithItsChallenge` (as
before) and `isAnubisFetchingItsChallenge`. A small helper, `jsonScript`, reads either JSON script
element, so the element, type and parse rules are written once.

**Mutations**, each made to the finished code, run against the same test file, and edited back:

| mutation | tests red (of 73) |
|---|---|
| the second shape never matches | 16 |
| the second shape accepts the version element alone | 12 |
| the second shape accepts the module script alone | 9 |
| the path matched with `includes` instead of its ending | 2 |
| the first shape never matches | 4 |
| the `src` resolved against the document's base (F1) | 5 |
| any `<script src>` accepted, module or not | 2 |
| an empty version string accepted | 1 |

**The retreat was not needed.** The finished recogniser was run over all 38 HTML files under
`evals/extraction/fixtures/`, with an address and without: it refuses `hal_anubis.html` and
`winehq_anubis.html` and nothing else.

**The corpus.** `winehq-anubis` is registered in the places the plan lists.
`evals/results/extraction-score.json` was re-recorded with
`npx tsx evals/extraction/score.mts --json evals/results/extraction-score.json` (no network, no
model). The diff is 501 lines added and none removed: thirteen new rows, one per arm, all for the
new fixture. No other row changed.

**Different from the plan:**

- **The postmortem is `261006j`, not `261006d`**:
  [261006j-a-recogniser-fitted-to-one-sample-of-a-versioned-page.md](../postmortems/261006j-a-recogniser-fitted-to-one-sample-of-a-versioned-page.md).
  The letter is whatever `scripts/plan-name.ts` gives on the day.
- **`readArticleWithProvenance` is not tested with no address.** Its `url` parameter is a
  `string`, not `string | null`; only the eval harness calls it, always with an address. The
  no-address tests go through `readArticle` and `runExtract`.
- **More controls than the plan named**: an empty version string, a version element that does not
  parse or is a `<div>`, the path in a fragment, a `src` that is not a URL, an inline module script
  that only imports the path, a link to it, and a `<base>` elsewhere on the page (ignored).
  Precedence over the two older refusals is tested for the second shape too.

**One more consumer than the plan listed**: a comment in `evals/extraction/block-census.mts` that
names the fixtures `ChallengePage` fires on. Its code already caught the refusal. The other walkers
of `ALL_FIXTURES` (`tidy.mts`, `probe.mts`, `provenance.mts`, `table-oracle.mts`, `wcxb.mts`) needed
nothing; `fixtures/verify.mts` reports *"38 fixtures, all matching"*.

## GPT Sol's code review, 2026-10-06 — land it, with its fixes

On commit `61b440abd`:
[261006f-other-bot-check-walls-code-review-sol.md](261006f-other-bot-check-walls-code-review-sol.md).
Sol wrote the fixes itself; they were read as a proposal and committed with this section.

- **F4 (P1, established; fixed by Sol, then widened).** An earlier element with
  `id="anubis_version"` (a `<div>`, a script of another type, one that does not parse) hid the real
  version script behind it, because `getElementById` answers with the first. Sol made the second
  shape check every script of that id, four tests red first. **The first shape had the same
  lookup**, a limit 261006c's review named and kept; it was closed here rather than left as a
  sentence, with three more tests seen red. Both shapes now share one helper, `hasJsonScript`.
  Written up as
  [261006k](../postmortems/261006k-a-first-id-match-hid-a-later-valid-script.md). These were
  constructed inputs; no live page with a duplicated id was seen.
- **F5 (P2, established; fixed).** Resolving `src` against the document with a fallback for
  uploads passed every test. A new `<base>` test catches it.
- **F6 (P3; fixed).** The postmortem now names the introducing commit, `677404435`.
- **F7 (P3; fixed).** *"The same afternoon"* was not in the kept evidence and is gone.

Sol also confirmed the score-file claim (501 lines added, none removed, thirteen rows, every
earlier row byte-identical) and found no real article the entry refuses.

**In a browser** (Playwright, 1440, 820 and 390 wide, the live `bugs.winehq.org` address, on this
worktree's dev server): the job fails at *Extracting the article* with the fetched sentence and
`[jb-bot-check]`, no Retry, nothing on the shelf, no sideways scroll at any width. At 390 the code
itself breaks across two lines (`[jb-` / `bot-check]`), which is 261006c's sentence and not this
change's.
