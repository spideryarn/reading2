# A bot-check page is refused by its own markup

Queue item `qi-ptvjnvdm`, 2026-10-06. Up: [plans.md](../project/plans.md). The stage it changes is
[content-extraction.md § The three ways this stage refuses](../project/content-extraction.md#the-three-ways-this-stage-refuses).

## The bug

hal.science answers our fetch with an **Anubis** page: a proof-of-work check that only a browser
running its script can pass. The page has 178 words, so stage 2's floor (500 characters of article
text) does not refuse it, and it imports with no error as an article titled *"Making sure you're not
a bot!"*. The paper's PDF address returns the same page. A published article spends the reader's
slot. Any Anubis-protected site does the same. Found by
[261005m](261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md)'s measurement
(`evals/results/paper-sources-261005/summary.md`, rows `hal`).

## Why it was open

This is **C1** of
[260904e](260904e-extraction-repair-evals-and-llm-post-processing.md): *the bot wall, a registry of
conclusive typed markup*. It was designed and its behaviour decided on 2026-09-06, then deferred,
because both walls in the corpus were short enough for the floor (C1a) to refuse: *"C1 does not ship
until a long-wall fixture does."* HAL's page is that fixture. Nothing in this plan re-decides C1; it
builds its first entry.

## What is built

One stage, one commit.

1. **The fixture.** `evals/extraction/fixtures/hal_anubis.html`, the bytes hal.science sent on
   2026-10-06 to a plain GET with a browser-ish User-Agent. One edit: Anubis echoes the caller's IP
   into the page, and that value is replaced with `192.0.2.1`. The manifest and the README say so.
   It joins `EXTRA_FIXTURES` with a `notAnArticle` manifest, and `hashes.json`.

2. **The recogniser**, a new small module `src/challenge-page.ts`: a registry of pages that say, in
   machine-readable markup, that they are a challenge. One entry:

   | provider | conclusive markup |
   |---|---|
   | Anubis | a real `<script id="anubis_challenge" type="application/json">` element whose text parses as a JSON object |

   That element is the page's own statement of the challenge it is setting. It is read from the
   parsed DOM, never by a regex over the bytes and never from visible text, so a page that *quotes*
   the markup in a code sample, or says *"making sure you're not a bot"* in prose, does not match.
   `acx.html` (which says *"just a moment"* twice) stays the corpus's negative control.

   It runs on the source document **before** `prepareDocument` and Readability, in the one place
   both read paths share, so `readArticle` and `readArticleWithProvenance` cannot disagree (the seam
   C1a was warned about).

3. **The refusal**, a third typed error beside `ReadabilityRefused` and `TooLittleTextToRead`:
   `ChallengePage`, carrying the provider. It **wins over both**: a challenge page that is also
   short, or that Readability declines, is reported as a challenge, because that is the more
   specific finding and the more useful sentence. `readArticle`'s `refusal` becomes
   `TooLittleTextToRead | ChallengePage`. `runExtract` throws it; `src/pipeline.ts` maps it; the
   eval harness's `Candidate.refused` is true for it, and the floor-suspension seam in
   `evals/extraction/arms.mts` does **not** suspend it.

4. **The reader's sentence**, a new factory in `src/messages.ts` with a code per origin
   (`[jb-bot-check]`, `[jb-file-bot-check]`), both `blocked` (no Retry: the same bytes would be
   read again). Draft wording, to be checked against [copy.md](../project/copy.md):

   - fetched: *"The site answered with a check that its visitor is not a bot, instead of the page
     itself, and this app cannot pass that check. Trying again would get the same answer. If the
     page opens in your own browser, save it from there as a PDF or a web page and upload that
     file. [jb-bot-check]"*
   - uploaded: *"The file you uploaded is a site's check that its visitor is not a bot, saved
     before the page behind it had loaded. Sending the same file again cannot change that. If you
     can still open the original page in a browser, wait for it to load and save it again from
     there. [jb-file-bot-check]"*

