/**
 * **Mirror — the model reads the referee's own comments and remarks on them,
 * and is never given the paper.**
 *
 * Stage 5b of docs/plans/260831an-referee-mode-for-peer-reviewers.md § 3, and
 * the panel half of it; [`useMirror.ts`](useMirror.ts) is the stream and
 * [`src/referee-mirror.ts`](../referee-mirror.ts) is the whole of the thinking.
 * Split the way every mode in this app splits: `MirrorBand` owns the hook,
 * everything below it is a pure function of its props.
 *
 * ## The one rule this panel exists to keep
 *
 * **Two of the five remark kinds say, on the row, that no trial has tested
 * them.** `coverage` and `placement` carry `trialTested: false`, stamped by the
 * server from the kind and never by the model, because the ICLR 2025 randomised
 * trial tested three categories and neither of these is one of them
 * (`RemarkCommon.trialTested` in
 * [`src/referee-mirror-types.ts`](../referee-mirror-types.ts) is careful about
 * what that flag does and does not claim).
 *
 * A `placement` row has no model in it at all: its sentence is minted from the
 * referee's own comment by `mintPlacements` in
 * [`src/referee-mirror.ts`](../referee-mirror.ts), and the comment it is about
 * was never sent. Untested is still the right word on it — the question that
 * flag asks is what evidence stands behind telling a referee this, not who
 * wrote the sentence.
 *
 * The whole mode rests on that one measured result, so a panel that printed all
 * five alike would be borrowing the trial's authority for two things it never
 * covered. The label is therefore **a word on every row**, taken from
 * `remark.trialTested` and not from anything this file decides, with one
 * footnote under the list saying what the two words mean. Not a colour, not a
 * border, not a tooltip: colour may never be the only carrier
 * (docs/project/colour-scales.md) and a tooltip is not read by anybody in a
 * hurry, which is what a referee is.
 *
 * ## Abstention is the design, so the empty state is the main state
 *
 * Most comments should produce no remark, and an empty list is a **correct,
 * complete answer** rather than a failure. That makes this the panel where "it
 * worked" and "it broke" look most alike, so the two are separated by hand:
 * *nothing to raise* (the model read your comments and had no remark) is a
 * different sentence from *nothing to read* (you have not written anything
 * under a passage yet), and neither is the error state.
 *
 * ## And what is deliberately not here
 *
 * **No review prose, and nothing to copy.** Greg vetoed a report-drafting
 * feature and a "suggested rewrite" beside a vague comment is that feature
 * arriving through the back door. This panel prints the model's remark and the
 * referee's own words, and offers no way to turn either into a sentence for the
 * report.
 *
 * **Nothing is marked in the prose.** Criteria paints the article because its
 * whole output is passages; a Mirror remark is about a sentence the referee
 * wrote, and the place for it is beside that sentence in the list, with a jump
 * into the piece. So there is no `?mirror=` parameter and no `Found[]` pushed
 * up — the mode has one URL parameter, `?referee=mirror`, and that is all.
 */
import type { MirrorComment, MirrorRemark, MirrorRemarkKind, MirrorResult } from "../referee-mirror-types.js";
import type { BlockId } from "../types.js";
import { ControlTip, Tooltip } from "./Tooltip.js";
import { useMirror, type MirrorApi } from "./useMirror.js";
import { signedValence } from "./valence.js";

/* ------------------------------------------------------------------ band -- */

/**
 * The band: the hook, and the one cast at the seam.
 *
 * `MirrorComment.blockId` is a plain `string` rather than a `BlockId` because
 * the id has been round-tripped through the model's reply and back — the
 * comment it came off held a `BlockId`, and `validateRemarks` copies it onto
 * the remark from the *input* rather than from anything the model wrote, which
 * is what makes it safe to hand to the article. One cast, in one place, said
 * out loud.
 */
export function MirrorBand({
  slug,
  onJump,
}: {
  slug: string;
  onJump(blockId: BlockId): void;
}) {
  const api = useMirror(slug);
  return <MirrorView api={api} onJump={(id) => onJump(id as BlockId)} />;
}

/* ----------------------------------------------------------------- panel -- */

/** What the button says, which is also how the referee can tell where a run is. */
function runLabel(api: MirrorApi): string {
  if (api.status === "running") return api.writing ? "Answering…" : "Reading your comments…";
  if (api.status === "failed") return "Try again";
  return api.result ? "Read them again" : "Read my comments back to me";
}

