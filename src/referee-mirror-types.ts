/**
 * **What a Mirror run is made of** — the shapes, and nothing that can do
 * anything.
 *
 * A `.ts` of type declarations only, on the model of
 * [`src/public-types.ts`](public-types.ts): no imports, no side effects, no
 * runtime at all, so it erases entirely at compile time. It exists because both
 * halves of Mirror have to speak one vocabulary. The server builds these values
 * ([`src/referee-mirror.ts`](referee-mirror.ts) — the prompt, the call and the
 * validator that mints every field below), and the browser draws them
 * ([`src/web/MirrorPanel.tsx`](web/MirrorPanel.tsx), through
 * [`src/web/useMirror.ts`](web/useMirror.ts)).
 *
 * **They could not stay in `referee-mirror.ts`.** That module reaches
 * `node:crypto`, the log, the gateway and the model table, and nothing under
 * `src/web/` may import a file like that — not even `import type`, because the
 * rule tests/client-imports.test.ts enforces is *shared modules stay leaves*
 * rather than merely *do not break the bundle*. Its own docstring says what to
 * do about it: move the shared thing into a module that imports nothing. This
 * is that module, and `referee-mirror.ts` re-exports every name so no existing
 * importer had to change.
 *
 * The one rule worth reading before drawing any of this is
 * `RemarkCommon.trialTested` below: two of the five kinds carry `false`, a UI
 * has to say so, and the literal types on the union are what stop it being
 * forgotten.
 *
 * docs/project/referee-mode.md § Mirror.
 */

/**
 * One of the referee's criteria.
 *
 * Text, and an id when the criteria have rows to have ids — which is what
 * `CommentPlacement.criterionId` points at. A plain list of strings was the
 * first shape and could not name the criterion a placement was made on, which
 * is the whole content of a placement.
 */
export interface MirrorCriterion {
  text: string;
  id?: string;
}

/**
 * One of the referee's comments, with the passage it is anchored to.
 *
 * Built by `mirrorInput` from a `Comment` and the article's blocks. Everything
 * here is the referee's or the article's; nothing is the model's.
 */
export interface MirrorComment {
  /** The `Comment.id`. What a remark names, and it is checked against the set. */
  id: string;
  /** The block the comment is anchored to. Carried onto every remark, by code. */
  blockId: string;
  /** The words the referee marked — a substring of `passage`. */
  quote: string;
  /**
   * The referee's own sentence about the passage.
   *
   * **Absent on a comment that carries a placement and no prose** — and that is
   * the one case where a comment with nothing written on it is still worth
   * reading, because the placement itself is the claim. Otherwise a comment
   * with no body never reaches here at all; see `mirrorInput`.
   */
  body?: string;
  /** The whole block's text, which is what a quoted passage is checked against. */
  passage: string;
  /** Which criterion this note answers, when it answers one. */
  criterionId?: string;
  /** That criterion's words, resolved from the list when it has them. */
  criterion?: string;
  /** The referee's own placement, −100…+100. Validated, never clamped. */
  valence?: number;
}

