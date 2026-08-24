# The original version — Spideryarn Reading

`spideryarn2` is an experimental offshoot of an existing, much larger project. This document is the
map to it: where it is, what we've already taken, what's worth reading before you rebuild something
it already solved, and what we're deliberately leaving behind.

**Location:** `/Users/greg/dev/spideryarn/reading` — local only, `git@github.com:spideryarn/reading.git`,
live at <https://www.spideryarn.com>. Everything below is a path *inside that repo* unless it starts
with `../` or is otherwise linked.

## Read this bit first

> this is a sort of experimental offshoot of an existing project … I think if we can borrow some of
> the CSS, the logo, etc, we don't need to be too fancy for now. But yeah, just give ourselves a head
> start. So we're not doing everything completely from scratch again.
>
> — Greg, 2026-08-24

**That project is enormous compared to this one, and that difference is the point.** It's a Next.js
app with Supabase Postgres, auth, RLS, Vercel deployment, Jest + Playwright suites, a unified tool
registry, a reversible-mutations framework, four PDF ingestion pipelines, and ~130 reference
documents. It has been built and rebuilt over a year and it works.

This repo is a bet on **one idea** — [granularity zoom](granularity-zoom.md) — and it is trying to
stay tight, experimental and fast-moving: filesystem instead of a database, one process, no auth, no
framework churn ([architecture.md](architecture.md)). So treat what follows as a **library to
consult, not a backlog to import**. Greg's call, 2026-08-24, when asked which of its ideas to lift
into our decisions: *"None of them for now."* The value here is that when you hit a hard problem,
someone has probably already hit it, and you can go and read what happened.

A useful instinct: if you're about to spend an afternoon on structure generation, highlighting,
Readability edge cases, or summary granularity — check this map first. If you're about to adopt a
framework, a database, or a component library because they did — don't.

## Already lifted into this repo

| What | From there | To here |
|---|---|---|
| Logo, favicons, web manifest | `public/spideryarn-logo.png`, `public/favicon*`, `public/site.webmanifest` | [`public/`](../../public/) |
| Brand colours, radii, sidebar tokens | `app/globals.css` `:root` block | [`styles/tokens.css`](../../styles/tokens.css) |
| Reading typography (Georgia, 17px, 65ch measure) | `docs/reference/RESEARCH_ON_OPTIMAL_TEXT_FORMATTING.md` | [`styles/tokens.css`](../../styles/tokens.css) — `.reading-column` |

