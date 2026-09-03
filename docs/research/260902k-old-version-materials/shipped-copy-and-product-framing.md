# Shipped copy and product framing, from the old version

> **Excerpted from the old version of Spideryarn** (`/Users/greg/dev/spideryarn/reading`, a repo the
> remote box cannot reach). Every quotation below names its file and the date it last changed there.
> **Who wrote each piece is a best guess** and is stated beside it; much of that repo was AI-written,
> so nothing here should be quoted on the website as Greg's until he has done a second pass.
> Excerpted 2026-09-03.

## Root-level product descriptions

These four files describe the product in their own voice. `CLAUDE.md` and `GEMINI.md` are byte-for-byte
identical (both are the agent-instructions file, just under two names) and are almost entirely
technical process rules — the one product-relevant paragraph is quoted once below.

> Spideryarn Reading is an AI-assisted document reading and analysis application designed
> specifically for scientists who need to digest complex research papers and technical documentation
> efficiently.
>
> — `DEMO_PRODUCT.md`, 2025-07-12, AI agent

`DEMO_PRODUCT.md`'s title is worth recording on its own, because it stakes out a narrower positioning
than anything already captured in the brief — not "an augmented reader" but a vertical product:

> # Spideryarn Reading: AI-Powered Scientific Literature Companion

And its closing line reaches for exactly the "faster" framing [vision.md](../../project/vision.md)
and the intent brief both warn off:

> To become the essential reading companion for scientists, reducing the time from paper to
> understanding by an order of magnitude while improving comprehension and retention of complex
> technical material.
>
> — `DEMO_PRODUCT.md`, 2025-07-12, AI agent

Its problem statement is a reasonable, if generic, pain-point list, distinct from the vision doc's
mission list already quoted in the brief:

> Scientists face significant challenges when reading research literature: Dense, technical content
> that requires deep domain expertise · Time-consuming process to extract key insights from lengthy
> papers · Difficulty navigating between different sections and understanding relationships ·
> Challenge of maintaining context while jumping between citations and references · Need to quickly
> assess relevance and quality of papers for their research.
>
> — `DEMO_PRODUCT.md`, 2025-07-12, AI agent

`README.md`'s one-line description, plainer and closer to what shipped:

> AI-assisted document reading and analysis tool for professionals working with non-fiction texts.
>
> — `README.md`, 2025-08-01, AI agent

`README.md`'s feature list (contemporary with a later, more built state than `DEMO_PRODUCT.md`):

> - **AI-powered document analysis** - Generate hierarchical summaries, glossaries, and headings
> - **Interactive chat interface** - Ask questions about document content
> - **Advanced navigation** - Search, table of contents, command palette with keyboard shortcuts
> - **Document upload** - PDF and URL support with AI transcription
> - **User authentication** - Secure document management with Google OAuth
> - **Multi-granularity analysis** - Summaries at different detail levels
>
> — `README.md`, 2025-08-01, AI agent

`CLAUDE.md`/`GEMINI.md`'s one product-relevant paragraph, worth keeping because it states the mission
as a bullet list distinct from both the vision doc's and `DEMO_PRODUCT.md`'s:

> **Goal of the product**: Help humans digest non-fiction material through AI-powered features: AI-
> generated granular table of contents and headings · Chatbot assistance · Multi-granularity
> summaries · Glossary · Intelligent navigation & LLM-powered search · LLM-powered PDF transcription
> at import · and various other expert-reader assistance tools.
>
> — `CLAUDE.md` (identical in `GEMINI.md`), 2025-08-14, AI agent

## Shipped landing page and page metadata

The actual production landing page (`app/page.tsx`) was minimal — no marketing copy beyond a headline,
subhead and one button, gated behind an auth redirect:

> # Spideryarn Reading
> AI-assisted reading and analysis application
> [Browse Documents →]
>
> — `app/page.tsx`, 2025-07-19, AI agent (not a Greg quote — this is the literal shipped markup)

