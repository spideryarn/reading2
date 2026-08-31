# The original version — Spideryarn Reading

`spideryarn2` is an experimental offshoot of an existing, much larger project. **This folder is the
map to it**: where it is, what we've already taken, what's worth reading before you rebuild
something it already solved, and what we're deliberately leaving behind.

**Location:** `/Users/greg/dev/spideryarn/reading` — local only, `git@github.com:spideryarn/reading.git`,
live at <https://www.spideryarn.com>. Every path in this folder is a path *inside that repo* unless
it starts with `../` or is otherwise linked.

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

This repo is a bet on **one idea** — [granularity zoom](../granularity-zoom.md) — and it is trying to
stay tight, experimental and fast-moving: filesystem instead of a database, one process, no auth, no
framework churn ([architecture.md](../architecture.md)). So treat what follows as a **library to
consult, not a backlog to import**. Greg's call, 2026-08-24, when asked which of its ideas to lift
into our decisions: *"None of them for now."*

That call still stands as a default. What changed on **2026-08-25** is that we now expect to
**rebuild and improve on a good deal of the machinery** — so these docs are written to be built
from, not merely admired. Where a feature is worth rebuilding, the doc says so, says what went wrong
there, and says what we'd do differently. The prioritised list is
[borrow-list.md](borrow-list.md).

A useful instinct: if you're about to spend an afternoon on structure generation, highlighting,
Readability edge cases, prompt caching, or summary granularity — check this folder first. If you're
about to adopt a framework, a database, or a component library because they did — don't.

## The docs in this folder

Each one covers a feature or a subsystem *over there*: what it does, how it was built, **what the
repo records about how well it worked**, and what we'd do instead. That third part is the reason
these exist. A year of building leaves evidence — discarded plans, cross-model critiques, bugs found
in production — and that evidence is worth more than the code.

| Doc | What's in it |
|---|---|
| [reading-view-ui.md](reading-view-ui.md) | the two-pane resizable layout and icon rail, the pane consolidation that broke scroll sync, and what it cost |
| [cross-pane-sync.md](cross-pane-sync.md) | **the most useful page here for our scroll code** — an auto-scroll they built, perfected and then deleted; a sync that broke; and the architectural fix |
| [structure-panel.md](structure-panel.md) | **the closest cousin to our zoom** — a heading tree with a granularity slider that filters depth, and the "+N hidden" badge |
| [summaries.md](summaries.md) | multi-granularity summaries, already shipped once: the named length ladder, the expertise axis, and why all nine came from one call |
| [ai-headings.md](ai-headings.md) | **the most instructive story in the codebase** — inventing structure for articles that lack it, designed twice, reversed once, and still shipping a real bug |
| [highlighting.md](highlighting.md) | AI highlighting against a semantic criterion, and why overlapping highlights need the CSS Custom Highlight API rather than Mark.js |
| [glossary.md](glossary.md) | LLM-extracted entities with definitions, the 504 that capped them at 20, and the normalisation bug that deleted the more specific term |
| [difficulty-and-reading-time.md](difficulty-and-reading-time.md) | LLM-judged reading level instead of Flesch-Kincaid, and a reading-time estimate that adjusts for difficulty and for its own confidence |
| [search-and-chat.md](search-and-chat.md) | text search, semantic search, and the chat pane — the one feature here we most likely should *not* rebuild |
| [extraction.md](extraction.md) | the Readability path in production: the sanitisation allow-list, a fidelity harness worth copying, and the escalation ladder their docs describe and their code never had |
| [ids.md](ids.md) | the same problem as [block-ids.md](../block-ids.md), solved the other way — deterministic UUIDv5 over content, and the list of changes that must and must not move an id |
| [llm-plumbing.md](llm-plumbing.md) | prompt templates, model tiers, structured output without `generateObject`, and cost logging |
| [prompt-caching.md](prompt-caching.md) | **researched thoroughly, never implemented.** Their design doc is a usable spec for exactly our problem |
| [tool-framework.md](tool-framework.md) | the registry and executor framework, and two independent AI critiques finding it over-engineered — the clearest "don't" in the codebase |
| [url-state-and-keyboard.md](url-state-and-keyboard.md) | URL as single source of truth, the infinite render loop that taught them it must be one-way, and the command palette |
| [typography.md](typography.md) | the cited research on line length, size and contrast — and the finding that longer lines read faster and comprehend worse |
| [design-system.md](design-system.md) | tokens, icons, loading states, the live design reference page, and 2,800 lines of logo animation |
| [process-and-docs.md](process-and-docs.md) | their coding principles, the cross-model critique habit worth stealing, and 129 reference docs as a cautionary tale |
| [borrow-list.md](borrow-list.md) | **the summary** — what to rebuild, what to skip, in priority order |

