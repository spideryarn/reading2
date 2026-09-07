# Write a tutorial for people who have never read the code

> **Provenance.** Written 2026-08-30 from two files in Greg's MindstoneRebel repo —
> `coding-agent-instructions/workflows/WRITE_TUTORIAL_FOR_DEVELOPERS.md` (the audience and the
> emphasis) and `rebel-system/skills/documentation/write-tutorial-explainer/SKILL.md` (the
> mechanics: mental models, spiral curriculum, progressive disclosure, the HTML template). Condensed
> into one doc, and re-pointed at inline SVG plus a browser check.

Explain **how a thing works** to somebody who understands the product and has never opened the
repository. Output one self-contained HTML file to `docs/tutorials/`.

**Name it like a planning doc** — `yyMMdd<letter>-kebab-topic.html`, so the directory sorts by the
day the tutorial was written and you can tell at a glance how old one is:

```
$ npx tsx scripts/plan-name.ts --dir=tutorials "Import pipeline and database"
docs/tutorials/260906a-import-pipeline-and-database.html
```

The convention and the reasoning are
[write-planning-doc.md § File naming conventions](write-planning-doc.md#file-naming-conventions) —
the only difference here is the extension. Tutorials written before 2026-09-06 have no prefix and
are left alone.

## Who you are writing for

A **product manager or engineer who knows the product well and has never read the codebase**. Smart,
product-literate, new to this repo's structure, conventions and history — and with no need to learn
them.

Their job is not to understand the implementation. It is to bring **product taste and judgment**:
what should we build next, what is fragile, is this trade-off worth it. So optimise for
**understanding how things work**, never for navigating the code. Function names and file paths are
signposts for later, not the content.

Sometimes judgment turns on a technical trade-off — *is it worth refactoring X? does approach A make
Y easier but Z harder?* Surface those, always at the level of **consequences and options**, never
line-by-line mechanics.

**Keep this framing out of the document.** The audience definition steers your writing; it is not
content for the reader. No "who this is for", no "how to get the most from this", no "the AI writes
the code so your job is judgment". At most one short line of context in the intro. Navigation
guidance belongs in the table of contents, not a prose preamble.

## The seven things that make it good

The reader is busy and must be able to **skim, jump around, or stop early** and still come out
ahead. Optimise ruthlessly for low cognitive load.

### 1. Mental models before mechanics

Open with 2–5 crisp analogies, in callout boxes, before any detail. *"A postal sorting office
staffed by extremely literal robots"* teaches the architecture faster than the architecture does.
Choose analogies from things this particular reader already knows.

### 2. Spiral curriculum

Introduce each idea shallow first, then revisit it deeper. Four passes is the usual shape:

| Pass | What it gives |
|---|---|
| 1 | what happens, end to end, no detail at all |
| 2 | what each component does and why it exists |
| 3 | one thing followed step by step through the whole system |
| 4 | edge cases, failure modes, the things that are actually hard |

**Every pass must stand alone.** A reader who stops after pass 1 should be ahead, not confused.

### 3. One worked example, threaded throughout

Pick a single concrete scenario — one real URL, one real request, one real record — and follow it
from start to finish, reusing it across every pass rather than inventing a new example each time.
Build complexity into that one example instead of adding new ones.

### 4. Simple language, without over-simplifying the reality

Short sentences. Ordinary words. Say the thing itself rather than gesturing at it. But **do not
flatten the truth to make it easier** — if a mechanism has three cases, say there are three cases;
if something reports success while doing nothing, that is the interesting part and it goes in.
Simplifying the *language* is the goal; simplifying the *system* is a lie the reader will later
act on.

**Explain repo shorthand plainly, once.** Layering rules, conventions and internal nouns mean
nothing to somebody who has never seen the codebase. Give them in plain language with a concrete
example, or link forward to the section that explains them. Never use one as unexplained shorthand.

### 5. Diagrams as an alternative explanation, not decoration

Treat diagrams as first-class. The same idea shown as a picture — flow, architecture, state machine,
sequence, hierarchy — often lands faster than prose, and different readers grok different
representations. **Prefer offering an important concept both ways.**

**Hand-author inline `<svg>` in the page.** It keeps the tutorial one self-contained file, it styles
with the rest of the document, and it costs no toolchain. Mermaid via
[generate-mermaid-diagram.md](generate-mermaid-diagram.md) is the alternative when the diagram is a
plain flowchart and you would rather not draw boxes by hand.

Rules that keep them legible:

- **One idea per diagram.** Two diagrams beat one crowded one.
- **Label the arrows**, not just the boxes — the relationship is usually the content.
- Give `<svg>` a `viewBox` and no fixed `width`, so it scales; wrap anything wide in a container
  with `overflow-x: auto`.
- Colour-code by *kind of thing* (browser / server / database / external service) and keep that key
  consistent across every diagram in the document.
- Use a monospace font for anything that is a real identifier — a path, a function, an endpoint.
- Text under ~12px is unreadable on a laptop. Check, don't assume.

### 6. Check the diagrams in a browser

An SVG that is correct in the source and wrong on screen is the normal case: overlapping labels,
text escaping its box, an arrowhead pointing at nothing, a colour invisible on the page background.
**None of that is visible in the markup.**

So open the finished file and look at it. Delegate this to a Sonnet subagent driving a browser —
[Claude-in-Chrome](https://claude.ai/chrome), Playwright, or whatever automation the machine you
are on has. It is click-look-click and the screenshots are large, so keeping them out of the main
context is worth more than the extra reasoning:

```
Open file:///<abs path>/docs/tutorials/<name>.html in a new tab.
Screenshot each SVG diagram. For each one report: any overlapping or clipped text,
any label smaller than ~12px, any arrow that does not visibly connect the two boxes
it should, and anything unreadable against the background. Report the problems, not
the page.
```

Fix and re-check. Ask it back for the conclusion, not the page dumps.

**And when you are done, always open it for the reader** — `open <path>` on macOS, `xdg-open` on
Linux — as the last thing you do. A tutorial is a thing to look at, and a file path in a chat
message is not. Do this whether or not the agent-side check above was possible.

### 7. Skimmable core, detail hidden

**A reader must never *have* to expand anything to get the point.** Keep the main line short — one
idea per paragraph — and push depth, edge cases, incident detail and any real code into collapsed
`<details>` blocks and appendices.

What belongs behind a `<details>`: the second and third passes of a spiral; the exact algorithm; the
list of every field; the story of a specific bug; anything with code in it.

## Surface the judgment calls

The reader is there to exercise taste, so make the decisions findable. Use callouts, and give them a
dedicated section near the end:

- **Trade-offs and decision points** — where reasonable people could choose differently, and what
  each choice costs.
- **Risks and fragilities** — what could go wrong, what we are unsure about, what fails quietly.
  A thing that reports success while doing nothing is always worth a paragraph
  ([silent-success.md](silent-success.md)).
- **Open questions and direction** — what we would change with more time, and where this is heading.

Frame all three around **product consequences**, not implementation mechanics.

## Structure

```
  <head>          <title>, <meta name="description">, all CSS inline
  HTML comment    the user's exact request, the date, the source files you read
  H1 + one line   reading time (skim / deep dive), one line of context
  TL;DR           2–4 sentences: the shape of the whole thing
  Mental models   2–5 callout boxes
  Contents        anchor links to every H2, plus 3–5 "read by interest" paths
  Pass 1          what happens, no detail — with the overview diagram
  Pass 2          the components — <details> for each one's depth
  Pass 3          the worked example, followed all the way through
  Pass 4          <details> — edge cases and the genuinely hard parts
  Judgment        trade-offs · risks · open questions
  FAQ             the questions somebody actually asks
  Appendix        file map, data dictionary, glossary of internal nouns
```

Scale it to the topic. A single workflow needs TL;DR, two mental models, one diagram, one pass and a
file map — not this whole skeleton.

**Make it navigable.** Anchor every `<h2 id="...">`, hyperlink every cross-reference between sections
so jumping around costs nothing, and give 3–5 "if you care most about X, read Y and Z" paths in the
contents.

## Process

1. **Read before you write.** Explore the code and the existing docs properly. Plans, postmortems and
   review files are usually where the honest account of what is broken lives — those are the source
   of the judgment section.
2. **If a doc should exist and doesn't, write it first**, following the project's own documentation
   conventions.
3. **Get a second perspective** on the finished tutorial, ideally from a different model family, and
   a browser pass on the diagrams (§ 6).
4. **Record the request** in the HTML comment at the top — the exact prompt, the date, the files you
   read — so the next person knows what was and was not in scope.
5. **Open it in the browser** — always, as the final step. See § 6.

## Checklist

- [ ] The filename carries today's `yyMMdd<letter>` prefix
- [ ] The exact request, the date and the sources are in the HTML comment
- [ ] TL;DR gives the shape of the system in under five sentences
- [ ] 2–5 mental models, before any mechanics
- [ ] Every pass stands alone; stopping early leaves the reader ahead
- [ ] One worked example, reused rather than replaced
- [ ] Every important concept is available as both prose and a picture
- [ ] Every diagram has been looked at in a browser
- [ ] The finished file has been opened in the reader's own browser
- [ ] Nothing essential is behind a `<details>`
- [ ] Every internal noun is explained in plain words the first time it appears
- [ ] Trade-offs, risks and open questions have a section of their own
- [ ] The meta-framing about the audience is nowhere in the document
