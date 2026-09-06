# Tutorials

`docs/tutorials/` holds **self-contained HTML explainers of how one area works**, written for
somebody who understands the product and has never opened the repository. One file, no build step,
inline CSS and hand-authored SVG — you open it in a browser and read it.

**How to write one is [write-tutorial.md](../reusable/write-tutorial.md)**, and it is worth following
closely: mental models before mechanics, one worked example threaded all the way through, and every
diagram actually looked at in a browser rather than trusted from the markup.

## What's there

- [architecture.html](../tutorials/architecture.html) — the shape of Spideryarn, end to end.
- [import-pipeline-and-database.html](../tutorials/import-pipeline-and-database.html) — a URL going
  in and becoming blocks.
- [revisions-and-the-schema.html](../tutorials/revisions-and-the-schema.html) — how re-extraction
  keeps everything that was anchored to the old text.

## Naming

`yyMMdd<letter>-kebab-topic.html`, from
`npx tsx scripts/plan-name.ts --dir=tutorials "<topic>"` — the planning-doc convention with a
different extension, so the directory sorts by day and you can see at a glance how old an explainer
is. The three above predate the convention and have no prefix; they are left alone, exactly as the
unprefixed plans are.

## A few principles

- **The audience is judgment, not navigation.** The reader is deciding what to build next and what is
  fragile. Explain consequences and options; file paths are signposts for later, not the content.
- **Simplify the language, never the system.** If a mechanism has three cases, say there are three
  cases.
- **A tutorial goes stale quietly**, and nothing in the repo will tell you. It carries the date it was
  written in an HTML comment for exactly that reason — check it against the code before you trust it,
  and say so in the doc if you find it has drifted.
- **Open it for the reader when you're done.** A tutorial is a thing to look at, and a file path in a
  chat message is not.

## See also

- [architecture.md](architecture.md) — the doc the architecture tutorial explains, and where the
  authoritative version of anything they disagree about lives.
- [plans.md](plans.md) · [research.md](research.md) · [postmortems.md](postmortems.md)

---

Up: [vision.md](vision.md)
