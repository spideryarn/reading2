/**
 * **What a visitor is told when they press a mode they cannot have** — and
 * which of the three sentences it is.
 *
 * "Visitor" means anyone who does not own the document: signed out, or signed
 * in and reading somebody else's. Keyed on *is this mine*, never on *am I
 * signed in* — docs/plans/260827ai-public-read-only-access.md.
 *
 * ## Why this is a pure function in its own file
 *
 * Because the whole risk here is the four sentences quietly becoming one. The
 * worked example is Notion: unpublishing a page makes every old link land on a
 * plain *"page could not be found"*, so never existed, was unshared and you may
 * not see it are all answered identically, and the visitor learns nothing. The
 * products that get it right name the cause.
 * docs/research/260828a-public-access-how-others-do-it.md.
 *
 * These live in the reading view, in the comments drawer and on a whole page of
 * its own, so there is no single component that renders them all and could be
 * tested for telling them apart. A function can be — tests/visitor-gaps.test.ts
 * sweeps every mode against every artefact and asserts the sentences are
 * distinguishable.
 *
 * **Since slice 1b the commonest answer is `null`.** A visitor gets the
 * glossary, the ideas, the quotes and the tweet thread, so the question this
 * file answers is no longer *which excuse* but *is there anything in the way at
 * all* — and for three of the eight modes, on an article that has them, there
 * is not.
 *
 * The sentences themselves are in src/messages.ts, like every other sentence a
 * reader sees. This file decides *which*.
 */
import type { PublicArtefacts } from "../public-types.js";
import { notBuiltYet, ownersOnly, readersOwnWork } from "../messages.js";
import { MODES, type Mode } from "./params.js";

/**
 * Why this mode is not available here.
 *
 * **Three members since slice 1b, and it used to be five.** The discriminant is
 * the *cause* rather than the remedy, and what is left are three causes rather
 * than two causes and two uncertainties:
 *
 *  - `not-yet-public` said *it exists, and a shared link does not carry it yet*.
 *    Slice 1b is what carries all four artefacts, so nothing can produce it any
 *    more, and a union member with no cause is a sentence waiting to be shown
 *    by mistake.
 *  - `availability-unknown` said *we could not find out whether it exists*. It
 *    existed because the flags came from a **second** request that could fail
 *    on its own. The artefacts are in the article payload now, so either that
 *    payload arrived — and we know exactly what it holds — or it did not, and
 *    the reader never reaches a mode at all, because the page renders *this
 *    document isn't shared* or an error instead.
 *
 * Deleting a defensive state deserves more suspicion than adding one, so the
 * claim is written narrowly and it is checkable: **there is no path on which a
 * visitor is rendering a mode and does not know whether its artefact exists.**
 * `visitorGap` takes a non-optional `PublicArtefactSet` now, so the compiler
 * asks the same question of every future caller.
 */
export type VisitorGap =
  /** The pipeline never ran for this piece. Nobody's fault. */
  | { kind: "not-built"; noun: string }
  /** It works, it costs a model call, and it is the owner's. */
  | { kind: "owners-only"; feature: string }
  /** It is the owner's own annotation, and sharing an article does not share it. */
  | { kind: "readers-own"; plural: string };

/**
 * **The one answer about an artefact, and `null` is now one of the two.**
 *
 * Before slice 1b this had three answers and none of them was "you can have
 * it": every artefact was withheld, and the only question was which true
 * sentence to say about the withholding. Now the flag decides whether there is
 * a gap at all — a piece that has a glossary shows its glossary, and `null`
 * means nothing stands in the way.
 *
 * One function because three call sites need it: the two artefact modes and the
 * tweets *page*, which had a hardcoded gap constant and so claimed a thread
 * existed even when the wire said `tweets: false`. GPT Sol, 2026-08-28.
 */
function artefactGap(has: keyof PublicArtefacts, available: PublicArtefacts): VisitorGap | null {
  return available[has] ? null : notBuiltGap(has);
}

/**
 * **The noun phrase each artefact is called in a sentence, article included.**
 *
 * One table, so that the tweet thread on its own page and the three modes in
 * the reading view cannot end up calling the same thing two names.
 */
