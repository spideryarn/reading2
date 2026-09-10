/**
 * **What a visitor is told when they press a mode they cannot have** — and
 * which of the sentences it is.
 *
 * "Visitor" means anyone who does not own the document: signed out, or signed
 * in and reading somebody else's. Keyed on *is this mine*, never on *am I
 * signed in* — docs/plans/260827ai-public-read-only-access.md.
 *
 * ## Why this is a pure function in its own file
 *
 * Because the whole risk here is these sentences quietly becoming one — the
 * number of them has changed four times and a count written into prose goes
 * stale silently, so there is no longer one here. The
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
 * all* — and for the modes those artefacts serve, on an article that has them,
 * there is not. `POLICY` below is the list, mode by mode; a count here would
 * only go stale the next time a mode is added, and had.
 *
 * The sentences themselves are in src/messages.ts, like every other sentence a
 * reader sees. This file decides *which*.
 */
import type { PublicArtefacts } from "../public-types.js";
import { notBuiltYet, ownersOnly } from "../messages.js";
/* The one name each mode has. The owners-only policy below carries no string of
   its own precisely because this record exists and is total — see `POLICY`. */
import { MODE_LABEL } from "../title-text.js";
import { MODES, type Mode } from "./params.js";

/**
 * Why this mode is not available here.
 *
 * **Two members since 2026-09-08; it was three, and before slice 1b it was
 * five.** The discriminant is the *cause* rather than the remedy, and what is
 * left are two causes rather than causes mixed with uncertainties:
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
  | { kind: "owners-only"; feature: string };

/**
 * **The noun phrase each artefact is called in a sentence, article included.**
 *
 * One table, so that the tweet thread on its own page and the three modes in
 * the reading view cannot end up calling the same thing two names.
 *
 * **Exported since 2026-09-02**, because the visitor's own metadata page had
 * written four of these out by hand and left `quotes` off — so a shared article
 * with quotes told its reader nothing about them, under a heading that says
 * *what has been built for it*. GPT Sol found it while reviewing the owner's
 * inventory (docs/plans/260902n-the-sharing-dialog-lists-what-goes-out-and-what-stays.md).
 * `PublicPages.tsx` now walks this record instead, so a sixth artefact appears
 * there whether or not anybody remembers the page.
 */
