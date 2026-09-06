/**
 * **The deterministic half of the Socratic-summaries eval** — the split
 * `evals/extraction/` and `evals/hierarchy-structure/` already make: what is
 * cheap and repeatable is pinned as a test, what spends money is not one.
 *
 * Four of these blocks are guarding something specific rather than exercising
 * code:
 *
 * - **`questionFor` mangles V4's shape**, which is GPT Sol's P1-4 in executable
 *   form. It is the reason V4 is the only arm that would need a change to
 *   `src/hierarchy.ts`, and it is asserted against *production's own function*
 *   so the day the patch lands this test goes red and somebody has to decide
 *   what the arm now means.
 * - **The calibration gate refuses an empty set.** Stated forwards, like
 *   `coverage.ts`'s `clean`: a gate that passes when nothing was checked is the
 *   shape of `docs/postmortems/260905b-the-rehearsal-reported-a-clean-run-over-zero-jobs.md`,
 *   and the anchors are the one thing whose silent absence would make every
 *   number downstream meaningless while looking fine.
 * - **The parsers refuse a file that moved.** `variants.md` and the production
 *   `SYSTEM` are both read at run time rather than transcribed, which removes
 *   one drift and introduces one parse — so the parse has to fail loudly.
 * - **Every eval that imports `coverage.ts` takes its exit code from it**, which
 *   is the repo-wide version of the guard
 *   `tests/dictation-bench-coverage.test.ts` keeps over its own directory.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { questionFor } from "../src/hierarchy.js";
import {
  ANCHOR_SITE,
  anchors,
  assertAnchorSite,
  calibrationOf,
  MAX_ANCHOR_INVERSIONS,
  type RankedLineup,
} from "../evals/summaries/anchors.js";
import { ARMS, armByName, armsNeedingCodeChange, promptBlocksFor, questionForTrailingHint } from "../evals/summaries/arms.js";
import { CORPUS, defaultCorpus } from "../evals/summaries/corpus.js";
import type { LoadedDocument } from "../evals/summaries/corpus.js";
import { proseWindows, rngFrom, seedFrom, shuffled } from "../evals/summaries/judge.js";
import { productionGists, productionQuestions, productionSystem, sectionOf, THE_DIAGNOSED_SENTENCE } from "../evals/summaries/production-prompt.js";
import { structureRequest } from "../src/hierarchy.js";
import {
  type ArmPlan,
  coverageFor,
  generationNoiseFloor,
  type Judgement,
  judgeInstability,
  meanRanks,
  perRepeatLeaders,
  separabilityThreshold,
  separate,
  shapeFacts,
} from "../evals/summaries/score.js";
import { readVariants } from "../evals/summaries/variants-file.js";
import { exitCodeFor } from "../evals/dictation/coverage.js";
import type { Cell } from "../evals/summaries/generate.js";
import { systemFor } from "../evals/summaries/generate.js";
import type { Tree } from "../src/types.js";

const REPO = new URL("..", import.meta.url).pathname;

/* -------------------------------------------------------- the two sources -- */

