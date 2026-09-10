# Review request: plan 260910c, per-account Usage Limits sections

You are reviewing a **plan, before it is built**. Read-only. Repo root is this worktree.

**The plan:**
`docs/plans/260910c-usage-limits-page-one-section-per-claude-and-codex-account-subscription.md`

**The ask it answers**, Greg 2026-09-10: *"The Usage Limits page should have sections for each Claude
and Codex account-subscription, summarising 5d and weekly X% used and when they reset."*

## Context you need

- `docs/project/usage-history.md` — the eight things a usage rendering may not claim. Read it.
- `docs/plans/260909g-…-several-claude-subscriptions-….md` Stage 3 and Stage 4 — the prior plan whose
  remaining work this is. Its Stage 3 status note is the constraint I am working inside.
- `docs/plans/260910b-…-codex-….md` — a peer session's Codex plan. I must not duplicate it.
- The house standard: this is the Overseer's dashboard, which
  `docs/project/overseer-direction.md` holds to a **higher robustness bar** than the product, because
  it is the thing you reach for when something else is broken.

## The conclusions I would least like to be wrong about

Check these directly against the source, not against my prose. If any is false the plan is wrong,
not merely improvable.

1. **That a sibling checkpoint field (`Checkpoint.accountUsage`) is better than growing
   `UsageReport.accounts[]`.** My argument is that `chooseUsage` in `tools/overseer/usage-carry.ts`
   republishes a stored `UsageReport` when a fresh transcript scan is incomplete, and that this would
   therefore discard perfectly good live HTTP readings that have nothing to do with the scan. **Read
   `chooseUsage` and confirm that is actually what it does.** If it does not, my central design
   argument collapses and the simpler option (one field) is right.
2. **That adding `accountUsage` to the checkpoint needs no schema bump.** I am relying on
   `tools/overseer/store.ts`'s own stated rule. Confirm the rule says what I claim and that a
   dashboard built before this change genuinely degrades to "no sections" rather than to something
   false.
3. **That `readUsage` in `tools/overseer/accounts.ts` is safe to call once per registered account per
   300 s from inside the daemon**, including: it never spends or reads the refresh token, it cannot
   hang unboundedly, and it cannot leak a credential into a rendered field. I claim all three.
4. **That `enforceExpectedAccount` (`tools/overseer/codex-usage.ts`) really does let a `null`
   accountId through a supplied `expectedAccountId`.** I was told this by a peer session and then read
   it myself. Confirm independently. If true, is my proposed fix (null ⇒ `unknown` when an expected id
   was supplied) correct, or does it break an existing caller? **Enumerate every current caller of
   `collectCodexUsage` that passes `expectedAccountId`** — I want the complete list, not a sample.
5. **That the ambient account genuinely cannot be registered** and therefore genuinely needs the
   third `role: "ambient"` arm, rather than that being a shape I invented to avoid a harder question.

## What I want from you

- **P0**: anything that makes the plan wrong to build as written.
- **P1**: anything that would produce a rendering that makes a false claim about usage — especially
  any path where an absent or expired or unattributable reading could reach the page as a number.
  That is the failure class this whole subsystem exists to prevent and I would rather over-hunt it.
- **The scope cut**: I am deliberately NOT making the 24-hour history chart per-account in this
  slice, and instead naming it as an unbuilt Stage 4. Is that cut coherent, or does it leave the page
  in a state that is worse than either doing both or doing neither? Say so plainly if you think the
  page ends up self-contradictory — a live per-account section above a single-account chart, with one
  caveat line between them.
- **Anything I have made more complicated than it needs to be.** The house rule is *simplest version
  first* and *prefer simple over easy*. If a stage can be dropped or merged, say which.

Answer in markdown. Be specific about file and line. Where you disagree, say what you would do
instead.
