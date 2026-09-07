/**
 * **The five known-bad lines, and the gate they hold shut.**
 *
 * A judge asked "which of these lines serves a reader best?" will always answer.
 * The answer is worth nothing until the judge has been shown lines that are
 * definitely bad and has put them at the bottom — GPT Sol's P1-3 on the plan,
 * which is also the reason an unlabelled control is not enough here: *a question
 * visibly identifies itself*, so a judge primed to value "a door" prefers the
 * arms that look like doors, and blinding cannot hide what the text itself
 * announces.
 *
 * So the anchors are **not data points**. They are a precondition:
 *
 * > All five must rank below every real arm's line for this section, or the
 * > judge's ranking is discarded and the run reports no result.
 * > — [`variants.md`](variants.md) § *The five negative anchors*
 *
 * `MAX_ANCHOR_INVERSIONS` is the whole of the tolerance, declared before any run
 * rather than argued after one, and it is `0`.
 *
 * ## Which two matter, and why they are the ones that matter
 *
 * Anchors **3** (answer-leaking) and **5** (the gist with a `?` on it) are the
 * most *informative* lines in the lineup. A judge measuring information rather
 * than triage value will rate them highly — and that is exactly the failure this
 * eval is trying to detect, because the criterion the plan sets is *can the
 * reader decide whether to descend from the line alone*, which a line that
 * already contains the answer fails while looking excellent.
 *
 * Anchor **1** is a fabricated count, and it is a real trap rather than a
 * synthetic one: the node it belongs to has **six** children, while its own gist
 * and its prose both say **four**. A model reaching for the child count writes
 * `(6 arguments)` and is wrong in a way nothing but the prose can catch.
 *
 * ## The site is asserted, not assumed
 *
 * Every anchor is written against ONE node of ONE tree, and three of them only
 * work because of specific facts about it — the six children, the gist's exact
 * words, the title. If that document is re-ingested and the tree is re-carved,
 * the anchors quietly stop being anchors: anchor 1 might become *true*, anchor 5
 * would quote a gist that no longer exists, and the gate would still pass. So
 * `assertAnchorSite` checks all four facts and throws, and the run stops.
 * `docs/reusable/silent-success.md`, applied to the one thing whose failure
 * would make everything downstream meaningless while looking fine.
 */

import type { LoadedDocument } from "./corpus.js";
import { readVariants } from "./variants-file.js";

/**
 * **The node the anchors are written against**, and every fact about it they
 * depend on.
 *
 * Verified by Fable on 2026-09-05 against
 * `data/noema-mythology-of-conscious-ai/tree.json`, and re-verified here against
 * the exported copy the corpus pins — same node id, same title, same six
 * children, same gist, different JSON serialisation.
 */
export const ANCHOR_SITE = {
  slug: "noema-mythology-of-conscious-ai",
  nodeId: "n0048",
  title: "Consciousness & Computation",
  /** Anchor 1's whole point: six children, four arguments. */
  children: 6,
  /** Anchor 5 is this gist with a `?` on the end, so the words have to still be these. */
  gistStartsWith: "Four independent arguments",
} as const;

/** Nought. See the header: the tolerance is declared before the run, not after it. */
export const MAX_ANCHOR_INVERSIONS = 0;

/** A known-bad line, ready to be dropped into a lineup. */
export interface Anchor {
  /** `anchor-1`… — the label-independent identity that survives the shuffle. */
  id: string;
  n: number;
  failure: string;
  line: string;
}

/** The five, read out of `variants.md` rather than copied. */
export function anchors(): Anchor[] {
  return readVariants().anchors.map((a) => ({ id: `anchor-${a.n}`, n: a.n, failure: a.failure, line: a.line }));
}

export function isAnchorId(id: string): boolean {
  return id.startsWith("anchor-");
}

/**
 * Refuse to run if the anchors' article is no longer the one they were written
 * against. Throws with the fact that moved.
 */
