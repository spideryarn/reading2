# Report W1: reading-view-overview, AGENTS.md ↳ lists, diagram.md split

(Returned as text — the harness refused the subagent's own write — and saved here by the orchestrator.)

## What changed

- `docs/project/debate.md` (new): `Up:` line; Greg's three asks quoted from 260905f and 260930j; the
  overview's Debate changelog paragraph moved in, wording kept; signposts to the five `src/debate*.ts`
  modules, `src/web/DebatePanel.tsx`, `src/web/modes/debate/`, `src/bibliographic.ts`, citations.md,
  experimental-features.md, security.md § A third untrusted party, the evaluation plan 260906b and the
  stage-0 spike results.
- `docs/project/structure.md` (new): Greg quoted from 260910g (SPIDERYARN-READING2-2S) and 260928a;
  the overview's Structure paragraph moved in; signposts to `StructureMode.tsx`, `StructurePanel.tsx`,
  `structure.ts`, `OutlinePanel.tsx` and `outline.ts` (the narrow face under its old name),
  `useColumnContext.ts`, plans 260928a and 260916b.
- `docs/project/tweets.md` (new): Greg quoted from 260825g, 260915e, 260929f; the overview's Tweets
  paragraph moved in; signposts to `src/tweets.ts`, `src/web/useTweets.ts`, `src/web/modes/tweets/`,
  `src/web/Tweets.tsx`.
- `docs/project/sketch.md`, `docs/project/illustrated.md` (new): "The fourth: Sketch" and "The fifth:
  Illustrated" moved out of `diagram.md`, wording kept, headings promoted one level, internal links
  repointed, `<a id="lettering">` and `<a id="figures">` kept.
- `docs/project/diagram.md`: the two sections are now short pointers that keep their headings and
  `<a id="sketch">` / `<a id="illustrated">` anchors, so old references still land. 2,351 → ~1,660
  lines. The opening names all five pictures.
- `docs/project/reading-view-overview.md`: Structure, Debate and Tweets are one line each saying when
  to open the new doc; `diagram.md`'s line no longer says "three"; `granularity-zoom.md`'s line uses
  AGENTS.md's "one of the features this app is for" and notes the gist columns are gone;
  `column-context.md` is marked history; `keyboard.md` says when to open it. "True across the whole
  view" untouched.
- `AGENTS.md`: only the ↳ list under reading-view-overview — added `structure.md`, `sketch.md`,
  `illustrated.md`, `debate.md`, `tweets.md`; `column-context.md` now says "history".
- Link-only edits into the moved anchors in eight plans, postmortems and feedback notes.

## Proposals

None.

## Found, left for someone else

- About 15 source comments cite `diagram.md § Sketch` / `§ Illustrated`. They still land on the pointer
  sections. `src/illustrated-plate.ts` cites a § that now lives in `illustrated.md`.
- The overview's Annotations paragraph is the same pattern: no `annotations.md` yet.
- `granularity-zoom.md` itself still holds the tabular view and gist-column material; `column-context.md`
  was not cut down.
- The overview's mode intro still says "four of its five pictures" — a copied count.

## doc-links

Green on everything of W1's. Two reds elsewhere at the time: the brief's own example link (fixed by
the orchestrator) and a W2 anchor in progress.
