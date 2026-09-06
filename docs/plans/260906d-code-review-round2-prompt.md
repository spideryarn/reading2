# A10 code review, round two — the fixes from round one, and a merge that was not additive

You are reviewing the second half of a job called **A10: make style ownership visible, and make a
new mode fail to compile**. Round one reviewed the code as first built and found nine issues
(F1–F9 in `docs/plans/260906d-code-review-sol.md`). **This round covers the fixes made in response,
which no reviewer has seen**, plus a subsequent merge of `origin/dev` that was not purely additive.

Weight this round higher than the plan review. A plan-stage review cannot find a guard that agrees
with the thing it is watching; this one can.

## What the job was

Two halves, both required:

1. **`src/web/styles.css` (~15,000 lines) becomes an ordered composition of smaller semantic
   sheets.** The instruction was explicit that this is an extraction and *nothing else*: extract
   contiguous sections in their original order, do not redesign selectors, do not rename classes,
   do not group every rule sharing a prefix — "later overrides may depend on intervening rules, and
   cascade order is the thing you are least likely to notice breaking." Keep one documented import
   order under `tailwind.css`'s `app` layer, the `tw` prefix, the source-scanning guards, the token
   bridge, and the deliberate absence of Preflight.

2. **Improve the extension contract, so a new mode fails to compile** at its presentation, visitor
   policy, label and activation decisions. The active-mode test should render each real controller
   through the shell and check its expected surface or its deliberate absence — and **keep the
   expected behaviour independently written**, because deriving both the implementation and the
   expectation from one new table gives you a test that agrees with an omission.

## What to review

You are in the repo. Read the code, and get the scoped diff yourself:

```
git diff 61fdf6a5 acc634a7
git diff --stat 61fdf6a5 acc634a7     # the manifest: 20 files, 1,097 insertions
```

Four commits:

| commit | what |
|---|---|
| `05ca1d21` | Five guards that were watching the wrong thing (fixes F13–F17) |
| `e5b3772f` | Narrow the import ban to the sheets it was actually about (F17 follow-up) |
| `9783cf19` | The money contract watched one endpoint, and the prose it was written from was wrong (F11, F12) |
| `acc634a7` | The postmortem, and the doc numbers that were wrong |

Plus, described below but not in that range, a merge of `origin/dev` that landed afterwards. The
working tree is that merge's result, so the files you read are post-merge.

## The specific things I want you to attack

**1. The `SPENDS` table was written from prose that was false.**
`src/web/activation.ts` claimed Force, Drift and Trail "cost nothing and are instant". They do not;
they spend via `/api/similar` and `/api/projection`. My test's `SPENDS` table was written from that
comment, so the test blessed the error and went green. I corrected both. **Check I have actually got
the money contract right now** — that every mode's `Spend` row matches what the code really does,
and that no row is still copied from a comment rather than from the fetch. The union is
`{ kind: "posts" } | { kind: "delegated" } | { kind: "none"; why: string }`.

**2. `MODE_TARGET` became a total tagged union.** It was `Partial<Record<Mode, AutoRunTarget>>`;
it is now `Record<Mode, ModeActivation>` with a `delegated` variant whose rows return
`AutoRunTarget | null`. `Dock.tsx` lost its `if (m.mode === "diagram")` special case and now makes
one call for all fourteen modes. **Is the union actually total, or have I moved the partiality
somewhere the compiler stops looking** — into a `null`, a default branch, or a cast?

**3. The independence requirement.** `DRAWS` and `SPENDS` in
`tests/every-mode-draws-its-surface.test.tsx` are meant to be the *independently written*
expectation, not derived from the implementation. `DRAWS` is keyed
`Exclude<Mode, "plain" | "hierarchy">` so the two band-less modes are structurally excluded rather
than listed as absent. **Is that independence real, or does some part of the test still read its
expectation from the thing it is testing?** Check especially whether a mode could be added, wired
up wrongly, and still pass.

**4. The five repaired guards (`05ca1d21`).** Each was a check that could not distinguish the
healthy state from the broken one. I claim each is now calibrated — reproduced red before the fix.
**Check the repairs are real and not merely more elaborate.** In particular
`tests/helpers/stylesheets.ts` resolves the `@import` graph rather than naming files, and has an
`IMPORTERS` allowlist plus throws on a duplicate visit; `tests/styles-entry-is-imports-only.test.ts`
has a hand-written ordered `MANIFEST` of 37 names as its independent expectation.