export function assertAnchorSite(doc: LoadedDocument): void {
  if (doc.entry.slug !== ANCHOR_SITE.slug) {
    throw new Error(`assertAnchorSite was handed ${doc.entry.slug}, not ${ANCHOR_SITE.slug}`);
  }
  const node = doc.tree.nodes[ANCHOR_SITE.nodeId];
  if (!node) {
    throw new Error(
      `${ANCHOR_SITE.slug} has no node ${ANCHOR_SITE.nodeId}: the tree the five anchors were written against has been re-carved, so they are no longer anchors and the calibration gate would pass over nothing.`,
    );
  }
  const complaints: string[] = [];
  if (node.title !== ANCHOR_SITE.title) complaints.push(`title is ${JSON.stringify(node.title)}, not ${JSON.stringify(ANCHOR_SITE.title)}`);
  if (node.depth !== 1) complaints.push(`depth is ${node.depth}, not 1 — the anchors are depth-1 lines`);
  if (node.children.length !== ANCHOR_SITE.children) {
    complaints.push(
      `it has ${node.children.length} children, not ${ANCHOR_SITE.children} — anchor 1's fabricated count is "(6 arguments)" precisely because six is the child count and four is the truth`,
    );
  }
  if (!node.gist?.startsWith(ANCHOR_SITE.gistStartsWith)) {
    complaints.push(
      `its gist no longer begins ${JSON.stringify(ANCHOR_SITE.gistStartsWith)} — anchor 5 quotes that gist verbatim, so it would no longer be "the gist with a question mark on it"`,
    );
  }
  const five = anchors();
  if (five.length !== 5) complaints.push(`variants.md yielded ${five.length} anchors, not 5`);
  /* Anchor 5 quotes the gist. If it stops matching, the anchor is testing
     something else and the gate's name is wrong. Punctuation and the trailing
     mark aside, the words must be the node's own. */
  const anchor5 = five.find((a) => a.n === 5);
  const bare = (s: string) => s.toLowerCase().replace(/[.?!]+$/, "").replace(/\s+/g, " ").trim();
  if (anchor5 && node.gist && bare(anchor5.line) !== bare(node.gist)) {
    complaints.push(
      `anchor 5 is not this node's gist with a "?" on it — it says ${JSON.stringify(anchor5.line.slice(0, 60))}… and the gist says ${JSON.stringify(node.gist.slice(0, 60))}…`,
    );
  }
  if (complaints.length) {
    throw new Error(
      `The anchors' site has moved, so the calibration gate would pass over nothing:\n  - ${complaints.join("\n  - ")}\n` +
        `Fix the anchors in evals/summaries/variants.md against the tree as it now is, or repin the corpus.`,
    );
  }
}

/* --------------------------------------------------------------- the gate -- */

export interface CalibrationVerdict {
  /** The judgements that were checkable at all: a ranking naming both anchors and real lines. */
  checked: number;
  /** Every place an anchor was ranked above a real arm's line, in words. */
  inversions: string[];
  /** Anchors that never appeared in a ranking the judge returned. */
  unranked: string[];
  /**
   * **Rankings that were not a permutation of the lineup** — a candidate left
   * out, or one named twice.
   *
   * This is a whole failure of its own and not a detail, because of what the
   * first version did without it. `inversions` skipped any real candidate the
   * ranking did not mention, and `unranked` only ever recorded *anchors*, so a
   * ranking naming the five anchors and none of the seven real lines produced
   * `checked: 1`, no inversions, no unranked anchors, and **passed** — the gate
   * green over a judgement that had ranked no real line at all. ⟨GPT Sol, P0-1
   * on this code, 2026-09-05.⟩
   */
  malformed: string[];
  /**
   * **Stated forwards**, the way `evals/dictation/coverage.ts` states `clean`:
   * there was something to check, every ranking was a permutation of its
   * lineup, and in all of it every anchor sat below every real line. Not "no
   * complaint fired" — an empty set of judgements files no complaints and would
   * otherwise pass, and so, before Sol's P0-1, did a ranking with nothing real
   * in it.
   */
  passed: boolean;
}

/** One judged lineup, reduced to what the gate needs: the order, and who is an anchor. */
export interface RankedLineup {
  /** For the message: which document and node this was. */
  where: string;
  /** Candidate ids best-first, already un-blinded from the judge's labels. */
  ranking: string[];
  /** Every candidate that was in the lineup, anchors included. */
  present: string[];
}

