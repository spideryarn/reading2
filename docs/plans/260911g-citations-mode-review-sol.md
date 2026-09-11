Verdict: **NO-SHIP as written.** The annotation allowlist is technically enforceable, but the plan has one established charging defect and several paths to missing or incorrectly linked citations.

### Findings

**F1 — P0 — “One web search” is not enforceable and can incur many search charges.**

Evidence: the plan promises one search and treats `max_results` plus a deadline as controls ([plan:67](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:67), [plan:137](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:137)). The gateway documentation records that `max_total_results: 4` still caused 36 billed searches, while `max_uses: 2` caused six; only the abort deadline and prompt constrain spend ([ai-gateway.md:343](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/project/ai-gateway.md:343)). The existing tool wrapper says the same ([converse.ts:241](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/converse.ts:241)).

Smallest change: call it one **chat-wire call**, not one search; require the ledger’s actual `webSearches` count and an alarm. If exactly one billed search is a requirement, the existing server tool cannot provide it—use an app-owned single-query search API instead.

---

**F2 — P1 — Footnote citations and occurrence locations cannot be recovered reliably from the proposed model input.**

Evidence: the model is asked for “blocks that cite it,” but the plan validates only that those IDs exist ([plan:52](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:52), [plan:93](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:93)). `articleWithIds` sends only each block’s plain text and ID, not its HTML, `noteId`, or hyperlink topology ([article-prompt.ts:137](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/article-prompt.ts:137)). The body-to-footnote relationship lives in generated anchor `href`s and note metadata ([notes.ts:727](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/notes.ts:727), [notes.ts:816](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/notes.ts:816)). Existing occurrence validation requires both a real ID and words found in that block ([ideas.ts:221](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/ideas.ts:221)).

Consequently, Wikipedia/Gwern footnotes cannot reliably support “first cited,” selected passages, or spine marks as described.

Smallest change: derive body↔footnote associations in code from internal links and `noteId`. For non-footnote citations, require `{blockId, quote}` and verify the quote with `findQuote`; drop and count unverified occurrences.

---

**F3 — P1 — “First external href” demonstrably assigns the wrong work.**

Evidence: rule 1 chooses any first external link in the alleged reference block ([plan:81](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:81)). A real Wikipedia fixture places an author’s Wikipedia page before the linked paper, so this rule returns Takatoshi Ito’s biography rather than *Economic Growth and Real Exchange Rate* ([wiki_gdp_table.html:1234](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/evals/extraction/fixtures/wiki_gdp_table.html:1234)). Gwern footnotes can contain several people and several works in one block ([gwern.html:1421](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/evals/extraction/fixtures/gwern.html:1421)).

Rule 2 is safer on failure, but the model cannot see anchor boundaries, and duplicate/generic anchor text such as “paper” or “here” can select the wrong anchor.

Smallest change: put DOI/arXiv extraction first. Otherwise accept only a unique anchor whose text or metadata matches the work title; give the model an app-generated anchor inventory if needed. Ambiguity must fall through to search, because a wrong work link is worse than no direct link.

---

**F4 — P1 — The Stage 3 URL-origin rule is enforceable, but it does not prove the result is the cited work and the default engine may expose no result set.**

Evidence: `collectCitations` can gather annotation URLs across streamed deltas ([openrouter-stream.ts:454](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/openrouter-stream.ts:454)), and `readSources` demonstrates exact allowlist lookup ([referee-candidates.ts:346](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/referee-candidates.ts:346)). However, the default engine emits annotations only when the model attributes results; an observed search produced zero annotations. Exa emits the actual result set independently ([referee-candidates.ts:530](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/referee-candidates.ts:530)). Even then, an allowed URL can be paired with the wrong entity or work ([referee-candidates.ts:520](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/referee-candidates.ts:520)).

Smallest change: specify Exa, collect every annotation into an exact URL map, and store the annotation’s URL/title—not the model’s title. Require a title/author/year match against annotation metadata or excerpt; otherwise label it merely as a “web result,” not the work’s address. No annotation means nothing is stored.

---

**F5 — P1 — V1 explicitly does not provide links to all citations.**

