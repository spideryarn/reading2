# Vision

> **Copied verbatim from the old version of Spideryarn** (`/Users/greg/dev/spideryarn/reading`, a repo the remote box cannot reach), original path `docs/reference/VISION_PRODUCT_STRATEGY.md`, last changed there 2025-07-20. **Who wrote it:** Greg himself. The file opens with `[NOTE TO LLMs: please don't edit this doc without explicit permission. It should be written by the user, or contain input provided directly by the user]`, is written throughout in the first person ("I don't know which we're going to want to support most"), and closes with an appendix quoting Greg's own email to Marc ZS. **Treat as a source, not as gospel:** this is Greg's own words from mid-2025 — still worth Greg's second pass to check what has changed since, but not an AI paraphrase of his views. Copied 2026-09-03.

---

# Vision

[NOTE TO LLMs: please don't edit this doc without explicit permission. It should be written by the user, or contain input provided directly by the user]

Spideryarn Reading is envisioned as a professional AI-assisted document reading and analysis tool, designed to help experts make better decisions and develop deeper understanding through enhanced document comprehension.

## See also

- `README.md` - Current implementation goals and features
- `docs/reference/MARKETING_BRANDING_GUIDELINES.md`
- `docs/reference/ARCHITECTURE_DECISIONS.md` - Technical architecture decisions and rationale
- `docs/reference/PROJECT_STATUS.md` - Current development state and immediate roadmap
- `docs/reference/CODING_PRINCIPLES.md` - Development philosophy emphasising rapid prototyping
- `docs/planning/*.md` - Historical decision context and feature planning documents

## Core Vision

### Primary Mission

To help humans digest written non-fiction material better - enabling them to:
- **Get the gist or extract quotes and relevant information faster**
- **See structure and take different trajectories through documents**
- **Clear up confusions and make sense of complex parts**
- **Get up to speed on terminology or requisite background**
- **Understand core ideas more deeply**
- **Compare with existing knowledge or other sources**
- **Evaluate what's trustworthy and see potential flaws**
- **Chat with an AI interlocutor and think things through**
- **Generate, evaluate, and manage new/varied/complex ideas**

The ultimate goal is to **enable humans to make better decisions through better reading and analysis**, while ensuring the human remains the central decision-maker and critical thinker.

### Human-AI Philosophy

The AI should do absolutely everything possible to empower and augment the human, enabling better understanding and potentially faster/more efficient processing. **However, the AI must never replace human judgment or critical thinking.**

**Key principle**: Think of having "a bunch of smart postdocs who you could give any instructions to" - what would you ask them to do to enable you to be the most effective version of yourself when reading?

Risks to avoid:

- **Critical risk to avoid**: The AI doing too much work, causing humans to become lazy or atrophy by not doing the intellectual work themselves, thus failing to internalise knowledge effectively.
- Too hard to use
- Not that helpful
- Doesn't solve a problem they think they have

## Target Users & Market

### Primary User Persona ✓
**Scientific journal editors and reviewers** - professionals who need to:
- Quickly assess manuscript quality and significance
- Identify methodological issues or logical gaps
- Compare submissions against existing literature
- Make publication decisions based on thorough understanding

### Broader Professional Market 📋
- **Academics, researchers, editors & reviewers, journalists, strategists, politicians, investors, commentators, leaders** - anyone who needs to read a lot of non-fiction

### Target Organizations 📋
- **Universities, journals, or research companies** - paying for their employees

## Product Positioning

### Unique Value Proposition

**Reading-focused, not writing-focused**: Unlike Notion AI, Obsidian, or other productivity tools that emphasise content creation and collaboration, Spideryarn Reading is explicitly designed for **document comprehension and analysis**.

**Single-document deep dive**: Currently focused on single documents at a time, though eventually may add multi-document features like comparison, synthesis, etc.

### Competitive Differentiation

Notion and Obsidian are more like writing tools or at least collaboration tools because you're explicitly adding a lot of text, and this is explicitly a reading tool currently focused on single documents at a time.

## Business Model

### Revenue Strategy ✓
**Professional subscription model** targeting institutional and individual professional users:

- **Estimated pricing**: $20/month (or perhaps $10 or $50 or tiers) for uploading as many papers as you like and having the AI process them
- **AI output sharing**: Maybe there'll be some kind of sense of the AI's AI-generated output being pooled or available, but for people that want to generate new AI output, they definitely have to pay for that

### Centaur-Sourcing Model 📋
**Shared AI Enhancement Commons**: A hybrid approach between crowdsourcing and AI processing where users contribute AI-generated enhancements that benefit the entire community:

- **Individual Payment**: Users pay for AI processing they commission (summarization, glossaries, etc.)
- **Shared Benefits**: AI-generated enhancements become available to all users who can access the document
- **Quality Assumption**: AI processing is expected to be consistently valuable, regardless of who commissions it
- **Community Value**: Popular documents develop rich AI-generated annotations through distributed user contributions
- **Traceability**: Full tracking of who commissioned each enhancement for billing and quality control

This model aims to create valuable AI-generated commons while maintaining fair cost distribution and user incentives for processing.

## Product Development Philosophy

### Development Approach ✓
**Rapid prototyping for early-stage discovery**: This is a prototype with no users yet. We want to develop fast and experiment to figure out which features provide the most value.

**Root cause solutions**: Fix underlying issues rather than applying band-aids. Prefer clear failures over silent defaults when assumptions aren't met.

**Human-in-the-loop validation**: If unexpected issues arise, stop and discuss rather than pushing through. Be a collaborative development partner.

### Quality vs Speed Trade-offs
Those are two different modes, and I don't know which we're going to want to support most. Maybe both.

## Feature Roadmap

### Current Capabilities ✓
- **Single-document focus** - HTML format (PDF conversion available)
- **AI-powered features** - Hierarchical summaries, glossaries, semantic headings
- **Interactive navigation** - Multi-pane layout with intelligent scrolling
- **Professional chat interface** - Document-contextual AI conversations
- **Multi-LLM support** - Anthropic Claude and Google Gemini integration

### Long-term Vision 📋
- **Multi-document features** - Eventually may add multi-document comparison, synthesis, folders for storing multiple documents

## Success Metrics

The goal is for this to be about better decisions, that certainly fits with the journal reviewers and editors. Or it could be just deeper understanding and better ideas.

## Risk Mitigation

### Human Atrophy Prevention
**Primary concern**: A really big risk is that the AI does too much and the human gets lazy or atrophies by not doing the work and doesn't internalise things as well. We're trying to figure out how to avoid that failure mode.

## Long-term Strategic Vision

### 5-Year Outlook

Probably a professional tool for academics and people like that. It'll be paid. Maybe eventually this will be something that universities, journals, or research companies pay for, for their employees/researchers.


## Appendix

### In email to Marc ZS

I'm thinking of focusing on scientific peer reviewers & journal editors, where:
- The human has to make a decision
- Based on evidence/criteria
- It's a drudge job, where they don't want to do a terrible job, but they also very much want to be efficient
- I can think of lots of ways to speed things up


It's not 100% aligned with the vision of helping experts to read & understand new difficult material deeply, but a stepping stone in roughly the right direction with a fighting chance of being enough of a pain that people might pay…