The document library page (`app/read/page.tsx`) carried the same headline pattern and one empty-state
line:

> No documents yet. Upload your first document to get started.
>
> — `app/read/page.tsx`, 2025-08-01, AI agent

The `<title>` and `<meta description>` actually served in production (`app/layout.tsx`), and the PWA
manifest's `name`/`short_name` (`public/site.webmanifest`) — this is genuinely shipped copy, the exact
string a search engine or a browser tab would have shown:

> title: "Spideryarn Reading"
> description: "AI-assisted document reading and analysis"
>
> — `app/layout.tsx`, 2025-07-19, AI agent

> {"name":"Spideryarn Reading","short_name":"Spideryarn", … "theme_color":"#DB8A45",
> "background_color":"#FFFFFF"}
>
> — `public/site.webmanifest`, 2025-07-16, AI agent

Note the manifest's white `background_color` — independent confirmation, from a file neither doc yet
cites, that the old app really was light-only in production (the rebuild's dark-only decision is
already recorded in [original-version/overview.md](../../project/original-version/overview.md)).

The footer (`components/footer.tsx`), present on every page, carried a second, shorter tagline
alongside the wordmark:

> AI-powered document reading and analysis
>
> — `components/footer.tsx`, 2025-07-08, AI agent

No "About" page, no onboarding copy, no philosophy-bearing tooltips were found anywhere in
`components/` or `app/` — a targeted grep for "peer review", "augment", "companion", "internalise",
"interrogate", "replace … reading" and similar across both directories returned nothing outside the
files already quoted above and in the intent brief. The product's voice, where it exists at all in the
shipped UI, is functional labelling (button text, error strings, processing-status messages like
"Extracting content with Mozilla Readability…"), not persuasive copy. The one shipped philosophical
line found anywhere in `components/` is buried in a design doc, not the UI itself — see next section.

## Logo and brand files

`docs/reference/DESIGN_LOGO.md` (last changed 2025-08-06, AI agent) documents the logo/animation
system but adds no product framing beyond one descriptive phrase worth keeping as a style note:

> Professional Academic Aesthetic … delight without distracting from the serious academic software
> context.
>
> — `docs/reference/DESIGN_LOGO.md`, 2025-08-06, AI agent

**File locations, old repo:**
- `public/spideryarn-logo.png` — the production logo/favicon source
- `public/favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`,
  `android-chrome-192x192.png`, `android-chrome-512x512.png`, `site.webmanifest` — the full favicon set
- `static/img/logo/200908 Spideryarn logo from pres medium-thin white bg.png` — a presentation-quality
  version dated September 2020, so the name and mark predate both apps by five years
- `styles/logo-animations.css`, `lib/animations/logo-animations.ts` — 15 CSS-only hover animations on
  the wordmark (Highlight Sweep, Scanner Line, Strand Pulse, Web Threading, Glossary Builder, etc.),
  themed on documents, AI features, and spider/web imagery

**Already in the new repo:** confirmed by directory listing — `public/` in the new worktree already
has `spideryarn-logo.png`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`,
`apple-touch-icon.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png` and
`site.webmanifest`. Nothing further to port on the logo/favicon front. The 2020 presentation-quality
PNG and the 15 hover animations are **not** yet in the new repo; `docs/project/original-version/design-system.md`
already covers whether to bring the animations across (verdict there: not recommended, see
`design-system.md#the-logo-playground`), so this is noted here only for completeness, not as a
recommendation to act on it.

## Planning docs and captured conversations

Both `docs/planning/` (20 files) and `docs/conversations/` (21 files) are almost entirely technical —
titles like Stripe integration, ProseMirror evaluation, PDF pipelines, dev-server performance, test
stabilisation. A broad grep for vision/goal/purpose language returned mostly false positives (generic
uses of "the user" and "reader" in technical specs). Two things surfaced worth recording:

