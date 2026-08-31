# Review: a fifth diagram, drawn by a model rather than by an algorithm

You are reviewing a **plan plus the code already built for it** in the
spideryarn2 repository at /Users/greg/Dropbox/dev/experim/spideryarn2.

Weight this as a **code review**, not only a plan review: the experiment phase
is built and has run against three real articles. What is NOT yet built is the
product integration (artefact kind, pipeline step, routes, the React panel).

## Read, in this order

1. `docs/plans/260830j-sketch-diagram.md` — the plan, the measurements, the bugs found.
2. `docs/project/diagram.md` — the four existing diagrams. Sections that matter
   most: "What is deliberately not here" (a generated image was already
   considered and rejected), "Two things that are wrong in a way you cannot
   see", and "Why the Tree is the default".
3. `src/sketch-scene.ts` — the schema, the validator (`readSketch`), the score.
4. `src/sketch-paint.ts` — scene → drawing primitives. Pure, no DOM.
5. `src/sketch.ts` — the model call and the prompt (`SYSTEM`, `renderPrompt`).
6. `evals/sketch/run.ts` and `evals/sketch/svg.ts` — the harness.
7. `CLAUDE.md` for the house rules, and `docs/reusable/silent-success.md`.

For context on what a comparable stage looks like here, `src/ideas.ts` is the
nearest neighbour and this was shaped on it.

## What I most want you to attack

1. **The central design claim.** Greg asked to "let the agent decide the layout
   completely, probably with SVG". I gave the model a constrained JSON scene
   instead of raw SVG, on three grounds: an image of a structure cannot be
   checked against the structure; model-authored markup in the DOM would be a
   new security precedent in a codebase that has none; and colour/type belong to
   the design system. **Is that the right trade, or have I taken away freedom
   that matters?** Name a specific diagram a person would want that these five
   primitives cannot express.

2. **The validator, `readSketch`.** What gets through it that should not? I care
   most about failures that are silent — an item that survives validation and
   then draws something false or invisible. Note especially: geometry is
   *clamped* rather than dropped; `cleanPath` allows `M L C Q A Z` and numbers;
   an unknown `block` costs the node its click but not its existence. Is any of
   those the wrong call? Is `cleanPath`'s regex actually sufficient — can you
   construct a `d` string that passes it and does something unwanted?

3. **`scoreSketch`, and whether these are the right measures.** `flow` is
   Kendall's tau between node y and article position, computed over the
   OVERVIEW scene's linked nodes only. `reach` is the widest run of the article
   no node points into. Is `flow` measuring what it claims? What would score
   well and still be a bad picture — i.e. what is the measure blind to? The
   repo's rule is that a check you have never seen fail is not evidence.

4. **The geometry in `sketch-paint.ts`.** Five renderer bugs are recorded in the
   plan, all found by looking at pictures rather than by tests. What is the
   sixth? Look hard at `facing`, `outsideRun`, `edgePath`'s curve arithmetic,
   `midOf`, `wrap`, `nodeFits`/`linesNeeded` (which live in the other file and
   use a *different* wrapping routine from `wrap` — is that a divergence that
   will bite?), and the arrowhead maths.

5. **The prompt in `src/sketch.ts`.** It is the thing that decides whether this
   feature is any good. What is missing, what is over-specified, what will a
   model reliably get wrong? Is asking for three scenes in one answer right, or
   should the zooms be a second call?

6. **What the plan has not thought about.** Staleness (the article is
   re-ingested and the scene's block ids go stale — `readSketch` would drop the
   clicks; is dropping right, or should a stale sketch refuse to draw?).
   Re-running and whether ids should be inherited. The reader profile.
   Accessibility of a picture whose whole content is spatial. Public/visitor
   access. The `?scene=` URL parameter surviving a re-run.

7. **Anything in the built code that is simply wrong**, including the
   registrations in `src/models.ts` and `src/ai-call.ts`.

## Please also answer directly

- Should this ship as a fifth diagram at all, or is it a different feature?
- If you had to cut one thing from what is built, what?
- What is the single highest-value change to make before this is put in front
  of a reader?

Be specific and adversarial. Check each claim against the code rather than the
prose — several of my comments assert things I believe and have not proved.
