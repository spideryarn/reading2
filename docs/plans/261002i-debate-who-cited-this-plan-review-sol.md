1. **P1 — Conclusion is wrong.**  
   **Location:** [plan lines 5–7](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/docs/plans/261002i-debate-leads-with-who-has-cited-this-article.md:5), “Neither” and “Simpler options passed over”; [feedback-reports.md § Who sent it](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/docs/project/feedback-reports.md:180).  
   A useful no-new-service version was dismissed too quickly. Pass A currently asks only for pages that “respond”; it can instead prioritize scholarly papers that cite, discuss, criticize, or support the article, using the title, byline, and address already sent to the existing web-search provider. Keep the existing checked excerpts, describe the results as “papers the web search found,” and make no claim of completeness. Exact-title searches readily surface both the [Pennycook et al. critique](https://keithstanovich.com/Site/Research_on_Reasoning_files/Pennycook_et_al_2018.pdf) and *The Insidious Number Two*.  
   **Fix:** Build that narrow version now: broaden Pass A, lead with its scholarly/direct results, and collapse Pass B by default. Await Greg only for adding a citation index. That is what the admin-feedback rule’s “afternoon-sized version” requires.

2. **P1 — The Semantic Scholar recommendation omits a deployment-blocking licence term.**  
   **Location:** “The question for Greg,” lines 119–128.  
   Semantic Scholar’s standard API licence is limited to internal, non-commercial research or education; embedding it in a paid product requires an Expanded License. Its public-display conditions also require a Semantic Scholar link with `utm_source=api`, plus the name and logo—not merely an attribution line. [Semantic Scholar API licence](https://api.semanticscholar.org/license/).  
   OpenAlex’s CC0 claim is sound, but “no key” is not a fair production description: current documentation treats a free API key and daily usage budget as the normal route; anonymous access has a much smaller budget, and either budget can return 429. [OpenAlex authentication](https://help.openalex.org/api/authentication/), [pricing](https://help.openalex.org/access/pricing/).  
   **Fix:** Do not recommend Semantic Scholar until AI2 grants commercial terms and their price/conditions are known. State that both production choices likely add a secret and operational quota; OpenAlex is immediately licence-compatible but does not supply citation contexts.

3. **P2 — The arithmetic is right, but “334 works” is not.**  
   **Location:** evidence table, mock panel, and § Evidence; `data/s2*.json`.  
   The files contain exactly 334 rows: `100 + 100 + 100 + 34`. Exactly 138 rows have at least one nonblank context: `52 + 34 + 36 + 16`. The first page’s intents also match: background 21, result 2, methodology 1.  
   However, two pairs are duplicate records for the same DOI, including case-only DOI variation. Deduplicating by lower-cased DOI leaves **332 distinct works**, still 138 with contexts and **194**, not 196, without contexts. The mock “41 more that mention it in passing” has no supporting classification evidence.  
   **Fix:** Say “334 citation records” in the probe, deduplicate before displaying or counting works, merge duplicate contexts, and update the UI numbers. Remove or mark “41” as illustrative.

4. **P2 — The raw evidence does not support all the claimed fields or the proposed ranking.**  
   **Location:** table lines 48–52 and selection step 3.  
   No supplied page contains abstracts. The first 100 rows also omit `externalIds` and `citationCount`, while the other three pages include them. Consequently, the captured probe cannot support “the same … abstract,” nor can it reproduce citation-count ranking consistently across all 334 rows.  
   **Fix:** Re-run every page with one identical, recorded `fields=` list and preserve the request URL. Either collect abstracts and citation counts everywhere or remove those claims from the table.

5. **P1 — A valid but wrong DOI can attach another paper’s citers to the article.**  
   **Location:** “The simplest version worth building,” step 1.  
   `Meta.doi` is explicitly checked only for shape, and `src/bibliographic.ts` warns that a mistyped DOI can resolve perfectly to the wrong work. The plan avoids unsafe title search but does not verify the identifier it trusts. It also does not resolve a conflict between the metadata DOI and an identifier in the article URL. Finally, Debate’s current fingerprint omits `doi`, so changing that DOI need not invalidate the stored result.  
   **Fix:** Fetch the target record first and require strong title agreement before asking for citations; refuse conflicting identifiers; store the queried identifier and returned target identity; include the chosen identifier in the Debate fingerprint.

6. **P1 — The proposed selection hides one of the two papers used to justify the feature.**  
   **Location:** lines 54–58 versus steps 3–5.  
   The raw row for *The Insidious Number Two* has `contexts: []`. Because step 3 considers only works with a citing sentence, the proposed v1 would bury that paper among the unclassified 196 even though the plan calls it one of the two papers the reader most needs.  
   **Fix:** Show high-signal direct-response titles without contexts in an explicit “citation found; stance not classified” section. Never infer their stance from title or abstract. The existing web search can try to supply checked evidence for those rows.

7. **P1 — The model-output contract can silently omit, swap, or mislabel citers.**  
   **Location:** steps 3–4.  
   “Labels each citing sentence” is not enforced by the proposed design. A batched model answer could omit an input, duplicate one, attach a quotation to the wrong paper, or return fewer than 30 while every quote it did return validates. Also, `supports` is not Debate’s existing relation vocabulary—the value is `corroborates`—and the existing `lean` field is the one that directly answers “for or against.” Finally, Semantic Scholar contexts are provider-supplied extracts, sometimes fragmented or ellipsized; they have not been verified against the citing paper and should not be called quotations fetched from that paper.  
   **Fix:** Give every input its Semantic Scholar paper ID; require exactly one output per selected ID; reject/count missing, duplicate, and unknown IDs; join title/authors/URL from trusted API data rather than model output; validate and persist the matched context slice. Reuse `relation` unchanged and also produce `lean`. Label the evidence “citation context supplied by Semantic Scholar” unless it is checked against the paper itself.

8. **P2 — Pagination is more complicated than necessary and can become silently incomplete.**  
   **Location:** step 2.  
   Semantic Scholar’s citation endpoint permits `limit=1000`, so ten requests of 100 are unnecessary for the stated cap. More importantly, results beyond the cap are not relevance-sorted; ranking only the first arbitrary 1,000 can omit the most important response while “Who has cited this” sounds complete. [Semantic Scholar API endpoint](https://api.semanticscholar.org/api-docs/snippets).  
   **Fix:** Fetch up to 1,000 in one request. Treat any remaining `next` token as truncation and display “at least 1,000; showing a partial list.” A page failure must invalidate the whole citation-index result rather than preserve a partial count.

9. **P1 — The question to Greg is understandable but not answerable correctly.**  
   **Location:** § The question for Greg.  
   It asks Greg to select Semantic Scholar without saying that Spideryarn first needs a commercial licence whose terms are unknown, and presents OpenAlex as keyless. It also omits the useful existing-service version, making “neither” sound like “build nothing.”  
   **Fix:** Ask separately:

   - Build the existing-web-search version now.
   - Use OpenAlex for a broad list/count but no checked stance.
   - Ask AI2 for commercial Semantic Scholar terms, then return with the actual price, attribution, storage, and termination conditions.
   - Add neither index.

   Separately ask whether citation-index lookups may run for private uploads, explaining exactly which identifier is sent and that cached results may avoid later requests.

**Verdict:** Reject the conclusion—build the useful current-service scholarly-response version now, and await Greg only on adding a citation index.