**The "augmented reader" line, with its authorship softened.** The intent brief (§2) already quotes
this as *"You're not building an editor, you're building an augmented reader" (2025-06-22)* and calls
it the shortest version of the whole thing. Having read the source in full
(`docs/conversations/250622a_conversation_document_architecture_prosemirror_exploration.md`), it is
worth flagging that this line is **not directly attributed to Greg** in the document — it appears
inside an AI-written "Key Insights" summary of a conversation (likely with an external model, since the
doc is a captured-conversation record), presented as an unattributed insight:

> **Framework Mismatch**: "You're not building an editor, you're building an augmented reader" - this
> insight suggests editor-first frameworks may be overengineered for the use case.
>
> — `docs/conversations/250622a_conversation_document_architecture_prosemirror_exploration.md`,
>   2025-06-22, unclear (an AI-written summary of a conversation; the quoted words inside it may be
>   Greg's, the summarising AI's, or an external model's — the doc does not say)

Worth keeping because it is genuinely the sharpest two-word category description on record, but it
should not be presented on the website as a direct Greg quote without checking with him first.

**Independent confirmation of the $20/month figure.** The intent brief (§12) already has this from
`VISION_PRODUCT_STRATEGY.md`; the Stripe planning doc states it as settled fact rather than an idea
being floated, which is a slightly stronger source for the same number:

> **Business Model**: Professional subscription targeting $20/month, with a vision to serve
> universities, journals, and research companies paying for their employees.
>
> — `docs/planning/250612b_stripe_subscription_integration.md`, 2025-06-12, AI agent (restating
>   `VISION_PRODUCT_STRATEGY.md`, not a new figure)

Nothing else in either directory said something new about what the product is for or who it is for.

## `docs/instructions/`

Checked all 30 files by name; none describes product voice or user-facing copy rules. They are all
process documents (how to write a planning doc, how to commit, how to capture a sounding-board
conversation, subagent usage). Nothing to extract.

## `docs/reference/PROJECT_STATUS.md` and `INDEX_FOR_DOCUMENTATION.md`

Both are pointers/orchestration documents. `PROJECT_STATUS.md`'s only vision-adjacent line just
references `VISION_PRODUCT_STRATEGY.md` by name; `INDEX_FOR_DOCUMENTATION.md` is a documentation index
with no product prose of its own. Nothing to extract from either beyond what the intent brief already
draws from `VISION_PRODUCT_STRATEGY.md` directly.

## Not included, and why

- `docs/marketing/*` and `docs/reference/VISION_PRODUCT_STRATEGY.md` — being copied verbatim by
  another agent in this same trawl; skipped entirely per instructions.
- Anything already quoted verbatim in
  [260902k-spideryarn-reading-intent-brief.md](../260902k-spideryarn-reading-intent-brief.md) or in
  `docs/project/original-version/` — in particular the "augment human cognition" vision-doc quote, the
  "smart postdocs" line, the peer-reviewer wedge email, all five taglines in `TAGLINES.md`, and the
  brand-guideline dos/don'ts — not repeated here.
- The current landing page's own strapline ("AI that helps you read harder things, not fewer of
  them.") and its "problem" paragraph — these are from the **new** repo's `LandingPage.tsx`, not the
  old one, and the brief already quotes and correctly attributes them as agent-written.
- Technical machinery (extraction, highlighting, summaries, ids, prompt caching, etc.) — already
  mapped in `docs/project/original-version/`; out of scope for this file per the brief.
- `docs/reference/DATABASE_*.md`, `AUTHENTICATION_*.md`, `TESTING_*.md`, `PDF_*.md` and the other ~90
  purely technical reference docs — scanned by filename only, correctly excluded as technical.

---

Up: [260902k-old-version-materials](.) · See also: [the intent brief](../260902k-spideryarn-reading-intent-brief.md)
