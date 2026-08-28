# Decorated mode — a playground

A place to try decorations on a real article before deciding which of them deserve to exist. It is
deliberately outside `src/`: nothing here imports from the app and nothing in the app imports from
here, so an idea can be tried without arguing about URL state, the band, or the layer budget first.

```
node experiments/decorated/build.mjs     # writes decorated.html
node experiments/decorated/verify.mjs    # checks the promise below, and checks itself
open experiments/decorated/decorated.html
```

The output is one self-contained file. No server, no build step, no dependencies — `file://` is
enough.

## The promise

**Not one of the author's words is removed, reordered or rewritten.** Decorations may restyle the
prose and may add matter around it. `verify.mjs` checks three things and re-runs each against a
deliberately broken copy, because a check nobody has watched fail is not evidence:

1. Every block on the page matches the stored block, character for character.
2. No heading of ours repeats a heading of the author's. *(This one was failing. Every span the
   author titled had its title printed twice, and it looked like a styling choice.)*
3. Every piece of apparatus is `user-select: none`, so a reader who copies three paragraphs gets
   three paragraphs of the author and none of our gutter.

## What's here

| File | |
| --- | --- |
| `build.mjs` | artefacts → `decorated.html`. Reports every quote, range endpoint and block reference it cannot resolve rather than skipping it. |
| `inline.mjs` | block `html` → the same normalised text the pipeline stored, plus the inline markup as ranges. Every decoration is a range over that text, which is what lets layers overlap. |
| `annotations.json` | the judgement layer: weight, rhetorical role, connective, the question each paragraph answers, difficulty, and 212 marked spans across all 108 prose blocks. |
| `page.css` | organised by *channel*, not by feature — see the header comment. |
| `page.js` | the panel, the spine, the arc rail, the cards, the dwell timer. |
| `verify.mjs` | the promise, and the controls. |

Everything on the page is real: the article is the stored blocks for
`noema-mythology-of-conscious-ai`, and every layer is driven either by an artefact the pipeline
already produces (`tree`, `labels`, `arc`, `summary`, `glossary`, `ideas`, `comments`) or by
`annotations.json`. Nothing is lorem ipsum, so a layer that looks bad here looks bad for a reason.

## Reading it

Open the panel at the bottom right and turn the layers off one at a time. The ones you don't miss
should not exist. Four presets: **all on**, **bare prose**, **the restrained set**, and
**everything Greg asked for**.

Three switches are marked *contested* — they are things Greg asked for that the reading-science
review argued against, and they are on the page so the argument can be had with prose in front of
it rather than in the abstract. `docs/research/decorated-mode-ideas.md` has the disagreement, the
other 168 ideas, and what to build next.
