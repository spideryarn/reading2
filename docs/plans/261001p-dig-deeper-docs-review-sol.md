Verdict: needs correction — no P0; 10 P1, 7 P2, and 4 P3 findings. Greg’s quotation at `glossary.md:576–588` matches the plan exactly. No files changed.

- **F19 — P1** — [setup-dev.md:506](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/setup-dev.md:506) says a lookup saved by Dig deeper stops attaching when `SPIDERYARN_CITATIONS_FIND_MODEL` is overridden. [pg.ts:3821](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/store/pg.ts:3821) deliberately accepts both the configured standalone-Find hash and `DIG_DEEPER_MODEL` hash.

  Corrected wording: “Since Dig deeper, a press ignores this override: its quick check and paper-passage call use `DIG_DEEPER_MODEL`. A lookup saved by the press still attaches while this override is active. Stand-alone `POST …/find` continues to use it.”

- **F20 — P1** — [citations.md:456](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/bibliography.md:456) says the investigation fingerprint “covers everything sent.” Forced-search and library findings are deliberately excluded at [citation-investigate.ts:1010](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:1010), as is fetched paper content at [citation-investigate-context.ts:164](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate-context.ts:164).

  Corrected wording: “The fingerprint covers reconstructible inputs: the article, work fields and link, why and citing passages, profile, current quick-check match, prompt and paper-selection versions, and model generation. Search findings and fetched paper content are dated snapshots and are not fingerprinted.”

- **F21 — P1** — [glossary.md:590](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/glossary.md:590) presents *Digging deeper…* and *Dig deeper again* as labels shared by all three modes. Comments always render *Dig deeper* and hide it while pending, showing “N still working,” at [CommentDialog.tsx:609](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/CommentDialog.tsx:609) and [CommentDialog.tsx:625](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/CommentDialog.tsx:625).

  Corrected wording: “All three controls are named *Dig deeper*. Glossary and Citations show *Digging deeper…* while running and *Dig deeper again* over a kept answer; comments hide the control while running and continue to call the re-ask *Dig deeper*.”

- **F22 — P1** — [glossary.md:594](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/glossary.md:594) generalises the `dig-deeper` job, plain-`explain` cache identity, and 2.4×/4× cost ratios to “every press.” Citations builds a different prompt and runs `citation-investigate` at [citation-investigate.ts:1071](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:1071) and [citation-investigate.ts:1092](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:1092).

  Corrected wording: “The modes share `searchFirst`, library lookup, and `DIG_DEEPER_MODEL`. Glossary and comments feed the findings to `explainStream` under `dig-deeper`; only that path has the plain-explain prefix and the quoted 2.4×/4× measurements. Citations feeds them to `investigatePart` and streams `citation-investigate`.”

- **F23 — P1** — [glossary.md:563](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/glossary.md:563) says pressing Dig deeper “turns a remembered answer into a checked one.” The background is not passed into `explainStream`; the lookup is stored separately at [term-lookup.ts:378](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/term-lookup.ts:378) and [term-lookup.ts:401](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/term-lookup.ts:401).

  Corrected wording: “…pressing it adds a separate answer based on a forced web search beside the remembered one:”

- **F24 — P1** — [comments.md:1077](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/comments.md:1077) says Glossary calls `explain` directly with the term’s name, and that Look up does the same without a dig. It calls `explainStream`; Dig deeper uses the first matching glossary form, which may be an alias, at [term-lookup.ts:141](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/term-lookup.ts:141), while Look up uses the exact matched characters at [term-lookup.ts:698](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/term-lookup.ts:698).

  Corrected wording: “Glossary’s Dig deeper calls `explainStream` with the first matching glossary form—name or alias—its first matching block, and the findings. Look up calls the same stream without a dig and quotes the exact matched characters.”

- **F25 — P1** — [comments.md:1090](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/comments.md:1090) promises that a prior comment question makes a glossary lookup a cache hit. Dig deeper always selects `DIG_DEEPER_MODEL`, whereas an ordinary comment uses the article model, at [explain.ts:501](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/explain.ts:501).

  Corrected wording: “Cache sharing is model-specific. A typed Look up can reuse an ordinary explanation on the same model; a Dig deeper press can reuse only an Opus prefix. On a standard-power article, the first dig writes Opus’s cached copy and later digs read it.”

- **F26 — P1** — [copy.md:132](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/copy.md:132) says `[gl-not-quoted]` means the article names the term rather than quoting it. [messages.ts:1741](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/messages.ts:1741) explicitly says this is only the usual cause; hallucinated entries and insufficient aliases also reach it.

  Corrected wording: “`[gl-not-quoted]` means none of the names the glossary holds for the term appears anywhere in the article; `[gl-stale]` means the list was written for an older version.”

- **F27 — P1** — the untouched nearby passage [setup-dev.md:463](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/setup-dev.md:463) says every request-path call shares a constant Anthropic provider pin and that this must change before any request-path job moves to quick. Routing is now per job; `dig-deeper-search` deliberately omits that pin at [ai-call.ts:611](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/ai-call.ts:611).

  Corrected wording: “Request-path routing is per job in `AI_JOB_ROUTE`. Cached capable jobs use the Anthropic preference; quick jobs such as `dig-deeper-search` omit it and retain `require_parameters`. A new or moved job should copy the route whose request shape it matches.”

