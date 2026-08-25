# Glossary — the terms this piece uses, and where it uses them

The terms an article uses in a non-obvious way, defined **from the article itself**, in the band
between the spine and the prose. Select one and the article underlines every place it appears.

[vision.md](vision.md#where-this-goes-after-granularity-zoom) has listed an *author's glossary* since
the beginning:

> **Author's glossary** — the terms this piece uses in a non-obvious way, defined from the piece
> itself.

Built 2026-08-25. The version this project is an offshoot of built one too, and
[original-version/glossary.md](original-version/glossary.md) is an account of what it got right and
the two bugs worth knowing about. **Read that before changing anything here** — several things this
feature does are answers to specific things that went wrong over there, and they look like fussiness
until you know what they are for.

```
  GLOSSARY MODE — same spine, same article, the band is a list of terms

 ┌─────────────┬───────────────────┬───────────────────────────┐
 │             │  Mode: glossary   back to contents            │
 │  ▇▇▇▇▇▇▇▇   ├───────────────────┼───────────────────────────┤
 │  ▇▇▇▇▇      │ Glossary  24 terms│ … a broadly nonreductive  │
 │  ▇▇▇        │ order  first use  │   explanation of what it  │
 │  ▇▇▇▇▇▇▇    │        hardest    │   ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈     │
 │  ▇▇         ├───────────────────┤   is like to be an        │
 │  ▇▇▇▇       │ nonreductive      │   organism …              │
 │             │ explanation       │                           │
 │             │ Seth's term for   │ … the nonreductive case   │
 │             │ an account that…  │   ┈┈┈┈┈┈┈┈┈┈┈┈            │
 │             │ ▸ also: nonredu…  │   does not collapse …     │
 │             │ ▸ used in 3 places│                           │
 │             │   k3m9qt qw82nf   │      ↑ underlined only    │
 │             ├───────────────────┤        while that term    │
 │             │ interoception     │        is selected        │
 │             │ …                 │                           │
 │             ├───────────────────┤                           │
 │             │ Find more · Start │                           │
 ├─────────────┴───────────────────┴───────────────────────────┤
 │ ⌂ Home  ✳ Questions  ⓘ Metadata  ☰ Thread  ⌸ Chat  📖 Glossary ●
 └─────────────────────────────────────────────────────────────┘
```

Code: [`src/glossary.ts`](../../src/glossary.ts) (stage 5d — the model call, the dedup, the
occurrence pass), [`src/term-match.ts`](../../src/term-match.ts) (the matching rule, shared),
[`src/api.ts`](../../src/api.ts) § `loadGlossary`, [`src/routes.ts`](../../src/routes.ts),
[`src/web/GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx),
[`src/web/useGlossary.ts`](../../src/web/useGlossary.ts),
[`src/web/annotate.ts`](../../src/web/annotate.ts) § `termMarks`, and `§ glossary mode` at the end of
[`src/web/styles.css`](../../src/web/styles.css). Tests:
[`tests/glossary.test.ts`](../../tests/glossary.test.ts).

## Where it lives, and why that cost nothing

Greg, 2026-08-25, when this was asked for:

> When active, it should replace the middle sections of the UI (i.e. right of the spine, left of the
> doc).

> Use a button in the bottom-bar to activate it.

Which is exactly what a **mode** already is, because he had described this feature by name when chat
was built:

> I'm thinking that this might be a common pattern, that when we switch into a mode (e.g. Chat,
> Glossary, etc) we'll want to keep the spine and article, but reuse the middle sections. In fact,
> the current "Table of Contents" middle sections are just such a mode that can be chosen from the
> bottom-bar (the default).

So the glossary is the third implementation of the slot described in
[chat-mode.md](../plans/chat-mode.md), and it needed **no new layout arithmetic at all**. `fitView`
in [`layout.ts`](../../src/web/layout.ts) already knew about the slot rather than about chat; the
whole change there was one line in [`App.tsx`](../../src/web/App.tsx) — `chatting` became
`mode !== "toc"`. That is the evidence that the reframing was right, and it is worth recording
because the reframing looked at the time like extra ceremony for one feature.

Two consequences worth knowing:

- The CSS class for the band shell was `.chat` and is now **`.mode-band`**. Renaming it rather than
  writing `.chat, .gloss { … }` is the difference between a slot and two features that happen to
  agree. Each panel keeps a class of its own for whatever only it needs.
- The Dock's `DockMode` docstring said it should become a `role="radiogroup"` once there were three
  modes. There are three, and **it stayed a toggle** — see [Dock.tsx](../../src/web/Dock.tsx) for
  why the count was the wrong trigger. The bar shows two of the three modes, because `toc` has no
  button, and a radiogroup naming two options is a worse lie than `aria-pressed`.

## What is generated, and when

Stage 5d writes `data/<slug>/glossary.json`. It is in `STEP_ORDER` and **not** in
`DEFAULT_INGEST_STEPS` — the same split `tweets` introduced, and the pair of them is what turned that
from an exception into the shape of the list: everything up to `arc` makes the article readable, and
everything after it is a thing somebody asks for.

Greg's call, 2026-08-25, choosing a button over generating on every ingest and over generating on
first view: **a button, on demand**. The third option — generate automatically when the mode is
opened — is the one the original version took, and its effect re-fired on every failure: generating,
failing, generating again, for as long as the tab stayed open. A button removes that bug
structurally rather than by remembering to set a flag on every error path.

```
npm run glossary -- data/<slug>        # once for a list
npm run glossary -- data/<slug>        # again to add more terms to the same list
```

or `POST /api/jobs { "slug": "…", "steps": ["glossary"] }`, which is what the panel's button does.

## The two bugs this feature is shaped around

Both are theirs, both are in
[original-version/glossary.md](original-version/glossary.md), and both are answered in code here
rather than in a prompt.

### One — the answer is what times out, not the question

Their extraction hit 504s in production. The cause was not the size of the article going in; it was
the number of **output** tokens coming back, because every entry carries two explanations. The fix
was a cap per call plus a "Load More" that feeds the already-extracted entries back so the model does
not repeat itself.

So: `BATCH_SIZE = 20`, `suggestedCount(words)` scales the ask and clamps to it, and **running the
step again appends**. `passes` on the artefact counts the calls, and the panel shows it — a list that
took three calls to build is a different object from one that took one, and it is the only way to see
that "Find more" did anything.

The second pass is given their FORBIDDEN checklist almost verbatim, because a plain "don't repeat
these" is not enough: the model's idea of a repeat is looser than ours, and it will happily return
the synonym, the plural and the subcategory of something already on the list.

### Two — their dedup deleted the more specific term

The model would emit both `nonreductive` and `nonreductive explanation`. Their dedup kept whichever
appeared **first in the document** and discarded the other — which was not a coin toss between two
equals. A general term is nearly always introduced before the specific phrase built on it, so
first-wins reliably deletes the better phrase, and the matcher then hunts the article for the
shorter, wronger one.

Their own plan proposed a richness-scored normaliser. **It was never built.** `dedupe` in
[`src/glossary.ts`](../../src/glossary.ts) is that normaliser, and its rule is stated by what it
keeps:

1. Two entries collide when their names normalise the same, or when one's **name** matches the
   other's **alias**.
2. Two entries that merely **share an alias** do not collide. That was their first attempt, and it
   was too aggressive — legitimate entries that happened to share a synonym were discarded, quietly.
   **Both directions of this bug fail silently**, which is why both have a test.
3. When they do collide, the **richer name wins** — more words, then more characters — and the poorer
   becomes an alias of it, carrying its own aliases across. Nothing is thrown away.

Rules 1 and 2 are the narrower fix they actually shipped, and they are right. Rule 3 is the half that
matters: without it, 1 and 2 still systematically destroy the more specific phrase, just less often.

**The merged entry keeps the incumbent's `id`**, even when the challenger's name wins. A `?term=`
link addresses an entry by id, so an id that changed when a later pass found a better name for the
same thing would break the reader's link in order to say the word slightly differently. Names are
display; ids are identity.

## Finding the term in the prose

**`blocks` on an entry is computed by us, never asked of the model.** The model is never shown a
block id and never returns one, so it cannot invent one. Matching the text can only be wrong about
*where* a term is, which a reader sees the moment they press it; a hallucinated id would be invisible
and would scroll them somewhere arbitrary. This is the same instinct as
[`validate-tree.ts`](../../src/validate-tree.ts) — check the invariant rather than trusting the
prompt to have honoured it.

It also turns the best line in their prompt into something **measurable**:

> Try to make the aliases distinctive, so that a regex using the aliases finds all and only
> references to the entity (if possible).

An entry that matches **no** block is either a term the piece does not use in those words or an alias
set too narrow to find it. Both are worth seeing, so the empty list is stored rather than smoothed
over, the panel says so in as many words, and the pipeline logs `unmatched` on every run. It is the
one quality signal this feature gives about what the model returned.

### The matching rule, and why it is its own module

[`src/term-match.ts`](../../src/term-match.ts) imports nothing from node, which is what lets it reach
the browser bundle. The server uses it to record which blocks a term is in; the reading view uses it
to underline the occurrences. **Those two must agree**, or the panel says a term is in a block and
the block shows nothing underlined — the feature looks like it is working and is quietly lying about
where the words are.

Three things in it are not obvious:

- **The word boundary is not `\b`.** `\b` is defined against `[A-Za-z0-9_]` even under the `u` flag,
  so an accented letter is a non-word character to it — and that breaks in both directions at once.
  `/\bcafé\b/` does not find "a café here"; `/\bco\b/` matches inside "coöperate". Unicode property
  lookarounds ask the question we actually mean. Both directions have a test.
- **The alternation is ordered longest-first**, because JavaScript takes the first branch that
  matches rather than the longest. That ordering is the whole of "`nonreductive explanation` beats
  `nonreductive`", and it is one sort call away from being wrong.
- **A trailing plural or possessive is allowed.** No prompt reliably lists the plural of every noun,
  and without this "attention head" silently misses the sentence about "attention heads" — which is
  usually the sentence you wanted. The honest cost: `bus` matches the text `buss`. Rare, and wrong in
  the harmless direction.

### Where the underlines are drawn

`termMarks` in [`annotate.ts`](../../src/web/annotate.ts) turns the selected term into `Mark`s, which
is the same machinery a comment uses. Two things follow:

- Offsets are in the **rendered-text space of `block.html`**, not `block.text`. The two strings are
  different lengths and mixing them lands a mark somewhere plausible and silently wrong — the header
  of `annotate.ts` is entirely about this.
- A comment and a term over the same words become **one `<mark>` with both classes**, not two nested
  ones. Two underlines stacked on the same words read as a rendering bug, and the comment keeps
  `cmt` so it stays clickable — a question you asked does not stop being openable because a glossary
  term happens to sit inside it.

`termMarks` only searches the blocks the server named. That is an optimisation — six blocks rather
than four hundred, on every render — but it is chosen for the other reason: it makes a disagreement
between the two halves surface as a **missing** underline rather than as an underline in a block the
panel claims has none.

## What we deliberately do not do

**Mark up the prose on the model's initiative.** Theirs put a dotted underline and a small book icon
on every term, inline, in every article, always. That is the prose acquiring marks the author did not
write, at the model's suggestion rather than the reader's — a small violation of
[principle 5](vision.md#principles), and the thing our own review of their feature said to drop.

What happens instead is Greg's call, 2026-08-25, chosen over a jump-only alternative: **selecting a
term underlines its occurrences, and only while it is selected.** Reader-initiated, so the principle
holds — and it answers the question the list otherwise raises on every entry, which is *where does
this piece actually use that*. Pressing the selected term again clears it, which is the only way to
take the underlines back out; a selection you cannot cancel is a mode inside a mode.

## The scores, and the condition attached to keeping them

Every entry may carry `difficulty` and `centrality`, 0–1, the model's own judgment. Our review of
their version recommended **dropping both**, on the grounds that "here are the important terms,
ranked by how important we think they are" is the model doing the reader's prioritising, which
[vision.md](vision.md) is against.

Greg overrode that on 2026-08-25, and the override came with its own condition: **keep both, and
never sort by them silently.** So:

- the list arrives in **document order** — first use in the article first, which is the reader's own
  order through the piece and a real order rather than a judgment;
- the sort is a control you press, and it only offers a score the model actually returned;
- **the number you sorted by is shown on every row**, because an order the reader chose but cannot
  see the basis of is what was actually being objected to;
- an unscored entry sorts **last**, not as zero. An entry the model declined to score is not one it
  scored as trivial, and treating the two the same is the small lie that makes a sort untrustworthy.

`?sort=` is in the URL like everything else ([url-state.md](url-state.md)), and it pushes history
because reordering a list is a deliberate act on the view.

## Finding more, and starting again

These are genuinely different operations, which is why they are two buttons rather than one with a
modifier:

| | What it does | How |
|---|---|---|
| **Find more** | another pass, told what it already has, appended to the list | `force: ["glossary"]` on the job — the step is current, so nothing else would run it |
| **Start again** | throw the list away and find a new one | `DELETE /api/glossary/:slug`, then an ordinary run |

The delete exists **because** running the step again appends. Without it there is no way at all to
say "this list is wrong" — a reader who disliked what the model found could only fix it by changing
the article underneath it. It is destructive, so the panel asks first, and `deleteGlossary` refuses
to touch the committed `example/` fixture: `articleDir` falls through to it for any slug with no
output of its own, including one that does not exist, so without that guard the one committed
directory in the repo would be one `DELETE` away from an unknown article.

**A stale glossary is not appended to.** The article underneath it moved, so the old entries describe
a piece that no longer exists and folding new ones in would produce a list half-describing each. That
decision is one line in `generateGlossary` and it is the line to read if the behaviour ever looks
wrong.

## Staleness, and the force cascade

`glossaryIsCurrent` is the step's `isDone`, and it checks the three things
[architecture.md § Storage](architecture.md#storage) has always specified for a cached artefact: the
blocks it was written from (`sourceHash`), the prompt version, and the model id. Change any one and
it regenerates by itself, with no `force` and nobody having to remember. Anything unreadable answers
**false**, which is the safe way round: the cost is one model call, where the other way is a stale
glossary served for ever.

`hashBlocks` moved out of `src/tweets.ts` into [`src/source-hash.ts`](../../src/source-hash.ts) for
this, and that is not tidying: two stages computing "the same" fingerprint two ways can only ever
disagree, and the day they do, one artefact reports itself current against a different definition of
current.

`glossary` is in `FORCE_ONLY_WHEN_NAMED` for two reasons, and the second is not shared with `tweets`.
It reads the blocks and the tree and nothing reads what it writes, so the positional cascade would
buy a model call for nothing — **and** forcing this step appends, so being swept in would silently
lengthen the reader's glossary as a side effect of re-fetching the article.

## Four ways to break this quietly

1. **Change the matching rule on one side.** `src/term-match.ts` is imported by the stage and by the
   reading view. Inlining a "quick" regex in either half makes the occurrence list and the underlines
   disagree, and neither will error.
2. **Sort the entries in the artefact.** `glossary.json` stores document order. Sorting on write
   would make `?sort=document` mean whatever the last writer felt like, and the panel's default order
   would silently become a ranking.
3. **Trust `url`.** It came out of a language model and the panel renders it as an `href`.
   `safeUrl` allows `http:` and `https:` and nothing else. Zod's `.url()`, which is what theirs
   validated with, accepts `javascript:`.
4. **Let the cascade force it.** See above. The symptom is a glossary that grows every time somebody
   refreshes an article, with nothing anywhere saying why.

## What is still open

- **Nothing generates a glossary for the fixture.** `example/` has no `glossary.json`, so the panel
  there always offers the button and the button writes into `data/`, which the fixture is not. That
  is consistent with the thread page and equally unsatisfying on both.
- **No keyboard traversal of the term list.** ↑ / ↓ belong to the article
  ([keyboard.md](keyboard.md)) and taking them inside the band needs a focus story the band does not
  have yet. Same gap chat has.
- **`detail` is plain text, deliberately.** The model is told no Markdown, and nothing renders any —
  rendering arbitrary model output as HTML is what [security.md](security.md) is about. If entries
  ever want emphasis, the answer is a restricted renderer, not `dangerouslySetInnerHTML`.
- **Nothing ties a term to a question.** [comments.md](comments.md) already answers "what does this
  mean" for a selected passage, and our review of their version argued a glossary should be *the same
  mechanism with a different prompt* rather than a second system. It is currently a second system —
  a cheap one, with its own artefact and its own anchor model, but a second one. Worth revisiting
  before either grows.

## See also

- [original-version/glossary.md](original-version/glossary.md) — theirs: the prompt, the two bugs,
  and what we said we would do differently
- [chat-mode.md](../plans/chat-mode.md) — the mode band this reuses, and the reframing that made it a
  slot
- [comments.md](comments.md) — the other way to ask what something means, rooted in a selection
- [block-ids.md](block-ids.md) — why an occurrence is a block id and never an offset
- [url-state.md](url-state.md) — `?mode=glossary`, `?term=`, `?sort=`
- [security.md](security.md) — the sanitiser, and the two forged-mark classes it strips
- [architecture.md](architecture.md#pipeline) — where stage 5d sits
