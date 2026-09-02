# Two forks found while building 260902j, before the stages are cut

**Date:** 2026-09-02. **Asked of:** GPT Sol. **Mode:** read-only — do not edit files, do not run
state-changing git commands. Working tree: the worktree
`.claude/worktrees/public-read-improvements`, branch `worktree-public-read-improvements`, cut from
`dev` at `23b3719`.

You reviewed the plan
[260902j-public-read-only-access-audit-and-improvements.md](260902j-public-read-only-access-audit-and-improvements.md)
this morning and returned BLOCKED on three points; all three were folded in and the plan is now
"ready to build, stage 1 first". Stage 1 (Cluster A: C1–C4) is being built now. Two forks have come
up that the plan does not settle, and I want a second opinion before I commit to either. Both are
engineering calls rather than product calls, so I am not taking them to Greg.

Read the plan first — the Findings tables, the Decisions section, and Tier 1 Cluster B.

---

## Fork 1 — the metadata route is not callerless

Your input answer found `GET /api/public/metadata/:slug` had no caller and recommended deleting it.
The plan adopted that as Cluster B, stage 2, with a counted ledger of 16 files and 53 references.

**The ledger swept `src/`, `tests/` and `docs/`. It did not sweep `scripts/`.** There is a caller:

    scripts/check-public-shell.ts

It is a hand-run, curl-only verification of a deployed `/read/:slug` — not wired into any npm
script, not part of `npm test`. Read these parts of it:

- the file header (what it is for, and what it deliberately cannot check);
- `judgeTitleAgainstMetadata` (~line 297) and its rationale comment;
- `fetchMetadataTitle` (~line 848);
- `checkPublicHead` (~line 869).

The load-bearing sentence is in `judgeTitleAgainstMetadata`'s comment:

> `GET /api/public/metadata/:slug` is an independent, already-public source of truth for the
> article's title — assembled by the same server, but not by the same code path that composes the
> head, so agreement between them means something. Checking only "not the bare default" (the old,
> weaker version of this check) would pass a head built from the wrong article, or a stale cache:
> any non-default string satisfies it.

So the route has a real, deliberate, documented use: it is the second opinion that makes the
deployed head check mean anything. That is exactly the property `docs/reusable/silent-success.md`
exists to protect, and deleting the route without replacing it would downgrade the check to the
weak version it was written to replace.

**What I think, and want you to attack:** delete the route anyway, and repoint
`fetchMetadataTitle` at `GET /api/public/article/:slug`, reading `meta.title`. My reasoning:

- The independence is *of code path*, not of value. `loadMetadata` builds its title at
  `src/store/public-reader.ts:491` as `row.title ?? row.headingTitle ?? row.slug`; `loadArticle`
  builds `meta.title` at `src/public/dto.ts:121` with the identical expression; `loadHead` is a
  third function. Repointing at the article route keeps a different code path from `loadHead`, which
  is the whole property the comment claims.
- The blank-title downgrade path in `judgeTitleAgainstMetadata` is unaffected.
- Cost: the check fetches ~200KB instead of a few hundred bytes, in a script a human runs a handful
  of times after a deploy. That looks like a fair price for one fewer route in the one namespace
  with no auth gate.

Questions:

1. Is repointing at the article route genuinely as independent, or am I fooling myself — is there a
   sense in which `loadArticle` and `loadHead` share more than `loadMetadata` and `loadHead` do?
   Check `loadHead` at `src/store/public-reader.ts:551` and say what it actually shares with each.
2. Is there a third option better than both — for instance keeping the route but making the
   disagreement the tests preserve (metadata accepts a tree with no blocks; article and head refuse
   one) into an agreement, so the route stops being a semantic outlier?
3. If you still say delete: does anything else in `scripts/` reference the public surface in a way
   the audit's ledger missed? I swept `scripts/` for the five metadata identifiers only.
4. If you now say keep: the plan's Cluster B loses most of its content. What should stage 2 be
   instead — just the `runInRequest` fix and the false comments — and does that still deserve to be
   its own stage?

---

## Fork 2 — C3 takes something away from a signed-in visitor

The agreed C3 fix: `findArticle` in `src/web/App.tsx` (~line 617) falls back to the public route on
404 **only**; a final 401 resolves to a new `{ kind: "reauth-required" }` member of `ArticleAccess`,
rendered with a user-initiated sign-in-again action.

The case the plan describes is an **owner** whose token cannot be refreshed being silently
reclassified as a visitor over their own article. That is the bug and the fix is right for it.

But `findArticle` only asks the owned route at all when `signedIn`, and the 401 arm therefore also
catches a different reader: **a signed-in person reading somebody else's public article** whose own
token has died. Today they see the shared article, because the 401 falls through to the public
route and the public route needs no token. After the fix they see "sign in again" instead — a page
they cannot read, for an article that is world-readable, because of a session that has nothing to do
with it.

That reader is, in the feature's own words, *"the likeliest first real use of the feature: somebody
with an account follows a colleague's link"* (`tests/public-network-trace.test.tsx`, the
signed-in-visitor describe block).

Three options I can see:

- **A. As planned.** A 401 is *we do not know whose this is*, and answering that honestly is worth
  more than the edge. Simplest; one new state.
- **B. Ask the public route as well, then decide.** On a 401, try the public route: if it answers,
  render the public article **and** a quiet band saying the session could not be confirmed with the
  sign-in-again action in it; if it 404s, `reauth-required`. Costs one extra request on a path that
  is already failing, and puts a second control on the reading view.
- **C. As planned, but the `reauth-required` page carries a "read the shared version" link** that
  re-resolves with `signedIn` forced false. No extra request unless pressed.

I lean A on "simplest version first", and I am uneasy that A makes a public article unreadable to
somebody who could read it while signed out. Which, and why? If A, is there anything the
`reauth-required` copy must say so that reader is not simply stuck?

Note two constraints on any answer:

- `apiFetch` (`src/web/lib/api.ts:400`) already refreshes once and retries once, and its comment is
  explicit that a 401 must not sign the reader out. So whatever we render must be *user-initiated*.
- A plain link to `/login` bounces a signed-in reader to the shelf (`src/web/App.tsx:415`) — you
  found that this morning. The action I am planning is `supabase.auth.signOut({ scope: "local" })`
  followed by a hard reload of the current URL, which drops the dead token and lands the reader
  back on this address with the app's normal sign-in in front of them. Say if that is wrong.

---

`file:line`, how you know, ranked, under ~1200 words. End with a clear call on each fork.
