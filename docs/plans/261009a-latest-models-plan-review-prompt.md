You are reviewing a plan before it is built, in the Spideryarn repo (this working tree). Read-only.

Plan: docs/plans/261009a-latest-model-versions-haiku-5-5-and-an-opus-digest-spike.md

Read it, then check it against the code: src/models.ts (CAPABLE_MODEL, generationKey, sameGenerator, QUICK_MODEL_OPENROUTER, PDF_READER_MODEL, PDF_FIGURE_LOCATOR_MODEL, HELP_CHAT_MODEL), src/model-names.ts, src/pricing.ts, src/pdf-read.ts (the size-limit table), src/ai-call.ts (routes, CHAT_REASONING, the effort seams), src/high-power-model.ts, tools/overseer/attention-classify.ts, tools/fleet/describe.ts, and tests that pin these strings.

Questions:
1. Stage 1: is adding the Sonnet 5 spellings to generationKey's capable generation correct and sufficient so that NO stored artefact goes stale and no stored content hash changes (lookupContextHash, investigateContextHash, citation fingerprints, checkpoint keys like labels' batchFingerprint)? Any staleness check that bypasses sameGenerator?
2. Anything on the wire that Sonnet 5.5 rejects and Sonnet 5 accepted (thinking disabled, sampling params, forced tool_choice, effort values, max_tokens/thinking interplay, prompt-cache floors per model in underCacheFloor, any per-model table keyed on the literal id) that the plan misses? Same for GPT-6 Luna replacing GPT-5.6 Luna (reasoning effort "none", max_completion_tokens, json_schema, the PDF route and its 40 MiB table, provider routing), and Gemini 3.8 Flash for the figure locator (box_2d convention).
3. Is any of the bumps not "obviously right" and should be left for Greg (e.g. the PDF reader, chosen by measurement)? 
4. Stage 3 spike design: is the comparison fair and informative at this tiny scale (3 articles x 3 tasks x 5 arms, blind judging by an Opus subagent and GPT Sol)? What would make it misleading? Is there a better version of Greg's digest idea worth testing in the same budget (<$8)?
5. Anything else wrong or missing.

Answer as a numbered list of findings, each with severity (blocker / should-fix / nit), file:line evidence, and a concrete fix. End with a one-line verdict.
