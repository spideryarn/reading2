# Review prompt — Citations mode, the plan (read-only)

You are reviewing a **plan**, before any code is written, for a new reading mode in Spideryarn, an
AI-assisted reading app (TypeScript, Postgres, React). Do not change any file. Write your findings
as your final answer.

## The candidate

`docs/plans/260911g-citations-mode.md`, committed at `1cd148ca` on branch
`worktree-citations-mode` (worktree `/home/greg/code/spideryarn2/.claude/worktrees/citations-mode`).
That file is the whole candidate; nothing else changed.

The request, verbatim, from an admin:

> Add a Citations mode that looks at citations and looks at the bibliography and references and
> provides, you know, a link to all of them. And you can either order them by when they appear in the
> text, or how relevant they are, or how influential, or a prioritized score. (the default, with
> threshold bar, kinda like Glossary etc) It will need web search(es)

The house rule is *simplest version that works end to end, name the deferred rest*.

## What to read to check it against

Start with these; they do not limit your scope:

- `docs/project/new-mode.md` — the checklist for adding a mode, both halves.
- `docs/project/glossary.md` § The scores… through § It hides what is below it — the order and bar
  this copies; § Checking a term on the web — the per-entry web search precedent.
- `docs/project/quotes.md`, `src/quotes.ts`, `src/ideas.ts` (`validateOccurrences`),
  `src/timeline.ts` — the three most recent artefact-backed list modes.
- `src/article-prompt.ts` (`articleWithIds`), `src/types.ts` (`Block`), `src/notes.ts` — what the
  model sees, and what the article's footnotes already look like.
- `docs/project/ai-gateway.md` § The four things that fail silently (web-search cost),
  `src/explain.ts` and `src/converse.ts` § `webSearchTool` — how web search is called today.
- `src/store/pg-lookups.ts` — the per-entry lookup storage stage 3 would copy.

## What I want

An independent attack on the plan first:

1. **Does v1 as written actually satisfy the request end to end?** Anything asked for that the plan
   quietly drops, or a stage that cannot work as described.
2. **The safety property** — links derived in code from the article, never written by the model.
   Are the four rules sound on real article shapes (Wikipedia references, gwern-style bibliography
   plus footnotes, a blog post whose citations are inline hyperlinks, a PDF-derived paper)? Where
   does rule 2 (`linkText` matched to an anchor) or rule 1 (first external href in the bibliography
   block) pick the wrong link, and is that worse than no link?
3. **Stage 3's rule** that a found URL must be one of the search results' own annotation URLs — is
   that enforceable on the wire as `src/explain.ts` / `src/referee-candidates.ts` receive results?
4. **Anything simpler** that gets most of the value — a stage worth cutting, merging or reordering.
5. Anything in `new-mode.md`'s checklist the plan will trip over that it does not mention.

Then, labelled as my own suspicions and worth less — spend most of the run elsewhere:

- `relevance × influence` as the prioritised gate hides a central-but-obscure work under the default
  bar. Is `max`, a mean, or relevance alone better for *this* list?
- `articleWithIds` sends block text only; for a long academic paper, the output (up to 80 entries,
  each with block ids and a sentence) may be large. Is the cap and `budgetFor` enough?

## Severity and form

P0 data loss / security / incorrect charging / service unusable; P1 user-visible wrong behaviour or
an authoritative contract violated; P2 design or maintainability risk with no wrong behaviour today;
P3 prose. Refuse only on an established P0/P1 (direct evidence: an exact source path or an
authoritative contract the plan contradicts). Give every finding an ID `F1`, `F2`, …, a severity,
the evidence (file and line), and the smallest change to the plan that fixes it.