export function MirrorView({
  api,
  onJump,
}: {
  api: MirrorApi;
  onJump(blockId: string): void;
}) {
  return (
    <div className="mir">
      {/* Above the button, and it is the honest description of the input rather
          than a promise about the output: this call is not given the article, so
          "it says nothing about the paper" is a fact about what went to the
          model. src/referee-mirror.ts § the three constraints. */}
      <p className="mir-what">
        The model reads your own comments and remarks on them. It is not given the paper, and it
        says nothing about whether the paper is any good.
      </p>

      <button
        type="button"
        className="mir-run"
        onClick={api.ask}
        disabled={api.status === "running"}
      >
        {runLabel(api)}
      </button>

      {api.status === "failed" && api.error && <p className="mir-error">{api.error}</p>}

      {api.status === "done" && api.result && <Answer result={api.result} onJump={onJump} />}
    </div>
  );
}

/* --------------------------------------------------------------- the run -- */

function Answer({
  result,
  onJump,
}: {
  result: MirrorResult;
  onJump(blockId: string): void;
}) {
  const { remarks, input, coverage, placementsOmitted } = result;
  /* **Both lists.** A `placement` remark is about a comment that was never sent
     to the model — that is the point of `MirrorInput.placements` — and looking
     it up only in `comments` would leave the row printing a block id where the
     referee's own marked words belong. */
  const byId = new Map([...input.comments, ...input.placements].map((c) => [c.id, c]));

  return (
    <>
      {/* **`length === 0`, never a truthiness test.** An empty list is the
          answer this feature gives most often, and a `remarks.length && …`
          would render a bare `0` into the panel. */}
      {remarks.length === 0 ? (
        <Nothing input={input} />
      ) : (
        <>
          <ol className="mir-list">
            {remarks.map((remark, i) => (
              <Remark
                /* The ordinal is the identity: two remarks about one comment
                   cannot both survive `validateRemarks`, but a coverage remark
                   has no comment id at all, so there is no field here that is
                   unique across the whole list. The list is replaced wholesale
                   rather than reordered, so an index key carries no state. */
                // biome-ignore lint/suspicious/noArrayIndexKey: the ordinal is the only identity a coverage remark has — see above
                key={`${remark.kind}:${i}`}
                remark={remark}
                comment={"commentId" in remark ? byId.get(remark.commentId) : undefined}
                onJump={onJump}
              />
            ))}
          </ol>
          {/* **The placements that did not fit**, said rather than logged. Six
              remarks is the whole list, and a referee who has eight bare
              numbers and is shown six of them has been told the wrong count of
              a fact about their own notes. */}
          {placementsOmitted > 0 && (
            /* `mir-coverage` rather than a class of its own, and deliberately
               so rather than for want of time: this is the same quiet line
               under the panel doing the same job, and a second selector with
               identical rules would be a copy for something to keep in step. */
            <p className="mir-coverage">
              {count(placementsOmitted, "other placement")} of yours also{" "}
              {placementsOmitted === 1 ? "has" : "have"} nothing written under{" "}
              {placementsOmitted === 1 ? "it" : "them"}. The list above keeps the numbers furthest
              from zero.
            </p>
          )}
          {/* Once, under the list, because two words on a row are not an
              explanation and a referee should not have to guess what "not
              tested" is measuring. */}
          <p className="mir-evidence-note">{EVIDENCE_NOTE}</p>
        </>
      )}

      <Coverage coverage={coverage} />
    </>
  );
}

/**
 * **The empty answer, which is two different empty answers.**
 *
 * *Nothing to raise* means the model read the referee's comments and had no
 * remark about any of them — the commonest and most valued outcome this feature
 * has. *Nothing to read* means there was no sentence of theirs to read back,
 * because every mark they have made is a bookmark. Collapsing the two would
 * make the second read as a finding about notes they never wrote.
 */
function Nothing({ input }: { input: MirrorResult["input"] }) {
  if (input.comments.length > 0) {
    return (
      <p className="mir-nothing">
        Nothing to raise. The model read {count(input.comments.length, "comment")} of yours and had
        no remark about any of them, which is what it should find most of the time.
      </p>
    );
  }
  return (
    <p className="mir-nothing">
      Nothing to read back yet. A bookmark is a mark on a passage with nothing written under it, so
      there is no sentence of yours in one to remark on
      {input.skippedBookmarks > 0
        ? ` — ${count(input.skippedBookmarks, "bookmark")} skipped.`
        : "."}{" "}
      Write what you think under a passage, and this reads it back to you.
    </p>
  );
}

