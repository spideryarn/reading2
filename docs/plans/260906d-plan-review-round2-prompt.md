# Review round 2: the revised plan to split a 15,489-line stylesheet and tighten the mode contract

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership`, branch
`worktree-a10-style-ownership`. Still a **plan review before any code is written**.

## The candidate

Live pre-commit; base `b67f3a76`. Untracked:

- `docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md` — the revised
  plan, and the only thing to review
- `docs/plans/260906d-plan-review-sol.md` — your round-one answer, for reference
- `docs/plans/260906d-plan-review-prompt.md` — the round-one prompt

## Previous findings

| ID | Finding, verbatim (abbreviated) | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | the proposed ownership map requires non-contiguous moves | fixed | The speculative "families" table is gone, replaced by the **actual** 37-file cut with old line ranges. "One output file owns exactly one contiguous top-level interval" is now a stated rule, and there is no `overlays.css`. |
| F2 | the stacking-rule instruction is impossible without moving rules | fixed | Verified 31 `z-index:` declarations. Your wording adopted: extraction does not consolidate declarations; the contract's single home is `design-css-overview.md § The stacking order`. |
| F3 | byte-preserving moves do not preserve stylesheet-relative URLs | fixed, **and measured to have no instance** | `grep -c "url("` on `styles.css` is **0**, and its only `@import` is line 27, which stays in `styles.css` (it is above the first cut at line 29). The discipline is written in regardless. |
| F4 | `tailwindcss.compile()` is not the production CSS pipeline | fixed | Two immutable SHA-labelled pre-cut baselines: `compile()` for diagnosis, `npm run build:client` as the authority. Comparison refused if either is missing or post-cut. `npm run build` added to stage 2's completion; browser pass runs against the built preview. |
| F5 | a fifteenth artefact mode can still be activation-half-wired | fixed | Tagged union `fixed`/`delegated`/`none` with reasons, exactly as you wrote it. |
| F6 | the presentation expectation type permits the omission it is meant to catch | fixed | `NO_BAND_MODES` + non-nullable `Record<Exclude<Mode, …>, { where: string; says: string }>`; accessible-content-only reads; the delete-the-visible-body mutation is now one of three required mutation checks. |
| F7 | presentation is not currently "nothing" | fixed | Claim withdrawn in the plan's own words; the deliverable is restated as owner-side coverage. |
| F8 | the `no-raw-nul-bytes` migration target is stale | fixed | Verified: it is `git ls-files`-derived and `styles.css` is one of twelve coverage witnesses. Excluded from the migration; stage 1's completion condition rewritten. |

Treat the fixes as unreviewed work written by someone else, and spend most of the run on what has
changed since round one — chiefly § *The pairs that actually break*, § *Stage 2* (the 37-file table
and the three non-negotiable rules), and § *Stage 4*.

## What you can and cannot run

Tree read-only; `/tmp` and `node_modules` caches writable. No network, not even loopback. One test
file and a throwaway `/tmp` harness are available if useful.

Two measurements from round one that you may want to re-derive rather than take on trust:

- The 37 slices tile lines 29–15489 with no gap or overlap and their concatenation rebuilds
  `styles.css` byte for byte. The line ranges are in the plan's stage-2 table; `styles.css` is in
  the tree.
- Tailwind inlines `@import` **positionally** rather than hoisting it, and `layer(app)` is
  inherited through four levels of nesting.

## Attack it

Independently.

The plan now claims a specific, checkable thing: **these 37 ranges, imported in this order, produce
the same cascade, and the two baselines plus a browser pass would catch it if they did not.** Break
that claim. In particular:

- Is any of the 37 boundaries in the wrong place — cutting inside an at-rule, a comment, or a
  construct that does not survive being at a file edge?
- Is there an ordering hazard the plan's § *The pairs that actually break* misses?
- Is the "`styles.css` may contain no rule" test the right guard, or does it guard the wrong thing?
- In stage 4: is the tagged activation union now total in the sense that matters, or is there
  still a fifteenth mode that typechecks while half-wired? Can the revised `DRAWS` sweep still go
  green over an omission?

Same severity scale and finding format as round one. **IDs continue from F8 — number new findings
F9 and upward, and reuse an existing ID only for the same finding.** Refuse only on an established
P0 or P1, and name what established it.

## My own suspicions — read last

- Whether 37 files is the right granularity, or whether it trades one navigation problem for
  another. I have no strong view; the alternative is ~15 coarser files.
- Whether `glossary.css` carrying base classes that four later mode files depend on should be
  renamed to say so, given that renaming is otherwise forbidden in this stage.
- Whether merging the presentation sweep and the activation sweep into one test file is a
  simplification or a thing that will be hard to read.

Do not change any file.
