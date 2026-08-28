/**
 * **What a visitor is told when they press a mode they cannot have** — and
 * which of the four sentences it is.
 *
 * "Visitor" means anyone who does not own the document: signed out, or signed
 * in and reading somebody else's. Keyed on *is this mine*, never on *am I
 * signed in* — docs/plans/public-read-only-access.md.
 *
 * ## Why this is a pure function in its own file
 *
 * Because the whole risk here is the four sentences quietly becoming one. The
 * worked example is Notion: unpublishing a page makes every old link land on a
 * plain *"page could not be found"*, so never existed, was unshared and you may
 * not see it are all answered identically, and the visitor learns nothing. The
 * products that get it right name the cause.
 * docs/research/public-access-how-others-do-it.md.
 *
 * Three of these live in the reading view and one is a whole page, so there is
 * no single component that renders all four and could be tested for telling
 * them apart. A function can be — tests/visitor-gaps.test.ts sweeps every mode
 * against both answers `PublicMetadata.available` can give and asserts the four
 * are distinguishable.
 *
 * The sentences themselves are in src/messages.ts, like every other sentence a
 * reader sees. This file decides *which*.
 */
import type { PublicArtefacts } from "../public-types.js";
import { notBuiltYet, notOnSharedLinksYet, readersOwnWork, signedInOnly } from "../messages.js";
import { MODES, type Mode } from "./params.js";

/**
 * Why this mode is not available here.
 *
 * Four members, and the discriminant is the *cause* rather than the remedy —
 * two of them are fixed by making an account, one by us shipping slice 1b, and
 * one by nothing at all, because it is a boundary rather than a gap.
 */
export type VisitorGap =
  /** The pipeline never ran for this piece. Nobody's fault; an account is how you get one. */
  | { kind: "not-built"; noun: string }
  /** It exists, and slice 1b has not shipped the public endpoint that would carry it. */
  | { kind: "not-yet-public"; noun: string }
  /** It works, it costs a model call, and an account is genuinely the way to have it. */
  | { kind: "signed-in-only"; feature: string }
  /** It is the owner's own annotation, and sharing an article does not share it. */
  | { kind: "readers-own"; plural: string };

/** The noun phrase each artefact mode is called in a sentence, article included. */
const ARTEFACT: Partial<Record<Mode, { noun: string; has: keyof PublicArtefacts }>> = {
  summary: { noun: "a summary", has: "summary" },
  glossary: { noun: "a glossary", has: "glossary" },
  ideas: { noun: "a list of ideas", has: "ideas" },
};

/** The modes that spend, and what the button that opens them is called. */
const COSTS: Partial<Record<Mode, string>> = {
  search: "Search",
  chat: "Chat",
  review: "Review",
  /**
   * **Diagram is here rather than under `ARTEFACT`, and it is the one judgement
   * call in this table.**
   *
   * The band itself fetches nothing — the default picture is drawn from the
   * tree that is already on the page, and a visitor could have it for free. But
   * `DiagramPanel` mounts `useSimilar` and `useProjection` for its other two
   * pictures, both of which are POSTs that embed and therefore spend, so a
   * visitor who pressed *graph* would issue exactly the request the acceptance
   * test for this slice forbids.
   *
   * Carving the free picture out of a 1700-line panel is real work and it is
   * not slice 1a's. Marked whole, deliberately, and recorded here rather than
   * discovered later. 2026-08-28.
   */
  diagram: "Diagram",
};

/**
 * What stands between this visitor and this mode, or `null` if nothing does.
 *
 * `available` is `PublicMetadata.available`, or `null` when that fetch did not
 * land. **A missing answer must not become a claim about somebody's article**:
 * without the flags this says *not on shared links yet*, which is
 * unconditionally true in slice 1a whatever the flag would have said, rather
 * than *nobody has built one*, which would be a statement about the world made
 * from a failed request. docs/reusable/silent-success.md.
 */
export function visitorGap(mode: Mode, available: PublicArtefacts | null): VisitorGap | null {
  /* The table of contents, the granularity zoom and the spine are the whole
     point of the feature and cost nothing: they are drawn from the tree in the
     payload the visitor already has. */
  if (mode === "toc") return null;

  const costs = COSTS[mode];
  if (costs) return { kind: "signed-in-only", feature: costs };

  const artefact = ARTEFACT[mode];
  if (artefact) {
    if (available && !available[artefact.has]) return { kind: "not-built", noun: artefact.noun };
    return { kind: "not-yet-public", noun: artefact.noun };
  }

  /* Not reachable today — `Mode` is closed and every member is in one of the
     tables above. It is here rather than as a non-null assertion because a mode
     added later must fail closed: a visitor sees a boundary they can read
     rather than a band that renders nothing. */
  return { kind: "signed-in-only", feature: mode };
}

/** The same question for the two things that are not modes. */
export const COMMENTS_GAP: VisitorGap = { kind: "readers-own", plural: "Comments" };
export const TWEETS_GAP: VisitorGap = { kind: "not-yet-public", noun: "a tweet thread" };

/**
 * Which mode buttons in the bottom bar are drawn dimmed.
 *
 * **Derived from `MODES` rather than listed**, which is the whole reason it is
 * a function and not a constant: a mode added next month is marked for a
 * visitor whether or not whoever adds it remembers this file. That is the same
 * rule the admin check in src/routes.ts states about itself — *"so a route
 * added later is behind this check whether or not whoever adds it remembers,
 * which is the only version of this that stays true"* — and it fails closed,
 * because `visitorGap` answers with a boundary for anything it does not
 * recognise.
 */
export function markedModes(available: PublicArtefacts | null): ReadonlySet<Mode> {
  const marked = new Set<Mode>();
  for (const mode of MODES) if (visitorGap(mode, available)) marked.add(mode);
  return marked;
}

/** The gap, as the sentence the visitor reads. src/messages.ts owns the words. */
export function visitorSentence(gap: VisitorGap): string {
  switch (gap.kind) {
    case "not-built":
      return notBuiltYet(gap.noun);
    case "not-yet-public":
      return notOnSharedLinksYet(gap.noun);
    case "signed-in-only":
      return signedInOnly(gap.feature);
    case "readers-own":
      return readersOwnWork(gap.plural);
  }
}

/**
 * Whether making an account is what fixes this.
 *
 * The sign-up line goes beside the specific thing the visitor has just found
 * they could not do — that is the whole placement rule — so it must not appear
 * beside the one gap an account does not close. A `not-yet-public` artefact
 * waits on us shipping slice 1b, and offering an account for it would be a
 * promise we would break the moment they took it.
 *
 * A total map rather than a comparison, for the reason `RETRYABLE` in
 * src/messages.ts gives: a fifth kind is then a red compile rather than a
 * silent `false`.
 */
const FIXED_BY_AN_ACCOUNT: Record<VisitorGap["kind"], boolean> = {
  "not-built": true,
  "not-yet-public": false,
  "signed-in-only": true,
  "readers-own": false,
};

export function anAccountWouldHelp(gap: VisitorGap): boolean {
  return FIXED_BY_AN_ACCOUNT[gap.kind];
}