/**
 * **Why the coverage question was not put**, and only when the answer is
 * something the referee can do something about.
 *
 * A coverage remark is a claim about the *whole* set of comments, so anything
 * that keeps one out of the prompt takes it away (`coverageStatus` in
 * src/referee-mirror.ts holds the rule). Two of the four reasons are worth
 * saying — the model did not see everything you wrote — and two are not:
 * *nothing to mirror* is already the empty state above, and *no criteria* is
 * not a gap at all, it is a referee who has not asked that question. Nagging
 * them about it here would be Mirror advertising another sub-mode.
 */
function Coverage({ coverage }: { coverage: MirrorResult["coverage"] }) {
  if (coverage.asked) {
    /* Asked, but not about all of them. The criteria list is capped, and
       `asked: true` on its own let a run that considered the first
       twenty-four read as one that considered every one — wrong in the
       direction that reassures. */
    if (coverage.criteriaOmitted === 0) return null;
    return (
      <p className="mir-coverage">
        You have more criteria than one run considers, so{" "}
        {count(coverage.criteriaOmitted, "criterion")} of yours{" "}
        {coverage.criteriaOmitted === 1 ? "was" : "were"} not put to the model at all. Nothing here
        says whether your notes take {coverage.criteriaOmitted === 1 ? "it" : "those"} up.
      </p>
    );
  }
  if (coverage.reason === "text-clipped") {
    return (
      <p className="mir-coverage">
        Some of what you wrote was too long to send whole, so the model saw part of it. Nothing here
        says what your notes have and have not taken up.
      </p>
    );
  }
  if (coverage.reason === "comments-dropped") {
    return (
      <p className="mir-coverage">
        Some of your comments could not be read — one is anchored to a passage this version of the
        paper no longer has, or is a bookmark tagged with a criterion. So nothing here says what
        your notes have and have not taken up.
      </p>
    );
  }
  if (coverage.reason === "comments-truncated") {
    return (
      <p className="mir-coverage">
        You have more comments than one run reads, so the model saw only some of them. Nothing here
        says what your notes have and have not taken up.
      </p>
    );
  }
  return null;
}

/* -------------------------------------------------------------- one row -- */

/**
 * What each kind is called, in the referee's terms rather than the model's.
 *
 * A total `Record` rather than a lookup with a fallback, so a sixth kind is a
 * red compile here as well as in the validator —
 * docs/project/typechecking.md.
 */
const KIND_LABEL: Record<MirrorRemarkKind, string> = {
  specificity: "Hard for an author to act on",
  misunderstanding: "Check this against the passage",
  tone: "How this will land",
  coverage: "A criterion your notes have not taken up",
  placement: "A number with nothing written under it",
};

/**
 * **The two words the whole mode's honesty rests on.**
 *
 * Chosen from `remark.trialTested`, which is a literal `true` or `false` on
 * each member of the union rather than a `boolean` on the base — so a panel
 * that decided to print one of these from the *kind* instead would still be
 * consistent, and a panel that forgot the distinction fails to compile.
 */
/**
 * **"A kind" is the whole of the change, 2026-09-02.**
 *
 * These were *"Tested in a trial"* and *"Not tested in a trial"*, and beside one
 * remark that reads as a claim about **this remark** — that somebody checked it
 * and it held. It never meant that. What the trial tested is the *category*: a
 * referee shown feedback of this shape revised their review more often than one
 * who was not. Whether this particular sentence about this particular comment is
 * any good is untested and untestable, and `EVIDENCE_NOTE` under the list says
 * so in its last line — which is a line a referee in a hurry does not reach.
 *
 * So the noun moves into the label. Three words longer, and it is the smallest
 * wording that puts the trial's subject where the reader can see it.
 * tests/referee-tooltips.test.tsx pins both as literals.
 */
const TESTED = "A kind tested in a trial";
const UNTESTED = "A kind not tested in a trial";

const EVIDENCE_NOTE =
  "Three of these kinds — hard to act on, check against the passage, how this will land — come " +
  "from a randomised trial with ICLR 2025 reviewers, where 27% revised their own review after " +
  "feedback of that shape. The other two were not tested by it. That is a fact about the " +
  "evidence behind each kind, not about how likely any one remark is to be right.";