**5. The import ban I narrowed (`e5b3772f`).** My first version forbade *all* relative `@import`s
below `styles.css`, which would have broken the legitimate `styles/tokens.css → colourscales.css`
chain. The narrowed rule forbids them only under `src/web/styles/`. **Is the narrowed rule still
strong enough to catch the thing it exists to catch** — a feature stylesheet imported unlayered
from its component?

## The merge, which is not in the diff and which I want you to judge on its reasoning

After those commits I merged 78 commits of `origin/dev`. Because `styles.css` is now 65 lines of
`@import`, git could not merge any of the 37 incoming CSS hunks (622 insertions, **220 deletions** —
this one was not additive). Each hunk was applied to the sheet that owns its region.

The verification was this. The old check — "the sheets reconstruct `origin/dev`'s `styles.css`
exactly" — had stopped being usable, because this branch had added CSS of its own, so an exact
match against dev could never go green again. I replaced it with a three-way merge of the three
*concatenated bodies*, computed with `git merge-file` — a different code path from the `git apply`
that edited the sheets — and required the sheets to concatenate to that byte for byte. The
arithmetic:

```
base     15,601 lines
ours     15,666   = base + 65    (this branch's /design bands)
theirs   16,003   = base + 402   (exactly 622 - 220)
expected 16,068   = base + 65 + 402
```

The three-way merge was clean, 0 conflicts. One hunk was accepted by two sheets (`mode-band.css`
and `profile.css` hold byte-identical declaration blocks); it was placed by mapping its base line
number to the owning region, and `profile.css` contains no `.chat-live*` rules at all.

**Question: is that oracle sound, or is it circular?** A hunk landing in the wrong sheet moves it in
the concatenation too, which is the argument for why this still catches misplacement. Tell me if
that argument is wrong, and what it fails to catch.

## Two guards that origin/dev added, which the split had quietly broken

This is the part I most want a second opinion on, because it is the class this whole job was about.

- `tests/table-selectors-are-scoped.test.ts` asserts an **empty** list of offending selectors, and
  read `src/web/styles.css` directly. After the split that path yields no selectors at all, so the
  guard passed while checking nothing — and it is the guard for the very deletions in this merge
  (origin/dev scoping the bare `td {` and `thead th {` that were reaching the shelf). I repaired it
  to read the sheet set and to assert it found more than 500 selector branches first. **Calibration
  without mutating anything: the pre-merge body has 2 bare selectors, the post-merge body has 0, so
  the repaired guard separates the two states; reading `styles.css` it reports green for both.**
- `tests/dock-corner-controls.test.tsx` had a positive control already (the masthead's `--safe-top`
  padding has to be found before the absences are asserted), so it failed **loudly**. Same cause,
  opposite outcome, decided entirely by whether its author wrote a positive control.

**Is my repair of the first one right, and is `> 500` a threshold that means anything?** I chose it
as "obviously more than a handful"; tell me if a fixed number is the wrong shape here.

## The postmortem's claim, which you should test

`docs/postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md` argues that guards
need calibration *more* than the assertions they protect and get it *less*, because a wrong headline
assertion fails loudly while a wrong guard is silent by construction — its job is to say nothing
when things are fine, and a broken one also says nothing. Seven of the nine instances were one line
long. Six were written the same day by work that was specifically trying to close this class, by
people who had just read `silent-success.md`.

**Is that the right root cause, or is it a comfortable one?** If you think the real cause is
something else — the split itself being too large a change to land at once, or the tests being
allowed to read source files by path at all — say so.

## How to answer

Number your findings F20 onwards. For each: the file and line, what is actually wrong, and a
concrete failure — the input or sequence that makes it produce a wrong answer. Say which are
certain and which are suspicions. If a finding is "this is fine but for a different reason than the
comment claims", that is worth having too, because several of this job's bugs were exactly that.

Do not restate the diff back to me. Do not praise. Where you think I have already handled something,
one line saying so is enough.
