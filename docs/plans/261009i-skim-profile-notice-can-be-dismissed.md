# Skim's "planned before your profile" notice can be dismissed

Report `spya-ud2w92` (#502), Sentry `SPIDERYARN-READING2-FD`, queue item `qi-rpfba2td`. Filed by
Greg (admin; `feedback-reporter.ts` exit 0) on 2026-10-09 01:08 UTC from Skim on
`arxiv-1706-03762-spya-wyt7j0`, kind *suggestion*.

> Sometimes the mode shows a message saying "This route was planned before your profile said what
> it says now."
>
> I think that's helpful, but there should be a way to dismiss it if I decide that I actually don't
> care and I don't want to plan it again.
>
> — Greg, 2026-10-09

The brief adds: if other modes show the same notice, consider one shared dismiss; store when a
dismissal happened (AGENTS.md § Writing code, *Store when it happened*).

## What is there now

`bannerReason` (src/web/SkimPanel.tsx) draws a `gloss-stale` banner with a *Plan it again* button
for two reasons: the Quotes/Ideas/outline moved under the route (`stale`), or the reader's profile is
not the one the route was planned for (`profileChanged`, from `routeProfileIsStale` in
`GET /api/skim/:slug`). The second is the one Greg wants to send away.

**Other modes.** Skim is the only mode that turns a changed profile into a banner with a call to
action. Every other personalised mode says it with the small `<WrittenForYou>` icon (UserRoundPen, a
card on hover), which is a label rather than a notice and takes no room. Illustrated is the nearest
thing: one sentence, *"It was painted from a Sketch drawn before your profile said what it says
now"*, joined into its grey `ill-note` line with the plate's other facts. **It is left alone**: it is
about the Sketch rather than the picture on screen, it shares one line with facts that are not
dismissible, it offers no button and claims no room of its own, and Greg's report is about the Skim
banner. Considered for "one shared dismiss" and declined for those reasons; if a second banner like
Skim's ever appears, the columns below move to a table keyed by mode then.

`stale` is **not** dismissible: a route over Quotes that have moved can point at stops that no longer
exist, so its banner is a real fault, not a preference.

## The change

1. **An × on the banner, only when the reason is the profile.** Pressing it hides the banner at once
   (optimistic) and records the dismissal. *Plan it again* stays beside it, and the Skim row in
   Metadata still re-plans.
2. **Two columns on `articles`**, beside the other per-owner reader state (shelf state, `purpose`),
   rather than a table: there is exactly one Skim route per article, so a table keyed on
   `(article_id, mode)` with only `skim` allowed would model one row per article at the cost of a
   store, a cascade, and a dozen registries (GPT Sol's plan review, finding 2).

   | column | |
   |---|---|
   | `skim_profile_notice_dismissed_for` text null | the notice the reader sent away: `<route generatedAt> <profile hash or "none">` |
   | `skim_profile_notice_dismissed_at` timestamptz null | when — set again on every dismiss |

   **The dismissal holds only for that route and that profile.** The route's `generatedAt` is its
   identity (every run of the stage re-stamps it — useSkim.ts § the hold), so a re-plan always
   brings the notice back once it goes out of date again, even under a profile hash seen before. A
   first version keyed on the route's *profile hash* missed exactly that: planned for A, profile B,
   dismiss, back to A, re-plan (still A), then B again — the old dismissal would hide the new
   route's notice (Sol, finding 1). The reader's current hash is in the key too, so a further profile
   change, which has something new to say, brings it back. `none` stands for "no profile", so a
   first profile and a cleared one are both ordinary keys.
3. **`POST /api/skim/:slug/profile-notice-dismissal`**, body `{ generatedAt }` — the route the
   reader was looking at — owner only (`articleIdForOwned`, so a stranger's slug is a 404). The
   **server** computes the reader's profile hash and reads the current route. No route → 404. A body
   whose `generatedAt` is not the current route's → 409 (a re-plan landed in another tab; the
   client reads again). Route and profile agree → 204 and nothing written (nothing to dismiss is an
   idempotent success, Sol finding 4). Otherwise it writes both columns and answers 204.
   `GET /api/skim/:slug` gains `profileNoticeDismissed`, true when `profileChanged` and the stored
   key equals the current one.
4. **Client.** `UseSkim` gains `profileNoticeDismissed` and `dismissProfileNotice()`.
   `bannerReason` returns null for the profile reason when it is dismissed. The foot's gate, which
   today reads `!owner.profileChanged` so as not to duplicate the banner's button, reads "no banner"
   instead, so a job started from Metadata after a dismissal still shows its progress in the foot.
   `PurposeLine`'s `bannerUp` already reads `bannerReason`. **A failed POST does not simply put the
   banner back**: the write may have committed before the connection failed, so it reads the route
   again and lets `profileNoticeDismissed` decide, and says it could not be sent only if the read
   shows it was not (useGlossary.ts's hide does the same).
5. **Export and registries**: the columns are on `articles`, so they go out with the article row;
   the schema-drift, export-coverage, created-at and route-contract tests say what else must hear
   of them.
6. **Docs.** `skim.md` gets a sentence; the help page if it describes the banner.

## Simpler options passed over

- **localStorage per article.** No migration, no route. Passed over because Greg asked for the time
  to be stored, and because it would not follow the reader to their phone, which is exactly where a
  banner costs the most room.
- **Rewrite the route's stamp to the current profile hash on dismiss** ("adopt" the profile). One
  write, no column — but the stamp would then say the route was planned for a profile it was not,
  which every other reader of `profileHash` (export, Metadata, a future badge) would believe.
- **Dismiss forever, for every article.** Greg's words are about one route he does not care to
  re-plan, not about the notice as a whole.
- **A shared table across modes** — above; no second mode has a banner to dismiss.

## Tests

- Route: dismiss then read → `profileNoticeDismissed: true`; change the profile → false; change it
  back → true again; re-plan → false (even under a hash seen before); first profile and cleared
  profile both dismiss; stranger's slug → 404; nothing changed → 204 and no write; an old
  `generatedAt` → 409; a second dismiss moves `dismissed_at` forward.
- `bannerReason`: profile + dismissed → null; stale + dismissed → the stale sentence.
- A component test that the × shows only for the profile reason and hides the banner.

Seen in a browser at desktop and 390px width once built.

## Built, and GPT Sol's code review

Built as above ([review](261009i-skim-profile-notice-code-review-sol.md), verdict *land with
fixes*). What came of its three findings:

1. **A read already in flight could undo the × for a moment, and after moving to another article
   the write's trailing read would have read the old one.** Both real. Sol fixed them with a ~70-line
   state machine in `useSkim`; that was replaced with a smaller fix that keeps its tests: a ref for
   the write in flight, which a read honours until the write's own trailing read lands, a count of
   answered reads so the × can tell whether one landed after its write, and a slug check before the
   trailing read. **One behaviour differs from Sol's on purpose**: when the write fails *and* the
   read after it cannot answer either, the banner comes back with the reason, rather than staying
   hidden on a dismissal nothing confirmed (`tests/use-skim-profile-notice-dismissal.test.tsx`).
2. **The rollback export dropped the two columns** — `shelf.json` is a hand-written projection.
   Sol added them, with a test. (The reader's own download, `export-bundle.ts`, already took every
   column.)
3. **`profileNoticeKey` had no direct test** — added in `tests/skim.test.ts`.

The local migrate on the shared Supabase was blocked by another tree's
`20261009053445_chat_messages_truncated`, applied from a draft whose hash no committed version has.
Its postcondition (`chat_messages.truncated boolean not null default false`) was probed and the
ledger row restamped, per [database.md § Rule 4 on a
laptop](../project/database.md#rule-4-on-a-laptop-the-draft-that-ran-and-the-file-that-was-committed).