/**
 * **Is one list a permutation of another** — the set arithmetic, with no words
 * attached to it.
 *
 * It lives here because the gate was the first thing that needed it, and it is
 * exported because [`judge.ts`](judge.ts) § `validateAnswer` needs the same
 * arithmetic over a different domain: the gate asks it about **candidate ids**
 * in the one lineup that carries anchors, and after unblinding; the acceptance
 * check asks it about **the judge's own labels**, in every lineup, before a word
 * of the answer is believed. Two questions, one piece of counting, and each
 * caller phrases its own complaint — the gate's, for instance, has to route a
 * missing *anchor* to `unranked` rather than to `malformed`, because an anchor
 * left out of a ranking is not an anchor rejected.
 *
 * `judge.ts` already imports this module, so this is the direction that does not
 * make a cycle.
 */
export function permutationOf(
  present: readonly string[],
  ranking: readonly string[],
): { duplicated: string[]; absent: string[]; foreign: string[] } {
  const counts = new Map<string, number>();
  for (const id of ranking) counts.set(id, (counts.get(id) ?? 0) + 1);
  return {
    duplicated: [...counts].filter(([, n]) => n > 1).map(([id]) => id),
    absent: present.filter((id) => !counts.has(id)),
    foreign: [...counts.keys()].filter((id) => !present.includes(id)),
  };
}

/**
 * Did the judge put all five below every real line, everywhere it was asked?
 *
 * Three things have to be true, and the first is the one that was missing:
 *
 * 1. **The ranking is a permutation of the lineup** — every candidate exactly
 *    once. Anything else is a judgement about a different set of lines than the
 *    one that was shown, and no ordering read off it means what it says.
 * 2. Every anchor appears in it. A ranking that omits an anchor is not an
 *    anchor rejected: the two are only the same if you assume the thing being
 *    tested.
 * 3. No anchor sits above any real line.
 */
export function calibrationOf(lineups: readonly RankedLineup[]): CalibrationVerdict {
  const inversions: string[] = [];
  const unranked: string[] = [];
  const malformed: string[] = [];
  let checked = 0;
  for (const lineup of lineups) {
    const anchorsHere = lineup.present.filter(isAnchorId);
    const realHere = lineup.present.filter((id) => !isAnchorId(id));
    if (anchorsHere.length === 0 || realHere.length === 0) continue;
    checked += 1;

    /* The permutation check, before anything is read off the order. **This is
       about ORDER and only order**: an axis the judge left out, or a `demand`
       score of 9, is not this gate's business and is refused one step earlier,
       at `judge.ts` § `validateAnswer`, where the raw answer is accepted or
       not. ⟨GPT Sol, F26 on 260907d, who passed this function a complete
       ranking with no axes at all and was right that it returned `passed:
       true`.⟩ */
    const { duplicated, absent, foreign } = permutationOf(lineup.present, lineup.ranking);
    if (duplicated.length) malformed.push(`${lineup.where}: ranked twice — ${duplicated.join(", ")}`);
    if (foreign.length) malformed.push(`${lineup.where}: ranked something that was not in the lineup — ${foreign.join(", ")}`);
    const missingReal = absent.filter((id) => !isAnchorId(id));
    if (missingReal.length) {
      malformed.push(`${lineup.where}: ${missingReal.length} real line(s) left out of the ranking — ${missingReal.join(", ")}`);
    }

    const at = new Map(lineup.ranking.map((id, i) => [id, i]));
    for (const anchor of anchorsHere) {
      const ai = at.get(anchor);
      if (ai === undefined) {
        unranked.push(`${lineup.where}: ${anchor} was in the lineup and not in the ranking`);
        continue;
      }
      for (const real of realHere) {
        const ri = at.get(real);
        if (ri === undefined) continue;
        if (ai < ri) inversions.push(`${lineup.where}: ${anchor} ranked above ${real}`);
      }
    }
  }
  return {
    checked,
    inversions,
    unranked,
    malformed,
    passed:
      checked > 0 &&
      malformed.length === 0 &&
      unranked.length === 0 &&
      inversions.length <= MAX_ANCHOR_INVERSIONS,
  };
}
