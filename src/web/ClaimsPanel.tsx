/**
 * **Claims — what the paper says about itself up front, and where it takes each
 * one up.**
 *
 * Stage 4 of docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2. The band
 * half (the hook, the local selection, resolving passages into marks) and the
 * panel half (what is on screen) are both here, split the way every other mode
 * splits them: `ClaimsBand` owns the state and pushes the resolved passages up
 * to `Reader`, which owns the prose; everything below it is a pure function of
 * its props.
 *
 * ## The three rules, and where each one actually lives
 *
 * The plan's first draft ranked claims by how few passages supported them. A
 * cross-family review removed that and was right to, and named the failure it
 * was protecting against: *a tired referee opens Claims first, reads the top
 * "thin" rows, and treats everything unlisted as clean. That is the mode most
 * likely to replace reading, dressed as the one least likely to.*
 *
 * **1. Document order, never thinness order.** Enforced twice, in code, and
 * neither place can see a passage count. `validateClaims` (src/referee-claims.ts)
 * sorts the authoritative answer by block position; `inDocumentOrder` below sorts
 * what the panel is *holding*, which is what makes the order right during the
 * stream as well as after it — a streamed claim cannot be placed, because the
 * claims after it have not arrived. There is no sort control on this panel and
 * no second ordering to offer.
 *
 * **2. "The model did not find a passage for this."** `NO_PASSAGE_FOUND`,
 * imported rather than typed here, so that
 * tests/referee-copy-is-about-the-model.test.ts checks the sentence itself. And
 * there are **three** empty states rather than two, because there are three
 * things that can have happened — see `ClaimRow`, which is where the third one
 * is drawn and why.
 *
 * **3. Linkage, never adequacy.** Said in words at the top of the panel
 * (`LINKAGE_NOT_ADEQUACY`), because it is the thing a referee is likeliest to
 * read past. The model asserts that a passage takes the claim up; whether it
 * carries it is theirs, and it is the interesting part.
 *
 * ## And the thing none of the three rules covered
 *
 * All three are about the rows that came back. **A claim that never gets a row
 * is invisible**, and this panel looks exactly as tidy either way — the guard
 * was built on the wrong side of the door, and the eval caught two papers
 * silently dropping a claim from their own abstract. `Unaccounted` at the bottom
 * of this file is the other side of it, and its docstring is where the wording
 * is argued for, because the wording is the whole value.
 *
 * ## What this panel deliberately does not show
 *
 * **How many passages a claim has.** Not as a number, not as a bar, not as a
 * dot. A count is one glance away from a ranking and the whole reason this
 * sub-mode survived its review is that it does not rank. The passages are listed;
 * counting them is something a referee can do with their eyes if the number ever
 * matters, which is a different act from being told it.
 *
 * **Anything a referee could paste into a report.** Greg vetoed a report
 * scaffold, and a copy button on a claim with its passages under it is that
 * feature by another door — the same call `MirrorPanel.tsx` makes about itself.
 *
 * ## And the rule that is about the reader rather than the pixels
 *
 * **Marks are default-off**, exactly as `?crits=` and `?runs=` are: the article
 * acquires marks when the reader asks and at no other time. Here the selection is
 * **component state rather than a URL parameter**, which is the one place this
 * panel departs from `CriteriaPanel.tsx`, and it is a decision rather than an
 * omission: `parseAsIdList` only carries `spya-` ids, and a claim's id is derived
 * from its anchor (`blockId:start`) rather than minted — deliberately, so that a
 * streamed claim and the authoritative one that replaces it are the same claim.
 * Minting a real id to make the parameter work would have cost the thing the
 * derived id buys. `?claims=` is worth having on the day a claims run becomes a
 * pipeline artefact with ids that outlive a run.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";

import type { Claim, OpeningSentence } from "../referee-claims.js";
import {
  DOCUMENT_ORDER_NOTE,
  LINKAGE_NOT_ADEQUACY,
  NO_PASSAGE_FOUND,
  PASSAGES_UNUSABLE,
  REASONING_WITHHELD,
  UNACCOUNTED_HEADING,
  UNACCOUNTED_NOTE,
  unaccountedSentences,
  withheldNote,
} from "../referee-claims.js";
import type { Block, BlockId } from "../types.js";
import { assignSlots } from "./hit-colours.js";
import { type Found, resolveClaim } from "./search-hits.js";
import { type ClaimsApi, useClaims } from "./useClaims.js";

/* ------------------------------------------------------------------ band -- */

