# Review: sixth sweep cluster S6 — CSS classes nothing emits and tokens nothing reads

## The candidate

Your working directory is the cluster's own git worktree. The candidate is the single commit
`b1bcdb4c7`: `git show b1bcdb4c7` (8 stylesheets, −62 +11).
The plan: `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` § S6 and § "What the review
changed" (U9). The builder's record: `docs/plans/261006j-sixth-sweep-s6-dead-css.md`.

## What it is meant to do

Delete CSS that nothing uses, changing no pixel: seven classes (`.cite-note`, `.sk-crumb`,
`.skim-place-repeat`, `.srch-retry`, `.tip-soon-flag`, `.tip-soon-learned`,
`.cmt-transport-error`) and six custom properties (`--depth-3`, `--quote-color`,
`--header-height`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border`). `--sidebar`
stays (it feeds `--panel`).

## What you can run, and what you may change

No network, no database. You may fix narrowly inside the eight stylesheets. Do not commit.

## Attack it — every deletion is an absence, and an absence is only as good as the search

1. For each of the seven classes, find an emitter the builder missed. Search by bare name AND by
   pieces: a class assembled from a prefix and a variable (`` `tip-soon-${x}` ``, `"sk-" + kind`,
   `` `skim-place-${…}` ``, `` `cmt-${…}-error` ``, `` `srch-${…}` ``), a lookup table of
   suffixes, `classList.add`/`toggle` with a computed name, a `className` built by a helper
   (`cx`, `clsx`, `cn`), `data-` driven selectors, HTML produced by a model or a library that we
   render (Temml, markdown renderers, the sanitiser's allow-list), the marketing pages and any
   static HTML, `tools/fleet/web/` (does the dashboard import these stylesheets?), and
   `docs/tutorials/*.html` (do the tutorials link the app's CSS?). Roots: `src/`, `tools/`,
   `scripts/`, `evals/`, `tests/`, `api/`, `index.html`, `public/`.
2. For each of the six tokens, find a reader the builder missed: `var(--x`, a fallback chain
   (`var(--a, var(--x))`), `getPropertyValue("--x")`, an inline `style` setting or reading it,
   a Tailwind v4 `@theme` mapping or utility that resolves to it (`bg-sidebar-accent`,
   `text-sidebar-foreground`, `border-sidebar-border`, `h-[var(--header-height)]`), shadcn
   components, the fleet dashboard's CSS, and a name built from pieces (`` `--depth-${n}` `` —
   this one matters: `--depth-1` and `--depth-2` are live; is the depth chosen at runtime by
   number, so that depth 3 can be requested?). If `--depth-${n}` is computed anywhere, deleting
   `--depth-3` changes a pixel at depth 3: establish what the maximum `n` is.
3. Selector-list edits: where `.sk-crumb` and `.tip-soon-learned` were dropped from a list shared
   with live selectors, are the surviving selectors and declarations exactly as before
   (specificity and order unchanged)?
4. The builder edited the root `styles/tokens.css` as well as `src/web/styles/tokens.css`. Who
   else imports the root one (the marketing pages, the fleet dashboard, the design page)? A token
   unread by the app could be read by another consumer of that file.
5. The builder reports `--depth-0` also has no reader but left it. Confirm or refute; do not
   delete it.

## Format

Verdict line first: **ship**, **ship with these fixes (applied)**, or **do not ship**. Findings
with ids (C1, …), severity P0–P3, evidence (the grep and its count), reproduced or reasoned, fixed
or reported. Under 700 words.
