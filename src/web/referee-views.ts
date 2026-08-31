/**
 * **Referee mode's four sub-modes, named once, in a module that imports
 * nothing.**
 *
 * Three of them help somebody who has been asked to peer-review a piece —
 * `criteria` is their own criteria run over it, `claims` is what the piece
 * promises against where it delivers, and `mirror` is the model reading *their*
 * review rather than the paper. The fourth, `candidates`, is for the person on
 * the other side of the desk: an **editor** deciding who should review it.
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md.
 *
 * ## Why it is a file of its own, and why it is under src/web/
 *
 * A file of its own so the vocabulary is named once, exactly like src/modes.ts.
 *
 * It sat at `src/referee.ts` for about an hour on 2026-08-31, on the reasoning
 * that a vocabulary a **server** may one day have to read should not live under
 * `src/web/` — which is why src/modes.ts is where it is, the serverless function
 * that composes a shared article's `<title>` having to resolve `?mode=`.
 *
 * That was speculative, and it cost something real. A module outside `src/web/`
 * that `src/web/` imports has to be added to the `SHARED` allowlist in
 * tests/client-imports.test.ts — and that file had another session's uncommitted
 * work in it, so paying an allowlist entry for a need nobody has yet meant
 * either committing their half-finished change or leaving my own test red.
 * Nothing server-side reads the sub-mode: it does not appear in a title, and
 * `?referee=` never reaches src/public/routes.ts.
 *
 * So it lives here, imports nothing anyway, and moves out on the day something
 * on the far side of that line actually needs it — at which point the allowlist
 * entry is one line and buys something.
 *
 * src/web/params.ts re-exports every name, so no component needs to know this
 * file exists.
 */

export const REFEREE_VIEWS = [
  /* **The referee's own criteria, run over the piece.** First because it is the
     one that starts from what the venue asked them to judge, rather than from
     anything a model decided. */
  "criteria",
  /* What the piece promises up front, against the passages that are meant to
     deliver it — structure rather than judgement. */
  "claims",
  /* The inversion: the model reads the referee's own comments, and says things
     about *those*, never about whether the paper is any good. */
  "mirror",
  /* **The odd one out, and it is here because Greg said so.** Who could review
     this paper, and what expertise it would take — an *editor's* question, not a
     referee's, and the plan's appendix had cut it for exactly that reason
     (§ Appendix — ideas considered and not picked: it serves a different user,
     and a plausible name with a real URL is the thing a model hallucinates
     best). Greg overruled the cut on 2026-08-31. It stays last in the list
     because the first three are one person's job and this is somebody else's. */
  "candidates",
] as const;
export type RefereeView = (typeof REFEREE_VIEWS)[number];

/**
 * Which sub-mode a reader lands in.
 *
 * `criteria`, because it is the only one a referee can use before they have
 * done anything: Claims needs the piece read for it, Mirror needs comments to
 * read, and Candidates is not a referee's question at all.
 */
export const DEFAULT_REFEREE_VIEW: RefereeView = "criteria";

/**
 * **Is this string one of the four?**
 *
 * An unrecognised value is not an error: `refereeParam` parses it to the
 * default, so a link from a future version — or from a past one naming a
 * sub-mode since renamed — opens the mode rather than a broken page. That is
 * the rule every parser in src/web/params.ts follows, and `isMode` in
 * src/modes.ts is the same function one level up.
 */
export function isRefereeView(value: string | null | undefined): value is RefereeView {
  return (
    value !== null && value !== undefined && (REFEREE_VIEWS as readonly string[]).includes(value)
  );
}
