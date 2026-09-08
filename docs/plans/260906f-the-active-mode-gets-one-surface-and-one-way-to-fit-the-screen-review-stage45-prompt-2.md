# Round 2: the revised trace reader, and the split stage 5

Second round on the same work you reviewed as F34–F48. Repo root:
`/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface`.

**All fifteen findings were accepted.** Your two refusal conditions were "not until F34–F36 are
fixed" for the trace reader and "not as one stage until F41–F45 are resolved" for stage 5. This asks
whether they actually are. Weight this round higher than the first, as you have argued before: the
first was partly a plan review and this is mostly code.

## What changed

**The trace reader is now two files plus a suite.**

- `scripts/viewport-trace.ts` — the analysis, pure, no printing. Field-by-field validation of
  external JSON (F35); `clean` requires positive evidence and everything else is `inconclusive`
  (F36); motion classified from **deltas against a keyboard-closed baseline** over scale-1 samples,
  refusing bottom-only arithmetic whenever a measured head is clipped above (F34); occlusion
  computed here rather than read from the probe's `vis` (F38 — and **the probe is deliberately not
  changed**, because it is already deployed and cannot reach the trace that arrives; say if you
  think that reasoning is wrong).
- `scripts/read-viewport-trace.ts` — printing and exit codes only. `0` answered, `3` inconclusive,
  `2` unreadable.
- `tests/viewport-trace.test.ts` — 23 tests, in the ordinary gate (F37). Run it.

**Stage 5 is split** (F43). 5a is preparatory and explicitly does not tick A5's modal/modeless
checkbox; 5b is the hover cards and waits on a product decision. Steps added for `RefereeHowCard` as
surface 17 (F41), Annotate and Chat focus restore (F42), the Chat thread-arm target decided rather
than assumed (F44), and a real-Chrome traversal check with an explicit honest fallback (F45).

Read: the plan's status table, § *Stage 4* step 3½, § *Stage 5*, the new review-log section at the
end, and the focus inventory. Everything is tracked — verified with `git ls-files --error-unmatch`.

## What I want you to attack

1. **Did F34 actually get fixed, or did I move the bug?** The classifier now takes a baseline, a set
   of open samples, and a per-sample delta comparison with a 1px slop. Is there a real phone trace
   shape that gets the wrong `motion` out of it — several keyboard open/close cycles in one trace, a
   rotation mid-trace, a baseline sample that is itself mid-animation, `offsetTop` that rises and
   falls while the keyboard slides? The tests cover single clean transitions and I do not think that
   is the shape of a real trace.
2. **Is `inconclusive` now too eager?** I would rather it were, but a reader that says
   `INCONCLUSIVE` to a perfectly good trace wastes the one measurement we get. In particular:
   `clean` requires rectangles for `head` and `composer` in some usable sample — but a mode with no
   composer at all (Glossary, Outline) is a legitimate thing to trace, and would now be
   inconclusive by construction. Is that right, or is it a bug I have just written?
3. **The mutation evidence.** I watched two things go red — removing the clipped-head refusal, and
   turning a missing rectangle back into zero. **Name a third mutation that should be caught and
   is not**, if there is one. This is where you have been most useful on this plan.
4. **Stage 5a step 4 and 5** claim Annotate, Chat and `RefereeHowCard` share one shape and one fix
   (take focus on open, unmount the focused element on close, restore the recorded opener). Is that
   actually true of all three, or have I generalised from two? `RefereeHowCard` in particular is a
   toggle rather than a dialog, and its opener is always present, which may make it a different
   problem wearing the same clothes.
5. **Anything in the round-1 dispositions that I recorded as accepted but did not actually do.**
   That is the failure mode this plan has produced most often — F27 and F30 were the same thing
   twice — and a disposition table is exactly where it hides.

## How to answer

A table with severity, what is wrong, and what you would do. Say plainly whether your two refusal
conditions are now met. If you think a decision recorded in the review log is wrong rather than
merely unargued, say so in those terms.
