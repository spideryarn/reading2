The widening is useful, but the plan needs explicit handling for uploads and changes to HAL’s existing counterfactual tests.

I ran two read-only, in-memory harnesses with `node --import tsx --input-type=module`. They recursively parsed every HTML fixture with jsdom, applied both recognition branches, inspected URL resolution with and without a document address, and exercised the current extraction and eval paths. Relevant output:

```text
htmlFiles: 38
ALL_FIXTURES: 36
SYNTHETIC_CONTROLS: 1
oldMatches: ["hal_anubis.html"]
newMatches: ["hal_anubis.html", "winehq_anubis.html"]
realArticleMatches: []

WineHQ bytes: 3780
WineHQ sha256:
0153d8fbaab181b7e2d67085c8042d48856264761fb89b8af8abea3562418b0e

WineHQ new branch, source URL supplied: true
WineHQ new branch, baseURI about:blank: false
WineHQ new branch, synthetic HTTPS base: true

WineHQ minus version element: refusal=null, chars=1106
WineHQ minus module script: refusal=null, chars=1106
HAL minus challenge element: oldBranch=false, newBranch=true

Current runExtract, WineHQ URL supplied:
publishedTitle="Making sure you're not a bot!"
Current runExtract, URL null:
publishedTitle="Making sure you're not a bot!"

Current eval: refused=false, assertionsPassed=false
failure:
"this page is not an article and the extractor did not refuse it —
it returned 1106 characters as though they were one"

PROBE_DEFAULT_URLS: 109
```

The module check inspected a resolved URL’s `pathname` and used the proposed suffix; it ignored the query string. No files were changed.

- **F1 — P1, established: the proposed URL rule misses uploaded WineHQ pages.** With no source URL, jsdom uses `about:blank`; WineHQ’s root-relative module URL cannot resolve against it. Catching the URL error leaves the branch false; letting it escape produces an extraction error. The page still has 1,106 readable characters. Specify a synthetic HTTPS base for path inspection when the document has no usable base, honor an explicit usable `<base>`, and treat malformed sources as nonmatches. Add the WineHQ `runExtract({url: null})` refusal test. This omission is in the [proposed rule and tests](/var/tmp/spideryarn-worktrees/bot-check-walls/docs/plans/261006f-other-bot-check-walls-that-clear-the-floor.md:51).

- **F2 — P2, established: adding tests alone leaves contradictory HAL assertions.** The [existing counterfactual](/var/tmp/spideryarn-worktrees/bot-check-walls/tests/extract-challenge-page.test.ts:114) removes only `anubis_challenge` and expects successful publication. Both new markers remain, and the proposed branch matches. Rewrite that control to remove enough markup to disable both branches, and separately assert that HAL without its embedded challenge remains refused through the second branch. Preserve independent coverage of the original branch.

- **F3 — P2, established: the 109-address conclusion lacks reviewable result rows.** The candidate contains the probe and aggregate write-up, but not its `results.json`. I verified the list contains 109 addresses and reproduced WineHQ’s result; I cannot independently audit the reported outcome counts or classifications of the other pages. Retain the result rows and the manual article/challenge classifications. Another live run would measure different responses.

On your four questions:

1. **The second shape is reasonable evidence at the existing detector’s narrow guarantee.** It identifies markup used by the observed Anubis challenge pages; it does not prove that no readable page could carry it. None of the real article fixtures matched. A readable demonstration page that embeds both actual script elements would match—**reasoned**, with no concrete real-world example established. Error/deny templates are absent from the candidate, so their exclusion is unproved. Besides uploads, the rule would miss a challenge without `anubis_challenge` that omits the version element or serves a renamed/bundled solver at another path. Escaped examples and ordinary links are correctly excluded.

2. **Deferring other provider entries is supported for this measured fetch path.** The write-up reports no accepted non-Anubis challenge exceeding the floor. It does not establish that those providers never serve longer challenges: 61 responses never reached extraction, uploads were not measured, and the sample used one machine and User-Agent. Those limitations are acknowledged, so this is a defensible scoped decision rather than explaining away a demonstrated failure. Replace the header’s universal “all refused by the floor” wording with the measured distinction between fetch refusal, unreadability and the floor.

3. **Keep WineHQ in the eval corpus.** It exercises a distinct recognition branch, and the current eval demonstrably fails its `notAnArticle` assertion while HAL already passes. That earns the bookkeeping churn.

4. **The main missed consumer is HAL’s existing counterfactual, F2.** Also name the no-address production path explicitly. The remaining corpus consumers derive their membership from `ALL_FIXTURES` or `SCORABLE_FIXTURES`; I found no additional hard-coded membership/count gate beyond those listed. The score-artifact matrix test will require the planned regenerated results.

**Verdict: change first.**