5. **Tests, red first**, in a new `tests/extract-challenge-page.test.ts`, as an exposure ladder like
   C1a's:
   - the fixture through `readArticle`, `readArticleWithProvenance` and `runExtract` is refused as
     `ChallengePage` (red on today's tree: it returns an article);
   - **the counterfactual without a code seam**: the same bytes with the one `<script
     id="anubis_challenge">` element removed come back as an article of more than 500 characters,
     so the test proves the refusal is the recogniser's and not the floor's;
   - negative controls: `acx.html`; a real article that shows the Anubis markup HTML-escaped inside
     `<pre>`; a real article with the phrase in its prose; a `<script id="anubis_challenge">` of
     another `type` or with unparseable text;
   - the pipeline maps it to the new sentence for both origins (`tests/job-failure.test.ts`'s
     pattern), and `tests/messages.test.ts`'s registry gets the new factory;
   - the harness: `Candidate.refused` is true with the floor suspended.

6. **Docs**: content-extraction.md (three refusals, and the *"has not been built yet"* paragraph),
   the C1 entry in 260904e (landed, first entry differs from the one imagined there), the fixtures
   README, the `hal` row of 261005m, copy.md if it lists codes, and a short postmortem
   `docs/postmortems/261006c-a-size-floor-stood-in-for-a-recogniser-of-kind.md`.

## What it does not do

- **It does not get past the check.** HAL still cannot be imported by address; the reader is told
  why and what works instead. Passing a JS challenge is a stage-1 project, not this one.
- **No second entry.** Cloudflare, reCAPTCHA (the `pmc_article` entry 260904e measured) and the
  *"enable JavaScript"* shells in the same measurement are all refused by the floor today. An entry
  is added when a page is seen that clears the floor, with its fixture.
- **Not retrospective.** Like the floor, it runs only when stage 2 runs. A bot-check page already
  on a shelf stays there until it is re-extracted.

## The simpler option passed over

**Raise the floor**, or refuse on the title. Both are shape rules about visible text: the floor at
178 words would refuse genuine short pages (the 749-character page pinned in
`tests/extract-capability-floor.test.ts` is there to stop exactly that), and 260904e already rejects
visible wording with a real page behind the argument. A recogniser keyed on one element costs one
small module.

**Reuse `[jb-no-article]` instead of a new sentence.** Cheaper by one factory, but that sentence
says *"usually a login wall, an error page, or…"* and sends the reader to look at the address. Here
we know what the page is and what move works (their own browser, then upload), so saying so is the
point.

## Done means

The fixture is refused on both read paths and through the pipeline with the new sentence; every
negative control passes; the new test file was seen red before the fix; `npm test` and
`npm run typecheck` are green; GPT Sol has reviewed this plan and the code.

## GPT Sol's plan review, 2026-10-06 — all three findings accepted

The review is [261006c-a-bot-check-page-plan-review-sol.md](261006c-a-bot-check-page-plan-review-sol.md).
Verdict *change first*; the changes below are now part of the plan.

- **F1 (P1, established): more consumers hear about a third refusal than the plan named.** With
  HAL in `ALL_FIXTURES`, `evals/extraction/block-census.mts` rethrows `ChallengePage` and aborts,
  and the corpus runner in `tests/extract-protect.test.ts` catches only `TooLittleTextToRead`.
  Widening `refusal` also breaks the typecheck wherever `.chars` is read without narrowing:
  `evals/extraction/probe.mts`, `evals/extraction/tidy.mts`, and assertions in
  `tests/extract-capability-floor.test.ts`. Each is updated, keeping challenge and floor refusals
  distinct. Both new codes are registered in `CODE_KINDS` as well as in the test's inventory.
- **F2 (P2): "conclusive" said more than the evidence.** The entry now requires the JSON to be an
  object carrying both a `rules` object and a `challenge` object, which is what the captured page
  has, and a valid-JSON script without them is a negative control. The claim is stated narrowly:
  *a page carrying this element is one Anubis generated, or one built to look like it*; not that no
  other page could ever hold it.
- **F3 (P2): nothing tested "wins over both".** Two synthetic pages are added, each through both
  read paths and `runExtract`: a marked page under the floor, and a marked page Readability
  declines. `readArticle`'s header says `article: null` can now arrive with a non-null `refusal`.

Also taken: the recogniser is a helper called by `readingArm` and `provenanceArm` on the source
before it is prepared, not a throw inside `sourceDom` (which also parses fragments and the
provenance copy); the reader's sentence says *"HTML file"*, not *"web page"*, and ties the futility
of a retry to the stored copy. Sol measured the counterfactual: 1,034 collapsed characters on both
paths with and without the 602-character script.

## What landed

Built as planned, items 1–6 and F1–F3, with these differences and findings.

- **The pipeline rung is in `tests/job-failure.test.ts`, not the new file.** The real
  `STEPS.extract` reads the document out of Storage, and a new test file runs in the `unit` lane,
  where Storage is deliberately unreachable. The other rungs are in
  `tests/extract-challenge-page.test.ts`.
- **Seen red first**: twelve failures on a recogniser that recognised nothing — `expected null to be
  an instance of ChallengePage` on both read paths and `runExtract`, and from the real step
  *"expected that to fail, and it did not"*, with the paid title-tidy call refused by the test
  guard on the way. Thirty green afterwards, plus the two in `job-failure`.
- **Five mutations, each caught**: the recogniser never firing (12 red); the entry accepting any
  JSON object (4, the valid-JSON controls); the floor outranking the bot check (1); the harness
  letting the floor's suspension suspend the bot check (1); `ReadabilityRefused` outranking it (1).
- **Four more consumers than the plan or the review named**, all found by running the tests that
  walk the corpus:
  - `evals/extraction/score.mts` pins the number of manifests (`MANIFESTS_EXPECTED`, 15 → 16);
  - `evals/results/extraction-score.json` has to carry a row for every fixture and arm, so it was
    re-recorded. **That diff is far larger than this change**: the committed file dated from stage B
    of 260904e, and 117 of its 208 existing rows had drifted since (the capability floor alone
    changed the two walls' rows). Its test checks the matrix, not the values;
  - `tests/extraction-visible-text.test.ts` holds every fixture with a manifest to 2,000 characters
    of visible text, bar two named non-articles. The bot check has 1,223 and is now the third name;
  - `tests/extract-protect.test.ts` pinned the corpus at 35 as well as catching one refusal type.
- **The reader's sentences**, final:
  - fetched: *"The site answered with a check that its visitor is not a bot, instead of the page
    itself, and this app cannot pass that check. Another go here would read the same stored copy of
    that check. If the page opens in your own browser, save it from there as a PDF or an HTML file
    and upload that file. [jb-bot-check]"*
  - uploaded: unchanged from the draft above.
- **Not done here**: the code review by GPT Sol, and the full `npm test`.

## GPT Sol's code review, 2026-10-06 — land it

On commit `677404435`:
[261006c-a-bot-check-page-code-review-sol.md](261006c-a-bot-check-page-code-review-sol.md). No P0 or
P1, and it changed no file. It reversed each precedence and removed the suspension exemption
itself, and the tests went red each time. Two P3s in the postmortem, both fixed: **F4**, the title
is in `results.json`, not `summary.md`; **F5**, *"any site behind the same check did the same"*
said more than one captured site shows. One limit it named and we keep: a page with an earlier
non-script element of the same id is not recognised, which fails towards publishing, as before.

**In a browser** (Playwright, 1440, 820 and 390 wide, the live hal.science address): the job fails
at *Extracting the article* with the fetched sentence and `[jb-bot-check]`, no Retry, no article on
the shelf, and the sentence wraps without overflow at each width.