Evidence: the request says “a link to all of them” ([plan:11](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:11)). V1 caps output at 80 and instructs the model to omit the rest; chunking is deferred ([plan:112](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:112)). The footnote makes the omission visible, but does not satisfy the request. There is also no coverage witness ensuring the model returned every citation below the cap.

Smallest change: include chunking/“Find more” in v1, or deterministically enumerate bibliography, footnote, and inline-anchor candidates before asking the model to classify and score them. Otherwise the reduced scope needs explicit admin approval.

---

**F6 — P1 — Citation identity, deduplication, and lookup survival are unspecified.**

Evidence: the per-work schema omits an ID ([plan:52](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:52)), yet `?cite=<id>` and the Stage 3 table both depend on one ([plan:62](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:62), [plan:142](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:142)). Existing modes deliberately preserve incumbent IDs so deep links and paid lookups survive regeneration ([glossary.md:250](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/project/glossary.md:250), [term-lookup.ts:348](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/term-lookup.ts:348)).

Without this, prompt/model reruns can orphan stored web results and deep links; duplicate shorthand/full references can also become separate rows.

Smallest change: define code-minted IDs, a conservative dedupe key—DOI/arXiv/canonical article URL first, normalized title+authors+year otherwise—and same-source ID inheritance. Key Stage 3 storage on that stable identity.

---

**F7 — P2 — V1 spends complexity on unrequested passage navigation while deferring requested completeness.**

Evidence: row selection, `?cite`, passage marks and spine integration are additions ([plan:62](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:62)); complete enumeration is deferred ([plan:159](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:159)).

Smallest change: defer selection/highlighting and store only the earliest verified citation location needed for “first cited.” Spend that implementation budget on complete enumeration. Stage 3 itself should stay: web search was explicitly requested.

---

**F8 — P2 — Several `new-mode.md` residue items are not named.**

The generic “every client total” does not cover:

- the `search-hits.ts` resolver required for passage marks ([new-mode.md:53](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/project/new-mode.md:53));
- `CACHEABLE` for the new GET route ([new-mode.md:100](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/project/new-mode.md:100));
- containment `WITNESS` coverage ([new-mode.md:43](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/project/new-mode.md:43));
- the independent `GENERATES`, visitor-gap, page-title, passage-producer and possible stylesheet-manifest tests ([new-mode.md:345](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/project/new-mode.md:345), [new-mode.md:359](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/project/new-mode.md:359)).

Smallest change: add these explicitly to Stage 2’s checklist and acceptance tests.

---

**F9 — P2 — The glossary’s product rationale does not transfer to relevance × influence.**

The glossary multiplies because both dimensions are necessary: an easy central term and a hard peripheral term should both be excluded ([glossary.md:923](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/project/glossary.md:923)). Citation influence is not necessary for relevance: an obscure work central to the article remains important. The plan knowingly hides that case ([plan:102](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:102)).

Smallest change: of the proposed alternatives, use a mean, preferably weighted toward relevance, and recalibrate the initial threshold. `max` admits famous-but-peripheral works; relevance alone makes “prioritised” duplicate the relevance order.

---

**F10 — P2 — `MAX_CITATIONS` plus `budgetFor` is not yet a budget design.**

Evidence: the plan names no per-work occurrence cap or answer-token formula ([plan:112](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/docs/plans/260911g-citations-mode.md:112)). `budgetFor` only adds headroom to the estimate supplied by its caller; each stage must estimate its own output ([token-budget.ts:21](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/token-budget.ts:21)). Its default thinking headroom is explicitly insufficient evidence for very long papers ([token-budget.ts:96](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/token-budget.ts:96)). Ideas caps occurrences and budgets from the bounded response shape ([ideas.ts:293](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/ideas.ts:293), [ideas.ts:914](/home/greg/code/spideryarn2/.claude/worktrees/citations-mode/src/ideas.ts:914)).

Smallest change: specify field-length and occurrence caps, an explicit `base + entries × per-entry` answer estimate, and a citations-specific headroom measured on a long PDF. Deriving footnote occurrences in code—or deferring full passage lists per F7—substantially reduces this risk.

No files were changed.