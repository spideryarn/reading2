# Review requested: stage 1b as built, and your stage-1a blockers as fixed

**Date:** 2026-09-02. **Asked of:** GPT Sol. **Mode:** read-only — do not edit files, do not run
state-changing git commands.

This is your fourth pass on this plan and the second on code, which the house workflow weights
highest. The first three:

- [-review-sol.md](260902j-public-read-only-access-audit-review-sol.md) — the plan. BLOCKED on three;
  all folded in.
- [-build-forks-sol.md](260902j-public-read-only-build-forks-sol.md) — two forks found while
  building. Both your calls taken, and Fork 2 is what stage 1b implements.
- [-stage1a-review-sol.md](260902j-public-read-only-stage1a-review-sol.md) — stage 1a's code.
  BLOCKED on two. **Both are fixed in the commit below**, along with all three overclaims.

## What to read

Worktree `.claude/worktrees/public-read-improvements`, branch
`worktree-public-read-improvements`. One commit:

    git show 0b0248c
    git show 0b0248c --stat

For context, the two stages already landed and reviewed: `a0859a4` (stage 1a) and `e72aeec` (S2,
the `runInRequest` fix, which you have not seen and may comment on if anything looks wrong).

The plan is
[260902j-public-read-only-access-audit-and-improvements.md](260902j-public-read-only-access-audit-and-improvements.md)
— the amended **C3 bullet under Decisions** is the specification for the first half of this diff,
and the Progress entries at the foot say what landed.

## Half one — C3, built to your Fork 2 answer

`findArticle` (`src/web/App.tsx`) no longer folds a 401 into a 404. A 401 sets a local
`sessionUnconfirmed`, the public route is asked anyway, and the two answers meet on one line:

| owned | public | the reader gets |
|---|---|---|
| 404 | 200 | the shared article, as before |
| 401 | 200 | the shared article, plus a notice, with *Continue signed out* |
| 401 | 404 | `{ kind: "reauth-required" }`, with *Sign in again* |

The notice is a second paragraph inside `SharedNotice` and a `· sign-in unconfirmed` suffix on
`ViewOnlyChip` — the split that file already had. Both actions are one component,
`signOut({ scope: "local" })` then a reload, behind two labels.

Attack, specifically:

1. **Is the state machine right at the edges?** What happens on a 401 followed by a *500* from the
   public route, or a network throw? On a slug that changes mid-flight? On the metadata and tweets
   views, where `sessionUnconfirmed` is threaded separately? Read `resolveAccess`,
   `useArticleAccess`'s guard, and `VisitorArticle`.
2. **Is `sessionUnconfirmed` on the right seam?** It is on the `visitor` arm of `ReaderCapability`
   beside `signedIn`, on the argument that it changes what the page *says* and nothing about what
   may be done. The file's own governing rule is that the visitor arm must have nothing a later edit
   could mistake for a capability. Does this field weaken that?
3. **The narrow-width trade-off, stated at the chip:** at ≤ iPad portrait with a mode band open,
   `.shared-notice` is hidden by `styles.css`, so the *fact* survives on the chip and the *action*
   is unreachable until the reader closes the band. Measured in Chrome at 820px. Is that acceptable,
   or does the action have to survive too — and if it does, where, given that the hidden rule exists
   because the notice collided with the fixed corner logo at `y: 0`?
4. **The two labels.** You caught the first draft calling both of them "sign in again". Check the
   claim behind the fix: signed out at a *shared* `/read/:slug` the reload returns an ordinary
   visitor view, and at an *unshared* one it reaches `LandingPage` with sign-in drawn and the
   address kept. Is either half wrong?
5. **`ClearDeadSessionButton`** — `scope: "local"`, a `catch` around the sign-out with the reload
   outside it, and a dynamic import of the Supabase client. Anything wrong with the failure
   behaviour, or with a reload as the recovery?
6. **The copy**, in `src/messages.ts`. `docs/project/copy.md` is the standard. Does
   `REAUTH_REQUIRED` leak anything about whether the document exists?

## Half two — your stage-1a blockers, fixed

**`BAND_SAYS`.** Your finding was right twice over, and the second reason was worse than the one you
named. Scoping alone was not enough: `outline`'s expected string was the *root's gist*, which is in
the gist columns that mode opens anyway — so I first fixed the `aria-hidden` half, re-ran your
mutation, and it was **still green**. Chasing that found the real cause: **this file's tree fixture
was a single node with no children**, so `outlineProjection` had produced zero rows and Outline had
rendered an empty band in every run this file has ever had.

So the fix is three things: the table carries a **selector** for the band that must be open
(asserted both ways, replacing the `.mode-close` proxy) and a string that must be readable *inside
it*; `readable()` strips `aria-hidden` subtrees; and the fixture's tree gained a child, which
immediately hit a *second* thing the thin fixture had been hiding — `CSS.escape`, which jsdom does
not have and `Reader` calls on any render with sections in it. Polyfilled in the file.

**The method assertion** is now inside both sweeps.

Attack:

7. **Is the fixture change safe and is it enough?** A child node makes `sections` non-empty for the
   first time in this file, so effects that had never run now run. Did anything else in this suite
   quietly start or stop being exercised? Is `CSS.escape → identity` an acceptable stand-in, or does
   it hide a real escaping requirement?
8. **Name a mutation that still passes.** I re-ran yours: emptying Outline's visible `rows.map` is
   red in both sweeps, and making `publicFetch` issue POST is red in both. What else would I miss —
   especially anything where a *visitor* gains a request or loses a boundary?
9. **`VISITOR_BAND`** addresses the visitor's band by `aria-label`. Eight of thirteen modes end
   there. Is that the right handle, or does it make the test agree with the component?

## Evidence

- `npx vitest run` on the six public/visitor suites after merging `origin/dev` — 100 passed.
- The touched suites alone: `public-network-trace` 31/31, and 248/248 across twelve related files.
- `npm run typecheck` clean, all three projects.
- **The full suite is not evidence right now.** This box is at load average ~100 with thirteen
  users; a full run produced 45 failures spread across `pdf-chunk-concurrency`,
  `block-policy-prompts`, `hierarchy-write-guard`, `health-schema` and others this branch does not
  touch, while the same files pass in isolation and in groups. Say if you think that reasoning is
  too convenient.
- The browser pass is described in the plan's stage-1b Progress entry: desktop and 820px, plus the
  `reauth-required` page and a real press of its button.

`file:line`, how you know, ranked. Under ~1500 words. End with a verdict: BLOCKED with the blockers
named, or landed-and-fine with the changes you want.
