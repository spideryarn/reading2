---
reports: spya-jjsta2
ending: shipped
---
# Opening Trajectory should take you to its first stop

[SPIDERYARN-READING2-4K](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4K) (2026-09-29
00:54 UTC), from an admin (Greg), in production, build `cba650a3`, in Trajectory on
`arxiv-2212-spya-u5293w` (overseer queue `qi-hmsgxajb`, batched with 4D, 4M and 4N).

> When I activate Trajectory mode, it should be easier to trigger a jump to the first Step. e.g.
> press Left (even if I'm already on Step 1) should jump to the Step 1 block. Perhaps activating
> Trajectory mode should automatically jump to the first step. Yes, I think that would make sense.
> In that case, then show one of the little "Back to ..." buttons in case that wasn't what the user
> wanted (as per Glossary). P.S. make sure that that "Back to ..." functionality is documented and
> that we use that back-to widget anywhere else that might be appropriate/useful for the user.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4K (this session runs on the pool account,
with no Sentry sign-in, so the next feedback sweep does the status write).

What we did:

- **Opening Trajectory jumps to its stop**, and it is a real jump, so the **↩ Back to …** chip
  appears if that was not what you wanted. It happens when you switch into the mode by pressing
  something, or open a Trajectory link that names no stop and no position. It does *not* happen when
  Back or Forward lands you in Trajectory — that restores where you were. The jump adds one history
  entry after the mode's own, so the first Back returns you to where you were with Trajectory still
  open, and the second leaves the mode.
- **One choice made for you, easy to reverse:** the jump goes to the band's *current* stop. On a
  fresh opening that is stop 1. If you had walked to stop 4, switched to Glossary and come back, the
  address still says stop 4 and the band reopens there, so the jump goes to stop 4 rather than
  throwing away your place. Say if you would rather it always went to stop 1 — it is a one-line
  change.
- **← on stop 1 goes to stop 1's passage again**, and so does the band's ‹, which reads *Back to
  stop 1* there.
- **The "Back to …" chip is documented.** Its mechanism already had three sections in
  [url-state.md](../project/url-state.md#the-pushed-entry-says-where-you-came-from); what was missing
  was a pointer from the map of the reading view, which now says what it is and when it appears
  ([reading-view-overview.md](../project/reading-view-overview.md) § Hovering and moving around).
- **Used anywhere else useful:** we audited every way the app moves you through the article. Every
  block link in every mode already goes through the one jump that draws the chip (the audit of
  report 41 found the same, and nothing has changed since). Opening Trajectory is the one new place.
  The things that move you *without* it do so on purpose: ↑ / ↓ and swipes are short steps; the
  comment dialog's ‹ › and Trajectory's own steps keep the chip pointing at where the walk *began*,
  rather than one step back.

Plan: [260929a](../plans/260929a-trajectory-opens-on-stop-one-two-end-of-pass-doors-centred-jumps-compact-position.md) § 1 and § 5.