/** The comments worth sending, and an account of what was left behind. */
export interface MirrorInput {
  /** In document order — see `mirrorInput`. */
  comments: MirrorComment[];
  /**
   * Bookmarks: a mark on a passage with nothing written on it **and no
   * placement either**.
   *
   * Skipped entirely rather than sent with an empty body, because there is no
   * claim of the referee's to remark on and a model handed one will remark on
   * the passage instead — which is the one thing this mode does not do.
   */
  skippedBookmarks: number;
  /**
   * Comments carrying a `valence` that is not a number between −100 and +100.
   *
   * **The unit-drift alarm**, and it is counted rather than corrected for the
   * reason `Dropped.subOne` in src/search.ts is: rescaling is a guess about
   * which unit somebody meant, and a confident wrong guess turns a referee's
   * own "slightly against" into "damning" with nothing on screen to say so. The
   * value is ignored — the comment still goes if it has a body — and the count
   * is logged, so a scale that has quietly become 0–100 or 0–1 somewhere
   * upstream is a number somebody can see rather than a feeling.
   */
  badValence: number;
  /**
   * Comments anchored to a block this revision of the article no longer has.
   *
   * Skipped because the whole check is "the comment against the passage", and
   * there is no passage. Counted rather than dropped silently: the referee's
   * mark is still theirs, and src/web/comment-nav.ts already sorts such a
   * comment to the end of the list rather than pretending it is gone.
   */
  skippedOrphans: number;
  /**
   * Bookmarks that named one of the referee's criteria.
   *
   * A subset of `skippedBookmarks`, counted separately because it is the only
   * kind of bookmark that can make a *coverage* remark wrong. An empty bookmark
   * carries no words, no number and no criterion, so nothing in it could bear
   * on anything; a bookmark tagged with a criterion is the referee saying "this
   * passage is about that", and Mirror never sees it. Telling them afterwards
   * that nothing they wrote bears on that criterion would be contradicting a
   * mark they made. See `coverageStatus`.
   */
  skippedTagged: number;
  /** Comments beyond `MAX_COMMENTS`. Counted, because a cap must never be silent. */
  truncated: number;
}

/**
 * The five kinds of remark.
 *
 * The first three are the ICLR trial's three categories, in its own terms:
 * vagueness, overlooked paper content, unprofessional remarks. `coverage` and
 * `placement` are not among them — see `trialTested`.
 */
export type MirrorRemarkKind =
  | "specificity"
  | "misunderstanding"
  | "tone"
  | "coverage"
  | "placement";

/** What every remark carries, whatever it is about. */
interface RemarkCommon {
  /**
   * **Did a controlled trial test feedback of this shape?** — and that is all
   * this field says.
   *
   * `true` for the three the ICLR randomised trial actually ran: vagueness,
   * overlooked paper content, unprofessional remarks. `false` for `coverage`
   * and `placement`, which it did not.
   *
   * **It is not a confidence in the finding, and the two come apart.** A
   * coverage remark is untested *and* uncertain — a pile of passage notes
   * cannot establish that a review leaves a criterion unaddressed. A placement
   * remark is untested and *certain*: "you put a number on this and wrote
   * nothing" is a fact about the referee's own data, with no judgement about
   * the paper in it at all. Both read `false`, because the question is what
   * evidence there is that telling a referee this changes anything, and for
   * neither of them is the answer "a randomised trial".
   *
   * **Set by `validateRemarks` from the kind, never by the model**, and a
   * literal type on each member rather than a boolean on the base, so a UI that
   * forgets the caveat fails to compile rather than printing an untested remark
   * as though a trial were behind it.
   * docs/plans/260831an-referee-mode-for-peer-reviewers.md § 3. Mirror.
   */
  trialTested: boolean;
  /** One or two plain sentences about the referee's own comment. The model's words. */
  note: string;
}

/** What a remark about one of the referee's comments carries. */
interface AboutAComment {
  /** The `Comment.id` this is about. Checked against the input, never invented. */
  commentId: string;
  /** The block that comment is anchored to — copied from the comment, not the model. */
  blockId: string;
}

/**
 * One thing worth another look — **about a comment, or about a criterion.**
 *
 * A discriminated union rather than a bag of optionals, and each member carries
 * exactly the fields its kind needs. The brief for this module said "every
 * remark names the comment it is about", which is true of four kinds and
 * impossible for the fifth: a coverage remark exists precisely because *no*
 * comment bears on the criterion. An optional `commentId` would make the
 * compiler agree both to a coverage remark naming a comment and to a
 * specificity remark naming none.
 *
 * Likewise `passage` is **required** where it is the point — a misunderstanding
 * the referee cannot check in a glance is an assertion, and a placement remark
 * has to show the words that were placed. See `validateRemarks`, which is where
 * a remark missing one is thrown away rather than shown.
 */