function Remark({
  remark,
  comment,
  onJump,
}: {
  remark: MirrorRemark;
  /** The referee's own comment this is about — absent on a coverage remark. */
  comment: MirrorComment | undefined;
  onJump(blockId: string): void;
}) {
  return (
    <li className="mir-remark" data-kind={remark.kind}>
      <p className="mir-head">
        <span className="mir-kind">{KIND_LABEL[remark.kind]}</span>
        {/* **The card is on top of the word, never instead of it.** This file's
            header says the distinction may not be a tooltip, and that stands:
            the word is rendered, readable and on every row, and it is what a
            referee in a hurry gets. What the card adds is the trial itself —
            which trial, how big the effect was, and the line the note under the
            list ends on, which is that none of it says whether *this* remark is
            right. `EVIDENCE_NOTE` is imported into the card rather than
            rewritten, so the row and the footnote cannot drift. */}
        <Tooltip
          placement="left"
          className="tip-soon"
          content={
            <ControlTip
              head={remark.trialTested ? TESTED : UNTESTED}
              what={
                remark.trialTested
                  ? "A randomised trial tested feedback of this shape on real reviewers."
                  : "No trial has tested feedback of this shape; it is here because it is cheap to check and easy to dismiss."
              }
              how={EVIDENCE_NOTE}
            />
          }
        >
          <span className="mir-evidence" data-trial-tested={String(remark.trialTested)}>
            {remark.trialTested ? TESTED : UNTESTED}
          </span>
        </Tooltip>
      </p>

      {remark.kind === "coverage" ? (
        /* No jump, and deliberately no block id anywhere on this row: a
           coverage remark exists precisely because no comment took the
           criterion up, so there is nowhere in the piece it points at. A row
           that offered one would send the referee somewhere the model said
           nothing about.

           **And the absence is what the card explains.** Rule 2 of the mode is
           that every row is a door into the prose, so the one row that is not
           reads as broken — the referee presses the criterion, nothing happens,
           and the panel has said nothing about why. A missing control cannot
           carry a tooltip, so this one sits on the words that stand in its
           place. */
        <Tooltip
          placement="left"
          className="tip-soon"
          content={
            <ControlTip
              head={KIND_LABEL.coverage}
              what="The criterion you wrote, printed as a reminder rather than as a link."
              how="This row has nowhere to send you, and that is the whole of what it is saying: it exists because none of your comments took this criterion up, so there is no passage in the paper it is about. Every other row here jumps."
            />
          }
        >
          <p className="mir-criterion">{remark.criterion}</p>
        </Tooltip>
      ) : (
        /* **A card, not a `title`.** It was `title="Go to this passage"` until
           2026-09-02, which is precisely the anti-pattern Tooltip.tsx's own
           docstring argues against: a second's wait, unstyleable, truncated at
           the OS's idea of a line, and **not there at all on a touch device**.
           The card also has room for the half a `title` had no space for — that
           the words on the button are the referee's own, quoted back, rather
           than anything the model wrote. */
        <Tooltip
          placement="left"
          className="tip-soon"
          content={
            <ControlTip
              head="Go to this passage"
              what="Scrolls the paper to the passage this remark is about."
              how={
                comment
                  ? "The words on this button are your own comment's, quoted back — the model wrote only the line at the foot of the row."
                  : "Your comment for this remark could not be found, so the button shows the passage's id instead of your words. The jump still lands in the right place."
              }
            />
          }
        >
          <button type="button" className="mir-jump" onClick={() => onJump(remark.blockId)}>
            {/* The referee's own words where we have them, so the remark sits
                against the thing it is about. Rule 2 of the mode: every row is an
                index into the piece. */}
            <span className="mir-quote">{comment?.quote ?? remark.blockId}</span>
          </button>
        </Tooltip>
      )}

      {/* Their own comment, quoted back. The remark is about this sentence, and
          a referee reading a list of remarks has no other way to remember which
          of their notes each one means. */}
      {comment?.body && <p className="mir-yours">{comment.body}</p>}

      {(remark.kind === "misunderstanding" || remark.kind === "placement") && (
        /* The passage itself. On a `misunderstanding` these are the characters
           `findQuote` proved are in the block, which is what makes that kind the
           one a referee can check at a glance; on a `placement` they are the
           words the number was put on. */
        <p className="mir-passage">{remark.passage}</p>
      )}

      {remark.kind === "placement" && (
        <p className="mir-placement">
          <span className="mir-placement-number">{signedValence(remark.valence)}</span>
          {remark.criterion && <span className="mir-placement-on"> on {remark.criterion}</span>}
        </p>
      )}

      {/* The model's own words, rendered as text — never as markup. */}
      <p className="mir-note">{remark.note}</p>
    </li>
  );
}

/**
 * "1 comment" / "4 comments", so no sentence here has a stray plural in it.
 *
 * `criterion` is the one word here an `s` does not pluralise, so it gets its
 * own line rather than a rule: a panel that printed "6 criterions" at a peer
 * reviewer would lose more standing than the sentence buys.
 */
function count(n: number, noun: string): string {
  if (n !== 1 && noun === "criterion") return `${n} criteria`;
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