## Already lifted into this repo

| What | From there | To here |
|---|---|---|
| Logo, favicons, web manifest | `public/spideryarn-logo.png`, `public/favicon*`, `public/site.webmanifest` | [`public/`](../../../public/) |
| Brand colours, radii, sidebar tokens | `app/globals.css` `:root` block | [`styles/tokens.css`](../../../styles/tokens.css) |
| Reading typography (Georgia, 17px, 65ch measure) | `docs/reference/RESEARCH_ON_OPTIMAL_TEXT_FORMATTING.md` | [`styles/tokens.css`](../../../styles/tokens.css) — `.reading-column`, and [typography.md](typography.md) |
| **Tailwind v4 and shadcn components** (2026-08-25) | the stack their CSS was written against | [`src/web/tailwind.css`](../../../src/web/tailwind.css), [`src/web/components/ui/`](../../../src/web/components/ui/) |

[`styles/tokens.css`](../../../styles/tokens.css) is still **plain CSS custom properties** and still the
single source of truth for colour, so whoever owns the client (stage 6, see
[architecture.md § Stage ownership](../architecture.md#stage-ownership)) can use it directly. Variable
names match the original's so components copied across from that codebase keep working — and that
turned out to matter more than anyone expected, below.

### The reversal: Tailwind and shadcn, 2026-08-25

This section used to end "no Tailwind, no shadcn, no build step", and the next section listed both
under [§ Deliberately not lifted](#deliberately-not-lifted) with the line *"Adopting Tailwind later
is fine; inheriting a component library now is not."* Greg asked for both on 2026-08-25 — *"Let's
switch to using Shadcn."* The Tailwind half was the "later" clause being cashed in. The
component-library half is a straight reversal, made deliberately with the cost written down:
[260825a-shadcn-migration.md § Honest assessment](../../plans/260825a-shadcn-migration.md#honest-assessment).

**The tokens made it almost free, and not by our doing.** `app/globals.css` over there *was* a shadcn
project, so `tokens.css` already carried shadcn's default dark values under shadcn's exact names, in
OKLCH, with `--primary` swapped to the orange. There was nothing to re-map: an `@theme inline` block
in [`tailwind.css`](../../../src/web/tailwind.css) points Tailwind's `--color-*` names at this file and
that is the whole bridge. Three variables were missing and were added — `--popover`,
`--popover-foreground`, `--destructive-foreground`.

Worth being honest about what that implies: the part shadcn usually helps most with, we had already
had for a week without the dependency. What we bought is accessibility on the chrome and a house
style for chrome not yet built — see
[web-client.md § Tailwind and shadcn](../web-client.md#tailwind-and-shadcn-components) for what is
adopted, what never will be, and the four guards Tailwind needed to go in safely.

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
  (~7.8:1) than it ever did on white (~2.6:1). See [web-client.md](../web-client.md) for the reasoning
  and [`styles/tokens.css`](../../../styles/tokens.css) for the values.

  Worth knowing that their dark mode was **scaffolded and then disabled**, not merely unfinished —
  `FORCE_LIGHT_MODE = true` with the dark CSS commented out "prepared for future". A theme is real
  work, not a toggle; ours is cheap only because there is exactly one of it.
- The header markup pairs `<img class="logo-image">` with a `<span class="logo-text">` of per-letter
  `<span class="logo-letter">` (`components/app-header.tsx`). `tokens.css` preserves those class
  names, so the original's 15 CSS-only hover animations can be dropped in later as one file. See
  [design-system.md § The logo playground](design-system.md#the-logo-playground) — and the argument
  for *not* doing that.

### Decision: the palette

**Spideryarn orange wins** (Greg, 2026-08-24), and it's done.
[`src/web/styles.css`](../../../src/web/styles.css) had grown its own token set in parallel —
`--accent: #8a5a2b` warm brown on `#fbfaf8`, with dark-mode support — while independently landing on
a serif for the article, which was the agreement that mattered. It now `@import`s
[`styles/tokens.css`](../../../styles/tokens.css) and defines a thin semantic layer over it rather than
restating any values; the warm palette and the dark-mode block are gone. One palette, one source.
`index.html` links the favicons and manifest from [`public/`](../../../public/). (Its `theme-color` was
`#DB8A45` until the dark switch moved it to the page black, so mobile browser chrome matches the page
rather than announcing the brand.)

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

## Where the two projects agree

`docs/reference/VISION_PRODUCT_STRATEGY.md` — their vision doc, and it is close kin to
[ours](../vision.md). Worth knowing that the atrophy worry predates this repo:

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
sources, evaluate trustworthiness, chat with an interlocutor. [Granularity zoom](../granularity-zoom.md)
is roughly its second and third bullets, taken seriously on its own.

Two more orientation docs:

- `docs/reference/PROJECT_STATUS.md` — where that project had got to.
- `docs/reference/SITE_ORGANISATION_WEBSITE_STRUCTURE.md` — its routes and page structure.
- `docs/reference/OBSOLETE_ALTERNATIVE_VERSION.md` — a Python/Jupyter version that came *before* it.
  So this is the third attempt at the idea, not the second.
- `docs/reference/INDEX_FOR_DOCUMENTATION.md` — their own index, if this map misses something.

## Deliberately not lifted

- **Supabase, auth, users, RLS, deployment.** [architecture.md § Storage](../architecture.md#storage) is
  the filesystem, on purpose. No database while the ideas are still moving.
- **Next.js.** The client here is Vite + React; theirs is Next.js App Router with server components.
  Anything copied across needs its `'use client'`, `next/image` and `next/link` stripped.
- ~~**shadcn/ui, Radix, Tailwind v4.**~~ **Reversed 2026-08-25** — both adopted, see
  [§ The reversal](#the-reversal-tailwind-and-shadcn-2026-08-25) above. The entry is struck through
  rather than deleted because the argument it made was a real one and is still the argument for not
  going further: *"Adopting Tailwind later is fine; inheriting a component library now is not."*
  We inherit primitives, not their reading view.
- **Phosphor.** Not lifted, and not only for the reason above — Phosphor's React package had shipped
  nothing for fifteen months when we looked. Icons went to **Lucide**, which is also shadcn's
  default, so it cost nothing when shadcn arrived. See [icons.md](../icons.md) and
  [design-system.md](design-system.md#icons).
- **The tool registry and the mutations framework.** Large, and built for a different problem —
  reversible edits to a stored document. Their own commissioned critiques found it over-engineered:
  [tool-framework.md](tool-framework.md). We have one contract: stable block ids.
- **PDF ingestion.** Seven documents' worth of hard-won knowledge (`PDF_*.md`), entirely out of scope.
  Briefly summarised in [extraction.md § PDFs](extraction.md#pdfs-out-of-scope-but-the-lesson-transfers).
- **Their testing infrastructure** (Jest + Playwright + shared-database isolation, ~15 docs). Real
  and good, and far heavier than this repo warrants yet. See [testing.md](../testing.md) for ours.
- **Chat, voice input, tweet threads, analytics, Stripe.** All built there. None of them is
  [the one feature](../granularity-zoom.md) we're testing, and chat in particular is the one we
  should be most suspicious of — [search-and-chat.md](search-and-chat.md#chat-the-one-to-be-suspicious-of).

## See also

- [vision.md](../vision.md) — what *this* project is for, and its [anti-goals](../vision.md#anti-goals)
- [granularity-zoom.md](../granularity-zoom.md) — the one feature we're testing
- [architecture.md](../architecture.md) — pipeline, storage, [stage ownership](../architecture.md#stage-ownership)
- [content-extraction.md](../content-extraction.md) — our Readability stage
- [block-ids.md](../block-ids.md) — the spine, and the road not taken in [ids.md](ids.md)
- [hierarchy.md](../hierarchy.md) — the deeply-nested ToC
- [open-questions.md](../open-questions.md) — several of which the previous version has answered once
- [`styles/tokens.css`](../../../styles/tokens.css), [`public/`](../../../public/) — what came across