export type MirrorRemark =
  | ({ kind: "specificity" | "tone"; trialTested: true } & AboutAComment & RemarkCommon)
  | ({
      kind: "misunderstanding";
      trialTested: true;
      /**
       * The words from the passage that contradict the comment, **verbatim**.
       *
       * The only remark a referee can check at a glance, which makes it the
       * most valuable one and the one worth being strictest about: the
       * characters here are taken from the block rather than from the model's
       * retyping of it (`findQuote`, the same function the browser uses to
       * decide which characters to wash), so a quote that survives is one that
       * demonstrably appears in the passage.
       */
      passage: string;
    } & AboutAComment &
      RemarkCommon)
  | ({
      kind: "placement";
      /** **False, always.** Certain, and untested — see `RemarkCommon.trialTested`. */
      trialTested: false;
      /**
       * The words the referee marked.
       *
       * **Copied from their own comment, never chosen by the model**, because
       * unlike a misunderstanding there is nothing to choose: the claim is the
       * number, and the passage is whatever they put it on.
       */
      passage: string;
      /** The placement that has nothing written under it. The referee's own number. */
      valence: number;
      /** The criterion it was placed on, when the criteria list could name it. */
      criterion?: string;
    } & AboutAComment &
      RemarkCommon)
  | ({
      kind: "coverage";
      /** **False, always** — that trial tested three categories and this is not one. */
      trialTested: false;
      /** The referee's own criterion, as they wrote it. Matched against the list. */
      criterion: string;
    } & RemarkCommon);

/**
 * **Why coverage was or was not asked about.**
 *
 * A coverage remark is a claim about the *whole* set of comments — "nothing you
 * have written bears on this" — so it needs the whole set. Anything that keeps
 * a comment out of the prompt takes that away, and there are three such things:
 * no criteria to check against at all; a comment list that had to be cut
 * (`MAX_COMMENTS`); and a comment the model never saw although the referee made
 * it — one anchored to a block this revision no longer has, or a bookmark that
 * named a criterion and said nothing else.
 *
 * The last of those is the cross-family review's finding 4, and it is the worst
 * of the three, because it is invisible: the orphan may carry the only comment
 * bearing on a criterion, and Mirror would then tell the referee that nothing
 * they wrote addresses it. A false negative that reads exactly like a finding.
 *
 * **A reason rather than a boolean**, so a caller can say which of the four it
 * was — "you have criteria but some of your comments could not be read" is a
 * different sentence from "you have not written any criteria", and a `false`
 * makes them the same. `MirrorResult.coverage` carries it out to the caller and
 * the log line prints it.
 *
 * An empty bookmark does **not** block coverage. It has no words, no number and
 * no criterion, so there is nothing in it that could bear on anything; a rule
 * that counted it would switch coverage off for almost every real referee.
 */
export type CoverageStatus =
  | { asked: true }
  | {
      asked: false;
      reason:
        /** The referee has written no criteria. */
        | "no-criteria"
        /** More comments than `MAX_COMMENTS`, so the model saw only some. */
        | "comments-truncated"
        /** A comment the referee made never reached the model. */
        | "comments-dropped"
        /** There was nothing to send, so no question was put at all. */
        | "nothing-to-mirror";
    };

export interface MirrorResult {
  /**
   * What is worth another look. **Empty is a real, complete answer** — it means
   * the model found nothing to say, which is what it should find most of the
   * time. Nothing downstream may treat this as a failure.
   */
  remarks: MirrorRemark[];
  /** What was sent, so a caller can say "4 of your 9 comments were bookmarks". */
  input: MirrorInput;
  /**
   * Were the criteria sent at all, and if not, why not?
   *
   * A caller that shows "nothing here bears on criterion X" must not show it
   * unless this says `asked`, because otherwise the question was never put.
   * `coverageStatus` holds the rule and the reasons.
   */
  coverage: CoverageStatus;
  model: string;
}
