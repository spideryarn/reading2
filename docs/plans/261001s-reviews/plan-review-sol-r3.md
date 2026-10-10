Structured outputs is the right primary fix, and the starts-only converter is now at the right seam. Revision 3 still needs changes before building.

No P0 findings.

- **H1 — P1 — The plan builds against a stale branch, then merges the evidence it depends on afterwards.**

  [The workflow](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:126) merges `origin/dev` only after Sol builds each stage. But candidate `56a0858ba` predates the thinking-effort harness/research and `src/paper-metadata.ts`; both exist on `origin/dev`. It also predates Sketch’s move to `low`, which changes the exact quality and cache risks under a schema.

  This already makes [the “three existing users” claim](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:95) false after integration. `origin/dev` has six strict-schema chat users: `paper-metadata.ts`, `pdf-authors.ts`, `pdf-figure-locate.ts`, `pdf-frontmatter.ts`, `pdf-read.ts`, and `shelf-terms/model-scores.ts`.

  **Plan change:** merge `origin/dev` before Stage 1, then regenerate the inventory and review the resulting diff. Do not build Stage 1 or survey Stage 3 on this candidate and merge their inputs afterwards.

- **H2 — P1 — Schema identity is missing from the cache-group contract, so rollout can silently turn intended reads into paid writes.**

  Stage 3 says only to [measure cache groups](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:213). Today [`sharesArticleCache`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/pipeline.ts:313) groups solely by effort and article renderer. Once Ideas, Timeline, Quiz, FAQ, Simple and Tweets carry different `output_config.format` values, that predicate can still mark them as compatible, causing both calls to pay the 1.25× write premium while neither reads the other’s prefix. The repo’s own rule is that cache compatibility includes request parameters, not merely prompt bytes ([prompt-caching.md:91](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/project/prompt-caching.md:91)); Anthropic explicitly says changing `output_config.format` invalidates prompt caches. [Anthropic structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

  The plan also incorrectly names Arc and Tweets as sharers at [lines 77–79](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:77); Tweets now uses the `ids` renderer and Arc uses `text`.

  **Plan change:** make the exact format/schema identity a third cache-compatibility dimension—or conservatively declare differently formatted stages incompatible. Add red-first grouping tests and one paid writer/reader test that asserts non-zero cache reads, not merely successful answers.

- **H3 — P1 — The quality response is directionally right but has no executable shipping rule, and Stage 3 barely measures quality at all.**

  Stage 2 says [“if `toc/11` at `low` is worse”](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:193), without defining worse, the panel size, judge rule, or whether a possible loss stops shipping. The Done condition allows either “quality held” or merely [“the trade put to Greg”](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:239), so the gate does not determine whether `toc/11` may ship.

  The merged 261001p harness already supplies the missing contract: eight articles, two draws per arm, two blind judges, U thresholds, and the stricter Hierarchy rule requiring no visible loss from both judges plus structural gates. Stage 3 is weaker still: for Ideas, Sketch and Quotes it asks only for [failure rates](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:211), even though the probe’s central finding is that a schema changes thinking, not just validity. Sketch now runs at `low`, so it is exposed to the same zero-thinking risk as Structure.

  Anthropic’s current Sonnet guidance specifically warns that structured outputs at low/medium can skip thinking and recommends “Think the problem through before you answer.” [Sonnet prompting guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5)

  **Plan change:** pre-register the existing eight-article/two-draw Hierarchy rule for Stage 2; a failure stops shipment pending Greg’s decision. If plain `toc/11 low` loses, test `low` plus the documented think-first line before buying `medium`. For Stage 3, require a same-effort before/after quality panel for semantic, low-effort outputs such as Sketch—not only parse counts.

- **H4 — P1 — Stage 1’s schema checker guards only two of the provider’s many hard-400 cases.**

  The helper promises only cycle detection and [`additionalProperties: false`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:151). Anthropic also rejects external references, `allOf` combined with `$ref`, `minimum`/`maximum`/`multipleOf`, `minLength`/`maxLength`, most array constraints, excessive optional or union fields, and complex unsupported regexes. These produce request-time 400s. [Anthropic’s supported-schema subset](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

  “Validates at test time” is insufficient unless every schema necessarily passes through that validation in normal construction. The helper should enforce its contract whenever it constructs a format.

  **Plan change:** specify a pure, non-mutating runtime normaliser/validator over the supported subset. Tests must cover:

  - direct and indirect `$ref` cycles, external refs, and allowed acyclic local refs;
  - nested objects beneath `properties`, `items`, `$defs`/`definitions`, `anyOf`, and `allOf`;
  - missing or non-false `additionalProperties`;
  - `minLength`, `maxLength`, `minimum`, `maximum`, `multipleOf`, unsupported `minItems`, and unsupported regex constructs;
  - optional/union complexity ceilings;
  - explicit effort plus format surviving unchanged;
  - high-powered adaptive calls gaining `effort: "high"` without losing format, through [`messagesWireBody`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/messages-stream.ts:462);
  - standard-power calls retaining format without acquiring an effort.

- **H5 — P1 — The planned shared helper cannot be the rollout seam for both wire protocols.**

  Stage 1 explicitly creates a [Messages-wire helper](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:149), but Stage 3 says every fitting call—including surveyed chat-completions calls—[moves onto that helper](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:202). The wire shapes differ:

  - Messages: `output_config.format = {type, schema}`.
  - Chat completions: `response_format = {type, json_schema: {name, strict, schema}}`, as in [pdf-frontmatter.ts:424](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/pdf-frontmatter.ts:424) and [pdf-read.ts:880](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/pdf-read.ts:880).

  **Plan change:** either scope the helper strictly to Messages and leave existing chat schemas alone, or create one shared schema validator plus two small wire adapters. Preserve chat schema names, `strict: true`, and each job’s `require_parameters` routing policy.

- **H6 — P2 — The survey names useful criteria, but its adoption test does not protect completion semantics or mixed-output callers.**

  The only required migration test is that [the request carries the schema](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:207). Structured output may legitimately violate the schema on refusal or truncation; existing Messages callers deliberately check `wasRefused` and `max_tokens` before parsing, for example [hierarchy.ts:2547](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy.ts:2547). Anthropic also declares JSON output incompatible with native citations. [Structured-output failure and compatibility rules](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

  Add survey columns and adoption tests for provider/model support, refusal, truncation, schema-compilation failure, cold-schema latency, message prefilling, tools/plugins, and final-versus-partial parsing.

  Already expected not to fit without a separate probe:

  - [`src/debate.ts`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/reception.ts:258): explicitly keeps a fence because schema plus `openrouter:web_search` is unmeasured.
  - [`src/citation-find.ts`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/citation-find.ts:234) and `src/source-guess-run.ts`: search annotations are the security witness for allowed URLs.
  - [`src/dig-deeper.ts`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/dig-deeper.ts:299): also requires web-search annotations.
  - [`src/referee-candidates.ts`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/referee-candidates.ts:180): deliberately streams reader-visible prose while hiding and later parsing a fenced shortlist; a JSON-only response changes the product.

  Conversely, `src/citations.ts` is ordinary app-authored JSON and does not use Anthropic’s citation-block feature; its filename must not exclude it. [`src/search.ts`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/search.ts:530) probably fits via the chat adapter, but only with an integration test proving `hitExtractor` still emits validated hits before completion.

  Exclude non-model persistence parsers such as `src/shelf.ts`, `src/chat.ts`, `src/comments.ts`, `src/searches.ts`, and `src/glossary-lookups.ts`; searching every `parseJsonFrom` caller otherwise creates irrelevant work.

- **H7 — P2 — The starts-only converter design now satisfies G1, but its named policy differences need direct tests.**

  Keeping `ModelNode.range` complete, converting at `treeFrom`, and extracting the common start-to-ranges kernel is the correct seam. However, [the test list](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:175) does not directly test the two policies the plan itself identifies: whole-document clamping versus scoped refusal, and one-child collapse versus scoped refusal. Those differences are load-bearing in [`normaliseExpansion`](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/hierarchy-cascade.ts:1317).

  **Plan change:** add direct tests for nested derivation, outside-parent first and later starts, duplicate/non-increasing starts, heading snap, one-child input, collapse-to-one after drops, root/body bounds, and no mutation of the answer DTO. Keep the offline replay gate.

  Also correct [“A schema cannot invent an id”](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:118). A model constrained to a string can still emit an invented or wrong-real id; the resolver—not the schema—rejects the invented one. The plan already says this correctly at lines 81–88.

- **H8 — P2 — Stage 3 is too large, while Stage 4 duplicates its most valuable evaluation.**

  Stage 3 combines the complete inventory, two-wire infrastructure, every migration, partial-stream verification, three paid evals and cache experiments in one stage ([lines 200–214](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:200)). Stage 4 then reopens Ideas under the same schema for the lower-effort panel ([lines 216–222](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md:216)).

  **Plan change:** make the survey a read-only stage producing the matrix; migrate by wire/cache group in small commits, prioritising observed failures—Ideas, Sketch and Quotes—then the remaining Messages calls, then chat calls. Run Ideas’ lower-effort panel as part of its migration so the same draws establish validity, quality and cost once.

**Verdict:** revise before building—structured outputs and starts-only are the right decisions, but branch order, cache compatibility, the quality gate, schema validation and the two-wire rollout are not yet safe enough to execute.