const NOUN: Record<keyof PublicArtefacts, string> = {
  arc: "an arc through the argument",
  glossary: "a glossary",
  ideas: "a list of ideas",
  quotes: "a set of quotes",
  tweets: "a tweet thread",
};

/**
 * *Nobody has built one of these yet*, for a caller that has already
 * established the artefact is absent.
 *
 * **`VisitorTweetsPage` is the one caller, and this replaced a `tweetsGap`
 * that took the five booleans.** The tweets page has to branch on the artefact
 * key anyway — it renders the thread when there is one, and TypeScript will not
 * narrow `artefacts.tweets` from the return value of a policy function — so a
 * `tweetsGap` beside that branch would have been a second answer to a question
 * already decided, which is exactly the shape GPT Sol caught on 2026-08-28
 * when a constant claimed a thread the wire said was absent. Branching on the
 * key and taking the sentence from the table below is one fact and one wording.
 * src/web/PublicPages.tsx.
 */
export function notBuiltGap(what: keyof PublicArtefacts): VisitorGap {
  return { kind: "not-built", noun: NOUN[what] };
}

/** Which of the flags each artefact mode asks about. */
const ARTEFACT: Partial<Record<Mode, keyof PublicArtefacts>> = {
  glossary: "glossary",
  ideas: "ideas",
  quotes: "quotes",
};

/** The modes that spend, and what the button that opens them is called. */
const COSTS: Partial<Record<Mode, string>> = {
  search: "Search",
  chat: "Chat",
  remember: "Remember",
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
  /**
   * **Timeline is owners-only in v1, stated rather than defaulted into.**
   *
   * The fall-through below would have made it owners-only anyway, which is
   * exactly why it is named here: a mode that is private because nobody listed
   * it and a mode that is private because somebody decided so are
   * indistinguishable in the code, and the second is what this is. Greg,
   * 2026-08-31: *"it would be nice to have the option for this to be
   * Public-readable, but that could be a follow-up"* — and doing it properly
   * wants a general answer for all the modes rather than a fifth hand-written
   * table, so it is a separate piece of work.
   *
   * It is in `COSTS` rather than `ARTEFACT` because there is no
   * `PublicArtefacts` flag to read: a shared payload carries no timeline at
   * all. The sentence a visitor gets is therefore *this belongs to whoever
   * added the article*, which is true, rather than *nobody has built one*,
   * which we cannot know from here.
   * docs/plans/260831i-timeline-mode.md § Making a mode public-readable.
   */
  timeline: "Timeline",
};

/**
 * What stands between this visitor and this mode, or `null` if nothing does.
 *
 * `available` is **not optional**, and that is the whole of slice 1b's claim
 * about the deleted `availability-unknown`. It used to be
 * `PublicArtefacts | null`, where `null` meant *the second request did not
 * land*; there is no second request, so the five flags are derived from the
 * article payload the page is already rendering and there is nothing to be
 * unsure about. A caller who does not have a payload does not have a page
 * either. src/web/public-artefacts.ts.
 */
export function visitorGap(mode: Mode, available: PublicArtefacts): VisitorGap | null {
  /* **Plain is the article and nothing else**, so there is nothing here a
     visitor could be short of: no artefact is read, no model call is made, and
     the prose is the payload they already hold. Named by hand rather than left
     to the fall-through for the reason Outline had to be — the fall-through is
     fail-closed, and the mode after next will be owners-only until somebody
     says otherwise. */
  if (mode === "plain") return null;

  /* The table of contents, the granularity zoom and the spine are the whole
     point of the feature and cost nothing: they are drawn from the tree in the
     payload the visitor already has. */
  if (mode === "hierarchy") return null;

  /* Outline is the same bargain and had to be named to get it. The fall-through
     below is deliberately fail-closed, so a mode added later is owners-only
     until somebody says otherwise — which meant the plan's claim that this mode
     "costs nothing, so a visitor gets it" was the *intent* and false in the
     code. GPT Sol's review, 2026-08-28. It draws the same tree from the same
     payload the visitor already holds, and reaches no artefact at all: without
     arc.json it simply skips the arc rung. */
  if (mode === "outline") return null;

  /* And summary, since 2026-08-31. It used to be an `ARTEFACT` mode, gated on a
     `summary.json` a visitor's payload might not carry. The generated ladder is
     gone (docs/plans/260831s-gist-only-summaries.md) and what the panel draws now is the
     tree's own gists, which are in the payload the visitor already holds — so
     there is nothing left to be missing. */
  if (mode === "summary") return null;

  const costs = COSTS[mode];
  if (costs) return { kind: "owners-only", feature: costs };

  const artefact = ARTEFACT[mode];
  if (artefact) return artefactGap(artefact, available);

  /* Not reachable today — `Mode` is closed and every member is in one of the
     tables above. It is here rather than as a non-null assertion because a mode
     added later must fail closed: a visitor sees a boundary they can read
     rather than a band that renders nothing. */
  return { kind: "owners-only", feature: mode };
}