/**
 * Where each block sits in the article, by id — the only sort key this file has.
 *
 * A `Map` rather than an `indexOf`, because it is rebuilt once per article and
 * read once per claim, and because the alternative reads like a sort that could
 * be given a different comparator.
 */
function positions(blocks: Block[]): Map<BlockId, number> {
  const at = new Map<BlockId, number>();
  for (const [i, b] of blocks.entries()) at.set(b.id, i);
  return at;
}

/**
 * **Rule 1, on the panel's side of the wire.**
 *
 * The server's authoritative answer is already sorted; this exists for the
 * claims that arrive *before* it — a streamed claim cannot be placed by the
 * server, because the claims that come after it have not been written yet. So
 * the panel sorts what it is holding on every frame, and the list is in the
 * paper's order at every instant rather than only once the run finishes.
 *
 * It reads the block position and the offset and **nothing else**. It cannot see
 * `passages`, which is what makes "no ranking by support count" a property of
 * this code rather than a promise in a prompt.
 *
 * **Exported for its test**, and only for that. Rendering `ClaimsView` cannot
 * cover it — that component is handed an already-sorted list — so a mutation
 * that made this sort by `passages.length` left every panel test green. Found by
 * running exactly that mutation, which is why the export is here rather than the
 * test being taken on trust.
 */
export function inDocumentOrder(claims: Claim[], at: Map<BlockId, number>): Claim[] {
  return [...claims].sort((a, b) => {
    const ai = at.get(a.blockId) ?? Number.MAX_SAFE_INTEGER;
    const bi = at.get(b.blockId) ?? Number.MAX_SAFE_INTEGER;
    return ai !== bi ? ai - bi : a.start - b.start;
  });
}

/**
 * The band: the hook, the selection, and the passages pushed up to the prose.
 *
 * `CriteriaBand` in src/web/CriteriaPanel.tsx is the model, and two of its
 * decisions are copied rather than reinvented:
 *
 * - **Slots are assigned over every claim, not the switched-on ones**, so a
 *   claim's colour does not change when the referee unticks the one above it.
 *   hit-colours.ts § What the assignment has to be.
 * - **`useLayoutEffect`, not `useEffect`, to push the results up.** This
 *   component renders the new list immediately and the prose only changes after
 *   the setter runs, so a passive effect leaves a frame where the panel shows the
 *   new passages and the article still shows the old marks.
 */
