# How they worked — the habit worth stealing, and the one to avoid

Greg's call on 2026-08-24 was to leave their process alone for now. Two things are worth revisiting,
because one of them is the single cheapest quality improvement available and the other is a trap this
very folder could fall into.

Reference docs: `docs/reference/CODING_PRINCIPLES.md`, `CODING_GUIDELINES.md`,
`SETUP_FOR_AI_FIRST_CODING.md`, `INDEX_FOR_DOCUMENTATION.md`, plus `docs/instructions/` and
`docs/conversations/`.

## The critique habit, worth stealing

Repeatedly, a plan was written and then handed to a **different model** — o3, Gemini, o3-pro — for
critique *before* implementation, and the critique was folded back in. It is documented as a
practice, with the reviews kept beside the plans they reviewed:

- The [structure panel](structure-panel.md#the-critique-before-implementation-pattern) plan got a
  critique that caught five small real defects, including the duplicate-heading-id trap.
- The [level-by-level headings](ai-headings.md#the-design-that-was-chosen-then-abandoned) plan got a
  critique that stopped it being built at all — correctly, because it depended on infrastructure
  that didn't exist.
- The [tool framework](tool-framework.md) got two independent critiques that agreed with each other
  about what was wrong with it.
- The shipped headings tool got a post-hoc review that found the id-accumulation bug.

**Two things made this work**, and they are both copyable:

1. **A different model, not another pass of the same one.** The value came from a genuinely
   different reader. `docs/conversations/` holds ~30 of these, several cross-model.
2. **The critique lives beside the plan, permanently.** Including for the plan that was discarded —
   `docs/planning/discarded/` is where the reasoning survives. A rejected design with the reason
   attached is worth more than a silently abandoned one.

We already have the machinery: [`scripts/run-codex.ts`](../../../scripts/run-codex.ts) and
[codex-cli-as-subagent.md](../../reusable/codex-cli-as-subagent.md). What we don't consistently have
is the habit of using it **before** building, and keeping the answer. `docs/plans/` is the right home
— [shadcn-migration.md](../../plans/shadcn-migration.md) already does exactly this, including the
honest account of what its own predictions got wrong.

## Their coding principles

`CODING_PRINCIPLES.md` is 37 lines and good. The lines that transfer:

> fix the root cause rather than putting on a bandaid

> fail fatally & immediately with clear, debuggable, user-visible error messages

> don't try to write a full final version immediately — simple version end-to-end first

Plus: no fallbacks or defaults masking bad input, **never silently modify data**, and ask rather than
obey. This repo has inherited the spirit without copying the file, and it shows up in specific
places — the ["no automatic fallback"](extraction.md#the-correction-the-escalation-ladder-was-never-built)
extraction policy, the fatal id collision ([ids.md](ids.md#three-more-things-they-learned-the-hard-way)),
and [`validate-tree.ts`](../../../src/validate-tree.ts) failing a bad tree rather than repairing it.

`CODING_GUIDELINES.md` is 776 lines and mostly not portable — Next.js and Supabase specifics, RLS
checklists, API route boilerplate, import-order rules a linter should own. The lesson there is that a
long standards document mostly encodes what tooling should enforce. Ours is
[linting.md](../linting.md) plus a Biome config, which is the right split.

## 129 reference documents, and what that costs

`docs/reference/` holds **129 files**. That is the visible price of "we keep lots of documents"
without the discipline our own [CLAUDE.md](../../../AGENTS.md) imposes — kebab-case names, a
signpost for every new doc, and *"record decisions where they belong… that file should shrink."*

The cost is not disk space. It is that **you can no longer tell which documents are true.** Four
separate reference docs in that repo describe features in the present tense that were never built:

| Doc | Describes | Actually |
|---|---|---|
| `HTML_CONTENT_PROCESSING_OVERVIEW.md` | a three-tier extraction escalation ladder | [no such code path](extraction.md#the-correction-the-escalation-ladder-was-never-built) |
| `LLM_PROMPT_CACHING.md` | caching design, with a full implementation plan | [zero hits for `cache_control`](prompt-caching.md#how-we-know-it-was-never-built) |
| `RESEARCH_ON_OPTIMAL_TEXT_FORMATTING.md` | a reader settings UI, marked "✓ Implemented" | [no such component](typography.md#what-they-wanted-and-never-built) |
| `ARCHITECTURE_MOBILE.md` | mobile layout and touch gestures | [listed Planned/Future in the same doc](reading-view-ui.md#mobile) |

And two docs disagree with each other about whether they used the Tailwind typography plugin.

**This is the thing to guard against here**, and this folder is exactly the kind of artefact that
could develop the problem: it is long, it is confident, and it describes code in another repository
that nobody here will re-check. Three defences, two of which already exist:

- **The doc-link test** ([testing.md § Why the docs have a test](../testing.md#why-the-docs-have-a-test))
  keeps the signposts honest, anchors included.
- **Say what is aspiration.** Where this folder describes something unbuilt over there, it says so.
  Where our own docs describe something unbuilt here, they should say so too — the model is
  [web-client.md § How the migration finished](../web-client.md#how-the-migration-finished), which
  records what was done and what was deliberately dropped rather than leaving a "Future" section
  nobody owns.
- **Check the code before believing the doc**, in either repo. That is the habit that produced the
  four rows in the table above, and it took one `grep` each.

## `docs/instructions/`

~35 reusable "how to do this kind of task well" playbooks — planning-doc templates, sounding-board
mode, debrief mode, architecture-audit mode, and several for gathering cross-model critique. This is
Greg's gjdutils library in its native habitat, and we already import the relevant parts through
[gjdutils-instructions.md](../../reusable/gjdutils-instructions.md). Nothing further to do.

## See also

- [overview.md](overview.md) — the map to that codebase
- [../testing.md](../testing.md) — the doc-link test, and what else is worth testing
- [../linting.md](../linting.md) — where the mechanical half of a standards doc belongs
- [../../reusable/gjdutils-instructions.md](../../reusable/gjdutils-instructions.md) — the instruction library
- [../../reusable/codex-cli-as-subagent.md](../../reusable/codex-cli-as-subagent.md) — how to run a cross-model critique here
- [borrow-list.md](borrow-list.md) — what all of this adds up to