/** The same question for the two things that are not modes. */
export const COMMENTS_GAP: VisitorGap = { kind: "readers-own", plural: "Comments" };

/**
 * Which mode buttons in the bottom bar are drawn dimmed, **and the sentence
 * each one will show when pressed.**
 *
 * A map rather than a set since 2026-08-28, and the value is the whole reason:
 * the bar's tooltip used to carry a line of its own — *"Not carried on a shared
 * link — press for why"* — a few words off the band's *"a shared link does not
 * carry it yet"*. One fact, two sentences, two files. A browser pass read it as
 * copy that had drifted, which is exactly what it was. Handing the tooltip the
 * band's own sentence makes drift impossible rather than unlikely, and turns
 * the tooltip into a preview of the thing the press will open.
 *
 * **Derived from `MODES` rather than listed**, which is the whole reason it is
 * a function and not a constant: a mode added next month is marked for a
 * visitor whether or not whoever adds it remembers this file. And it is derived
 * from the flags too, so an artefact this piece **has** is not marked at all —
 * since slice 1b a visitor can open the glossary, the quotes and the ideas,
 * and a dimmed button over a band that works would be the worst of both. That is the same
 * rule the admin check in src/routes.ts states about itself — *"so a route
 * added later is behind this check whether or not whoever adds it remembers,
 * which is the only version of this that stays true"* — and it fails closed,
 * because `visitorGap` answers with a boundary for anything it does not
 * recognise.
 */
export function markedModes(available: PublicArtefacts): ReadonlyMap<Mode, string> {
  const marked = new Map<Mode, string>();
  for (const mode of MODES) {
    const gap = visitorGap(mode, available);
    if (gap) marked.set(mode, visitorSentence(gap));
  }
  return marked;
}

/** The gap, as the sentence the visitor reads. src/messages.ts owns the words. */
export function visitorSentence(gap: VisitorGap): string {
  switch (gap.kind) {
    case "not-built":
      return notBuiltYet(gap.noun);
    case "owners-only":
      return ownersOnly(gap.feature);
    case "readers-own":
      return readersOwnWork(gap.plural);
  }
}

/**
 * Whether making an account is what fixes this.
 *
 * The sign-up line goes beside the specific thing the visitor has just found
 * they could not do — that is the whole placement rule — so it must not appear
 * beside a gap an account does not close. Comments are the one left: they
 * belong to whoever added the article, and until
 * docs/plans/260827ai-public-read-only-access.md § Stage 3 an account does not change
 * that.
 *
 * The two entries that used to be `false` for the other reason — *we are the
 * ones who have not shipped it* — went with their union members in slice 1b.
 *
 * A total map rather than a comparison, for the reason `RETRYABLE` in
 * src/messages.ts gives: a fourth kind is then a red compile rather than a
 * silent `false`.
 */
const FIXED_BY_AN_ACCOUNT: Record<VisitorGap["kind"], boolean> = {
  "not-built": true,
  "owners-only": true,
  "readers-own": false,
};

export function anAccountWouldHelp(gap: VisitorGap): boolean {
  return FIXED_BY_AN_ACCOUNT[gap.kind];
}
