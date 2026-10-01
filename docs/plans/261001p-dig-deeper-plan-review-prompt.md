# Plan review: 261001p, *Dig deeper*

You are reviewing a plan, read-only. Do not change any file. The plan is
`docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md`, committed at `575821fa9`
in this worktree (branch `worktree-go-deeper`). Only that one file changed; the rest of the tree is the
code it proposes to change.

The brief (from the Overseer, on Greg's words quoted at the top of the plan): rename Glossary's
"Check the web" to one name used by every equivalent "dig into this one thing" action; make that
action always search the web (forced, not left to the model), always use a bigger model, and use
library search if it exists; measure the cost; keep per-reader limits covering it; do Glossary plus
two or three clear equivalents; don't change what modes produce apart from these actions.

## Do your own pass first

Attack the plan. In particular:

1. **Is the survey complete and right?** Are there per-item "tell me more" actions it missed or
   misclassified? Start at `src/web/*Panel.tsx`, `src/web/CommentDialog.tsx`,
   `src/web/CitationInvestigation.tsx`, `src/routes.ts`, `src/explain.ts`, `src/term-lookup.ts`,
   `src/citation-investigate.ts`, `src/converse.ts`, `src/chat-tools.ts`. Not a limit on scope.
2. **The forcing mechanism.** The plan's probe table says Opus 5.5 returns a 400 with a forced
   `tool_choice`, and that the Exa `web` plugin forces a search but defeats the prompt cache. It
   proposes a separate quick-tier call with `tool_choice: "required"` that only searches, whose
   annotations go into the Opus answer's last user part. Is that the simplest thing that is
   actually forced? Is there a simpler route the plan missed? Is "throw when usage reports zero
   searches" right, and is usage a trustworthy witness there (see `src/openrouter-stream.ts` and
   `src/ai-call.ts` on where the search count is read)? Does `openRouterJson` return annotations
   (url/title/content) in a form the plan can use?
3. **Cache and the snapshot.** `src/explain.ts` and `tests/explain-request-snapshot.test.ts` treat
   the tool definition and the system prompt as a byte-identical cached prefix. Does the plan keep
   that true? Does anything about `power: "high"` for a standard article break an invariant in
   `src/models.ts` / docs/project/high-powered-ai.md (e.g. stored `model` / `generationKey`
   freshness, effort handling on Opus, `max_tokens` with mandatory reasoning)?
4. **Billing and limits.** docs/project/high-powered-ai.md charges a reader an article's allowance
   to switch an article to Opus. The plan gives *every* Dig deeper press Opus with no such charge.
   Is that a loophole or a charging defect (P0 by the scale below)? Is stage 3's new
   `dig-deeper` rate bucket the right shape, and is Investigate's existing budget/fuse handled?
5. **Security.** Web page text goes into the prompt. docs/project/security-map.md.
6. **Scope and staging.** Is each stage a safe stopping point? Is leaving out the library search
   (§ Library search) the right call given `src/chat-tools.ts` `search_library` and
   `src/store/pg-shelf.ts` `pgLibrarySearch`? Is keeping glossary *Look up* out right?
7. **The name and the copy.** "Dig deeper" against Greg's "investigate further or go deeper".

## Then my own suspicions (worth less; spend most of the run elsewhere)

- The quick tier (Luna, OpenAI) writing the search query may be read as violating "always uses the
  capable tier". I think the answer the reader reads is what matters.
- Citations Investigate already has a *Look it up* step that searches; adding a forced search there
  may be redundant.
- Merging all five search-step sources into the citations list might over-claim what the answer
  used.

## Severity and format

P0 data loss, exploitable security, incorrect charging, or service broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability risk;
P3 prose. Refuse only on an established P0/P1 (direct evidence, no unresolved load-bearing
inference). Give every finding an ID (F1, F2, …), a severity, file:line evidence, and a concrete
fix. Start with a one-line verdict: build as planned / build with changes / rethink.