export const NOUN: Record<keyof PublicArtefacts, string> = {
  arc: "an arc through the argument",
  glossary: "a glossary",
  ideas: "a list of ideas",
  quotes: "a set of quotes",
  tweets: "a tweet thread",
  timeline: "a timeline",
  sketch: "a sketch",
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

/**
 * **What a visitor may have of one mode**, as a cause rather than a remedy.
 *
 * Three variants and no more, because there are three things that can be true
 * of a mode: it costs nothing and draws only what the visitor already holds; it
 * spends a model call, so it is the owner's; or it shows a stored artefact,
 * which a shared payload either carries or does not.
 *
 *  - `owners-only` carries **no string**. The owner-facing word is
 *    `MODE_LABEL[mode]`, which is total and compiler-checked, so renaming a
 *    mode cannot leave the visitor's sentence saying the old word — which is
 *    what six labels repeated here would have done.
 *  - `artefact` carries the `PublicArtefacts` key, and nothing else: whether
 *    that flag is set is a fact about *this piece*, not about the mode.
 */
type VisitorPolicy =
  | { kind: "available" }
  | { kind: "owners-only" }
  | { kind: "artefact"; key: keyof PublicArtefacts };

/**
 * **Every mode's policy, and the record is total.**
 *
 * It was two `Partial` records and an if-chain with a fail-closed fall-through
 * until 2026-09-02, and the fall-through's own comment is the argument for this
 * shape: `referee` fell through it from 2026-08-31 to 2026-09-02, which gave
 * the right *policy* and the wrong *sentence* — the fall-through has only the
 * mode id to hand `ownersOnly`, so a visitor read "referee is for whoever added
 * this article", lower-case, in the band and in the dock tooltip.
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C2.
 *
 * A total `Record<Mode, …>` makes that impossible rather than unlikely: a
 * fifteenth mode does not fall anywhere, it fails to compile until somebody
 * decides. Every "stated rather than defaulted into" comment below is therefore
 * stronger than it was, not weaker — the row it defends is now required.
 * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md § T1.3.
 */
const POLICY: Record<Mode, VisitorPolicy> = {
  /* **Plain is the article and nothing else**, so there is nothing here a
     visitor could be short of: no artefact is read, no model call is made, and
     the prose is the payload they already hold. */
  plain: { kind: "available" },
  /* The table of contents, the granularity zoom and the spine are the whole
     point of the feature and cost nothing: they are drawn from the tree in the
     payload the visitor already has. */
  hierarchy: { kind: "available" },
  /* **Structure — which since 2026-09-10 is Outline too — is the same bargain,
     and had to be named to get it.** Outline had to be first: the old
     fall-through was deliberately fail-closed, so a mode added later was
     owners-only until somebody said otherwise — which meant the plan's claim
     that Outline "costs nothing, so a visitor gets it" was the *intent* and
     false in the code. GPT Sol's review, 2026-08-28. Structure's two columns
     are an arrangement of the tree in the payload the visitor already holds: no
     artefact, no request, nothing to be short of. Its narrow face is Outline's
     list, which reads the arc from the same payload and simply skips that rung
     without it.

     It was behind the experimental switch until 2026-09-10, and this row was
     `available` then too: the switch decides whether the *bar draws the
     button*, this table decides what a visitor is shown on arrival, and a
     shared URL must show two people the same thing. */
  structure: { kind: "available" },
  /* And summary, since 2026-08-31. It used to be an artefact mode, gated on a
     `summary.json` a visitor's payload might not carry. The generated ladder is
     gone (docs/plans/260831s-gist-only-summaries.md) and what the panel draws now is the
     tree's own gists, which are in the payload the visitor already holds — so
     there is nothing left to be missing. */
  summary: { kind: "available" },

  glossary: { kind: "artefact", key: "glossary" },
  ideas: { kind: "artefact", key: "ideas" },
  quotes: { kind: "artefact", key: "quotes" },

  /**
   * **Search became `available` on 2026-09-04**, and it is `available` rather
   * than `{ kind: "artefact" }` for the reason GPT Sol gave when it talked this
   * plan out of a `none-yet` gap:
   *
   * > "No saved items yet" is content inside an accessible panel, not something
   * > preventing access.
   *
   * An article nobody has searched is an empty panel, not a boundary — the same
   * call `comments` produced one stage earlier, and the reason `VisitorGap`
   * gained no member for either.
   *
   * What a visitor gets is the owner's finished runs, their ticks, their
   * colours and their marks in the prose; what they do not get is the composer,
   * the retry, the recolour, the delete, or the words matcher. Greg,
   * 2026-09-04 — *"Only owner can create new searches. Everyone else can see
   * the ones they have already created."* The enforcement is a `SearchAccess`
   * union whose visitor arm carries none of those verbs
   * (src/web/SearchPanel.tsx), plus the pin on `?match=`, plus the fact that
   * `useSearch` is mounted in `SearchBand` alone.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4.
   */
  search: { kind: "available" },
  chat: { kind: "owners-only" },
  remember: { kind: "owners-only" },
  /**
   * **Diagram became `available` on 2026-09-04, and the carve-out the old
   * comment said was "real work and not slice 1a's" turned out to be a prop.**
   *
   * What stood here: the band itself fetches nothing — the default picture is
   * drawn from the tree already on the page and a visitor could have it for
   * free — but `DiagramPanel` mounts hooks that POST for embeddings, so a
   * visitor pressing *graph* would issue exactly the request the acceptance
   * test for this feature forbids. That was true, and it was the one judgement
   * call in this table.
   *
   * It is `available` because the panel now takes a `DiagramAccess` union
   * (DiagramPanel.tsx) rather than assuming an owner. A visitor's arm pins the
   * picture to Force and turns off **three** fetching hooks — `useSimilar`,
   * `useProjection` and `useSketchCaption`, the third of which had no `enabled`
   * argument at all and is the one an audit of the other two misses. Force
   * draws without embeddings: `similar.pairs` is a shared empty array while the
   * hook is idle, so what a visitor loses is the dotted semantic layer.
   *
   * **The pin is the safety property, not the hidden chip row.** `?diagram=` is
   * ordinary query state, so a pasted `?diagram=trail` walks past a filtered
   * picker; the value is forced in the component, where nothing can route round
   * it. docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 2.
   *
   * `available` rather than `artefact`, because there is no artefact: the
   * picture comes from the tree in the payload every reader already holds, the
   * same bargain `structure` and `summary` make.
   */
  diagram: { kind: "available" },
  /**
   * **Timeline became an artefact mode on 2026-09-04**, and it was
   * `owners-only` before that — stated rather than defaulted into, which is
   * what made this a decision to revisit rather than an omission to discover.
   * Greg had said at the time:
   *
   * > it would be nice to have the option for this to be Public-readable, but
   * > that could be a follow-up
   * >
   * > — Greg, 2026-08-31
   *
   * This is that follow-up. What changed is not the cost — reading
   * `article_revisions.timeline` never cost anything, and only *generating* a
   * timeline spends — but that the payload now carries the artefact, so there
   * is a flag to read. That is the whole distinction the old comment named:
   * it was `owners-only` rather than `artefact` *because there was no
   * `PublicArtefacts` flag*, so a visitor could only be told *this belongs to
   * whoever added the article*, never *nobody has built one*. Now we can tell
   * them which it is.
   * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1.
   *
   * **The bar still does not draw the button for a signed-out reader**, and
   * that is a separate switch rather than this one: Timeline is behind
   * experimental features, and a signed-out reader is `experimental: false` by
   * decision. They reach it by a shared `?mode=timeline` URL and from the
   * visitor's metadata page. Greg accepted that on 2026-09-04 rather than
   * inherit it. docs/project/experimental-features.md § Hidden means hidden
   * from the controls, not unreachable.
   */
  timeline: { kind: "artefact", key: "timeline" },
  /**
   * **Referee is `timeline`'s case, and it arrived here the slow way.**
   *
   * It reached the fall-through until 2026-09-02, which is fail-closed and so
   * gave the right *policy* — but the fall-through had only the mode id to hand
   * `ownersOnly`, and that wants a product noun. A visitor pressing the button
   * was told "referee is for whoever added this article", lower-case, in the
   * band and in the dock tooltip. There is no fall-through left for the next
   * mode to arrive in.
   * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C2.
   *
   * It spends: the reader's own criteria go to the model along with the piece.
   * docs/plans/260831an-referee-mode-for-peer-reviewers.md.
   */
  referee: { kind: "owners-only" },
  /**
   * **`owners-only` in Stage 3, and it is a staging decision rather than the
   * final answer.**
   *
   * Debate is meant to be shareable — it is the one artefact whose whole value
   * is that somebody else can check it, and `searchedAt` crosses both DTOs
   * deliberately so a visitor can see how old the search is. What is not built
   * yet is the thing a visitor's row must not bypass: `PUBLIC_PROJECTIONS`, the
   * public DTO, and `publicCitationUrl` re-judging every row's URL at the
   * boundary — a refusal there drops the whole row, because a row with no
   * source violates this mode's own invariant.
   *
   * So this says `owners-only` until Stage 4 builds that contract, and then it
   * becomes `{ kind: "artefact", key: "debate" }`. Writing the visitor branch
   * first is exactly what a GPT Sol review (F23) refused: a "green" panel
   * implemented against a sanitisation boundary that did not exist.
   * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md § Stage 4.
   *
   * It also spends, and more than most: two metered web-search calls, up to
   * ~$0.27 a run and rising with the length of the article.
   */
  debate: { kind: "owners-only" },
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
  const policy = POLICY[mode];
  switch (policy.kind) {
    case "available":
      return null;
    /* The word on the button, from the record that already has to name every
       mode for the tab title. The policy carries no string of its own, so
       there is nothing here to go stale. */
    case "owners-only":
      return { kind: "owners-only", feature: MODE_LABEL[mode] };
    /* **The flag decides whether there is a gap at all**, which is what slice
       1b turned round: before it, every artefact was withheld and the only
       question was which true sentence to say about the withholding. A piece
       that has a glossary shows its glossary. */
    case "artefact":
      return available[policy.key] ? null : notBuiltGap(policy.key);
    default: {
      /* There is no fall-through policy any more, and this is not one: it is
         the compiler being made to say so. `POLICY` is total over `Mode`, so
         the only way here is a fourth `VisitorPolicy` variant nobody handled,
         and this line goes red at the point it is added rather than answering
         a visitor with whatever the last branch happened to return. */
      const unhandled: never = policy;
      return unhandled;
    }
  }
}

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
  }
}

