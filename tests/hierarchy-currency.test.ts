/**
 * **"Is this hierarchy run current" is answered by one function, in one place.**
 *
 * Before 2026-09-07 it was answered by two independently-maintained inline
 * expressions: `isCurrent`/`stages` in [`src/store/pg.ts`](../src/store/pg.ts),
 * which the metadata page draws, and `reasonsNotToPublish` in
 * [`src/store/pg-revisions.ts`](../src/store/pg-revisions.ts), the last gate
 * before a draft becomes the article a reader sees.
 *
 * ## The class, named by its postmortem
 *
 * docs/postmortems/260827d-toc-status-never-checked.md, and it is worth quoting
 * because it is the whole reason this file exists:
 *
 * > when "is this row good" is answered by an inline expression at each call
 * > site rather than one function both sites call, the question can be answered
 * > two different ways and nothing will say so.
 *
 * It had already happened, in 2026-08. **Until `e18ac5f` on 2026-08-27** the
 * publication guard read `input_hash` and never
 * `status`, so a `hierarchy` run that **crashed** — or one still going in
 * another process — left a row whose hash matched the blocks exactly, because
 * nothing had touched the blocks since. The one case the hash check existed to
 * catch was the only case it could refuse. The metadata page had the correct
 * version of the same idea, 46 minutes older, in a comment that asserted the
 * two agreed. Nothing enforced it, so it stayed plausible until GPT Sol read
 * the code instead of the comment.
 *
 * ## What was true when this landed, which is the interesting half
 *
 * The two checks **agreed on all five states**, verified against the tree on
 * 2026-09-07 and independently by GPT Sol. `e18ac5f` restored the parity on
 * 2026-08-27 and it had held for eleven days. So this is a **structural**
 * change with a proved-empty behavioural delta: no article moves from one side
 * of a disagreement to the other, because there was no disagreement.
 *
 * What had not existed for those eleven days was anything that would *say so*
 * if it stopped being true — which is precisely the gap the postmortem named,
 * and precisely what a shared signature closes. A fifth reason cannot be added
 * without the publication switch below coming here.
 *
 * ## Why a discriminated result and not a boolean
 *
 * `pg.ts` needs only the verdict; `pg-revisions.ts` needs to tell the reader
 * *which* of the four things went wrong, in four different sentences. A boolean
 * would have left those sentences being derived a second time from the same row
 * — the same two-answers-to-one-question shape, moved one level down.
 *
 * The name follows the step: the postmortem asks for `isTocCurrent`, and `toc`
 * was renamed `hierarchy` afterwards.
 */
import { describe, expect, it } from "vitest";
import { NO_INPUT_HASH, hierarchyCurrency } from "../src/store/artifacts.js";

const HASH = "0123456789abcdef";
const OTHER = "fedcba9876543210";

const run = (status: string, inputHash = HASH) => ({ status, inputHash });

describe("hierarchyCurrency — the five states, and what each is called", () => {
  it("is current only for a finished run against these blocks", () => {
    expect(hierarchyCurrency(run("done"), HASH)).toEqual({ current: true });
  });

  it("names the absence of a run", () => {
    expect(hierarchyCurrency(undefined, HASH)).toEqual({ current: false, why: "no-run" });
  });

  /**
   * **Before the hash and instead of it**, which is the shape `e18ac5f` chose
   * and the reason it is an ordered result rather than a set of flags: once a
   * run has errored or is still going, its hash cannot mean anything, and *"the
   * tree was built from different blocks — re-run hierarchy"* would send
   * somebody to re-run the thing that has just told them it failed.
   */
  it("calls a run that has not finished unfinished, whatever its hash says", () => {
    expect(hierarchyCurrency(run("running"), HASH)).toEqual({ current: false, why: "unfinished" });
    expect(hierarchyCurrency(run("running", OTHER), HASH)).toEqual({
      current: false,
      why: "unfinished",
    });
  });

  it("calls a run that failed errored, whatever its hash says", () => {
    expect(hierarchyCurrency(run("error"), HASH)).toEqual({ current: false, why: "errored" });
    expect(hierarchyCurrency(run("error", OTHER), HASH)).toEqual({
      current: false,
      why: "errored",
    });
  });

  it("names a finished run against different blocks", () => {
    expect(hierarchyCurrency(run("done", OTHER), HASH)).toEqual({
      current: false,
      why: "different-blocks",
      /* The hash travels with the verdict, so the sentence
         `reasonsNotToPublish` writes needs nothing but this result. */
      ranAgainst: OTHER,
    });
  });

  /**
   * `beginStepRun` writes `NO_INPUT_HASH` on purpose — a step that has not run
   * yet has not been made from anything — so a fenced run reaches the hash
   * branch only after failing the status one. Pinned because the sentinel is
   * the value most likely to be "fixed" into something that compares equal.
   */
  it("never calls the unstamped sentinel current", () => {
    expect(hierarchyCurrency(run("done", NO_INPUT_HASH), HASH)).toEqual({
      current: false,
      why: "different-blocks",
      ranAgainst: NO_INPUT_HASH,
    });
    expect(NO_INPUT_HASH).not.toBe(HASH);
  });

  /**
   * **A status nobody has heard of is not current.** The column is
   * `running | done | error` by check constraint (src/db/schema.ts), so this
   * cannot happen today — and the branch must be the safe one if the constraint
   * ever grows a fourth value, rather than falling through to `done`.
   */
  it("refuses a status it does not recognise", () => {
    expect(hierarchyCurrency(run("cancelled"), HASH).current).toBe(false);
  });
});