export function ClaimsBand({
  slug,
  blocks,
  onJump,
  onFound,
}: {
  slug: string;
  blocks: Block[];
  onJump(blockId: BlockId): void;
  /** `Reader` owns the prose — see the seam described on `found` in App.tsx. */
  onFound(next: Found[]): void;
}) {
  const api = useClaims(slug);
  /** Which claims are painting the prose. Empty is the default — marks are off. */
  const [showing, setShowing] = useState<string[]>([]);

  const at = useMemo(() => positions(blocks), [blocks]);
  const claims = useMemo(
    () => (api.run === null ? [] : inDocumentOrder(api.run.claims, at)),
    [api.run, at],
  );

  /* **Computed here rather than on the server**, and that is the whole reason it
     could be built without touching a route, a table or a stored shape: it is a
     pure function of the blocks this reader already has and the claims that came
     back.

     **Only once the run is done.** Mid-stream every claim that has not arrived
     yet reads as a claim the answer did not account for, which is a true
     statement about an incomplete answer and a misleading one on a screen. The
     panel is honest about a partial list of claims — they are the paper's, in
     order — and cannot be about a partial list of omissions. */
  const settled = api.run?.status === "done";
  const unaccounted = useMemo(
    () => (settled ? unaccountedSentences(blocks, claims) : []),
    [settled, blocks, claims],
  );

  /* `createdAt` is the run's, so it is the same for every claim and the tie-break
     inside `assignSlots` falls to the id — which is `blockId:start`, so the
     assignment is stable across a re-render and across a stream frame. */
  const slots = useMemo(
    () =>
      assignSlots(
        claims.map((c) => ({ id: c.id, createdAt: api.run?.createdAt ?? "" })),
      ),
    [claims, api.run],
  );

  const found = useMemo(() => {
    const out: Found[] = [];
    for (const claim of claims) {
      if (!showing.includes(claim.id)) continue;
      out.push(
        ...resolveClaim(blocks, {
          id: claim.id,
          slot: slots.get(claim.id) ?? 0,
          passages: claim.passages,
        }),
      );
    }
    return out;
  }, [claims, showing, slots, blocks]);

  useLayoutEffect(() => onFound(found), [found, onFound]);

  /* Leaving the sub-mode must take the marks out of the prose with it. Its own
     effect, with no dependency on the results, so it runs on unmount and only on
     unmount — folding it into the cleanup above would clear the marks on every
     frame and set them again immediately, which is a visible flicker of every
     highlight on the page. The trap `GlossaryBand` documents. */
  useEffect(
    () => () => {
      onFound([]);
    },
    [onFound],
  );

  const toggle = useCallback((id: string) => {
    setShowing((on) => (on.includes(id) ? on.filter((x) => x !== id) : [...on, id]));
  }, []);

  return (
    <ClaimsView
      api={api}
      claims={claims}
      unaccounted={unaccounted}
      slots={slots}
      showing={showing}
      onToggle={toggle}
      onJump={onJump}
    />
  );
}

/* ----------------------------------------------------------------- panel -- */

/**
 * Everything on screen, as a pure function of its props — the same
 * band-owns-the-state, panel-is-pure split every other mode in this app makes.
 *
 * **Exported, unlike `CriteriaView` next door**, and for the reason `MirrorView`
 * is: tests/referee-claims-panel.test.tsx renders it with no router, no fetch
 * and no hook, which is the only way to put all three of the empty states on a
 * screen at once and check which sentence each one prints.
 */