- **F28 — P1** — [ai-gateway.md:112](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/ai-gateway.md:112) implies every Dig deeper answer is ledger job `dig-deeper`. Citations’ streamed answer is `citation-investigate` at [citation-investigate.ts:1092](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:1092).

  Corrected wording: “…all three Dig deeper paths’ forced search (`dig-deeper-search`); glossary/comments’ answer (`dig-deeper`); and Citations’ answer (`citation-investigate`, with `citations-find` and `citation-paper-passages` when needed)…”

- **F29 — P2** — [citations.md:371](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/bibliography.md:371) calls the context “the first paragraph that cites it.” Code takes the first non-empty citing block at [citation-investigate-context.ts:107](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate-context.ts:107), then clips it at [dig-deeper.ts:273](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/dig-deeper.ts:273).

  Corrected wording: “…the first non-empty citing passage, clipped to 800 characters.”

- **F30 — P2** — [citations.md:473](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/bibliography.md:473) describes one `citation-investigate` job “with `citation-paper-passages` inside it.” A press can record four separate gateway jobs: the forced search at [dig-deeper.ts:370](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/dig-deeper.ts:370), quick check, paper passages, and streamed answer at [citation-investigate.ts:1092](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:1092).

  Corrected wording: “A press can record `dig-deeper-search`; `citations-find` when the quick check runs; `citation-paper-passages` when paper passages are picked; and `citation-investigate` for the streamed answer.”

- **F31 — P2** — [glossary.md:660](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/glossary.md:660) calls the quote “the form … the article really uses.” The glossary path deliberately passes `hit.form`, not the exact `hit.matched`, at [term-lookup.ts:141](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/term-lookup.ts:141).

  Corrected wording: “with the matching glossary form—the name or an alias—as the quote, and the first block whose text matches it as the anchor.”

- **F32 — P2** — [glossary.md:903](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/glossary.md:903) makes `[dig-resting]` appear to identify both 429 and 503 refusals. Only the global 503 carries that code; the two 429 branches do not, at [dig-deeper.ts:151](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/dig-deeper.ts:151).

  Corrected wording: “…an ordinary JSON 429, or a 503 carrying `[dig-resting]`, and changes nothing.”

- **F33 — P2** — the follow-up diagram at [glossary.md:48](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/glossary.md:48) says `WEB SEARCH`; the reader sees `from a web search` at [GlossaryPanel.tsx:1873](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/GlossaryPanel.tsx:1873).

  Corrected wording: use `FROM A WEB SEARCH` in the schematic. The other follow-up sentence at `glossary.md:82` is accurate.

- **F34 — P2** — the untouched current visitor description [comments.md:954](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/comments.md:954) still says visitors have no *search the web*, which now reads as the old control name. The owner control is *Dig deeper* at [CommentDialog.tsx:618](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/CommentDialog.tsx:618).

  Corrected wording: “…no edit box, no delete, no retry, no *Dig deeper*, and no follow-up composer.”

- **F35 — P2** — [setup-dev.md:490](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/setup-dev.md:490) calls every listed variable a per-call override, while the newly documented citation-investigation variable is reporting-only: the reader call fixes its model at [citation-investigate.ts:953](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:953).

  Corrected wording: “Most rows below are per-call overrides. The Dig deeper rows name exceptions whose legacy task variables are still reported by `/profile` but do not control the reader-triggered answer.”

- **F36 — P3** — [citations.md:472](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/bibliography.md:472) restates “8 results” and “8,000 characters each.” These values are owned by `INVESTIGATE_MAX_TOTAL_RESULTS` and `INVESTIGATE_MAX_CHARACTERS` at [citation-investigate.ts:165](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/citation-investigate.ts:165).

  Corrected wording: “The answer’s optional Exa tool is pinned and bounded by `INVESTIGATE_MAX_TOTAL_RESULTS` and `INVESTIGATE_MAX_CHARACTERS`.” This should also distinguish it from the forced search’s separate bounds.

- **F37 — P3** — [glossary.md:908](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/glossary.md:908) restates “eight web searches” instead of naming its owner, [explain.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/explain.ts:146).

  Corrected wording: “…each may run up to `MAX_SEARCHES` web searches (`src/explain.ts`).”

- **F38 — P3** — the untouched override row [setup-dev.md:505](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/setup-dev.md:505) says link-summary is one of two quick-tier jobs. `TASK_TIER` now contains four, beginning at [models.ts:972](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/models.ts:972).

  Corrected wording: “…one of the jobs `TASK_TIER` places on the quick tier…” Avoid restating the count.

- **F39 — P3** — the nearby passage [setup-dev.md:442](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/docs/project/setup-dev.md:442) says one link-summary measurement is “all this repository knows about the tier.” The branch records a separate dig-search measurement at [models.ts:974](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/models.ts:974).

  Corrected wording: “For `link-summary` specifically, the measurement was … This is evidence for that job, not a general fact about the tier; other quick-tier jobs have their own measurements.”