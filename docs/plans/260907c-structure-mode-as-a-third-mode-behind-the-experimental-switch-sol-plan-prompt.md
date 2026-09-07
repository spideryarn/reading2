# Review a plan before it is built: Structure mode as a third reading mode

You are reviewing a **plan document**, before any code exists. Repo:
`/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode` (a git worktree cut from
`origin/dev`). The plan is:

    docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md

Read it in full, then read enough of the code and the docs it cites to check its factual claims.

## The one thing that is settled and NOT up for review

Greg decided on 2026-09-06 that Structure is added as a **third** mode — Hierarchy stays, Outline
stays — and that it goes **behind the Experimental Features switch**. Do not argue that it should
replace either mode, that it should be dropped, or that the band should not grow a fourteenth entry.
That question was asked and answered, and the plan's first section quotes the answer. Everything
else is open.

## Context you need

- `docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md` is the design this plan
  builds. **Its conclusion (merge the two modes) is superseded**; its thinking is not. You wrote a
  design memo for it, `260903b-...-sol-design-memo.md`, and Greg answered nine questions at its
  § Decisions. The new plan deviates from two of those answers (decision 2 and half of decision 3)
  and says so — check whether the reasons it gives are good enough, and whether it missed a
  deviation it did not declare.
- `docs/project/new-mode.md` is the house checklist for adding a mode. The plan claims to walk it
  item by item, at § The checklist, walked. **Check that claim against the file**: is every
  compiler-forced table listed, is every residue item answered, and is any item silently missing?
- `docs/project/experimental-features.md` owns the switch and its four rules.
- `AGENTS.md` (symlinked as `CLAUDE.md`) has the house rules.

## What I most want from you

1. **Factual errors.** The plan makes specific claims about the code. Check them:
   - `layout.ts`: that the mode band is `clamp(avail − PROSE_MIN, MODE_MIN, MODE_IDEAL)`, that
     `MODE_IDEAL` is 400 and `GIST_MIN` 176, and therefore that two 194px columns fit at the band's
     widest. Is 364px the right threshold? Does anything else about the band's box (padding,
     gutters, scrollbar, the `--mode-w` custom property) eat into the 400 such that two columns are
     narrower than the plan thinks?
   - That flipping between modes preserves the reader's place for free, because `withMode` in
     `Dock.tsx` rewrites only `?mode=` and `?at=` rides across. **This is the single most important
     claim in the plan** — the mode exists to be compared against two others at one scroll
     position. Verify it properly, including what happens when the band appears/disappears
     (`hierarchy` has no band, `outline` does) and whether that changes layout enough to move the
     reader.
   - That `focusRow` from `useColumnContext` is section-granular and is what Outline reads.
   - That the corpus's widest part count is 15 and widest section count 23 (`data/`).
   - That `src/web/modes/` holds the ten controllers named, and that a new mode is an eleventh
     directory in that shape.
2. **The staging.** Stage 1 adds the word to `MODES` plus ten tables plus a real (small) band.
   Stage 2 is the pure projection. Stage 3 is the panel. Is that the right cut? Is stage 1
   genuinely shippable and genuinely safe for readers who do not have the switch on?
3. **What the plan will get wrong when it is built.** Name the traps. Two columns measured
   independently, a projection that must decide both what is drawn and which row is current, a
   ladder per column, and a stacked fallback below 364px — where does that go silently wrong? I
   care much more about "this will look fine and be subtly false" than about style.
4. **The deferrals.** § What is deferred, and why. Is anything deferred that cannot honestly be
   deferred — i.e. where the v1 would mislead Greg's comparison rather than merely be smaller?
   Adaptive depth is the one I am least sure about: is a v1 on fixed three-deep trees still a fair
   test of the idea?
5. **The `POLICY` row.** The plan says a visitor sees the whole of Structure, as they do Outline,
   because the tree is in the payload. Check that against `src/web/visitor.ts` and
   `tests/public-network-trace.test.tsx` — is that actually true of Outline today, and does
   Structure inherit it, or is there a reason a mode behind the experimental switch should be
   owner-only?
6. **Anything the plan asserts that you cannot verify.** Say so explicitly rather than accepting it.

## How to work

The tree is read-only to you, and there is no network — not even loopback — so nothing touching
Postgres or a dev server will work. You **can** run a single test file with
`npx vitest run tests/<one>.test.ts` and a script with `node --import tsx <script>`, as long as it
needs nothing outside the tree. `npm test` and `npm run typecheck` will not work.

## Output

Findings ordered by how much they would cost if missed. For each: what is wrong, the evidence
(file and line), and what you would do instead. Be concrete and be willing to say a section is
fine. If you think the plan is broadly right, say which two or three things you would still change
before a line is written.