export function ClaimsView({
  api,
  claims,
  unaccounted = [],
  slots,
  showing,
  onToggle,
  onJump,
}: {
  api: ClaimsApi;
  claims: Claim[];
  /**
   * The sentences the claims do not account for — `unaccountedSentences`.
   *
   * Optional, and empty by default, because most of this file's tests are about
   * a claim row and have no article to compute it from. A panel with none of
   * these draws nothing extra, which is also what an answer that accounted for
   * everything looks like.
   */
  unaccounted?: readonly OpeningSentence[];
  slots: Map<string, number>;
  showing: string[];
  onToggle(id: string): void;
  onJump(blockId: BlockId): void;
}) {
  const run = api.run;
  const pending = run?.status === "pending";
  /* Counted from the rows themselves rather than carried alongside them, so a
     stored run from before the fail-safe existed reads as zero — which is the
     truth about it. */
  const withheld = claims.reduce((n, c) => n + c.passages.filter((p) => p.withheld).length, 0);
  return (
    <div className="clm">
      {/* **Above the button, not under the results.** Both sentences are about
          how to read what is below, and a note under a list is a note read after
          the list has already been read the wrong way. */}
      <p className="clm-what">{LINKAGE_NOT_ADEQUACY}</p>

      <button type="button" className="clm-run" onClick={api.pull} disabled={pending || !api.loaded}>
        {run === null ? "Pull the paper's claims" : "Pull them again"}
      </button>

      {api.error && <p className="clm-error">{api.error}</p>}
      {!api.loaded && <p className="gloss-quiet">Loading…</p>}

      {api.loaded && run === null && !api.error && (
        <p className="gloss-quiet">
          The claims this paper makes about its own work, each with the passages where the paper
          takes it up. Every row is a door into the prose.
        </p>
      )}

      {pending && claims.length === 0 && <p className="gloss-quiet">Reading the paper…</p>}

      {run?.status === "error" && (
        <p className="clm-error">
          {run.error}{" "}
          <button type="button" className="clm-retry" onClick={api.pull}>
            Try again
          </button>
        </p>
      )}

      {run?.status === "done" && claims.length === 0 && (
        /* The whole-run version of rule 2. Not "this paper makes no claims",
           which is the shorter, more natural sentence and a finding we have no
           standing to make. An answer where the model *did* name claims and none
           of them could be found in the paper is a failed run
           (`CLAIMS_UNUSABLE`, src/referee-claims-run.ts) and lands in the error
           branch above with a Try again, so this branch does not cover it.
           tests/referee-copy-is-about-the-model.test.ts. */
        <p className="gloss-quiet">
          The model did not find any claims stated up front — which is a fact about the run, not
          about the paper.
        </p>
      )}

      {claims.length > 0 && (
        <>
          {api.stale && (
            <p className="clm-stale">Answered about an earlier version of this paper.</p>
          )}
          {/* Said out loud, above the list, because a reader who assumes a list
              is sorted best-first reads the top of it and stops. */}
          <p className="clm-order">{DOCUMENT_ORDER_NOTE}</p>
          <ol className="clm-list">
            {claims.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                slot={slots.get(claim.id)}
                showing={showing.includes(claim.id)}
                onToggle={() => onToggle(claim.id)}
                onJump={onJump}
              />
            ))}
          </ol>

          {/* **Under the list, and it is the one note that belongs there.**
              Every other note on this panel is about how to read what follows;
              this one is a fact about the list that has just been read, and it
              is meaningless before it. */}
          {withheld > 0 && <p className="clm-what">{withheldNote(withheld)}</p>}

          {unaccounted.length > 0 && <Unaccounted rows={unaccounted} onJump={onJump} />}
        </>
      )}
    </div>
  );
}

/**
 * **What the claims above did not account for**, and the wording is the whole
 * value of it.
 *
 * The failure this exists for is invisible by construction: a claim the model
 * never lists gets no row, `NO_PASSAGE_FOUND` never fires, and the panel looks
 * exactly as tidy as one that missed nothing. The eval caught two papers
 * dropping a claim from their own abstract — twice each, identically — with the
 * dropped claim's words swallowed inside a neighbouring claim's quote.
 *
 * So this section says a mechanical thing — *no claim above is anchored in these
 * sentences* — and refuses the tempting one, *here are the claims it missed*.
 * Deciding what is a claim is a judgement, and the blocks a claim came from
 * carry background, citation and setup as well as claims; a list headed *claims
 * you missed* would be the same judgement this sub-mode refuses, made in
 * reverse and with worse evidence. `UNACCOUNTED_NOTE` is where that is said, as
 * a value, so tests/referee-copy-is-about-the-model.test.ts can hold it to it.
 *
 * **No count and no ordinal**, for the same reason nothing else here has one:
 * six of these is not a worse answer than two, and a number is one glance from a
 * ranking. They are doors into the prose like every other row, and that is all
 * they are.
 */