describe("variants.md is the source of the prompt text", () => {
  it("yields four variants, one GISTS block and five anchors", () => {
    const v = readVariants();
    expect([...v.questions.keys()].sort()).toEqual(["V1", "V2", "V3", "V4"]);
    expect(v.anchors.map((a) => a.n)).toEqual([1, 2, 3, 4, 5]);
    /* Not just "non-empty": the GISTS block exists to add the root-brevity rule
       and the meta-narration ban, and a fenced block that parsed but carried
       neither would be an arm quietly identical to the incumbent. */
    expect(v.gists).toContain("The ROOT gist is the briefest in the tree");
    expect(v.gists).toContain("No empty meta-narration");
  });

  it("gives each variant the axis its own table claims", () => {
    const v = readVariants();
    /* V3 is the arm that can falsify the plan, and its axis is that the
       question is asked straight. If that sentence leaves, V3 has become a
       fifth copy of V1 and nothing else would say so. */
    expect(v.questions.get("V3")).toContain("asked STRAIGHT");
    expect(v.questions.get("V3")).toContain("Yes/no is fine");
    /* V4's axis is reading order, and it is the only block whose shape puts the
       hint after the question mark. */
    expect(v.questions.get("V4")).toContain('"<topic> — <question>? (<shape hint>)"');
    expect(v.questions.get("V2")).toContain("ARGUES");
  });

  it("refuses a file whose section moved, rather than returning nothing", () => {
    /* `silent-success.md`: an arm sent an empty QUESTIONS block still produces
       plausible output, because the OUTPUT schema alone tells the model what to
       write. It would score as a variant. */
    /* `os.tmpdir()`, not `node_modules/`: the codex review sandbox mounts the
       tree read-only apart from a couple of caches, and this test failed there
       with EROFS while asserting nothing. A test that cannot run is not a test
       that passed. */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "summaries-variants-"));
    const file = path.join(dir, "variants.md");
    fs.writeFileSync(file, "# nothing here\n\n## V1 — an axis\n\nNo fenced block at all.\n");
    expect(() => readVariants(new URL(`file://${file}`))).toThrow(/no fenced block under V1/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("the incumbent arm's rules are sliced out of the live SYSTEM", () => {
  it("finds both blocks, and they are production's", () => {
    expect(productionGists()).toMatch(/^GISTS\b/);
    expect(productionQuestions()).toMatch(/^QUESTIONS\b/);
    /* The sentence the plan diagnoses as the cause of the generic questions.
       Every variant drops it; the control keeps it. If production drops it
       without this eval being re-run, the control is no longer what the
       variants were measured against. */
    expect(productionQuestions()).toContain(THE_DIAGNOSED_SENTENCE);
    /* **This used to assert production had NO meta-narration rule**, which was
       the point of `gists-only`. `toc/6` (2026-09-06) put that rule into
       production, so the assertion now runs the other way: the live block is
       ahead of `variants.md`'s replacement, and `gists-only` is measuring a
       block production has partly caught up with. Any result from `gists-only`
       predating that bump is against a control that no longer exists.

       Asserted on the sentence rather than on the label: production called it
       "No empty meta-narration" and now calls it "No narration of document
       order", and a test that tracked the heading would have gone red for a
       rename while a test that tracks nothing would survive the rule's
       deletion. This clause has outlived three drafts of the block. */
    expect(productionGists()).toContain("do not narrate that it is claiming");
  });

  it("throws when a header moves, rather than slicing the wrong thing", () => {
    const system = "GISTS (internal nodes)\n\n- one\n- two\n\nSOMETHING ELSE\n\n- three\n";
    expect(() => sectionOf(system, /^GISTS\b/, /^QUESTIONS\b/, "GISTS")).toThrow(/not followed by/);
    expect(() => sectionOf(system, /^TITLES\b/, /^GISTS\b/, "TITLES")).toThrow(/has no TITLES section/);
  });

  it("does not depend on the blocks it is asked to size a budget from", () => {
    /* The one-block argument is scaffolding. If the prompt ever varied with the
       article, the incumbent arm would be a different prompt per document.
       **Sliced from two different SYSTEMs**, not from one twice: comparing
       `productionGists()` with itself is true of every implementation and was
       the tautology GPT Sol found here. */
    const one = productionSystem();
    const many = structureRequest(
      Array.from({ length: 40 }, (_, i) => ({
        id: `spya-${String(i).padStart(6, "0")}`,
        tag: "p",
        kind: "text",
        text: `Block ${i}, with enough words in it to move a token budget somewhere else entirely.`,
        words: 14,
        gistable: true,
        html: `<p>Block ${i}</p>`,
      })) as unknown as Parameters<typeof structureRequest>[0],
    ).system;
    expect(many).toBe(one);
    expect(productionGists(many)).toBe(productionGists(one));
  });
});

/* ------------------------------------------------------------ V4's patch -- */

describe("V4 is the only arm that needs a change to production code", () => {
  const V4_LINE = "Computational functionalism — why isn't computation sufficient for consciousness? (4 arguments)";

  it("production's questionFor mangles V4's shape — GPT Sol's P1-4, executable", () => {
    expect(questionFor({ title: "", range: ["", ""], question: V4_LINE }, 1)).toBe(`${V4_LINE}?`);
  });

  it("V4's rule keeps it", () => {
    expect(questionForTrailingHint({ question: V4_LINE }, 1)).toBe(V4_LINE);
  });

  it("agrees with production everywhere the two are meant to agree", () => {
    const gist = "Four independent arguments undermine the assumption that computation alone can produce consciousness.";
    const same: { gist?: string; question: string; depth: number }[] = [
      { question: "Computational functionalism (4 arguments): why isn't computation sufficient?", depth: 1 },
      /* A trailing full stop is not evidence of mood — the rule GPT Sol killed
         and this one must not resurrect. */
      { question: "How did this affect the U.S.", depth: 1 },
      { question: "why?", depth: 2 },
      { question: "   ", depth: 1 },
      { gist, question: `${gist.replace(/\.$/, "")}?`, depth: 1 },
    ];
    for (const c of same) {
      const mn = { title: "", range: ["", ""] as [string, string], ...(c.gist ? { gist: c.gist } : {}), question: c.question };
      expect(questionForTrailingHint(c, c.depth), JSON.stringify(c)).toBe(questionFor(mn, c.depth));
    }
  });

  it("still catches the gist echoed back with a hint bolted on", () => {
    /* variants.md's second hunk: strip the bracket BEFORE the terminal
       punctuation, or anchor 5 in V4's shape would sail through. */
    const gist = "Four independent arguments undermine the assumption that computation alone can produce consciousness.";
    expect(questionForTrailingHint({ gist, question: `${gist.replace(/\.$/, "")}? (4 arguments)` }, 1)).toBeUndefined();
  });

  it("names v4 and only v4 as needing it", () => {
    expect(armsNeedingCodeChange()).toEqual(["v4"]);
    expect(armByName("v4").questionRule).toBe("trailing-hint");
    for (const arm of ARMS.filter((a) => a.name !== "v4")) expect(arm.questionRule).toBe("production");
  });
});

/* --------------------------------------------------------------- the arms -- */

describe("the arms", () => {
  it("let 'change nothing' win, and measure the model's own wobble", () => {
    const incumbent = armByName("incumbent");
    const repeat = armByName("incumbent-repeat");
    expect(incumbent.comparison).toBe("baseline");
    expect(incumbent.newGists).toBe(false);
    expect(incumbent.variant).toBeUndefined();
    /* Identical recipes under two names is the noise floor and nothing else
       here may share that shape. */
    expect(repeat.newGists).toBe(incumbent.newGists);
    expect(repeat.variant).toBe(incumbent.variant);
    expect(repeat.questionRule).toBe(incumbent.questionRule);
    expect(repeat.comparison).toBe("noise-floor");
  });

  it("declares every arm a bakeoff except the two incumbents", () => {
    /* The whole eval is a bakeoff by construction — production asks for
       structure and wording in one response and this asks only for wording —
       so `isolated` must not appear anywhere. */
    for (const arm of ARMS) expect(["baseline", "noise-floor", "bakeoff"]).toContain(arm.comparison);
    expect(ARMS.filter((a) => a.comparison === "bakeoff").map((a) => a.name)).toEqual([
      "gists-only", "v1", "v2", "v3", "v4", "gists-toc5", "gists-toc6",
    ]);
  });

  /**
   * **The pinned pair, and the identity that makes it necessary.**
   *
   * `incumbent` slices the live SYSTEM, so it is the *newest* shipped block
   * whatever that is. The check that could have failed — and would have, had the
   * block been retyped rather than copied — is the first one: the pinned `toc/6`
   * text is character-for-character what production sends today. The second says
   * out loud why the before half cannot be `incumbent`: its whole system prompt
   * is byte-identical to `gists-toc6`'s, so a run of the two would measure the
   * model's wobble and report it as the effect of the bump.
   */
  it("pins toc/6 to what production sends, and toc/5 to what it sent before", () => {
    expect(promptBlocksFor(armByName("gists-toc6")).gists).toBe(productionGists());
    expect(systemFor(armByName("incumbent"))).toBe(systemFor(armByName("gists-toc6")));
    const five = promptBlocksFor(armByName("gists-toc5")).gists;
    expect(five).not.toBe(productionGists());
    /* The three sentences the bump added, absent from the before block. */
    expect(five).not.toContain("LENGTH RUNS THE OPPOSITE WAY");
    expect(five).not.toContain("No empty meta-narration");
    expect(five).not.toContain("shorter, commoner word");
    expect(five).toContain("Exactly ONE sentence");
    /* The GISTS block is the only variable: questions are production's on both. */
    expect(promptBlocksFor(armByName("gists-toc5")).questions).toBe(promptBlocksFor(armByName("gists-toc6")).questions);
    expect(() => promptBlocksFor({ ...armByName("gists-toc6"), shippedGists: "toc/99" })).toThrow(/does not pin/);
  });

  it("points each arm at the one it differs from in a single block", () => {
    expect(armByName("gists-only").isolatedAgainst).toBe("incumbent");
    expect(armByName("gists-toc6").isolatedAgainst).toBe("gists-toc5");
    expect(armByName("v1").isolatedAgainst).toBe("gists-only");
    for (const name of ["v2", "v3", "v4"]) expect(armByName(name).isolatedAgainst).toBe("v1");
    /* Every name it points at has to exist, or the report quotes a pair that
       does not. */
    for (const arm of ARMS) if (arm.isolatedAgainst) expect(() => armByName(arm.isolatedAgainst!)).not.toThrow();
  });

  it("sends the variant text the file defines, and refuses one it does not", () => {
    expect(promptBlocksFor(armByName("v3")).questions).toContain("asked STRAIGHT");
    expect(promptBlocksFor(armByName("incumbent")).questions).toContain(THE_DIAGNOSED_SENTENCE);
    expect(promptBlocksFor(armByName("gists-only")).questions).toContain(THE_DIAGNOSED_SENTENCE);
    expect(promptBlocksFor(armByName("gists-only")).gists).toContain("No empty meta-narration");
    expect(() => promptBlocksFor({ ...armByName("v1"), variant: "V9" })).toThrow(/which variants.md does not define/);
  });
});

/* ---------------------------------------------------------- the anchors --- */

function fakeDoc(overrides: Partial<{ children: string[]; title: string; gist: string; depth: number }> = {}): LoadedDocument {
  const node = {
    id: ANCHOR_SITE.nodeId,
    depth: overrides.depth ?? 1,
    parent: "n0001",
    children: overrides.children ?? ["a", "b", "c", "d", "e", "f"],
    range: ["spya-a", "spya-b"] as [string, string],
    title: overrides.title ?? ANCHOR_SITE.title,
    gist:
      overrides.gist ??
      "Four independent arguments—about brains, alternative computation, biological life, and simulation—undermine the assumption that digital computation alone can produce consciousness.",
  };
  const tree = { version: "toc/2", generator: "x", slug: ANCHOR_SITE.slug, rootId: "n0001", nodes: { [node.id]: node } } as unknown as Tree;
  return {
    entry: CORPUS.find((e) => e.slug === ANCHOR_SITE.slug)!,
    blocks: [],
    tree,
    title: "The Mythology Of Conscious AI",
    drift: [],
  };
}

describe("the anchors' site is asserted, not assumed", () => {
  it("accepts the tree the anchors were written against", () => {
    expect(() => assertAnchorSite(fakeDoc())).not.toThrow();
    expect(anchors().map((a) => a.id)).toEqual(["anchor-1", "anchor-2", "anchor-3", "anchor-4", "anchor-5"]);
  });

  it("refuses a re-carved tree, naming the fact that moved", () => {
    /* Anchor 1's whole point is that six is the child count and four is the
       truth. Five children and it is no longer a fabricated count. */
    expect(() => assertAnchorSite(fakeDoc({ children: ["a", "b", "c", "d", "e"] }))).toThrow(/5 children, not 6/);
    expect(() => assertAnchorSite(fakeDoc({ gist: "Something else entirely." }))).toThrow(/anchor 5/);
    expect(() => assertAnchorSite(fakeDoc({ title: "Computation" }))).toThrow(/title is/);
    expect(() => assertAnchorSite(fakeDoc({ depth: 2 }))).toThrow(/depth is 2/);
  });

  it("holds anchor 5 to being this node's gist with a mark on it", () => {
    const doc = fakeDoc();
    const anchor5 = anchors().find((a) => a.n === 5)!;
    const bare = (s: string) => s.toLowerCase().replace(/[.?!]+$/, "").replace(/\s+/g, " ").trim();
    expect(bare(anchor5.line)).toBe(bare(doc.tree.nodes[ANCHOR_SITE.nodeId]!.gist!));
  });
});

describe("the calibration gate", () => {
  const PRESENT = ["incumbent", "v1", "anchor-1", "anchor-3"];
  const lineup = (ranking: string[]): RankedLineup => ({ where: "noema-r1/n0048", ranking, present: PRESENT });

  it("passes when every anchor sits below every real line", () => {
    const v = calibrationOf([lineup(["v1", "incumbent", "anchor-3", "anchor-1"])]);
    expect(v.passed).toBe(true);
    expect(v.checked).toBe(1);
    expect(v.inversions).toEqual([]);
    expect(v.malformed).toEqual([]);
  });

  it("fails on one inversion, and says which", () => {
    /* Anchors 3 and 5 are the ones that matter: they are the most INFORMATIVE
       lines in the lineup, so a judge measuring information rather than triage
       value rates them highly — which is exactly the failure being detected. */
    const v = calibrationOf([lineup(["anchor-3", "v1", "incumbent", "anchor-1"])]);
    expect(v.passed).toBe(false);
    expect(v.inversions).toEqual([
      "noema-r1/n0048: anchor-3 ranked above incumbent",
      "noema-r1/n0048: anchor-3 ranked above v1",
    ]);
    expect(MAX_ANCHOR_INVERSIONS).toBe(0);
  });

  it("refuses to treat an unranked anchor as a rejected one", () => {
    /* An anchor the judge did not rank is an anchor the judge did not reject,
       and the two are only the same if you assume the thing being tested. */
    const v = calibrationOf([lineup(["v1", "incumbent", "anchor-1"])]);
    expect(v.passed).toBe(false);
    expect(v.unranked).toEqual(["noema-r1/n0048: anchor-3 was in the lineup and not in the ranking"]);
  });

  it("refuses a ranking that names the anchors and no real line", () => {
    /* **GPT Sol's P0-1, and it passed before the permutation check existed.**
       Every real candidate was skipped by `continue`, `unranked` recorded only
       anchors, so this yielded checked: 1, no inversions, no unranked anchors —
       and a green gate over a judgement that had ranked nothing real. */
    const v = calibrationOf([lineup(["anchor-1", "anchor-3"])]);
    expect(v.passed).toBe(false);
    expect(v.malformed).toEqual([
      "noema-r1/n0048: 2 real line(s) left out of the ranking — incumbent, v1",
    ]);
    expect(v.inversions).toEqual([]);
  });

  it("refuses a ranking that names something twice, or something not in the lineup", () => {
    const twice = calibrationOf([lineup(["v1", "v1", "incumbent", "anchor-1", "anchor-3"])]);
    expect(twice.passed).toBe(false);
    expect(twice.malformed.join(" ")).toContain("ranked twice — v1");
    const foreign = calibrationOf([lineup(["v1", "incumbent", "v9", "anchor-1", "anchor-3"])]);
    expect(foreign.passed).toBe(false);
    expect(foreign.malformed.join(" ")).toContain("not in the lineup — v9");
  });

  it("does not pass over nothing", () => {
    /* The empty-collection shape: no lineup carried an anchor, so no complaint
       fires, so an absence-of-complaint gate would pass. This one is stated
       forwards and does not. */
    expect(calibrationOf([]).passed).toBe(false);
    expect(calibrationOf([{ where: "x", ranking: ["v1"], present: ["v1"] }]).passed).toBe(false);
  });
});

describe("the prose the judge is shown", () => {
  it("samples across the section rather than taking its head", () => {
    /* **GPT Sol's P0-2.** The calibration node is 30,187 characters; its opening
       announces four arguments and starts the first, and the material anchors 3
       and 5 quote is nowhere in the first 1,800. Head-only, the judge could have
       ranked those two anchors last for being unsupported by the EXCERPT rather
       than for leaking the answer — the gate green over the wrong measurement. */
    const text = `${"A".repeat(10_000)}${"M".repeat(10_000)}${"Z".repeat(10_000)}`;
    const { excerpt, complete } = proseWindows(text, 600, 3);
    expect(complete).toBe(false);
    expect(excerpt).toContain("A");
    expect(excerpt).toContain("M");
    expect(excerpt).toContain("Z");
    expect(excerpt.split("[…]")).toHaveLength(3);
  });

  it("returns a short section whole, and says so", () => {
    const { excerpt, complete } = proseWindows("short enough", 600, 3);
    expect(complete).toBe(true);
    expect(excerpt).toBe("short enough");
  });
});

/* ----------------------------------------------------- the shuffle, seeded */

describe("the blinding shuffle", () => {
  const items = ["incumbent", "v1", "v2", "v3", "v4", "anchor-1"];

  it("replays exactly from a seed", () => {
    /* The repeat pass judges the SAME frozen output under a DIFFERENT label
       assignment, so the seed has to be reproducible or a disagreement between
       two repeats cannot be attributed to the judge. */
    expect(shuffled(items, rngFrom(seedFrom("run|noema|repeat-1")))).toEqual(
      shuffled(items, rngFrom(seedFrom("run|noema|repeat-1"))),
    );
  });

  it("gives a different assignment to a different repeat", () => {
    expect(shuffled(items, rngFrom(seedFrom("run|noema|repeat-1")))).not.toEqual(
      shuffled(items, rngFrom(seedFrom("run|noema|repeat-2"))),
    );
  });

  it("is a permutation, not a sample", () => {
    const out = shuffled(items, rngFrom(1234));
    expect([...out].sort()).toEqual([...items].sort());
  });
});

/* ---------------------------------------------------- facts, not scores --- */

describe("shape facts are facts", () => {
  it("reads V1's shape", () => {
    const f = shapeFacts("Computational functionalism (4 arguments): why isn't computation sufficient for consciousness?");
    expect(f.endsInQuestionMark).toBe(true);
    expect(f.hasBracketedHint).toBe(true);
    expect(f.hintClaimsCount).toBe(true);
    expect(f.hintAfterQuestionMark).toBe(false);
    expect(f.yesNoOpener).toBe(false);
  });

  it("reads V3's straight question as yes/no WITHOUT calling it a defect", () => {
    /* V3 deliberately relaxes production's "not yes/no" rule; that relaxation
       is its axis. Nothing in score.ts turns this boolean into a penalty, and
       if something ever does, this comment is where to argue about it. */
    const f = shapeFacts("Computational functionalism (4 arguments against): is computation sufficient for consciousness?");
    expect(f.yesNoOpener).toBe(true);
    expect(Object.keys(f)).not.toContain("penalty");
  });

  it("reads V4's shape, which is the one production mangles", () => {
    const f = shapeFacts("Computational functionalism — why isn't computation sufficient for consciousness? (4 arguments)");
    expect(f.hintAfterQuestionMark).toBe(true);
    expect(f.endsInQuestionMark).toBe(false);
  });

  it("spots the meta-narration the new GISTS block bans, in the real gists", () => {
    /* Both of these are stored depth-1 gists on the calibration article — the
       examples in variants.md are from the output, not invented. */
    expect(shapeFacts("The essay opens by introducing Anil Seth's argument.").metaNarration).toEqual(["the essay opens by"]);
    expect(shapeFacts("The essay closes by urging that we resist mechanizing ourselves.").metaNarration).toEqual(["the essay closes by"]);
    expect(shapeFacts("Belief in conscious AI rests on bias, not evidence.").metaNarration).toEqual([]);
  });
});

/* ------------------------------------------------------------- the ranks -- */

describe("ranking, the noise floor and the threshold", () => {
  const judged = (slug: string, repeat: number, order: string[]): Judgement => ({
    slug,
    repeat,
    nodes: { n1: { questions: { axes: {}, ranking: order } } },
  });

  it("leaves the anchors out of every arm's mean rank", () => {
    /* An anchor sitting third would otherwise push every arm below it down one,
       by an amount that varies with which nodes carried anchors. */
    const ranks = meanRanks([judged("a", 1, ["v1", "anchor-1", "incumbent"])], "questions");
    expect(ranks.map((r) => r.arm)).toEqual(["v1", "incumbent"]);
    expect(ranks.find((r) => r.arm === "incumbent")!.meanRank).toBe(1);
  });

  it("calls a gap inside the threshold not a gap", () => {
    const ranks = [
      { arm: "v1", meanRank: 1.0, lineups: 10 },
      { arm: "incumbent", meanRank: 1.4, lineups: 10 },
      { arm: "v3", meanRank: 3.9, lineups: 10 },
    ];
    const sep = separate(ranks, 0.5, { perRepeatLeaders: ["v1", "v1"], coverageClean: true });
    expect(sep.separable).toBe(false);
    expect(sep.tiedWithLeader).toEqual(["v1", "incumbent"]);
    expect(separate(ranks, 0.2, { perRepeatLeaders: ["v1", "v1"], coverageClean: true }).separable).toBe(true);
  });

  it("refuses a leader that did not lead in every repeat", () => {
    /* GPT Sol's replacement for the scalar comparison, and the stronger half of
       the test: an ordering that does not reproduce under a fresh shuffle of the
       same frozen output is not an ordering. */
    const ranks = [
      { arm: "v1", meanRank: 1.0, lineups: 10 },
      { arm: "v3", meanRank: 3.9, lineups: 10 },
    ];
    const sep = separate(ranks, 0.2, { perRepeatLeaders: ["v1", "v3"], coverageClean: true });
    expect(sep.separable).toBe(false);
    expect(sep.refusedBecause.join(" ")).toContain("not the same in every repeat");
  });

  it("refuses a leader on a run that is not a clean bill", () => {
    /* An arm that answered only its easy nodes is ranked over fewer lineups and
       can still top the mean; naming it the leader would reward the omission. */
    const ranks = [
      { arm: "v1", meanRank: 1.0, lineups: 4 },
      { arm: "v3", meanRank: 3.9, lineups: 10 },
    ];
    const sep = separate(ranks, 0.2, { perRepeatLeaders: ["v1", "v1"], coverageClean: false });
    expect(sep.separable).toBe(false);
    expect(sep.refusedBecause.join(" ")).toContain("not a clean bill");
  });

  it("refuses to call any gap real when instability was never measured", () => {
    expect(separabilityThreshold(null)).toBeNull();
    expect(separate([{ arm: "v1", meanRank: 0, lineups: 3 }], null).separable).toBe(false);
  });

  it("measures judge instability as a MEAN-rank spread, not a per-lineup churn", () => {
    /* **The units, which the first version got wrong.** Averaging how far one
       arm moves inside one lineup gives ~2.3 ranks for a random judge over seven
       arms, while the means it would be compared against differ by tenths — so
       the threshold would have swallowed every real gap and the eval would have
       said "not separable" for ever. Here the judge reverses one of two lineups
       between repeats: each arm's per-lineup churn is a full rank, and its mean
       rank does not move at all. */
    const flip: Judgement[] = [
      { slug: "d", repeat: 1, nodes: { n1: { questions: { axes: {}, ranking: ["a", "b"] } }, n2: { questions: { axes: {}, ranking: ["b", "a"] } } } },
      { slug: "d", repeat: 2, nodes: { n1: { questions: { axes: {}, ranking: ["b", "a"] } }, n2: { questions: { axes: {}, ranking: ["a", "b"] } } } },
    ];
    const i = judgeInstability(flip, "questions")!;
    expect(i.perLineup).toBe(1);
    expect(i.ranks).toBe(0);
    expect(i.repeats).toBe(2);
  });

  it("does not compare two different articles' roots as if they were one lineup", () => {
    /* **GPT Sol's P0-4.** Node ids are per-tree, so `n0001` is the root of EVERY
       article. Keyed on the node id alone, two documents' roots become one
       lineup and the answer depends on which of them was written into the map
       last — which is what the ordering below varies. Each article is perfectly
       stable across its own repeats, so the honest churn is nought; keyed
       without the slug, the reversal between the two articles is reported as the
       judge changing its mind. SEEN RED with `lineupKey` ignoring the slug. */
    const A = (repeat: number): Judgement => ({ slug: "antikythera", repeat, nodes: { n0001: { questions: { axes: {}, ranking: ["x", "y"] } } } });
    const B = (repeat: number): Judgement => ({ slug: "fowler", repeat, nodes: { n0001: { questions: { axes: {}, ranking: ["y", "x"] } } } });
    const i = judgeInstability([A(1), B(1), B(2), A(2)], "questions")!;
    expect(i.perLineup).toBe(0);
    expect(i.ranks).toBe(0);
    expect(i.comparisons).toBe(4);
  });

  it("says 'never checked' rather than 'perfectly stable' on one repeat", () => {
    expect(judgeInstability([judged("d", 1, ["a", "b"])], "questions")).toBeNull();
    expect(judgeInstability([], "questions")).toBeNull();
  });

  it("pairs the two incumbents rather than differencing their means", () => {
    /* **GPT Sol's P0-4, the other half.** The two recipes are exchangeable, so
       opposite movements cancel and |mean(A) - mean(B)| tends to zero as the
       corpus grows however far apart the two runs landed on any row. Here they
       swap places on two lineups: the paired figure is a full rank, the
       difference of means is nought, and only one of those is the floor. */
    const swap: Judgement[] = [
      { slug: "d", repeat: 1, nodes: {
        n1: { questions: { axes: {}, ranking: ["incumbent", "incumbent-repeat"] } },
        n2: { questions: { axes: {}, ranking: ["incumbent-repeat", "incumbent"] } },
      } },
    ];
    const floor = generationNoiseFloor(swap, "questions")!;
    expect(floor.paired).toBe(1);
    expect(floor.meanGap).toBe(0);
    expect(floor.lineups).toBe(2);
  });

  it("names the leader of each repeat's own table", () => {
    expect(
      perRepeatLeaders([judged("d", 1, ["v1", "v3"]), judged("d", 2, ["v3", "v1"])], "questions"),
    ).toEqual(["v1", "v3"]);
  });
});

/* ----------------------------------------------------------- the clean bill */

describe("the clean bill is computed forwards", () => {
  const MODEL = "anthropic/claude-sonnet-5";
  /** One cell: `gists` lines, of which `questions` carried a surviving question. */
  const cell = (arm: string, gists: number, questions: number, requested = 5): Cell => ({
    arm,
    slug: "writes",
    requested: Array.from({ length: requested }, (_, i) => `n${i}`),
    lines: Array.from({ length: gists }, (_, i) => ({
      nodeId: `n${i}`,
      gist: "g",
      ...(i < questions ? { question: "Why?" } : {}),
    })),
    missing: [],
    extra: [],
    questionless: [],
    answeredBy: gists ? MODEL : undefined,
  });
  const plan = (arms: string[]): ArmPlan[] => arms.map((arm) => ({ arm, gists: 5, questions: 5 }));

  it("calls a full run clean", () => {
    const c = coverageFor([cell("incumbent", 5, 5), cell("v1", 5, 5)], plan(["incumbent", "v1"]), MODEL);
    expect(c.clean).toBe(true);
    expect(exitCodeFor(c)).toBe(0);
    expect(c.attempted).toBe(20);
  });

  it("refuses a clean bill to an arm that wrote every gist and not one question", () => {
    /* **GPT Sol's P0-3.** The denominator counted nodes and the numerator counted
       lines, so a gist was the whole of what an arm was asked for and an arm with
       no questions at all — or with all of them dropped by `questionFor` — was
       clean, then ranked over fewer question lineups than its rivals, and could
       still be announced as the leader. */
    const c = coverageFor([cell("incumbent", 5, 5), cell("v1", 5, 0)], plan(["incumbent", "v1"]), MODEL);
    expect(c.clean).toBe(false);
    expect(c.short).toEqual(["v1"]);
  });

  it("refuses a clean bill to an arm that answered nothing, and exits 1", () => {
    const c = coverageFor([cell("incumbent", 5, 5), cell("v1", 0, 0)], plan(["incumbent", "v1"]), MODEL);
    expect(c.clean).toBe(false);
    expect(c.silent).toEqual(["v1"]);
    expect(exitCodeFor(c)).toBe(1);
  });

  it("counts an arm whose cell was never written, rather than losing it from both halves", () => {
    /* The other half of P0-3: `attempted` came off the cells, so an arm whose
       every call died before checkpointing scored 0 of 0 and passed. The plan is
       the denominator now, and the plan is fixed before any call. */
    const c = coverageFor([cell("incumbent", 5, 5)], plan(["incumbent", "v1"]), MODEL);
    expect(c.clean).toBe(false);
    expect(c.silent).toEqual(["v1"]);
    expect(c.attempted).toBe(20);
    expect(exitCodeFor(c)).toBe(1);
  });

  it("refuses a run with no arms at all", () => {
    const c = coverageFor([], [], MODEL);
    expect(c.clean).toBe(false);
    expect(exitCodeFor(c)).toBe(1);
  });

  it("notices when something other than the model asked for answered", () => {
    const c = coverageFor([cell("incumbent", 5, 5)], plan(["incumbent"]), "some/other-model");
    expect(c.misnamed).toEqual(["incumbent"]);
    expect(c.clean).toBe(false);
  });
});

/* --------------------------------------------------------- the corpus --- */

describe("the corpus manifest", () => {
  it("puts the anchors' article in every default run", () => {
    /* Without it there is no calibration gate, and the run may report no
       ranking at all — so it is not something a default may drop. */
    expect(defaultCorpus().map((e) => e.slug)).toContain(ANCHOR_SITE.slug);
  });

  it("keeps duplicates, fixtures and the book out of the default", () => {
    const roles = new Set(defaultCorpus().map((e) => e.role));
    expect([...roles].sort()).toEqual(["calibration", "dev"]);
    expect(CORPUS.some((e) => e.role === "duplicate" && e.duplicateOf === ANCHOR_SITE.slug)).toBe(true);
    expect(CORPUS.some((e) => e.role === "oversize")).toBe(true);
  });

  it("gives every entry a hash for both files and a reason somebody wrote", () => {
    for (const e of CORPUS) {
      expect(e.sha256, e.slug).toMatch(/^[0-9a-f]{64}$/);
      /* The TREE is an input here, not an output — the whole point of the fixed
         tree design — so it is pinned too. */
      expect(e.treeSha256, e.slug).toMatch(/^[0-9a-f]{64}$/);
      expect(e.why.length, e.slug).toBeGreaterThan(80);
    }
    const reasons = CORPUS.map((e) => e.why);
    expect(new Set(reasons).size, "entries sharing a reason word for word").toBe(reasons.length);
  });

  it("records the root-gist inversion the plan measured, on real articles", () => {
    /* The plan measured this on the fixture cut and flagged the caveat. On the
       exported corpus the root is the longest median row in every document but
       one, and that one is named. */
    const inverted = CORPUS.filter((e) => e.gistWords[0] > e.gistWords[1]);
    const exceptions = CORPUS.filter((e) => e.gistWords[0] <= e.gistWords[1]);
    expect(inverted.length).toBeGreaterThan(exceptions.length);
    expect(exceptions.map((e) => e.slug)).toEqual(["openai-huggingface"]);
  });
});

/* ------------------------------- every eval that counts coverage exits on it */

describe("every eval that imports coverage.ts takes its exit code from it", () => {
  /**
   * **The repo-wide version of `tests/dictation-bench-coverage.test.ts`'s
   * per-directory guard.** That one watches `evals/dictation/bench-*.ts`; this
   * one watches every file anywhere under `evals/` that imports the module, so
   * a third eval cannot import the counting and then decide the exit code some
   * other way — which is how a run that measured nothing still exits 0.
   *
   * The list is asserted rather than merely walked: a collector that matches
   * nothing passes every assertion about its contents, forever
   * (`docs/reusable/silent-success.md`).
   */
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.(ts|mts)$/.test(e.name) ? [full] : [];
    });

  const evalsDir = path.join(REPO, "evals");
  const importers = walk(evalsDir)
    .filter((f) => /from "[^"]*coverage\.js"/.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(REPO, f))
    .sort();

  it("found the files it claims to be checking", () => {
    expect(importers).toEqual([
      "evals/dictation/bench-models.ts",
      "evals/dictation/bench-vocabulary-sources.ts",
      "evals/summaries/run.ts",
      "evals/summaries/score.ts",
    ]);
  });

  /* `score.ts` is a library: it builds the `Coverage` and hands it back, and the
     entry point that owns the process is what must raise the code. Named here
     rather than filtered silently, so adding a second library means deciding. */
  const LIBRARIES = new Set(["evals/summaries/score.ts"]);

  /** The one idiom that ends a process on a run that measured nothing. */
  const RAISES = /if \(exitCodeFor\([A-Za-z]+\) === 1\) process\.exitCode = 1/g;

  for (const file of importers.filter((f) => !LIBRARIES.has(f))) {
    it(`${file} raises process.exitCode from every exitCodeFor it calls`, () => {
      const src = fs
        .readFileSync(path.join(REPO, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const calls = src.match(/\bexitCodeFor\(/g) ?? [];
      const raises = src.match(RAISES) ?? [];
      /* Counted, not merely present. `run.ts` has TWO commands that end a
         process, and a check satisfied by one occurrence passes a file where
         the other one shrugs — watched failing 2026-09-05 by replacing one of
         the two with a `console.log`. */
      expect(calls.length, "calls to exitCodeFor").toBeGreaterThan(0);
      expect(raises.length, "of which raise process.exitCode").toBe(calls.length);
    });
  }

  it("can still fire — the guard, against a file that counts and shrugs", () => {
    /* A check you have never seen fail is not evidence. Both shapes: one that
       never raises at all, and one that raises for its first exit and prints
       for its second — which is the version the first draft of this guard let
       through. */
    const shrugs = 'const c = coverageOf([]);\nconsole.log(exitCodeFor(c));\n';
    expect(shrugs.match(RAISES) ?? []).toHaveLength(0);
    const half =
      "if (exitCodeFor(coverage) === 1) process.exitCode = 1;\nconsole.log(exitCodeFor(coverage));\n";
    expect((half.match(/\bexitCodeFor\(/g) ?? []).length).toBe(2);
    expect((half.match(RAISES) ?? []).length).toBe(1);
  });

  it("holds the library to handing back a Coverage rather than exiting itself", () => {
    const src = fs.readFileSync(path.join(REPO, "evals/summaries/score.ts"), "utf8");
    expect(src).toMatch(/export function coverageFor\(/);
    expect(src).not.toMatch(/process\.exitCode/);
  });
});