[`styles/tokens.css`](../../styles/tokens.css) is deliberately **plain CSS custom properties** — no
Tailwind, no shadcn, no build step — so whoever owns the client (stage 6, see
[architecture.md § Stage ownership](architecture.md#stage-ownership)) can use it directly or map it
into whatever they're using. Variable names match the original's so components copied across from
that codebase keep working.

### Brand facts, now load-bearing

- **Spideryarn orange is `#DB8A45`** — `oklch(0.65 0.15 45)`. Primary, focus ring, accent. Don't
  invent a second accent colour.
- **We are dark-only** (Greg, 2026-08-24): *"I'm happy to go with the dumb version where we just
  switched to always being in dark mode."* No toggle, no `prefers-color-scheme`, no light fallback.
  This reverses the light-only inheritance below, and the original app is **not** a useful source for
  it: `lib/config.ts` forces light via `UI_CONFIG.FORCE_LIGHT_MODE`, and although `app/globals.css`
  carries a complete `.dark` OKLCH block, it never redefines `--spideryarn-orange` and lets
  `--primary` go near-white — so the brand orange is simply not carried into dark there. We answered
  that ourselves: **the orange is unchanged at `#DB8A45`**, which reads better on the dark ground
  (~7.8:1) than it ever did on white (~2.6:1). See [web-client.md](web-client.md) for the reasoning
  and [`styles/tokens.css`](../../styles/tokens.css) for the values.
- The header markup pairs `<img class="logo-image">` with a `<span class="logo-text">` of per-letter
  `<span class="logo-letter">` (`components/app-header.tsx`). `tokens.css` preserves those class
  names, so the original's 15 CSS-only hover animations (`styles/logo-animations.css`, 1,911 lines,
  no dependencies, documented in `docs/reference/DESIGN_LOGO.md`) can be dropped in later as one
  file. Deliberately not lifted — too fancy for now (Greg, 2026-08-24).

### Decision: the palette

**Spideryarn orange wins** (Greg, 2026-08-24), and it's done.
[`src/web/styles.css`](../../src/web/styles.css) had grown its own token set in parallel —
`--accent: #8a5a2b` warm brown on `#fbfaf8`, with dark-mode support — while independently landing on
a serif for the article, which was the agreement that mattered. It now `@import`s
[`styles/tokens.css`](../../styles/tokens.css) and defines a thin semantic layer over it rather than
restating any values; the warm palette and the dark-mode block are gone. One palette, one source.
`index.html` links the favicons and manifest from [`public/`](../../public/). (Its `theme-color` was
`#DB8A45` until the dark switch below moved it to the page black, so mobile browser chrome matches
the page rather than announcing the brand.)

**Superseded in part, same day.** The single-palette half of that decision stands and is why any of
this was cheap; the light-only half is gone — see the dark-only decision above. `styles/tokens.css`
now holds dark surface values under the *same variable names*, so nothing downstream needed rewiring,
and the `--accent` trap noted above still applies (in dark it fails the other way — a highlight that
takes `--accent` by mistake goes near-black and vanishes into the page).

Worth recording as a road not taken: the warm palette deleted in the convergence had its own dark
variant, recoverable with `git show 4bd4d94:src/web/styles.css`, and it had chosen a *lightened*
`#d8a165` rather than reusing the brand orange. We went the other way and kept `#DB8A45` unchanged.

No wordmark on screen yet — that view's masthead is the article title, not app chrome. When app-level
chrome exists, `.logo-text` / `.logo-image` are waiting.

## The map

### Where the two projects agree

`docs/reference/VISION_PRODUCT_STRATEGY.md` — their vision doc, and it is close kin to
[ours](vision.md). Worth knowing that the atrophy worry predates this repo:

> The AI should do absolutely everything possible to empower and augment the human … **However, the
> AI must never replace human judgment or critical thinking.**
>
> **Key principle**: Think of having "a bunch of smart postdocs who you could give any instructions
> to" — what would you ask them to do to enable you to be the most effective version of yourself when
> reading?
>
> **Critical risk to avoid**: The AI doing too much work, causing humans to become lazy or atrophy by
> not doing the intellectual work themselves, thus failing to internalise knowledge effectively.

Its concrete goals list is broader than ours — get the gist, extract quotes, see structure and take
different trajectories, clear up confusions, get up to speed on terminology, compare with other
sources, evaluate trustworthiness, chat with an interlocutor. [Granularity zoom](granularity-zoom.md)
is roughly its second and third bullets, taken seriously on its own.

`docs/reference/PROJECT_STATUS.md` — where that project had got to.
`docs/reference/SITE_ORGANISATION_WEBSITE_STRUCTURE.md` — its routes and page structure.
`docs/reference/OBSOLETE_ALTERNATIVE_VERSION.md` — a Python/Jupyter version that came *before* it.
So this is the third attempt at the idea, not the second.

### Things it built that we're also building

- `docs/reference/TOOL_SUMMARISE.md` — **multi-granularity summaries, already shipped once.** Has a
  named length ladder by token budget: `short phrase` (10) → `short title` (15) → `short sentence`
  (25) → `sentence` (30) → `sentence or two` (50) → `few sentences` (100) → `single short paragraph`
  (200) → `couple of paragraphs` (400) → `page` (800). Compare [Q4](open-questions.md#q4) — that
  ladder is a set of discrete levels arrived at by use.
- `docs/planning/finished/250608b_multiple_summary_granularities.md` — the same feature, **two-
  dimensional**: 3 expertise levels (beginner/intermediate/expert) × 3 lengths, all 9 generated in
  parallel up front with prompt caching so switching is instant. Our zoom has one axis. Theirs
  suggests a second, and — more useful — suggests that **pre-generating the whole grid** is the way
  to make the interaction feel immediate, which is exactly what
  [granularity-zoom.md § Interaction](granularity-zoom.md#interaction) needs.
  `components/dual-summary-sliders.tsx` is the UI for it.
- `docs/reference/TOOL_STRUCTURE_HEADINGS.md` — **AI-generated headings over documents that lack
  them**, i.e. [Q1](open-questions.md#q1), attempted. Note the shape they ended on: *iterative*
  generation, ≤10 heading operations per round, the user chooses "continue improving" or "finish"
  after each, hard caps at 5 iterations / 50 operations. That shape is itself evidence — one-shot
  structuring of a long unstructured article wasn't good enough.
  See also `docs/conversations/250628c_conversation_hierarchical_heading_generation_approach.md`,
  `docs/planning/discarded/250628b_hierarchical_heading_generation_implementation.md` (what got
  abandoned, and why), and `docs/planning/250704a_conversation_ai_headings_critique_from_o3_pro_without_claude.md`
  (a cross-model critique of the approach).
- `docs/reference/UNIFIED_LEFT_PANE_TABBED_NAVIGATION.md` — the deeply-nested ToC as shipped: a
  heading tree with expand/collapse, and **a granularity slider that filters heading depth**, with
  "+N hidden" badges on collapsed parents. That is a first cousin of our left-right zoom axis,
  already built and lived with. `components/heading-tree.tsx`, `components/tools/StructurePanel.tsx`.
  Planning: `docs/planning/finished/250529b_table_of_contents_expand_collapse_granularity.md`.
- `docs/planning/finished/250526d_deterministic_id_generation.md` — **the same problem as
  [block-ids.md](block-ids.md), solved differently.** They needed ids stable across reloads and
  modifications, and went *deterministic*: UUIDv5 over (DOM path + tag name + semantic attributes +
  first 100 chars of text), truncated to 8 characters, prefixed `syr-`. We went the other way —
  random ids minted once and then carried forward by matching text on re-run
  ([why](block-ids.md#why-random-and-not-sequential), and
  [what it took to actually work](block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters)) —
  and both are answers to the same failure, which is reader state silently pointing at the wrong
  paragraph after re-extraction. Note that neither scheme gets this for free: theirs recomputes the
  id from content, ours has to explicitly match old blocks to new ones. Worth knowing the trade they took: a deterministic id changes
  whenever its inputs change, so an edited paragraph becomes a different paragraph. Their doc lists
  exactly which changes must and must not move an id (whitespace, style attributes, comments and
  attribute order must not; reordering, tag changes and significant text changes must) — that list is
  the durable part, whichever scheme you use. See also
  `docs/planning/finished/250528c_standardise_id_generation_tooltips.md`, and note the `syr-` prefix
  serves the same purpose as our `spya-`.
- `docs/reference/HTML_CONTENT_PROCESSING_OVERVIEW.md` and
  `docs/reference/HTML_SANITISATION_AND_PRETTIFICATION.md` — the Readability path in production,
  relevant to [content-extraction.md](content-extraction.md). Their numbers: Readability handles most
  academic pages in ~100–400ms; JS-heavy, paywalled or infinite-scroll pages need a headless browser;
  AI transcription costs 30s+. And a deliberate policy of **no automatic fallback** between methods —
  fail with a structured error that names the alternative.
  `lib/services/html-document-processor.ts`, `app/api/extract-url/route.ts`.
  Quality measurement: `lib/testing/html-content-fidelity-generator.ts`,
  `docs/reference/LLM_EVALUATION_FRAMEWORKS_FOR_CONTENT_EXTRACTION.md`.

### Things it built that we haven't reached yet

- `docs/reference/DESIGN_OVERLAPPING_TEXT_HIGHLIGHTS.md` — why Mark.js can't do overlapping
  highlights (HTML inline elements can't overlap non-hierarchically), and why the **CSS Custom
  Highlight API** is the answer. Read this the day highlights, notes or glossary links arrive.
- `docs/reference/TOOL_HIGHLIGHT.md` — AI highlighting against a semantic criterion ("arguments
  supporting the main thesis", "statistical evidence") with confidence-driven visual intensity.
- `docs/reference/TOOL_GLOSSARY.md` — LLM-extracted entities with definitions and click-to-scroll;
  `docs/planning/250629a_glossary_entity_normalisation.md` for the normalisation problem.
- `docs/reference/TOOL_SEARCH_TEXT.md` — cross-element search with context-aware snippets.
- `docs/reference/TOOL_READING_DIFFICULTY.md` — LLM-judged academic level (high school →
  post-doctoral) instead of Flesch-Kincaid, plus
  `docs/reference/RESEARCH_READING_DIFFICULTY_METRICS.md` and
  `docs/reference/RESEARCH_READING_SPEED_COMPLEXITY_ADJUSTMENTS.md`. Possibly relevant to
  [Q6](open-questions.md#q6) — how we'd know any of this is working.
- `docs/reference/ARCHITECTURE_URL_STATE.md` — human-readable URL as the single source of truth
  (`?tab=summary&expertise=beginner&length=sentence_or_two`), via `nuqs`. The obvious analogue here
  is zoom level + block anchor in the URL, so a view is shareable and survives reload.
- `docs/reference/COMMAND_PALETTE_KEYBOARD_INTERFACE.md` and
  `docs/reference/KEYBOARD_SHORTCUTS.md` — Cmd+K palette, Cmd+1..6 for panes, Cmd+B for the sidebar.
- `docs/reference/UI_INTERFACE.md` — the 2-pane resizable layout and vertical icon rail that all of
  the above hangs off. `components/resizable-document-layout.tsx`.
- `docs/reference/CROSS_PANE_COMMUNICATION_MESSAGING_ARCHITECTURE.md` — how the panes talk to each
  other without turning into spaghetti. Relevant if the ToC and the zoom view end up as two panes.
- `docs/reference/ARCHITECTURE_MOBILE.md`, `docs/reference/DESIGN_MOBILE_PLATFORM_DETECTION.md` —
  touch vs hover, and what breaks. A horizontal-scroll gesture on a trackpad is not the same gesture
  on a phone.

### Design and typography

- `docs/reference/DESIGN_COLORS_FONTS.md` — the source of our tokens; the reasoning behind
  Spideryarn orange, OKLCH, and the font hierarchy.
- `docs/reference/RESEARCH_ON_OPTIMAL_TEXT_FORMATTING.md` — the best doc in the whole set for us.
  Cited research on line length (55–70 chars; 80 chars reads ~7% faster but comprehends ~12% worse —
  Dyson & Kipping 1998), Georgia's x-height advantage on screen, 17px body, weight 400. Partially
  lifted into `.reading-column`.
- `docs/reference/DESIGN_OVERVIEW.md`, `DESIGN_ICONS.md` (Phosphor), `DESIGN_TOOLTIPS.md`,
  `DESIGN_COLLAPSIBLE.md`, `DESIGN_LOADING.md`, `DESIGN_LOGO.md`, `DESIGN_SHADCN_UI_REFERENCE.md`.
- `app/design/` — a live design reference page showing every component and colour, and
  `app/design/logoplay/` — the logo animation playground.

### LLM plumbing

Relevant to [Q7](open-questions.md#q7) (which model, and what does a tree cost):

- `docs/reference/LLM_PROMPT_TEMPLATES.md` + `docs/reference/NUNJUCKS_USAGE.md` — their prompts are
  Nunjucks templates with Zod-validated inputs. Read for the shape, not the machinery.
- `docs/reference/LLM_MODEL_CONFIGURATION.md` — a provider-tier indirection (`google-cheap`,
  `anthropic-balanced`) set by env var, so the model isn't hardcoded at call sites. **Note:** their
  model ids are from 2025 and are stale. Load the `claude-api` skill for current ones.
- `docs/reference/LLM_PROMPT_CACHING.md` — how they made generating 9 summaries in parallel
  affordable. Directly applicable to generating a whole tree of gists.
- `docs/reference/LLM_TRACKING_TOKEN_USAGE_LOGGING.md` + `AI_RESPONSE_LOGGING.md` — logging every AI
  response and its cost. If we want to answer "what does a tree cost", this is the shape of it.
- `docs/reference/VERCEL_AI_SDK_REFERENCE.md` — multi-provider abstraction (Claude + Gemini).

### Process and house style

Not adopted here (Greg, 2026-08-24: leave it for now), but this is where it lives:

- `docs/reference/CODING_PRINCIPLES.md` — the house style. Fail fast and fatally, no fallbacks or
  defaults masking bad input, **never silently modify data**, end-to-end simple version first, ask
  rather than obey. This repo has inherited its spirit without copying the file.
- `docs/reference/CODING_GUIDELINES.md` — the long-form standards.
- `docs/instructions/` — ~35 reusable agent instructions: `WRITE_PLANNING_DOC.md`,
  `WRITE_EVERGREEN_DOC.md`, `SOUNDING_BOARD_MODE.md`, `DETECTIVE_SCIENTIST_MODE.md`,
  `CRITIQUE_OF_PLANNING_DOC.md`, `DEBRIEF_PROGRESS.md`, `AUDIT_ARCHITECTURE_MODE.md`, and
  `GATHER_DIVERSE_INPUTS_AND_CRITIQUES_ON_PLANNING_DOCS_FROM_OTHER_AI_MODELS_*.md` — the last of
  which overlaps with our [docs/reusable/codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md).
- `docs/reference/SETUP_FOR_AI_FIRST_CODING.md` — how that repo is arranged for agents.
- `docs/conversations/` — ~30 captured design conversations, several of them cross-model critiques.
  This is where the *reasoning* lives when a reference doc only states the conclusion.
- `docs/reference/INDEX_FOR_DOCUMENTATION.md` — their own index, if this map misses something.

## Deliberately not lifted

- **Supabase, auth, users, RLS, deployment.** [architecture.md § Storage](architecture.md#storage) is
  the filesystem, on purpose. No database while the ideas are still moving.
- **Next.js.** The client here is Vite + React; theirs is Next.js App Router with server components.
  Anything copied across needs its `'use client'`, `next/image` and `next/link` stripped.
- **shadcn/ui, Radix, Tailwind v4, Phosphor.** Their CSS assumes all of it (`@theme inline`,
  `@apply`, `bg-primary`). Our `tokens.css` is the same *values* with none of the dependencies.
  Adopting Tailwind later is fine; inheriting a component library now is not.
- **The tool registry and the mutations framework** (`TOOL_EXECUTION_FRAMEWORK.md`,
  `TOOL_ARCHITECTURE_AND_DEVELOPMENT_GUIDE.md`,
  `MUTATIONS_DOCUMENT_CONTENT_REVERSIBLE_TRANSFORMS.md`). Large, and built for a different problem —
  reversible edits to a stored document. We have one contract: stable block ids.
- **PDF ingestion.** Seven documents' worth of hard-won knowledge (`PDF_*.md`), entirely out of scope.
- **Their testing infrastructure** (Jest + Playwright + shared-database isolation, ~15 docs). Real
  and good, and far heavier than this repo warrants yet.
- **Chat, glossary, semantic search, voice input, tweet threads, analytics, Stripe.** All built
  there. None of them is [the one feature](granularity-zoom.md) we're testing.

## See also

- [vision.md](vision.md) — what *this* project is for, and its [anti-goals](vision.md#anti-goals)
- [granularity-zoom.md](granularity-zoom.md) — the one feature we're testing
- [architecture.md](architecture.md) — pipeline, storage, [stage ownership](architecture.md#stage-ownership)
- [content-extraction.md](content-extraction.md) — our Readability stage
- [block-ids.md](block-ids.md) — the spine, and the road not taken above
- [table-of-contents.md](table-of-contents.md) — the deeply-nested ToC
- [open-questions.md](open-questions.md) — several of which the previous version has answered once
- [`styles/tokens.css`](../../styles/tokens.css), [`public/`](../../public/) — what came across