/**
 * Whether making an account is what fixes this.
 *
 * The sign-up line goes beside the specific thing the visitor has just found
 * they could not do — that is the whole placement rule — so it must not appear
 * beside a gap an account does not close.
 *
 * **Every value here is `true`, and the map stays anyway.** Both surviving
 * kinds are things an account fixes, so this function has one answer today; it
 * is kept as a map rather than collapsed to `return true` because the rule it
 * encodes is not *the offer always applies*, it is *each kind of gap decides
 * whether the offer applies*. Collapsing it would delete the question, and the
 * next author would find a function that looks like it never had one.
 *
 * The `false` entries all went the same way, and none of them was refuted by an
 * argument about accounts. Two — *we are the ones who have not shipped it* —
 * went with their union members in slice 1b. The third, `readers-own`, went on
 * 2026-09-08 — the deletion 260904c had already decided on and not carried
 * out, and **it comes back if a consent flag ever ships**, which is that plan's
 * instruction. Nothing was left reading it: its sentence promised *a shared link
 * carries the piece, never anybody's notes about it*, which stopped being true
 * on 2026-09-04 when a shared link started carrying the owner's comments
 * (docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3). It survived
 * four days as dead code with a live test, and in those four days it was still
 * being read out to visitors by the Comments button, which had copied half of
 * it — docs/plans/260907b-rich-tooltips-on-the-dock-modes.md § The find.
 *
 * A total map rather than a comparison, for the reason `RETRYABLE` in
 * src/messages.ts gives: a third kind is then a red compile rather than a
 * silent `false`.
 */
const FIXED_BY_AN_ACCOUNT: Record<VisitorGap["kind"], boolean> = {
  "not-built": true,
  "owners-only": true,
};

export function anAccountWouldHelp(gap: VisitorGap): boolean {
  return FIXED_BY_AN_ACCOUNT[gap.kind];
}
