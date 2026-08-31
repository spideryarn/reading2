# Write a deep dive as documentation

> **Provenance.** Copied 2026-08-24 from
> [`docs/instructions/WRITE_DEEP_DIVE_AS_DOC.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/WRITE_DEEP_DIVE_AS_DOC.md)
> in gregdetre/gjdutils — see [gjdutils-instructions.md](gjdutils-instructions.md). Upstream defers
> the doc format to
> [`WRITE_EVERGREEN_DOC.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/WRITE_EVERGREEN_DOC.md),
> which hasn't been copied here.

Do a deep dive on the web about the topic that the user has asked about. If you need more
clarification about the requirements to focus the search fruitfully, ask questions (ideally
upfront). If you need more context from files, investigate for relevant code & docs.

Before you start, run `date` to get today's date, in case you need to assess how recent the search
results are.

Then write this up as a detailed reference doc. Research docs live in `docs/research/` and take the
same date-prefixed name as a planning doc — `npx tsx scripts/plan-name.ts --dir=research
"<topic>"`, see [write-planning-doc.md](write-planning-doc.md). Include URL links/references (as well as mentions of
your own code/docs etc), so you can track down the original sources later if you need to.

## Process Guidelines

### 1. Clarify the Scope
Before diving into research, ask questions if it will help:
- What specific aspects of the topic are most important?
- What's the intended use case or application?
- Are there particular problems you're trying to solve?
- How deep should the technical detail go?
- What's the target audience for this documentation?
- etc

### 2. Research Strategy
- **Start broad** — get an overview of the topic and ecosystem
- **Go specific** — focus on the aspects most relevant to your needs
- **Check recency** — note dates on articles, especially for fast-moving technologies
- **Multiple sources** — cross-reference information, taking into account authoritativeness
- **Practical focus** — prioritize actionable information over theory

### 3. Documentation Structure
Something like:
- **Overview** — what is this technology/concept?
- **Resources** — links to official docs, tutorials, tools
- **Use cases** — when and why to use it
- **Getting started** — quick setup or hello world
- **Key concepts** — essential understanding
- **Best practices** — proven approaches and patterns
- **Risks/gotchas** — known issues, e.g. recent API changes, common/likely confusions & error
  messages, risks, etc
- etc

### 4. Source Attribution
- **Direct links** — include URLs (or file paths, or whatever's appropriate) for all referenced sources
- **Date notation** — note when sources were published/accessed
- **Authority assessment** — prefer official docs, established experts, recent sources
- **Code attribution** — reference any code examples with their source

Remember: the goal is to create a reference that will explain, be up-to-date, help with
decision-making, save time, and/or prevent mistakes/issues/surprises. Be proactive. Focus on the
information that would be most valuable given the user's intent. Highlight anything worthy of remark.