function Unaccounted({
  rows,
  onJump,
}: {
  rows: readonly OpeningSentence[];
  onJump(blockId: BlockId): void;
}) {
  return (
    <section className="clm-row">
      <p className="clm-claim">{UNACCOUNTED_HEADING}</p>
      <p className="clm-what">{UNACCOUNTED_NOTE}</p>
      <ul className="clm-passages">
        {rows.map((row) => (
          <li className={"clm-passage"} key={`${row.blockId}:${row.start}`}>
            <button type="button" className="clm-jump" onClick={() => onJump(row.blockId)}>
              <span className="clm-quote">{row.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------- one claim -- */

/**
 * One claim, and where the paper takes it up.
 *
 * **There is no rank and no count on this row**, which is the visible difference
 * from `CriterionResult` next door and the whole point of the sub-mode. A
 * criterion's results are ordered by the model relative to each other in the
 * paper and the row leads with that ordinal; a claim's place in this list is
 * where the paper makes it and nothing else, so there is nothing to number.
 *
 * ## Three empty states, not two
 *
 * - **Passages** — the ordinary case.
 * - **None, and the model named none** — `NO_PASSAGE_FOUND`. Evidence about the
 *   model, never about the paper.
 * - **None, and the model named some that could not be found** —
 *   `PASSAGES_UNUSABLE`. This is the state that used to be missing one sub-mode
 *   over, where a criterion whose every result was thrown away printed the
 *   *second* sentence and it was false (GPT Sol's finding 4). `Claim.discarded`
 *   is what tells them apart, and it is on the row precisely so this branch can
 *   exist.
 */
function ClaimRow({
  claim,
  slot,
  showing,
  onToggle,
  onJump,
}: {
  claim: Claim;
  slot: number | undefined;
  showing: boolean;
  onToggle(): void;
  onJump(blockId: BlockId): void;
}) {
  const hue =
    slot === undefined
      ? undefined
      : ({ "--cat-rgb": `var(--cat-${slot}-rgb)` } as React.CSSProperties);
  return (
    <li className="clm-row">
      <p className="clm-claim">{claim.claim}</p>

      <button type="button" className="clm-jump" onClick={() => onJump(claim.blockId)}>
        <span className="clm-quote">{claim.quote}</span>
      </button>

      {claim.passages.length > 0 && (
        <label className="clm-tick">
          <input
            type="checkbox"
            checked={showing}
            onChange={onToggle}
            /* The row's own hue, so the tick and the marks it draws are visibly
               the same thing — `--cat-rgb` holds a palette *reference*, never a
               colour, which is the seam hit-colours.ts keeps. */
            style={hue}
          />
          <span>Mark these passages in the paper</span>
        </label>
      )}

      {claim.passages.length === 0 && (
        <p className="clm-none">
          {claim.discarded > 0 ? PASSAGES_UNUSABLE : NO_PASSAGE_FOUND}
        </p>
      )}

      <ul className="clm-passages">
        {claim.passages.map((p, i) => (
          <li
            /* The index is part of the key on purpose, and it is the same
               three-part shape `resolveClaim` mints for the marks: one claim can
               be taken up twice in the same block. The list is replaced wholesale
               by each stream frame rather than reordered, so an index key cannot
               carry state across a move. */
            // biome-ignore lint/suspicious/noArrayIndexKey: the ordinal is part of the identity here — see above
            key={`${p.blockId}:${i}`}
            className="clm-passage"
          >
            <button type="button" className="clm-jump" onClick={() => onJump(p.blockId)}>
              <span className="clm-quote">{p.quote}</span>
            </button>
            {p.reasoning && <p className="clm-why">{p.reasoning}</p>}
            {/* Never both: `validateClaims` blanks the line as it sets the flag.
                The sentence is a value in src/referee-claims.ts so the copy test
                can check what it may say — it is about the model's line, and it
                says the passage survived, because a referee who watches a line
                vanish will otherwise wonder what went with it. */}
            {p.withheld && <p className="clm-why">{REASONING_WITHHELD}</p>}
          </li>
        ))}
      </ul>
    </li>
  );
}
